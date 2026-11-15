// Read-only advisory flow; no PMS DB, quote writes, payments or bookings.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const core = process.env.MARKET_TEST_CORE_URL || 'http://127.0.0.1:53123/api/v1/core';
const frontend = process.env.MARKET_TEST_FRONTEND_URL;
const target = new Date(Date.now() + 86400000 + 7 * 3600000).toISOString().slice(0, 10);
const input = { check_in_date: target, tax_pct: .1, commission_pct: .1 };

async function post(base, body) {
  const response = await fetch(`${base}/revenue/market-decision`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(55000),
  });
  return { status: response.status, body: await response.json() };
}

const response = await post(core, input);
assert.equal(response.status, 200);
const decision = response.body.data;
assert.equal(decision.region, 'VN-DN');
assert.equal(decision.advisory_only, true);
assert.equal(decision.policy.tax_pct, .1);
assert.equal(decision.inventory_provenance, 'user_input');
assert.match(decision.decision_id, /^[a-f0-9]{64}$/);
assert.ok(decision.evidence.sources.some(s => s.source_id === 'open-meteo-danang'));
for (const source of decision.evidence.sources) {
  if (['fetched', 'cached'].includes(source.status)) {
    assert.ok(source.fetched_at);
    assert.match(source.sha256, /^[a-f0-9]{64}$/);
  }
}
if (!decision.model.ready) {
  assert.equal(decision.selected, null);
  assert.deepEqual(decision.curve, []);
  assert.ok(decision.blockers.length > 0);
}
if (decision.selected) {
  assert.ok(decision.selected.price_vnd >= decision.policy.floor_vnd);
  assert.ok(decision.selected.price_vnd <= decision.policy.ceiling_vnd);
}
for (const extra of [{ check_in_date: '2026-02-31' }, { rooms_available: 30, rooms_total: 24 }, { tax_pct: 1 }, { source_url: 'http://localhost' }]) {
  assert.equal((await post(core, { ...input, ...extra })).status, 400);
}
if (frontend) {
  const page = await fetch(`${frontend}/admin/revenue-simulator`);
  assert.equal(page.status, 200);
  const viaProxy = await post(`${frontend}/api/v1/core`, input);
  assert.equal(viaProxy.status, 200);
  assert.equal(viaProxy.body.data.region, 'VN-DN');
}
await mkdir('.tmp', { recursive: true });
await writeFile('.tmp/market-pricing-http-result.json', JSON.stringify(response.body, null, 2));
console.log(JSON.stringify({ status: 'passed', decision_status: decision.status,
  sources: decision.evidence.sources.map(s => ({ id: s.source_id, status: s.status })),
  model_ready: decision.model.ready, frontend_proxy_checked: Boolean(frontend) }, null, 2));
