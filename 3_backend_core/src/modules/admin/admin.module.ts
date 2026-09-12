import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { Customer } from '../auth/entities/customer.entity';
import { DailyPricingLog } from '../bookings/entities/daily-pricing-log.entity';
import { Room } from '../bookings/entities/room.entity';
import { RoomType } from '../rooms/entities/room.entity';
import { AdminPricingController } from './admin-pricing.controller';
import { AdminPricingService } from './admin-pricing.service';
import { AdminOperationsController } from './admin-operations.controller';
import { AdminOperationsService } from './admin-operations.service';
import { AdminRoomsController } from './admin-rooms.controller';
import { AdminRoomsService } from './admin-rooms.service';
import { PricingSetting } from './entities/pricing-setting.entity';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminAiShadowController } from './admin-ai-shadow.controller';
import { AdminAiShadowService } from './admin-ai-shadow.service';
import { AdminRoomTurnoverController } from './admin-room-turnover.controller';
import { AdminRoomTurnoverService } from './admin-room-turnover.service';
import { BookingWorkflowModule } from '../booking-workflow/booking-workflow.module';

@Module({
  imports: [AuthModule, BookingWorkflowModule, TypeOrmModule.forFeature([Customer, DailyPricingLog, PricingSetting, Room, RoomType])],
  controllers: [
    AdminRoomsController,
    AdminPricingController,
    AdminOperationsController,
    AdminUsersController,
    AdminAiShadowController,
    AdminRoomTurnoverController,
  ],
  providers: [
    AdminRoomsService,
    AdminPricingService,
    AdminOperationsService,
    AdminUsersService,
    AdminAiShadowService,
    AdminRoomTurnoverService,
  ],
})
export class AdminModule {}
