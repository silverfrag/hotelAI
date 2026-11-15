import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { DataSource, EntityManager } from 'typeorm';
import { PriceQuoteDto } from './dto/price-quote.dto';
import { RecordQuoteEventDto } from './dto/record-quote-event.dto';
import { CalendarQueryDto } from './dto/calendar-query.dto';
import { AiShadowService } from './ai-shadow.service';

type AiPricingResponse = {
  status: string;
  ai_multiplier: number;
  model_version: string;
  training_run_id: string;
  feature_contract_version: string;
  features: {
    lead_time: number;
    arrival_month_sin: number;
    arrival_month_cos: number;
    arrival_weekday_sin: number;
    arrival_weekday_cos: number;
    stay_nights: number;
    weekend_nights: number;
    weekend_share: number;
    guest_count: number;
  };
};

type AiPricingResult = {
  multiplier: number;
  isWeekend: boolean;
  modelVersion: string;
  trainingRunId: string;
  featureContractVersion: string;
};

// V3 demand signals are experimental and have not passed the release evaluation.
const SUPPORTED_AI_FEATURE_CONTRACT_VERSIONS = new Set(['2.0.0']);

// Default serving cost (350,000) + minimum margin (50,000) * (1 + 8% VAT + 5% service charge) = 452,000 VND.
const MIN_CONTRIBUTION_FLOOR_VND = 452_000;

// Verified 2026 Vietnam public holidays (mirrors 2_ai_pricing_service/app/core/vietnam_calendar.py).
const VIETNAM_PUBLIC_HOLIDAYS_2026: ReadonlyArray<{ start: string; end: string; name: string }> = [
  { start: '2026-01-01', end: '2026-01-01', name: 'Tết Dương lịch' },
  { start: '2026-02-16', end: '2026-02-20', name: 'Tết Nguyên Đán' },
  { start: '2026-04-26', end: '2026-04-26', name: 'Giỗ Tổ Hùng Vương' },
  { start: '2026-04-30', end: '2026-04-30', name: 'Ngày Chiến thắng 30/4' },
  { start: '2026-05-01', end: '2026-05-01', name: 'Quốc tế Lao động 1/5' },
  { start: '2026-09-01', end: '2026-09-02', name: 'Quốc khánh 2/9' },
  { start: '2026-11-24', end: '2026-11-24', name: 'Ngày Văn hóa Việt Nam' },
];

type AiFeatureV2 = AiPricingResponse['features'];

function stayNightCount(checkIn: Date, checkOut: Date): number {
  return Math.floor((checkOut.getTime() - checkIn.getTime()) / 86_400_000);
}

export function countWeekendNights(checkIn: Date, checkOut: Date): number {
  const nights = stayNightCount(checkIn, checkOut);
  if (nights <= 0) return 0;
  const completeWeeks = Math.floor(nights / 7);
  const remainingNights = nights % 7;
  let weekendNights = completeWeeks * 2;
  for (let offset = 0; offset < remainingNights; offset += 1) {
    const weekday = new Date(checkIn.getTime() + offset * 86_400_000).getUTCDay();
    if (weekday === 0 || weekday === 6) weekendNights += 1;
  }
  return weekendNights;
}

function cyclicComponents(position: number, period: number): [number, number] {
  const angle = 2 * Math.PI * position / period;
  return [Number(Math.sin(angle).toFixed(10)), Number(Math.cos(angle).toFixed(10))];
}

export function buildAiFeatureV2(
  checkIn: Date,
  checkOut: Date,
  leadTime: number,
  guestCount: number,
): AiFeatureV2 {
  const nights = stayNightCount(checkIn, checkOut);
  const weekendNights = countWeekendNights(checkIn, checkOut);
  const pythonWeekday = (checkIn.getUTCDay() + 6) % 7;
  const [monthSin, monthCos] = cyclicComponents(checkIn.getUTCMonth(), 12);
  const [weekdaySin, weekdayCos] = cyclicComponents(pythonWeekday, 7);
  return {
    lead_time: leadTime,
    arrival_month_sin: monthSin,
    arrival_month_cos: monthCos,
    arrival_weekday_sin: weekdaySin,
    arrival_weekday_cos: weekdayCos,
    stay_nights: nights,
    weekend_nights: weekendNights,
    weekend_share: Number((weekendNights / nights).toFixed(10)),
    guest_count: guestCount,
  };
}

function featureNumberMatches(actual: number, expected: number): boolean {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 1e-9;
}

export function stayIncludesWeekendNight(checkIn: Date, checkOut: Date): boolean {
  return countWeekendNights(checkIn, checkOut) > 0;
}

export type PublicCoupon = {
  code: string;
  description_vi: string;
  discount_pct: number;
  max_discount_vnd: number;
  min_room_type_id: number;
  usage_limit: number;
  used_count: number;
  active: boolean;
  expiry_date: string | null;
};

export type PricingFactorItem = {
  factor_name: string;
  source_category: '(A) ML_REAL_DATA' | '(B) SIMULATED_SYSTEM_STATE' | '(C) SIMULATED_ASSUMPTION' | '(D) BUSINESS_RULE';
  impact_pct: number;
  impact_vnd: number;
  description_vi: string;
};

export type PricingBreakdown = {
  base_price: number;
  ml_reference_price: number;
  pre_coupon_nightly_price: number;
  pre_coupon_total_price: number;
  declared_max_price: number | null;
  is_ceiling_clamped: boolean;
  coupon_code: string | null;
  coupon_description_vi: string | null;
  coupon_discount_per_night_vnd: number;
  coupon_discount_total_vnd: number;
  is_floor_price_clamped: boolean;
  floor_price_vnd: number;
  factors: PricingFactorItem[];
};

type RoomAvailabilitySnapshot = {
  roomsAvailable: number;
  roomsSellable: number;
  roomsBooked: number;
  occupancyRatio: number;
};

type PricingSnapshotRow = {
  type_id: number;
  type_name: string;
  base_price: string | number;
  capacity: number;
  declared_max_price: string | number | null;
  ai_enabled: boolean | null;
  settings_version: number | null;
};

type CouponRow = {
  code: string;
  description_vi: string;
  discount_pct: string | number;
  max_discount_vnd: string | number;
  min_room_type_id: number | string;
  usage_limit: number | string;
  used_count: number | string;
  active: boolean;
  expiry_date: string | null;
};

