import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource } from 'typeorm';
import {
  BanditSimulateDto,
  LiveContextQueryDto,
  MarketPricingDto,
  OptimizeAllocationDto,
  OptimizeLiveAllocationDto,
  PortfolioOptimizeDto,
  RevenueQuoteDto,
  ScenarioRunDto,
} from './dto/revenue.dto';

const PORTFOLIO_DAILY_INVENTORY_SQL = `
  WITH requested_days AS (
    SELECT ($1::date + day_offset)::date AS stay_date
    FROM generate_series(0, $2::integer - 1) AS day_offset
  ), room_days AS (
    SELECT day.stay_date,
           room_type.type_id,
           room_type.name AS type_name,
           room_type.base_price,
           room_type.declared_max_price,
           room.room_id,
           room.current_status,
           room.housekeeping_status,
           room.occupancy_booking_id,
           EXISTS (
             SELECT 1 FROM booking_details detail
             INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
             WHERE detail.room_id = room.room_id
               AND booking.status IN ('Confirmed', 'CheckedIn')
               AND booking.check_in_date <= day.stay_date
               AND booking.check_out_date > day.stay_date
           ) AS is_confirmed,
           EXISTS (
             SELECT 1 FROM booking_details detail
             INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
             WHERE detail.room_id = room.room_id
               AND booking.status = 'Pending'
               AND booking.pending_expires_at > $4::timestamptz
               AND booking.check_in_date <= day.stay_date
               AND booking.check_out_date > day.stay_date
           ) AS is_held
    FROM requested_days day
    CROSS JOIN room_types room_type
    LEFT JOIN rooms room ON room.type_id = room_type.type_id
      AND room.current_status <> 'Maintenance'
  ), classified_rooms AS (
    SELECT *, CASE
      WHEN room_id IS NULL THEN NULL
      WHEN is_confirmed THEN 'confirmed'
      WHEN is_held THEN 'held'
      WHEN stay_date = $3::date AND (
        current_status <> 'Available'
        OR occupancy_booking_id IS NOT NULL
        OR housekeeping_status <> 'Ready'
      ) THEN 'operationally_blocked'
      ELSE 'available'
    END AS inventory_state
    FROM room_days
  )
  SELECT stay_date::text,
         type_id,
         type_name,
         base_price,
         declared_max_price,
         COUNT(room_id)::integer AS sellable_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'confirmed')::integer AS confirmed_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'held')::integer AS held_rooms,
         COUNT(*) FILTER (WHERE inventory_state = 'available')::integer AS available_rooms
  FROM classified_rooms
  GROUP BY stay_date, type_id, type_name, base_price, declared_max_price
  ORDER BY base_price ASC, type_id ASC, stay_date ASC`;

@Injectable()
export class RevenueService {
  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  private getBaseUrl(): string {
    const configured = this.config.get<string>('AI_REVENUE_URL');
    if (configured) return configured.replace(/\/$/, '');
    const academic = this.config.get<string>('AI_ACADEMIC_URL');
    if (academic) {
      return `${new URL(academic).origin}/api/v1/revenue`;
    }
    const legacyUrl = this.config.get<string>(
      'AI_SERVICE_URL',
      'http://127.0.0.1:8000/api/v1/predict-price',
    );
    return `${new URL(legacyUrl).origin}/api/v1/revenue`;
  }

