import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';

export type EnqueueDomainEvent = {
  aggregateType: string;
  aggregateId: string | number;
  eventType: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class OutboxService {
  async enqueue(manager: EntityManager, event: EnqueueDomainEvent): Promise<string> {
    const rows = await manager.query(
      `INSERT INTO event_outbox (
         aggregate_type, aggregate_id, event_type, payload
       ) VALUES ($1, $2, $3, $4::jsonb)
       RETURNING event_id`,
      [
        event.aggregateType,
        String(event.aggregateId),
        event.eventType,
        JSON.stringify(event.payload),
      ],
    );
    return String(rows[0].event_id);
  }
}
