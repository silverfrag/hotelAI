import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { OutboxService } from '../../infrastructure/outbox.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { Customer } from './entities/customer.entity';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly jwt: JwtService,
    private readonly dataSource: DataSource,
    private readonly outbox: OutboxService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    if (await this.customers.exists({ where: { email } })) {
      throw new ConflictException('Email đã được sử dụng.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await manager.getRepository(Customer).save({
          full_name: dto.full_name.trim(),
          email,
          password_hash: passwordHash,
        });
        await this.outbox.enqueue(manager, {
          aggregateType: 'customer',
          aggregateId: customer.customer_id,
          eventType: 'customer.registered.v1',
          payload: {
            customer_id: customer.customer_id,
            role: customer.role,
            account_status: customer.account_status,
            version: customer.version,
          },
        });
        return this.issue(customer);
      });
    } catch (error) {
      if ((error as { driverError?: { code?: string } }).driverError?.code === '23505') {
        throw new ConflictException('Email đã được sử dụng.');
      }
      throw error;
    }
  }

  async login(dto: LoginDto) {
    const customer = await this.customers
      .createQueryBuilder('customer')
      .addSelect('customer.password_hash')
      .where('customer.email = :email', { email: dto.email.toLowerCase() })
      .getOne();

    if (!customer?.password_hash || !(await bcrypt.compare(dto.password, customer.password_hash))) {
      throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
    }
    if (customer.account_status !== 'Active') {
      throw new ForbiddenException('Tài khoản hiện không hoạt động. Vui lòng liên hệ quản trị viên.');
    }
    return this.issue(customer);
  }

  private issue(customer: Customer) {
    return {
      access_token: this.jwt.sign({
        sub: customer.customer_id,
        ver: customer.auth_version,
        role: customer.role,
        email: customer.email,
        full_name: customer.full_name,
      }),
      user: {
        id: customer.customer_id,
        full_name: customer.full_name,
        email: customer.email,
        phone: customer.phone,
        nationality: customer.nationality,
        role: customer.role,
        account_status: customer.account_status,
        version: customer.version,
      },
    };
  }
}
