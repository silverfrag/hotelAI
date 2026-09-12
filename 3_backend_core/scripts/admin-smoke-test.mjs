import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const { Client } = pg;
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';
await waitForApi(baseUrl);
const password = 'Password123!';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const adminEmail = `admin-smoke-${runId}@example.com`;
const customerEmail = `customer-smoke-${runId}@example.com`;
const injectedEmail = `injected-admin-${runId}@example.com`;

const database = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

const state = {
  adminId: null,
  customerId: null,
  adminToken: null,
  customerToken: null,
  bookingId: null,
  roomIds: [],
  typeIds: [],
  initialAiEnabled: null,
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

function statuses(results) {
  return results.map(({ response }) => response.status).sort((left, right) => left - right);
}

async function setRole(customerId, role) {
  const result = await database.query(
    'UPDATE customers SET role = $1 WHERE customer_id = $2::uuid RETURNING customer_id',
    [role, customerId],
  );
  ensure(result.rowCount === 1, `Could not set role ${role} for the smoke-test account.`);
}

async function restorePricingSetting() {
  if (!state.adminToken || state.initialAiEnabled === null || !state.adminId) return;
  await setRole(state.adminId, 'admin');
  const current = await request('/admin/pricing/settings', { token: state.adminToken });
  if (!current.response.ok || current.body?.data?.ai_enabled === state.initialAiEnabled) return;
  const restored = await request('/admin/pricing/settings', {
    method: 'PATCH',
    token: state.adminToken,
    json: {
      ai_enabled: state.initialAiEnabled,
      expected_version: current.body.data.version,
    },
  });
  ensure(restored.response.status === 200, 'Could not restore the original AI pricing setting.');
}

async function cleanup() {
  try {
    await restorePricingSetting();
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
    if (state.roomIds.length) {
      await database.query('DELETE FROM rooms WHERE room_id = ANY($1::int[])', [state.roomIds]);
    }
    if (state.typeIds.length) {
      await database.query('DELETE FROM room_types WHERE type_id = ANY($1::int[])', [state.typeIds]);
    }
    if (state.customerId) {
      await database.query('DELETE FROM customers WHERE customer_id = $1::uuid', [state.customerId]);
    }
    await database.query('DELETE FROM customers WHERE email = $1', [injectedEmail]);
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

await database.connect();

try {
  const roleInjection = await request('/auth/register', {
    method: 'POST',
    json: {
      full_name: 'Injected Admin Smoke',
      email: injectedEmail,
      password,
      role: 'admin',
    },
  });
  ensure(roleInjection.response.status === 400, `Registration role injection returned ${roleInjection.response.status}, expected 400.`);
  const injectedRows = await database.query('SELECT customer_id FROM customers WHERE email = $1', [injectedEmail]);
  ensure(injectedRows.rowCount === 0, 'Registration role injection created an account.');

  const adminRegistration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'Admin Smoke Test', email: adminEmail, password },
  });
  ensure(adminRegistration.response.status === 201, `Admin-candidate registration returned ${adminRegistration.response.status}.`);
  state.adminId = adminRegistration.body?.user?.id;
  ensure(typeof state.adminId === 'string', 'Admin-candidate registration did not return an ID.');

  const customerRegistration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'Customer Smoke Test', email: customerEmail, password },
  });
  ensure(customerRegistration.response.status === 201, `Customer registration returned ${customerRegistration.response.status}.`);
  state.customerId = customerRegistration.body?.user?.id;
  state.customerToken = customerRegistration.body?.access_token;
  ensure(typeof state.customerId === 'string' && typeof state.customerToken === 'string', 'Customer registration did not return a usable session.');

  const anonymousAdmin = await request('/admin/rooms');
  ensure(anonymousAdmin.response.status === 401, `Anonymous admin request returned ${anonymousAdmin.response.status}, expected 401.`);
  const customerAdmin = await request('/admin/rooms', { token: state.customerToken });
  ensure(customerAdmin.response.status === 403, `Customer admin request returned ${customerAdmin.response.status}, expected 403.`);

  await setRole(state.adminId, 'admin');
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: adminEmail, password },
  });
  ensure(adminLogin.response.status === 201, `Admin login returned ${adminLogin.response.status}.`);
  state.adminToken = adminLogin.body?.access_token;
  ensure(typeof state.adminToken === 'string', 'Admin login did not return a token.');

  const authorizedAdmin = await request('/admin/rooms', { token: state.adminToken });
  ensure(authorizedAdmin.response.status === 200, `Authorized admin request returned ${authorizedAdmin.response.status}.`);
  const overflowingId = await request('/admin/rooms/2147483648', {
    method: 'PATCH',
    token: state.adminToken,
    json: { room_number: 'X1' },
  });
  ensure(overflowingId.response.status === 400, `Out-of-range admin ID returned ${overflowingId.response.status}.`);

  const typeName = `Smoke ${runId}`;
  const duplicateTypes = await Promise.all(
    Array.from({ length: 3 }, () => request('/admin/room-types', {
      method: 'POST',
      token: state.adminToken,
      json: { name: typeName, base_price: 123.45, capacity: 2 },
    })),
  );
  ensure(statuses(duplicateTypes).join(',') === '201,409,409', `Concurrent room-type statuses were ${statuses(duplicateTypes).join(',')}.`);
  const createdType = duplicateTypes.find(({ response }) => response.status === 201)?.body?.data;
  ensure(Number.isInteger(createdType?.type_id), 'Concurrent room-type create did not return the created row.');
  state.typeIds.push(createdType.type_id);

  const caseDuplicateType = await request('/admin/room-types', {
    method: 'POST',
    token: state.adminToken,
    json: { name: typeName.toUpperCase(), base_price: 123.45, capacity: 2 },
  });
  ensure(caseDuplicateType.response.status === 409, `Case-insensitive room-type duplicate returned ${caseDuplicateType.response.status}.`);

  const emptyTypePatch = await request(`/admin/room-types/${createdType.type_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: {},
  });
  ensure(emptyTypePatch.response.status === 400, `Empty room-type PATCH returned ${emptyTypePatch.response.status}.`);
  const nullTypePatch = await request(`/admin/room-types/${createdType.type_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: { name: null },
  });
  ensure(nullTypePatch.response.status === 400, `Null room-type PATCH returned ${nullTypePatch.response.status}.`);

  const roomNumber = `S${runId.slice(0, 7)}`.toUpperCase();
  const duplicateRooms = await Promise.all(
    Array.from({ length: 3 }, () => request('/admin/rooms', {
      method: 'POST',
      token: state.adminToken,
      json: { room_number: roomNumber, type_id: createdType.type_id },
    })),
  );
  ensure(statuses(duplicateRooms).join(',') === '201,409,409', `Concurrent room statuses were ${statuses(duplicateRooms).join(',')}.`);
  const createdRoom = duplicateRooms.find(({ response }) => response.status === 201)?.body?.data;
  ensure(Number.isInteger(createdRoom?.room_id), 'Concurrent physical-room create did not return the created row.');
  state.roomIds.push(createdRoom.room_id);

  const caseDuplicateRoom = await request('/admin/rooms', {
    method: 'POST',
    token: state.adminToken,
    json: { room_number: roomNumber.toLowerCase(), type_id: createdType.type_id },
  });
  ensure(caseDuplicateRoom.response.status === 409, `Case-insensitive room-number duplicate returned ${caseDuplicateRoom.response.status}.`);
  const emptyRoomPatch = await request(`/admin/rooms/${createdRoom.room_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: {},
  });
  ensure(emptyRoomPatch.response.status === 400, `Empty room PATCH returned ${emptyRoomPatch.response.status}.`);
  const nullRoomPatch = await request(`/admin/rooms/${createdRoom.room_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: { room_number: null },
  });
  ensure(nullRoomPatch.response.status === 400, `Null room PATCH returned ${nullRoomPatch.response.status}.`);

  const spareType = await request('/admin/room-types', {
    method: 'POST',
    token: state.adminToken,
    json: { name: `Spare ${runId}`, base_price: 80, capacity: 1 },
  });
  ensure(spareType.response.status === 201, `Spare room-type create returned ${spareType.response.status}.`);
  state.typeIds.push(spareType.body.data.type_id);
  const spareRoom = await request('/admin/rooms', {
    method: 'POST',
    token: state.adminToken,
    json: { room_number: `U${runId.slice(0, 7)}`.toUpperCase(), type_id: spareType.body.data.type_id },
  });
  ensure(spareRoom.response.status === 201, `Spare room create returned ${spareRoom.response.status}.`);
  state.roomIds.push(spareRoom.body.data.room_id);
  const spareRoomDelete = await request(`/admin/rooms/${spareRoom.body.data.room_id}`, { method: 'DELETE', token: state.adminToken });
  ensure(spareRoomDelete.response.status === 200, `Unreferenced room delete returned ${spareRoomDelete.response.status}.`);
  state.roomIds = state.roomIds.filter((id) => id !== spareRoom.body.data.room_id);
  const spareTypeDelete = await request(`/admin/room-types/${spareType.body.data.type_id}`, { method: 'DELETE', token: state.adminToken });
  ensure(spareTypeDelete.response.status === 200, `Unreferenced room-type delete returned ${spareTypeDelete.response.status}.`);
  state.typeIds = state.typeIds.filter((id) => id !== spareType.body.data.type_id);

  const settingBefore = await request('/admin/pricing/settings', { token: state.adminToken });
  ensure(settingBefore.response.status === 200, `Pricing settings read returned ${settingBefore.response.status}.`);
  state.initialAiEnabled = settingBefore.body.data.ai_enabled;
  const desiredState = !state.initialAiEnabled;
  const settingUpdates = await Promise.all(
    Array.from({ length: 2 }, () => request('/admin/pricing/settings', {
      method: 'PATCH',
      token: state.adminToken,
      json: { ai_enabled: desiredState, expected_version: settingBefore.body.data.version },
    })),
  );
  ensure(statuses(settingUpdates).join(',') === '200,409', `Concurrent pricing-setting statuses were ${statuses(settingUpdates).join(',')}.`);

  let currentSetting = await request('/admin/pricing/settings', { token: state.adminToken });
  ensure(currentSetting.response.status === 200, 'Could not reload pricing settings after the concurrency check.');
  if (currentSetting.body.data.ai_enabled) {
    const disable = await request('/admin/pricing/settings', {
      method: 'PATCH',
      token: state.adminToken,
      json: { ai_enabled: false, expected_version: currentSetting.body.data.version },
    });
    ensure(disable.response.status === 200, `Disabling AI pricing returned ${disable.response.status}.`);
    currentSetting = disable;
  }

  const futureYear = new Date().getUTCFullYear() + 15;
  const bookingInput = {
    room_type_id: createdType.type_id,
    check_in_date: `${futureYear}-06-10`,
    check_out_date: `${futureYear}-06-12`,
    total_of_special_requests: 2,
  };
  const booking = await request('/bookings', {
    method: 'POST',
    token: state.customerToken,
    json: bookingInput,
  });
  ensure(booking.response.status === 201, `Base-price booking returned ${booking.response.status}.`);
  state.bookingId = booking.body?.data?.booking?.booking_id;
  ensure(typeof state.bookingId === 'string', 'Base-price booking did not return an ID.');
  ensure(booking.body.data.pricing_source === 'base', 'Disabled AI did not produce a base-source booking.');
  ensure(Number(booking.body.data.ai_multiplier) === 1, 'Disabled AI did not use multiplier 1.');
  ensure(Number(booking.body.data.nightly_price) === 123.45, 'Disabled AI did not use the room type base price.');
  ensure(booking.body.data.settings_version === currentSetting.body.data.version, 'Booking did not snapshot the active setting version.');

  const historyBefore = await request('/bookings', { token: state.customerToken });
  const beforeItem = historyBefore.body?.data?.find((item) => item.booking_id === state.bookingId);
  ensure(historyBefore.response.status === 200 && beforeItem, 'Customer history did not contain the admin-slice booking.');
  const immutableHistory = JSON.stringify({
    room_number: beforeItem.room_number,
    room_type: beforeItem.room_type,
    nightly_price: beforeItem.nightly_price,
    total_price: beforeItem.total_price,
  });

  const renamedRoomNumber = `R${runId.slice(0, 7)}`.toUpperCase();
  const renamedTypeName = `Renamed ${runId}`;
  const renameRoom = await request(`/admin/rooms/${createdRoom.room_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: { room_number: renamedRoomNumber },
  });
  ensure(renameRoom.response.status === 200, `Referenced room rename returned ${renameRoom.response.status}.`);
  const renameType = await request(`/admin/room-types/${createdType.type_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: { name: renamedTypeName, base_price: 222.22, capacity: 3 },
  });
  ensure(renameType.response.status === 200, `Referenced room-type update returned ${renameType.response.status}.`);

  const historyAfter = await request('/bookings', { token: state.customerToken });
  const afterItem = historyAfter.body?.data?.find((item) => item.booking_id === state.bookingId);
  const historySnapshotAfter = JSON.stringify({
    room_number: afterItem?.room_number,
    room_type: afterItem?.room_type,
    nightly_price: afterItem?.nightly_price,
    total_price: afterItem?.total_price,
  });
  ensure(historySnapshotAfter === immutableHistory, 'Room/type edits changed historical booking values.');

  const maintenance = await request(`/admin/rooms/${createdRoom.room_id}`, {
    method: 'PATCH',
    token: state.adminToken,
    json: { current_status: 'Maintenance' },
  });
  ensure(maintenance.response.status === 409, `Maintenance with a future booking returned ${maintenance.response.status}, expected 409.`);

  const logs = await request('/admin/pricing/logs?limit=100&offset=0', { token: state.adminToken });
  ensure(logs.response.status === 200 && logs.body.limit === 100 && logs.body.offset === 0, 'Pricing-log pagination envelope is invalid.');
  const bookingLog = logs.body.data?.find((item) => item.booking_id === state.bookingId);
  ensure(bookingLog, 'Pricing log did not contain the base-source booking.');
  ensure(
    bookingLog.pricing_source === 'base'
      && bookingLog.ai_enabled === false
      && Number(bookingLog.ai_multiplier) === 1
      && Number(bookingLog.base_price) === 123.45
      && bookingLog.type_name === typeName,
    'Pricing log did not preserve a complete pricing snapshot.',
  );
  const repeatLogs = await request('/admin/pricing/logs?limit=100&offset=0', { token: state.adminToken });
  ensure(
    JSON.stringify(logs.body.data.map((item) => item.log_id)) === JSON.stringify(repeatLogs.body.data.map((item) => item.log_id)),
    'Pricing-log order is unstable in a static dataset.',
  );
  const invalidLimit = await request('/admin/pricing/logs?limit=101&offset=0', { token: state.adminToken });
  ensure(invalidLimit.response.status === 400, `Oversized pricing-log limit returned ${invalidLimit.response.status}.`);
  const invalidOffset = await request('/admin/pricing/logs?limit=20&offset=-1', { token: state.adminToken });
  ensure(invalidOffset.response.status === 400, `Negative pricing-log offset returned ${invalidOffset.response.status}.`);

  const countsBeforeDelete = await database.query(
    `SELECT
       (SELECT COUNT(*)::int FROM rooms WHERE room_id = $1) AS rooms,
       (SELECT COUNT(*)::int FROM booking_details WHERE booking_id = $2::uuid) AS details,
       (SELECT COUNT(*)::int FROM daily_pricing_logs WHERE booking_id = $2::uuid) AS logs`,
    [createdRoom.room_id, state.bookingId],
  );
  const referencedRoomDelete = await request(`/admin/rooms/${createdRoom.room_id}`, { method: 'DELETE', token: state.adminToken });
  ensure(referencedRoomDelete.response.status === 409, `Referenced room delete returned ${referencedRoomDelete.response.status}.`);
  const referencedTypeDelete = await request(`/admin/room-types/${createdType.type_id}`, { method: 'DELETE', token: state.adminToken });
  ensure(referencedTypeDelete.response.status === 409, `Referenced room-type delete returned ${referencedTypeDelete.response.status}.`);
  const countsAfterDelete = await database.query(
    `SELECT
       (SELECT COUNT(*)::int FROM rooms WHERE room_id = $1) AS rooms,
       (SELECT COUNT(*)::int FROM booking_details WHERE booking_id = $2::uuid) AS details,
       (SELECT COUNT(*)::int FROM daily_pricing_logs WHERE booking_id = $2::uuid) AS logs`,
    [createdRoom.room_id, state.bookingId],
  );
  ensure(
    JSON.stringify(countsBeforeDelete.rows[0]) === JSON.stringify(countsAfterDelete.rows[0]),
    'A rejected referenced delete mutated persisted data.',
  );

  await restorePricingSetting();
  await setRole(state.adminId, 'customer');
  const demotedRequest = await request('/admin/rooms', { token: state.adminToken });
  ensure(demotedRequest.response.status === 403, `Demoted admin token returned ${demotedRequest.response.status}, expected 403.`);

  console.log(JSON.stringify({
    status: 'ok',
    authorization: { anonymous: 401, customer: 403, demoted_token: 403 },
    duplicate_type_statuses: statuses(duplicateTypes),
    duplicate_room_statuses: statuses(duplicateRooms),
    stale_setting_statuses: statuses(settingUpdates),
    base_booking: {
      pricing_source: booking.body.data.pricing_source,
      ai_multiplier: booking.body.data.ai_multiplier,
      settings_version: booking.body.data.settings_version,
    },
    history_snapshot_preserved: true,
    referenced_delete_statuses: [referencedRoomDelete.response.status, referencedTypeDelete.response.status],
  }));
} finally {
  await cleanup();
  await database.end();
}
