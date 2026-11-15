// Exercise the actual response parser and panel lifecycle without HTTP or a browser.
// Run: node scripts/pricing-intelligence-unit-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
  ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const textOf = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree)
  ? tree.map(textOf).join(' ') : typeof tree === 'object' ? textOf(tree.props?.children) : String(tree);
const named = (tree, name) => nodes(tree).find(node => node.props?.['aria-label'] === name);
const button = (tree, label) => nodes(tree).find(node => node.type === 'Button' && textOf(node).trim() === label);
const rows = tree => nodes(nodes(tree).find(node => node.type === 'TableBody')).filter(node => node.type === 'TableRow');
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function load(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : requireFrontend(id);
  loaded._compile(swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') }, target: 'es2022',
      transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  }).code, filename);
  return loaded.exports;
}
const core = load('src/services/core-api.ts');
class AdminApiError extends core.CoreApiError {}

function fixture(start = '2026-09-27', days = 14, version = 'benchmark-v2') {
  return {
    generated_at: '2026-09-27T01:02:03Z', timezone: 'Asia/Ho_Chi_Minh',
    period: { start_date: start, end_date: addDays(start, days), days },
    model: { status: 'ready', version, feature_contract_version: '2.0', training_run_id: 'test-run',
      scope: 'historical_adr_benchmark', vietnam_validated: false },
    daily_inventory: Array.from({ length: days }, (_, i) => [
      { stay_date: addDays(start, i), room_type_id: 1, room_type_name: 'Deluxe', sellable_rooms: 10,
        confirmed_rooms: 2, held_rooms: 1, operationally_blocked_rooms: 1, available_rooms: 6 },
      { stay_date: addDays(start, i), room_type_id: 2, room_type_name: 'Family', sellable_rooms: 4,
        confirmed_rooms: 1, held_rooms: 0, operationally_blocked_rooms: 0, available_rooms: 3 },
    ]).flat(),
    forecast: { status: 'not_available', reason: 'Chưa có mô hình nhu cầu được kiểm chứng.' }, notes: ['Nguồn: hệ thống đặt phòng.'],
  };
}

