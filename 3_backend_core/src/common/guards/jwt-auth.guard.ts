import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { Customer } from '../../modules/auth/entities/customer.entity';

export interface AuthenticatedUser {
  sub: string;
  full_name: string;
  email: string;
  phone: string | null;
  nationality: string | null;
  role: string;
  account_status: string;
  version: number;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 1 || item.slice(0, separator).trim() !== name) continue;
    const value = item.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const bearerToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = bearerToken || cookieValue(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!token) throw new UnauthorizedException('Cần đăng nhập để tiếp tục.');

    try {
      const payload = this.jwt.verify<{ sub: string; ver?: number }>(token, {
        algorithms: ['HS256'],
        issuer: 'hotel-ai-core',
        audience: 'hotel-ai-web',
      });
      const customer = await this.customers.findOne({ where: { customer_id: payload.sub } });
      if (!customer) throw new Error('Unknown user');
      if (customer.account_status !== 'Active') {
        throw new ForbiddenException('Tài khoản hiện không hoạt động. Vui lòng liên hệ quản trị viên.');
      }
      // Tokens issued before auth_version existed remain valid only while the
      // migrated row is still at version 1.
      if ((payload.ver ?? 1) !== customer.auth_version) throw new Error('Stale session');

      request.user = {
        sub: customer.customer_id,
        full_name: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        nationality: customer.nationality,
        role: customer.role,
        account_status: customer.account_status,
        version: customer.version,
      } satisfies AuthenticatedUser;
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('Phiên đăng nhập không hợp lệ hoặc đã hết hạn.');
    }
  }
}
