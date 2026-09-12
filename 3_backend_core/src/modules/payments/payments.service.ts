import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox.service';
import {
  AdminPaymentsQueryDto,
  PaymentMethod,
  RecordPaymentDto,
  RefundPaymentDto,
} from './dto/payment.dto';

export type PaymentStatus =
  | 'Unpaid'
  | 'PartiallyPaid'
  | 'Paid'
  | 'RefundPending'
  | 'PartiallyRefunded'
  | 'Refunded';

export type PaymentTransactionView = {
  payment_id: string;
  booking_id: string;
  transaction_type: 'Payment' | 'Refund';
  parent_payment_id: string | null;
  amount: number;
  currency: 'VND';
  method: PaymentMethod;
  status: 'Succeeded';
  idempotency_key: string;
  external_reference: string | null;
  note: string | null;
  created_by: string;
  created_by_name: string;
  created_at: Date;
  refunded_amount: number;
  refundable_amount: number;
};

export type BookingPaymentSummary = {
  booking_id: string;
  booking_status: BookingPaymentRow['status'];
  lifecycle_version: number;
  policy_version: number | null;
  deposit_required: number;
  deposit_due: number;
  checkout_payment_required: boolean;
  pending_expires_at: Date | null;
  expired_at: Date | null;
  no_show_at: Date | null;
  hold_expired: boolean;
  can_record_payment: boolean;
  booking_total: number;
  paid_amount: number;
  refunded_amount: number;
  net_paid: number;
  balance_due: number;
  refund_due: number;
  payment_status: PaymentStatus;
  currency: 'VND';
  transactions: PaymentTransactionView[];
};

type BookingPaymentRow = {
  booking_id: string;
  customer_id: string;
  status: 'Pending' | 'Confirmed' | 'CheckedIn' | 'Canceled' | 'Completed' | 'Expired' | 'NoShow';
  lifecycle_version: number;
  policy_version: number | null;
  deposit_required: string | number;
  checkout_payment_required: boolean;
  pending_expires_at: Date | null;
  expired_at: Date | null;
  no_show_at: Date | null;
  hold_expired: boolean;
  booking_total: string | number;
};

type TransactionRow = Record<string, unknown> & {
  payment_id: string;
  booking_id: string;
  transaction_type: 'Payment' | 'Refund';
  parent_payment_id: string | null;
  amount: string | number;
  method: PaymentMethod;
  idempotency_key: string;
  external_reference: string | null;
  note: string | null;
};

