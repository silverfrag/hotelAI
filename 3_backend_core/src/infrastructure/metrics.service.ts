import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';

@Injectable()
export class MetricsService {
  private readonly registry = new Registry();
  private readonly httpRequests: Counter<'method' | 'route' | 'status_code'>;
  private readonly httpDuration: Histogram<'method' | 'route' | 'status_code'>;
  private readonly outboxPublished: Counter<'event_type'>;
  private readonly outboxFailures: Counter<'event_type'>;
  private readonly outboxPending: Gauge;

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'hotelai_' });
    this.httpRequests = new Counter({
      name: 'hotelai_http_requests_total',
      help: 'Total HTTP requests handled by the core API.',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });
    this.httpDuration = new Histogram({
      name: 'hotelai_http_request_duration_seconds',
      help: 'Core API HTTP request duration in seconds.',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [this.registry],
    });
    this.outboxPublished = new Counter({
      name: 'hotelai_outbox_published_total',
      help: 'Domain events acknowledged by Kafka.',
      labelNames: ['event_type'],
      registers: [this.registry],
    });
    this.outboxFailures = new Counter({
      name: 'hotelai_outbox_publish_failures_total',
      help: 'Domain event publish attempts that failed.',
      labelNames: ['event_type'],
      registers: [this.registry],
    });
    this.outboxPending = new Gauge({
      name: 'hotelai_outbox_pending',
      help: 'Current number of unpublished outbox events.',
      registers: [this.registry],
    });
  }

  recordHttp(method: string, route: string, statusCode: number, durationSeconds: number): void {
    const labels = { method, route, status_code: String(statusCode) };
    this.httpRequests.inc(labels);
    this.httpDuration.observe(labels, durationSeconds);
  }

  recordOutboxPublished(eventType: string): void {
    this.outboxPublished.inc({ event_type: eventType });
  }

  recordOutboxFailure(eventType: string): void {
    this.outboxFailures.inc({ event_type: eventType });
  }

  setOutboxPending(count: number): void {
    this.outboxPending.set(count);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  contentType(): string {
    return this.registry.contentType;
  }
}
