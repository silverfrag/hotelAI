import { IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

export class AcademicBookingDto {
  @IsIn(['Resort Hotel', 'City Hotel']) hotel: string;
  @IsDateString({ strict: true }) @Matches(/^\d{4}-\d{2}-\d{2}$/) arrival_date: string;
  @IsInt() @Min(0) @Max(1000) lead_time: number;
  @IsInt() @Min(1) @Max(365) stay_nights: number;
  @IsInt() @Min(1) @Max(99) adults: number;
  @IsOptional() @IsInt() @Min(0) @Max(99) children: number | null = null;
  @IsInt() @Min(0) @Max(99) babies: number;
  @IsString() @Length(1, 30) reserved_room_type: string;
  @IsString() @Length(1, 30) meal: string;
  @IsString() @Length(1, 50) market_segment: string;
  @IsString() @Length(1, 30) distribution_channel: string;
  @IsString() @Length(1, 30) customer_type: string;
}
