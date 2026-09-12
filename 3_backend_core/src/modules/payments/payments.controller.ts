import { Controller, Get, Param, ParseUUIDPipe, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';

@Controller('bookings')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get(':bookingId/payment')
  async getBookingPayment(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      data: await this.payments.getBookingSummary(
        bookingId,
        request.user.sub,
        request.user.role,
      ),
    };
  }
}
