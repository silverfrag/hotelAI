import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AdminCouponsService } from './admin-coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminCouponsController {
  constructor(private readonly coupons: AdminCouponsService) {}

  @Get()
  async list() {
    const result = await this.coupons.listCoupons();
    return {
      status: 'success',
      data: result.data,
      summary: result.summary,
    };
  }

  @Post()
  async create(@Body() dto: CreateCouponDto) {
    return {
      status: 'success',
      message: 'Đã tạo mã ưu đãi mới.',
      data: await this.coupons.createCoupon(dto),
    };
  }

  @Patch(':code')
  async update(@Param('code') code: string, @Body() dto: UpdateCouponDto) {
    return {
      status: 'success',
      message: 'Đã cập nhật mã ưu đãi.',
      data: await this.coupons.updateCoupon(code, dto),
    };
  }
}

