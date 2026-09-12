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

const SUPPORTED_AI_FEATURE_CONTRACT_VERSION = '2.0.0';

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

type PricingSnapshotRow = {
  type_id: number;
  type_name: string;
  base_price: string | number;
  capacity: number;
  ai_enabled: boolean | null;
  settings_version: number | null;
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

  async calculate(input: PriceQuoteDto): Promise<PricingCalculation> {
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

    // Room price and the pricing switch are read in the same PostgreSQL
    // statement, so every quote/audit is based on one consistent snapshot.
    const rows = await this.dataSource.query(
      `SELECT room_type.type_id,
              room_type.name AS type_name,
              room_type.base_price,
              room_type.capacity,
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
    const aiEnabled = row.ai_enabled;
    const aiPrediction = aiEnabled
      ? await this.getAiPrediction({
          check_in_date: input.check_in_date,
          check_out_date: input.check_out_date,
          lead_time: leadTime,
          guest_count: guestCount,
        })
      : null;
    const multiplier = aiPrediction?.multiplier ?? 1;
    const basePrice = Number(row.base_price);
    const nightlyPrice = Math.round(basePrice * multiplier * 100) / 100;

    return {
      roomType: {
        type_id: Number(row.type_id),
        type_name: row.type_name,
        base_price: basePrice,
        capacity: Number(row.capacity),
      },
      checkIn,
      checkOut,
      leadTime,
      nights,
      multiplier,
      isWeekend: aiPrediction?.isWeekend ?? stayIncludesWeekendNight(checkIn, checkOut),
      aiModelVersion: aiPrediction?.modelVersion ?? null,
      aiTrainingRunId: aiPrediction?.trainingRunId ?? null,
      aiFeatureContractVersion: aiPrediction?.featureContractVersion ?? null,
      nightlyPrice,
      totalPrice: Math.round(nightlyPrice * nights * 100) / 100,
      source: aiEnabled ? 'ai' : 'base',
      settingsVersion: Number(row.settings_version),
      aiEnabled,
    };
  }

  async quote(input: PriceQuoteDto): Promise<PriceQuote> {
    const calculation = await this.calculate(input);
    const guestCount = input.guest_count ?? 1;
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
      [
        input.room_type_id,
        input.check_in_date,
        input.check_out_date,
        this.getBusinessDate(),
      ],
    ) as Array<{
      rooms_available: number | string;
      rooms_sellable: number | string;
    }>;

    const roomsAvailable = Number(availabilityRows[0]?.rooms_available ?? 0);
    const roomsSellable = Number(availabilityRows[0]?.rooms_sellable ?? 0);
    // The current conversion feature contract models booked inventory as the
    // complement of available inventory. Keep operationally blocked same-day
    // rooms in the sellable denominator so occupied/Dirty rooms cannot vanish
    // from the immutable occupancy snapshot.
    const roomsBooked = Math.max(roomsSellable - roomsAvailable, 0);
    const occupancyRatio = roomsSellable === 0
      ? 0
      : Math.round((roomsBooked / roomsSellable) * 1_000_000) / 1_000_000;
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
         pricing_source,
         settings_version,
         ai_model_version,
         ai_training_run_id,
         ai_feature_contract_version,
         expires_at
       ) VALUES (
         $1, $2, $3, $4::date, $5::date, $6, $7, $8, $9, $10,
         $11, $12, $13, CURRENT_TIMESTAMP,
         $14, $15, $16, $17, $18, $19, $20, $21, $22,
         CURRENT_TIMESTAMP + ($23::int * INTERVAL '1 second')
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
    if (
      quote.has_confirmed_exposure !== true
      && String(quote.has_confirmed_exposure) !== 'true'
    ) {
      throw new ConflictException(
        'Báo giá chưa được ghi nhận hiển thị; vui lòng xác nhận exposure trước khi đặt phòng.',
      );
    }
    if (quote.check_in_date < this.getBusinessDate()) {
      throw new ConflictException('Ngày nhận phòng của báo giá đã qua; vui lòng tạo báo giá mới.');
    }

    const guestCount = input.guest_count ?? 1;
    const inputMatches = Number(quote.room_type_id) === input.room_type_id
      && quote.check_in_date === input.check_in_date
      && quote.check_out_date === input.check_out_date
      && Number(quote.guest_count) === guestCount
      && Number(quote.total_of_special_requests) === input.total_of_special_requests;
    if (!inputMatches) {
      throw new ConflictException(
        'Thông tin booking không khớp với báo giá; vui lòng tạo báo giá mới.',
      );
    }

    const checkIn = new Date(`${quote.check_in_date}T00:00:00.000Z`);
    const checkOut = new Date(`${quote.check_out_date}T00:00:00.000Z`);
    const source = quote.pricing_source;
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
      nightlyPrice: Number(quote.nightly_price),
      totalPrice: Number(quote.total_price),
      source,
      settingsVersion: Number(quote.settings_version),
      aiEnabled: source === 'ai',
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
        if (
          quote.has_confirmed_exposure !== true
          && String(quote.has_confirmed_exposure) !== 'true'
        ) {
          throw new ConflictException(
            'Chỉ có thể từ chối báo giá đã được hiển thị và ghi nhận exposure.',
          );
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
            AND EXISTS (
              SELECT 1
              FROM pricing_quote_events event
              WHERE event.quote_id = pricing_quotes.quote_id
                AND event.event_type = 'quote.exposed.v1'
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

  private async getAiPrediction(input: {
    check_in_date: string;
    check_out_date: string;
    lead_time: number;
    guest_count: number;
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
        || data.feature_contract_version !== SUPPORTED_AI_FEATURE_CONTRACT_VERSION
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
      this.configService.get<string>('PRICING_QUOTE_TTL_SECONDS', '900'),
    );
    if (!Number.isFinite(configured)) return 900;
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