@Injectable()
export class PaymentsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async getBookingSummary(
    bookingId: string,
    customerId: string,
    role: string,
    manager?: EntityManager,
  ): Promise<BookingPaymentSummary> {
    // Status and ledger must describe the same committed snapshot. A deposit
    // may confirm the booking atomically while this read is in progress.
    if (!manager) {
      return this.dataSource.transaction('REPEATABLE READ', (transactionManager) =>
        this.getBookingSummary(bookingId, customerId, role, transactionManager));
    }
    const booking = await this.getBookingRow(bookingId, manager);
    if (role !== 'admin' && booking.customer_id !== customerId) {
      throw new NotFoundException('Không tìm thấy booking.');
    }
    const transactions = await this.getTransactions(bookingId, manager);
    return this.buildSummary(booking, transactions);
  }

  async recordPayment(bookingId: string, actorId: string, dto: RecordPaymentDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.lockIdempotencyKey(manager, dto.idempotency_key);
      const existing = await this.findByIdempotencyKey(manager, dto.idempotency_key);
      if (existing) {
        this.assertPaymentReplay(existing, bookingId, dto);
        await this.lockBooking(manager, bookingId);
        return {
          replayed: true,
          transaction: this.mapTransaction(existing),
          summary: await this.getBookingSummary(bookingId, actorId, 'admin', manager),
        };
      }

      const booking = await this.lockBooking(manager, bookingId);
      if (this.isRefundOnly(booking.status)) {
        throw new ConflictException('Không thể ghi nhận thanh toán mới cho booking đã hủy, hết hạn hoặc NoShow.');
      }
      // Evaluated by PostgreSQL after taking the booking lock, not by the
      // application host clock. The insert trigger repeats this at mutation.
      if (booking.hold_expired) {
        throw new ConflictException('Thời hạn giữ phòng đã hết; không thể nhận thêm thanh toán.');
      }
      const summary = this.buildSummary(booking, await this.getTransactions(bookingId, manager));
      const amount = this.money(dto.amount);
      if (amount > summary.balance_due) {
        throw new ConflictException('Số tiền vượt quá số dư cần thanh toán.');
      }

      const insertedRows = await manager.query(
        `INSERT INTO payment_transactions (
           booking_id, transaction_type, amount, currency, method, status,
           idempotency_key, external_reference, note, created_by
         ) VALUES ($1::uuid, 'Payment', $2, 'VND', $3, 'Succeeded', $4, $5, $6, $7::uuid)
         RETURNING payment_id, booking_id, transaction_type, parent_payment_id,
                   amount, currency, method, status, idempotency_key,
                   external_reference, note, created_by, created_at`,
        [
          bookingId,
          amount,
          dto.method,
          dto.idempotency_key,
          dto.external_reference ?? null,
          dto.note ?? null,
          actorId,
        ],
      );
      const inserted = await this.hydrateTransaction(manager, insertedRows[0].payment_id);
      await this.outbox.enqueue(manager, {
        aggregateType: 'payment',
        aggregateId: inserted.payment_id,
        eventType: 'payment.recorded.v1',
        payload: {
          payment_id: inserted.payment_id,
          booking_id: bookingId,
          amount,
          currency: 'VND',
          method: dto.method,
          external_reference: dto.external_reference ?? null,
          recorded_by: actorId,
        },
      });
      return {
        replayed: false,
        transaction: this.mapTransaction(inserted),
        summary: await this.getBookingSummary(bookingId, actorId, 'admin', manager),
      };
    });
  }

  async refundPayment(paymentId: string, actorId: string, dto: RefundPaymentDto) {
    return this.dataSource.transaction(async (manager) => {
      await this.lockIdempotencyKey(manager, dto.idempotency_key);
      const existing = await this.findByIdempotencyKey(manager, dto.idempotency_key);
      if (existing) {
        this.assertRefundReplay(existing, paymentId, dto);
        await this.lockBooking(manager, existing.booking_id);
        return {
          replayed: true,
          transaction: this.mapTransaction(existing),
          summary: await this.getBookingSummary(existing.booking_id, actorId, 'admin', manager),
        };
      }

      // Read the immutable aggregate ID first, then lock booking before its
      // payment. All money/lifecycle operations use this same lock order.
      const parentLookup = await manager.query(
        `SELECT booking_id FROM payment_transactions
         WHERE payment_id = $1::uuid AND transaction_type = 'Payment'`,
        [paymentId],
      );
      if (!parentLookup.length) throw new NotFoundException('Không tìm thấy giao dịch thanh toán gốc.');
      const booking = await this.lockBooking(manager, parentLookup[0].booking_id);
      if (!this.isRefundOnly(booking.status)) {
        throw new ConflictException('Chỉ hoàn tiền sau khi booking đã hủy, hết hạn hoặc được đánh dấu NoShow.');
      }
      const parentRows = await manager.query(
        `SELECT payment.payment_id,
                payment.booking_id,
                payment.amount,
                payment.method
         FROM payment_transactions payment
         WHERE payment.payment_id = $1::uuid
           AND payment.booking_id = $2::uuid
           AND payment.transaction_type = 'Payment'
         FOR UPDATE OF payment`,
        [paymentId, booking.booking_id],
      );
      if (!parentRows.length) throw new NotFoundException('Không tìm thấy giao dịch thanh toán gốc.');
      const parent = parentRows[0] as Record<string, unknown>;
      const refundRows = await manager.query(
        `SELECT COALESCE(SUM(amount), 0) AS refunded_amount
         FROM payment_transactions
         WHERE parent_payment_id = $1::uuid
           AND transaction_type = 'Refund'`,
        [paymentId],
      );
      const amount = this.money(dto.amount);
      const refundable = this.money(Number(parent.amount) - Number(refundRows[0].refunded_amount));
      if (amount > refundable) {
        throw new ConflictException('Số tiền hoàn vượt quá số tiền còn có thể hoàn của giao dịch.');
      }

      const insertedRows = await manager.query(
        `INSERT INTO payment_transactions (
           booking_id, transaction_type, parent_payment_id, amount, currency,
           method, status, idempotency_key, note, created_by
         ) VALUES ($1::uuid, 'Refund', $2::uuid, $3, 'VND', $4,
                   'Succeeded', $5, $6, $7::uuid)
         RETURNING payment_id`,
        [parent.booking_id, paymentId, amount, parent.method, dto.idempotency_key, dto.note ?? null, actorId],
      );
      const inserted = await this.hydrateTransaction(manager, insertedRows[0].payment_id);
      await this.outbox.enqueue(manager, {
        aggregateType: 'payment',
        aggregateId: inserted.payment_id,
        eventType: 'payment.refunded.v1',
        payload: {
          refund_id: inserted.payment_id,
          payment_id: paymentId,
          booking_id: parent.booking_id,
          amount,
          currency: 'VND',
          method: parent.method,
          recorded_by: actorId,
        },
      });
      return {
        replayed: false,
        transaction: this.mapTransaction(inserted),
        summary: await this.getBookingSummary(String(parent.booking_id), actorId, 'admin', manager),
      };
    });
  }

  async listTransactions(query: AdminPaymentsQueryDto) {
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    if (query.transaction_type) {
      parameters.push(query.transaction_type);
      clauses.push(`payment.transaction_type = $${parameters.length}`);
    }
    if (query.method) {
      parameters.push(query.method);
      clauses.push(`payment.method = $${parameters.length}`);
    }
    if (query.search) {
      const escaped = query.search.replace(/[\\%_]/g, '\\$&');
      parameters.push(`%${escaped}%`);
      clauses.push(
        `(customer.full_name ILIKE $${parameters.length} ESCAPE '\\'
          OR customer.email ILIKE $${parameters.length} ESCAPE '\\'
          OR payment.booking_id::text ILIKE $${parameters.length} ESCAPE '\\'
          OR COALESCE(payment.external_reference, '') ILIKE $${parameters.length} ESCAPE '\\')`,
      );
    }
    const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const dataParameters = [...parameters];
    const limitParameter = dataParameters.push(query.limit);
    const offsetParameter = dataParameters.push(query.offset);
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `${this.transactionSelectSql()}
         ${whereSql}
         ORDER BY payment.created_at DESC, payment.payment_id DESC
         LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        dataParameters,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM payment_transactions payment
         INNER JOIN bookings booking ON booking.booking_id = payment.booking_id
         INNER JOIN customers customer ON customer.customer_id = booking.customer_id
         ${whereSql}`,
        parameters,
      ),
    ]);
    return {
      data: rows.map((row: TransactionRow & Record<string, unknown>) => ({
        ...this.mapTransaction(row),
        customer_id: row.customer_id,
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        booking_status: row.booking_status,
      })),
      total: Number(countRows[0].total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  private async getBookingRow(
    bookingId: string,
    runner: DataSource | EntityManager,
  ): Promise<BookingPaymentRow> {
    const rows = await runner.query(
      `SELECT booking.booking_id,
              booking.customer_id,
              booking.status,
              booking.lifecycle_version,
              booking.policy_version,
              booking.deposit_required,
              booking.checkout_payment_required,
              booking.pending_expires_at,
              booking.expired_at,
              booking.no_show_at,
              COALESCE(booking.status = 'Pending'
                AND booking.pending_expires_at <= clock_timestamp(), false) AS hold_expired,
              COALESCE(SUM(detail.applied_price), 0)
                * (booking.check_out_date - booking.check_in_date) AS booking_total
       FROM bookings booking
       LEFT JOIN booking_details detail ON detail.booking_id = booking.booking_id
       WHERE booking.booking_id = $1::uuid
       GROUP BY booking.booking_id, booking.customer_id, booking.status,
                booking.check_in_date, booking.check_out_date`,
      [bookingId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy booking.');
    return rows[0] as BookingPaymentRow;
  }

  private async lockBooking(manager: EntityManager, bookingId: string): Promise<BookingPaymentRow> {
    const lockRows = await manager.query(
      `SELECT booking_id FROM bookings WHERE booking_id = $1::uuid FOR UPDATE`,
      [bookingId],
    );
    if (!lockRows.length) throw new NotFoundException('Không tìm thấy booking.');
    return this.getBookingRow(bookingId, manager);
  }

  private async getTransactions(
    bookingId: string,
    runner: DataSource | EntityManager,
  ): Promise<PaymentTransactionView[]> {
    const rows = await runner.query(
      `${this.transactionSelectSql()}
       WHERE payment.booking_id = $1::uuid
       ORDER BY payment.created_at ASC, payment.payment_id ASC`,
      [bookingId],
    );
    return rows.map((row: TransactionRow) => this.mapTransaction(row));
  }

  private transactionSelectSql(): string {
    return `SELECT payment.payment_id,
                   payment.booking_id,
                   payment.transaction_type,
                   payment.parent_payment_id,
                   payment.amount,
                   payment.currency,
                   payment.method,
                   payment.status,
                   payment.idempotency_key,
                   payment.external_reference,
                   payment.note,
                   payment.created_by,
                   actor.full_name AS created_by_name,
                   payment.created_at,
                   COALESCE(refunds.refunded_amount, 0) AS refunded_amount,
                   CASE WHEN payment.transaction_type = 'Payment'
                        THEN payment.amount - COALESCE(refunds.refunded_amount, 0)
                        ELSE 0 END AS refundable_amount,
                   customer.customer_id,
                   customer.full_name AS customer_name,
                   customer.email AS customer_email,
                   booking.status AS booking_status
            FROM payment_transactions payment
            INNER JOIN customers actor ON actor.customer_id = payment.created_by
            LEFT JOIN (
              SELECT parent_payment_id, SUM(amount) AS refunded_amount
              FROM payment_transactions
              WHERE transaction_type = 'Refund'
              GROUP BY parent_payment_id
            ) refunds ON refunds.parent_payment_id = payment.payment_id
            LEFT JOIN bookings booking ON booking.booking_id = payment.booking_id
            LEFT JOIN customers customer ON customer.customer_id = booking.customer_id`;
  }

  private async hydrateTransaction(manager: EntityManager, paymentId: string): Promise<TransactionRow> {
    const rows = await manager.query(
      `${this.transactionSelectSql()} WHERE payment.payment_id = $1::uuid`,
      [paymentId],
    );
    return rows[0] as TransactionRow;
  }

  private async lockIdempotencyKey(manager: EntityManager, key: string): Promise<void> {
    await manager.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`hotelai-payment-idempotency:${key}`],
    );
  }

  private async findByIdempotencyKey(
    manager: EntityManager,
    key: string,
  ): Promise<TransactionRow | null> {
    const rows = await manager.query(
      `${this.transactionSelectSql()} WHERE payment.idempotency_key = $1`,
      [key],
    );
    return rows[0] as TransactionRow | undefined ?? null;
  }

  private assertPaymentReplay(existing: TransactionRow, bookingId: string, dto: RecordPaymentDto): void {
    if (
      existing.transaction_type !== 'Payment'
      || existing.booking_id !== bookingId
      || this.money(Number(existing.amount)) !== this.money(dto.amount)
      || existing.method !== dto.method
      || (existing.external_reference ?? null) !== (dto.external_reference ?? null)
      || (existing.note ?? null) !== (dto.note ?? null)
    ) {
      throw new ConflictException('Idempotency key đã được dùng cho một yêu cầu khác.');
    }
  }

  private assertRefundReplay(existing: TransactionRow, paymentId: string, dto: RefundPaymentDto): void {
    if (
      existing.transaction_type !== 'Refund'
      || existing.parent_payment_id !== paymentId
      || this.money(Number(existing.amount)) !== this.money(dto.amount)
      || (existing.note ?? null) !== (dto.note ?? null)
    ) {
      throw new ConflictException('Idempotency key đã được dùng cho một yêu cầu khác.');
    }
  }

  private buildSummary(
    booking: BookingPaymentRow,
    transactions: PaymentTransactionView[],
  ): BookingPaymentSummary {
    const bookingTotal = this.money(Number(booking.booking_total));
    const paidAmount = this.money(transactions
      .filter((item) => item.transaction_type === 'Payment')
      .reduce((sum, item) => sum + item.amount, 0));
    const refundedAmount = this.money(transactions
      .filter((item) => item.transaction_type === 'Refund')
      .reduce((sum, item) => sum + item.amount, 0));
    const netPaid = this.money(Math.max(0, paidAmount - refundedAmount));
    const refundOnly = this.isRefundOnly(booking.status);
    const balanceDue = refundOnly
      ? 0
      : this.money(Math.max(0, bookingTotal - netPaid));
    const refundDue = refundOnly ? netPaid : 0;
    return {
      booking_id: booking.booking_id,
      booking_status: booking.status,
      lifecycle_version: Number(booking.lifecycle_version),
      policy_version: booking.policy_version === null ? null : Number(booking.policy_version),
      deposit_required: this.money(Number(booking.deposit_required)),
      deposit_due: refundOnly ? 0 : this.money(Math.max(0, Number(booking.deposit_required) - netPaid)),
      checkout_payment_required: booking.checkout_payment_required,
      pending_expires_at: booking.pending_expires_at,
      expired_at: booking.expired_at,
      no_show_at: booking.no_show_at,
      hold_expired: booking.hold_expired,
      can_record_payment: !refundOnly && !booking.hold_expired && balanceDue > 0,
      booking_total: bookingTotal,
      paid_amount: paidAmount,
      refunded_amount: refundedAmount,
      net_paid: netPaid,
      balance_due: balanceDue,
      refund_due: refundDue,
      payment_status: this.paymentStatus(booking.status, bookingTotal, paidAmount, refundedAmount, netPaid),
      currency: 'VND',
      transactions,
    };
  }

  private paymentStatus(
    bookingStatus: BookingPaymentRow['status'],
    bookingTotal: number,
    paidAmount: number,
    refundedAmount: number,
    netPaid: number,
  ): PaymentStatus {
    if (this.isRefundOnly(bookingStatus)) {
      if (netPaid > 0) return 'RefundPending';
      return refundedAmount > 0 ? 'Refunded' : 'Unpaid';
    }
    if (netPaid >= bookingTotal && bookingTotal > 0) return 'Paid';
    if (refundedAmount > 0 && netPaid > 0) return 'PartiallyRefunded';
    if (paidAmount > 0) return 'PartiallyPaid';
    return 'Unpaid';
  }

  private isRefundOnly(status: BookingPaymentRow['status']): boolean {
    return status === 'Canceled' || status === 'Expired' || status === 'NoShow';
  }

  private mapTransaction(row: TransactionRow): PaymentTransactionView {
    return {
      payment_id: String(row.payment_id),
      booking_id: String(row.booking_id),
      transaction_type: row.transaction_type,
      parent_payment_id: row.parent_payment_id ? String(row.parent_payment_id) : null,
      amount: this.money(Number(row.amount)),
      currency: 'VND',
      method: row.method,
      status: 'Succeeded',
      idempotency_key: String(row.idempotency_key),
      external_reference: row.external_reference ? String(row.external_reference) : null,
      note: row.note ? String(row.note) : null,
      created_by: String(row.created_by),
      created_by_name: String(row.created_by_name),
      created_at: row.created_at as Date,
      refunded_amount: this.money(Number(row.refunded_amount ?? 0)),
      refundable_amount: this.money(Number(row.refundable_amount ?? 0)),
    };
  }

  private money(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
}
