import { Module } from '@nestjs/common';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';
import { AiShadowService } from './ai-shadow.service';

@Module({
  controllers: [PricingController],
  providers: [PricingService, AiShadowService],
  exports: [PricingService],
})
export class PricingModule {}
