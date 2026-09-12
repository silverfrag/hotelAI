import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AuthorizeBookingCreditDto, BookingWorkflowActionDto, BookingWorkflowPageDto, UpdateBookingPolicyDto } from './dto/booking-workflow.dto';

@Injectable()
export class BookingWorkflowService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastExpiryRun: Date | null = null;
  private expiryError = false;
  private readonly logger = new Logger(BookingWorkflowService.name);
  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService) {}

  async onModuleInit() {
    // Refuse to serve a partially migrated booking API.
    await this.dataSource.query('SELECT policy_version, lifecycle_version FROM bookings LIMIT 0');
    await this.getPolicy();
    const interval = Number(this.config.get('BOOKING_EXPIRY_POLL_MS', '15000'));
    if (!Number.isInteger(interval) || interval < 1000 || interval > 300000) {
      throw new Error('BOOKING_EXPIRY_POLL_MS must be between 1000 and 300000');
    }
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try { await this.expirePending(100); this.expiryError = false; }
      catch { this.expiryError = true; this.logger.error('Pending expiry failed; retrying on next interval.'); }
      finally { this.running = false; }
    };
    this.timer = setInterval(() => { void run(); }, interval);
    this.timer.unref();
    await run();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async getPolicy(manager?: EntityManager) {
    const rows = await (manager ?? this.dataSource).query('SELECT * FROM booking_policies WHERE policy_id = 1');
    if (!rows[0]) throw new NotFoundException('Chưa cấu hình chính sách booking.');
    return { ...rows[0], version: Number(rows[0].version), deposit_percent: Number(rows[0].deposit_percent), pending_ttl_minutes: Number(rows[0].pending_ttl_minutes) };
  }

  async snapshotForCreation(manager: EntityManager, totalPrice: number) {
    const rows = await manager.query(`SELECT *, clock_timestamp() AS snapshot_at
      FROM booking_policies WHERE policy_id = 1 FOR SHARE`);
    if (!rows[0]) throw new ConflictException('Chưa cấu hình chính sách booking.');
    const policy = rows[0];
    const deposit = Math.round(totalPrice * Number(policy.deposit_percent)) / 100;
    return {
      policy_version: Number(policy.version),
      deposit_required: deposit,
      checkout_payment_required: policy.require_full_payment_at_checkout === true,
      pending_expires_at: deposit > 0
        ? new Date(new Date(policy.snapshot_at).getTime() + Number(policy.pending_ttl_minutes) * 60000) : null,
      status: (deposit > 0 ? 'Pending' : 'Confirmed') as 'Pending' | 'Confirmed',
    };
  }

  async updatePolicy(dto: UpdateBookingPolicyDto, actorId: string) {
    if (dto.deposit_percent === undefined && dto.pending_ttl_minutes === undefined && dto.require_full_payment_at_checkout === undefined) {
      throw new BadRequestException('Cần ít nhất một thay đổi chính sách.');
    }
    return this.dataSource.transaction(async manager => {
      const rows = await manager.query(`UPDATE booking_policies SET
        deposit_percent = COALESCE($1, deposit_percent),
        pending_ttl_minutes = COALESCE($2, pending_ttl_minutes),
        require_full_payment_at_checkout = COALESCE($3, require_full_payment_at_checkout),
        updated_by = $4::uuid, reason = $5 WHERE policy_id = 1 AND version = $6 RETURNING policy_id`,
      [dto.deposit_percent, dto.pending_ttl_minutes, dto.require_full_payment_at_checkout, actorId, dto.reason, dto.expected_version]);
      if (!this.updated(rows)) throw new ConflictException('Chính sách đã thay đổi; hãy tải lại phiên bản mới.');
      return this.getPolicy(manager);
    });
  }

  async financialStatus(bookingId: string, manager?: EntityManager) {
    const rows = await (manager ?? this.dataSource).query(`SELECT booking.booking_id, booking.customer_id, booking.status,
      booking.check_in_date::text, booking.check_out_date::text, booking.lifecycle_version, booking.policy_version,
      booking.deposit_required, booking.checkout_payment_required, booking.pending_expires_at,
      booking.expired_at, booking.no_show_at,
      booking.status = 'Pending' AND booking.pending_expires_at <= clock_timestamp() AS hold_expired,
      COALESCE((SELECT SUM(applied_price) FROM booking_details WHERE booking_id = booking.booking_id), 0)
        * (booking.check_out_date - booking.check_in_date) AS booking_total,
      COALESCE((SELECT SUM(CASE WHEN transaction_type = 'Payment' THEN amount ELSE -amount END)
        FROM payment_transactions WHERE booking_id = booking.booking_id), 0) AS net_paid,
      COALESCE((SELECT authorized_amount FROM booking_credit_authorizations WHERE booking_id = booking.booking_id), 0) AS credit_authorized
      FROM bookings booking WHERE booking.booking_id = $1::uuid`, [bookingId]);
    if (!rows[0]) throw new NotFoundException('Không tìm thấy booking.');
    const row = rows[0];
    const total = Number(row.booking_total), net = Number(row.net_paid);
    const terminal = ['Canceled', 'Expired', 'NoShow'].includes(row.status);
    const due = terminal ? 0 : Math.round(Math.max(0, total - net) * 100) / 100;
    return { ...row, booking_total: total, net_paid: net, deposit_required: Number(row.deposit_required),
      deposit_due: terminal ? 0 : Math.max(0, Number(row.deposit_required) - net),
      balance_due: due, refund_due: terminal ? net : 0,
      credit_authorized: Number(row.credit_authorized),
      can_check_out: row.status === 'CheckedIn' && (!row.checkout_payment_required || due <= Number(row.credit_authorized)),
    };
  }

  async assertCheckoutAllowed(manager: EntityManager, bookingId: string) {
    const finances = await this.financialStatus(bookingId, manager);
    if (!finances.can_check_out) throw new ConflictException('Cần thanh toán công nợ hoặc phê duyệt hạn mức công nợ trước khi trả phòng.');
  }

  async confirmPending(bookingId: string, dto: BookingWorkflowActionDto, actor: string, key?: string) {
    return this.transition(bookingId, dto, actor, key, 'confirm');
  }
  async markNoShow(bookingId: string, dto: BookingWorkflowActionDto, actor: string, key?: string) {
    return this.transition(bookingId, dto, actor, key, 'no-show');
  }

  private async transition(bookingId: string, dto: BookingWorkflowActionDto, actor: string, rawKey: string | undefined, action: string) {
    const key = this.key(rawKey), hash = this.hash({ bookingId, actor, action, ...dto });
    return this.dataSource.transaction(async manager => {
      await this.lockKey(manager, key);
      const [existing] = await manager.query('SELECT request_hash, response FROM booking_workflow_requests WHERE idempotency_key = $1', [key]);
      if (existing) { this.checkHash(existing.request_hash, hash); return { replayed: true, booking: existing.response }; }
      await this.lockBooking(manager, bookingId);
      const current = await this.financialStatus(bookingId, manager);
      if (current.lifecycle_version !== dto.expected_version) throw new ConflictException('Phiên bản booking đã thay đổi.');
      await this.actorContext(manager, actor, dto.reason);
      if (action === 'confirm') {
        if (current.status !== 'Pending' || current.hold_expired || current.deposit_due > 0) {
          throw new ConflictException('Booking phải còn hạn Pending và đã nhận đủ cọc.');
        }
        await manager.query("UPDATE bookings SET status = 'Confirmed' WHERE booking_id = $1::uuid", [bookingId]);
      } else {
        const [{ business_date }] = await manager.query("SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS business_date", [this.timezone()]);
        if (current.status !== 'Confirmed' || current.check_in_date >= business_date) {
          throw new ConflictException('Chỉ đánh dấu NoShow cho booking Confirmed đã qua ngày nhận phòng.');
        }
        await manager.query(`UPDATE bookings SET status = 'NoShow', no_show_by = $2::uuid, no_show_reason = $3
          WHERE booking_id = $1::uuid`, [bookingId, actor, dto.reason]);
      }
      const booking = await this.financialStatus(bookingId, manager);
      await manager.query(`INSERT INTO booking_workflow_requests
        (booking_id, action, idempotency_key, request_hash, response, actor_id)
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::uuid)`, [bookingId, action, key, hash, JSON.stringify(booking), actor]);
      return { replayed: false, booking };
    });
  }

  async authorizeCredit(bookingId: string, dto: AuthorizeBookingCreditDto, actor: string, rawKey?: string) {
    const key = this.key(rawKey), hash = this.hash({ bookingId, actor, ...dto });
    return this.dataSource.transaction(async manager => {
      await this.lockKey(manager, key);
      const [existing] = await manager.query('SELECT * FROM booking_credit_authorizations WHERE idempotency_key = $1', [key]);
      if (existing) { this.checkHash(existing.request_hash, hash); return { replayed: true, authorization: this.creditView(existing) }; }
      await this.lockBooking(manager, bookingId);
      const current = await this.financialStatus(bookingId, manager);
      if (current.lifecycle_version !== dto.expected_version || current.status !== 'CheckedIn') {
        throw new ConflictException('Phê duyệt công nợ chỉ áp dụng cho khách đang lưu trú đúng phiên bản.');
      }
      if (dto.authorized_amount > current.balance_due) throw new ConflictException('Hạn mức vượt số dư còn nợ.');
      const [previous] = await manager.query('SELECT authorization_id FROM booking_credit_authorizations WHERE booking_id = $1::uuid', [bookingId]);
      if (previous) throw new ConflictException('Booking đã có phê duyệt công nợ.');
      const [authorization] = await manager.query(`INSERT INTO booking_credit_authorizations
        (booking_id, authorized_amount, reason, idempotency_key, request_hash, authorized_by)
        VALUES ($1::uuid, $2, $3, $4, $5, $6::uuid) RETURNING *`, [bookingId, dto.authorized_amount, dto.reason, key, hash, actor]);
      return { replayed: false, authorization: this.creditView(authorization) };
    });
  }

  async expirePending(limit = 100, actor?: string) {
    const result = await this.dataSource.transaction(async manager => {
      await this.actorContext(manager, actor, 'Pending deposit hold expired');
      const rows = await manager.query(`SELECT booking_id FROM bookings
        WHERE status = 'Pending' AND pending_expires_at <= clock_timestamp()
        ORDER BY pending_expires_at, booking_id FOR UPDATE SKIP LOCKED LIMIT $1`, [limit]);
      const ids = rows.map((row: { booking_id: string }) => row.booking_id);
      if (ids.length) await manager.query(`UPDATE bookings SET status = 'Expired'
        WHERE booking_id = ANY($1::uuid[]) AND status = 'Pending' AND pending_expires_at <= clock_timestamp()`, [ids]);
      return { expired_count: ids.length, booking_ids: ids };
    });
    this.lastExpiryRun = new Date();
    return result;
  }

  async readiness() {
    const [row] = await this.dataSource.query(`SELECT
      COUNT(*) FILTER (WHERE status = 'Pending')::int AS pending_count,
      COUNT(*) FILTER (WHERE status = 'Pending' AND pending_expires_at <= clock_timestamp())::int AS expired_backlog,
      MIN(pending_expires_at) FILTER (WHERE status = 'Pending' AND pending_expires_at <= clock_timestamp()) AS oldest_expired_at
      FROM bookings`);
    return { ...row, expiry_worker: this.expiryError ? 'error' : this.lastExpiryRun ? 'running' : 'starting', last_expiry_run_at: this.lastExpiryRun, notification_channel: 'in_app' };
  }

  async listNotifications(customerId: string, page: BookingWorkflowPageDto) {
    const [rows, counts] = await Promise.all([
      this.dataSource.query(`SELECT notification_id, booking_id, kind,
        jsonb_build_object('status', payload->'status', 'pending_expires_at', payload->'pending_expires_at',
          'deposit_required', payload->'deposit_required') AS payload, created_at, read_at
        FROM customer_notifications WHERE customer_id = $1::uuid
        ORDER BY created_at DESC, notification_id DESC LIMIT $2 OFFSET $3`, [customerId, page.limit, page.offset]),
      this.dataSource.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread
        FROM customer_notifications WHERE customer_id = $1::uuid`, [customerId]),
    ]);
    return { data: rows, ...counts[0], limit: page.limit, offset: page.offset };
  }
  async markNotificationRead(customerId: string, notificationId: string) {
    const rows = await this.dataSource.query(`UPDATE customer_notifications SET read_at = COALESCE(read_at, clock_timestamp())
      WHERE notification_id = $1::uuid AND customer_id = $2::uuid RETURNING notification_id, read_at`, [notificationId, customerId]);
    const updated = Array.isArray(rows[0]) ? rows[0] : rows;
    if (!updated[0]) throw new NotFoundException('Không tìm thấy thông báo.');
    return updated[0];
  }

  private timezone() { return this.config.get<string>('HOTEL_TIMEZONE', 'Asia/Bangkok'); }
  private async actorContext(manager: EntityManager, actor: string | undefined, reason: string) {
    await manager.query("SELECT set_config('hotelai.actor_id', $1, true), set_config('hotelai.reason', $2, true), set_config('hotelai.timezone', $3, true)", [actor ?? '', reason, this.timezone()]);
  }
  private async lockBooking(manager: EntityManager, id: string) {
    const rows = await manager.query('SELECT booking_id FROM bookings WHERE booking_id = $1::uuid FOR UPDATE', [id]);
    if (!rows[0]) throw new NotFoundException('Không tìm thấy booking.');
  }
  private key(raw?: string) {
    if (!raw || !/^[A-Za-z0-9._:-]{8,100}$/.test(raw.trim())) throw new BadRequestException('Cần Idempotency-Key hợp lệ (8–100 ký tự).');
    return raw.trim();
  }
  private hash(input: object) { return createHash('sha256').update(JSON.stringify(input)).digest('hex'); }
  private async lockKey(manager: EntityManager, key: string) { await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`hotelai-workflow:${key}`]); }
  private checkHash(actual: string, expected: string) { if (actual !== expected) throw new ConflictException('Idempotency-Key đã được sử dụng cho yêu cầu khác.'); }
  private creditView(row: Record<string, unknown>) { const { request_hash, ...view } = row; return { ...view, authorized_amount: Number(row.authorized_amount) }; }
  private updated(rows: unknown[]) { return Array.isArray(rows[0]) ? rows[0].length > 0 : rows.length > 0; }
}
