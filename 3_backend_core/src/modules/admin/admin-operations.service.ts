import { ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { BookingWorkflowService } from '../booking-workflow/booking-workflow.service';
import { OutboxService } from '../../infrastructure/outbox.service';
import { AdminPricingService, PricingSettingView } from './admin-pricing.service';
import { AdminBookingsQueryDto, AdminBookingStatus } from './dto/admin-bookings.dto';
import {
  TapeChartBookingSlot,
  TapeChartDayColumn,
  TapeChartMetrics,
  TapeChartQueryDto,
  TapeChartRoomRow,
  TapeChartView,
} from './dto/tape-chart.dto';

export type AdminBookingView = {
  booking_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  customer_nationality: string | null;
  check_in_date: string;
  check_out_date: string;
  guest_count: number;
  status: AdminBookingStatus;
  created_at: Date;
  checked_in_at: Date | null;
  checked_in_by: string | null;
  checked_out_at: Date | null;
  checked_out_by: string | null;
  room_id: number;
  room_number_snapshot: string;
  room_type_name_snapshot: string;
  room_assignment_version: number;
  room_current_status: string;
  housekeeping_status: string;
  housekeeping_version: number;
  housekeeping_updated_at: Date;
  room_type_id: number | null;
  nightly_price: number;
  nights: number;
  total_price: number;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
  payment_status: 'Unpaid' | 'PartiallyPaid' | 'Paid' | 'RefundPending' | 'PartiallyRefunded' | 'Refunded';
  base_price: number | null;
  ai_multiplier: number | null;
  pricing_source: 'ai' | 'base' | null;
  settings_version: number | null;
  ai_enabled: boolean | null;
  ai_model_version: string | null;
  ai_training_run_id: string | null;
  ai_feature_contract_version: string | null;
  can_cancel: boolean;
  can_check_in: boolean;
  can_check_out: boolean;
  can_complete: boolean;
  can_mark_no_show: boolean;
  lifecycle_version: number;
  policy_version: number | null;
  deposit_required: number;
  checkout_payment_required: boolean;
  pending_expires_at: Date | null;
  credit_authorized: number;
};

export type AdminDashboardView = {
  business_date: string;
  timezone: string;
  summary: {
    total_bookings: number;
    confirmed_bookings: number;
    checked_in_bookings: number;
    completed_bookings: number;
    canceled_bookings: number;
    pending_bookings: number;
    expired_bookings: number;
    no_show_bookings: number;
    booking_value: number;
    customer_count: number;
    room_count: number;
    revpar: null;
    booking_value_per_room: number;
    occupancy_rate: number;
    forecasted_demand: null;
    forecast_status: 'not_available';
  };
  monthly_revenue: Array<{
    month: string;
    booking_count: number;
    booking_value: number;
  }>;
  room_status_breakdown: Array<{
    status: 'Available' | 'Occupied' | 'Maintenance';
    room_count: number;
  }>;
  pricing_setting: PricingSettingView;
  recent_bookings: AdminBookingView[];
};

type BookingFilter = {
  status?: AdminBookingStatus;
  search?: string;
};

type LockedStayContext = {
  booking_id: string;
  customer_id: string;
  check_in_date: string;
  check_out_date: string;
  status: AdminBookingStatus;
  room_id: number;
  room_type_id: number;
};

@Injectable()
export class AdminOperationsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly adminPricing: AdminPricingService,
    private readonly outbox: OutboxService,
    private readonly workflow: BookingWorkflowService,
  ) {}

  async listBookings(query: AdminBookingsQueryDto): Promise<{
    data: AdminBookingView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const businessDate = this.getBusinessDate();
    const dataQuery = this.buildBookingFilter(query, 2);
    const countQuery = this.buildBookingFilter(query, 1);
    const dataParameters: unknown[] = [businessDate, ...dataQuery.parameters];
    const limitParameter = dataParameters.push(query.limit);
    const offsetParameter = dataParameters.push(query.offset);

    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `${this.bookingSelectSql()}
         ${dataQuery.whereSql}
         ORDER BY booking.created_at DESC, booking.booking_id DESC
         LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        dataParameters,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM bookings booking
         INNER JOIN customers customer ON customer.customer_id = booking.customer_id
         INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
         ${countQuery.whereSql}`,
        countQuery.parameters,
      ),
    ]);

    return {
      data: rows.map((row: Record<string, unknown>) => this.mapBooking(row)),
      total: Number(countRows[0].total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async completeBooking(_bookingId: string): Promise<AdminBookingView> {
    throw new GoneException('Thao tác hoàn tất trực tiếp đã ngừng sử dụng. Khách đang lưu trú phải trả phòng; khách không đến phải dùng no-show có lý do và phiên bản.');
  }

  async checkInBooking(bookingId: string, actorId: string): Promise<AdminBookingView> {
    const businessDate = this.getBusinessDate();

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [941, 1]);
      const stay = await this.lockStayContext(manager, bookingId);

      if (stay.status === AdminBookingStatus.CheckedIn) {
        throw new ConflictException('Booking đã được nhận phòng trước đó.');
      }
      if (stay.status === AdminBookingStatus.Canceled) {
        throw new ConflictException('Không thể nhận phòng cho booking đã hủy.');
      }
      if (stay.status === AdminBookingStatus.Completed) {
        throw new ConflictException('Không thể nhận phòng cho booking đã hoàn tất.');
      }
      if (stay.status !== AdminBookingStatus.Confirmed) {
        throw new ConflictException('Chỉ booking Confirmed mới được nhận phòng.');
      }
      const finances = await this.workflow.financialStatus(bookingId, manager);
      if (finances.deposit_due > 0) throw new ConflictException('Booking chưa nhận đủ tiền cọc.');
      if (stay.check_in_date > businessDate) {
        throw new ConflictException('Chưa đến ngày nhận phòng.');
      }
      if (stay.check_out_date <= businessDate) {
        throw new ConflictException('Booking đã qua thời gian lưu trú và không thể nhận phòng.');
      }

      await manager.query('SELECT pg_advisory_xact_lock($1)', [stay.room_type_id]);
      const roomRows = await manager.query(
        `SELECT room_id,
                current_status,
                housekeeping_status,
                occupancy_booking_id
         FROM rooms
         WHERE room_id = $1
         FOR UPDATE`,
        [stay.room_id],
      );
      const room = roomRows[0] as
        | {
          room_id: number;
          current_status: string;
          housekeeping_status: string;
          occupancy_booking_id: string | null;
        }
        | undefined;
      if (!room) throw new NotFoundException('Không tìm thấy phòng vật lý của booking.');
      if (room.current_status === 'Maintenance') {
        throw new ConflictException('Phòng đang bảo trì và chưa thể nhận khách.');
      }
      if (room.current_status !== 'Available' || room.occupancy_booking_id !== null) {
        throw new ConflictException('Phòng hiện không sẵn sàng để nhận khách.');
      }
      if (room.housekeeping_status !== 'Ready') {
        throw new ConflictException('Phòng chưa được housekeeping xác nhận Ready.');
      }

      const updatedBookings = await manager.query(
        `UPDATE bookings
         SET status = 'CheckedIn',
             checked_in_at = CURRENT_TIMESTAMP,
             checked_in_by = $2::uuid
         WHERE booking_id = $1::uuid AND status = 'Confirmed'
         RETURNING checked_in_at`,
        [bookingId, actorId],
      );
      if (this.affectedRows(updatedBookings) !== 1) {
        throw new ConflictException('Trạng thái booking đã thay đổi; vui lòng tải lại dữ liệu.');
      }
      const updatedRooms = await manager.query(
        `UPDATE rooms
         SET current_status = 'Occupied', occupancy_booking_id = $2::uuid
         WHERE room_id = $1
           AND current_status = 'Available'
           AND housekeeping_status = 'Ready'
           AND occupancy_booking_id IS NULL
         RETURNING room_id`,
        [stay.room_id, bookingId],
      );
      if (this.affectedRows(updatedRooms) !== 1) {
        throw new ConflictException('Trạng thái phòng đã thay đổi; vui lòng tải lại dữ liệu.');
      }

      const booking = await this.getBookingById(bookingId, businessDate, manager);
      await this.outbox.enqueue(manager, {
        aggregateType: 'booking',
        aggregateId: bookingId,
        eventType: 'booking.checked-in.v1',
        payload: {
          booking_id: bookingId,
          customer_id: booking.customer_id,
          room_id: booking.room_id,
          checked_in_by: actorId,
          checked_in_at: booking.checked_in_at?.toISOString() ?? null,
          check_in_date: booking.check_in_date,
          check_out_date: booking.check_out_date,
          guest_count: booking.guest_count,
        },
      });
      return booking;
    });
  }

  async checkOutBooking(bookingId: string, actorId: string): Promise<AdminBookingView> {
    const businessDate = this.getBusinessDate();

    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [941, 1]);
      const stay = await this.lockStayContext(manager, bookingId);

      if (stay.status === AdminBookingStatus.Confirmed) {
        throw new ConflictException('Booking chưa được nhận phòng.');
      }
      if (stay.status === AdminBookingStatus.Canceled) {
        throw new ConflictException('Không thể trả phòng cho booking đã hủy.');
      }
      if (stay.status === AdminBookingStatus.Completed) {
        throw new ConflictException('Booking đã được trả phòng hoặc hoàn tất trước đó.');
      }

      if (stay.status !== AdminBookingStatus.CheckedIn) {
        throw new ConflictException('Chỉ booking đang lưu trú mới được trả phòng.');
      }
      await this.workflow.assertCheckoutAllowed(manager, bookingId);
      await manager.query('SELECT pg_advisory_xact_lock($1)', [stay.room_type_id]);
      const roomRows = await manager.query(
        `SELECT room_id,
                current_status,
                housekeeping_status,
                housekeeping_version,
                occupancy_booking_id
         FROM rooms
         WHERE room_id = $1
         FOR UPDATE`,
        [stay.room_id],
      );
      const room = roomRows[0] as
        | {
          room_id: number;
          current_status: string;
          housekeeping_status: string;
          housekeeping_version: number | string;
          occupancy_booking_id: string | null;
        }
        | undefined;
      if (!room) throw new NotFoundException('Không tìm thấy phòng vật lý của booking.');
      if (room.current_status !== 'Occupied' || room.occupancy_booking_id !== bookingId) {
        throw new ConflictException('Phòng không còn được gắn với booking này; cần kiểm tra dữ liệu vận hành.');
      }
      if (room.housekeeping_status !== 'Ready') {
        throw new ConflictException('Trạng thái housekeeping của phòng đang lưu trú không hợp lệ.');
      }

      const housekeepingFromVersion = Number(room.housekeeping_version);
      const housekeepingReason = 'Checkout completed; room requires cleaning.';
      const housekeepingIdempotencyKey = `checkout:${bookingId}`;
      const housekeepingEvents = await manager.query(
        `INSERT INTO room_housekeeping_events (
           room_id,
           from_status,
           to_status,
           from_version,
           to_version,
           reason,
           idempotency_key,
           changed_by
         ) VALUES ($1, 'Ready', 'Dirty', $2, $3, $4, $5, $6::uuid)
         RETURNING event_id, occurred_at`,
        [
          stay.room_id,
          housekeepingFromVersion,
          housekeepingFromVersion + 1,
          housekeepingReason,
          housekeepingIdempotencyKey,
          actorId,
        ],
      );

      const updatedBookings = await manager.query(
        `UPDATE bookings
         SET status = 'Completed',
             checked_out_at = CURRENT_TIMESTAMP,
             checked_out_by = $2::uuid
         WHERE booking_id = $1::uuid AND status = 'CheckedIn'
         RETURNING checked_out_at`,
        [bookingId, actorId],
      );
      if (this.affectedRows(updatedBookings) !== 1) {
        throw new ConflictException('Trạng thái booking đã thay đổi; vui lòng tải lại dữ liệu.');
      }
      const updatedRooms = await manager.query(
        `UPDATE rooms
         SET current_status = 'Available',
             occupancy_booking_id = NULL,
             housekeeping_status = 'Dirty',
             housekeeping_version = housekeeping_version + 1
         WHERE room_id = $1
           AND current_status = 'Occupied'
           AND housekeeping_status = 'Ready'
           AND housekeeping_version = $3
           AND occupancy_booking_id = $2::uuid
         RETURNING room_id, housekeeping_version, housekeeping_updated_at`,
        [stay.room_id, bookingId, housekeepingFromVersion],
      );
      if (this.affectedRows(updatedRooms) !== 1) {
        throw new ConflictException('Trạng thái phòng đã thay đổi; vui lòng tải lại dữ liệu.');
      }

      const booking = await this.getBookingById(bookingId, businessDate, manager);
      await this.outbox.enqueue(manager, {
        aggregateType: 'booking',
        aggregateId: bookingId,
        eventType: 'booking.checked-out.v1',
        payload: {
          booking_id: bookingId,
          customer_id: booking.customer_id,
          room_id: booking.room_id,
          checked_out_by: actorId,
          checked_out_at: booking.checked_out_at?.toISOString() ?? null,
          check_in_date: booking.check_in_date,
          check_out_date: booking.check_out_date,
          guest_count: booking.guest_count,
          total_price: booking.total_price,
        },
      });
      await this.outbox.enqueue(manager, {
        aggregateType: 'room',
        aggregateId: String(stay.room_id),
        eventType: 'room.housekeeping-status-changed.v1',
        payload: {
          room_id: stay.room_id,
          booking_id: bookingId,
          from_status: 'Ready',
          to_status: 'Dirty',
          from_version: housekeepingFromVersion,
          to_version: housekeepingFromVersion + 1,
          reason: housekeepingReason,
          changed_by: actorId,
          housekeeping_event_id: housekeepingEvents[0]?.event_id ?? null,
          occurred_at: housekeepingEvents[0]?.occurred_at ?? null,
        },
      });
      return booking;
    });
  }

  async getDashboard(months: number): Promise<AdminDashboardView> {
    const businessDate = this.getBusinessDate();
    const timezone = this.getTimezone();

    const [summaryRows, monthlyRows, roomStatusRows, pricingSetting, recentRows] = await Promise.all([
      this.dataSource.query(
        `WITH detail_values AS (
           SELECT detail.booking_id,
                  SUM(detail.applied_price)::numeric AS nightly_value
           FROM booking_details detail
           GROUP BY detail.booking_id
         ),
         booking_values AS (
           SELECT booking.booking_id,
                  booking.status,
                  COALESCE(detail_values.nightly_value, 0)
                    * (booking.check_out_date - booking.check_in_date) AS booking_value
           FROM bookings booking
           LEFT JOIN detail_values ON detail_values.booking_id = booking.booking_id
         )
         SELECT COUNT(*)::int AS total_bookings,
                COUNT(*) FILTER (WHERE status = 'Confirmed')::int AS confirmed_bookings,
                COUNT(*) FILTER (WHERE status = 'CheckedIn')::int AS checked_in_bookings,
                COUNT(*) FILTER (WHERE status = 'Completed')::int AS completed_bookings,
                COUNT(*) FILTER (WHERE status = 'Canceled')::int AS canceled_bookings,
                COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending_bookings,
                COUNT(*) FILTER (WHERE status = 'Expired')::int AS expired_bookings,
                COUNT(*) FILTER (WHERE status = 'NoShow')::int AS no_show_bookings,
                COALESCE(SUM(booking_value) FILTER (WHERE status IN ('Confirmed', 'CheckedIn', 'Completed')), 0) AS booking_value,
                (SELECT COUNT(*)::int FROM customers WHERE role = 'customer') AS customer_count,
                (SELECT COUNT(*)::int FROM rooms) AS room_count
         FROM booking_values`,
      ),
      this.dataSource.query(
        `WITH bounds AS (
           SELECT date_trunc('month', timezone($1, CURRENT_TIMESTAMP))::date AS current_month
         ),
         months AS (
           SELECT generate_series(
                    current_month - (($2::int - 1) * INTERVAL '1 month'),
                    current_month,
                    INTERVAL '1 month'
                  )::date AS month_start
           FROM bounds
         ),
         booking_values AS (
           SELECT booking.booking_id,
                  date_trunc(
                    'month',
                    timezone($1, booking.created_at AT TIME ZONE 'UTC')
                  )::date AS month_start,
                  SUM(detail.applied_price)
                    * (booking.check_out_date - booking.check_in_date) AS booking_value
           FROM bookings booking
           INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
           CROSS JOIN bounds
           WHERE booking.status IN ('Confirmed', 'CheckedIn', 'Completed')
             AND booking.created_at >= (
               ((current_month - (($2::int - 1) * INTERVAL '1 month'))::timestamp AT TIME ZONE $1)
               AT TIME ZONE 'UTC'
             )
             AND booking.created_at < (
               ((current_month + INTERVAL '1 month')::timestamp AT TIME ZONE $1)
               AT TIME ZONE 'UTC'
             )
           GROUP BY booking.booking_id, booking.created_at,
                    booking.check_in_date, booking.check_out_date
         ),
         monthly_values AS (
           SELECT month_start,
                  COUNT(*)::int AS booking_count,
                  COALESCE(SUM(booking_value), 0) AS booking_value
           FROM booking_values
           GROUP BY month_start
         )
         SELECT to_char(months.month_start, 'YYYY-MM') AS month,
                COALESCE(monthly_values.booking_count, 0)::int AS booking_count,
                COALESCE(monthly_values.booking_value, 0) AS booking_value
         FROM months
         LEFT JOIN monthly_values ON monthly_values.month_start = months.month_start
         ORDER BY months.month_start ASC`,
        [timezone, months],
      ),
      this.dataSource.query(
        `WITH statuses(status, sort_order) AS (
           VALUES ('Available'::varchar, 1),
                  ('Occupied'::varchar, 2),
                  ('Maintenance'::varchar, 3)
         )
         SELECT statuses.status,
                COUNT(room.room_id)::int AS room_count
         FROM statuses
         LEFT JOIN rooms room ON room.current_status = statuses.status
         GROUP BY statuses.status, statuses.sort_order
         ORDER BY statuses.sort_order`,
      ),
      this.adminPricing.getSetting(),
      this.queryRecentBookings(businessDate),
    ]);

    const summary = summaryRows[0] as Record<string, unknown>;
    const roomCount = Number(summary.room_count) || 0;
    const bookingValue = Number(summary.booking_value) || 0;
    const occupiedRooms = roomStatusRows.find(r => r.status === 'Occupied')?.room_count || 0;
    
    const bookingValuePerRoom = roomCount > 0 ? bookingValue / roomCount : 0;
    // Occupancy Rate = (Occupied Rooms / Total Rooms) * 100
    const occupancyRate = roomCount > 0 ? (Number(occupiedRooms) / roomCount) * 100 : 0;
    
    // No evaluated forecast or matching revenue/available-room-night period yet.

    return {
      business_date: businessDate,
      timezone,
      summary: {
        total_bookings: Number(summary.total_bookings),
        confirmed_bookings: Number(summary.confirmed_bookings),
        checked_in_bookings: Number(summary.checked_in_bookings),
        completed_bookings: Number(summary.completed_bookings),
        canceled_bookings: Number(summary.canceled_bookings),
        pending_bookings: Number(summary.pending_bookings),
        expired_bookings: Number(summary.expired_bookings),
        no_show_bookings: Number(summary.no_show_bookings),
        booking_value: bookingValue,
        customer_count: Number(summary.customer_count),
        room_count: roomCount,
        revpar: null,
        booking_value_per_room: Math.round(bookingValuePerRoom),
        occupancy_rate: Math.round(occupancyRate * 10) / 10,
        forecasted_demand: null,
        forecast_status: 'not_available',
      },
      monthly_revenue: monthlyRows.map((row: Record<string, unknown>) => ({
        month: String(row.month),
        booking_count: Number(row.booking_count),
        booking_value: Number(row.booking_value),
      })),
      room_status_breakdown: roomStatusRows.map((row: Record<string, unknown>) => ({
        status: row.status as 'Available' | 'Occupied' | 'Maintenance',
        room_count: Number(row.room_count),
      })),
      pricing_setting: pricingSetting,
      recent_bookings: recentRows.map((row: Record<string, unknown>) => this.mapBooking(row)),
    };
  }

  private async queryRecentBookings(businessDate: string): Promise<Record<string, unknown>[]> {
    return this.dataSource.query(
      `${this.bookingSelectSql()}
       ORDER BY booking.created_at DESC, booking.booking_id DESC
       LIMIT 5`,
      [businessDate],
    );
  }

  private async getBookingById(
    bookingId: string,
    businessDate: string,
    manager?: EntityManager,
  ): Promise<AdminBookingView> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query(
      `${this.bookingSelectSql()}
       WHERE booking.booking_id = $2::uuid`,
      [businessDate, bookingId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy chi tiết đặt phòng.');
    return this.mapBooking(rows[0]);
  }

  private bookingSelectSql(): string {
    return `SELECT booking.booking_id,
                   booking.customer_id,
                   customer.full_name AS customer_name,
                   customer.email AS customer_email,
                   customer.phone AS customer_phone,
                   customer.nationality AS customer_nationality,
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
                   COALESCE(credit.authorized_amount, 0) AS credit_authorized,
                   booking.checked_in_at,
                   booking.checked_in_by,
                   booking.checked_out_at,
                   booking.checked_out_by,
                   detail.room_id,
                   detail.room_number_snapshot,
                   detail.room_type_name_snapshot,
                   detail.room_assignment_version,
                   room.current_status AS room_current_status,
                   room.housekeeping_status,
                   room.housekeeping_version,
                   room.housekeeping_updated_at,
                   pricing_log.type_id AS room_type_id,
                   detail.applied_price AS nightly_price,
                   (booking.check_out_date - booking.check_in_date) AS nights,
                   detail.applied_price
                     * (booking.check_out_date - booking.check_in_date) AS total_price,
                   COALESCE(payment_ledger.paid_amount, 0) AS paid_amount,
                   COALESCE(payment_ledger.refunded_amount, 0) AS refunded_amount,
                   COALESCE(payment_ledger.paid_amount, 0)
                     - COALESCE(payment_ledger.refunded_amount, 0) AS net_paid,
                   CASE WHEN booking.status IN ('Canceled', 'Expired', 'NoShow') THEN 0
                        ELSE GREATEST(
                          detail.applied_price * (booking.check_out_date - booking.check_in_date)
                            - (COALESCE(payment_ledger.paid_amount, 0)
                               - COALESCE(payment_ledger.refunded_amount, 0)),
                          0
                        ) END AS balance_due,
                   CASE WHEN booking.status IN ('Canceled', 'Expired', 'NoShow')
                        THEN GREATEST(
                          COALESCE(payment_ledger.paid_amount, 0)
                            - COALESCE(payment_ledger.refunded_amount, 0),
                          0
                        ) ELSE 0 END AS refund_due,
                   CASE
                     WHEN booking.status IN ('Canceled', 'Expired', 'NoShow')
                       AND COALESCE(payment_ledger.paid_amount, 0)
                           - COALESCE(payment_ledger.refunded_amount, 0) > 0
                       THEN 'RefundPending'
                     WHEN booking.status IN ('Canceled', 'Expired', 'NoShow') AND COALESCE(payment_ledger.refunded_amount, 0) > 0
                       THEN 'Refunded'
                     WHEN COALESCE(payment_ledger.paid_amount, 0)
                           - COALESCE(payment_ledger.refunded_amount, 0)
                            >= detail.applied_price * (booking.check_out_date - booking.check_in_date)
                       THEN 'Paid'
                     WHEN COALESCE(payment_ledger.refunded_amount, 0) > 0
                       THEN 'PartiallyRefunded'
                     WHEN COALESCE(payment_ledger.paid_amount, 0) > 0
                       THEN 'PartiallyPaid'
                     ELSE 'Unpaid'
                   END AS payment_status,
                   pricing_log.base_price,
                   pricing_log.ai_multiplier,
                   pricing_log.pricing_source,
                   pricing_log.settings_version,
                   pricing_log.ai_enabled,
                   pricing_log.ai_model_version,
                   pricing_log.ai_training_run_id,
                   pricing_log.ai_feature_contract_version,
                   ((booking.status = 'Confirmed' AND booking.check_in_date > $1::date)
                     OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp())) AS can_cancel,
                   booking.status = 'Confirmed'
                     AND COALESCE(payment_ledger.paid_amount, 0)
                       - COALESCE(payment_ledger.refunded_amount, 0) >= booking.deposit_required
                     AND booking.check_in_date <= $1::date
                     AND booking.check_out_date > $1::date
                     AND room.current_status = 'Available'
                     AND room.occupancy_booking_id IS NULL
                     AND room.housekeeping_status = 'Ready' AS can_check_in,
                   booking.status = 'CheckedIn'
                     AND (NOT booking.checkout_payment_required OR
                       detail.applied_price * (booking.check_out_date - booking.check_in_date)
                         - COALESCE(payment_ledger.paid_amount, 0) + COALESCE(payment_ledger.refunded_amount, 0)
                         <= COALESCE(credit.authorized_amount, 0)) AS can_check_out,
                   false AS can_complete,
                   booking.status = 'Confirmed' AND booking.check_in_date < $1::date AS can_mark_no_show
            FROM bookings booking
            INNER JOIN customers customer ON customer.customer_id = booking.customer_id
            INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
            INNER JOIN rooms room ON room.room_id = detail.room_id
            LEFT JOIN booking_credit_authorizations credit ON credit.booking_id = booking.booking_id
            LEFT JOIN daily_pricing_logs pricing_log ON pricing_log.booking_id = booking.booking_id
            LEFT JOIN (
              SELECT payment.booking_id,
                     COALESCE(SUM(payment.amount) FILTER (
                       WHERE payment.transaction_type = 'Payment'
                     ), 0) AS paid_amount,
                     COALESCE(SUM(payment.amount) FILTER (
                       WHERE payment.transaction_type = 'Refund'
                     ), 0) AS refunded_amount
              FROM payment_transactions payment
              GROUP BY payment.booking_id
            ) payment_ledger ON payment_ledger.booking_id = booking.booking_id`;
  }

  private buildBookingFilter(
    filter: BookingFilter,
    firstParameter: number,
  ): { whereSql: string; parameters: unknown[] } {
    const clauses: string[] = [];
    const parameters: unknown[] = [];

    if (filter.status !== undefined) {
      clauses.push(`booking.status = $${firstParameter + parameters.length}`);
      parameters.push(filter.status);
    }

    if (filter.search !== undefined) {
      const searchParameter = firstParameter + parameters.length;
      clauses.push(`(
        customer.full_name ILIKE $${searchParameter} ESCAPE '\\'
        OR customer.email ILIKE $${searchParameter} ESCAPE '\\'
        OR booking.booking_id::text ILIKE $${searchParameter} ESCAPE '\\'
        OR detail.room_number_snapshot ILIKE $${searchParameter} ESCAPE '\\'
        OR detail.room_type_name_snapshot ILIKE $${searchParameter} ESCAPE '\\'
      )`);
      parameters.push(`%${this.escapeLikePattern(filter.search)}%`);
    }

    return {
      whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
      parameters,
    };
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/[\\%_]/g, '\\$&');
  }

  private mapBooking(row: Record<string, unknown>): AdminBookingView {
    return {
      booking_id: String(row.booking_id),
      customer_id: String(row.customer_id),
      customer_name: String(row.customer_name),
      customer_email: String(row.customer_email),
      customer_phone: row.customer_phone === null ? null : String(row.customer_phone),
      customer_nationality:
        row.customer_nationality === null ? null : String(row.customer_nationality),
      check_in_date: String(row.check_in_date),
      check_out_date: String(row.check_out_date),
      guest_count: Number(row.guest_count),
      status: row.status as AdminBookingStatus,
      created_at: row.created_at as Date,
      lifecycle_version: Number(row.lifecycle_version),
      policy_version: row.policy_version == null ? null : Number(row.policy_version),
      deposit_required: Number(row.deposit_required),
      checkout_payment_required: row.checkout_payment_required === true,
      pending_expires_at: row.pending_expires_at as Date | null,
      credit_authorized: Number(row.credit_authorized),
      can_mark_no_show: row.can_mark_no_show === true,
      checked_in_at: row.checked_in_at === null ? null : row.checked_in_at as Date,
      checked_in_by: row.checked_in_by === null ? null : String(row.checked_in_by),
      checked_out_at: row.checked_out_at === null ? null : row.checked_out_at as Date,
      checked_out_by: row.checked_out_by === null ? null : String(row.checked_out_by),
      room_id: Number(row.room_id),
      room_number_snapshot: String(row.room_number_snapshot),
      room_type_name_snapshot: String(row.room_type_name_snapshot),
      room_assignment_version: Number(row.room_assignment_version),
      room_current_status: String(row.room_current_status),
      housekeeping_status: String(row.housekeeping_status),
      housekeeping_version: Number(row.housekeeping_version),
      housekeeping_updated_at: row.housekeeping_updated_at as Date,
      room_type_id: row.room_type_id === null ? null : Number(row.room_type_id),
      nightly_price: Number(row.nightly_price),
      nights: Number(row.nights),
      total_price: Number(row.total_price),
      paid_amount: Number(row.paid_amount),
      refunded_amount: Number(row.refunded_amount),
      net_paid: Number(row.net_paid),
      balance_due: Number(row.balance_due),
      refund_due: Number(row.refund_due),
      payment_status: row.payment_status as AdminBookingView['payment_status'],
      base_price: row.base_price === null ? null : Number(row.base_price),
      ai_multiplier: row.ai_multiplier === null ? null : Number(row.ai_multiplier),
      pricing_source: row.pricing_source as 'ai' | 'base' | null,
      settings_version: row.settings_version === null ? null : Number(row.settings_version),
      ai_enabled: row.ai_enabled === null ? null : Boolean(row.ai_enabled),
      ai_model_version:
        row.ai_model_version === null ? null : String(row.ai_model_version),
      ai_training_run_id:
        row.ai_training_run_id === null ? null : String(row.ai_training_run_id),
      ai_feature_contract_version:
        row.ai_feature_contract_version === null
          ? null
          : String(row.ai_feature_contract_version),
      can_cancel: row.can_cancel === true || String(row.can_cancel) === 'true',
      can_check_in: row.can_check_in === true || String(row.can_check_in) === 'true',
      can_check_out: row.can_check_out === true || String(row.can_check_out) === 'true',
      can_complete: row.can_complete === true || String(row.can_complete) === 'true',
    };
  }

  private async lockStayContext(
    manager: EntityManager,
    bookingId: string,
  ): Promise<LockedStayContext> {
    const rows = await manager.query(
      `SELECT booking.booking_id,
              booking.customer_id,
              booking.check_in_date::text,
              booking.check_out_date::text,
              booking.status,
              detail.room_id,
              room.type_id AS room_type_id
       FROM bookings booking
       INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
       INNER JOIN rooms room ON room.room_id = detail.room_id
       WHERE booking.booking_id = $1::uuid
       FOR UPDATE OF booking`,
      [bookingId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy đặt phòng.');
    return {
      booking_id: String(rows[0].booking_id),
      customer_id: String(rows[0].customer_id),
      check_in_date: String(rows[0].check_in_date),
      check_out_date: String(rows[0].check_out_date),
      status: rows[0].status as AdminBookingStatus,
      room_id: Number(rows[0].room_id),
      room_type_id: Number(rows[0].room_type_id),
    };
  }

  private affectedRows(result: unknown): number {
    if (!Array.isArray(result)) return 0;
    if (typeof result[1] === 'number') return result[1];
    if (Array.isArray(result[0])) return result[0].length;
    return result.length;
  }

  async getTapeChart(query: TapeChartQueryDto): Promise<TapeChartView> {
    const businessDate = this.getBusinessDate();
    const startDate = query.startDate || businessDate;
    const days = query.days || 14;

    const timeline: TapeChartDayColumn[] = [];
    for (let i = 0; i < days; i++) {
      const date = this.addDays(startDate, i);
      const dayOfWeek = this.getDayOfWeek(date);
      timeline.push({
        date,
        dayOfWeek,
        isToday: date === businessDate,
        isWeekend: dayOfWeek === 'CN' || dayOfWeek === 'T7',
      });
    }

    const endDateExclusive = this.addDays(startDate, days);
    const endDate = timeline[timeline.length - 1].date;

    const roomParams: unknown[] = [];
    let roomWhere = 'WHERE 1=1';
    if (query.roomTypeId) {
      roomParams.push(query.roomTypeId);
      roomWhere += ` AND room.type_id = $${roomParams.length}`;
    }
    if (query.floor) {
      roomParams.push(query.floor);
      roomWhere += ` AND (CASE WHEN room.room_number ~ '^[0-9]+$' AND length(room.room_number) >= 3 THEN SUBSTRING(room.room_number FROM 1 FOR length(room.room_number) - 2)::int ELSE 1 END) = $${roomParams.length}`;
    }

    const roomRows = await this.dataSource.query(
      `SELECT room.room_id,
              room.room_number,
              (CASE WHEN room.room_number ~ '^[0-9]+$' AND length(room.room_number) >= 3 THEN SUBSTRING(room.room_number FROM 1 FOR length(room.room_number) - 2)::int ELSE 1 END) AS floor,
              room.type_id AS room_type_id,
              room_type.name AS room_type_name,
              room_type.base_price,
              room.current_status,
              room.housekeeping_status,
              room.housekeeping_version,
              room.occupancy_booking_id
       FROM rooms room
       INNER JOIN room_types room_type ON room_type.type_id = room.type_id
       ${roomWhere}
       ORDER BY (CASE WHEN room.room_number ~ '^[0-9]+$' AND length(room.room_number) >= 3 THEN SUBSTRING(room.room_number FROM 1 FOR length(room.room_number) - 2)::int ELSE 1 END) ASC, room.room_number ASC`,
      roomParams,
    );


    const bookingRows = await this.dataSource.query(
      `SELECT booking.booking_id,
              booking.customer_id,
              customer.full_name AS customer_name,
              customer.phone AS customer_phone,
              customer.email AS customer_email,
              booking.status,
              booking.check_in_date::text AS check_in_date,
              booking.check_out_date::text AS check_out_date,
              (booking.check_out_date - booking.check_in_date) AS nights,
              detail.applied_price,
              detail.room_id,
              detail.room_assignment_version,
              (booking.status = 'Confirmed' 
                AND booking.check_in_date <= $3::date 
                AND booking.check_out_date > $3::date 
                AND room.housekeeping_status = 'Ready' 
                AND room.current_status = 'Available' 
                AND room.occupancy_booking_id IS NULL) AS can_check_in,
              (booking.status = 'CheckedIn') AS can_check_out
       FROM bookings booking
       INNER JOIN customers customer ON customer.customer_id = booking.customer_id
       INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
       INNER JOIN rooms room ON room.room_id = detail.room_id
       WHERE booking.status IN ('Confirmed', 'CheckedIn', 'Completed')
         AND booking.check_in_date < $2::date
         AND booking.check_out_date > $1::date
       ORDER BY booking.check_in_date ASC`,
      [startDate, endDateExclusive, businessDate],
    );


    const bookingsByRoom = new Map<number, Array<Record<string, unknown>>>();
    for (const row of bookingRows) {
      const rId = Number(row.room_id);
      if (!bookingsByRoom.has(rId)) {
        bookingsByRoom.set(rId, []);
      }
      bookingsByRoom.get(rId)!.push(row);
    }

    const rooms: TapeChartRoomRow[] = roomRows.map((room: Record<string, unknown>) => {
      const rId = Number(room.room_id);
      const roomBookings = bookingsByRoom.get(rId) || [];
      const slots: Record<string, TapeChartBookingSlot | null> = {};

      for (const day of timeline) {
        const d = day.date;
        const activeBooking = roomBookings.find(
          (b) => String(b.check_in_date) <= d && String(b.check_out_date) > d,
        );

        if (activeBooking) {
          const isStart = d === String(activeBooking.check_in_date);
          const isEnd = d === this.addDays(String(activeBooking.check_out_date), -1);
          slots[d] = {
            bookingId: String(activeBooking.booking_id),
            customerId: String(activeBooking.customer_id),
            customerName: String(activeBooking.customer_name),
            customerPhone: String(activeBooking.customer_phone || ''),
            customerEmail: String(activeBooking.customer_email || ''),
            status: activeBooking.status as AdminBookingStatus,
            checkInDate: String(activeBooking.check_in_date),
            checkOutDate: String(activeBooking.check_out_date),
            nights: Number(activeBooking.nights),
            appliedPrice: Number(activeBooking.applied_price),
            isStart,
            isEnd,
            isSpan: true,
            roomAssignmentVersion: Number(activeBooking.room_assignment_version),
            canCheckIn: Boolean(activeBooking.can_check_in),
            canCheckOut: Boolean(activeBooking.can_check_out),
          };
        } else {
          slots[d] = null;
        }
      }

      return {
        roomId: rId,
        roomNumber: String(room.room_number),
        floor: Number(room.floor),
        roomTypeId: Number(room.room_type_id),
        roomTypeName: String(room.room_type_name),
        basePrice: Number(room.base_price),
        currentStatus: room.current_status as 'Available' | 'Occupied' | 'Maintenance',
        housekeepingStatus: room.housekeeping_status as 'Ready' | 'Dirty' | 'Cleaning' | 'Inspected' | 'Maintenance',
        housekeepingVersion: Number(room.housekeeping_version),
        occupancyBookingId: room.occupancy_booking_id ? String(room.occupancy_booking_id) : null,
        slots,
      };
    });

    let occupiedRoomsToday = 0;
    let readyRooms = 0;
    let dirtyRooms = 0;
    let cleaningRooms = 0;
    let maintenanceRooms = 0;

    for (const r of roomRows) {
      if (r.current_status === 'Occupied' || r.occupancy_booking_id) {
        occupiedRoomsToday++;
      }
      if (r.housekeeping_status === 'Ready') readyRooms++;
      else if (r.housekeeping_status === 'Dirty') dirtyRooms++;
      else if (r.housekeeping_status === 'Cleaning') cleaningRooms++;
      else if (r.housekeeping_status === 'Maintenance' || r.current_status === 'Maintenance') maintenanceRooms++;
    }

    let arrivalsToday = 0;
    let departuresToday = 0;
    for (const b of bookingRows) {
      if (b.check_in_date === businessDate && b.status === 'Confirmed') {
        arrivalsToday++;
      }
      if (b.check_out_date === businessDate && (b.status === 'CheckedIn' || b.status === 'Completed')) {
        departuresToday++;
      }
    }

    const totalRooms = roomRows.length;
    const occupancyRateToday = totalRooms > 0 ? Math.round((occupiedRoomsToday / totalRooms) * 100) : 0;

    const metrics: TapeChartMetrics = {
      totalRooms,
      occupiedRoomsToday,
      occupancyRateToday,
      arrivalsToday,
      departuresToday,
      readyRooms,
      dirtyRooms,
      cleaningRooms,
      maintenanceRooms,
    };

    return {
      businessDate,
      startDate,
      endDate,
      days,
      timeline,
      metrics,
      rooms,
    };
  }

  private addDays(dateStr: string, days: number): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  private getDayOfWeek(dateStr: string): string {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
    return days[date.getUTCDay()];
  }

  private getTimezone(): string {
    return this.configService.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok');
  }

  private getBusinessDate(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: this.getTimezone(),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }
}
