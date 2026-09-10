import { getBackendApiUrl } from '@/services/backend-url';

export const runtime = 'nodejs';
type Context = { params: Promise<{ path: string[] }> };
const MAX_BODY_BYTES = 1024 * 1024;

class BodyError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

async function readBody(request: Request): Promise<ArrayBuffer | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BodyError(408, 'Request body timed out.')), 15000);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new BodyError(413, 'Request body is too large.');
      chunks.push(value);
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return body.buffer;
  } finally {
    if (timer) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

function apiError(status: number, message: string) {
  return Response.json({ status: 'error', statusCode: status, message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function forward(request: Request, context: Context): Promise<Response> {
  const url = new URL(request.url);
  const unsafe = !['GET', 'HEAD'].includes(request.method);
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  // This boundary owns browser CSRF validation before the server-to-server hop.
  // Never trust incoming X-Forwarded-* headers or forward browser Origin blindly.
  // Next can normalize request.url to its bind hostname. Host is the actual
  // request authority; web pages cannot override this forbidden request header.
  const expectedOrigin = process.env.FRONTEND_ORIGIN ?? `${url.protocol}//${request.headers.get('host') ?? url.host}`;
  if (unsafe && ((origin !== null && origin !== expectedOrigin) || (fetchSite !== null && !['same-origin', 'none'].includes(fetchSite)))) {
    return apiError(403, 'Cross-origin mutation is not allowed.');
  }
  const { path } = await context.params;
  if (!path.length || path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) return apiError(400, 'Invalid API path.');
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return apiError(413, 'Request body is too large.');
  const headers = new Headers();
  for (const name of ['content-type', 'cookie', 'authorization', 'idempotency-key', 'x-request-id']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  try {
    const body = unsafe ? await readBody(request) : undefined;
    const target = `${getBackendApiUrl()}/${path.map(encodeURIComponent).join('/')}${url.search}`;
    if (new URL(target).origin === url.origin) return apiError(503, 'Hotel service is not configured.');
    const upstream = await fetch(target, {
      method: request.method, headers, body, cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(15000),
    });
    if (upstream.status >= 300 && upstream.status < 400) return apiError(502, 'Hotel service returned an unexpected redirect.');
    const responseHeaders = new Headers({ 'Cache-Control': 'no-store' });
    for (const name of ['content-type', 'x-request-id', 'retry-after']) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);
    return new Response(request.method === 'HEAD' || [204, 205].includes(upstream.status) ? null : upstream.body, {
      status: upstream.status, headers: responseHeaders,
    });
  } catch (caught) {
    if (caught instanceof BodyError) return apiError(caught.status, caught.message);
    return apiError(503, 'The hotel service is temporarily unavailable. Please try again.');
  }
}

export const GET = forward;
export const HEAD = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
