import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox.service';
import { ChangePasswordDto, DeactivateAccountDto, UpdateProfileDto } from './dto/user-account.dto';

export type UserProfileView = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: 'customer' | 'admin';
  account_status: 'Active' | 'Suspended' | 'Deactivated';
  version: number;
  created_at: Date;
  updated_at: Date;
};

type CustomerRow = {
  customer_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  password_hash?: string | null;
  role: 'customer' | 'admin';
  account_status: 'Active' | 'Suspended' | 'Deactivated';
  version: number;
  auth_version: number;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async getProfile(customerId: string, manager?: EntityManager): Promise<UserProfileView> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query(
      `SELECT customer_id, full_name, email, phone, nationality, role,
              account_status, version, created_at, updated_at
       FROM customers
       WHERE customer_id = $1::uuid`,
      [customerId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy tài khoản.');
    return this.mapProfile(rows[0] as CustomerRow);
  }

  async updateProfile(customerId: string, dto: UpdateProfileDto): Promise<UserProfileView> {
    const hasFullName = dto.full_name !== undefined;
    const hasPhone = dto.phone !== undefined;
    const hasNationality = dto.nationality !== undefined;
    if (!hasFullName && !hasPhone && !hasNationality) {
      throw new BadRequestException('Cần cung cấp ít nhất một trường hồ sơ để cập nhật.');
    }

    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockCustomer(manager, customerId);
      if (current.version !== dto.expected_version) {
        throw new ConflictException('Hồ sơ đã được cập nhật ở nơi khác. Vui lòng tải lại dữ liệu.');
      }

      const next = {
        full_name: hasFullName ? dto.full_name! : current.full_name,
        phone: hasPhone ? dto.phone ?? null : current.phone,
        nationality: hasNationality ? dto.nationality ?? null : current.nationality,
      };
      const changedFields = [
        ...(next.full_name !== current.full_name ? ['full_name'] : []),
        ...(next.phone !== current.phone ? ['phone'] : []),
        ...(next.nationality !== current.nationality ? ['nationality'] : []),
      ];
      if (!changedFields.length) return this.mapProfile(current);

      const [updatedRows] = await manager.query(
        `UPDATE customers
         SET full_name = $2,
             phone = $3,
             nationality = $4,
             version = version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE customer_id = $1::uuid
         RETURNING customer_id, full_name, email, phone, nationality, role,
                   account_status, version, auth_version, created_at, updated_at`,
        [customerId, next.full_name, next.phone, next.nationality],
      );
      const updated = updatedRows[0] as CustomerRow;
      await this.appendAudit(manager, current, updated, 'profile_updated', customerId, {
        fields: changedFields,
      });
      await this.outbox.enqueue(manager, {
        aggregateType: 'customer',
        aggregateId: customerId,
        eventType: 'customer.profile-updated.v1',
        payload: { customer_id: customerId, version: Number(updated.version), fields: changedFields },
      });
      return this.mapProfile(updated);
    });
  }

  async changePassword(customerId: string, dto: ChangePasswordDto): Promise<{ version: number }> {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.lockCustomer(manager, customerId, true);
      if (!current.password_hash || !(await bcrypt.compare(dto.current_password, current.password_hash))) {
        throw new BadRequestException('Mật khẩu hiện tại không đúng.');
      }
      if (await bcrypt.compare(dto.new_password, current.password_hash)) {
        throw new BadRequestException('Mật khẩu mới phải khác mật khẩu hiện tại.');
      }

      const passwordHash = await bcrypt.hash(dto.new_password, 12);
      const [updatedRows] = await manager.query(
        `UPDATE customers
         SET password_hash = $2,
             version = version + 1,
             auth_version = auth_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE customer_id = $1::uuid
         RETURNING customer_id, full_name, email, phone, nationality, role,
                   account_status, version, auth_version, created_at, updated_at`,
        [customerId, passwordHash],
      );
      const updated = updatedRows[0] as CustomerRow;
      await this.appendAudit(manager, current, updated, 'password_changed', customerId, {
        fields: ['password'],
      });
      await this.outbox.enqueue(manager, {
        aggregateType: 'customer',
        aggregateId: customerId,
        eventType: 'customer.password-changed.v1',
        payload: { customer_id: customerId, version: Number(updated.version) },
      });
      return { version: updated.version };
    });
  }

  async deactivate(customerId: string, dto: DeactivateAccountDto): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      // Every transition that may remove an active admin takes the same lock.
      // This makes the "at least one active admin" invariant safe across
      // simultaneous self-deactivation and admin-management requests.
      await manager.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended('hotelai-active-admin-set', 0)
         )`,
      );
      const current = await this.lockCustomer(manager, customerId, true);
      if (!current.password_hash || !(await bcrypt.compare(dto.password, current.password_hash))) {
        throw new BadRequestException('Mật khẩu không đúng.');
      }
      if (current.role === 'admin') {
        const activeAdminRows = await manager.query(
          `SELECT COUNT(*)::int AS count
           FROM customers
           WHERE role = 'admin' AND account_status = 'Active'`,
        );
        if (Number(activeAdminRows[0].count) <= 1) {
          throw new ConflictException('Không thể vô hiệu hóa quản trị viên hoạt động cuối cùng.');
        }
      }
      // Creation holds the customer lock too. Existing active stays cannot
      // become a new debt after passing this check: they are blocked outright;
      // terminal debt/refund balances can only decrease through settlement.
      // A credit authorization permits checkout but does not forgive debt.
      const unsettledBookingRows = await manager.query(
        `SELECT COUNT(*)::int AS count
         FROM bookings booking
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(CASE WHEN transaction_type = 'Payment'
             THEN amount ELSE -amount END), 0) AS net_paid
           FROM payment_transactions WHERE booking_id = booking.booking_id
         ) ledger ON true
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(applied_price), 0)
             * (booking.check_out_date - booking.check_in_date) AS total
           FROM booking_details WHERE booking_id = booking.booking_id
         ) charges ON true
         WHERE booking.customer_id = $1::uuid
           AND (
             booking.status IN ('Confirmed', 'CheckedIn')
             OR (booking.status = 'Pending' AND booking.pending_expires_at > clock_timestamp())
             OR (booking.status = 'Completed' AND ledger.net_paid < charges.total)
             OR ((booking.status IN ('Canceled', 'Expired', 'NoShow')
               OR (booking.status = 'Pending' AND booking.pending_expires_at <= clock_timestamp()))
               AND ledger.net_paid > 0)
           )`,
        [customerId],
      );
      if (Number(unsettledBookingRows[0].count) > 0) {
        throw new ConflictException('Cần hoàn tất booking đang hoạt động, thanh toán công nợ và nhận đủ tiền hoàn trước khi vô hiệu hóa tài khoản.');
      }

      const anonymizedEmail = `deleted+${customerId}@invalid.local`;
      const [updatedRows] = await manager.query(
        `UPDATE customers
         SET full_name = 'Deleted user',
             email = $2,
             phone = NULL,
             nationality = NULL,
             password_hash = NULL,
             role = 'customer',
             account_status = 'Deactivated',
             version = version + 1,
             auth_version = auth_version + 1,
             updated_at = CURRENT_TIMESTAMP,
             deleted_at = CURRENT_TIMESTAMP
         WHERE customer_id = $1::uuid
         RETURNING customer_id, full_name, email, phone, nationality, role,
                   account_status, version, auth_version, created_at, updated_at`,
        [customerId, anonymizedEmail],
      );
      const updated = updatedRows[0] as CustomerRow;
      await this.appendAudit(manager, current, updated, 'deactivated', customerId, {
        fields: ['full_name', 'email', 'phone', 'nationality', 'password', 'role', 'account_status'],
      });
      await this.outbox.enqueue(manager, {
        aggregateType: 'customer',
        aggregateId: customerId,
        eventType: 'customer.deactivated.v1',
        payload: { customer_id: customerId, version: Number(updated.version), deactivated_by: customerId },
      });
    });
  }

  private async lockCustomer(
    manager: EntityManager,
    customerId: string,
    includePassword = false,
  ): Promise<CustomerRow> {
    const rows = await manager.query(
      `SELECT customer_id, full_name, email, phone, nationality,
              ${includePassword ? 'password_hash,' : ''}
              role, account_status, version, auth_version, created_at, updated_at
       FROM customers
       WHERE customer_id = $1::uuid
       FOR UPDATE`,
      [customerId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy tài khoản.');
    const customer = rows[0] as CustomerRow;
    if (customer.account_status !== 'Active') {
      throw new ConflictException('Tài khoản không còn ở trạng thái hoạt động.');
    }
    return customer;
  }

  private async appendAudit(
    manager: EntityManager,
    previous: CustomerRow,
    next: CustomerRow,
    action: 'profile_updated' | 'password_changed' | 'deactivated',
    changedBy: string,
    changedFields: Record<string, unknown>,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO customer_account_audits (
         customer_id, action, old_role, new_role, old_status, new_status,
         old_version, new_version, changed_fields, changed_by
       ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::uuid)`,
      [
        previous.customer_id,
        action,
        previous.role,
        next.role,
        previous.account_status,
        next.account_status,
        previous.version,
        next.version,
        JSON.stringify(changedFields),
        changedBy,
      ],
    );
  }

  private mapProfile(row: CustomerRow): UserProfileView {
    return {
      id: row.customer_id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone ?? null,
      nationality: row.nationality ?? null,
      role: row.role,
      account_status: row.account_status,
      version: Number(row.version),
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}
