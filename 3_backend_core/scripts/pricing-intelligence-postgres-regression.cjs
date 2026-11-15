// Explicit isolated PostgreSQL regression. All fixtures are rolled back, never committed.
// Does not read .env or accept connection overrides, to avoid touching the main DB.
require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID, randomInt } = require('node:crypto');
const { DataSource } = require('typeorm');
const { AdminPricingIntelligenceService } = require('../dist/modules/admin/admin-pricing-intelligence.service.js');

const EXPECTED_DATABASE = 'hotel_validation_run_b7fedc6bb134';
const options = {
  type: 'postgres', host: '127.0.0.1', port: 55442,
  database: EXPECTED_DATABASE, username: 'hotel_validation',
  password: 'ops-validation-only-password',
  applicationName: 'hotelai-pricing-intelligence-rollback-regression',
  extra: { connectionTimeoutMillis: 5_000, max: 1 },
};
assert.equal(options.host, '127.0.0.1');
assert.equal(options.port, 55442);
assert.match(options.database, /^hotel_validation_run_[a-f0-9]{12}$/);
assert.equal(options.database, EXPECTED_DATABASE);
assert.equal(options.username, 'hotel_validation');

const source = new DataSource(options);
const customerId = randomUUID();
const suffix = randomUUID().replaceAll('-', '').slice(0, 6);
// Explicit negative IDs avoid changes to serial sequences even when rolled back.
const firstId = -randomInt(100_000, 1_000_000_000);
const scenarios = new Map();
let runner;
let today;
let tomorrow;
let policyVersion;
let checked = 0;

