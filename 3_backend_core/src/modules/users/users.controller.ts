import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SESSION_COOKIE_NAME } from '../auth/auth.constants';
import { ChangePasswordDto, DeactivateAccountDto, UpdateProfileDto } from './dto/user-account.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService,
  ) {}

  @Get('me')
  async getProfile(@Req() request: { user: AuthenticatedUser }) {
    return { status: 'success', data: await this.users.getProfile(request.user.sub) };
  }

  @Patch('me')
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @Req() request: { user: AuthenticatedUser },
  ) {
    return {
      status: 'success',
      message: 'Cập nhật hồ sơ thành công.',
      data: await this.users.updateProfile(request.user.sub, dto),
    };
  }

  @Patch('me/password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() request: { user: AuthenticatedUser },
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.users.changePassword(request.user.sub, dto);
    this.clearSessionCookie(response);
    return {
      status: 'success',
      message: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
      data,
    };
  }

  @Post('me/deactivate')
  @HttpCode(HttpStatus.OK)
  async deactivate(
    @Body() dto: DeactivateAccountDto,
    @Req() request: { user: AuthenticatedUser },
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.users.deactivate(request.user.sub, dto);
    this.clearSessionCookie(response);
    return { status: 'success', message: 'Tài khoản đã được vô hiệu hóa và ẩn thông tin cá nhân.' };
  }

  private clearSessionCookie(response: Response): void {
    const secureValue = this.config.get<string>('COOKIE_SECURE', 'false').toLowerCase();
    response.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      secure: secureValue === 'true' || secureValue === '1',
      sameSite: 'lax',
      path: '/',
    });
    response.setHeader('Cache-Control', 'no-store');
  }
}
