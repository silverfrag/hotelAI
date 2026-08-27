import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../modules/auth/entities/customer.entity';
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @InjectRepository(Customer) private readonly customers: Repository<Customer>) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('Cần đăng nhập để đặt phòng.');
    try {
      const payload = this.jwt.verify<{ sub: string }>(token, { algorithms: ['HS256'], issuer: 'hotel-ai-core', audience: 'hotel-ai-web' });
      const customer = await this.customers.findOne({ where: { customer_id: payload.sub } });
      if (!customer) throw new Error('Unknown user');
      request.user = { sub: customer.customer_id, full_name: customer.full_name, email: customer.email, role: customer.role };
      return true;
    } catch { throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.'); }
  }
}
