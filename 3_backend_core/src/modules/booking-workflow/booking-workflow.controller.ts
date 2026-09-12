import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BookingWorkflowService } from './booking-workflow.service';
import {
  AuthorizeBookingCreditDto,
  BookingWorkflowActionDto,
  BookingWorkflowPageDto,
  ExpirePendingBookingsDto,
  UpdateBookingPolicyDto,
} from './dto/booking-workflow.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminBookingWorkflowController {
  constructor(private readonly workflow: BookingWorkflowService) {}

  @Get('booking-policy')
  async getPolicy() {
    return { status: 'success', data: await this.workflow.getPolicy() };
  }

  @Patch('booking-policy')
  async updatePolicy(
    @Body() dto: UpdateBookingPolicyDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return { status: 'success', data: await this.workflow.updatePolicy(dto, request.user.sub) };
  }

  @Get('bookings/:bookingId/financial-status')
  async financialStatus(@Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string) {
    return { status: 'success', data: await this.workflow.financialStatus(bookingId) };
  }

  @Post('bookings/:bookingId/confirm')
  @HttpCode(200)
  async confirm(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: BookingWorkflowActionDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      data: await this.workflow.confirmPending(bookingId, dto, request.user.sub, idempotencyKey),
    };
  }

  @Post('bookings/:bookingId/no-show')
  @HttpCode(200)
  async noShow(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: BookingWorkflowActionDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      data: await this.workflow.markNoShow(bookingId, dto, request.user.sub, idempotencyKey),
    };
  }

  @Post('bookings/:bookingId/credit-authorization')
  @HttpCode(200)
  async authorizeCredit(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: AuthorizeBookingCreditDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      data: await this.workflow.authorizeCredit(bookingId, dto, request.user.sub, idempotencyKey),
    };
  }

  @Get('workflow/readiness')
  async readiness() {
    return { status: 'success', data: await this.workflow.readiness() };
  } 

  @Post('workflow/expire')
  @HttpCode(200)
  async expire(
    @Body() dto: ExpirePendingBookingsDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return { status: 'success', data: await this.workflow.expirePending(dto.limit, request.user.sub) };
  }
}

@Controller('users/me/notifications')
@UseGuards(JwtAuthGuard)
export class CustomerNotificationsController {
  constructor(private readonly workflow: BookingWorkflowService) {}

  @Get()
  async list(@Query() query: BookingWorkflowPageDto, @Req() request: { user: AuthenticatedUser }) {
    const result = await this.workflow.listNotifications(request.user.sub, query);
    return { status: 'success', count: result.data.length, ...result };
  }

  @Patch(':notificationId/read')
  async markRead(
    @Param('notificationId', new ParseUUIDPipe({ version: '4' })) notificationId: string,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      data: await this.workflow.markNotificationRead(request.user.sub, notificationId),
    };
  }
}
