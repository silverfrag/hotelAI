import { Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/guards/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminOperationsService } from './admin-operations.service';
import { AdminBookingsQueryDto } from './dto/admin-bookings.dto';
import { AdminDashboardQueryDto } from './dto/admin-dashboard.dto';
import { TapeChartQueryDto } from './dto/tape-chart.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminOperationsController {
  constructor(private readonly adminOperations: AdminOperationsService) {}

  @Get('tape-chart')
  async getTapeChart(@Query() query: TapeChartQueryDto) {
    return {
      status: 'success',
      data: await this.adminOperations.getTapeChart(query),
    };
  }

  @Get('dashboard')
  async getDashboard(@Query() query: AdminDashboardQueryDto) {

    return {
      status: 'success',
      data: await this.adminOperations.getDashboard(query.months),
    };
  }

  @Get('bookings')
  async listBookings(@Query() query: AdminBookingsQueryDto) {
    const result = await this.adminOperations.listBookings(query);
    return {
      status: 'success',
      count: result.data.length,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      data: result.data,
    };
  }

  @Patch('bookings/:bookingId/complete')
  async completeBooking(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
  ) {
    return {
      status: 'success',
      message: 'Hoàn tất đặt phòng thành công.',
      data: await this.adminOperations.completeBooking(bookingId),
    };
  }

  @Patch('bookings/:bookingId/check-in')
  async checkInBooking(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Nhận phòng thành công.',
      data: await this.adminOperations.checkInBooking(bookingId, request.user.sub),
    };
  }

  @Patch('bookings/:bookingId/check-out')
  async checkOutBooking(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Trả phòng thành công.',
      data: await this.adminOperations.checkOutBooking(bookingId, request.user.sub),
    };
  }
}
