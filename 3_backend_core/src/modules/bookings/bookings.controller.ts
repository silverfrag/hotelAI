import { Body, Controller, Get, Headers, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CreateBookingDto } from './dto/create-booking.dto';
import { BookingsService } from './bookings.service';
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}
  @Post() @UseGuards(JwtAuthGuard)
  async create(
    @Body() dto: CreateBookingDto,
    @Req() request: { user: { sub: string } },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return {
      status: 'success',
      message: 'Đặt phòng và tính giá động thành công!',
      data: await this.bookings.create(dto, request.user.sub, idempotencyKey),
    };
  }
  @Get() @UseGuards(JwtAuthGuard)
  async findAll(@Req() request: { user: { sub: string; role: string } }) {
    const data = await this.bookings.findAll(request.user.sub, request.user.role);
    return { status: 'success', count: data.length, data };
  }

  @Patch(':bookingId/cancel')
  @UseGuards(JwtAuthGuard)
  async cancel(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Req() request: { user: { sub: string; role: string } },
  ) {
    const data = await this.bookings.cancel(bookingId, request.user.sub, request.user.role);
    return { status: 'success', message: 'Hủy đặt phòng thành công.', data };
  }
}
