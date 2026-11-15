import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RevenueController } from './revenue.controller';
import { RevenueService } from './revenue.service';

@Module({
  imports: [ConfigModule],
  controllers: [RevenueController],
  providers: [RevenueService],
  exports: [RevenueService],
})
export class RevenueModule {}
