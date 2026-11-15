import { Body, Controller, Get, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminPricingService } from './admin-pricing.service';
import { AdminPricingIntelligenceService } from './admin-pricing-intelligence.service';
import {
  DriftMonitoringQueryDto,
  ExplainPricingSampleDto,
  PricingIntelligenceQueryDto,
} from './dto/pricing-intelligence.dto';
import { PricingLogsQueryDto, UpdatePricingSettingDto } from './dto/pricing.dto';

@Controller('admin/pricing')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminPricingController {
  constructor(
    private readonly adminPricing: AdminPricingService,
    private readonly intelligence: AdminPricingIntelligenceService,
  ) {}

  @Get('intelligence')
  async getIntelligence(@Query() query: PricingIntelligenceQueryDto) {
    return { status: 'success', data: await this.intelligence.getIntelligence(query) };
  }

  @Get('drift')
  async getDrift(@Query() query: DriftMonitoringQueryDto) {
    return { status: 'success', data: await this.intelligence.getDriftMonitoring(query) };
  }

  @Post('explain-sample')
  async explainSample(@Body() dto: ExplainPricingSampleDto) {
    return { status: 'success', data: await this.intelligence.explainPricingSample(dto) };
  }

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
