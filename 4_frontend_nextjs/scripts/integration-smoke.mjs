/**
 * Real Next -> core API smoke test. Node 20.9+; no extra dependencies.
 *
 * Start the isolated compose.test.yml stack with a fresh scratch database, then
 * start this Next app on port 53100 with:
 *   BACKEND_API_URL=http://127.0.0.1:53002/api/v1/core
 *   NEXT_PUBLIC_API_URL=/api/v1/core
 * Run from any directory:
 *   node 4_frontend_nextjs/scripts/integration-smoke.mjs --isolated-stack-ready
 *
 * The flag attests that the running Next server targets the isolated backend.
 * The script permits only the dedicated loopback ports, checks both catalogs
 * before writing, and never loads .env or accepts a deployment API URL.
 * Synthetic accounts, quotes, canceled bookings and audits remain as evidence.
 * It never connects to SQL, deletes records, changes policy, or records money.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const args = new Set(process.argv.slice(2));
assert(args.size === 1 && args.has('--isolated-stack-ready'),
  'Refusing mutations: confirm the fresh isolated stack and run with --isolated-stack-ready.');
const site = new URL(process.env.HOTELAI_SMOKE_URL ?? 'http://127.0.0.1:53100');
assert(site.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(site.hostname)
  && site.port === '53100' && site.pathname === '/' && !site.search && !site.hash
  && !site.username && !site.password, 'Only http://127.0.0.1:53100 or http://localhost:53100 is allowed.');
const backend = 'http://127.0.0.1:53002/api/v1/core';
if (process.env.BACKEND_API_URL) {
  assert.equal(process.env.BACKEND_API_URL.replace(/\/$/, ''), backend,
    'BACKEND_API_URL must identify the isolated backend on port 53002.');
}

const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
const evidenceDirectory = new URL('../../.tmp/frontend-smoke/', import.meta.url);
const evidenceFile = new URL(`${runId}.json`, evidenceDirectory);
const evidence = {
  run_id: runId, started_at: new Date().toISOString(), frontend: site.origin, backend,
  status: 'running', tests: [], requests: [], records: {},
};
const email = `frontend-smoke-${randomBytes(8).toString('hex')}@example.invalid`;
const password = `Smoke-${randomBytes(16).toString('hex')}-Aa1!`;
let sessionCookie = '';
let room;
let quoteInput;
let quote;
let created;
let bookingId;
let profile;

async function test(name, run) {
  const started = Date.now();
  try {
    await run();
    evidence.tests.push({ name, status: 'passed', duration_ms: Date.now() - started });
    console.log(`PASS ${name}`);
  } catch (error) {
    evidence.tests.push({ name, status: 'failed', duration_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function request(path, { method = 'GET', body, headers = {}, authenticated = false,
  authority = site.host, expected = 200, direct = false, json = true, chunked = false } = {}) {
  assert(path.startsWith('/') && !path.startsWith('//'), 'Requests must use relative API/site paths.');
  const target = new URL(direct ? `${backend}${path}` : path, site);
  const requestHeaders = { ...headers };
  // Resolve both tested host authorities through IPv4 loopback, avoiding a
  // localhost IPv6 DNS dependency when Next is deliberately bound to 127.0.0.1.
  if (!direct) requestHeaders.Host = authority;
  if (!['GET', 'HEAD'].includes(method) && !Object.hasOwn(requestHeaders, 'Origin')) {
    requestHeaders.Origin = `http://${authority}`;
    requestHeaders['Sec-Fetch-Site'] ??= 'same-origin';
  }
  if (authenticated) {
    assert(sessionCookie, 'An authenticated request requires a session cookie.');
    requestHeaders.Cookie = sessionCookie;
  }
  const bytes = body === undefined ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
  if (bytes) {
    requestHeaders['Content-Type'] ??= 'application/json';
    if (!chunked) requestHeaders['Content-Length'] = String(bytes.byteLength);
    else requestHeaders['Transfer-Encoding'] = 'chunked';
  }
  const started = Date.now();
  const result = await new Promise((resolve, reject) => {
    const outgoing = http.request({
      hostname: '127.0.0.1', port: Number(target.port), path: `${target.pathname}${target.search}`,
      method, headers: requestHeaders, signal: AbortSignal.timeout(30000),
    }, (incoming) => {
      const chunks = [];
      let size = 0;
      incoming.on('data', (chunk) => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) incoming.destroy(new Error('Response exceeds smoke-test limit.'));
        else chunks.push(chunk);
      });
      incoming.on('error', reject);
      incoming.on('end', () => resolve({ status: incoming.statusCode, headers: incoming.headers,
        text: Buffer.concat(chunks).toString('utf8') }));
    });
    outgoing.on('error', reject);
    if (bytes && chunked) {
      for (let index = 0; index < bytes.length; index += 64 * 1024) outgoing.write(bytes.subarray(index, index + 64 * 1024));
      outgoing.end();
    } else outgoing.end(bytes);
  });
  evidence.requests.push({ path, method, authority: direct ? '127.0.0.1:53002' : authority,
    status: result.status, request_id: result.headers['x-request-id'] ?? null,
    duration_ms: Date.now() - started });
  assert.ok((Array.isArray(expected) ? expected : [expected]).includes(result.status),
    `${method} ${path}: expected ${expected}, received ${result.status}`);
  if (json) {
    assert.match(result.headers['content-type'] ?? '', /application\/json/, `${path}: expected JSON`);
    result.payload = JSON.parse(result.text);
  }
  return result;
}

const core = (path, options) => request(`/api/v1/core${path}`, options);
const data = (result) => {
  assert.equal(result.payload?.status, 'success');
  assert.ok(result.payload.data, 'Expected a nonempty data envelope.');
  return result.payload.data;
};
const checkMoney = (actual, expected, label) => assert.ok(Number.isFinite(actual)
  && Math.abs(actual - expected) < 0.011, `${label}: expected ${expected}, received ${actual}`);
const visibleText = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
  .replace(/&amp;/g, '&').replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
function acceptSession(result) {
  const cookie = (result.headers['set-cookie'] ?? []).find((value) => value.startsWith('hotelai_session='));
  assert.ok(cookie, 'The proxy must preserve the session Set-Cookie header.');
  assert.match(cookie, /;\s*HttpOnly/i);
  assert.match(cookie, /;\s*SameSite=Lax/i);
  assert.match(cookie, /;\s*Path=\//i);
  sessionCookie = cookie.split(';', 1)[0];
  assert.ok(sessionCookie.length > 'hotelai_session='.length);
}
function assertLifecycle(booking) {
  assert.ok(['Pending', 'Confirmed', 'CheckedIn', 'Completed', 'Canceled', 'Expired', 'NoShow'].includes(booking.status));
  assert.ok(Number.isInteger(booking.lifecycle_version) && booking.lifecycle_version > 0);
  assert.ok(booking.policy_version === null || Number.isInteger(booking.policy_version));
  assert.ok(Number.isFinite(booking.deposit_required) && booking.deposit_required >= 0);
  assert.equal(typeof booking.checkout_payment_required, 'boolean');
  if (booking.status === 'Pending') assert.ok(Date.parse(booking.pending_expires_at) > Date.now());
}

try {
  await mkdir(evidenceDirectory, { recursive: true });
  await test('isolated backend readiness and matching real catalog', async () => {
    await request('/health/ready', { direct: true });
    const directRooms = data(await request('/rooms', { direct: true }));
    const proxiedRooms = data(await core('/rooms'));
    assert.ok(Array.isArray(directRooms) && directRooms.length > 0);
    assert.deepEqual(proxiedRooms, directRooms, 'Next must serve the same catalog as the isolated backend.');
    room = directRooms.find((item) => item.total_rooms > 0 && item.capacity >= 1);
    assert.ok(room, 'A seeded room type with physical inventory is required.');
    assert.ok(Number.isInteger(room.type_id) && Number.isInteger(room.available_now));
    assert.equal(data(await core(`/rooms/${room.type_id}`)).type_name, room.type_name);
    evidence.records.room_type_id = room.type_id;
  });
  await test('room list and detail contain server-rendered catalog names', async () => {
    for (const path of ['/rooms', `/rooms/${room.type_id}`]) {
      const result = await request(path, { json: false });
      assert.match(result.headers['content-type'] ?? '', /text\/html/);
      assert.ok(visibleText(result.text).includes(room.type_name), `${path}: actual room name must be visible without hydration.`);
      assert.ok(!result.text.includes('http://127.0.0.1:53002'), 'Private backend URL must not be serialized to the browser.');
    }
    // Next emits 200 once a loading boundary has started streaming; notFound()
    // still renders the missing-page UI and adds noindex (installed Next docs).
    const missing = await request('/rooms/2147483648', { expected: [200, 404], json: false });
    assert.match(missing.text, /NEXT_HTTP_ERROR_FALLBACK;404/);
    assert.match(missing.text, /This page could not be found/);
    assert.match(missing.text, /noindex/);
  });
  await test('cross-origin and cross-site mutations are rejected before upstream', async () => {
    for (const headers of [
      { Origin: 'https://untrusted.example' },
      { Origin: site.origin, 'Sec-Fetch-Site': 'cross-site' },
      { Origin: 'https://untrusted.example', 'X-Forwarded-Host': 'untrusted.example', 'X-Forwarded-Proto': 'https' },
    ]) {
      const result = await core('/pricing/quote', { method: 'POST', body: {}, headers, expected: 403 });
      assert.equal(result.payload.message, 'Cross-origin mutation is not allowed.');
    }
  });
  await test('127.0.0.1 and localhost same-origin mutations reach validation', async () => {
    for (const authority of ['127.0.0.1:53100', 'localhost:53100']) {
      const result = await core('/pricing/quote', { method: 'POST', body: {}, authority, expected: 400 });
      assert.ok(result.headers['x-request-id'], 'Backend validation must retain its request ID.');
      assert.ok(Array.isArray(result.payload.message), 'Expected DTO validation rather than BFF CSRF rejection.');
    }
  });
  await test('API path validation and declared/streamed body bounds', async () => {
    const invalid = await core('/rooms/invalid%20id', { expected: 400 });
    assert.equal(invalid.payload.message, 'Invalid API path.');
    for (const chunked of [false, true]) {
      const result = await core('/pricing/quote', { method: 'POST', body: Buffer.alloc(1024 * 1024 + 1, 120),
        expected: 413, chunked });
      assert.equal(result.payload.message, 'Request body is too large.');
    }
  });
  await test('anonymous private account and booking endpoints require authentication', async () => {
    for (const path of ['/auth/me', '/users/me', '/bookings']) await core(path, { expected: 401 });
  });
  await test('registration preserves an HttpOnly cookie and authenticates the same scratch backend', async () => {
    const registration = await core('/auth/register', { method: 'POST', expected: 201,
      body: { full_name: 'Frontend Integration Smoke', email, password } });
    acceptSession(registration);
    const identity = (await core('/auth/me', { authenticated: true })).payload;
    assert.equal(identity.email, email);
    assert.equal(identity.role, 'customer');
    const directIdentity = (await request('/auth/me', { direct: true, headers: { Cookie: sessionCookie } })).payload;
    assert.equal(directIdentity.id, identity.id, 'Next cookie must authenticate against the isolated backend.');
    evidence.records.customer_id = identity.id;
    evidence.records.email = email;
  });
  await test('profile edits preserve optimistic concurrency', async () => {
    profile = data(await core('/users/me', { authenticated: true }));
    assert.ok(Number.isInteger(profile.version));
    const updated = data(await core('/users/me', { method: 'PATCH', authenticated: true,
      body: { expected_version: profile.version, full_name: 'Frontend Smoke Updated', nationality: 'Thailand' } }));
    assert.equal(updated.full_name, 'Frontend Smoke Updated');
    assert.equal(updated.version, profile.version + 1);
    await core('/users/me', { method: 'PATCH', authenticated: true, expected: 409,
      body: { expected_version: profile.version, full_name: 'This stale edit must fail' } });
    const persisted = data(await core('/users/me', { authenticated: true }));
    assert.equal(persisted.full_name, updated.full_name);
    assert.equal(persisted.version, updated.version);
  });
  await test('real date quote includes price lineage and available inventory', async () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const checkIn = addDays(today, 450 + randomBytes(1)[0]);
    quoteInput = { room_type_id: room.type_id, check_in_date: checkIn, check_out_date: addDays(checkIn, 2),
      guest_count: 1, total_of_special_requests: 1 };
    quote = data(await core('/pricing/quote', { method: 'POST', body: quoteInput, expected: 201 }));
    assert.equal(quote.room_type.type_id, room.type_id);
    assert.equal(quote.guest_count, quoteInput.guest_count);
    assert.equal(quote.nights, 2);
    assert.equal(quote.currency, 'VND');
    assert.equal(quote.is_estimate, true);
    assert.equal(quote.availability_is_guaranteed, false);
    assert.ok(quote.rooms_available > 0);
    assert.ok(Date.parse(quote.price_guaranteed_until) > Date.now());
    assert.ok(['ai', 'base'].includes(quote.pricing_source));
    if (quote.pricing_source === 'ai') {
      assert.ok(quote.ai_model_version && quote.ai_training_run_id && quote.ai_feature_contract_version);
    } else assert.equal(quote.ai_multiplier, 1);
    checkMoney(quote.total_price, quote.nightly_price * quote.nights, 'Quote total');
    evidence.records.quote_id = quote.quote_id;
    evidence.records.pricing_source = quote.pricing_source;
    evidence.records.ai_model_version = quote.ai_model_version;
  });
  await test('quote exposure is idempotent', async () => {
    const body = { event_type: 'quote.exposed.v1', session_id: randomUUID(), search_id: randomUUID() };
    const headers = { 'Idempotency-Key': `quote-event:quote.exposed.v1:${quote.quote_id}` };
    const first = data(await core(`/pricing/quotes/${quote.quote_id}/events`, { method: 'POST', body, headers, expected: 201 }));
    const replay = data(await core(`/pricing/quotes/${quote.quote_id}/events`, { method: 'POST', body, headers, expected: 201 }));
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(replay.quote_event_id, first.quote_event_id);
  });
  await test('booking uses the persisted quote and actual deposit policy', async () => {
    created = data(await core('/bookings', { method: 'POST', authenticated: true, expected: 201,
      body: { ...quoteInput, quote_id: quote.quote_id }, headers: { 'Idempotency-Key': `booking:${quote.quote_id}` } }));
    bookingId = created.booking?.booking_id;
    assert.match(bookingId, /^[a-f0-9-]{36}$/i);
    assertLifecycle(created.booking);
    assert.equal(created.booking.status, created.booking.deposit_required > 0 ? 'Pending' : 'Confirmed');
    assert.equal(created.quote_id, quote.quote_id);
    assert.equal(created.payment_status, 'Unpaid');
    assert.equal(created.booking.guest_count, quoteInput.guest_count);
    checkMoney(created.total_price, quote.total_price, 'Booked total');
    checkMoney(created.nightly_price, quote.nightly_price, 'Booked nightly price');
    checkMoney(created.balance_due, quote.total_price, 'Initial balance');
    evidence.records.booking_id = bookingId;
    evidence.records.initial_status = created.booking.status;
    evidence.records.deposit_required = created.booking.deposit_required;
  });
  await test('stable booking key replays once and rejects changed input', async () => {
    const options = { method: 'POST', authenticated: true, expected: 201,
      body: { ...quoteInput, quote_id: quote.quote_id }, headers: { 'Idempotency-Key': `booking:${quote.quote_id}` } };
    const replay = data(await core('/bookings', options));
    assert.equal(replay.booking.booking_id, bookingId);
    checkMoney(replay.total_price, created.total_price, 'Replayed total');
    await core('/bookings', { ...options, expected: 409,
      body: { ...options.body, total_of_special_requests: 2 } });
    const history = data(await core('/bookings', { authenticated: true }));
    assert.equal(history.length, 1, 'Replay must not create another booking for the fresh synthetic account.');
    assert.equal(history[0].booking_id, bookingId);
    assert.equal(history[0].can_cancel, true);
    assertLifecycle(history[0]);
  });
  await test('customer payment history reflects the ledger and blocks admin mutations', async () => {
    const payment = data(await core(`/bookings/${bookingId}/payment`, { authenticated: true }));
    assert.equal(payment.booking_status, created.booking.status);
    assert.equal(payment.payment_status, 'Unpaid');
    assert.equal(payment.transactions.length, 0);
    assert.equal(payment.paid_amount, 0);
    checkMoney(payment.deposit_due, created.booking.deposit_required, 'Deposit due');
    checkMoney(payment.balance_due, created.total_price, 'Payment balance');
    assert.equal(payment.can_record_payment, true);
    await core('/admin/dashboard', { authenticated: true, expected: 403 });
    await core(`/admin/bookings/${bookingId}/payments`, { method: 'POST', authenticated: true, expected: 403,
      body: { amount: 1, method: 'Cash', idempotency_key: `forbidden-smoke-${runId}` } });
    assert.equal(data(await core(`/bookings/${bookingId}/payment`, { authenticated: true })).transactions.length, 0);
  });
  await test('cancellation, payment view and idempotent replay return authoritative terminal state', async () => {
    const canceled = data(await core(`/bookings/${bookingId}/cancel`, { method: 'PATCH', authenticated: true }));
    assert.equal(canceled.status, 'Canceled');
    assert.equal(canceled.can_cancel, false);
    assert.ok(canceled.lifecycle_version > created.booking.lifecycle_version);
    assert.equal(canceled.balance_due, 0);
    assert.equal(canceled.refund_due, 0);
    const history = data(await core('/bookings', { authenticated: true }));
    assert.equal(history.length, 1);
    assert.equal(history[0].status, canceled.status);
    assert.equal(history[0].can_cancel, false);
    const payment = data(await core(`/bookings/${bookingId}/payment`, { authenticated: true }));
    assert.equal(payment.booking_status, 'Canceled');
    assert.equal(payment.can_record_payment, false);
    assert.equal(payment.deposit_due, 0);
    assert.equal(payment.balance_due, 0);
    const replay = data(await core('/bookings', { method: 'POST', authenticated: true, expected: 201,
      body: { ...quoteInput, quote_id: quote.quote_id }, headers: { 'Idempotency-Key': `booking:${quote.quote_id}` } }));
    assert.equal(replay.booking.booking_id, bookingId);
    assert.equal(replay.booking.status, 'Canceled');
    assert.equal(replay.balance_due, 0);
    await core(`/bookings/${bookingId}/cancel`, { method: 'PATCH', authenticated: true, expected: 409 });
    const restored = data(await core('/pricing/quote', { method: 'POST', body: quoteInput, expected: 201 }));
    assert.equal(restored.rooms_available, quote.rooms_available);
    evidence.records.restored_quote_id = restored.quote_id;
    evidence.records.final_status = canceled.status;
  });
  await test('logout clears the cookie and login restores the same account', async () => {
    const logout = await core('/auth/logout', { method: 'POST', authenticated: true });
    assert.ok((logout.headers['set-cookie'] ?? []).some((value) => /^hotelai_session=;/i.test(value) && /Expires=/i.test(value)));
    sessionCookie = '';
    await core('/auth/me', { expected: 401 });
    const login = await core('/auth/login', { method: 'POST', expected: 201, body: { email, password } });
    acceptSession(login);
    assert.equal((await core('/auth/me', { authenticated: true })).payload.id, evidence.records.customer_id);
    await core('/auth/logout', { method: 'POST', authenticated: true });
    sessionCookie = '';
  });
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed';
  evidence.error = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  evidence.finished_at = new Date().toISOString();
  // Only synthetic IDs, test assertions and response metadata are persisted.
  // Passwords, cookies, access tokens, response bodies and headers are excluded.
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ status: evidence.status, tests_passed: evidence.tests.filter((item) => item.status === 'passed').length,
    evidence: fileURLToPath(evidenceFile), ...(evidence.error ? { error: evidence.error } : {}) }, null, 2));
}
