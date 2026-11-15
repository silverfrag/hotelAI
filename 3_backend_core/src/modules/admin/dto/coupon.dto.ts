import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateCouponDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @IsNotEmpty({ message: 'Mã coupon không được để trống.' })
  @IsString()
  @Matches(/^[A-Z0-9_-]{3,32}$/, {
    message: 'Mã coupon chỉ gồm chữ hoa A-Z, số 0-9, gạch dưới _ hoặc gạch ngang - (3-32 ký tự).',
  })
  code: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty({ message: 'Mô tả coupon không được để trống.' })
  @IsString()
  @MinLength(3, { message: 'Mô tả coupon phải có ít nhất 3 ký tự.' })
  @MaxLength(255, { message: 'Mô tả coupon tối đa 255 ký tự.' })
  description_vi: string;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01, { message: 'Phần trăm giảm tối thiểu 1% (0.01).' })
  @Max(0.5, { message: 'Phần trăm giảm tối đa 50% (0.50).' })
  discount_pct: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1000, { message: 'Mức giảm tối đa phải từ 1.000 VND trở lên.' })
  @Max(50_000_000, { message: 'Mức giảm tối đa không vượt quá 50.000.000 VND.' })
  max_discount_vnd: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Hạng phòng tối thiểu không hợp lệ.' })
  @Max(2_147_483_647)
  min_room_type_id: number;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Giới hạn lượt dùng phải >= 1.' })
  @Max(100_000)
  usage_limit: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsDateString({ strict: true }, { message: 'Ngày hết hạn phải theo định dạng YYYY-MM-DD.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày hết hạn phải theo định dạng YYYY-MM-DD.' })
  expiry_date?: string | null;
}

export class UpdateCouponDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(3, { message: 'Mô tả coupon phải có ít nhất 3 ký tự.' })
  @MaxLength(255, { message: 'Mô tả coupon tối đa 255 ký tự.' })
  description_vi?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0.01, { message: 'Phần trăm giảm tối thiểu 1% (0.01).' })
  @Max(0.5, { message: 'Phần trăm giảm tối đa 50% (0.50).' })
  discount_pct?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1000, { message: 'Mức giảm tối đa phải từ 1.000 VND trở lên.' })
  @Max(50_000_000, { message: 'Mức giảm tối đa không vượt quá 50.000.000 VND.' })
  max_discount_vnd?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Hạng phòng tối thiểu không hợp lệ.' })
  @Max(2_147_483_647)
  min_room_type_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1, { message: 'Giới hạn lượt dùng phải >= 1.' })
  @Max(100_000)
  usage_limit?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @ValidateIf((_, val) => val !== null && val !== undefined)
  @IsDateString({ strict: true }, { message: 'Ngày hết hạn phải theo định dạng YYYY-MM-DD.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Ngày hết hạn phải theo định dạng YYYY-MM-DD.' })
  expiry_date?: string | null;

  @IsOptional()
  @IsBoolean()
  reset_used_count?: boolean;
}

