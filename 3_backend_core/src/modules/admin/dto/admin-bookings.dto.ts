import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export enum AdminBookingStatus {
  Pending = 'Pending',
  Expired = 'Expired',
  NoShow = 'NoShow',
  Confirmed = 'Confirmed',
  CheckedIn = 'CheckedIn',
  Canceled = 'Canceled',
  Completed = 'Completed',
}

export class AdminBookingsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  offset = 0;

  @IsOptional()
  @IsEnum(AdminBookingStatus)
  status?: AdminBookingStatus;

  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}