function addDays(value, days) {
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function addRoom(label, status = 'Available', housekeeping = 'Ready') {
  const id = firstId - scenarios.size;
  const roomNumber = `${suffix}${String(scenarios.size).padStart(2, '0')}`;
  await runner.query('INSERT INTO room_types (type_id, name, base_price, capacity) VALUES ($1, $2, 1000000, 2)',
    [id, `PI ${suffix} ${label}`]);
  if (status !== null) {
    await runner.query(`INSERT INTO rooms (room_id, type_id, room_number, current_status, housekeeping_status)
      VALUES ($1, $1, $2, $3, $4)`, [id, roomNumber, status, housekeeping]);
  }
  const scenario = { id, roomNumber, label };
  scenarios.set(label, scenario);
  return scenario;
}

async function addBooking(scenario, status, start, end, expires = null) {
  const id = randomUUID();
  const pending = status === 'Pending';
  const checkedIn = status === 'CheckedIn';
  await runner.query(`INSERT INTO bookings (
      booking_id, customer_id, check_in_date, check_out_date, status,
      policy_version, deposit_required, checkout_payment_required, pending_expires_at,
      checked_in_at, checked_in_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, $10)`,
  [id, customerId, start, end, status, pending ? policyVersion : null,
    pending ? 100_000 : 0, expires,
    checkedIn ? new Date() : null, checkedIn ? customerId : null]);
  await runner.query(`INSERT INTO booking_details (
      detail_id, booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
    VALUES ($1, $2, $3, 1000000, $4, $5)`,
  [randomUUID(), id, scenario.id, scenario.roomNumber, `PI ${suffix} ${scenario.label}`]);
  return id;
}

function assertInventory(view, label, date, expected) {
  const scenario = scenarios.get(label);
  const matches = view.daily_inventory.filter(row => row.room_type_id === scenario.id && row.stay_date === date);
  assert.equal(matches.length, 1, `${label} ${date}: one row per room type/night`);
  const row = matches[0];
  const actual = [row.sellable_rooms, row.confirmed_rooms, row.held_rooms, row.operationally_blocked_rooms, row.available_rooms];
  assert.deepEqual(actual, expected, `${label} ${date}: sellable/confirmed/held/blocked/available`);
  assert.equal(actual[0], actual.slice(1).reduce((sum, value) => sum + value, 0));
  checked++;
}

(async () => {
  await source.initialize();
  runner = source.createQueryRunner();
  await runner.connect();
  const [identity] = await runner.query('SELECT current_database() AS database, current_user AS username');
  assert.equal(identity.database, EXPECTED_DATABASE, 'Refuse any database other than the named isolated fixture DB');
  assert.equal(identity.username, 'hotel_validation', 'Refuse a different database role');
  const [ledger] = await runner.query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  assert.ok(ledger.count >= 18, 'Requires the isolated migrated schema');
  await runner.startTransaction();
  await runner.query("SET LOCAL statement_timeout = '5s'");
  await runner.query("SET LOCAL lock_timeout = '2s'");
  await runner.query("SET LOCAL hotelai.timezone = 'Asia/Ho_Chi_Minh'");
  const [dates] = await runner.query("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date::text AS today");
  today = dates.today;
  tomorrow = addDays(today, 1);

  await runner.query('INSERT INTO customers (customer_id, full_name, email) VALUES ($1, $2, $3)',
    [customerId, 'Pricing intelligence rollback fixture', `pricing-intelligence-${suffix}@example.invalid`]);
  const [audit] = await runner.query('SELECT COALESCE(MAX(version), 0)::int AS version FROM booking_policy_audits');
  policyVersion = audit.version + randomInt(100_000, 1_000_000);
  await runner.query(`INSERT INTO booking_policy_audits
    (audit_id, policy_id, version, deposit_percent, pending_ttl_minutes,
     require_full_payment_at_checkout, updated_at, updated_by, reason)
    VALUES ($1, 1, $2, 10, 30, false, clock_timestamp(), $3, $4)`,
  [randomUUID(), policyVersion, customerId, 'Rollback-only pending inventory regression']);

  const checkout = await addRoom('checkout');
  await addBooking(checkout, 'Confirmed', addDays(today, -1), today);
  const futureArrival = await addRoom('future-arrival');
  await addBooking(futureArrival, 'Confirmed', tomorrow, addDays(today, 2));
  const checkedIn = await addRoom('checked-in');
  const stayId = await addBooking(checkedIn, 'CheckedIn', today, addDays(today, 2));
  await runner.query("UPDATE rooms SET current_status = 'Occupied', occupancy_booking_id = $1 WHERE room_id = $2", [stayId, checkedIn.id]);
  const activeHold = await addRoom('active-hold', 'Available', 'Dirty');
  await addBooking(activeHold, 'Pending', today, addDays(today, 2), new Date(Date.now() + 3_600_000));
  const expiredHold = await addRoom('expired-hold');
  await addBooking(expiredHold, 'Pending', today, addDays(today, 2), new Date(Date.now() - 3_600_000));
  await addRoom('maintenance', 'Maintenance');
  await addRoom('dirty', 'Available', 'Dirty');
  await addRoom('cleaning', 'Available', 'Cleaning');
  await addRoom('legacy-occupied', 'Occupied');
  await addRoom('zero-inventory', null);
  const overlaps = await addRoom('inactive-overlaps');
  await addBooking(overlaps, 'Canceled', today, addDays(today, 2));
  await addBooking(overlaps, 'Pending', today, addDays(today, 2), new Date(Date.now() - 3_600_000));
  await addBooking(overlaps, 'Confirmed', today, addDays(today, 2));
  const adjacent = await addRoom('adjacent-bookings');
  await addBooking(adjacent, 'Confirmed', addDays(today, -1), tomorrow);
  await addBooking(adjacent, 'Confirmed', tomorrow, addDays(today, 2));
  const confirmedDirty = await addRoom('confirmed-dirty', 'Available', 'Dirty');
  await addBooking(confirmedDirty, 'Confirmed', today, addDays(today, 2));

  // The real DB must prevent active overlap; no trigger disabling to fabricate it.
  await runner.query('SAVEPOINT overlap_guard');
  await assert.rejects(addBooking(overlaps, 'Confirmed', today, addDays(today, 2)),
    error => error.driverError?.code === '23514' && /already reserved/.test(error.message));
  await runner.query('ROLLBACK TO SAVEPOINT overlap_guard');
  checked++;

  const config = { get: (key, fallback) => key === 'HOTEL_TIMEZONE' ? 'Asia/Ho_Chi_Minh' : fallback };
  // The actual service executes its exact production SQL on this transaction's connection.
  // No AI URL is configured, so this check makes no network/model requests.
  const service = new AdminPricingIntelligenceService({ query: runner.query.bind(runner) }, config);
  const view = await service.getIntelligence({ start_date: today, days: 2 });
  assert.equal(view.model.status, 'unavailable');
  assert.equal(view.forecast.status, 'not_available');
  assertInventory(view, 'checkout', today, [1, 0, 0, 0, 1]);
  assertInventory(view, 'future-arrival', today, [1, 0, 0, 0, 1]);
  assertInventory(view, 'future-arrival', tomorrow, [1, 1, 0, 0, 0]);
  assertInventory(view, 'checked-in', today, [1, 1, 0, 0, 0]);
  assertInventory(view, 'checked-in', tomorrow, [1, 1, 0, 0, 0]);
  assertInventory(view, 'active-hold', today, [1, 0, 1, 0, 0]);
  assertInventory(view, 'active-hold', tomorrow, [1, 0, 1, 0, 0]);
  assertInventory(view, 'expired-hold', today, [1, 0, 0, 0, 1]);
  assertInventory(view, 'expired-hold', tomorrow, [1, 0, 0, 0, 1]);
  for (const date of [today, tomorrow]) {
    assertInventory(view, 'maintenance', date, [0, 0, 0, 0, 0]);
    assertInventory(view, 'zero-inventory', date, [0, 0, 0, 0, 0]);
    assertInventory(view, 'inactive-overlaps', date, [1, 1, 0, 0, 0]);
    assertInventory(view, 'adjacent-bookings', date, [1, 1, 0, 0, 0]);
    assertInventory(view, 'confirmed-dirty', date, [1, 1, 0, 0, 0]);
  }
  for (const label of ['dirty', 'cleaning', 'legacy-occupied']) {
    assertInventory(view, label, today, [1, 0, 0, 1, 0]);
    assertInventory(view, label, tomorrow, [1, 0, 0, 0, 1]);
  }
  const fixtureRows = view.daily_inventory.filter(row => scenarios.has(row.room_type_name.replace(`PI ${suffix} `, '')));
  assert.equal(fixtureRows.length, scenarios.size * 2, 'Full date/type grid including types with zero sellable rooms');
  await runner.rollbackTransaction();
  const [after] = await runner.query(`SELECT
    (SELECT COUNT(*)::int FROM customers WHERE customer_id = $1) AS customers,
    (SELECT COUNT(*)::int FROM room_types WHERE type_id = ANY($2::int[])) AS room_types,
    (SELECT COUNT(*)::int FROM bookings WHERE customer_id = $1) AS bookings,
    (SELECT COUNT(*)::int FROM booking_policy_audits WHERE version = $3) AS policy_audits`,
  [customerId, [...scenarios.values()].map(scenario => scenario.id), policyVersion]);
  assert.deepEqual(after, { customers: 0, room_types: 0, bookings: 0, policy_audits: 0 });
  checked++;
  console.log(`PASS: ${checked} PostgreSQL inventory checks; exact isolated database identity verified; all fixtures rolled back.`);
})().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (runner?.isTransactionActive) await runner.rollbackTransaction();
  if (runner && !runner.isReleased) await runner.release();
  if (source.isInitialized) await source.destroy();
});
