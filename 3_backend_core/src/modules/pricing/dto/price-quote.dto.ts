import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, Matches, Max, Min } from 'class-validator';

export class PriceQuoteDto {
  @IsNotEmpty()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  room_type_id: number;

  @IsNotEmpty()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  check_in_date: string;

  @IsNotEmpty()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  check_out_date: string;

  @IsNotEmpty()
  @IsInt()
  @Min(0)
  @Max(5)
  total_of_special_requests: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  guest_count = 1;
}
