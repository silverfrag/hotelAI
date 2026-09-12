import { createHmac, randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core').replace(/\/$/, '');
const allowedOrigin = process.env.SMOKE_ALLOWED_ORIGIN ?? 'http://localhost';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const email = `contract-${runId}@example.com`;
const customerId = randomUUID();
const quoteIds = [];
const database = new pg.Client({
  host: process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST ?? 'localhost'),
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? process.env.DB_USER ?? 'hotel_admin',
  password: process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.POSTGRES_DB ?? process.env.DB_NAME ?? 'hotel_db',
});

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function createAccessToken() {
  const secret = process.env.JWT_SECRET;
  ensure(typeof secret === 'string' && secret.length >= 32, 'JWT_SECRET is missing or too short.');
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64UrlJson({ alg: 'HS256', typ: 'JWT' })}.${base64UrlJson({
    sub: customerId,
    ver: 1,
    iss: 'hotel-ai-core',
    aud: 'hotel-ai-web',
    iat: now,
    exp: now + 600,
  })}`;
  const signature = createHmac('sha256', secret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, json, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (json !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    body: json === undefined ? init.body : JSON.stringify(json),
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text };
}

function assertRequestId(result, label) {
  const header = result.response.headers.get('x-request-id');
  ensure(typeof header === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(header), `${label} has no valid X-Request-ID header.`);
  ensure(result.body?.request_id === header, `${label} body/header request IDs differ.`);
  return header;
}

function assertRequestIdHeader(result, label) {
  const header = result.response.headers.get('x-request-id');
  ensure(typeof header === 'string' && /^[A-Za-z0-9._:-]{8,100}$/.test(header), `${label} has no valid X-Request-ID header.`);
  return header;
}

function assertError(result, statusCode, expectedPath, label) {
  ensure(result.response.status === statusCode, `${label} returned ${result.response.status}, expected ${statusCode}.`);
  ensure(result.body?.status === 'error', `${label} lacks status=error.`);
  ensure(result.body?.statusCode === statusCode, `${label} statusCode is inconsistent.`);
  ensure(typeof result.body?.error === 'string' && result.body.error.length > 0, `${label} lacks an error title.`);
  ensure(
    typeof result.body?.message === 'string' || Array.isArray(result.body?.message),
    `${label} has an invalid message.`,
  );
  if (Array.isArray(result.body.message)) {
    ensure(result.body.message.every((item) => typeof item === 'string'), `${label} has a non-string validation message.`);
  }
  ensure(result.body?.path === expectedPath, `${label} path was ${result.body?.path}.`);
  ensure(!Number.isNaN(Date.parse(result.body?.timestamp)), `${label} timestamp is invalid.`);
  ensure(!Object.hasOwn(result.body, 'stack'), `${label} leaked a stack trace.`);
  const actualKeys = Object.keys(result.body).sort();
  const expectedKeys = ['error', 'message', 'path', 'request_id', 'status', 'statusCode', 'timestamp'].sort();
  ensure(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys), `${label} has unexpected keys: ${actualKeys.join(', ')}.`);
  assertRequestId(result, label);
}

function futureDate(offsetDays) {
  return new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
}

async function cleanup() {
  try {
    await database.query('BEGIN');
    if (quoteIds.length > 0) {
      await database.query("SELECT set_config('hotelai.allow_quote_event_cleanup', 'on', true)");
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_type = 'pricing_quote'
           AND (aggregate_id = ANY($1::text[]) OR payload->>'quote_id' = ANY($1::text[]))`,
        [quoteIds],
      );
      await database.query('DELETE FROM pricing_quote_events WHERE quote_id = ANY($1::uuid[])', [quoteIds]);
      await database.query('DELETE FROM pricing_quotes WHERE quote_id = ANY($1::uuid[])', [quoteIds]);
    }
    await database.query(
      `DELETE FROM event_outbox
       WHERE aggregate_id = $1::text OR payload->>'customer_id' = $1::text`,
      [customerId],
    );
    await database.query(
      `DELETE FROM customer_account_audits
       WHERE customer_id = $1::uuid OR changed_by = $1::uuid`,
      [customerId],
    );
    await database.query('DELETE FROM customers WHERE customer_id = $1::uuid', [customerId]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }
}

