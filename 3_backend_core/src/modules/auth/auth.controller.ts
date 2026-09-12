import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthenticatedUser, JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_MS } from './auth.constants';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 3, ttl: 10 * 60_000 } })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.register(dto);
    this.setSessionCookie(response, result.access_token);
    return result;
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.login(dto);
    this.setSessionCookie(response, result.access_token);
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(SESSION_COOKIE_NAME, this.cookieOptions());
    response.setHeader('Cache-Control', 'no-store');
    return { status: 'success', message: 'Đăng xuất thành công.' };
  }

  @Get('me') @UseGuards(JwtAuthGuard)
  me(@Req() request: { user: AuthenticatedUser }) {
    const { sub: id, full_name, email, phone, nationality, role, account_status, version } = request.user;
    return { id, full_name, email, phone, nationality, role, account_status, version };
  }

  private setSessionCookie(response: Response, token: string): void {
    response.cookie(SESSION_COOKIE_NAME, token, {
      ...this.cookieOptions(),
      maxAge: SESSION_MAX_AGE_MS,
    });
    response.setHeader('Cache-Control', 'no-store');
  }

  private cookieOptions() {
    const secureValue = this.config.get<string>('COOKIE_SECURE', 'false').toLowerCase();
    return {
      httpOnly: true,
      secure: secureValue === 'true' || secureValue === '1',
      sameSite: 'lax' as const,
      path: '/',
    };
  }
}
