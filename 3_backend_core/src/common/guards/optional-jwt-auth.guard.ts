import {
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SESSION_COOKIE_NAME } from '../../modules/auth/auth.constants';
import { Customer } from '../../modules/auth/entities/customer.entity';
import { AuthenticatedUser } from './jwt-auth.guard';

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
export class OptionalJwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const bearerToken = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    const token = bearerToken || cookieValue(request.headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      request.user = undefined;
      return true;
    }

    try {
      const payload = this.jwt.verify<{ sub: string; ver?: number }>(token, {
        algorithms: ['HS256'],
        issuer: 'hotel-ai-core',
        audience: 'hotel-ai-web',
      });
      const customer = await this.customers.findOne({ where: { customer_id: payload.sub } });
      if (customer && customer.account_status === 'Active' && (payload.ver ?? 1) === customer.auth_version) {
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
      }
    } catch {
      request.user = undefined;
    }
    return true;
  }
}
