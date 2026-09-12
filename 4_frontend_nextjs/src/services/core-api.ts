export type CoreApiMessage = string | string[];

export interface CoreApiErrorPayload {
  status: 'error';
  statusCode: number;
  error: string;
  message: CoreApiMessage;
  path: string;
  timestamp: string;
  request_id: string;
}

export interface CoreApiSuccessMetadata {
  status: 'success';
  request_id: string;
}

export interface CoreApiErrorMetadata {
  statusCode?: number;
  error?: string | null;
  path?: string | null;
  timestamp?: string | null;
  requestId?: string | null;
}

export class CoreApiError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly error: string | null;
  readonly path: string | null;
  readonly timestamp: string | null;
  readonly requestId: string | null;

  constructor(message: string, status: number, metadata: CoreApiErrorMetadata = {}) {
    super(message);
    this.name = 'CoreApiError';
    this.status = status;
    this.statusCode = metadata.statusCode ?? status;
    this.error = metadata.error ?? null;
    this.path = metadata.path ?? null;
    this.timestamp = metadata.timestamp ?? null;
    this.requestId = metadata.requestId ?? null;
  }
}

type ErrorFactory = (
  message: string,
  status: number,
  metadata: CoreApiErrorMetadata,
) => CoreApiError;

export interface ParseCoreResponseOptions {
  fallbackMessage: string;
  invalidResponseMessage?: string;
  allowEmpty?: boolean;
  createError?: ErrorFactory;
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasErrorStatus(value: unknown): boolean {
  return isJsonRecord(value) && value.status === 'error';
}

function optionalString(record: JsonRecord | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function requestIdFrom(response: Response, record: JsonRecord | null): string | null {
  return optionalString(record, 'request_id')
    ?? response.headers.get('X-Request-ID')
    ?? null;
}

function messageFrom(record: JsonRecord | null, fallback: string): string {
  const value = record?.message;
  if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
    return value.join(' ');
  }
  if (typeof value === 'string' && value.length > 0) return value;
  return optionalString(record, 'error') ?? fallback;
}

function metadataFrom(response: Response, record: JsonRecord | null): CoreApiErrorMetadata {
  const payloadStatusCode = record?.statusCode;
  return {
    statusCode: typeof payloadStatusCode === 'number' ? payloadStatusCode : response.status,
    error: optionalString(record, 'error')
      ?? (!response.ok && response.statusText ? response.statusText : null),
    path: optionalString(record, 'path'),
    timestamp: optionalString(record, 'timestamp'),
    requestId: requestIdFrom(response, record),
  };
}

function makeError(
  response: Response,
  record: JsonRecord | null,
  message: string,
  createError?: ErrorFactory,
): CoreApiError {
  const metadata = metadataFrom(response, record);
  return createError
    ? createError(message, response.status, metadata)
    : new CoreApiError(message, response.status, metadata);
}

async function readJson(response: Response): Promise<unknown | null> {
  if (response.status === 204 || response.status === 205) return null;
  return response.json().catch(() => null) as Promise<unknown | null>;
}

/**
 * Parses one core API response without changing the endpoint's existing success
 * shape. Error envelopes are normalized into CoreApiError while their tracing
 * fields remain available to callers.
 */
export async function parseCoreResponse<T>(
  response: Response,
  options: ParseCoreResponseOptions,
): Promise<T | null> {
  const payload = await readJson(response);
  const record = isJsonRecord(payload) ? payload : null;

  if (!response.ok || hasErrorStatus(payload)) {
    throw makeError(
      response,
      record,
      messageFrom(record, options.fallbackMessage),
      options.createError,
    );
  }

  const isNoContentResponse = response.status === 204 || response.status === 205;
  if (payload === null && !(options.allowEmpty && isNoContentResponse)) {
    throw makeError(
      response,
      null,
      options.invalidResponseMessage ?? 'Máy chủ trả về dữ liệu không hợp lệ.',
      options.createError,
    );
  }

  return payload as T | null;
}

export function invalidCoreResponseError(
  response: Response,
  message: string,
  payload: unknown = null,
  createError?: ErrorFactory,
): CoreApiError {
  return makeError(response, isJsonRecord(payload) ? payload : null, message, createError);
}