type StoredQuoteRow = {
  quote_id: string;
  booking_id: string | null;
  room_type_id: number | string;
  room_type_name_snapshot: string;
  capacity_snapshot: number | string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number | string;
  total_of_special_requests: number | string;
  lead_time: number | string;
  is_weekend: boolean;
  base_price: number | string;
  ai_multiplier: number | string;
  nightly_price: number | string;
  total_price: number | string;
  coupon_code: string | null;
  coupon_discount_vnd: number | string | null;
  pre_coupon_total_price: number | string | null;
  is_floor_price_clamped: boolean | null;
  pricing_breakdown: PricingBreakdown | null;
  pricing_source: 'ai' | 'base';
  settings_version: number | string;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  created_at: Date | string;
  expires_at: Date | string;
  is_expired: boolean;
  is_rejected: boolean;
  has_confirmed_exposure: boolean;
};

export type PricingCalculation = {
  roomType: {
    type_id: number;
    type_name: string;
    base_price: number;
    capacity: number;
    declared_max_price?: number | null;
  };
  checkIn: Date;
  checkOut: Date;
  leadTime: number;
  nights: number;
  multiplier: number;
  isWeekend: boolean;
  aiModelVersion: string | null;
  aiTrainingRunId: string | null;
  aiFeatureContractVersion: string | null;
  nightlyPrice: number;
  totalPrice: number;
  source: 'ai' | 'base';
  settingsVersion: number;
  aiEnabled: boolean;
  couponCode: string | null;
  couponDiscountVnd: number;
  preCouponTotalPrice: number;
  isFloorPriceClamped: boolean;
  pricingBreakdown: PricingBreakdown | null;
  availability?: RoomAvailabilitySnapshot;
};

export type PriceQuote = {
  quote_id: string;
  room_type: PricingCalculation['roomType'];
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  nights: number;
  rooms_available: number;
  rooms_sellable: number;
  rooms_booked: number;
  occupancy_ratio: number;
  inventory_snapshot_at: string;
  ai_multiplier: number;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  pricing_source: 'ai' | 'base';
  settings_version: number;
  nightly_price: number;
  total_price: number;
  coupon_code: string | null;
  coupon_discount_vnd: number;
  pre_coupon_total_price: number;
  is_floor_price_clamped: boolean;
  pricing_breakdown: PricingBreakdown | null;
  currency: 'VND';
  is_estimate: true;
  availability_is_guaranteed: false;
  created_at: string;
  expires_at: string;
  price_guaranteed_until: string;
};

