// Run against a migrated disposable validation database after building the backend.
// All fixtures are session-local copies of the real schema and are rolled back.
import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { UsersService } from '../dist/modules/users/users.service.js';

const databaseName = process.env.DB_NAME ?? process.env.POSTGRES_DB ?? '';
if (!/^hotel_validation_run_[a-f0-9]+$/.test(databaseName)) {
  throw new Error('Use an isolated hotel_validation_run_* database; this test never loads .env.');
}
const database = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 55442),
  username: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_validation',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: databaseName,
});
await database.initialize();
const runner = database.createQueryRunner();
await runner.connect();
await runner.startTransaction();
try {
  for (const table of ['customers', 'bookings', 'payment_transactions', 'customer_account_audits']) {
    await runner.query(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING ALL) ON COMMIT DROP`);
  }
  await runner.query('SET LOCAL search_path = pg_temp, public');
  const recordedEvents = [];
  const users = new UsersService(
    { query: runner.query.bind(runner), transaction: (callback) => callback(runner.manager) },
    { enqueue: async (_manager, event) => { recordedEvents.push(event); } },
  );
  const customerId = randomUUID();
  await runner.query(
    `INSERT INTO customers (customer_id, full_name, email)
     VALUES ($1, 'Profile Fixture', 'profile-fixture@example.invalid')`, [customerId],
  );
  const empty = await users.getProfile(customerId);
  assert.deepEqual([empty.total_stays, empty.total_spent, empty.loyalty_points, empty.loyalty_tier], [0, 0, 0, 'Bronze']);

  async function booking(status, owner = customerId) {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO bookings (booking_id, customer_id, check_in_date, check_out_date, status,
        checked_in_at, checked_in_by, checked_out_at, checked_out_by, policy_version,
        pending_expires_at, expired_at, no_show_at, no_show_by, no_show_reason)
       VALUES ($1, $2, DATE '2026-09-01', DATE '2026-09-03', $3::varchar,
         CASE WHEN $3 IN ('CheckedIn', 'Completed') THEN TIMESTAMPTZ '2026-09-01 07:00Z' END,
         CASE WHEN $3 IN ('CheckedIn', 'Completed') THEN $2::uuid END,
         CASE WHEN $3 = 'Completed' THEN TIMESTAMPTZ '2026-09-03 05:00Z' END,
         CASE WHEN $3 = 'Completed' THEN $2::uuid END, 1,
         CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, $2, 'Fixture no-show')`,
      [id, owner, status],
    );
    return id;
  }
  async function payment(bookingId, amount, parentId = null) {
    const id = randomUUID();
    await runner.query(
      `INSERT INTO payment_transactions (payment_id, booking_id, transaction_type, parent_payment_id,
        amount, method, idempotency_key, created_by)
       VALUES ($1::uuid, $2, $3, $4, $5, 'Cash', $1::uuid::text, $6)`,
      [id, bookingId, parentId ? 'Refund' : 'Payment', parentId, amount, customerId],
    );
    return id;
  }
  const completedId = await booking('Completed');
  const firstPayment = await payment(completedId, 12_000_000);
  await payment(completedId, 8_000_000);
  await payment(completedId, 3_000_000, firstPayment);
  await payment(await booking('CheckedIn'), 4_000_000);
  await booking('Completed'); // An unpaid stay still counts once.
  for (const status of ['Pending', 'Confirmed', 'Canceled', 'Expired', 'NoShow']) {
    await payment(await booking(status), 100_000_000);
  }
  await payment(await booking('Completed', randomUUID()), 100_000_000);
  const earned = await users.getProfile(customerId);
  assert.deepEqual([earned.total_stays, earned.total_spent, earned.loyalty_points, earned.loyalty_tier],
    [3, 21_000_000, 2100, 'Silver']);

  for (const [points, tier] of [[999, 'Bronze'], [1000, 'Silver'], [4999, 'Silver'], [5000, 'Gold'], [19999, 'Gold'], [20000, 'Platinum']]) {
    const id = randomUUID();
    await runner.query(`INSERT INTO customers (customer_id, full_name, email, loyalty_points)
      VALUES ($1::uuid, 'Tier Fixture', $1::uuid::text || '@example.invalid', $2)`, [id, points]);
    assert.equal((await users.getProfile(id)).loyalty_tier, tier);
  }
  await runner.query("UPDATE customers SET loyalty_tier = 'Platinum', loyalty_points = 2500 WHERE customer_id = $1", [customerId]);
  const preserved = await users.getProfile(customerId);
  assert.equal(preserved.loyalty_tier, 'Platinum');
  assert.equal(preserved.loyalty_points, 2500);
  const metrics = (profile) => [profile.total_stays, profile.total_spent, profile.loyalty_points, profile.loyalty_tier];
  const updated = await users.updateProfile(customerId, { full_name: 'Updated Fixture', expected_version: 1 });
  assert.deepEqual(metrics(updated), metrics(preserved));
  assert.equal(updated.version, 2);
  const unchanged = await users.updateProfile(customerId, { full_name: 'Updated Fixture', expected_version: 2 });
  assert.deepEqual(metrics(unchanged), metrics(preserved));
  assert.equal(unchanged.version, 2);
  assert.equal(recordedEvents.length, 1, 'No-op save must not emit another update event.');
  assert.equal(Number((await runner.query('SELECT COUNT(*) FROM customer_account_audits'))[0].count), 1);
  console.log(JSON.stringify({ status: 'ok', checks: ['empty-profile', 'net-spend', 'distinct-stays', 'stay-statuses', 'ownership', 'tier-boundaries', 'persisted-tier', 'profile-update', 'no-op-update'], fixtures: 'temporary-tables-rolled-back' }));
} finally {
  await runner.rollbackTransaction();
  await runner.release();
  await database.destroy();
}
