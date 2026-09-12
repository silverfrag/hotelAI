import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminPricingService } from './admin-pricing.service';
import { PricingLogsQueryDto, UpdatePricingSettingDto } from './dto/pricing.dto';

@Controller('admin/pricing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPricingController {
  constructor(private readonly adminPricing: AdminPricingService) {}

  @Get('settings')
  async getSetting() {
    return { status: 'success', data: await this.adminPricing.getSetting() };
  }

  @Patch('settings')
  async updateSetting(
    @Body() dto: UpdatePricingSettingDto,
    @Req() request: { user: { sub: string } },
  ) {
    return {
      status: 'success',
      message: 'Cập nhật cấu hình định giá thành công.',
      data: await this.adminPricing.updateSetting(dto, request.user.sub),
    };
  }

  @Get('logs')
  async listLogs(@Query() query: PricingLogsQueryDto) {
    const result = await this.adminPricing.listLogs(query);
    return {
      status: 'success',
      count: result.data.length,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
      data: result.data,
    };
  }
}
