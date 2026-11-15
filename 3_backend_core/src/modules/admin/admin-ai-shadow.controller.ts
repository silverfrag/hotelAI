import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminAiShadowService } from './admin-ai-shadow.service';
import {
  PauseAiShadowDto,
  RollbackAiShadowDto,
  UpdateAiShadowSettingDto,
} from './dto/pricing.dto';

@Controller('admin/pricing/shadow')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminAiShadowController {
  constructor(private readonly shadow: AdminAiShadowService) {}

  @Get('settings')
  async getSetting() {
    return { status: 'success', data: await this.shadow.getSetting() };
  }

  @Patch('settings')
  async updateSetting(
    @Body() dto: UpdateAiShadowSettingDto,
    @Req() request: { user: { sub: string } },
  ) {
    return {
      status: 'success',
      message: 'Đã cập nhật AI shadow policy; không thay đổi giá đang phục vụ.',
      data: await this.shadow.updateSetting(dto, request.user.sub),
    };
  }

  @Post('pause')
  async pause(
    @Body() dto: PauseAiShadowDto,
    @Req() request: { user: { sub: string } },
  ) {
    return {
      status: 'success',
      message: 'Đã pause shadow evaluation; pricing champion vẫn hoạt động.',
      data: await this.shadow.pause(dto, request.user.sub),
    };
  }

  @Post('rollback')
  async rollback(
    @Body() dto: RollbackAiShadowDto,
    @Req() request: { user: { sub: string } },
  ) {
    return {
      status: 'success',
      message: 'Đã khôi phục policy cũ thành version mới ở trạng thái pause.',
      data: await this.shadow.rollback(dto, request.user.sub),
    };
  }

  @Get('readiness')
  async readiness() {
    return { status: 'success', data: await this.shadow.getReadiness() };
  }

  @Get('audits')
  async audits(@Query('limit') limit?: string) {
    const parsed = Number(limit ?? 50);
    return {
      status: 'success',
      data: await this.shadow.listAudits(Number.isFinite(parsed) ? parsed : 50),
    };
  }

  @Get('runtime-status')
  async runtimeStatus() {
    return {
      status: 'success',
      data: await this.shadow.getRuntimeStatus(),
    };
  }
}
