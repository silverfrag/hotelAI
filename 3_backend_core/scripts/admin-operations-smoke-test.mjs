import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const { Client } = pg;
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';
await waitForApi(baseUrl);
const password = 'Password123!';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const email = `admin-ops-smoke-${runId}@example.com`;

const database = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

const state = {
  customerId: null,
  bookingIds: [],
};

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
  const body = await response.json().catch(() => null);
  return { response, body };
}

function addDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function businessDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.HOTEL_TIMEZONE ?? 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function insertBooking({ status, checkIn, checkOut, nightlyPrice, customerId, room }) {
  const bookingId = randomUUID();
  await database.query(
    `INSERT INTO bookings
       (booking_id, customer_id, check_in_date, check_out_date, status)
     VALUES ($1::uuid, $2::uuid, $3::date, $4::date, $5)`,
    [bookingId, customerId, checkIn, checkOut, status],
  );
  await database.query(
    `INSERT INTO booking_details
       (booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot)
     VALUES ($1::uuid, $2, $3, $4, $5)`,
    [bookingId, room.room_id, nightlyPrice, room.room_number, room.type_name],
  );
  state.bookingIds.push(bookingId);
  return bookingId;
}

async function cleanup() {
  try {
    await database.query('BEGIN');
    const aggregateIds = [state.customerId, ...state.bookingIds].filter(Boolean);
    if (aggregateIds.length > 0) {
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'customer_id' = ANY($1::text[])`,
        [aggregateIds],
      );
    }
    if (state.bookingIds.length > 0) {
      await database.query(
        'DELETE FROM booking_details WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
      await database.query(
        'DELETE FROM bookings WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
    }
    if (state.customerId) {
      await database.query('DELETE FROM customers WHERE customer_id = $1::uuid', [state.customerId]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }
}

await database.connect();

try {
  const registration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'Admin Operations Smoke', email, password },
  });
  ensure(registration.response.status === 201, `Registration returned ${registration.response.status}.`);
  state.customerId = registration.body?.user?.id;
  const customerToken = registration.body?.access_token;
  ensure(typeof state.customerId === 'string' && typeof customerToken === 'string', 'Registration session is incomplete.');

  const anonymous = await request('/admin/dashboard');
  ensure(anonymous.response.status === 401, `Anonymous dashboard returned ${anonymous.response.status}.`);
  const customer = await request('/admin/dashboard', { token: customerToken });
  ensure(customer.response.status === 403, `Customer dashboard returned ${customer.response.status}.`);

  const promotion = await database.query(
    `UPDATE customers SET role = 'admin' WHERE customer_id = $1::uuid`,
    [state.customerId],
  );
  ensure(promotion.rowCount === 1, 'Could not promote smoke-test account.');

  const login = await request('/auth/login', {
    method: 'POST',
    json: { email, password },
  });
  ensure(login.response.status === 201, `Admin login returned ${login.response.status}.`);
  const adminToken = login.body?.access_token;
  ensure(typeof adminToken === 'string', 'Admin login did not return a token.');

  for (const invalidQuery of ['months=2', 'months=25', 'months=3.5', 'months=text']) {
    const invalid = await request(`/admin/dashboard?${invalidQuery}`, { token: adminToken });
    ensure(invalid.response.status === 400, `Dashboard ${invalidQuery} returned ${invalid.response.status}.`);
  }
  for (const invalidQuery of ['limit=0', 'limit=101', 'limit=1.5', 'offset=-1', 'status=Unknown']) {
    const invalid = await request(`/admin/bookings?${invalidQuery}`, { token: adminToken });
    ensure(invalid.response.status === 400, `Bookings ${invalidQuery} returned ${invalid.response.status}.`);
  }

  const roomRows = await database.query(
    `SELECT room.room_id, room.room_number, room_type.name AS type_name
     FROM rooms room
     INNER JOIN room_types room_type ON room_type.type_id = room.type_id
     ORDER BY room.room_id
     LIMIT 1`,
  );
  ensure(roomRows.rowCount === 1, 'Smoke test needs one seeded room.');
  const room = roomRows.rows[0];
  const today = businessDate();
  const eligibleId = await insertBooking({
    status: 'Confirmed',
    checkIn: addDays(today, -2),
    checkOut: today,
    nightlyPrice: 321.25,
    customerId: state.customerId,
    room,
  });
  const futureId = await insertBooking({
    status: 'Confirmed',
    checkIn: addDays(today, 10),
    checkOut: addDays(today, 12),
    nightlyPrice: 100,
    customerId: state.customerId,
    room,
  });
  await insertBooking({
    status: 'Canceled',
    checkIn: addDays(today, 20),
    checkOut: addDays(today, 22),
    nightlyPrice: 999,
    customerId: state.customerId,
    room,
  });

  const filtered = await request(
    `/admin/bookings?limit=10&offset=0&status=Confirmed&search=${encodeURIComponent(`  ${email.toUpperCase()}  `)}`,
    { token: adminToken },
  );
  ensure(filtered.response.status === 200, `Filtered bookings returned ${filtered.response.status}.`);
  ensure(filtered.body?.total === 2 && filtered.body?.count === 2, 'Trimmed case-insensitive customer search is incorrect.');
  const eligible = filtered.body.data.find((booking) => booking.booking_id === eligibleId);
  const future = filtered.body.data.find((booking) => booking.booking_id === futureId);
  ensure(eligible?.can_complete === false && eligible?.can_mark_no_show === true && eligible?.can_cancel === false, 'Eligible booking action flags are incorrect.');
  ensure(future?.can_complete === false && future?.can_cancel === true, 'Future booking action flags are incorrect.');
  ensure(eligible?.room_number_snapshot === room.room_number, 'Room snapshot is missing.');
  ensure(eligible?.nightly_price === 321.25 && eligible?.nights === 2 && eligible?.total_price === 642.5, 'Price fields are inconsistent.');
  ensure(eligible?.pricing_source === null, 'Legacy/missing pricing audit fields must remain null.');

  const uuidSearch = await request(
    `/admin/bookings?search=${encodeURIComponent(eligibleId.slice(0, 12))}`,
    { token: adminToken },
  );
  ensure(uuidSearch.response.status === 200 && uuidSearch.body?.total === 1, 'Safe partial UUID search failed.');
  const roomSearch = await request(
    `/admin/bookings?limit=100&search=${encodeURIComponent(room.room_number)}`,
    { token: adminToken },
  );
  ensure(
    roomSearch.response.status === 200
      && roomSearch.body?.data?.some((booking) => booking.booking_id === eligibleId),
    'Room snapshot search failed.',
  );
  const wildcardSearch = await request('/admin/bookings?search=%25', { token: adminToken });
  ensure(wildcardSearch.response.status === 200 && wildcardSearch.body?.total === 0, 'LIKE wildcard was not treated literally.');

  const dashboard = await request('/admin/dashboard?months=6', { token: adminToken });
  ensure(dashboard.response.status === 200, `Dashboard returned ${dashboard.response.status}.`);
  const dashboardData = dashboard.body?.data;
  ensure(dashboardData?.business_date === today, 'Dashboard business date is incorrect.');
  ensure(dashboardData?.timezone === (process.env.HOTEL_TIMEZONE ?? 'Asia/Bangkok'), 'Dashboard timezone is incorrect.');
  ensure(dashboardData?.monthly_revenue?.length === 6, 'Dashboard did not zero-fill six months.');
  ensure(dashboardData?.room_status_breakdown?.length === 3, 'Dashboard room status breakdown is incomplete.');
  ensure(
    dashboardData.room_status_breakdown.reduce((sum, row) => sum + row.room_count, 0)
      === dashboardData.summary.room_count,
    'Dashboard room totals are inconsistent.',
  );
  const expectedValueRows = await database.query(
    `SELECT COALESCE(SUM(detail.applied_price * (booking.check_out_date - booking.check_in_date)), 0) AS value
     FROM bookings booking
     INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
     WHERE booking.status IN ('Confirmed', 'CheckedIn', 'Completed')`,
  );
  ensure(
    dashboardData.summary.booking_value === Number(expectedValueRows.rows[0].value),
    'Dashboard booking value does not match non-canceled applied-price value.',
  );
  const firstFive = await request('/admin/bookings?limit=5', { token: adminToken });
  ensure(firstFive.response.status === 200, 'Could not compare recent bookings.');
  ensure(
    JSON.stringify(dashboardData.recent_bookings.map((booking) => booking.booking_id))
      === JSON.stringify(firstFive.body.data.map((booking) => booking.booking_id)),
    'Dashboard recent bookings do not use the stable booking order.',
  );

  const retired = await request(`/admin/bookings/${eligibleId}/complete`, { method: 'PATCH', token: adminToken });
  ensure(retired.response.status === 410, 'Legacy completion must be retired.');
  const noShowInput = { expected_version: eligible.lifecycle_version, reason: 'Guest did not arrive for the scheduled stay.' };
  const futureNoShow = await request(`/admin/bookings/${futureId}/no-show`, {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': `future-no-show:${runId}` },
    json: { ...noShowInput, expected_version: future.lifecycle_version },
  });
  ensure(futureNoShow.response.status === 409, 'Future booking cannot be marked no-show.');
  const concurrent = await Promise.all([
    request(`/admin/bookings/${eligibleId}/no-show`, { method: 'POST', token: adminToken, headers: { 'Idempotency-Key': `no-show:${runId}` }, json: noShowInput }),
    request(`/admin/bookings/${eligibleId}/no-show`, { method: 'POST', token: adminToken, headers: { 'Idempotency-Key': `no-show:${runId}` }, json: noShowInput }),
  ]);
  const completionStatuses = concurrent.map(({ response }) => response.status).sort((a, b) => a - b);
  ensure(completionStatuses.join(',') === '200,200', `No-show replay statuses were ${completionStatuses}.`);
  ensure(concurrent.every(({ body }) => body?.data?.booking?.status === 'NoShow'), 'NoShow must not become a Completed stay.');
  ensure(concurrent.filter(({ body }) => body.data.replayed).length === 1, 'Exactly one no-show action must be replayed.');
  const repeated = await request(`/admin/bookings/${eligibleId}/no-show`, {
    method: 'POST', token: adminToken, headers: { 'Idempotency-Key': `no-show-other:${runId}` }, json: noShowInput,
  });
  ensure(repeated.response.status === 409, 'Stale no-show action must conflict.');
  const malformed = await request('/admin/bookings/not-a-uuid/complete', {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(malformed.response.status === 400, `Malformed UUID returned ${malformed.response.status}.`);

  console.log(JSON.stringify({
    status: 'ok',
    dashboard_months: dashboardData.monthly_revenue.length,
    filtered_total: filtered.body.total,
    concurrent_completion_statuses: completionStatuses,
  }));
} finally {
  await cleanup();
  await database.end();
}
