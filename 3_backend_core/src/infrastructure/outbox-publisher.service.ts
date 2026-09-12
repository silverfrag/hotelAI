import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { KafkaProducerService } from './kafka-producer.service';
import { MetricsService } from './metrics.service';

type OutboxRow = {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown> | string;
  occurred_at: Date;
  attempts: number;
};

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dataSource: DataSource,
    private readonly kafka: KafkaProducerService,
    private readonly metrics: MetricsService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = Math.max(
      250,
      Number(this.config.get<string>('OUTBOX_POLL_INTERVAL_MS', '1000')),
    );
    this.timer = setInterval(() => void this.flush().catch(() => undefined), interval);
    this.timer.unref();
    void this.flush().catch(() => undefined);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async flush(): Promise<number> {
    if (this.running || !this.dataSource.isInitialized) return 0;
    this.running = true;
    try {
      const published = await this.dataSource.transaction((manager) => this.publishBatch(manager));
      await this.refreshPendingMetric();
      return published;
    } finally {
      this.running = false;
    }
  }

  async stats(): Promise<{ pending: number; retrying: number; oldest_pending_at: Date | null }> {
    const rows = await this.dataSource.query(
      `SELECT COUNT(*) FILTER (WHERE published_at IS NULL)::int AS pending,
              COUNT(*) FILTER (WHERE published_at IS NULL AND attempts > 0)::int AS retrying,
              MIN(occurred_at) FILTER (WHERE published_at IS NULL) AS oldest_pending_at
       FROM event_outbox`,
    );
    return {
      pending: Number(rows[0].pending),
      retrying: Number(rows[0].retrying),
      oldest_pending_at: rows[0].oldest_pending_at ?? null,
    };
  }

  private async publishBatch(manager: EntityManager): Promise<number> {
    const batchSize = Math.min(
      100,
      Math.max(1, Number(this.config.get<string>('OUTBOX_BATCH_SIZE', '20'))),
    );
    const rows = await manager.query(
      `SELECT event.event_id, event.aggregate_type, event.aggregate_id, event.event_type,
              event.payload, event.occurred_at, event.attempts
       FROM event_outbox event
       WHERE event.published_at IS NULL
         AND event.next_attempt_at <= CURRENT_TIMESTAMP
         AND NOT EXISTS (
           SELECT 1
           FROM event_outbox predecessor
           WHERE predecessor.aggregate_type = event.aggregate_type
             AND predecessor.aggregate_id = event.aggregate_id
             AND predecessor.published_at IS NULL
             AND (predecessor.occurred_at, predecessor.event_id)
                 < (event.occurred_at, event.event_id)
         )
       ORDER BY event.occurred_at ASC, event.event_id ASC
       LIMIT $1
       FOR UPDATE OF event SKIP LOCKED`,
      [batchSize],
    ) as OutboxRow[];
    let published = 0;
    for (const row of rows) {
      try {
        await this.kafka.publish({
          event_id: row.event_id,
          aggregate_type: row.aggregate_type,
          aggregate_id: row.aggregate_id,
          event_type: row.event_type,
          occurred_at: row.occurred_at,
          payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
        });
        await manager.query(
          `UPDATE event_outbox
           SET published_at = CURRENT_TIMESTAMP,
               attempts = attempts + 1,
               last_error = NULL
           WHERE event_id = $1::uuid`,
          [row.event_id],
        );
        this.metrics.recordOutboxPublished(row.event_type);
        published += 1;
      } catch (error) {
        const errorMessage = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        await manager.query(
          `UPDATE event_outbox
           SET attempts = attempts + 1,
               last_error = $2,
               next_attempt_at = CURRENT_TIMESTAMP
                 + LEAST(300, POWER(2, LEAST(attempts + 1, 8))) * INTERVAL '1 second'
           WHERE event_id = $1::uuid`,
          [row.event_id, errorMessage],
        );
        this.metrics.recordOutboxFailure(row.event_type);
        break;
      }
    }
    return published;
  }

  private async refreshPendingMetric(): Promise<void> {
    try {
      const rows = await this.dataSource.query(
        'SELECT COUNT(*)::int AS count FROM event_outbox WHERE published_at IS NULL',
      );
      this.metrics.setOutboxPending(Number(rows[0].count));
    } catch {
      // Database readiness is reported by the health endpoint. Metrics are best-effort.
    }
  }
}
