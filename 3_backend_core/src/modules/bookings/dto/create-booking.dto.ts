import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BookingRoomItemDto {
  @IsNotEmpty() @IsInt() @Min(1) @Max(2_147_483_647) room_type_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  guest_count = 1;

  @IsOptional()
  @IsUUID('4')
  quote_id?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(32)
  coupon_code?: string;
}

export class CreateBookingDto {
  // Legacy single-room fields
  @IsOptional() @IsInt() @Min(1) @Max(2_147_483_647) room_type_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  guest_count?: number;

  @IsOptional()
  @IsUUID('4')
  quote_id?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(32)
  coupon_code?: string;

  // New multi-room field
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BookingRoomItemDto)
  rooms?: BookingRoomItemDto[];

  @IsNotEmpty() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @IsNotEmpty() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date: string;
  @IsNotEmpty() @IsInt() @Min(0) @Max(5) total_of_special_requests: number;
}
