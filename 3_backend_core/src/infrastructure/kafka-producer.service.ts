import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Admin, Kafka, logLevel, Producer } from 'kafkajs';

export type DomainEventEnvelope = {
  event_id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  occurred_at: Date | string;
  payload: Record<string, unknown>;
};

@Injectable()
export class KafkaProducerService implements OnModuleInit, OnModuleDestroy {
  private readonly producer: Producer;
  private readonly admin: Admin;
  private readonly topic: string;
  private readonly topicPartitions: number;
  private readonly topicReplicationFactor: number;
  private producerConnected = false;
  private adminConnected = false;
  private topicReady = false;
  private producerConnection?: Promise<void>;
  private adminConnection?: Promise<void>;
  private topicSetup?: Promise<void>;
  private lastError: string | null = null;

  constructor(private readonly config: ConfigService) {
    const brokers = this.config
      .get<string>('KAFKA_BROKERS', 'kafka:29092')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const kafka = new Kafka({
      clientId: this.config.get<string>('KAFKA_CLIENT_ID', 'hotel-backend-core'),
      brokers,
      connectionTimeout: Number(this.config.get<string>('KAFKA_CONNECTION_TIMEOUT_MS', '2000')),
      requestTimeout: Number(this.config.get<string>('KAFKA_REQUEST_TIMEOUT_MS', '5000')),
      retry: { initialRetryTime: 250, retries: 3 },
      logLevel: logLevel.ERROR,
    });
    this.producer = kafka.producer({ allowAutoTopicCreation: true });
    this.admin = kafka.admin();
    this.topic = this.config.get<string>('KAFKA_DOMAIN_EVENTS_TOPIC', 'hotel.domain-events.v1');
    this.topicPartitions = Math.max(
      1,
      Number(this.config.get<string>('KAFKA_TOPIC_PARTITIONS', '1')),
    );
    this.topicReplicationFactor = Math.max(
      1,
      Number(this.config.get<string>('KAFKA_TOPIC_REPLICATION_FACTOR', '1')),
    );
  }

  onModuleInit(): void {
    void this.ensureProducer().catch(() => undefined);
    void this.ensureTopic().catch(() => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([
      this.producerConnected ? this.producer.disconnect() : Promise.resolve(),
      this.adminConnected ? this.admin.disconnect() : Promise.resolve(),
    ]);
  }

  async publish(event: DomainEventEnvelope): Promise<void> {
    await Promise.all([this.ensureProducer(), this.ensureTopic()]);
    try {
      await this.producer.send({
        topic: this.topic,
        acks: -1,
        messages: [{
          key: event.aggregate_id,
          value: JSON.stringify(event),
          headers: {
            'event-id': event.event_id,
            'event-type': event.event_type,
            'aggregate-type': event.aggregate_type,
          },
        }],
      });
      this.lastError = null;
    } catch (error) {
      await this.producer.disconnect().catch(() => undefined);
      this.producerConnected = false;
      this.lastError = this.errorMessage(error);
      throw error;
    }
  }

  async check(): Promise<{ status: 'ok' | 'unavailable'; error?: string }> {
    try {
      await this.withTimeout(this.checkMetadata(), 2_500);
      return { status: 'ok' };
    } catch (error) {
      await this.admin.disconnect().catch(() => undefined);
      this.adminConnected = false;
      this.adminConnection = undefined;
      this.topicReady = false;
      this.topicSetup = undefined;
      this.lastError = this.errorMessage(error);
      return { status: 'unavailable', error: this.lastError };
    }
  }

  getTopic(): string {
    return this.topic;
  }

  private async checkMetadata(): Promise<void> {
    await this.ensureTopic();
    const topics = await this.admin.listTopics();
    if (!topics.includes(this.topic)) {
      this.topicReady = false;
      throw new Error(`Kafka topic ${this.topic} is unavailable.`);
    }
  }

  private async ensureTopic(): Promise<void> {
    if (this.topicReady) return;
    if (!this.topicSetup) {
      this.topicSetup = this.ensureAdmin()
        .then(async () => {
          const topics = await this.admin.listTopics();
          if (!topics.includes(this.topic)) {
            await this.admin.createTopics({
              waitForLeaders: true,
              timeout: Number(this.config.get<string>('KAFKA_REQUEST_TIMEOUT_MS', '5000')),
              topics: [{
                topic: this.topic,
                numPartitions: this.topicPartitions,
                replicationFactor: this.topicReplicationFactor,
              }],
            });
          }
          this.topicReady = true;
          this.lastError = null;
        })
        .catch((error) => {
          this.topicReady = false;
          this.lastError = this.errorMessage(error);
          throw error;
        })
        .finally(() => {
          this.topicSetup = undefined;
        });
    }
    await this.topicSetup;
  }

  private async ensureProducer(): Promise<void> {
    if (this.producerConnected) return;
    if (!this.producerConnection) {
      this.producerConnection = this.producer.connect()
        .then(() => {
          this.producerConnected = true;
          this.lastError = null;
        })
        .catch((error) => {
          this.producerConnected = false;
          this.lastError = this.errorMessage(error);
          throw error;
        })
        .finally(() => {
          this.producerConnection = undefined;
        });
    }
    await this.producerConnection;
  }

  private async ensureAdmin(): Promise<void> {
    if (this.adminConnected) return;
    if (!this.adminConnection) {
      this.adminConnection = this.admin.connect()
        .then(() => {
          this.adminConnected = true;
        })
        .catch((error) => {
          this.adminConnected = false;
          this.lastError = this.errorMessage(error);
          throw error;
        })
        .finally(() => {
          this.adminConnection = undefined;
        });
    }
    await this.adminConnection;
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Kafka check timed out.')), timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  private errorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(0, 300);
  }
}
