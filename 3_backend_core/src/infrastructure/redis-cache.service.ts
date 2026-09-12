import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient } from 'redis';

export const ROOM_TYPES_CACHE_KEY = 'hotelai:room-types:v1';

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly client;
  private lastError: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.client = createClient({
      url: this.config.get<string>('REDIS_URL', 'redis://redis:6379'),
      socket: {
        connectTimeout: Number(this.config.get<string>('REDIS_CONNECT_TIMEOUT_MS', '1500')),
        reconnectStrategy: (retries) => Math.min(100 * 2 ** Math.min(retries, 5), 3_000),
      },
    });
    this.client.on('error', (error) => {
      this.lastError = this.errorMessage(error);
    });
    this.client.on('ready', () => {
      this.lastError = null;
    });
  }

  onModuleInit(): void {
    void this.client.connect().catch((error) => {
      this.lastError = this.errorMessage(error);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) await this.client.quit().catch(() => undefined);
  }

  async getJson<T>(key: string): Promise<T | null> {
    if (!this.client.isReady) return null;
    try {
      const value = await this.client.get(key);
      return value === null ? null : JSON.parse(value) as T;
    } catch (error) {
      this.lastError = this.errorMessage(error);
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.client.isReady) return;
    try {
      await this.client.set(key, JSON.stringify(value), { EX: ttlSeconds });
    } catch (error) {
      this.lastError = this.errorMessage(error);
    }
  }

  async delete(key: string): Promise<void> {
    if (!this.client.isReady) return;
    try {
      await this.client.del(key);
    } catch (error) {
      this.lastError = this.errorMessage(error);
    }
  }

  async check(): Promise<{ status: 'ok' | 'unavailable'; error?: string }> {
    if (!this.client.isReady) {
      return { status: 'unavailable', ...(this.lastError ? { error: this.lastError } : {}) };
    }
    try {
      await this.withTimeout(this.client.ping(), 1_000);
      return { status: 'ok' };
    } catch (error) {
      this.lastError = this.errorMessage(error);
      return { status: 'unavailable', error: this.lastError };
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Redis check timed out.')), timeoutMs);
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
