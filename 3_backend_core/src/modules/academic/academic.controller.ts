import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsIn, IsInt, Matches, Max, Min } from 'class-validator';
import { AcademicService, AcademicTask, HoldoutOrder } from './academic.service';
import { AcademicBookingDto } from './dto/academic-booking.dto';

class HoldoutQuery {
  @IsIn(['adr', 'cancellation']) task: AcademicTask = 'adr';
  @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsIn(['source', 'largest_error', 'smallest_error']) order: HoldoutOrder = 'source';
}
class ExperimentDto {
  @IsIn(['adr', 'cancellation']) task: AcademicTask;
  @Matches(/^booking-\d+$/) row_id: string;
}

@Controller('academic')
export class AcademicController {
  constructor(private readonly academic: AcademicService) {}
  @Get('info') async info() { return { data: await this.academic.info() }; }
  @Post('decision') @HttpCode(200) async decision(@Body() dto: AcademicBookingDto) { return { data: await this.academic.decide(dto) }; }
  @Get('holdout') async holdout(@Query() query: HoldoutQuery) {
    return { data: await this.academic.holdout(query.task, query.offset, query.limit, query.order) };
  }
  @Post('experiment') @HttpCode(200) async experiment(@Body() dto: ExperimentDto) {
    return { data: await this.academic.experiment(dto.task, dto.row_id) };
  }
}
