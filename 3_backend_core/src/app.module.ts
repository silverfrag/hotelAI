import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { HealthController } from './health.controller';
import { AdminModule } from './modules/admin/admin.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { UsersModule } from './modules/users/users.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { BookingWorkflowModule } from './modules/booking-workflow/booking-workflow.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ type: 'postgres', host: config.getOrThrow('DB_HOST'), port: config.getOrThrow<number>('DB_PORT'), username: config.getOrThrow('DB_USER'), password: config.getOrThrow('DB_PASSWORD'), database: config.getOrThrow('DB_NAME'), autoLoadEntities: true, synchronize: false }) }),
    InfrastructureModule,
    AuthModule, UsersModule, RoomsModule, PricingModule, BookingsModule, PaymentsModule, AdminModule, BookingWorkflowModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiResponseInterceptor },
  ],
})
export class AppModule {}
