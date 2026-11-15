import assert from 'node:assert/strict';

const core = process.env.REVENUE_CORE_URL ?? 'http://127.0.0.1:53013/api/v1/core/revenue';

async function request(url, body) {
  const response = await fetch(
    url,
    body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {},
  );
  return { status: response.status, body: await response.json() };
}

console.log('Testing Revenue Simulator HTTP Integration...');

// 1. Scenarios endpoint
const scenarios = await request(`${core}/scenarios`);
assert.equal(scenarios.status, 200);
assert.ok(scenarios.body.data.scenarios.length >= 4);
assert.ok(scenarios.body.data.coupons.length >= 3);
console.log('  ✓ Scenarios and coupons retrieved successfully');

// 2. Decision endpoint (Standard scenario)
const standardQuote = await request(`${core}/decision`, {
  room_type_id: 1,
  room_type_name: 'Superior Room',
  base_price: 1200000,
  check_in_date: '2026-11-01',
  check_out_date: '2026-11-03',
  guest_count: 2,
  rooms_available: 6,
  rooms_total: 12,
  ml_multiplier: 1.15,
  scenario_id: 'standard',
});
assert.equal(standardQuote.status, 200);
assert.equal(standardQuote.body.data.total_nights, 2);
assert.ok(standardQuote.body.data.guest_payable_nightly_rate > 0);
assert.ok(standardQuote.body.data.estimated_contribution_margin > 0);
assert.ok(standardQuote.body.data.factors.length >= 3);
console.log('  ✓ Standard quote decision evaluated with 4-source factors');

// 3. Decision with coupon & contribution margin floor
const couponQuote = await request(`${core}/decision`, {
  room_type_id: 1,
  room_type_name: 'Superior Room',
  base_price: 1200000,
  check_in_date: '2026-11-01',
  check_out_date: '2026-11-02',
  guest_count: 2,
  rooms_available: 4,
  rooms_total: 12,
  scenario_id: 'holiday_surge',
  coupon_code: 'WHITESAND10',
});
assert.equal(couponQuote.status, 200);
assert.equal(couponQuote.body.data.coupon_applied, 'WHITESAND10');
assert.ok(couponQuote.body.data.coupon_discount_vnd > 0);
console.log('  ✓ Valid coupon applied successfully');

// 4. Constraint-based room allocation via Google OR-Tools (stateless & live PostgreSQL)
const allocation = await request(`${core}/optimize-allocation`, {
  requests: [
    {
      request_id: 'REQ-A',
      room_type_id: 1,
      check_in_date: '2026-11-01',
      check_out_date: '2026-11-03',
      guest_count: 2,
      revenue_value: 2400000,
      vip_priority: 1,
    },
    {
      request_id: 'REQ-B',
      room_type_id: 1,
      check_in_date: '2026-11-02',
      check_out_date: '2026-11-04',
      guest_count: 2,
      revenue_value: 3600000,
      vip_priority: 2,
    },
  ],
  available_rooms: [
    {
      room_id: 101,
      room_number: '301',
      type_id: 1,
      capacity: 2,
      current_status: 'Available',
      housekeeping_status: 'Ready',
    },
  ],
  allow_upgrades: false,
});
assert.equal(allocation.status, 200);
assert.ok(['OPTIMAL', 'FEASIBLE'].includes(allocation.body.data.status));
const assigned = allocation.body.data.assignments.filter((a) => a.status === 'ASSIGNED');
const rejected = allocation.body.data.assignments.filter((a) => a.status === 'REJECTED_NO_CAPACITY');
assert.equal(assigned.length, 1);
assert.equal(rejected.length, 1);
assert.equal(assigned[0].request_id, 'REQ-B');
console.log('  ✓ Constraint room allocation via OR-Tools CP-SAT confirmed zero oversell');

const liveAllocation = await request(`${core}/optimize-allocation-live`, {
  requests: [
    {
      request_id: 'LIVE-REQ-1',
      room_type_id: 1,
      check_in_date: '2026-12-10',
      check_out_date: '2026-12-12',
      guest_count: 2,
      revenue_value: 2400000,
      vip_priority: 2,
    },
  ],
  allow_upgrades: true,
});
assert.equal(liveAllocation.status, 200);
assert.ok(liveAllocation.body.data.live_snapshot.total_rooms > 0);
console.log('  ✓ Live PostgreSQL OR-Tools CP-SAT allocation verified');

// 5. Scenario Sandbox Studio endpoints
const sandboxList = await request(`${core}/sandbox/scenarios`);
assert.equal(sandboxList.status, 200);
assert.ok(sandboxList.body.data.scenarios.length >= 4);
console.log('  ✓ Sandbox scenarios list retrieved');

const sandboxRun = await request(`${core}/sandbox/run`, {
  scenario_id: 'vip_clash',
});
assert.equal(sandboxRun.status, 200);
assert.equal(sandboxRun.body.data.scorecard.zero_oversell_guarantee, true);
console.log('  ✓ Sandbox simulation executed with OR-Tools CP-SAT audit scorecard');

console.log('PASS ALL: Revenue Simulator & Live Allocation HTTP integration test.');
