import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { KafkaProducerService } from './infrastructure/kafka-producer.service';
import { OutboxPublisherService } from './infrastructure/outbox-publisher.service';
import { RedisCacheService } from './infrastructure/redis-cache.service';
import { BookingWorkflowService } from './modules/booking-workflow/booking-workflow.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly dataSource: DataSource,
    private readonly redis: RedisCacheService,
    private readonly kafka: KafkaProducerService,
    private readonly outbox: OutboxPublisherService,
    private readonly workflow: BookingWorkflowService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', service: 'backend_core' };
  }

  @Get()
  async check() {
    return this.readiness();
  }

  @Get('ready')
  async ready() {
    return this.readiness();
  }

  private async readiness() {
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      throw new ServiceUnavailableException('Database is unavailable.');
    }

    let outbox;
    try {
      outbox = await this.outbox.stats();
    } catch {
      throw new ServiceUnavailableException('Transactional outbox is unavailable.');
    }
    const [redis, kafka] = await Promise.all([this.redis.check(), this.kafka.check()]);
    let workflow;
    try { workflow = await this.workflow.readiness(); }
    catch { throw new ServiceUnavailableException('Booking workflow is unavailable.'); }
    const degraded = redis.status !== 'ok' || kafka.status !== 'ok'
      || workflow.expiry_worker !== 'running' || workflow.expired_backlog > 0;
    return {
      status: degraded ? 'degraded' : 'ok',
      service: 'backend_core',
      dependencies: {
        database: 'ok',
        redis: redis.status,
        kafka: kafka.status,
      },
      kafka_topic: this.kafka.getTopic(),
      outbox,
      workflow,
    };
  }
}
