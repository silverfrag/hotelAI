import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 3, ttl: 10 * 60_000 } })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me') @UseGuards(JwtAuthGuard)
  me(@Req() request: { user: { sub: string; full_name: string; email: string; role: string } }) {
    const { sub: id, full_name, email, role } = request.user;
    return { id, full_name, email, role };
  }
}
