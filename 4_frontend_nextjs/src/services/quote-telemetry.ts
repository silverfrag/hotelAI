'use client';

import { recordQuoteEvent } from '@/services/booking.service';
import {
  QuoteClientEvent,
  QuoteEventResult,
  QuoteTrackingContext,
} from '@/types/room.type';

const QUOTE_SESSION_STORAGE_KEY = 'hotelai.quote-session-id';
const eventRequests = new Map<string, Promise<QuoteEventResult>>();
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function newTrackingId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10).join(''),
  ].join('-');
}

export function createQuoteSearchId(): string {
  return newTrackingId();
}

export function getOrCreateQuoteSessionId(): string {
  try {
    const stored = window.sessionStorage.getItem(QUOTE_SESSION_STORAGE_KEY);
    if (stored && UUID_V4_PATTERN.test(stored)) return stored;
    const created = newTrackingId();
    window.sessionStorage.setItem(QUOTE_SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts. The
    // fallback still gives this mounted checkout flow a valid anonymous ID.
    return newTrackingId();
  }
}

export function quoteEventKey(quoteId: string, eventType: QuoteClientEvent): string {
  return `quote-event:${eventType}:${quoteId}`;
}

/**
 * Coalesces duplicate calls in the same browser document. The API's stable
 * Idempotency-Key remains the source of truth across reloads and retries.
 */
export function recordQuoteEventOnce(
  quoteId: string,
  eventType: QuoteClientEvent,
  context: QuoteTrackingContext,
): Promise<QuoteEventResult> {
  const key = quoteEventKey(quoteId, eventType);
  const existing = eventRequests.get(key);
  if (existing) return existing;

  const request = recordQuoteEvent(quoteId, eventType, context).catch((error) => {
    eventRequests.delete(key);
    throw error;
  });
  eventRequests.set(key, request);
  return request;
}
