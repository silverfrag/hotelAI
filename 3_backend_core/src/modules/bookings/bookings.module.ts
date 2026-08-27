import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { Booking } from './entities/booking.entity';
import { RoomType } from '../rooms/entities/room.entity';
import { BookingDetail } from './entities/booking-detail.entity';
import { DailyPricingLog } from './entities/daily-pricing-log.entity';
import { Room } from './entities/room.entity';
import { AuthModule } from '../auth/auth.module';
import { Customer } from '../auth/entities/customer.entity';

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Booking, BookingDetail, Customer, DailyPricingLog, Room, RoomType])],
  controllers: [BookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
