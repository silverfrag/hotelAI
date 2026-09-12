// DESTRUCTIVE TEST FIXTURES: disposable OPS validation database only.
// Booking-policy audit history and its actor are deliberately retained. Do not
// point this at development/production, export its rows for training, or run it
// concurrently with another policy-changing test. Restore the policy values,
// not history; dispose the isolated Compose project after inspecting evidence.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost:53002/api/v1/core').replace(/\/$/, '');
const databaseName = process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_validation';
const databasePort = Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 55442);
const apiUrl = new URL(baseUrl);
const explicitDisposableTarget = process.env.WORKFLOW_SMOKE_ALLOW_DISPOSABLE_TARGET === 'true';
assert(['hotel_validation', 'hotelai_validation', 'hotelai_ops_validation'].includes(databaseName)
  || /^hotel_validation_run_[a-f0-9]{12}$/.test(databaseName),
  'Workflow smoke only accepts an explicitly named disposable validation database.');
assert(explicitDisposableTarget || (databasePort === 55442 && apiUrl.port === '53002'
  && ['localhost', '127.0.0.1'].includes(apiUrl.hostname)), 'Refusing non-isolated workflow smoke target.');
const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost', port: databasePort,
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_validation',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? 'ops-validation-only-password',
  database: databaseName, connectionTimeoutMillis: 5000, statement_timeout: 10000,
});
const runId = randomUUID().replaceAll('-', '').slice(0, 8);
const password = 'WorkflowValidation123!';
let policyBefore, admin, guest, other, roomTypeId, roomId, sourceQuoteId;
const checks = [];
const key = label => `workflow:${runId}:${label}`;
const money = value => Math.round(Number(value) * 100) / 100;

