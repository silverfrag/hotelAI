// Behavioral checks of the server boundary. No listening server or real API writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const swc = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
function load(relative, dependencies, globals = {}) {
  const filename = path.join(root, relative);
  const source = swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' },
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, exports: module.exports,
    require: (name) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`);
      return dependencies[name];
    },
    URL, Request, Response, Headers, AbortSignal, Uint8Array,
    setTimeout, clearTimeout, process: { env: {} }, ...globals,
  }, { filename });
  return module.exports;
}

function boundary(fetch, globals) {
  return load('src/app/api/v1/core/[...path]/route.ts', {
    '@/services/backend-url': { getBackendApiUrl: () => 'http://private-core:3000/api/v1/core' },
  }, { fetch, ...globals });
}
const context = (parts = ['pricing', 'quote']) => ({ params: Promise.resolve({ path: parts }) });
const request = (headers = {}, body = '{}') => new Request('http://127.0.0.1:53100/api/v1/core/pricing/quote', {
  method: 'POST', headers: { host: '127.0.0.1:53100', 'content-type': 'application/json', ...headers }, body,
});

test('cross-origin and same-site unsafe requests never reach core', async () => {
  let calls = 0;
  const route = boundary(async () => { calls++; return Response.json({}); });
  for (const headers of [
    { origin: 'https://untrusted.example' },
    { origin: 'null' },
    { origin: 'http://127.0.0.1:53100', 'sec-fetch-site': 'same-site' },
    { 'sec-fetch-site': 'cross-site' },
  ]) assert.equal((await route.POST(request(headers), context())).status, 403);
  assert.equal(calls, 0);
});

test('actual Host supports localhost; trusted configured HTTPS origin works', async () => {
  const route = boundary(async () => Response.json({ status: 'success' }));
  assert.equal((await route.POST(request({ host: 'localhost:53100', origin: 'http://localhost:53100' }), context())).status, 200);
  const tls = boundary(async () => Response.json({}), { process: { env: { FRONTEND_ORIGIN: 'https://hotel.example' } } });
  assert.equal((await tls.POST(request({ origin: 'https://hotel.example' }), context())).status, 200);
  assert.equal((await tls.POST(request({ origin: 'http://127.0.0.1:53100' }), context())).status, 403);
});

test('only core target and selected headers cross boundary; response cookies survive', async () => {
  let called = false;
  const route = boundary(async (url, options) => {
    called = true;
    assert.equal(url, 'http://private-core:3000/api/v1/core/pricing/quote');
    assert.equal(options.headers.get('cookie'), 'hotelai_session=synthetic');
    assert.equal(options.headers.get('idempotency-key'), 'same-request');
    assert.equal(options.headers.get('x-request-id'), 'trace-1');
    for (const name of ['origin', 'host', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto']) assert.equal(options.headers.get(name), null);
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'manual');
    assert.equal(Buffer.from(options.body).toString(), '{"guest_count":2}');
    const headers = new Headers({ 'x-request-id': 'trace-1', 'retry-after': '60' });
    headers.append('set-cookie', 'hotelai_session=synthetic; HttpOnly; SameSite=Lax; Path=/');
    headers.append('set-cookie', 'other=sample; Path=/');
    return Response.json({ status: 'success' }, { status: 201, headers });
  });
  const response = await route.POST(request({
    origin: 'http://127.0.0.1:53100', cookie: 'hotelai_session=synthetic',
    'idempotency-key': 'same-request', 'x-request-id': 'trace-1',
    'x-forwarded-for': '1.2.3.4', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https',
  }, '{"guest_count":2}'), context());
  assert.equal(called, true);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('retry-after'), '60');
  assert.equal(response.headers.getSetCookie().length, 2);
});

test('invalid paths and oversized declared or chunked bodies are rejected before core', async () => {
  let calls = 0;
  const route = boundary(async () => { calls++; return Response.json({}); });
  for (const parts of [[], ['..'], ['rooms/1'], ['%2fadmin'], ['https:']]) {
    assert.equal((await route.POST(request(), context(parts))).status, 400);
  }
  assert.equal((await route.POST(request({ 'content-length': String(1024 * 1024 + 1) }), context())).status, 413);
  const stream = new ReadableStream({ start(controller) {
    controller.enqueue(new Uint8Array(600000)); controller.enqueue(new Uint8Array(600000)); controller.close();
  } });
  const chunked = new Request('http://127.0.0.1:53100/api/v1/core/pricing/quote', {
    method: 'POST', body: stream, duplex: 'half', headers: { host: '127.0.0.1:53100' },
  });
  assert.equal((await route.POST(chunked, context())).status, 413);
  assert.equal(calls, 0);
});

test('stalled body times out and cancels its reader without reaching core', async () => {
  let canceled = false;
  const route = boundary(async () => { throw new Error('Must not call core'); }, {
    setTimeout: (fn) => setTimeout(fn, 1),
  });
  const stalled = new Request('http://127.0.0.1:53100/api/v1/core/pricing/quote', {
    method: 'POST', body: new ReadableStream({ cancel() { canceled = true; } }), duplex: 'half',
  });
  assert.equal((await route.POST(stalled, context())).status, 408);
  assert.equal(canceled, true);
});

test('upstream outage and redirects return safe errors; HEAD has no body', async () => {
  const failed = boundary(async () => { throw new Error('private hostname and connection detail'); });
  const error = await failed.GET(new Request('http://127.0.0.1:53100/api/v1/core/rooms'), context(['rooms']));
  assert.equal(error.status, 503);
  assert.doesNotMatch(await error.text(), /private hostname|connection detail/);
  const redirected = boundary(async () => new Response(null, { status: 302, headers: { location: 'https://untrusted.example' } }));
  assert.equal((await redirected.POST(request(), context())).status, 502);
  const head = boundary(async () => new Response(null, { status: 200 }));
  const response = await head.HEAD(new Request('http://127.0.0.1:53100/api/v1/core/rooms', { method: 'HEAD' }), context(['rooms']));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('private API configuration rejects credentials and non-HTTP protocols', () => {
  const configured = (value) => load('src/services/backend-url.ts', { 'server-only': {} }, {
    process: { env: { BACKEND_API_URL: value } },
  }).getBackendApiUrl();
  assert.equal(configured('https://core.example/api/v1/core/'), 'https://core.example/api/v1/core');
  for (const value of ['file:///private/data', 'http://user:password@core.example']) assert.throws(() => configured(value));
});

test('room service preserves actual IDs and rejects malformed catalog/detail payloads', async () => {
  const coreApi = load('src/services/core-api.ts', {});
  const room = { type_id: 41, type_name: 'Actual Room', base_price: 1250000, capacity: 3, total_rooms: 2, available_now: 1 };
  let payload = { status: 'success', data: [room] };
  let status = 200;
  const service = load('src/services/room.service.ts', {
    '@/services/backend-url': { getBackendApiUrl: () => 'http://private-core:3000/api/v1/core' },
    '@/services/core-api': coreApi,
  }, { fetch: async (_url, options) => {
    assert.equal(options.cache, 'no-store');
    return Response.json(payload, { status });
  } });
  assert.equal((await service.getRoomTypes())[0].type_id, 41);
  payload = { status: 'success', data: [] };
  assert.equal((await service.getRoomTypes()).length, 0);
  for (const invalid of [{ ...room, type_id: -1 }, { ...room, base_price: '1250000' },
    { ...room, available_now: 3 }, { ...room, capacity: 0 }, { ...room, type_name: '' }, null]) {
    payload = { status: 'success', data: [invalid] };
    await assert.rejects(() => service.getRoomTypes());
  }
  payload = { status: 'success', data: room };
  assert.equal((await service.getRoomType(41)).type_name, 'Actual Room');
  await assert.rejects(() => service.getRoomType(42));
  status = 404;
  payload = { status: 'error', message: 'Missing' };
  assert.equal(await service.getRoomType(42), null);
  status = 503;
  await assert.rejects(() => service.getRoomTypes(), (error) => error.status === 503);
});
