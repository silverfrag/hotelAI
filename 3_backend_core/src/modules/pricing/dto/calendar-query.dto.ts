import { IsDateString, IsInt, IsNotEmpty, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CalendarQueryDto {
  @IsNotEmpty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  room_type_id: number;

  @IsNotEmpty()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  start_date: string;

  @IsNotEmpty()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  end_date: string;
}
