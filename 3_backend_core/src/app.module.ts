import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    TypeOrmModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: (config: ConfigService) => ({ type: 'postgres', host: config.getOrThrow('DB_HOST'), port: config.getOrThrow<number>('DB_PORT'), username: config.getOrThrow('DB_USER'), password: config.getOrThrow('DB_PASSWORD'), database: config.getOrThrow('DB_NAME'), autoLoadEntities: true, synchronize: false }) }),
    AuthModule, RoomsModule, BookingsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
