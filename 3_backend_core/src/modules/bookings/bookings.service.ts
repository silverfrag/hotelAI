import { createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox.service';
import { PricingService } from '../pricing/pricing.service';
import { BookingWorkflowService } from '../booking-workflow/booking-workflow.service';
import { RoomType } from '../rooms/entities/room.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingCreateRequest } from './entities/booking-create-request.entity';
import { Booking } from './entities/booking.entity';
import { BookingDetail } from './entities/booking-detail.entity';
import { DailyPricingLog } from './entities/daily-pricing-log.entity';
import { Room } from './entities/room.entity';

export type CreatedBooking = {
  booking: Booking;
  quote_id: string | null;
  room_id: number;
  room_number: string;
  applied_price: number;
  nightly_price: number;
  nights: number;
  total_price: number;
  ai_multiplier: number;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  pricing_source: 'ai' | 'base';
  settings_version: number;
  payment_status: string;
  paid_amount: number;
  balance_due: number;
};

export type BookingSummary = {
  booking_id: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  status: string;
  room_number: string;
  room_type: string;
  nightly_price: number;
  nights: number;
  total_price: number;
  created_at: Date;
  can_cancel: boolean;
  payment_status: string;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
  lifecycle_version: number;
  policy_version: number | null;
  deposit_required: number;
  checkout_payment_required: boolean;
  pending_expires_at: Date | null;
};

export type CanceledBookingSummary = BookingSummary & {
  customer_id: string;
};

type IdempotentBookingRow = {
  request_hash: string;
  booking_id: string;
  quote_id: string | null;
  customer_id: string;
  check_in_date: string;
  check_out_date: string;
  guest_count: number | string;
  status: string;
  checked_in_at: Date | null;
  checked_in_by: string | null;
  checked_out_at: Date | null;
  checked_out_by: string | null;
  created_at: Date;
  room_id: number | string;
  room_number: string;
  nightly_price: number | string;
  nights: number | string;
  total_price: number | string;
  ai_multiplier: number | string;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  pricing_source: 'ai' | 'base';
  settings_version: number | string;
  policy_version: number | null;
  deposit_required: number | string;
  checkout_payment_required: boolean;
  pending_expires_at: Date | null;
  lifecycle_version: number;
  paid_amount: number | string;
  refunded_amount: number | string;
};

@Injectable()
export class BookingsService {
  constructor(
    @InjectRepository(Booking) private readonly bookingRepository: Repository<Booking>,
    private readonly dataSource: DataSource,
    private readonly pricingService: PricingService,
    private readonly outbox: OutboxService,
    private readonly workflow: BookingWorkflowService,
  ) {}

  async create(
    dto: CreateBookingDto,
    customer_id: string,
    rawIdempotencyKey?: string,
  ): Promise<CreatedBooking> {
    const idempotencyKey = this.normalizeIdempotencyKey(rawIdempotencyKey);
    const requestHash = idempotencyKey ? this.hashCreateRequest(dto) : null;
    const guestCount = dto.guest_count ?? 1;
    const { room_type_id, check_in_date, check_out_date, total_of_special_requests } = dto;

    // A committed replay can return before another AI inference. The lookup is
    // repeated under the transaction-scoped advisory lock below to cover races.
    if (idempotencyKey && requestHash) {
      const replay = await this.findIdempotentBooking(
        this.dataSource.manager,
        customer_id,
        idempotencyKey,
      );
      if (replay) {
        this.assertIdempotentReplay(replay.request_hash, requestHash);
        return this.mapIdempotentBooking(replay);
      }
    }

    // A persisted quote is the source of truth for the accepted price. Legacy
    // clients without quote_id keep the old calculation path until the UI
    // redesign adopts the quote contract.
    const calculatedPricing = dto.quote_id
      ? null
      : await this.pricingService.calculate(dto);
    if (calculatedPricing) {
      this.assertGuestCapacity(guestCount, calculatedPricing.roomType.capacity);
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      if (idempotencyKey && requestHash) {
        await this.lockIdempotencyKey(queryRunner.manager, customer_id, idempotencyKey);
        const replay = await this.findIdempotentBooking(
          queryRunner.manager,
          customer_id,
          idempotencyKey,
        );
        if (replay) {
          this.assertIdempotentReplay(replay.request_hash, requestHash);
          await queryRunner.commitTransaction();
          return this.mapIdempotentBooking(replay);
        }
      }

      // Serialize booking creation with suspension/deactivation. The guard
      // checks the account before entering the service, but lifecycle state
      // may change while pricing is being calculated.
      const customerRows = await queryRunner.query(
        `SELECT account_status
         FROM customers
         WHERE customer_id = $1::uuid
         FOR UPDATE`,
        [customer_id],
      );
      if (customerRows[0]?.account_status !== 'Active') {
        throw new ForbiddenException('Tài khoản hiện không hoạt động nên không thể tạo booking.');
      }

      const pricing = dto.quote_id
        ? await this.pricingService.lockQuoteForBooking(queryRunner.manager, dto.quote_id, dto)
        : calculatedPricing;
      if (!pricing) {
        throw new ConflictException('Không thể xác định giá cho booking.');
      }
      const { roomType, checkIn, leadTime, nights, nightlyPrice, totalPrice } = pricing;
      this.assertGuestCapacity(guestCount, roomType.capacity);

      // Keep capacity stable until the booking and its detail are committed.
      // This closes the race with an admin reducing the room-type capacity.
      const capacityRows = await queryRunner.query(
        `SELECT capacity
         FROM room_types
         WHERE type_id = $1
         FOR SHARE`,
        [room_type_id],
      ) as Array<{ capacity: number | string }>;
      if (!capacityRows[0]) {
        throw new NotFoundException(`Không tìm thấy loại phòng với ID: ${room_type_id}.`);
      }
      this.assertGuestCapacity(guestCount, Number(capacityRows[0].capacity));

      await queryRunner.query('SELECT pg_advisory_xact_lock($1)', [room_type_id]);
      const room = await queryRunner.manager.getRepository(Room).createQueryBuilder('room')
        .where('room.type_id = :roomTypeId', { roomTypeId: room_type_id })
        .andWhere("room.current_status <> 'Maintenance'")
        .andWhere(
          `(CAST(:checkInDate AS date) > CAST(:businessDate AS date)
            OR (
              room.current_status = 'Available'
              AND room.occupancy_booking_id IS NULL
              AND room.housekeeping_status = 'Ready'
            ))`,
        )
        .andWhere((builder) => {
          const unavailable = builder.subQuery().select('1').from(BookingDetail, 'detail')
            .innerJoin(Booking, 'existingBooking', 'existingBooking.booking_id = detail.booking_id')
            .where('detail.room_id = room.room_id')
            .andWhere(`(existingBooking.status IN ('Confirmed', 'CheckedIn')
              OR (existingBooking.status = 'Pending' AND existingBooking.pending_expires_at > clock_timestamp()))`)
            .andWhere('existingBooking.check_in_date < :checkOutDate')
            .andWhere('existingBooking.check_out_date > :checkInDate').getQuery();
          return `NOT EXISTS ${unavailable}`;
        })
        .setParameters({
          checkInDate: check_in_date,
          checkOutDate: check_out_date,
          businessDate: this.pricingService.getBusinessDate(),
        })
        .setLock('pessimistic_write')
        .orderBy('room.room_number', 'ASC').getOne();
      if (!room) throw new NotFoundException('Không còn phòng trống trong khoảng ngày đã chọn.');

      const terms = await this.workflow.snapshotForCreation(queryRunner.manager, totalPrice);
      await queryRunner.query("SELECT set_config('hotelai.actor_id', $1, true)", [customer_id]);
      const booking = await queryRunner.manager.save(Booking, {
        customer_id,
        check_in_date,
        check_out_date,
        guest_count: guestCount,
        ...terms,
      });
      await queryRunner.manager.save(BookingDetail, {
        booking_id: booking.booking_id,
        room_id: room.room_id,
        applied_price: nightlyPrice,
        room_number_snapshot: room.room_number,
        room_type_name_snapshot: roomType.type_name,
      });
      await queryRunner.manager.save(DailyPricingLog, {
        booking_id: booking.booking_id,
        type_id: room_type_id,
        target_date: check_in_date,
        lead_time: leadTime,
        is_weekend: pricing.isWeekend,
        total_of_special_requests,
        ai_multiplier: pricing.multiplier,
        base_price: roomType.base_price,
        final_price: nightlyPrice,
        pricing_source: pricing.source,
        settings_version: pricing.settingsVersion,
        ai_enabled: pricing.aiEnabled,
        ai_model_version: pricing.aiModelVersion,
        ai_training_run_id: pricing.aiTrainingRunId,
        ai_feature_contract_version: pricing.aiFeatureContractVersion,
        room_type_name_snapshot: roomType.type_name,
      });
      if (idempotencyKey && requestHash) {
        await queryRunner.manager.insert(BookingCreateRequest, {
          customer_id,
          idempotency_key: idempotencyKey,
          request_hash: requestHash,
          booking_id: booking.booking_id,
        });
      }
      await this.outbox.enqueue(queryRunner.manager, {
        aggregateType: 'booking',
        aggregateId: booking.booking_id,
        eventType: 'booking.created.v1',
        payload: {
          booking_id: booking.booking_id,
          customer_id,
          room_id: room.room_id,
          room_type_id,
          check_in_date,
          check_out_date,
          guest_count: guestCount,
          quote_id: dto.quote_id ?? null,
          nights,
          total_price: totalPrice,
          booking_status: booking.status,
          policy_version: terms.policy_version,
          deposit_required: terms.deposit_required,
          pending_expires_at: terms.pending_expires_at,
          pricing_source: pricing.source,
          settings_version: pricing.settingsVersion,
          ai_model_version: pricing.aiModelVersion,
          ai_training_run_id: pricing.aiTrainingRunId,
          ai_feature_contract_version: pricing.aiFeatureContractVersion,
        },
      });
      if (dto.quote_id) {
        await this.pricingService.acceptQuote(
          queryRunner.manager,
          dto.quote_id,
          booking.booking_id,
          customer_id,
        );
      }
      await queryRunner.commitTransaction();
      return {
        // PostgreSQL numeric columns hydrate as strings. Match the monetary
        // contract already used by booking replay, history and cancellation.
        booking: { ...booking, deposit_required: Number(booking.deposit_required) },
        quote_id: dto.quote_id ?? null,
        room_id: room.room_id,
        room_number: room.room_number,
        applied_price: nightlyPrice,
        nightly_price: nightlyPrice,
        nights,
        total_price: totalPrice,
        ai_multiplier: pricing.multiplier,
        ai_model_version: pricing.aiModelVersion,
        ai_training_run_id: pricing.aiTrainingRunId,
        ai_feature_contract_version: pricing.aiFeatureContractVersion,
        pricing_source: pricing.source,
        settings_version: pricing.settingsVersion,
        payment_status: 'Unpaid',
        paid_amount: 0,
        balance_due: totalPrice,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async findAll(customerId: string, role: string): Promise<BookingSummary[]> {
    const businessDate = this.pricingService.getBusinessDate();
    const query = this.bookingRepository.createQueryBuilder('booking')
      .innerJoin(BookingDetail, 'detail', 'detail.booking_id = booking.booking_id')
      .innerJoin(Room, 'room', 'room.room_id = detail.room_id')
      .innerJoin(RoomType, 'roomType', 'roomType.type_id = room.type_id')
      .leftJoin(
        (builder) => builder
          .select('payment.booking_id', 'booking_id')
          .addSelect("COALESCE(SUM(payment.amount) FILTER (WHERE payment.transaction_type = 'Payment'), 0)", 'paid_amount')
          .addSelect("COALESCE(SUM(payment.amount) FILTER (WHERE payment.transaction_type = 'Refund'), 0)", 'refunded_amount')
          .from('payment_transactions', 'payment')
          .groupBy('payment.booking_id'),
        'payment_ledger',
        'payment_ledger.booking_id = booking.booking_id',
      )
      .select('booking.booking_id', 'booking_id')
      // PostgreSQL DATE is a calendar value, not a timestamp. Casting to text
      // prevents the driver from applying the host timezone during JSON output.
      .addSelect('booking.check_in_date::text', 'check_in_date')
      .addSelect('booking.check_out_date::text', 'check_out_date')
      .addSelect('booking.guest_count', 'guest_count')
      .addSelect('booking.status', 'status')
      .addSelect('booking.created_at', 'created_at')
      .addSelect('detail.room_number_snapshot', 'room_number')
      .addSelect('detail.room_type_name_snapshot', 'room_type')
      .addSelect('detail.applied_price', 'nightly_price')
      .addSelect('(booking.check_out_date - booking.check_in_date)', 'nights')
      .addSelect('detail.applied_price * (booking.check_out_date - booking.check_in_date)', 'total_price')
      .addSelect('COALESCE(payment_ledger.paid_amount, 0)', 'paid_amount')
      .addSelect('COALESCE(payment_ledger.refunded_amount, 0)', 'refunded_amount')
      .addSelect('COALESCE(payment_ledger.paid_amount, 0) - COALESCE(payment_ledger.refunded_amount, 0)', 'net_paid')
      .addSelect(
        `CASE WHEN booking.status IN ('Canceled', 'Expired', 'NoShow') THEN 0
              ELSE GREATEST(
                detail.applied_price * (booking.check_out_date - booking.check_in_date)
                  - (COALESCE(payment_ledger.paid_amount, 0) - COALESCE(payment_ledger.refunded_amount, 0)),
                0
              ) END`,
        'balance_due',
      )
      .addSelect(
        `CASE WHEN booking.status IN ('Canceled', 'Expired', 'NoShow')
              THEN GREATEST(COALESCE(payment_ledger.paid_amount, 0) - COALESCE(payment_ledger.refunded_amount, 0), 0)
              ELSE 0 END`,
        'refund_due',
      )
      .addSelect(
        `CASE
           WHEN booking.status IN ('Canceled', 'Expired', 'NoShow')
             AND COALESCE(payment_ledger.paid_amount, 0) - COALESCE(payment_ledger.refunded_amount, 0) > 0
             THEN 'RefundPending'
           WHEN booking.status IN ('Canceled', 'Expired', 'NoShow') AND COALESCE(payment_ledger.refunded_amount, 0) > 0
             THEN 'Refunded'
           WHEN COALESCE(payment_ledger.paid_amount, 0) - COALESCE(payment_ledger.refunded_amount, 0)
                  >= detail.applied_price * (booking.check_out_date - booking.check_in_date)
             THEN 'Paid'
           WHEN COALESCE(payment_ledger.refunded_amount, 0) > 0
             THEN 'PartiallyRefunded'
           WHEN COALESCE(payment_ledger.paid_amount, 0) > 0
             THEN 'PartiallyPaid'
           ELSE 'Unpaid'
         END`,
        'payment_status',
      )
      .addSelect(`(booking.status = 'Confirmed' AND booking.check_in_date > :businessDate)
        OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp())`, 'can_cancel')
      .addSelect('booking.pending_expires_at', 'pending_expires_at')
      .addSelect('booking.deposit_required', 'deposit_required')
      .addSelect('booking.checkout_payment_required', 'checkout_payment_required')
      .addSelect('booking.policy_version', 'policy_version')
      .addSelect('booking.lifecycle_version', 'lifecycle_version')
      .setParameter('businessDate', businessDate)
      .orderBy('booking.created_at', 'DESC');
    if (role !== 'admin') query.where('booking.customer_id = :customerId', { customerId });
    const rows = await query.getRawMany<BookingSummary>();
    return rows.map((row) => ({
      ...row,
      guest_count: Number(row.guest_count),
      nightly_price: Number(row.nightly_price),
      nights: Number(row.nights),
      total_price: Number(row.total_price),
      paid_amount: Number(row.paid_amount),
      refunded_amount: Number(row.refunded_amount),
      net_paid: Number(row.net_paid),
      balance_due: Number(row.balance_due),
      refund_due: Number(row.refund_due),
      deposit_required: Number(row.deposit_required),
      lifecycle_version: Number(row.lifecycle_version),
      policy_version: row.policy_version == null ? null : Number(row.policy_version),
      can_cancel: row.can_cancel === true || String(row.can_cancel) === 'true',
    }));
  }

  async cancel(bookingId: string, customerId: string, role: string): Promise<CanceledBookingSummary> {
    const businessDate = this.pricingService.getBusinessDate();
    const isAdmin = role === 'admin';
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await queryRunner.query("SELECT set_config('hotelai.actor_id', $1, true)", [customerId]);
      const ownershipCondition = isAdmin ? '' : 'AND customer_id = $3::uuid';
      const parameters = isAdmin ? [bookingId, businessDate] : [bookingId, businessDate, customerId];
      const updateResult = await queryRunner.query(
        `UPDATE bookings
         SET status = 'Canceled'
         WHERE booking_id = $1::uuid
           AND ((status = 'Confirmed' AND check_in_date > $2::date)
             OR (status = 'Pending' AND pending_expires_at > clock_timestamp()))
           ${ownershipCondition}
         RETURNING booking_id`,
        parameters,
        true,
      );

      if (updateResult.affected !== 1) {
        const existingRows = await queryRunner.query(
          `SELECT booking_id, customer_id, check_in_date::text, status
           FROM bookings
           WHERE booking_id = $1::uuid`,
          [bookingId],
        );
        const existing = existingRows[0] as
          | { booking_id: string; customer_id: string; check_in_date: string; status: string }
          | undefined;

        if (!existing || (!isAdmin && existing.customer_id !== customerId)) {
          throw new NotFoundException('Không tìm thấy đặt phòng có thể truy cập.');
        }
        if (existing.status === 'Canceled') {
          throw new ConflictException('Đặt phòng đã được hủy trước đó.');
        }
        if (existing.status === 'CheckedIn') {
          throw new ConflictException('Không thể hủy booking khi khách đang lưu trú.');
        }
        if (existing.status === 'Completed' || existing.check_in_date <= businessDate) {
          throw new ConflictException('Không thể hủy đặt phòng đã bắt đầu hoặc đã hoàn tất.');
        }
        throw new ConflictException('Chỉ có thể hủy đặt phòng đang ở trạng thái Confirmed.');
      }

      const summaryRows = await queryRunner.query(
        `SELECT booking.booking_id,
                booking.customer_id,
                booking.check_in_date::text,
                booking.check_out_date::text,
                booking.guest_count,
                booking.status,
                booking.created_at,
                booking.lifecycle_version,
                booking.policy_version,
                booking.deposit_required,
                booking.checkout_payment_required,
                booking.pending_expires_at,
                COALESCE((SELECT SUM(amount) FROM payment_transactions
                  WHERE booking_id = booking.booking_id AND transaction_type = 'Payment'), 0) AS paid_amount,
                COALESCE((SELECT SUM(amount) FROM payment_transactions
                  WHERE booking_id = booking.booking_id AND transaction_type = 'Refund'), 0) AS refunded_amount,
                detail.room_number_snapshot AS room_number,
                detail.room_type_name_snapshot AS room_type,
                detail.applied_price AS nightly_price,
                (booking.check_out_date - booking.check_in_date) AS nights,
                detail.applied_price * (booking.check_out_date - booking.check_in_date) AS total_price
         FROM bookings booking
         INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
         INNER JOIN rooms room ON room.room_id = detail.room_id
         INNER JOIN room_types room_type ON room_type.type_id = room.type_id
         WHERE booking.booking_id = $1::uuid`,
        [bookingId],
      );
      const summary = summaryRows[0] as CanceledBookingSummary | undefined;
      if (!summary) throw new NotFoundException('Không tìm thấy chi tiết đặt phòng.');

      await this.outbox.enqueue(queryRunner.manager, {
        aggregateType: 'booking',
        aggregateId: bookingId,
        eventType: 'booking.canceled.v1',
        payload: {
          booking_id: bookingId,
          customer_id: summary.customer_id,
          canceled_by: customerId,
          actor_role: role,
          check_in_date: summary.check_in_date,
          check_out_date: summary.check_out_date,
          guest_count: Number(summary.guest_count),
          total_price: Number(summary.total_price),
        },
      });

      await queryRunner.commitTransaction();
      return {
        ...summary,
        guest_count: Number(summary.guest_count),
        nightly_price: Number(summary.nightly_price),
        nights: Number(summary.nights),
        total_price: Number(summary.total_price),
        deposit_required: Number(summary.deposit_required),
        lifecycle_version: Number(summary.lifecycle_version),
        policy_version: summary.policy_version == null ? null : Number(summary.policy_version),
        paid_amount: Number(summary.paid_amount),
        refunded_amount: Number(summary.refunded_amount),
        net_paid: Number(summary.paid_amount) - Number(summary.refunded_amount),
        balance_due: 0,
        refund_due: Number(summary.paid_amount) - Number(summary.refunded_amount),
        payment_status: Number(summary.paid_amount) > Number(summary.refunded_amount)
          ? 'RefundPending' : Number(summary.refunded_amount) > 0 ? 'Refunded' : 'Unpaid',
        can_cancel: false,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  private normalizeIdempotencyKey(rawKey?: string): string | null {
    if (rawKey === undefined) return null;
    const key = rawKey.trim();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key phải dài 8-100 ký tự và chỉ gồm chữ, số, dấu chấm, gạch dưới, hai chấm hoặc gạch nối.',
      );
    }
    return key;
  }

  private hashCreateRequest(dto: CreateBookingDto): string {
    return createHash('sha256').update(JSON.stringify({
      room_type_id: dto.room_type_id,
      check_in_date: dto.check_in_date,
      check_out_date: dto.check_out_date,
      total_of_special_requests: dto.total_of_special_requests,
      guest_count: dto.guest_count ?? 1,
      quote_id: dto.quote_id ?? null,
    })).digest('hex');
  }

  private async lockIdempotencyKey(
    manager: EntityManager,
    customerId: string,
    idempotencyKey: string,
  ): Promise<void> {
    await manager.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`hotelai-booking-idempotency:${customerId}:${idempotencyKey}`],
    );
  }

  private async findIdempotentBooking(
    manager: EntityManager,
    customerId: string,
    idempotencyKey: string,
  ): Promise<IdempotentBookingRow | null> {
    const rows = await manager.query(
      `SELECT request.request_hash,
              booking.booking_id,
              quote.quote_id,
              booking.customer_id,
              booking.check_in_date::text,
              booking.check_out_date::text,
              booking.guest_count,
              booking.status,
              booking.policy_version,
              booking.deposit_required,
              booking.checkout_payment_required,
              booking.pending_expires_at,
              booking.lifecycle_version,
              (SELECT COALESCE(SUM(amount), 0) FROM payment_transactions
               WHERE booking_id = booking.booking_id AND transaction_type = 'Payment') AS paid_amount,
              (SELECT COALESCE(SUM(amount), 0) FROM payment_transactions
               WHERE booking_id = booking.booking_id AND transaction_type = 'Refund') AS refunded_amount,
              booking.checked_in_at,
              booking.checked_in_by,
              booking.checked_out_at,
              booking.checked_out_by,
              booking.created_at,
              detail.room_id,
              detail.room_number_snapshot AS room_number,
              detail.applied_price AS nightly_price,
              (booking.check_out_date - booking.check_in_date) AS nights,
              detail.applied_price * (booking.check_out_date - booking.check_in_date) AS total_price,
              pricing_log.ai_multiplier,
              pricing_log.ai_model_version,
              pricing_log.ai_training_run_id,
              pricing_log.ai_feature_contract_version,
              pricing_log.pricing_source,
              pricing_log.settings_version
       FROM booking_create_requests request
       INNER JOIN bookings booking ON booking.booking_id = request.booking_id
       INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
       INNER JOIN daily_pricing_logs pricing_log ON pricing_log.booking_id = booking.booking_id
       LEFT JOIN pricing_quotes quote ON quote.booking_id = booking.booking_id
       WHERE request.customer_id = $1::uuid
         AND request.idempotency_key = $2`,
      [customerId, idempotencyKey],
    ) as IdempotentBookingRow[];
    return rows[0] ?? null;
  }

  private assertIdempotentReplay(storedHash: string, requestHash: string): void {
    if (storedHash !== requestHash) {
      throw new ConflictException('Idempotency-Key đã được dùng cho một yêu cầu đặt phòng khác.');
    }
  }

  private assertGuestCapacity(guestCount: number, capacity: number): void {
    if (guestCount > capacity) {
      throw new BadRequestException(
        `Loại phòng đã chọn chỉ chứa tối đa ${capacity} khách.`,
      );
    }
  }

  private mapIdempotentBooking(row: IdempotentBookingRow): CreatedBooking {
    const nightlyPrice = Number(row.nightly_price);
    const totalPrice = Number(row.total_price);
    const booking = Object.assign(new Booking(), {
      booking_id: row.booking_id,
      customer_id: row.customer_id,
      check_in_date: row.check_in_date,
      check_out_date: row.check_out_date,
      guest_count: Number(row.guest_count),
      status: row.status,
      policy_version: row.policy_version,
      deposit_required: Number(row.deposit_required),
      checkout_payment_required: row.checkout_payment_required,
      pending_expires_at: row.pending_expires_at,
      lifecycle_version: Number(row.lifecycle_version),
      checked_in_at: row.checked_in_at,
      checked_in_by: row.checked_in_by,
      checked_out_at: row.checked_out_at,
      checked_out_by: row.checked_out_by,
      created_at: row.created_at,
    });
    return {
      booking,
      quote_id: row.quote_id,
      room_id: Number(row.room_id),
      room_number: row.room_number,
      applied_price: nightlyPrice,
      nightly_price: nightlyPrice,
      nights: Number(row.nights),
      total_price: totalPrice,
      ai_multiplier: Number(row.ai_multiplier),
      ai_model_version: row.ai_model_version,
      ai_training_run_id: row.ai_training_run_id,
      ai_feature_contract_version: row.ai_feature_contract_version,
      pricing_source: row.pricing_source,
      settings_version: Number(row.settings_version),
      payment_status: ['Canceled', 'Expired', 'NoShow'].includes(row.status)
        ? (Number(row.paid_amount) > Number(row.refunded_amount) ? 'RefundPending'
          : Number(row.refunded_amount) > 0 ? 'Refunded' : 'Unpaid')
        : Number(row.paid_amount) - Number(row.refunded_amount) >= totalPrice ? 'Paid'
          : Number(row.paid_amount) > 0 ? 'PartiallyPaid' : 'Unpaid',
      paid_amount: Number(row.paid_amount),
      balance_due: ['Canceled', 'Expired', 'NoShow'].includes(row.status)
        ? 0 : Math.max(0, totalPrice - Number(row.paid_amount) + Number(row.refunded_amount)),
    };
  }

}
