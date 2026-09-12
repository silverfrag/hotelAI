import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class CreateBookingDto {
  @IsNotEmpty() @IsInt() @Min(1) @Max(2_147_483_647) room_type_id: number;
  @IsNotEmpty() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) check_in_date: string;
  @IsNotEmpty() @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) check_out_date: string;
  @IsNotEmpty() @IsInt() @Min(0) @Max(5) total_of_special_requests: number;

  // Optional for backward compatibility with clients created before guest
  // occupancy was persisted. New clients should always send this value.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  guest_count = 1;

  // Optional until the redesigned UI adopts the price-guarantee contract.
  // New clients should pass the quote returned by POST /pricing/quote.
  @IsOptional()
  @IsUUID('4')
  quote_id?: string;
}