type StoredQuoteEventRow = {
  quote_event_id: string;
  quote_id: string;
  event_type: 'quote.exposed.v1' | 'quote.rejected.v1';
  occurred_at: Date | string;
  session_id: string | null;
  search_id: string | null;
};

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly aiShadow: AiShadowService,
  ) {}

  async getActiveCoupons(): Promise<PublicCoupon[]> {
    const businessDate = this.getBusinessDate();
    const rows = await this.dataSource.query(
      `SELECT code,
              description_vi,
              discount_pct,
              max_discount_vnd,
              min_room_type_id,
              usage_limit,
              used_count,
              active,
              expiry_date::text
       FROM pricing_coupons
       WHERE active = TRUE
         AND used_count < usage_limit
         AND (expiry_date IS NULL OR expiry_date >= $1::date)
       ORDER BY min_room_type_id ASC, discount_pct ASC, code ASC`,
      [businessDate],
    ) as CouponRow[];

    return rows.map((row) => ({
      code: row.code,
      description_vi: row.description_vi,
      discount_pct: Number(row.discount_pct),
      max_discount_vnd: Number(row.max_discount_vnd),
      min_room_type_id: Number(row.min_room_type_id),
      usage_limit: Number(row.usage_limit),
      used_count: Number(row.used_count),
      active: Boolean(row.active),
      expiry_date: row.expiry_date,
    }));
  }

  async getCalendarPricing(input: CalendarQueryDto): Promise<Array<{
    date: string;
    nightly_price: number;
    available: number;
  }>> {
    const businessDate = this.getBusinessDate();
    const today = new Date(`${businessDate}T00:00:00.000Z`);
    const start = new Date(`${input.start_date}T00:00:00.000Z`);
    const end = new Date(`${input.end_date}T00:00:00.000Z`);

    if (end < start) {
      throw new BadRequestException('Ngày kết thúc phải sau hoặc bằng ngày bắt đầu.');
    }

    const rows = await this.dataSource.query(
      `SELECT room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity,
              room_type.declared_max_price,
              setting.ai_enabled,
              setting.version AS settings_version
       FROM room_types room_type
       LEFT JOIN pricing_settings setting ON setting.setting_id = 1
       WHERE room_type.type_id = $1`,
      [input.room_type_id],
    ) as PricingSnapshotRow[];
    const row = rows[0];

    if (!row) {
      throw new NotFoundException(`Không tìm thấy loại phòng với ID: ${input.room_type_id}.`);
    }

    const sellableRows = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE current_status <> 'Maintenance')::int AS rooms_sellable
       FROM rooms
       WHERE type_id = $1`,
      [input.room_type_id],
    ) as Array<{ rooms_sellable: number | string }>;
    const roomsSellable = Number(sellableRows[0]?.rooms_sellable ?? 0);

    const availabilityRows = await this.dataSource.query(
      `WITH RECURSIVE dates AS (
         SELECT $2::date AS date
         UNION ALL
         SELECT (date + INTERVAL '1 day')::date
         FROM dates
         WHERE date < $3::date
       ),
       candidate_rooms AS (
         SELECT room.room_id,
                room.current_status <> 'Maintenance' AS is_sellable,
                room.current_status = 'Available'
                  AND room.occupancy_booking_id IS NULL
                  AND room.housekeeping_status = 'Ready' AS is_operationally_available
         FROM rooms room
         WHERE room.type_id = $1
       )
       SELECT d.date::text,
              (
                SELECT COUNT(*)::int
                FROM candidate_rooms candidate
                WHERE candidate.is_sellable
                  AND (d.date > $4::date OR candidate.is_operationally_available)
                  AND NOT EXISTS (
                    SELECT 1
                    FROM booking_details detail
                    INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
                    WHERE detail.room_id = candidate.room_id
                      AND (booking.status IN ('Confirmed', 'CheckedIn')
                        OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp()))
                      AND booking.check_in_date <= d.date
                      AND booking.check_out_date > d.date
                  )
              ) AS rooms_available
       FROM dates d
       ORDER BY d.date ASC`,
      [input.room_type_id, input.start_date, input.end_date, businessDate],
    ) as Array<{ date: string; rooms_available: number | string }>;

    const availabilityMap = new Map<string, number>();
    for (const r of availabilityRows) {
      availabilityMap.set(r.date, Number(r.rooms_available));
    }

    const aiEnabled = Boolean(row.ai_enabled);
    const basePrice = Number(row.base_price);
    const declaredMaxPrice = row.declared_max_price != null ? Number(row.declared_max_price) : null;
    const results = [];

    const predictionPromises = [];
    const dateStrs = [];

    for (let d = new Date(start); d <= end; d.setTime(d.getTime() + 86400000)) {
      const dateStr = d.toISOString().slice(0, 10);
      const leadTime = Math.floor((d.getTime() - today.getTime()) / 86400000);
      dateStrs.push(dateStr);

      if (aiEnabled && d >= today) {
        predictionPromises.push(
          this.getAiPrediction({
            check_in_date: dateStr,
            check_out_date: new Date(d.getTime() + 86400000).toISOString().slice(0, 10),
            lead_time: leadTime,
            guest_count: 1,
          }).catch(() => null),
        );
      } else {
        predictionPromises.push(Promise.resolve(null));
      }
    }

    const predictions = await Promise.all(predictionPromises);

    for (let i = 0; i < dateStrs.length; i++) {
      const dateStr = dateStrs[i];
      const available = availabilityMap.get(dateStr) ?? 0;
      const aiPrediction = predictions[i];
      let nightlyPrice = Math.round(basePrice * 100) / 100;

      if (aiEnabled) {
        const dayIn = new Date(`${dateStr}T00:00:00.000Z`);
        const dayOut = new Date(dayIn.getTime() + 86_400_000);
        const contextual = this.applyContextualRules({
          basePrice,
          declaredMaxPrice,
          nights: 1,
          checkIn: dayIn,
          checkOut: dayOut,
          guestCount: 1,
          roomsAvailable: available,
          roomsSellable,
          mlMultiplier: aiPrediction?.multiplier ?? 1,
          aiEnabled: true,
          coupon: null,
        });
        nightlyPrice = contextual.nightlyPrice;
      }

      results.push({
        date: dateStr,
        nightly_price: nightlyPrice,
        available,
      });
    }

    return results;
  }

  async calculate(
    input: PriceQuoteDto,
    options?: {
      requireAvailability?: boolean;
      manager?: EntityManager;
    },
  ): Promise<PricingCalculation> {
    const businessDate = this.getBusinessDate();
    const today = new Date(`${businessDate}T00:00:00.000Z`);
    const checkIn = new Date(`${input.check_in_date}T00:00:00.000Z`);
    const checkOut = new Date(`${input.check_out_date}T00:00:00.000Z`);

    if (checkIn < today) {
      throw new BadRequestException('Ngày nhận phòng không được nằm trong quá khứ.');
    }
    if (checkOut <= checkIn) {
      throw new BadRequestException('Ngày trả phòng phải sau ngày nhận phòng.');
    }

    const queryRunner = options?.manager ?? this.dataSource;

    // Room price and the pricing switch are read in the same PostgreSQL
    // statement, so every quote/audit is based on one consistent snapshot.
    const rows = await queryRunner.query(
      `SELECT room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity,
              room_type.declared_max_price,
              setting.ai_enabled,
              setting.version AS settings_version
       FROM room_types room_type
       LEFT JOIN pricing_settings setting ON setting.setting_id = 1
       WHERE room_type.type_id = $1`,
      [input.room_type_id],
    ) as PricingSnapshotRow[];
    const row = rows[0];

    if (!row) {
      throw new NotFoundException(`Không tìm thấy loại phòng với ID: ${input.room_type_id}.`);
    }
    if (row.ai_enabled === null || row.settings_version === null) {
      throw new InternalServerErrorException('Thiếu cấu hình định giá mặc định.');
    }

    const leadTime = Math.floor((checkIn.getTime() - today.getTime()) / 86_400_000);
    const nights = stayNightCount(checkIn, checkOut);
    const guestCount = input.guest_count ?? 1;
    if (guestCount > Number(row.capacity)) {
      throw new BadRequestException(
        `Loại phòng đã chọn chỉ chứa tối đa ${Number(row.capacity)} khách.`,
      );
    }

    const cleanCoupon = input.coupon_code ? input.coupon_code.trim().toUpperCase() : '';
    let validatedCoupon: PublicCoupon | null = null;
    if (cleanCoupon.length > 0) {
      const couponRows = await queryRunner.query(
        `SELECT code,
                description_vi,
                discount_pct,
                max_discount_vnd,
                min_room_type_id,
                usage_limit,
                used_count,
                active,
                expiry_date::text
         FROM pricing_coupons
         WHERE code = $1`,
        [cleanCoupon],
      ) as CouponRow[];
      const coupon = couponRows[0];
      if (!coupon) {
        throw new BadRequestException(`Mã giảm giá '${cleanCoupon}' không tồn tại hoặc không hợp lệ.`);
      }
      if (!coupon.active || (coupon.expiry_date && coupon.expiry_date < businessDate)) {
        throw new BadRequestException(`Mã giảm giá '${cleanCoupon}' đã hết hạn hoặc tạm ngừng áp dụng.`);
      }
      if (Number(coupon.used_count) >= Number(coupon.usage_limit)) {
        throw new ConflictException(`Mã giảm giá '${cleanCoupon}' đã hết lượt sử dụng.`);
      }
      if (Number(row.type_id) < Number(coupon.min_room_type_id)) {
        throw new BadRequestException(
          `Mã giảm giá '${cleanCoupon}' chỉ áp dụng cho hạng phòng cao cấp hơn (từ loại ${coupon.min_room_type_id}).`,
        );
      }
      validatedCoupon = {
        code: coupon.code,
        description_vi: coupon.description_vi,
        discount_pct: Number(coupon.discount_pct),
        max_discount_vnd: Number(coupon.max_discount_vnd),
        min_room_type_id: Number(coupon.min_room_type_id),
        usage_limit: Number(coupon.usage_limit),
        used_count: Number(coupon.used_count),
        active: Boolean(coupon.active),
        expiry_date: coupon.expiry_date,
      };
    }

    const aiEnabled = Boolean(row.ai_enabled);
    const basePrice = Number(row.base_price);
    const declaredMaxPrice = row.declared_max_price != null ? Number(row.declared_max_price) : null;

    // Preserve pure unmodified fallback when AI is switched off and no coupon is requested.
    if (!aiEnabled && !validatedCoupon) {
      const availability = options?.requireAvailability
        ? await this.queryRoomAvailability(input.room_type_id, input.check_in_date, input.check_out_date, businessDate, options.manager)
        : undefined;
      const nightlyPrice = Math.round(basePrice * 100) / 100;
      const totalPrice = Math.round(nightlyPrice * nights * 100) / 100;
      return {
        roomType: {
          type_id: Number(row.type_id),
          type_name: row.type_name,
          base_price: basePrice,
          capacity: Number(row.capacity),
          declared_max_price: declaredMaxPrice,
        },
        checkIn,
        checkOut,
        leadTime,
        nights,
        multiplier: 1,
        isWeekend: stayIncludesWeekendNight(checkIn, checkOut),
        aiModelVersion: null,
        aiTrainingRunId: null,
        aiFeatureContractVersion: null,
        nightlyPrice,
        totalPrice,
        source: 'base',
        settingsVersion: Number(row.settings_version),
        aiEnabled: false,
        couponCode: null,
        couponDiscountVnd: 0,
        preCouponTotalPrice: totalPrice,
        isFloorPriceClamped: false,
        pricingBreakdown: null,
        availability,
      };
    }

    const aiPrediction = aiEnabled
      ? await this.getAiPrediction({
          check_in_date: input.check_in_date,
          check_out_date: input.check_out_date,
          lead_time: leadTime,
          guest_count: guestCount,
        })
      : null;

    const availability = await this.queryRoomAvailability(
      input.room_type_id,
      input.check_in_date,
      input.check_out_date,
      businessDate,
      options?.manager,
    );

    const contextual = this.applyContextualRules({
      basePrice,
      declaredMaxPrice,
      nights,
      checkIn,
      checkOut,
      guestCount,
      roomsAvailable: availability.roomsAvailable,
      roomsSellable: availability.roomsSellable,
      mlMultiplier: aiPrediction?.multiplier ?? 1,
      aiEnabled: Boolean(aiPrediction),
      coupon: validatedCoupon,
    });

    const mlMultiplier = aiPrediction?.multiplier ?? 1;

    return {
      roomType: {
        type_id: Number(row.type_id),
        type_name: row.type_name,
        base_price: basePrice,
        capacity: Number(row.capacity),
        declared_max_price: declaredMaxPrice,
      },
      checkIn,
      checkOut,
      leadTime,
      nights,
      multiplier: mlMultiplier,
      isWeekend: aiPrediction?.isWeekend ?? stayIncludesWeekendNight(checkIn, checkOut),
      aiModelVersion: aiPrediction?.modelVersion ?? null,
      aiTrainingRunId: aiPrediction?.trainingRunId ?? null,
      aiFeatureContractVersion: aiPrediction?.featureContractVersion ?? null,
      nightlyPrice: contextual.nightlyPrice,
      totalPrice: contextual.totalPrice,
      source: aiPrediction ? 'ai' : 'base',
      settingsVersion: Number(row.settings_version),
      aiEnabled: Boolean(aiPrediction),
      couponCode: validatedCoupon?.code ?? null,
      couponDiscountVnd: contextual.couponDiscountTotalVnd,
      preCouponTotalPrice: contextual.preCouponTotalPrice,
      isFloorPriceClamped: contextual.isFloorClamped,
      pricingBreakdown: contextual.breakdown,
      availability,
    };
  }

  async quote(input: PriceQuoteDto): Promise<PriceQuote> {
    const calculation = await this.calculate(input, { requireAvailability: true });
    const guestCount = input.guest_count ?? 1;
    const availability = calculation.availability!;
    const roomsAvailable = availability.roomsAvailable;
    const roomsSellable = availability.roomsSellable;
    const roomsBooked = availability.roomsBooked;
    const occupancyRatio = availability.occupancyRatio;

    const quoteRows = await this.dataSource.query(
      `INSERT INTO pricing_quotes (
         room_type_id,
         room_type_name_snapshot,
         capacity_snapshot,
         check_in_date,
         check_out_date,
         guest_count,
         total_of_special_requests,
         lead_time,
         is_weekend,
         rooms_available,
         rooms_sellable_snapshot,
         rooms_booked_snapshot,
         occupancy_ratio_snapshot,
         inventory_snapshot_at,
         base_price,
         ai_multiplier,
         nightly_price,
         total_price,
         coupon_code,
         coupon_discount_vnd,
         pre_coupon_total_price,
         is_floor_price_clamped,
         pricing_breakdown,
         pricing_source,
         settings_version,
         ai_model_version,
         ai_training_run_id,
         ai_feature_contract_version,
         expires_at
       ) VALUES (
         $1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10,
         $11, $12, $13, CURRENT_TIMESTAMP,
         $14, $15, $16, $17, $18, $19, $20, $21, $22::jsonb,
         $23, $24, $25, $26, $27,
         CURRENT_TIMESTAMP + ($28::int * INTERVAL '1 second')
       )
       RETURNING quote_id,
                 created_at,
                 expires_at,
                 rooms_sellable_snapshot,
                 rooms_booked_snapshot,
                 occupancy_ratio_snapshot,
                 inventory_snapshot_at`,
      [
        calculation.roomType.type_id,
        calculation.roomType.type_name,
        calculation.roomType.capacity,
        input.check_in_date,
        input.check_out_date,
        guestCount,
        input.total_of_special_requests,
        calculation.leadTime,
        calculation.isWeekend,
        roomsAvailable,
        roomsSellable,
        roomsBooked,
        occupancyRatio,
        calculation.roomType.base_price,
        calculation.multiplier,
        calculation.nightlyPrice,
        calculation.totalPrice,
        calculation.couponCode,
        calculation.couponDiscountVnd,
        calculation.preCouponTotalPrice,
        calculation.isFloorPriceClamped,
        calculation.pricingBreakdown ? JSON.stringify(calculation.pricingBreakdown) : null,
        calculation.source,
        calculation.settingsVersion,
        calculation.aiModelVersion,
        calculation.aiTrainingRunId,
        calculation.aiFeatureContractVersion,
        this.getQuoteTtlSeconds(),
      ],
    ) as Array<{
      quote_id: string;
      created_at: Date | string;
      expires_at: Date | string;
      rooms_sellable_snapshot: number | string;
      rooms_booked_snapshot: number | string;
      occupancy_ratio_snapshot: number | string;
      inventory_snapshot_at: Date | string;
    }>;
    const storedQuote = quoteRows[0];
    if (!storedQuote) {
      throw new InternalServerErrorException('Không thể lưu dấu vết báo giá AI.');
    }
    const createdAt = new Date(storedQuote.created_at).toISOString();
    const expiresAt = new Date(storedQuote.expires_at).toISOString();

    const quote: PriceQuote = {
      quote_id: storedQuote.quote_id,
      room_type: calculation.roomType,
      check_in_date: input.check_in_date,
      check_out_date: input.check_out_date,
      guest_count: guestCount,
      nights: calculation.nights,
      rooms_available: roomsAvailable,
      rooms_sellable: Number(storedQuote.rooms_sellable_snapshot),
      rooms_booked: Number(storedQuote.rooms_booked_snapshot),
      occupancy_ratio: Number(storedQuote.occupancy_ratio_snapshot),
      inventory_snapshot_at: new Date(storedQuote.inventory_snapshot_at).toISOString(),
      ai_multiplier: calculation.multiplier,
      ai_model_version: calculation.aiModelVersion,
      ai_training_run_id: calculation.aiTrainingRunId,
      ai_feature_contract_version: calculation.aiFeatureContractVersion,
      pricing_source: calculation.source,
      settings_version: calculation.settingsVersion,
      nightly_price: calculation.nightlyPrice,
      total_price: calculation.totalPrice,
      coupon_code: calculation.couponCode,
      coupon_discount_vnd: calculation.couponDiscountVnd,
      pre_coupon_total_price: calculation.preCouponTotalPrice,
      is_floor_price_clamped: calculation.isFloorPriceClamped,
      pricing_breakdown: calculation.pricingBreakdown,
      currency: 'VND',
      is_estimate: true,
      availability_is_guaranteed: false,
      created_at: createdAt,
      expires_at: expiresAt,
      price_guaranteed_until: expiresAt,
    };
    await this.aiShadow.evaluateQuote({
      quoteId: quote.quote_id,
      quoteCreatedAt: quote.created_at,
      roomTypeName: quote.room_type.type_name,
      capacity: quote.room_type.capacity,
      checkInDate: quote.check_in_date,
      checkOutDate: quote.check_out_date,
      guestCount: quote.guest_count,
      leadTime: calculation.leadTime,
      roomsAvailable: quote.rooms_available,
      roomsSellable: quote.rooms_sellable,
      roomsBooked: quote.rooms_booked,
      occupancyRatio: quote.occupancy_ratio,
      basePrice: quote.room_type.base_price,
      nightlyPrice: quote.nightly_price,
      championMultiplier: quote.ai_multiplier,
      pricingSource: quote.pricing_source,
      championModelVersion: quote.ai_model_version,
      championTrainingRunId: quote.ai_training_run_id,
      championFeatureContractVersion: quote.ai_feature_contract_version,
    });
    return quote;
  }

  async lockQuoteForBooking(
    manager: EntityManager,
    quoteId: string,
    input: PriceQuoteDto,
  ): Promise<PricingCalculation> {
    const rows = await manager.query(
      `SELECT quote_id,
              booking_id,
              room_type_id,
              room_type_name_snapshot,
              capacity_snapshot,
              check_in_date::text,
              check_out_date::text,
              guest_count,
              total_of_special_requests,
              lead_time,
              is_weekend,
              base_price,
              ai_multiplier,
              nightly_price,
              total_price,
              coupon_code,
              coupon_discount_vnd,
              pre_coupon_total_price,
              is_floor_price_clamped,
              pricing_breakdown,
              pricing_source,
              settings_version,
              ai_model_version,
              ai_training_run_id,
              ai_feature_contract_version,
              created_at,
              expires_at,
              expires_at <= CURRENT_TIMESTAMP AS is_expired,
               EXISTS (
                 SELECT 1
                 FROM pricing_quote_events event
                 WHERE event.quote_id = pricing_quotes.quote_id
                   AND event.event_type = 'quote.rejected.v1'
               ) AS is_rejected,
               EXISTS (
                 SELECT 1
                 FROM pricing_quote_events event
                 WHERE event.quote_id = pricing_quotes.quote_id
                   AND event.event_type = 'quote.exposed.v1'
               ) AS has_confirmed_exposure
       FROM pricing_quotes
       WHERE quote_id = $1::uuid
       FOR UPDATE`,
      [quoteId],
    ) as StoredQuoteRow[];
    const quote = rows[0];
    if (!quote) throw new NotFoundException('Không tìm thấy báo giá đã chọn.');
    if (quote.booking_id !== null) {
      throw new ConflictException('Báo giá này đã được dùng để tạo booking.');
    }
    if (quote.is_expired === true || String(quote.is_expired) === 'true') {
      throw new ConflictException('Báo giá đã hết hạn; vui lòng tạo báo giá mới.');
    }
    if (quote.is_rejected === true || String(quote.is_rejected) === 'true') {
      throw new ConflictException('Báo giá đã bị từ chối; vui lòng tạo báo giá mới.');
    }
    // Telemetry is not a checkout prerequisite. A booking without verified
    // pre-booking exposure is retained operationally and censored from training.
    if (quote.check_in_date < this.getBusinessDate()) {
      throw new ConflictException('Ngày nhận phòng của báo giá đã qua; vui lòng tạo báo giá mới.');
    }

    const guestCount = input.guest_count ?? 1;
    const inputCoupon = input.coupon_code?.trim().toUpperCase() || null;
    const quoteCoupon = quote.coupon_code ? String(quote.coupon_code).trim().toUpperCase() : null;
    const inputMatches = Number(quote.room_type_id) === input.room_type_id
      && quote.check_in_date === input.check_in_date
      && quote.check_out_date === input.check_out_date
      && Number(quote.guest_count) === guestCount
      && Number(quote.total_of_special_requests) === input.total_of_special_requests
      && (inputCoupon === null || inputCoupon === quoteCoupon);
    if (!inputMatches) {
      throw new ConflictException(
        'Thông tin booking không khớp với báo giá; vui lòng tạo báo giá mới.',
      );
    }

    const checkIn = new Date(`${quote.check_in_date}T00:00:00.000Z`);
    const checkOut = new Date(`${quote.check_out_date}T00:00:00.000Z`);
    const source = quote.pricing_source;
    const nightlyPrice = Number(quote.nightly_price);
    const totalPrice = Number(quote.total_price);

    return {
      roomType: {
        type_id: Number(quote.room_type_id),
        type_name: quote.room_type_name_snapshot,
        base_price: Number(quote.base_price),
        capacity: Number(quote.capacity_snapshot),
      },
      checkIn,
      checkOut,
      leadTime: Number(quote.lead_time),
      nights: Math.floor((checkOut.getTime() - checkIn.getTime()) / 86_400_000),
      multiplier: Number(quote.ai_multiplier),
      isWeekend: quote.is_weekend === true || String(quote.is_weekend) === 'true',
      aiModelVersion: quote.ai_model_version,
      aiTrainingRunId: quote.ai_training_run_id,
      aiFeatureContractVersion: quote.ai_feature_contract_version,
      nightlyPrice,
      totalPrice,
      source,
      settingsVersion: Number(quote.settings_version),
      aiEnabled: source === 'ai',
      couponCode: quoteCoupon,
      couponDiscountVnd: Number(quote.coupon_discount_vnd ?? 0),
      preCouponTotalPrice: quote.pre_coupon_total_price != null ? Number(quote.pre_coupon_total_price) : totalPrice,
      isFloorPriceClamped: quote.is_floor_price_clamped === true || String(quote.is_floor_price_clamped) === 'true',
      pricingBreakdown: quote.pricing_breakdown ?? null,
    };
  }

  async recordClientQuoteEvent(
    quoteId: string,
    input: RecordQuoteEventDto,
    idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{8,100}$/.test(idempotencyKey)) {
      throw new BadRequestException(
        'Idempotency-Key phải dài 8-100 ký tự và chỉ chứa chữ, số, dấu chấm, gạch dưới, hai chấm hoặc gạch ngang.',
      );
    }

    return this.dataSource.transaction(async (manager) => {
      const quoteRows = await manager.query(
        `SELECT booking_id,
                expires_at <= CURRENT_TIMESTAMP AS is_expired,
                EXISTS (
                  SELECT 1
                  FROM pricing_quote_events event
                  WHERE event.quote_id = pricing_quotes.quote_id
                    AND event.event_type = 'quote.exposed.v1'
                ) AS has_confirmed_exposure
         FROM pricing_quotes
         WHERE quote_id = $1::uuid
         FOR UPDATE`,
        [quoteId],
      ) as Array<{
        booking_id: string | null;
        is_expired: boolean;
        has_confirmed_exposure: boolean;
      }>;
      const quote = quoteRows[0];
      if (!quote) throw new NotFoundException('Không tìm thấy báo giá đã chọn.');
      if (input.event_type === 'quote.rejected.v1') {
        if (quote.booking_id) {
          throw new ConflictException(
            'Báo giá đã được chấp nhận nên không thể ghi nhận từ chối.',
          );
        }
        if (quote.is_expired === true || String(quote.is_expired) === 'true') {
          throw new ConflictException(
            'Báo giá đã hết hạn nên không thể ghi nhận từ chối.',
          );
        }
        // Explicit rejection is allowed only when a real exposure was already
        // recorded; this remains a telemetry rule, not a booking gate.
        if (input.event_type === 'quote.rejected.v1' &&
            quote.has_confirmed_exposure !== true && String(quote.has_confirmed_exposure) !== 'true') {
          throw new ConflictException('Chỉ có thể từ chối báo giá đã được hiển thị.');
        }
      }

      const rows = await manager.query(
        `INSERT INTO pricing_quote_events (
           quote_id,
           event_type,
           occurred_at,
           source,
           session_id,
           search_id,
           idempotency_key
         ) VALUES ($1::uuid, $2, CURRENT_TIMESTAMP, 'public_api', $3::uuid, $4::uuid, $5)
         ON CONFLICT (quote_id, event_type) DO NOTHING
         RETURNING quote_event_id,
                   quote_id,
                   event_type,
                   occurred_at,
                   session_id,
                   search_id`,
        [
          quoteId,
          input.event_type,
          input.session_id ?? null,
          input.search_id ?? null,
          idempotencyKey,
        ],
      ) as StoredQuoteEventRow[];

      let event = rows[0];
      let replayed = false;
      if (!event) {
        const existingRows = await manager.query(
          `SELECT event.quote_event_id,
                  event.quote_id,
                  event.event_type,
                  event.occurred_at,
                  event.session_id,
                  event.search_id
           FROM pricing_quote_events event
           WHERE event.quote_id = $1::uuid AND event.event_type = $2`,
          [quoteId, input.event_type],
        ) as StoredQuoteEventRow[];
        event = existingRows[0];
        replayed = true;
      }
      if (!event) {
        throw new InternalServerErrorException('Không thể ghi nhận sự kiện báo giá.');
      }

      return {
        quote_event_id: event.quote_event_id,
        quote_id: event.quote_id,
        event_type: event.event_type,
        occurred_at: new Date(event.occurred_at).toISOString(),
        session_id: event.session_id,
        search_id: event.search_id,
        replayed,
      };
    });
  }

  async acceptQuote(
    manager: EntityManager,
    quoteId: string,
    bookingId: string,
    customerId: string,
  ): Promise<void> {
    const rows = await manager.query(
      `WITH accepted_quote AS (
         UPDATE pricing_quotes
         SET booking_id = $2::uuid,
             customer_id = $3::uuid,
             accepted_at = CURRENT_TIMESTAMP
         WHERE quote_id = $1::uuid
           AND booking_id IS NULL
           AND expires_at > CURRENT_TIMESTAMP
            AND NOT EXISTS (
              SELECT 1
              FROM pricing_quote_events event
              WHERE event.quote_id = pricing_quotes.quote_id
                AND event.event_type = 'quote.rejected.v1'
            )
         RETURNING quote_id
       )
       SELECT quote_id FROM accepted_quote`,
      [quoteId, bookingId, customerId],
    ) as Array<{ quote_id: string }>;
    if (rows.length !== 1) {
      throw new ConflictException('Báo giá không còn khả dụng; vui lòng tạo báo giá mới.');
    }
  }

  private async queryRoomAvailability(
    roomTypeId: number,
    checkInDate: string,
    checkOutDate: string,
    businessDate: string,
    manager?: EntityManager,
  ): Promise<RoomAvailabilitySnapshot> {
    const runner = manager ?? this.dataSource;
    const availabilityRows = await runner.query(
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
      [roomTypeId, checkInDate, checkOutDate, businessDate],
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

    return {
      roomsAvailable,
      roomsSellable,
      roomsBooked,
      occupancyRatio,
    };
  }

  private evaluateCalendarContext(checkIn: Date, nights: number): {
    holidayMult: number;
    holidayNames: string[];
    seasonalMult: number;
    seasonalDesc: string;
  } {
    let holidayNights = 0;
    const names = new Set<string>();
    for (let offset = 0; offset < nights; offset += 1) {
      const day = new Date(checkIn.getTime() + offset * 86_400_000);
      if (day.getUTCFullYear() === 2026) {
        const iso = day.toISOString().slice(0, 10);
        const matches = VIETNAM_PUBLIC_HOLIDAYS_2026.filter(
          (period) => iso >= period.start && iso <= period.end,
        );
        if (matches.length > 0) {
          holidayNights += 1;
          for (const m of matches) names.add(m.name);
        }
      }
    }
    const holidayMult = holidayNights > 0 ? Number((1 + 0.12 * (holidayNights / Math.max(1, nights))).toFixed(4)) : 1.0;

    const month = checkIn.getUTCMonth() + 1;
    let seasonalMult = 1.0;
    let seasonalDesc = 'Mùa du lịch ổn định tại Đà Nẵng (giả định kịch bản).';
    if (month === 6 || month === 7) {
      seasonalMult = 1.10;
      seasonalDesc = 'Cao điểm hè biển Mỹ Khê & lễ hội Đà Nẵng (giả định kịch bản).';
    } else if (month === 8) {
      seasonalMult = 1.06;
      seasonalDesc = 'Giai đoạn cuối hè khu vực biển Mỹ Khê (giả định kịch bản).';
    } else if (month === 4 || month === 5) {
      seasonalMult = 1.05;
      seasonalDesc = 'Đầu mùa du lịch biển miền Trung (giả định kịch bản).';
    } else if (month === 10 || month === 11) {
      seasonalMult = 0.94;
      seasonalDesc = 'Mùa mưa thấp điểm miền Trung, áp dụng hệ số kích cầu (giả định kịch bản).';
    }

    return {
      holidayMult,
      holidayNames: [...names].sort(),
      seasonalMult,
      seasonalDesc,
    };
  }

  private applyContextualRules(params: {
    basePrice: number;
    declaredMaxPrice: number | null;
    nights: number;
    checkIn: Date;
    checkOut: Date;
    guestCount: number;
    roomsAvailable: number;
    roomsSellable: number;
    mlMultiplier: number;
    aiEnabled: boolean;
    coupon: PublicCoupon | null;
  }): {
    nightlyPrice: number;
    totalPrice: number;
    preCouponTotalPrice: number;
    couponDiscountTotalVnd: number;
    isFloorClamped: boolean;
    breakdown: PricingBreakdown;
  } {
    const {
      basePrice,
      declaredMaxPrice,
      nights,
      checkIn,
      checkOut,
      guestCount,
      roomsAvailable,
      roomsSellable,
      mlMultiplier,
      aiEnabled,
      coupon,
    } = params;

    const roundMoney = (val: number) =>
      basePrice >= 10_000 ? Math.round(val / 1000) * 1000 : Math.round(val * 100) / 100;

    const factors: PricingFactorItem[] = [];
    const mlRefPrice = roundMoney(basePrice * mlMultiplier);

    if (aiEnabled) {
      factors.push({
        factor_name: 'Tham chiếu ML Random Forest V2',
        source_category: '(A) ML_REAL_DATA',
        impact_pct: Math.round((mlMultiplier - 1.0) * 1000) / 10,
        impact_vnd: Math.round(mlRefPrice - basePrice),
        description_vi: `Hệ số ML ${mlMultiplier.toFixed(3)} học từ dữ liệu lịch sử (benchmark tham chiếu).`,
      });
    }

    const occupancyRatio = roomsSellable > 0
      ? Math.max(0, Math.min(1, (roomsSellable - roomsAvailable) / roomsSellable))
      : 0;
    let occupancyMult = 1.0;
    let occDesc = `Tỷ lệ lấp đầy thực tế tại DB: ${Math.round(occupancyRatio * 100)}% (${roomsAvailable}/${roomsSellable} phòng trống).`;
    if (occupancyRatio >= 0.85) {
      occupancyMult = 1.25;
      occDesc = `Phòng còn ít (${roomsAvailable}/${roomsSellable} phòng trống, lấp đầy ${Math.round(occupancyRatio * 100)}%), tăng bảo vệ tồn kho.`;
    } else if (occupancyRatio >= 0.70) {
      occupancyMult = 1.15;
      occDesc = `Công suất phòng cao (${Math.round(occupancyRatio * 100)}%, còn ${roomsAvailable} phòng trống).`;
    } else if (occupancyRatio >= 0.50) {
      occupancyMult = 1.05;
      occDesc = `Công suất ổn định (${Math.round(occupancyRatio * 100)}%, còn ${roomsAvailable} phòng trống).`;
    } else if (occupancyRatio <= 0.25) {
      occupancyMult = 0.95;
      occDesc = `Công suất hiện thấp (${Math.round(occupancyRatio * 100)}%, còn ${roomsAvailable} phòng trống), kích cầu lấp đầy.`;
    }

    const weekendNights = countWeekendNights(checkIn, checkOut);
    const weekendShare = weekendNights / Math.max(1, nights);
    const weekendMult = weekendNights > 0 ? 1.0 + 0.12 * weekendShare : 0.96;

    const cal = this.evaluateCalendarContext(checkIn, nights);
    const guestMult = guestCount > 2 ? 1.0 + 0.10 * (guestCount - 2) : 1.0;

    let preCeilingNightly = roundMoney(basePrice);
    if (aiEnabled) {
      factors.push({
        factor_name: 'Tồn kho & Công suất phòng thực tế',
        source_category: '(B) SIMULATED_SYSTEM_STATE',
        impact_pct: Math.round((occupancyMult - 1.0) * 1000) / 10,
        impact_vnd: Math.round(basePrice * (occupancyMult - 1.0)),
        description_vi: occDesc,
      });

      factors.push({
        factor_name: weekendNights > 0 ? 'Phụ thu cuối tuần biển Mỹ Khê' : 'Ưu đãi ngày thường giữa tuần',
        source_category: '(B) SIMULATED_SYSTEM_STATE',
        impact_pct: Math.round((weekendMult - 1.0) * 1000) / 10,
        impact_vnd: Math.round(basePrice * (weekendMult - 1.0)),
        description_vi: weekendNights > 0
          ? `Kỳ lưu trú gồm ${weekendNights}/${nights} đêm cuối tuần nhu cầu cao.`
          : 'Kỳ lưu trú vào ngày thường trong tuần.',
      });

      if (guestMult > 1.0) {
        factors.push({
          factor_name: `Quy mô đoàn (${guestCount} khách)`,
          source_category: '(B) SIMULATED_SYSTEM_STATE',
          impact_pct: Math.round((guestMult - 1.0) * 1000) / 10,
          impact_vnd: Math.round(basePrice * (guestMult - 1.0)),
          description_vi: `Phụ thu thêm ${guestCount - 2} khách so với tiêu chuẩn 2 khách/phòng.`,
        });
      }

      factors.push({
        factor_name: 'Mùa vụ du lịch biển Đà Nẵng',
        source_category: '(C) SIMULATED_ASSUMPTION',
        impact_pct: Math.round((cal.seasonalMult - 1.0) * 1000) / 10,
        impact_vnd: Math.round(basePrice * (cal.seasonalMult - 1.0)),
        description_vi: cal.seasonalDesc,
      });

      if (cal.holidayNames.length > 0) {
        factors.push({
          factor_name: 'Lịch nghỉ lễ quốc gia Việt Nam (2026)',
          source_category: '(D) BUSINESS_RULE',
          impact_pct: Math.round((cal.holidayMult - 1.0) * 1000) / 10,
          impact_vnd: Math.round(basePrice * (cal.holidayMult - 1.0)),
          description_vi: `Trùng dịp lễ quốc gia: ${cal.holidayNames.join(', ')}.`,
        });
      }

      const contextualProduct = occupancyMult * weekendMult * cal.holidayMult * cal.seasonalMult * guestMult;
      const compositeMultiplier = mlMultiplier * 0.35 + contextualProduct * 0.65;
      preCeilingNightly = roundMoney(basePrice * compositeMultiplier);
    }

    let preCouponNightly = Math.max(basePrice >= 10_000 ? 1000 : 0.01, preCeilingNightly);
    let isCeilingClamped = false;
    if (aiEnabled && declaredMaxPrice !== null && preCouponNightly > declaredMaxPrice) {
      const ceilingNightly = basePrice >= 10_000
        ? Math.floor(declaredMaxPrice / 1000) * 1000
        : Math.round(declaredMaxPrice * 100) / 100;
      factors.push({
        factor_name: 'Trần giá kê khai Sở Tài chính TP. Đà Nẵng',
        source_category: '(D) BUSINESS_RULE',
        impact_pct: Math.round(((ceilingNightly - preCouponNightly) / Math.max(1, preCouponNightly)) * 1000) / 10,
        impact_vnd: Math.round(ceilingNightly - preCouponNightly),
        description_vi: `Giới hạn giá trước ưu đãi không vượt trần niêm yết ${ceilingNightly.toLocaleString('vi-VN')} VND/đêm.`,
      });
      preCouponNightly = ceilingNightly;
      isCeilingClamped = true;
    }

    let requestedDiscountPerNight = 0;
    if (coupon) {
      const rawDiscount = roundMoney(preCouponNightly * coupon.discount_pct);
      requestedDiscountPerNight = Math.min(rawDiscount, coupon.max_discount_vnd);
    }
    const afterCouponNightly = Math.max(0, preCouponNightly - requestedDiscountPerNight);

    let nightlyPrice = afterCouponNightly;
    let isFloorClamped = false;
    let actualDiscountPerNight = requestedDiscountPerNight;

    if (basePrice >= 100_000 && afterCouponNightly < MIN_CONTRIBUTION_FLOOR_VND) {
      isFloorClamped = true;
      nightlyPrice = MIN_CONTRIBUTION_FLOOR_VND;
      actualDiscountPerNight = Math.max(0, preCouponNightly - nightlyPrice);
    }

    if (coupon) {
      factors.push({
        factor_name: `Mã ưu đãi ${coupon.code}`,
        source_category: '(D) BUSINESS_RULE',
        impact_pct: -Math.round((actualDiscountPerNight / Math.max(1, preCouponNightly)) * 1000) / 10,
        impact_vnd: -Math.round(actualDiscountPerNight),
        description_vi: coupon.description_vi,
      });
    }

    if (isFloorClamped) {
      factors.push({
        factor_name: 'Ràng buộc Giá Sàn Biến Phí (Contribution Floor)',
        source_category: '(D) BUSINESS_RULE',
        impact_pct: Math.round(((nightlyPrice - afterCouponNightly) / Math.max(1, afterCouponNightly)) * 1000) / 10,
        impact_vnd: Math.round(nightlyPrice - afterCouponNightly),
        description_vi: `Giá sau giảm chạm dưới giá sàn ${MIN_CONTRIBUTION_FLOOR_VND.toLocaleString('vi-VN')} VND (gồm biến phí 350.000đ + biên tối thiểu + thuế phí). Hệ thống tự động bảo vệ giá sàn.`,
      });
    }

    const preCouponTotalPrice = Math.round(preCouponNightly * nights * 100) / 100;
    const couponDiscountTotalVnd = Math.round(actualDiscountPerNight * nights * 100) / 100;
    const totalPrice = Math.round(nightlyPrice * nights * 100) / 100;

    return {
      nightlyPrice,
      totalPrice,
      preCouponTotalPrice,
      couponDiscountTotalVnd,
      isFloorClamped,
      breakdown: {
        base_price: basePrice,
        ml_reference_price: mlRefPrice,
        pre_coupon_nightly_price: preCouponNightly,
        pre_coupon_total_price: preCouponTotalPrice,
        declared_max_price: declaredMaxPrice,
        is_ceiling_clamped: isCeilingClamped,
        coupon_code: coupon?.code ?? null,
        coupon_description_vi: coupon?.description_vi ?? null,
        coupon_discount_per_night_vnd: actualDiscountPerNight,
        coupon_discount_total_vnd: couponDiscountTotalVnd,
        is_floor_price_clamped: isFloorClamped,
        floor_price_vnd: MIN_CONTRIBUTION_FLOOR_VND,
        factors,
      },
    };
  }

  private async getAiPrediction(input: {
    check_in_date: string;
    check_out_date: string;
    lead_time: number;
    guest_count: number;
    occupancy_ratio?: number;
    booking_velocity_score?: number;
    rooms_available?: number;
    rooms_sellable?: number;
    price_vs_market_ratio?: number;
  }): Promise<AiPricingResult> {
    const checkIn = new Date(`${input.check_in_date}T00:00:00.000Z`);
    const checkOut = new Date(`${input.check_out_date}T00:00:00.000Z`);
    const expectedFeatures = buildAiFeatureV2(
      checkIn,
      checkOut,
      input.lead_time,
      input.guest_count,
    );
    const configuredTimeout = Number(
      this.configService.get<string>('AI_SERVICE_TIMEOUT_MS', '5000'),
    );
    const timeout = Number.isFinite(configuredTimeout)
      ? Math.min(15_000, Math.max(500, configuredTimeout))
      : 5_000;

    try {
      const { data } = await axios.post<AiPricingResponse>(
        this.configService.getOrThrow<string>('AI_SERVICE_URL'),
        {
          lead_time: input.lead_time,
          check_in_date: input.check_in_date,
          check_out_date: input.check_out_date,
          guest_count: input.guest_count,
        },
        { timeout },
      );

      if (
        data.status !== 'success'
        || !Number.isFinite(data.ai_multiplier)
        || data.ai_multiplier < 0.5
        || data.ai_multiplier > 3
        || typeof data.model_version !== 'string'
        || data.model_version.trim().length === 0
        || typeof data.training_run_id !== 'string'
        || data.training_run_id.trim().length === 0
        || !SUPPORTED_AI_FEATURE_CONTRACT_VERSIONS.has(data.feature_contract_version)
        || !data.features
        || Object.entries(expectedFeatures).some(([feature, expected]) => (
          !featureNumberMatches(data.features[feature as keyof AiFeatureV2], expected)
        ))
      ) {
        throw new Error('AI service returned an invalid pricing response.');
      }

      return {
        multiplier: data.ai_multiplier,
        isWeekend: data.features.weekend_nights > 0,
        modelVersion: data.model_version,
        trainingRunId: data.training_run_id,
        featureContractVersion: data.feature_contract_version,
      };
    } catch (error) {
      this.logger.warn(
        `AI pricing request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new ServiceUnavailableException('Không thể lấy giá động từ AI Pricing Service.');
    }
  }

  private getQuoteTtlSeconds(): number {
    const configured = Number(
      this.configService.get<string>('PRICING_QUOTE_TTL_SECONDS', '1800'),
    );
    if (!Number.isFinite(configured)) return 1800;
    return Math.min(3_600, Math.max(60, Math.floor(configured)));
  }

  getBusinessDate(now = new Date()): string {
    const timeZone = this.configService.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok');
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${value.year}-${value.month}-${value.day}`;
  }
}
