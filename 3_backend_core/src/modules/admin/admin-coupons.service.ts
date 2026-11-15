import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

export type AdminCouponView = {
  code: string;
  description_vi: string;
  discount_pct: number;
  max_discount_vnd: number;
  min_room_type_id: number;
  usage_limit: number;
  used_count: number;
  active: boolean;
  expiry_date: string | null;
  created_at: string;
};

type RawCouponRow = {
  code: string;
  description_vi: string;
  discount_pct: string | number;
  max_discount_vnd: string | number;
  min_room_type_id: number | string;
  usage_limit: number | string;
  used_count: number | string;
  active: boolean;
  expiry_date: string | null;
  created_at: Date | string;
};

function unwrapRows<T>(raw: unknown): T[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return (Array.isArray(raw[0]) ? raw[0] : raw) as T[];
}

function mapCoupon(row: RawCouponRow): AdminCouponView {
  return {
    code: String(row.code),
    description_vi: String(row.description_vi),
    discount_pct: Number(row.discount_pct),
    max_discount_vnd: Number(row.max_discount_vnd),
    min_room_type_id: Number(row.min_room_type_id),
    usage_limit: Number(row.usage_limit),
    used_count: Number(row.used_count),
    active: Boolean(row.active),
    expiry_date: row.expiry_date ?? null,
    created_at: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class AdminCouponsService {
  constructor(private readonly dataSource: DataSource) {}

  async listCoupons(): Promise<{
    data: AdminCouponView[];
    summary: {
      total: number;
      active_count: number;
      total_redemptions: number;
    };
  }> {
    const rows = await this.dataSource.query(
      `SELECT code,
              description_vi,
              discount_pct,
              max_discount_vnd,
              min_room_type_id,
              usage_limit,
              used_count,
              active,
              expiry_date::text,
              created_at
       FROM pricing_coupons
       ORDER BY active DESC, min_room_type_id ASC, discount_pct ASC, code ASC`,
    ) as RawCouponRow[];

    const data = rows.map(mapCoupon);
    return {
      data,
      summary: {
        total: data.length,
        active_count: data.filter((c) => c.active).length,
        total_redemptions: data.reduce((sum, c) => sum + c.used_count, 0),
      },
    };
  }

  async createCoupon(dto: CreateCouponDto): Promise<AdminCouponView> {
    const code = dto.code.trim().toUpperCase();
    const roomCheck = await this.dataSource.query(
      'SELECT type_id FROM room_types WHERE type_id = $1',
      [dto.min_room_type_id],
    ) as Array<{ type_id: number }>;
    if (!roomCheck[0]) {
      throw new BadRequestException(`Không tìm thấy hạng phòng tối thiểu ID=${dto.min_room_type_id}.`);
    }

    try {
      const inserted = await this.dataSource.query(
        `INSERT INTO pricing_coupons (
           code,
           description_vi,
           discount_pct,
           max_discount_vnd,
           min_room_type_id,
           usage_limit,
           used_count,
           active,
           expiry_date
         ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $8::date)
         RETURNING code, description_vi, discount_pct, max_discount_vnd,
                   min_room_type_id, usage_limit, used_count, active,
                   expiry_date::text, created_at`,
        [
          code,
          dto.description_vi.trim(),
          dto.discount_pct,
          dto.max_discount_vnd,
          dto.min_room_type_id,
          dto.usage_limit,
          dto.active ?? true,
          dto.expiry_date ?? null,
        ],
      );
      const row = unwrapRows<RawCouponRow>(inserted)[0];
      if (!row) {
        throw new InternalServerErrorException('Không thể lưu mã coupon mới.');
      }
      return mapCoupon(row);
    } catch (error) {
      const pgCode = (error as { code?: string; driverError?: { code?: string } })?.driverError?.code
        ?? (error as { code?: string })?.code;
      if (pgCode === '23505') {
        throw new ConflictException(`Mã coupon '${code}' đã tồn tại trong hệ thống.`);
      }
      if (pgCode === '23514') {
        throw new BadRequestException('Thông số coupon vi phạm ràng buộc hợp lệ của cơ sở dữ liệu.');
      }
      throw error;
    }
  }

  async updateCoupon(rawCode: string, dto: UpdateCouponDto): Promise<AdminCouponView> {
    const code = rawCode.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{3,32}$/.test(code)) {
      throw new BadRequestException('Mã coupon không đúng định dạng hợp lệ.');
    }

    const hasChange =
      dto.description_vi !== undefined
      || dto.discount_pct !== undefined
      || dto.max_discount_vnd !== undefined
      || dto.min_room_type_id !== undefined
      || dto.usage_limit !== undefined
      || dto.active !== undefined
      || dto.expiry_date !== undefined
      || dto.reset_used_count === true;

    if (!hasChange) {
      throw new BadRequestException('Cần ít nhất một trường cần cập nhật cho mã coupon.');
    }

    return this.dataSource.transaction(async (manager) => {
      const existingRows = await manager.query(
        `SELECT code, description_vi, discount_pct, max_discount_vnd,
                min_room_type_id, usage_limit, used_count, active,
                expiry_date::text, created_at
         FROM pricing_coupons
         WHERE code = $1
         FOR UPDATE`,
        [code],
      ) as RawCouponRow[];
      const current = existingRows[0];
      if (!current) {
        throw new NotFoundException(`Không tìm thấy mã coupon '${code}'.`);
      }

      if (dto.min_room_type_id !== undefined) {
        const roomCheck = await manager.query(
          'SELECT type_id FROM room_types WHERE type_id = $1',
          [dto.min_room_type_id],
        ) as Array<{ type_id: number }>;
        if (!roomCheck[0]) {
          throw new BadRequestException(`Không tìm thấy hạng phòng tối thiểu ID=${dto.min_room_type_id}.`);
        }
      }

      const nextUsedCount = dto.reset_used_count ? 0 : Number(current.used_count);
      const nextUsageLimit = dto.usage_limit !== undefined ? dto.usage_limit : Number(current.usage_limit);
      if (nextUsageLimit < nextUsedCount) {
        throw new ConflictException(
          `Giới hạn lượt dùng mới (${nextUsageLimit}) không thể nhỏ hơn số lượt đã sử dụng (${nextUsedCount}).`,
        );
      }

      const hasExpiryUpdate = dto.expiry_date !== undefined;
      const nextExpiryDate = dto.expiry_date ?? null;

      const updatedRaw = await manager.query(
        `UPDATE pricing_coupons
         SET description_vi = COALESCE($2, description_vi),
             discount_pct = COALESCE($3, discount_pct),
             max_discount_vnd = COALESCE($4, max_discount_vnd),
             min_room_type_id = COALESCE($5, min_room_type_id),
             usage_limit = COALESCE($6, usage_limit),
             used_count = CASE WHEN $7::boolean THEN 0 ELSE used_count END,
             active = COALESCE($8, active),
             expiry_date = CASE WHEN $9::boolean THEN $10::date ELSE expiry_date END
         WHERE code = $1
         RETURNING code, description_vi, discount_pct, max_discount_vnd,
                   min_room_type_id, usage_limit, used_count, active,
                   expiry_date::text, created_at`,
        [
          code,
          dto.description_vi ?? null,
          dto.discount_pct ?? null,
          dto.max_discount_vnd ?? null,
          dto.min_room_type_id ?? null,
          dto.usage_limit ?? null,
          dto.reset_used_count === true,
          dto.active ?? null,
          hasExpiryUpdate,
          nextExpiryDate,
        ],
      );

      const updatedRow = unwrapRows<RawCouponRow>(updatedRaw)[0];
      if (!updatedRow) {
        throw new InternalServerErrorException(`Không thể cập nhật mã coupon '${code}'.`);
      }
      return mapCoupon(updatedRow);
    });
  }
}