async function serviceContract() {
  let cleared = 0;
  const events = [], calls = [];
  const originals = { fetch: global.fetch, window: global.window };
  global.window = { dispatchEvent: event => events.push(event.type) };
  const service = load('src/services/pricing-intelligence.service.ts', {
    '@/services/axiosClient': { apiBaseUrl: '/api/v1/core' },
    '@/services/core-api': core,
    '@/services/admin.service': { AdminApiError, ADMIN_ACCESS_DENIED_EVENT: 'admin-denied' },
    '@/services/auth.service': { clearSession: () => { cleared++; } },
  });
  let response;
  global.fetch = async (url, init) => { calls.push({ url, init }); return response; };
  const serve = (data, status = 200) => { response = new Response(JSON.stringify(status === 200 ? { status: 'success', data } : data), { status }); };
  try {
    serve(fixture());
    const actual = await service.getPricingIntelligence('cookie-session');
    assert.equal(actual.daily_inventory.length, 28);
    assert.equal(calls[0].url, '/api/v1/core/admin/pricing/intelligence?days=14');
    assert.equal(calls[0].init.credentials, 'include');
    assert.equal(calls[0].init.cache, 'no-store');
    assert.equal(calls[0].init.headers, undefined, 'Do not leak the compatibility marker as a bearer token');
    for (const mutate of [
      data => { data.daily_inventory[0].available_rooms = 999; },
      data => { data.daily_inventory[0].confirmed_rooms = -1; },
      data => { data.daily_inventory.pop(); },
      data => { data.daily_inventory.push({ ...data.daily_inventory[0] }); },
      data => { data.daily_inventory[0].stay_date = data.period.end_date; },
      data => { data.period.end_date = addDays(data.period.end_date, 1); },
      data => { data.timezone = 'Not/A_Timezone'; },
      data => { data.model.vietnam_validated = true; },
      data => { data.forecast = { status: 'ready', occupancy: 0.85 }; },
    ]) {
      const data = fixture(); mutate(data); serve(data);
      await assert.rejects(service.getPricingIntelligence('cookie-session'), /chưa hợp lệ/);
    }
    serve(fixture('2026-10-01', 7));
    await service.getPricingIntelligence('cookie-session', { start_date: '2026-10-01', days: 7 });
    serve(fixture('2026-10-02', 7));
    await assert.rejects(service.getPricingIntelligence('cookie-session', { start_date: '2026-10-01', days: 7 }), /chưa hợp lệ/);
    const empty = fixture(); empty.daily_inventory = []; serve(empty);
    assert.deepEqual((await service.getPricingIntelligence('cookie-session')).daily_inventory, []);
    serve({ status: 'error', message: 'Expired session' }, 401);
    await assert.rejects(service.getPricingIntelligence('cookie-session'), error => error instanceof AdminApiError && error.status === 401);
    assert.equal(cleared, 1);
    serve({ status: 'error' }, 403);
    await assert.rejects(service.getPricingIntelligence('cookie-session'), error => error.status === 403);
    assert.deepEqual(events, ['admin-denied']);
    const controller = new AbortController(); controller.abort();
    serve({ status: 'error' }, 401);
    await assert.rejects(service.getPricingIntelligence('cookie-session', { signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(cleared, 1, 'A disposed request must not invalidate a newer session');
  } finally {
    global.fetch = originals.fetch;
    if (originals.window === undefined) delete global.window; else global.window = originals.window;
  }
}

function setup() {
  const slots = [], requests = [];
  let cursor = 0, dirty = false, effects = [], writes = 0;
  let session = { accessToken: 'cookie-session', user: { id: 'admin-a', role: 'admin' } };
  const equal = (a, b) => a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        writes++;
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useMemo(calculate, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, value: calculate() };
      return slots[index].value;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) effects.push({ index, effect, deps });
    },
  };
  const panel = load('src/components/features/admin/PricingIntelligencePanel.tsx', {
    react,
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/components/ui': new Proxy({}, { get: (_, name) => name }),
    '@/hooks/useAuth': { useAuth: () => ({ session }) },
    '@/services/admin.service': { AdminApiError },
    '@/services/pricing-intelligence.service': {
      getPricingIntelligence(token, params) { const request = { ...deferred(), token, params }; requests.push(request); return request.promise; },
    },
  });
  const env = {
    requests,
    render() {
      for (let attempt = 0; ; attempt++) {
        assert.ok(attempt < 20, 'Component effects converge');
        cursor = 0; dirty = false; effects = [];
        const tree = panel.PricingIntelligencePanel();
        for (const { index, effect, deps } of effects) {
          slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
        }
        if (!dirty) return tree;
      }
    },
    change(name, value) { named(env.render(), name).props.onChange({ target: { value } }); return env.render(); },
    identity(nextSession) { session = nextSession; return env.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get writes() { return writes; },
  };
  env.render();
  return env;
}

async function panelLifecycle() {
  const env = setup();
  assert.equal(env.requests[0].params.start_date, undefined, 'Business date must come from the API');
  env.requests[0].resolve(fixture()); await flush();
  let tree = env.render();
  assert.equal(rows(tree).length, 14);
  assert.match(textOf(rows(tree)[0]), /27\/09\/2026\s+14\s+3\s+1\s+1\s+9/);
  assert.match(textOf(tree), /Chưa có dự báo được kiểm chứng/);
  assert.match(textOf(tree), /Chưa kiểm chứng trên thị trường Việt Nam/);
  assert.equal(named(tree, 'Đêm bắt đầu theo dõi AI').props.min, '2026-09-27');
  tree = env.change('Hạng phòng theo dõi AI', '2');
  assert.match(textOf(rows(tree)[0]), /27\/09\/2026\s+4\s+1\s+0\s+0\s+3/);
  assert.equal(env.requests.length, 1, 'Room filtering stays local to a complete inventory response');
  button(tree, 'Cập nhật dữ liệu AI').props.onClick(); env.render();
  env.requests[1].reject(new TypeError('Failed to fetch')); await flush();
  tree = env.render();
  assert.equal(rows(tree).length, 14, 'Refresh errors retain explicitly marked cached data');
  assert.match(textOf(tree), /lần tải trước/);
  assert.doesNotMatch(textOf(tree), /Failed to fetch/);
  button(tree, 'Thử tải lại dữ liệu AI').props.onClick(); tree = env.render();
  assert.equal(button(tree, 'Thử tải lại dữ liệu AI').props.disabled, true);
  assert.match(textOf(tree), /lần tải trước/, 'Warning stays until a refresh succeeds');
  env.requests[2].resolve(fixture('2026-09-27', 14, 'refreshed-v2')); await flush();
  tree = env.render();
  assert.match(textOf(tree), /refreshed-v2/); assert.doesNotMatch(textOf(tree), /lần tải trước/);

  env.change('Đêm bắt đầu theo dõi AI', '2026-10-01');
  tree = env.change('Đêm bắt đầu theo dõi AI', '2026-11-01');
  assert.equal(env.requests[3].params.signal.aborted, true);
  assert.equal(rows(tree).length, 0, 'Previous dates must disappear while changing the requested window');
  env.requests[3].resolve(fixture('2026-10-01', 14, 'obsolete-v2')); await flush();
  assert.equal(rows(env.render()).length, 0);
  env.requests[4].resolve(fixture('2026-11-01', 14, 'newest-v2')); await flush();
  assert.match(textOf(env.render()), /newest-v2/);
  env.change('Số đêm theo dõi AI', '7');
  env.requests[5].resolve(fixture('2026-11-01', 7)); await flush();
  assert.equal(rows(env.render()).length, 7);

  button(env.render(), 'Cập nhật dữ liệu AI').props.onClick(); env.render();
  tree = env.identity({ accessToken: 'cookie-session', user: { id: 'admin-b', role: 'admin' } });
  assert.equal(rows(tree).length, 0, 'Identical cookie markers must not share another user snapshot');
  assert.equal(env.requests[6].params.signal.aborted, true);
  env.requests[6].reject(new AdminApiError('Obsolete denial', 403)); await flush();
  assert.doesNotMatch(textOf(env.render()), /Obsolete denial/);
  env.requests[7].resolve(fixture('2026-11-01', 7, 'admin-b-v2')); await flush();
  assert.match(textOf(env.render()), /admin-b-v2/);
  button(env.render(), 'Cập nhật dữ liệu AI').props.onClick(); env.render();
  env.requests[8].reject(new AdminApiError('Access denied', 403)); await flush();
  assert.equal(rows(env.render()).length, 0, 'Authorization denial clears protected cached inventory');
  assert.equal(env.identity(null), null, 'Logout hides the panel immediately');
  env.identity({ accessToken: 'cookie-session', user: { id: 'customer', role: 'customer' } });
  assert.equal(env.requests.length, 9, 'Customers cannot request the admin snapshot');
  env.identity({ accessToken: 'cookie-session', user: { id: 'admin-c', role: 'admin' } });
  const pending = env.requests.at(-1); env.unmount(); const writes = env.writes;
  pending.resolve(fixture('2026-11-01', 7)); await flush();
  assert.equal(env.writes, writes, 'Unmounted requests cannot update state');
  assert.equal(pending.params.signal.aborted, true);
}

(async () => {
  await serviceContract(); await panelLifecycle();
  console.log('PASS: inventory contract, cookie auth/authorization events, incomplete/duplicate nights, exclusive dates, source/forecast labels, local aggregation, retry recovery, stale requests, session isolation, and unmount.');
})().catch(error => { console.error(error); process.exitCode = 1; });
