import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminPaymentsQueryDto, RecordPaymentDto, RefundPaymentDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('payments')
  async listTransactions(@Query() query: AdminPaymentsQueryDto) {
    const result = await this.payments.listTransactions(query);
    return { status: 'success', count: result.data.length, ...result };
  }

  @Post('bookings/:bookingId/payments')
  async recordPayment(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Body() dto: RecordPaymentDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Ghi nhận thanh toán thành công.',
      data: await this.payments.recordPayment(bookingId, request.user.sub, dto),
    };
  }

  @Post('payments/:paymentId/refunds')
  async refundPayment(
    @Param('paymentId', new ParseUUIDPipe({ version: '4' })) paymentId: string,
    @Body() dto: RefundPaymentDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Ghi nhận hoàn tiền thành công.',
      data: await this.payments.refundPayment(paymentId, request.user.sub, dto),
    };
  }
}
