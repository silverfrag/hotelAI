import {
  Body,
  Controller,
  Get,
  Headers,
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
import { DatabaseIdPipe } from '../../common/pipes/database-id.pipe';
import { AdminRoomTurnoverService } from './admin-room-turnover.service';
import {
  ExecuteUpgradeDto,
  HousekeepingQueueQueryDto,
  ReassignRoomDto,
  UpdateHousekeepingStatusDto,
} from './dto/room-turnover.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminRoomTurnoverController {
  constructor(private readonly roomTurnover: AdminRoomTurnoverService) {}

  @Get('housekeeping')
  async listHousekeeping(@Query() query: HousekeepingQueueQueryDto) {
    const result = await this.roomTurnover.listHousekeeping(query);
    return {
      status: 'success',
      count: result.data.length,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      data: result.data,
    };
  }

  @Patch('rooms/:roomId/housekeeping')
  async updateHousekeepingStatus(
    @Param('roomId', DatabaseIdPipe) roomId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: UpdateHousekeepingStatusDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Cập nhật trạng thái housekeeping thành công.',
      data: await this.roomTurnover.updateHousekeepingStatus(
        roomId,
        dto,
        request.user.sub,
        idempotencyKey,
      ),
    };
  }

  @Post('bookings/:bookingId/reassign-room')
  async reassignRoom(
    @Param('bookingId', new ParseUUIDPipe({ version: '4' })) bookingId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ReassignRoomDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Đổi phòng cho booking thành công.',
      data: await this.roomTurnover.reassignRoom(
        bookingId,
        dto,
        request.user.sub,
        idempotencyKey,
      ),
    };
  }

  @Get('allocations/upgrade-recommendations')
  async getUpgradeRecommendations() {
    const recommendations = await this.roomTurnover.getSmartUpgradeRecommendations();
    return {
      status: 'success',
      count: recommendations.length,
      data: recommendations,
    };
  }

  @Post('allocations/execute-upgrade')
  async executeUpgrade(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: ExecuteUpgradeDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Nâng hạng phòng thông minh thành công.',
      data: await this.roomTurnover.executeUpgrade(
        dto,
        request.user.sub,
        idempotencyKey,
      ),
    };
  }
}