async function request(path, { token, json, idempotencyKey, ...init } = {}, expected = 200) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (json !== undefined) headers.set('content-type', 'application/json');
  if (idempotencyKey) headers.set('idempotency-key', idempotencyKey);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init, headers, signal: AbortSignal.timeout(20000),
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const body = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${init.method ?? 'GET'} ${path}: ${JSON.stringify(body)}`);
  checks.push(`${init.method ?? 'GET'} ${path} => ${expected}`);
  return body;
}
async function register(label) {
  const result = await request('/auth/register', { method: 'POST', json: {
    full_name: `Workflow ${label}`, email: `workflow-${label}-${runId}@example.com`, password,
  } }, 201);
  return { id: result.user.id, token: result.access_token };
}
async function getPolicy() { return (await request('/admin/booking-policy', { token: admin.token })).data; }
async function setPolicy(fields) {
  const current = await getPolicy();
  return (await request('/admin/booking-policy', { method: 'PATCH', token: admin.token, json: {
    ...fields, expected_version: current.version, reason: `Disposable workflow validation ${runId}`,
  } })).data;
}
async function finances(id) {
  return (await request(`/admin/bookings/${id}/financial-status`, { token: admin.token })).data;
}
async function payment(id, amount, label, expected = 201) {
  return (await request(`/admin/bookings/${id}/payments`, { method: 'POST', token: admin.token,
    json: { amount, method: 'Cash', idempotency_key: key(label) } }, expected)).data;
}
async function refund(id, amount, label, expected = 201) {
  return (await request(`/admin/payments/${id}/refunds`, { method: 'POST', token: admin.token,
    json: { amount, idempotency_key: key(label), note: 'Disposable validation refund' } }, expected)).data;
}
async function deactivate(user, expected) {
  return request('/users/me/deactivate', { method: 'POST', token: user.token, json: { password } }, expected);
}
function addDays(date, amount) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + amount);
  return result.toISOString().slice(0, 10);
}
async function seedBooking({ customerId = guest.id, status = 'Confirmed', arrival, departure, expiry = false }) {
  const id = randomUUID();
  const policy = await getPolicy();
  await database.query(`INSERT INTO bookings (booking_id, customer_id, check_in_date, check_out_date,
      status, policy_version, deposit_required, checkout_payment_required, pending_expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $9,
      CASE WHEN $8 THEN clock_timestamp() + interval '2 seconds' ELSE NULL END)`,
  [id, customerId, arrival, departure, status, expiry ? policy.version : null, expiry ? 500 : 0, expiry,
    expiry ? policy.require_full_payment_at_checkout : false]);
  await database.query(`INSERT INTO booking_details
    (booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
    VALUES ($1, $2, 1000, $3, $4)`, [id, roomId, `W${runId}`, `Workflow ${runId}`]);
  // This is a synthetic historical fixture, not an observed training exposure.
  // Inserting a new quote preserves the source quote's immutability.
  const quoteId = randomUUID();
  await database.query(`INSERT INTO pricing_quotes
    SELECT (jsonb_populate_record(NULL::pricing_quotes, to_jsonb(source) || $2::jsonb)).*
    FROM pricing_quotes source WHERE quote_id = $1`, [sourceQuoteId, JSON.stringify({
    quote_id: quoteId, booking_id: id, customer_id: customerId,
    check_in_date: arrival, check_out_date: departure, accepted_at: new Date().toISOString(),
    base_price: 1000, ai_multiplier: 1, nightly_price: 1000,
    total_price: 1000 * ((Date.parse(departure) - Date.parse(arrival)) / 86400000),
    pricing_source: 'base', ai_model_version: null, ai_training_run_id: null, ai_feature_contract_version: null,
  })]);
  return { id, quoteId };
}
async function assertSqlRejected(sql, parameters, allowedCodes = ['55000', '23514']) {
  await assert.rejects(database.query(sql, parameters), error => allowedCodes.includes(error.code));
  checks.push('Immutable database invariant rejected');
}

await database.connect();
try {
  const identity = await database.query('SELECT current_database() AS name');
  assert.equal(identity.rows[0].name, databaseName);
  await waitForApi(baseUrl);
  admin = await register('admin'); guest = await register('guest'); other = await register('other');
  await database.query("UPDATE customers SET role = 'admin' WHERE customer_id = $1", [admin.id]);
  policyBefore = await getPolicy();
  await request('/admin/booking-policy', { token: guest.token }, 403);
  await request('/admin/booking-policy', { method: 'PATCH', token: admin.token,
    json: { expected_version: policyBefore.version, reason: 'Invalid null policy test', deposit_percent: null } }, 400);
  const policy = await setPolicy({ deposit_percent: 30, pending_ttl_minutes: 1, require_full_payment_at_checkout: true });
  assert.equal(policy.version, policyBefore.version + 1);
  await request('/admin/booking-policy', { method: 'PATCH', token: admin.token, json: {
    expected_version: policyBefore.version, reason: 'Stale policy version test', deposit_percent: 20,
  } }, 409);
  const type = await database.query(`INSERT INTO room_types (name, base_price, capacity)
    VALUES ($1, 1000, 2) RETURNING type_id`, [`Workflow ${runId}`]);
  roomTypeId = type.rows[0].type_id;
  const room = await database.query(`INSERT INTO rooms (type_id, room_number, current_status)
    VALUES ($1, $2, 'Available') RETURNING room_id`, [roomTypeId, `W${runId}`]);
  roomId = room.rows[0].room_id;
  const today = (await database.query("SELECT (clock_timestamp() AT TIME ZONE $1)::date::text AS today",
    [process.env.HOTEL_TIMEZONE ?? 'Asia/Bangkok'])).rows[0].today;
  const input = { room_type_id: roomTypeId, check_in_date: addDays(today, 5),
    check_out_date: addDays(today, 6), guest_count: 1, total_of_special_requests: 0 };
  const quote = (await request('/pricing/quote', { method: 'POST', json: input }, 201)).data;
  sourceQuoteId = quote.quote_id;
  assert.equal(quote.rooms_available, 1);
  await request(`/pricing/quotes/${sourceQuoteId}/events`, { method: 'POST', idempotencyKey: key('exposed'), json: { event_type: 'quote.exposed.v1' } }, 201);
  const createInput = { ...input, quote_id: sourceQuoteId };
  const created = (await request('/bookings', { method: 'POST', token: guest.token,
    idempotencyKey: key('create'), json: createInput }, 201)).data;
  const bookingId = created.booking.booking_id;
  assert.equal(created.booking.status, 'Pending');
  const total = money(created.total_price), deposit = money(total * 0.3);
  assert.equal(money(created.booking.deposit_required), deposit);
  const blocked = (await request('/pricing/quote', { method: 'POST', json: input }, 201)).data;
  assert.equal(blocked.rooms_available, 0, 'An unexpired Pending hold was offered twice.');
  await request('/bookings', { method: 'POST', token: other.token, json: input }, 404);
  await deactivate(guest, 409);
  await setPolicy({ deposit_percent: 50 });
  const terms = (await request(`/bookings/${bookingId}/payment`, { token: guest.token })).data;
  assert.equal(terms.policy_version, policy.version);
  assert.equal(terms.deposit_required, deposit, 'Policy change repriced existing deposit terms.');
  await request(`/admin/bookings/${bookingId}/confirm`, { method: 'POST', token: admin.token,
    idempotencyKey: key('unfunded-confirm'), json: { expected_version: 1, reason: 'Unfunded confirm must fail' } }, 409);
  const firstAmount = money(deposit / 2), secondAmount = money(deposit - firstAmount);
  const first = await payment(bookingId, firstAmount, 'first-deposit');
  assert.equal(first.summary.booking_status, 'Pending');
  const creationReplay = (await request('/bookings', { method: 'POST', token: guest.token,
    idempotencyKey: key('create'), json: createInput }, 201)).data;
  assert.equal(money(creationReplay.paid_amount), firstAmount, 'Booking replay lost the current paid ledger.');
  const secondPayments = await Promise.all([
    payment(bookingId, secondAmount, 'second-deposit'), payment(bookingId, secondAmount, 'second-deposit'),
  ]);
  assert.deepEqual(secondPayments.map(item => item.replayed).sort(), [false, true]);
  assert.equal(secondPayments[0].transaction.payment_id, secondPayments[1].transaction.payment_id);
  assert.equal(secondPayments[0].summary.booking_status, 'Confirmed');
  assert.equal(secondPayments[0].summary.lifecycle_version, 2);
  await payment(bookingId, total, 'overpay', 409);
  await refund(first.transaction.payment_id, firstAmount, 'refund-before-terminal', 409);
  await assertSqlRejected('UPDATE bookings SET deposit_required = deposit_required + 1 WHERE booking_id = $1', [bookingId]);
  await assertSqlRejected('UPDATE payment_transactions SET amount = amount + 1 WHERE payment_id = $1', [first.transaction.payment_id]);
  await request(`/bookings/${bookingId}/cancel`, { method: 'PATCH', token: guest.token });
  await deactivate(guest, 409);
  await Promise.all([refund(first.transaction.payment_id, firstAmount, 'refund-first'),
    refund(secondPayments[0].transaction.payment_id, secondAmount, 'refund-second')]);
  const refunded = (await request(`/bookings/${bookingId}/payment`, { token: guest.token })).data;
  assert.equal(refunded.payment_status, 'Refunded'); assert.equal(refunded.refund_due, 0);
  await refund(first.transaction.payment_id, 1, 'overrefund', 409);

  const expiring = await seedBooking({ status: 'Pending', arrival: addDays(today, 10), departure: addDays(today, 11), expiry: true });
  await new Promise(resolve => setTimeout(resolve, 2300));
  await payment(expiring.id, 100, 'expired-payment', 409);
  await request('/admin/workflow/expire', { method: 'POST', token: admin.token, json: { limit: 100 } });
  const expired = await finances(expiring.id);
  assert.equal(expired.status, 'Expired'); assert.equal(expired.balance_due, 0); assert(expired.expired_at);
  const released = (await request('/pricing/quote', { method: 'POST', json: {
    ...input, check_in_date: addDays(today, 10), check_out_date: addDays(today, 11),
  } }, 201)).data;
  assert.equal(released.rooms_available, 1);

  const noShow = await seedBooking({ arrival: addDays(today, -1), departure: today });
  const noShowPayment = await payment(noShow.id, 100, 'no-show-payment');
  const noShowInput = { expected_version: 1, reason: 'Guest did not arrive on the scheduled date' };
  const noShowPath = `/admin/bookings/${noShow.id}/no-show`;
  await request(noShowPath, { method: 'POST', token: guest.token, idempotencyKey: key('no-show'), json: noShowInput }, 403);
  await request(noShowPath, { method: 'POST', token: admin.token, json: noShowInput }, 400);
  const noShows = await Promise.all([0, 1].map(() => request(noShowPath, { method: 'POST', token: admin.token,
    idempotencyKey: key('no-show'), json: noShowInput })));
  assert.deepEqual(noShows.map(item => item.data.replayed).sort(), [false, true]);
  assert.equal(noShows[0].data.booking.status, 'NoShow');
  await request(noShowPath, { method: 'POST', token: admin.token, idempotencyKey: key('no-show'),
    json: { ...noShowInput, reason: 'Changed payload must not replay successfully' } }, 409);
  await payment(noShow.id, 1, 'no-show-charge', 409);
  assert.equal((await finances(noShow.id)).refund_due, 100);
  await refund(noShowPayment.transaction.payment_id, 100, 'no-show-refund');
  await request(`/admin/bookings/${noShow.id}/complete`, { method: 'PATCH', token: admin.token }, 410);
  const labels = await database.query(`SELECT booking_id, latest_outcome, completed_stay_label, stay_label_available_at
    FROM pricing_quote_training_dataset_v1 WHERE booking_id = ANY($1::uuid[])`, [[expiring.id, noShow.id]]);
  assert.equal(labels.rowCount, 2);
  for (const row of labels.rows) {
    assert.equal(row.completed_stay_label, false); assert(row.stay_label_available_at);
    assert.equal(row.latest_outcome, row.booking_id === noShow.id ? 'no_show' : 'booking_expired');
  }
  const falseStayEvents = await database.query(`SELECT COUNT(*)::int AS count FROM pricing_quote_events
    WHERE quote_id = ANY($1::uuid[]) AND event_type = 'stay.completed.v1'`, [[expiring.quoteId, noShow.quoteId]]);
  assert.equal(falseStayEvents.rows[0].count, 0, 'NoShow/Expired fabricated a completed-stay training event.');

  const notifications = await request('/users/me/notifications?limit=100', { token: guest.token });
  const notification = notifications.data.find(item => item.booking_id === bookingId);
  assert(notification); assert(notifications.unread > 0);
  assert(!('actor_id' in notification.payload) && !('reason' in notification.payload), 'Internal notification metadata leaked.');
  await request(`/users/me/notifications/${notification.notification_id}/read`, { method: 'PATCH', token: other.token }, 404);
  const read = (await request(`/users/me/notifications/${notification.notification_id}/read`, { method: 'PATCH', token: guest.token })).data;
  const readReplay = (await request(`/users/me/notifications/${notification.notification_id}/read`, { method: 'PATCH', token: guest.token })).data;
  assert.equal(read.read_at, readReplay.read_at);
  await assertSqlRejected('UPDATE booking_lifecycle_events SET reason = $2 WHERE booking_id = $1', [bookingId, 'tamper']);

  await setPolicy({ deposit_percent: 0, require_full_payment_at_checkout: true });
  const stay = (await request('/bookings', { method: 'POST', token: other.token, json: {
    ...input, check_in_date: today, check_out_date: addDays(today, 1),
  } }, 201)).data;
  const stayId = stay.booking.booking_id;
  assert.equal(stay.booking.status, 'Confirmed');
  await request(`/admin/bookings/${stayId}/check-in`, { method: 'PATCH', token: admin.token });
  await request(`/admin/bookings/${stayId}/check-out`, { method: 'PATCH', token: admin.token }, 409);
  const due = await finances(stayId);
  const creditInput = { authorized_amount: due.balance_due, expected_version: due.lifecycle_version,
    reason: 'Validated corporate credit for disposable workflow test' };
  await request(`/admin/bookings/${stayId}/credit-authorization`, { method: 'POST', token: admin.token,
    idempotencyKey: key('too-much-credit'), json: { ...creditInput, authorized_amount: creditInput.authorized_amount + 1 } }, 409);
  const creditRequests = await Promise.all([0, 1].map(() => request(`/admin/bookings/${stayId}/credit-authorization`, {
    method: 'POST', token: admin.token, idempotencyKey: key('credit'), json: creditInput,
  })));
  assert.deepEqual(creditRequests.map(item => item.data.replayed).sort(), [false, true]);
  assert.equal((await finances(stayId)).can_check_out, true);
  await request(`/admin/bookings/${stayId}/check-out`, { method: 'PATCH', token: admin.token });
  assert.equal((await finances(stayId)).status, 'Completed');
  await deactivate(other, 409);
  const settled = await payment(stayId, due.balance_due, 'completed-debt');
  assert.equal(settled.summary.payment_status, 'Paid');
  await deactivate(other, 200);
  await deactivate(guest, 200);
  const readiness = (await request('/admin/workflow/readiness', { token: admin.token })).data;
  assert.equal(readiness.expired_backlog, 0);
  assert.equal(readiness.notification_channel, 'in_app');
  console.log(JSON.stringify({ status: 'ok', run_id: runId, checks: checks.length,
    deposit_holds: true, automatic_confirmation: true, expiry_and_no_show_labels: true,
    idempotent_credit: true, completed_debt_collection: true, notifications_owner_scoped: true,
    disposable_fixtures_retained: true }));
} finally {
  if (policyBefore && admin) {
    try { await setPolicy({ deposit_percent: Number(policyBefore.deposit_percent),
      pending_ttl_minutes: Number(policyBefore.pending_ttl_minutes),
      require_full_payment_at_checkout: policyBefore.require_full_payment_at_checkout }); }
    catch (error) { console.error(`Policy restore failed: ${error.message}`); process.exitCode = 1; }
  }
  await database.end();
}
