import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox.service';
import {
  AdminUserAuditsQueryDto,
  AdminUsersQueryDto,
  UpdateAdminUserDto,
} from './dto/admin-users.dto';

export type AdminUserView = {
  customer_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: 'customer' | 'admin';
  account_status: 'Active' | 'Suspended' | 'Deactivated';
  version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  booking_count: number;
  confirmed_booking_count: number;
  checked_in_booking_count: number;
  active_booking_count: number;
  booking_value: number;
};

type AccountRow = {
  customer_id: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: 'customer' | 'admin';
  account_status: 'Active' | 'Suspended' | 'Deactivated';
  version: number;
  auth_version: number;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

@Injectable()
export class AdminUsersService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async listUsers(query: AdminUsersQueryDto): Promise<{
    data: AdminUserView[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const filter = this.buildFilter(query);
    const dataParameters: unknown[] = [...filter.parameters];
    const limitParameter = dataParameters.push(query.limit);
    const offsetParameter = dataParameters.push(query.offset);

    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `${this.userStatsCte()}
         ${this.userSelectSql()}
         ${filter.whereSql}
         ORDER BY customer.created_at DESC, customer.customer_id DESC
         LIMIT $${limitParameter} OFFSET $${offsetParameter}`,
        dataParameters,
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM customers customer
         ${filter.whereSql}`,
        filter.parameters,
      ),
    ]);

    return {
      data: rows.map((row: Record<string, unknown>) => this.mapUser(row)),
      total: Number(countRows[0].total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async getUser(customerId: string, manager?: EntityManager): Promise<AdminUserView> {
    const runner = manager ?? this.dataSource;
    const rows = await runner.query(
      `${this.userStatsCte()}
       ${this.userSelectSql()}
       WHERE customer.customer_id = $1::uuid`,
      [customerId],
    );
    if (!rows.length) throw new NotFoundException('Không tìm thấy tài khoản.');
    return this.mapUser(rows[0]);
  }

  async updateUser(
    customerId: string,
    actorId: string,
    dto: UpdateAdminUserDto,
  ): Promise<AdminUserView> {
    if (dto.role === undefined && dto.account_status === undefined) {
      throw new BadRequestException('Cần cung cấp vai trò hoặc trạng thái mới.');
    }

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        `SELECT pg_advisory_xact_lock(
           hashtextextended('hotelai-active-admin-set', 0)
         )`,
      );
      const rows = await manager.query(
        `SELECT customer_id, full_name, email, phone, nationality, role,
                account_status, version, auth_version, created_at, updated_at, deleted_at
         FROM customers
         WHERE customer_id = $1::uuid
         FOR UPDATE`,
        [customerId],
      );
      if (!rows.length) throw new NotFoundException('Không tìm thấy tài khoản.');
      const current = rows[0] as AccountRow;
      const actor = customerId === actorId
        ? current
        : (await manager.query(
            `SELECT customer_id, role, account_status
             FROM customers
             WHERE customer_id = $1::uuid
             FOR UPDATE`,
            [actorId],
          ))[0] as Pick<AccountRow, 'customer_id' | 'role' | 'account_status'> | undefined;
      if (!actor || actor.role !== 'admin' || actor.account_status !== 'Active') {
        throw new ForbiddenException('Phiên quản trị không còn quyền cập nhật tài khoản.');
      }
      if (current.account_status === 'Deactivated') {
        throw new ConflictException('Không thể sửa tài khoản đã vô hiệu hóa vĩnh viễn.');
      }
      if (Number(current.version) !== dto.expected_version) {
        throw new ConflictException('Tài khoản đã được cập nhật ở nơi khác. Vui lòng tải lại dữ liệu.');
      }

      const nextRole = dto.role ?? current.role;
      const nextStatus = dto.account_status ?? current.account_status;
      if (customerId === actorId && (nextRole !== 'admin' || nextStatus !== 'Active')) {
        throw new ForbiddenException('Không thể tự hạ quyền hoặc tự khóa tài khoản quản trị đang đăng nhập.');
      }
      const roleChanged = nextRole !== current.role;
      const statusChanged = nextStatus !== current.account_status;
      if (!roleChanged && !statusChanged) {
        throw new BadRequestException('Vai trò và trạng thái mới không thay đổi so với hiện tại.');
      }
      const removesActiveAdmin = current.role === 'admin'
        && current.account_status === 'Active'
        && (nextRole !== 'admin' || nextStatus !== 'Active');
      if (removesActiveAdmin) {
        const activeAdminRows = await manager.query(
          `SELECT COUNT(*)::int AS count
           FROM customers
           WHERE role = 'admin' AND account_status = 'Active'`,
        );
        if (Number(activeAdminRows[0].count) <= 1) {
          throw new ConflictException('Không thể loại bỏ quản trị viên hoạt động cuối cùng.');
        }
      }

      const [updatedRows] = await manager.query(
        `UPDATE customers
         SET role = $2,
             account_status = $3,
             version = version + 1,
             auth_version = auth_version + $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE customer_id = $1::uuid
         RETURNING customer_id, full_name, email, phone, nationality, role,
                   account_status, version, auth_version, created_at, updated_at, deleted_at`,
        [customerId, nextRole, nextStatus, statusChanged ? 1 : 0],
      );
      const updated = updatedRows[0] as AccountRow;
      await manager.query(
        `INSERT INTO customer_account_audits (
           customer_id, action, old_role, new_role, old_status, new_status,
           old_version, new_version, changed_fields, changed_by
         ) VALUES ($1::uuid, 'account_updated', $2, $3, $4, $5, $6, $7, $8::jsonb, $9::uuid)`,
        [
          customerId,
          current.role,
          updated.role,
          current.account_status,
          updated.account_status,
          Number(current.version),
          Number(updated.version),
          JSON.stringify({
            fields: [
              ...(roleChanged ? ['role'] : []),
              ...(statusChanged ? ['account_status'] : []),
            ],
          }),
          actorId,
        ],
      );
      await this.outbox.enqueue(manager, {
        aggregateType: 'customer',
        aggregateId: customerId,
        eventType: 'customer.account-updated.v1',
        payload: {
          customer_id: customerId,
          changed_by: actorId,
          old_role: current.role,
          new_role: updated.role,
          old_status: current.account_status,
          new_status: updated.account_status,
          version: Number(updated.version),
        },
      });
      return this.getUser(customerId, manager);
    });
  }

  async listAudits(customerId: string, query: AdminUserAuditsQueryDto) {
    await this.getUser(customerId);
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `SELECT audit.audit_id,
                audit.action,
                audit.old_role,
                audit.new_role,
                audit.old_status,
                audit.new_status,
                audit.old_version,
                audit.new_version,
                audit.changed_fields,
                audit.changed_by,
                actor.full_name AS changed_by_name,
                actor.email AS changed_by_email,
                audit.created_at
         FROM customer_account_audits audit
         INNER JOIN customers actor ON actor.customer_id = audit.changed_by
         WHERE audit.customer_id = $1::uuid
         ORDER BY audit.created_at DESC, audit.audit_id DESC
         LIMIT $2 OFFSET $3`,
        [customerId, query.limit, query.offset],
      ),
      this.dataSource.query(
        `SELECT COUNT(*)::int AS total
         FROM customer_account_audits
         WHERE customer_id = $1::uuid`,
        [customerId],
      ),
    ]);
    return {
      data: rows.map((row: Record<string, unknown>) => ({
        ...row,
        old_version: Number(row.old_version),
        new_version: Number(row.new_version),
      })),
      total: Number(countRows[0].total),
      limit: query.limit,
      offset: query.offset,
    };
  }

  private buildFilter(query: AdminUsersQueryDto): { whereSql: string; parameters: unknown[] } {
    const clauses: string[] = [];
    const parameters: unknown[] = [];
    if (query.role) {
      parameters.push(query.role);
      clauses.push(`customer.role = $${parameters.length}`);
    }
    if (query.status) {
      parameters.push(query.status);
      clauses.push(`customer.account_status = $${parameters.length}`);
    }
    if (query.search) {
      const escaped = query.search.replace(/[\\%_]/g, '\\$&');
      parameters.push(`%${escaped}%`);
      clauses.push(
        `(customer.full_name ILIKE $${parameters.length} ESCAPE '\\'
          OR customer.email ILIKE $${parameters.length} ESCAPE '\\'
          OR COALESCE(customer.phone, '') ILIKE $${parameters.length} ESCAPE '\\')`,
      );
    }
    return {
      whereSql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
      parameters,
    };
  }

  private userStatsCte(): string {
    return `WITH booking_values AS (
              SELECT booking.booking_id,
                     booking.customer_id,
                     booking.status,
                     COALESCE(SUM(detail.applied_price), 0)
                       * (booking.check_out_date - booking.check_in_date) AS booking_value
              FROM bookings booking
              LEFT JOIN booking_details detail ON detail.booking_id = booking.booking_id
              GROUP BY booking.booking_id, booking.customer_id, booking.status,
                       booking.check_in_date, booking.check_out_date
            ),
            customer_stats AS (
              SELECT customer_id,
                     COUNT(*)::int AS booking_count,
                     COUNT(*) FILTER (WHERE status = 'Confirmed')::int AS confirmed_booking_count,
                     COUNT(*) FILTER (WHERE status = 'CheckedIn')::int AS checked_in_booking_count,
                     COUNT(*) FILTER (WHERE status IN ('Pending', 'Confirmed', 'CheckedIn'))::int AS active_booking_count,
                     COALESCE(SUM(booking_value) FILTER (WHERE status IN ('Confirmed', 'CheckedIn', 'Completed')), 0) AS booking_value
              FROM booking_values
              GROUP BY customer_id
            )`;
  }

  private userSelectSql(): string {
    return `SELECT customer.customer_id,
                   customer.full_name,
                   customer.email,
                   customer.phone,
                   customer.nationality,
                   customer.role,
                   customer.account_status,
                   customer.version,
                   customer.created_at,
                   customer.updated_at,
                   customer.deleted_at,
                   COALESCE(stats.booking_count, 0)::int AS booking_count,
                   COALESCE(stats.confirmed_booking_count, 0)::int AS confirmed_booking_count,
                   COALESCE(stats.checked_in_booking_count, 0)::int AS checked_in_booking_count,
                   COALESCE(stats.active_booking_count, 0)::int AS active_booking_count,
                   COALESCE(stats.booking_value, 0) AS booking_value
            FROM customers customer
            LEFT JOIN customer_stats stats ON stats.customer_id = customer.customer_id`;
  }

  private mapUser(row: Record<string, unknown>): AdminUserView {
    return {
      customer_id: String(row.customer_id),
      full_name: String(row.full_name),
      email: String(row.email),
      phone: row.phone === null ? null : String(row.phone),
      nationality: row.nationality === null ? null : String(row.nationality),
      role: row.role as 'customer' | 'admin',
      account_status: row.account_status as 'Active' | 'Suspended' | 'Deactivated',
      version: Number(row.version),
      created_at: row.created_at as Date,
      updated_at: row.updated_at as Date,
      deleted_at: row.deleted_at as Date | null,
      booking_count: Number(row.booking_count),
      confirmed_booking_count: Number(row.confirmed_booking_count),
      checked_in_booking_count: Number(row.checked_in_booking_count),
      active_booking_count: Number(row.active_booking_count),
      booking_value: Number(row.booking_value),
    };
  }
}