  private async call(method: 'get' | 'post', path: string, body?: unknown) {
    const base = this.getBaseUrl();
    try {
      const { data } = await axios.request({
        method,
        url: `${base}/${path}`,
        data: body,
        timeout: path === 'market-decision' || path === 'portfolio-optimize' ? 45_000 : 15_000,
        maxContentLength: 4 * 1024 * 1024,
      });
      if (!data || typeof data !== 'object') {
        throw new BadGatewayException('Invalid response from AI revenue service.');
      }
      return data;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        throw new NotFoundException('Revenue resource not found.');
      }
      if (axios.isAxiosError(error) && error.response?.status === 422) {
        throw new BadRequestException('Revenue payload does not satisfy schema.');
      }
      throw new ServiceUnavailableException(
        'AI Revenue service tạm thời không khả dụng. Vui lòng kiểm tra AI service và thử lại.',
      );
    }
  }

  async getScenarios() {
    const baseData = await this.call('get', 'scenarios');
    try {
      const couponRows = await this.dataSource.query(
        `SELECT code, description_vi, discount_pct, max_discount_vnd, min_room_type_id,
                usage_limit, used_count, active, expiry_date::text
         FROM pricing_coupons
         ORDER BY discount_pct ASC, code ASC`,
      ) as Array<{
        code: string;
        description_vi: string;
        discount_pct: string | number;
        max_discount_vnd: string | number;
        min_room_type_id: number;
        usage_limit: number;
        used_count: number;
        active: boolean;
        expiry_date: string | null;
      }>;
      if (couponRows.length > 0) {
        return {
          ...baseData,
          coupons: couponRows.map((c) => ({
            code: c.code,
            description_vi: c.description_vi,
            discount_pct: Number(c.discount_pct),
            max_discount_vnd: Number(c.max_discount_vnd),
            min_room_type_id: Number(c.min_room_type_id),
            usage_limit: Number(c.usage_limit),
            used_count: Number(c.used_count),
            active: Boolean(c.active),
            expiry_date: c.expiry_date,
          })),
        };
      }
    } catch {
      // Fall back to AI service snapshot when DB table is unavailable (e.g. unit stub)
    }
    return baseData;
  }

  private getPredictUrl(): string {
    const configured = this.config.get<string>('AI_SERVICE_URL');
    if (configured) return configured.trim();
    return `${new URL(this.getBaseUrl()).origin}/api/v1/predict-price`;
  }

  private getBusinessDate(now = new Date()): string {
    const timeZone = this.config.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${value.year}-${value.month}-${value.day}`;
  }

  async getLiveContext(query: LiveContextQueryDto) {
    const checkIn = new Date(`${query.check_in_date}T00:00:00.000Z`);
    const checkOut = new Date(`${query.check_out_date}T00:00:00.000Z`);
    if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime()) || checkOut <= checkIn) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
    }

    const businessDate = this.getBusinessDate();
    const today = new Date(`${businessDate}T00:00:00.000Z`);
    const leadTime = Math.max(0, Math.floor((checkIn.getTime() - today.getTime()) / 86_400_000));

    const roomRows = await this.dataSource.query(
      `SELECT room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity,
              room_type.declared_max_price,
              setting.ai_enabled
       FROM room_types room_type
       LEFT JOIN pricing_settings setting ON setting.setting_id = 1
       WHERE room_type.type_id = $1`,
      [query.room_type_id],
    ) as Array<{
      type_id: number;
      type_name: string;
      base_price: string | number;
      capacity: number;
      declared_max_price: string | number | null;
      ai_enabled: boolean | null;
    }>;

    const roomType = roomRows[0];
    if (!roomType) {
      throw new NotFoundException(`Không tìm thấy loại phòng với ID: ${query.room_type_id}.`);
    }

    const guestCount = Math.min(Math.max(1, query.guest_count ?? 1), Number(roomType.capacity));

    // Read-only date-range inventory lookup (identical logic to PricingService, zero quote/audit writes).
    const availabilityRows = await this.dataSource.query(
      `WITH candidate_rooms AS (
         SELECT room.room_id,
                room.current_status <> 'Maintenance' AS is_sellable,
                (
                  $2::date > $4::date
                  OR (
                    room.current_status = 'Available'
                    AND room.occupancy_booking_id IS NULL
                    AND room.housekeeping_status = 'Ready'
                  )
                ) AS is_operationally_available
         FROM rooms room
         WHERE room.type_id = $1
       )
       SELECT COUNT(*) FILTER (WHERE candidate.is_sellable)::int AS rooms_sellable,
              COUNT(*) FILTER (
                WHERE candidate.is_sellable
                  AND candidate.is_operationally_available
                  AND NOT EXISTS (
                    SELECT 1
                    FROM booking_details detail
                    INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
                    WHERE detail.room_id = candidate.room_id
                      AND (booking.status IN ('Confirmed', 'CheckedIn')
                        OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp()))
                      AND booking.check_in_date < $3::date
                      AND booking.check_out_date > $2::date
                  )
              )::int AS rooms_available
       FROM candidate_rooms candidate`,
      [query.room_type_id, query.check_in_date, query.check_out_date, businessDate],
    ) as Array<{
      rooms_available: number | string;
      rooms_sellable: number | string;
    }>;

    const roomsAvailable = Number(availabilityRows[0]?.rooms_available ?? 0);
    const roomsSellable = Number(availabilityRows[0]?.rooms_sellable ?? 0);
    const roomsBooked = Math.max(roomsSellable - roomsAvailable, 0);
    const occupancyRatio = roomsSellable === 0
      ? 0
      : Math.round((roomsBooked / roomsSellable) * 1_000_000) / 1_000_000;

    let mlAvailable = false;
    let mlMultiplier = 1.0;
    let mlModelVersion: string | null = null;
    let mlTrainingRunId: string | null = null;
    let mlFeatureContractVersion: string | null = null;
    let mlUncertainty: Record<string, unknown> | null = null;
    let mlNote = 'Không kết nối được mô hình ML ADR; đang dùng hệ số 1.00 để giữ an toàn mô phỏng.';

    try {
      const { data: mlData } = await axios.post<{
        status?: string;
        ai_multiplier?: number;
        model_version?: string;
        training_run_id?: string;
        feature_contract_version?: string;
        uncertainty?: Record<string, unknown> | null;
      }>(
        this.getPredictUrl(),
        {
          lead_time: leadTime,
          check_in_date: query.check_in_date,
          check_out_date: query.check_out_date,
          guest_count: guestCount,
        },
        { timeout: 5_000 },
      );

      if (
        mlData?.status === 'success'
        && typeof mlData.ai_multiplier === 'number'
        && Number.isFinite(mlData.ai_multiplier)
        && mlData.ai_multiplier >= 0.5
        && mlData.ai_multiplier <= 3.0
      ) {
        mlAvailable = true;
        mlMultiplier = Number(mlData.ai_multiplier);
        mlModelVersion = typeof mlData.model_version === 'string' ? mlData.model_version : null;
        mlTrainingRunId = typeof mlData.training_run_id === 'string' ? mlData.training_run_id : null;
        mlFeatureContractVersion =
          typeof mlData.feature_contract_version === 'string' ? mlData.feature_contract_version : null;
        mlUncertainty = mlData.uncertainty && typeof mlData.uncertainty === 'object'
          ? mlData.uncertainty
          : null;
        mlNote = roomType.ai_enabled === false
          ? 'Công tắc AI Pricing ở checkout đang TẮT; hệ số ML chỉ hiển thị làm benchmark tham khảo.'
          : 'Hệ số ML ADR được tính trực tiếp từ mô hình Random Forest V2 (chỉ đọc, không ghi quote log).';
      }
    } catch {
      // Keep fail-open fallback for simulator preview when AI predict endpoint is temporarily unreachable.
    }

    return {
      room_type_id: Number(roomType.type_id),
      room_type_name: String(roomType.type_name),
      base_price: Number(roomType.base_price),
      declared_max_price: roomType.declared_max_price != null ? Number(roomType.declared_max_price) : null,
      capacity: Number(roomType.capacity),
      check_in_date: query.check_in_date,
      check_out_date: query.check_out_date,
      guest_count: guestCount,
      lead_time: leadTime,
      rooms_available: roomsAvailable,
      rooms_sellable: roomsSellable,
      rooms_booked: roomsBooked,
      occupancy_ratio: occupancyRatio,
      ai_enabled: roomType.ai_enabled !== false,
      ml_available: mlAvailable,
      ml_multiplier: mlMultiplier,
      ml_model_version: mlModelVersion,
      ml_training_run_id: mlTrainingRunId,
      ml_feature_contract_version: mlFeatureContractVersion,
      ml_uncertainty: mlUncertainty,
      ml_note: mlNote,
      business_date: businessDate,
      queried_at: new Date().toISOString(),
      provenance: {
        ml_multiplier: '(A) ML_REAL_DATA',
        inventory: '(B) SIMULATED_SYSTEM_STATE',
      },
    };
  }

  async evaluateQuote(dto: RevenueQuoteDto) {
    const outboundPayload: Record<string, unknown> = { ...dto };

    if (dto.declared_max_price == null) {
      try {
        const rows = await this.dataSource.query(
          `SELECT declared_max_price FROM room_types WHERE type_id = $1`,
          [dto.room_type_id],
        ) as Array<{ declared_max_price: string | number | null }>;
        if (rows[0]?.declared_max_price != null) {
          outboundPayload.declared_max_price = Number(rows[0].declared_max_price);
        }
      } catch {
        // Ignore fallback lookup errors in isolated stubs
      }
    }

    const cleanCoupon = dto.coupon_code?.trim().toUpperCase() ?? '';
    if (cleanCoupon.length > 0) {
      try {
        const couponRows = await this.dataSource.query(
          `SELECT code, description_vi, discount_pct, max_discount_vnd, min_room_type_id,
                  usage_limit, used_count, active, expiry_date::text
           FROM pricing_coupons
           WHERE code = $1`,
          [cleanCoupon],
        ) as Array<{
          code: string;
          description_vi: string;
          discount_pct: string | number;
          max_discount_vnd: string | number;
          min_room_type_id: number;
          usage_limit: number;
          used_count: number;
          active: boolean;
          expiry_date: string | null;
        }>;
        outboundPayload.coupon_lookup_performed = true;
        outboundPayload.coupon_rule = couponRows[0]
          ? {
              code: couponRows[0].code,
              description_vi: couponRows[0].description_vi,
              discount_pct: Number(couponRows[0].discount_pct),
              max_discount_vnd: Number(couponRows[0].max_discount_vnd),
              min_room_type_id: Number(couponRows[0].min_room_type_id),
              usage_limit: Number(couponRows[0].usage_limit),
              used_count: Number(couponRows[0].used_count),
              active: Boolean(couponRows[0].active),
              expiry_date: couponRows[0].expiry_date,
              provenance: 'BUSINESS_RULE',
            }
          : null;
      } catch {
        // Ignore DB lookup fallback errors in isolated unit stubs without PostgreSQL
      }
    }

    return this.call('post', 'decision', outboundPayload);
  }

  async optimizeAllocation(dto: OptimizeAllocationDto) {
    return this.call('post', 'optimize-allocation', dto);
  }

  async optimizeAllocationLive(dto: OptimizeLiveAllocationDto) {
    const roomRows = await this.dataSource.query(
      `SELECT room.room_id,
              room.room_number,
              room.type_id,
              room_type.capacity,
              room_type.base_price,
              room.current_status,
              room.housekeeping_status
       FROM rooms room
       INNER JOIN room_types room_type ON room_type.type_id = room.type_id
       ORDER BY room.type_id ASC, room.room_number ASC`,
    ) as Array<{
      room_id: number;
      room_number: string;
      type_id: number;
      capacity: number;
      base_price: string | number;
      current_status: string;
      housekeeping_status: string;
    }>;

    const basePriceByType = new Map<number, number>();
    const availableRooms = roomRows.map((r) => {
      const basePrice = Number(r.base_price);
      basePriceByType.set(Number(r.type_id), basePrice);
      return {
        room_id: Number(r.room_id),
        room_number: String(r.room_number),
        type_id: Number(r.type_id),
        capacity: Number(r.capacity),
        current_status: String(r.current_status),
        housekeeping_status: String(r.housekeeping_status),
        base_price: basePrice,
      };
    });

    const enrichedRequests = dto.requests.map((req) => ({
      ...req,
      requested_base_price:
        req.requested_base_price ?? basePriceByType.get(Number(req.room_type_id)) ?? 0,
    }));

    const checkIns = dto.requests.map((req) => req.check_in_date);
    const checkOuts = dto.requests.map((req) => req.check_out_date);
    if (dto.check_in_date) checkIns.push(dto.check_in_date);
    if (dto.check_out_date) checkOuts.push(dto.check_out_date);

    const minCheckIn = checkIns.length > 0 ? checkIns.reduce((a, b) => (a < b ? a : b)) : new Date().toISOString().slice(0, 10);
    const maxCheckOut = checkOuts.length > 0
      ? checkOuts.reduce((a, b) => (a > b ? a : b))
      : new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);

    const occupancyRows = await this.dataSource.query(
      `SELECT detail.room_id,
              booking.check_in_date::text AS check_in_date,
              booking.check_out_date::text AS check_out_date,
              booking.booking_id::text AS booking_id
       FROM booking_details detail
       INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
       WHERE (booking.status IN ('Confirmed', 'CheckedIn')
         OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp()))
         AND booking.check_in_date < $2::date
         AND booking.check_out_date > $1::date
       ORDER BY booking.check_in_date ASC`,
      [minCheckIn, maxCheckOut],
    ) as Array<{
      room_id: number;
      check_in_date: string;
      check_out_date: string;
      booking_id: string;
    }>;

    const existingOccupancies = occupancyRows.map((occ) => ({
      room_id: Number(occ.room_id),
      check_in_date: String(occ.check_in_date),
      check_out_date: String(occ.check_out_date),
      booking_id: String(occ.booking_id),
    }));

    const solverResult = await this.call('post', 'optimize-allocation', {
      requests: enrichedRequests,
      available_rooms: availableRooms,
      existing_occupancies: existingOccupancies,
      allow_upgrades: Boolean(dto.allow_upgrades),
    });

    const maintenanceRooms = availableRooms.filter((r) => r.current_status === 'Maintenance').length;
    return {
      ...solverResult,
      live_snapshot: {
        total_rooms: availableRooms.length,
        sellable_rooms: availableRooms.length - maintenanceRooms,
        maintenance_rooms: maintenanceRooms,
        existing_occupancy_count: existingOccupancies.length,
        window_start: minCheckIn,
        window_end: maxCheckOut,
        queried_at: new Date().toISOString(),
        provenance: '(B) SIMULATED_SYSTEM_STATE + (D) BUSINESS_RULE (Google OR-Tools CP-SAT)',
      },
    };
  }

  async getSandboxScenarios() {
    return this.call('get', 'sandbox/scenarios');
  }

  async runSandboxScenario(dto: ScenarioRunDto) {
    return this.call('post', 'sandbox/run', dto);
  }

  async marketDecision(dto: MarketPricingDto) {
    return this.call('post', 'market-decision', dto);
  }

  async optimizePortfolio(dto: PortfolioOptimizeDto) {
    const now = new Date();
    const businessDate = this.getBusinessDate(now);
    const startDate = dto.start_date ?? businessDate;
    if (startDate < businessDate) {
      throw new BadRequestException(
        `Ngày bắt đầu tối ưu danh mục (${startDate}) không được trước ngày kinh doanh hiện tại (${businessDate}).`,
      );
    }
    const horizonDays = dto.horizon_days ?? 5;

    const rows = (await this.dataSource.query(PORTFOLIO_DAILY_INVENTORY_SQL, [
      startDate,
      horizonDays,
      businessDate,
      now.toISOString(),
    ])) as Array<{
      stay_date: string;
      type_id: number;
      type_name: string;
      base_price: string | number;
      declared_max_price: string | number | null;
      sellable_rooms: number;
      confirmed_rooms: number;
      held_rooms: number;
      available_rooms: number;
    }>;

    if (rows.length === 0) {
      throw new NotFoundException('Không tìm thấy dữ liệu hạng phòng để tối ưu danh mục.');
    }

    const tiersById = new Map<
      number,
      {
        type_id: number;
        type_name: string;
        base_price: number;
        declared_max_price: number;
        sellable_rooms: number;
        nightly_available: number[];
        nightly_booked: number[];
      }
    >();

    for (const row of rows) {
      const typeId = Number(row.type_id);
      const basePrice = Number(row.base_price);
      const declaredMax =
        row.declared_max_price != null ? Number(row.declared_max_price) : Math.round(basePrice * 1.4);
      let entry = tiersById.get(typeId);
      if (!entry) {
        entry = {
          type_id: typeId,
          type_name: String(row.type_name),
          base_price: basePrice,
          declared_max_price: declaredMax,
          sellable_rooms: Number(row.sellable_rooms),
          nightly_available: [],
          nightly_booked: [],
        };
        tiersById.set(typeId, entry);
      }
      entry.nightly_available.push(Number(row.available_rooms));
      entry.nightly_booked.push(Number(row.confirmed_rooms) + Number(row.held_rooms));
    }

    const tiers = Array.from(tiersById.values());
    const optimizerResult = await this.call('post', 'portfolio-optimize', {
      start_date: startDate,
      horizon_days: horizonDays,
      scenario_id: dto.scenario_id ?? 'standard',
      price_elasticity: dto.price_elasticity ?? 1.15,
      allow_cross_tier_upgrades: dto.allow_cross_tier_upgrades ?? true,
      serving_cost_per_night: dto.serving_cost_per_night ?? 350_000,
      channel_commission_pct: dto.channel_commission_pct ?? 0,
      tax_rate: dto.tax_rate ?? 0.08,
      service_charge_rate: dto.service_charge_rate ?? 0.05,
      min_contribution_margin: dto.min_contribution_margin ?? 50_000,
      tiers,
    });

    const totalSellableRooms = tiers.reduce((acc, tier) => acc + tier.sellable_rooms, 0);
    return {
      ...optimizerResult,
      live_snapshot: {
        tier_count: tiers.length,
        total_sellable_rooms: totalSellableRooms,
        business_date: businessDate,
        queried_at: now.toISOString(),
        provenance: '(B) SIMULATED_SYSTEM_STATE + (D) OR-Tools CP-SAT Joint Yield Optimizer',
      },
    };
  }

  async simulateBanditBenchmark(dto: BanditSimulateDto) {
    const roomRows = (await this.dataSource.query(
      `SELECT type_id, name, base_price, declared_max_price
       FROM room_types
       ORDER BY base_price ASC, type_id ASC`,
    )) as Array<{
      type_id: number;
      name: string;
      base_price: string | number;
      declared_max_price: string | number | null;
    }>;

    if (roomRows.length === 0) {
      throw new NotFoundException('Không tìm thấy danh mục hạng phòng để mô phỏng Bandit.');
    }

    const requestedTypeId = dto.room_type_id ?? Number(roomRows[0].type_id);
    const chosenRoom = roomRows.find((r) => Number(r.type_id) === requestedTypeId);
    if (!chosenRoom) {
      throw new NotFoundException(`Không tìm thấy hạng phòng ID=${requestedTypeId}.`);
    }

    const basePrice = Number(chosenRoom.base_price);
    const declaredMax =
      chosenRoom.declared_max_price != null
        ? Number(chosenRoom.declared_max_price)
        : Math.round(basePrice * 1.4);

    const banditResult = await this.call('post', 'bandit-simulate', {
      room_type_id: Number(chosenRoom.type_id),
      room_type_name: String(chosenRoom.name),
      base_price: basePrice,
      declared_max_price: declaredMax,
      serving_cost_per_night: dto.serving_cost_per_night ?? 350_000,
      channel_commission_pct: dto.channel_commission_pct ?? 0,
      tax_rate: dto.tax_rate ?? 0.08,
      service_charge_rate: dto.service_charge_rate ?? 0.05,
      min_contribution_margin: dto.min_contribution_margin ?? 50_000,
      scenario_id: dto.scenario_id ?? 'standard',
      true_price_elasticity: dto.true_price_elasticity ?? 1.25,
      episodes: dto.episodes ?? 300,
      seed: dto.seed ?? 42,
      live_room_type_names: roomRows.map((r) => String(r.name)),
    });

    return {
      ...banditResult,
      live_catalog: roomRows.map((r) => ({
        type_id: Number(r.type_id),
        name: String(r.name),
        base_price: Number(r.base_price),
      })),
    };
  }
}
