import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Customer } from './entities/customer.entity';

@Injectable()
export class AuthService {
  constructor(@InjectRepository(Customer) private readonly customers: Repository<Customer>, private readonly jwt: JwtService) {}
  async register(dto: RegisterDto) {
    if (await this.customers.exists({ where: { email: dto.email.toLowerCase() } })) throw new ConflictException('Email đã được sử dụng.');
    try {
      const customer = await this.customers.save({ full_name: dto.full_name.trim(), email: dto.email.toLowerCase(), password_hash: await bcrypt.hash(dto.password, 12) });
      return this.issue(customer);
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new ConflictException('Email đã được sử dụng.');
      throw error;
    }
  }
  async login(dto: LoginDto) {
    const customer = await this.customers.createQueryBuilder('customer').addSelect('customer.password_hash').where('customer.email = :email', { email: dto.email.toLowerCase() }).getOne();
    if (!customer?.password_hash || !await bcrypt.compare(dto.password, customer.password_hash)) throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    return this.issue(customer);
  }
  private issue(customer: Customer) {
    return { access_token: this.jwt.sign({ sub: customer.customer_id, role: customer.role, email: customer.email, full_name: customer.full_name }), user: { id: customer.customer_id, full_name: customer.full_name, email: customer.email, role: customer.role } };
  }
}
