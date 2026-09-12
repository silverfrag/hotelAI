import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { AdminBookingWorkflowController, CustomerNotificationsController } from './booking-workflow.controller';
import { BookingWorkflowService } from './booking-workflow.service';

@Module({
  imports: [AuthModule, ConfigModule],
  controllers: [AdminBookingWorkflowController, CustomerNotificationsController],
  providers: [BookingWorkflowService],
  exports: [BookingWorkflowService],
})
export class BookingWorkflowModule {}