await waitForApi(baseUrl);
await database.connect();

try {
  await database.query(
    `INSERT INTO customers (
       customer_id, full_name, email, role, account_status, version, auth_version
     ) VALUES ($1::uuid, 'API Contract Smoke', $2, 'customer', 'Active', 1, 1)`,
    [customerId, email],
  );
  const token = createAccessToken();

  const clientRequestId = `client-contract-${runId}`;
  const rooms = await request('/rooms', {
    headers: { 'X-Request-ID': clientRequestId },
  });
  ensure(rooms.response.status === 200 && rooms.body?.status === 'success', 'Success envelope is invalid.');
  ensure(Array.isArray(rooms.body?.data), 'Room success payload is missing data.');
  const publicRequestId = assertRequestId(rooms, 'Room success');
  if (baseUrl === 'http://localhost/api/v1/core') {
    ensure(publicRequestId !== clientRequestId, 'The public gateway did not replace the client-supplied request ID.');
  }

  const roomTypeId = Number(rooms.body.data[0]?.type_id);
  ensure(Number.isInteger(roomTypeId) && roomTypeId > 0, 'No room type is available for the quote contract test.');
  const quote = await request('/pricing/quote', {
    method: 'POST',
    json: {
      room_type_id: roomTypeId,
      check_in_date: futureDate(30),
      check_out_date: futureDate(32),
      total_of_special_requests: 0,
    },
  });
  ensure(quote.response.status === 201, `Quote returned ${quote.response.status}, expected 201.`);
  ensure(quote.body?.status === 'success' && quote.body?.data?.room_type?.type_id === roomTypeId, '201 success payload is invalid.');
  quoteIds.push(quote.body.data.quote_id);
  assertRequestId(quote, 'Quote success');

  const live = await request('/health/live');
  ensure(live.response.status === 200 && live.body?.status === 'ok', 'Health status semantics changed.');
  assertRequestId(live, 'Health success');

  const metrics = await request('/metrics');
  ensure(metrics.response.status === 200, `Metrics returned ${metrics.response.status}.`);
  ensure(typeof metrics.body === 'string' && metrics.body.includes('# HELP'), 'Metrics was wrapped as JSON.');
  ensure(metrics.response.headers.get('content-type')?.startsWith('text/plain'), 'Metrics content type changed.');

  const validation = await request('/pricing/quote', { method: 'POST', json: {} });
  assertError(validation, 400, '/api/v1/core/pricing/quote', 'Validation error');
  ensure(Array.isArray(validation.body.message), 'Validation errors must remain an array.');

  const malformedJson = await request('/pricing/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"broken":',
  });
  assertError(malformedJson, 400, '/api/v1/core/pricing/quote', 'Malformed JSON error');

  const oversizedBody = await request('/pricing/quote', {
    method: 'POST',
    json: { padding: 'x'.repeat(110 * 1024) },
  });
  assertError(oversizedBody, 413, '/api/v1/core/pricing/quote', 'Oversized body error');

  const unauthorized = await request('/admin/dashboard');
  assertError(unauthorized, 401, '/api/v1/core/admin/dashboard', 'Unauthorized error');

  const identity = await request('/auth/me', { token });
  ensure(identity.response.status === 200 && identity.body?.id === customerId, 'Identity payload changed shape.');
  ensure(identity.body?.status === 'success', 'Identity lacks success status.');
  assertRequestId(identity, 'Identity success');

  const forbidden = await request('/admin/dashboard', { token });
  assertError(forbidden, 403, '/api/v1/core/admin/dashboard', 'Forbidden error');

  await database.query("UPDATE customers SET role = 'admin' WHERE customer_id = $1::uuid", [customerId]);
  const pagination = await request('/admin/users?limit=1&offset=0', { token });
  ensure(pagination.response.status === 200 && pagination.body?.status === 'success', 'Pagination response failed.');
  ensure(
    pagination.body?.limit === 1
      && pagination.body?.offset === 0
      && Number.isInteger(pagination.body?.total)
      && Array.isArray(pagination.body?.data),
    'Pagination metadata changed shape.',
  );
  assertRequestId(pagination, 'Pagination success');

  const conflict = await request('/users/me', {
    method: 'PATCH',
    token,
    json: { full_name: 'Must Not Be Written', expected_version: 2 },
  });
  assertError(conflict, 409, '/api/v1/core/users/me', 'Conflict error');

  const missingTypeRows = await database.query(
    'SELECT EXISTS (SELECT 1 FROM room_types WHERE type_id = 2147483647) AS exists',
  );
  ensure(missingTypeRows.rows[0]?.exists === false, 'Reserved missing room type unexpectedly exists.');
  const missing = await request('/rooms/2147483647?password=must-not-appear');
  assertError(missing, 404, '/api/v1/core/rooms/2147483647', 'Not-found error');
  ensure(!missing.text.includes('must-not-appear'), 'Error body leaked the query string.');

  const crossOrigin = await request('/users/me', {
    method: 'PATCH',
    headers: {
      Origin: 'https://untrusted.example',
      Cookie: `hotelai_session=${token}`,
    },
    json: { full_name: 'Must Not Be Written Cross-Origin', expected_version: 2 },
  });
  assertError(crossOrigin, 403, '/api/v1/core/users/me', 'Cross-origin error');

  const crossSite = await request('/users/me', {
    method: 'PATCH',
    token,
    headers: {
      Origin: allowedOrigin,
      'Sec-Fetch-Site': 'cross-site',
    },
    json: { full_name: 'Must Not Be Written Cross-Site', expected_version: 2 },
  });
  assertError(crossSite, 403, '/api/v1/core/users/me', 'Fetch-metadata error');

  const unknownRoute = await request('/contract-route-that-does-not-exist?secret=must-not-appear');
  assertError(unknownRoute, 404, '/api/v1/core/contract-route-that-does-not-exist', 'Unknown-route error');
  ensure(!unknownRoute.text.includes('must-not-appear'), 'Unknown-route error leaked its query string.');

  const preflight = await request('/users/me', {
    method: 'OPTIONS',
    headers: {
      Origin: allowedOrigin,
      'Access-Control-Request-Method': 'PATCH',
    },
  });
  ensure(preflight.response.status === 204 && preflight.text === '', 'Allowed CORS preflight must remain an empty 204 response.');
  ensure(preflight.response.headers.get('access-control-allow-origin') === allowedOrigin, 'Allowed CORS origin header is missing.');
  assertRequestIdHeader(preflight, 'CORS preflight');

  const logout = await request('/auth/logout', {
    method: 'POST',
    headers: { Cookie: `hotelai_session=${token}` },
  });
  ensure(logout.response.status === 200 && logout.body?.status === 'success', 'Message-only logout response changed shape.');
  ensure(typeof logout.body?.message === 'string' && !Object.hasOwn(logout.body, 'data'), 'Logout must remain message-only.');
  ensure(logout.response.headers.get('cache-control')?.includes('no-store'), 'Logout response lacks Cache-Control: no-store.');
  ensure(logout.response.headers.get('set-cookie')?.includes('hotelai_session='), 'Logout did not clear the session cookie.');
  assertRequestId(logout, 'Logout success');

  const fixture = await database.query(
    'SELECT full_name, version FROM customers WHERE customer_id = $1::uuid',
    [customerId],
  );
  ensure(
    fixture.rows[0]?.full_name === 'API Contract Smoke' && Number(fixture.rows[0]?.version) === 1,
    'Rejected conflict request mutated the fixture.',
  );

  console.log(JSON.stringify({
    status: 'ok',
    success_contract: true,
    created_and_paginated_success_contracts: true,
    validation_message_array: true,
    error_statuses: [400, 401, 403, 404, 409, 413],
    cross_origin_standardized: true,
    malformed_json_standardized: true,
    metrics_preserved: true,
    request_id_correlated: true,
    cors_preflight_preserved: true,
    logout_cookie_contract: true,
  }));
} finally {
  await cleanup();
  await database.end();
}
