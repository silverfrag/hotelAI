import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(value);
}

export function getOrCreateRequestId(value: unknown): string {
  return isValidRequestId(value) ? value : randomUUID();
}
