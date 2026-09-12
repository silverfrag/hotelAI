import { Global, Module } from '@nestjs/common';
import { KafkaProducerService } from './kafka-producer.service';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { OutboxPublisherService } from './outbox-publisher.service';
import { OutboxService } from './outbox.service';
import { RedisCacheService } from './redis-cache.service';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    RedisCacheService,
    KafkaProducerService,
    MetricsService,
    OutboxService,
    OutboxPublisherService,
  ],
  exports: [
    RedisCacheService,
    KafkaProducerService,
    MetricsService,
    OutboxService,
    OutboxPublisherService,
  ],
})
export class InfrastructureModule {}
