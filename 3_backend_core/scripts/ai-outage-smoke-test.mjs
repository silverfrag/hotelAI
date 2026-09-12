import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const { Client } = pg;
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';
await waitForApi(baseUrl);
const aiHealthUrl = process.env.AI_HEALTH_URL ?? 'http://localhost/api/v1/ai/health';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const password = 'Password123!';
const adminEmail = `outage-admin-${runId}@example.com`;
const customerEmail = `outage-customer-${runId}@example.com`;

const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

const state = {
  adminId: null,
  adminToken: null,
  customerId: null,
  customerToken: null,
  typeId: null,
  roomId: null,
  bookingId: null,
  initialAiEnabled: null,
};

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function assertCanonicalError(result, expectedStatus, expectedPath, label) {
  ensure(result.response.status === expectedStatus, `${label} returned ${result.response.status}, expected ${expectedStatus}.`);
  ensure(result.body?.status === 'error' && result.body?.statusCode === expectedStatus, `${label} has an inconsistent error envelope.`);
  ensure(typeof result.body?.error === 'string' && result.body.error.length > 0, `${label} lacks an error title.`);
  ensure(typeof result.body?.message === 'string' || Array.isArray(result.body?.message), `${label} has an invalid message.`);
  ensure(result.body?.path === expectedPath, `${label} path changed.`);
  ensure(!Number.isNaN(Date.parse(result.body?.timestamp)), `${label} timestamp is invalid.`);
  const requestId = result.response.headers.get('x-request-id');
  ensure(typeof requestId === 'string' && result.body?.request_id === requestId, `${label} request IDs differ.`);
  ensure(!Object.hasOwn(result.body, 'stack'), `${label} leaked a stack trace.`);
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

async function setRole(role) {
  const result = await database.query(
    'UPDATE customers SET role = $1 WHERE customer_id = $2::uuid RETURNING customer_id',
    [role, state.adminId],
  );
  ensure(result.rowCount === 1, `Could not set the outage test role to ${role}.`);
}

async function getSetting() {
  return request('/admin/pricing/settings', { token: state.adminToken });
}

async function updateSetting(aiEnabled, expectedVersion) {
  return request('/admin/pricing/settings', {
    method: 'PATCH',
    token: state.adminToken,
    json: { ai_enabled: aiEnabled, expected_version: expectedVersion },
  });
}

async function restoreSetting() {
  if (!state.adminId || !state.adminToken || state.initialAiEnabled === null) return;
  await setRole('admin');
  const current = await getSetting();
  if (!current.response.ok || current.body?.data?.ai_enabled === state.initialAiEnabled) return;
  const restored = await updateSetting(state.initialAiEnabled, current.body.data.version);
  ensure(restored.response.status === 200, 'Could not restore the initial AI setting.');
}

async function cleanup() {
  try {
    await restoreSetting();
  } catch (error) {
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }

  try {
    await database.query('BEGIN');
    const aggregateIds = [state.adminId, state.customerId, state.bookingId].filter(Boolean);
    if (aggregateIds.length) {
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'customer_id' = ANY($1::text[])`,
        [aggregateIds],
      );
    }
    if (state.bookingId) {
      await database.query('DELETE FROM daily_pricing_logs WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM booking_details WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM bookings WHERE booking_id = $1::uuid', [state.bookingId]);
    }
    if (state.roomId) await database.query('DELETE FROM rooms WHERE room_id = $1', [state.roomId]);
    if (state.typeId) await database.query('DELETE FROM room_types WHERE type_id = $1', [state.typeId]);
    if (state.customerId) {
      await database.query('DELETE FROM customers WHERE customer_id = $1::uuid', [state.customerId]);
    }
    if (state.adminId) {
      await database.query('UPDATE pricing_settings SET updated_by = NULL WHERE updated_by = $1::uuid', [state.adminId]);
      await database.query('UPDATE pricing_setting_audits SET changed_by = NULL WHERE changed_by = $1::uuid', [state.adminId]);
      await database.query('DELETE FROM customers WHERE customer_id = $1::uuid', [state.adminId]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }
}

const aiReachable = await fetch(aiHealthUrl, { signal: AbortSignal.timeout(2_000) })
  .then((response) => response.ok)
  .catch(() => false);
ensure(!aiReachable, `AI service is still reachable at ${aiHealthUrl}; stop it before running this test.`);

await database.connect();

try {
  const adminRegistration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'AI Outage Admin', email: adminEmail, password },
  });
  ensure(adminRegistration.response.status === 201, `Admin registration returned ${adminRegistration.response.status}.`);
  state.adminId = adminRegistration.body?.user?.id;
  ensure(typeof state.adminId === 'string', 'Admin registration did not return an ID.');
  await setRole('admin');

  const adminLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: adminEmail, password },
  });
  ensure(adminLogin.response.status === 201, `Admin login returned ${adminLogin.response.status}.`);
  state.adminToken = adminLogin.body?.access_token;
  ensure(typeof state.adminToken === 'string', 'Admin login did not return a token.');

  const customerRegistration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'AI Outage Customer', email: customerEmail, password },
  });
  ensure(customerRegistration.response.status === 201, `Customer registration returned ${customerRegistration.response.status}.`);
  state.customerId = customerRegistration.body?.user?.id;
  state.customerToken = customerRegistration.body?.access_token;
  ensure(typeof state.customerId === 'string' && typeof state.customerToken === 'string', 'Customer registration did not return a usable session.');

  let setting = await getSetting();
  ensure(setting.response.status === 200, `Pricing setting read returned ${setting.response.status}.`);
  state.initialAiEnabled = setting.body.data.ai_enabled;
  if (!setting.body.data.ai_enabled) {
    setting = await updateSetting(true, setting.body.data.version);
    ensure(setting.response.status === 200, `Enabling AI for the outage check returned ${setting.response.status}.`);
  }

  const roomType = await request('/admin/room-types', {
    method: 'POST',
    token: state.adminToken,
    json: { name: `Outage ${runId}`, base_price: 321.09, capacity: 2 },
  });
  ensure(roomType.response.status === 201, `Outage room-type create returned ${roomType.response.status}.`);
  state.typeId = roomType.body?.data?.type_id;

  const physicalRoom = await request('/admin/rooms', {
    method: 'POST',
    token: state.adminToken,
    json: { room_number: `O${runId.slice(0, 7)}`.toUpperCase(), type_id: state.typeId },
  });
  ensure(physicalRoom.response.status === 201, `Outage room create returned ${physicalRoom.response.status}.`);
  state.roomId = physicalRoom.body?.data?.room_id;

  const futureYear = new Date().getUTCFullYear() + 18;
  const bookingInput = {
    room_type_id: state.typeId,
    check_in_date: `${futureYear}-08-10`,
    check_out_date: `${futureYear}-08-12`,
    total_of_special_requests: 1,
  };
  const countBefore = await database.query(
    'SELECT COUNT(*)::int AS total FROM bookings WHERE customer_id = $1::uuid',
    [state.customerId],
  );
  const enabledAttempt = await request('/bookings', {
    method: 'POST',
    token: state.customerToken,
    json: bookingInput,
  });
  assertCanonicalError(
    enabledAttempt,
    503,
    '/api/v1/core/bookings',
    'AI-enabled booking during outage',
  );
  const countAfterFailure = await database.query(
    'SELECT COUNT(*)::int AS total FROM bookings WHERE customer_id = $1::uuid',
    [state.customerId],
  );
  ensure(
    Number(countBefore.rows[0].total) === Number(countAfterFailure.rows[0].total),
    'AI outage created a partial booking while pricing was enabled.',
  );

  const currentSetting = await getSetting();
  const disabled = await updateSetting(false, currentSetting.body.data.version);
  ensure(disabled.response.status === 200, `Disabling AI during outage returned ${disabled.response.status}.`);
  const baseBooking = await request('/bookings', {
    method: 'POST',
    token: state.customerToken,
    json: bookingInput,
  });
  ensure(baseBooking.response.status === 201, `AI-disabled booking during outage returned ${baseBooking.response.status}.`);
  state.bookingId = baseBooking.body?.data?.booking?.booking_id;
  ensure(typeof state.bookingId === 'string', 'AI-disabled outage booking did not return an ID.');
  ensure(
    baseBooking.body.data.pricing_source === 'base'
      && Number(baseBooking.body.data.ai_multiplier) === 1
      && Number(baseBooking.body.data.nightly_price) === 321.09,
    'AI-disabled outage booking did not use the complete base-price path.',
  );

  const logRows = await database.query(
    `SELECT pricing_source, ai_enabled, ai_multiplier, base_price, final_price, settings_version
     FROM daily_pricing_logs
     WHERE booking_id = $1::uuid`,
    [state.bookingId],
  );
  ensure(logRows.rowCount === 1, 'AI-disabled outage booking did not create exactly one pricing log.');
  const log = logRows.rows[0];
  ensure(
    log.pricing_source === 'base'
      && log.ai_enabled === false
      && Number(log.ai_multiplier) === 1
      && Number(log.base_price) === 321.09
      && Number(log.final_price) === 321.09,
    'AI-disabled outage pricing log is incomplete or inconsistent.',
  );

  console.log(JSON.stringify({
    status: 'ok',
    ai_enabled_outage_status: enabledAttempt.response.status,
    ai_outage_error_contract: true,
    partial_booking_created: false,
    ai_disabled_outage_status: baseBooking.response.status,
    pricing_source: baseBooking.body.data.pricing_source,
    multiplier: baseBooking.body.data.ai_multiplier,
    audit_complete: true,
  }));
} finally {
  await cleanup();
  await database.end();
}
