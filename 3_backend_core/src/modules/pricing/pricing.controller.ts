import { Body, Controller, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PriceQuoteDto } from './dto/price-quote.dto';
import { RecordQuoteEventDto } from './dto/record-quote-event.dto';
import { PricingService } from './pricing.service';

@Controller('pricing')
export class PricingController {
  constructor(private readonly pricing: PricingService) {}

  @Post('quote')
  async quote(@Body() dto: PriceQuoteDto) {
    return {
      status: 'success',
      message: 'Báo giá tạm tính đã được tạo.',
      data: await this.pricing.quote(dto),
    };
  }

  @Post('quotes/:quoteId/events')
  async recordQuoteEvent(
    @Param('quoteId', new ParseUUIDPipe({ version: '4' })) quoteId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: RecordQuoteEventDto,
  ) {
    return {
      status: 'success',
      message: 'Sự kiện báo giá đã được ghi nhận.',
      data: await this.pricing.recordClientQuoteEvent(quoteId, dto, idempotencyKey),
    };
  }
}
