import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const { Client } = pg;
const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core').replace(/\/$/, '');
const password = 'RoomTurnover123!';
const runId = randomUUID().replaceAll('-', '').slice(0, 8);
const roomPrefix = `T${runId.slice(0, 5)}`;
const adminEmail = `turnover-admin-${runId}@example.com`;
const guestEmail = `turnover-guest-${runId}@example.com`;

const database = new Client({
  host: process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST ?? 'localhost'),
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? process.env.DB_USER ?? 'hotel_admin',
  password: process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.POSTGRES_DB ?? process.env.DB_NAME ?? 'hotel_db',
});

const state = {
  customerIds: [],
  bookingIds: [],
  quoteIds: [],
  roomIds: [],
  roomTypeIds: [],
};

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function asNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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

function describeResult({ response, body }) {
  return `${response.status} ${JSON.stringify(body)}`;
}

function roomList(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.data)) return body.data.data;
  return [];
}

async function register(fullName, email) {
  const result = await request('/auth/register', {
    method: 'POST',
    json: { full_name: fullName, email, password },
  });
  ensure(result.response.status === 201, `Registration for ${email} returned ${describeResult(result)}.`);
  const id = result.body?.user?.id;
  const token = result.body?.access_token;
  ensure(typeof id === 'string' && typeof token === 'string', `Registration for ${email} is incomplete.`);
  state.customerIds.push(id);
  return { id, token };
}

async function createRoomType(name, basePrice = 731000) {
  const result = await database.query(
    `INSERT INTO room_types (name, base_price, capacity)
     VALUES ($1, $2, 2)
     RETURNING type_id, name, base_price`,
    [name, basePrice],
  );
  const roomType = result.rows[0];
  state.roomTypeIds.push(Number(roomType.type_id));
  return roomType;
}

async function createRooms(roomTypeId, specs) {
  const rooms = [];
  for (const spec of specs) {
    const result = await database.query(
      `INSERT INTO rooms (
         type_id, room_number, current_status, housekeeping_status
       ) VALUES ($1, $2, $3, $4)
       RETURNING room_id, type_id, room_number, current_status,
                 occupancy_booking_id, housekeeping_status,
                 housekeeping_version, housekeeping_updated_at`,
      [roomTypeId, spec.roomNumber, spec.currentStatus ?? 'Available', spec.housekeepingStatus ?? 'Ready'],
    );
    const room = result.rows[0];
    rooms.push(room);
    state.roomIds.push(Number(room.room_id));
  }
  return rooms;
}

async function insertBooking({ customerId, room, checkIn, checkOut, status = 'Confirmed', appliedPrice = 731000 }) {
  const bookingId = randomUUID();
  const booking = await database.query(
    `INSERT INTO bookings (
       booking_id, customer_id, check_in_date, check_out_date, guest_count, status
     ) VALUES ($1::uuid, $2::uuid, $3::date, $4::date, 1, $5)
     RETURNING booking_id`,
    [bookingId, customerId, checkIn, checkOut, status],
  );
  ensure(booking.rowCount === 1, 'Could not insert turnover fixture booking.');
  const detail = await database.query(
    `INSERT INTO booking_details (
       booking_id, room_id, applied_price, room_number_snapshot,
       room_type_name_snapshot
     )
     SELECT $1::uuid, room.room_id, $3, room.room_number, room_type.name
     FROM rooms room
     INNER JOIN room_types room_type ON room_type.type_id = room.type_id
     WHERE room.room_id = $2
     RETURNING detail_id, room_assignment_version`,
    [bookingId, room.room_id, appliedPrice],
  );
  ensure(detail.rowCount === 1, 'Could not insert turnover fixture booking detail.');
  state.bookingIds.push(bookingId);
  return {
    bookingId,
    detailId: detail.rows[0].detail_id,
    assignmentVersion: Number(detail.rows[0].room_assignment_version),
  };
}

async function createQuote(input) {
  const quote = await request('/pricing/quote', { method: 'POST', json: input });
  ensure(quote.response.status === 201 && quote.body?.data?.quote_id, `Quote failed: ${describeResult(quote)}.`);
  state.quoteIds.push(quote.body.data.quote_id);
  return quote.body.data;
}

async function exposeQuote(quoteId) {
  const exposure = await request(`/pricing/quotes/${quoteId}/events`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `turnover-exposure:${randomUUID()}` },
    json: {
      event_type: 'quote.exposed.v1',
      session_id: randomUUID(),
      search_id: randomUUID(),
    },
  });
  ensure(exposure.response.status === 201, `Quote exposure failed: ${describeResult(exposure)}.`);
}

async function createBooking(token, input, key = `turnover-booking:${randomUUID()}`) {
  const result = await request('/bookings', {
    method: 'POST',
    token,
    headers: { 'Idempotency-Key': key },
    json: input,
  });
  ensure(result.response.status === 201, `Booking creation failed: ${describeResult(result)}.`);
  const bookingId = result.body?.data?.booking?.booking_id;
  ensure(typeof bookingId === 'string', 'Booking response is missing booking_id.');
  state.bookingIds.push(bookingId);
  return result.body.data;
}

async function roomState(roomId) {
  const result = await database.query(
    `SELECT room_id, type_id, room_number, current_status, occupancy_booking_id,
            housekeeping_status, housekeeping_version, housekeeping_updated_at
     FROM rooms
     WHERE room_id = $1`,
    [roomId],
  );
  ensure(result.rowCount === 1, `Room ${roomId} is missing.`);
  return result.rows[0];
}

async function assignmentSnapshot(bookingId) {
  const result = await database.query(
    `SELECT detail.detail_id,
            booking.status AS booking_status,
            detail.room_id,
            detail.room_number_snapshot,
            detail.room_type_name_snapshot,
            detail.room_assignment_version,
            detail.applied_price,
            quote.quote_id,
            quote.nightly_price AS quote_nightly_price,
            quote.total_price AS quote_total_price,
            quote.pricing_source AS quote_pricing_source,
            quote.settings_version AS quote_settings_version,
            quote.ai_model_version AS quote_model_version,
            quote.ai_training_run_id AS quote_training_run_id,
            quote.ai_feature_contract_version AS quote_contract_version,
            pricing.final_price,
            pricing.pricing_source,
            pricing.settings_version,
            pricing.ai_model_version,
            pricing.ai_training_run_id,
            pricing.ai_feature_contract_version
     FROM booking_details detail
     INNER JOIN bookings booking ON booking.booking_id = detail.booking_id
     LEFT JOIN pricing_quotes quote ON quote.booking_id = detail.booking_id
     LEFT JOIN daily_pricing_logs pricing ON pricing.booking_id = detail.booking_id
     WHERE detail.booking_id = $1::uuid`,
    [bookingId],
  );
  ensure(result.rowCount === 1, `Assignment snapshot for ${bookingId} is missing.`);
  return result.rows[0];
}

function lineageSnapshot(row) {
  return {
    applied_price: String(row.applied_price),
    quote_id: row.quote_id,
    quote_nightly_price: String(row.quote_nightly_price),
    quote_total_price: String(row.quote_total_price),
    quote_pricing_source: row.quote_pricing_source,
    quote_settings_version: asNumber(row.quote_settings_version),
    quote_model_version: row.quote_model_version,
    quote_training_run_id: row.quote_training_run_id,
    quote_contract_version: row.quote_contract_version,
    final_price: String(row.final_price),
    pricing_source: row.pricing_source,
    settings_version: asNumber(row.settings_version),
    ai_model_version: row.ai_model_version,
    ai_training_run_id: row.ai_training_run_id,
    ai_feature_contract_version: row.ai_feature_contract_version,
  };
}

async function assertRejectedMutation(sql, params, label) {
  await database.query('BEGIN');
  let rejected = false;
  try {
    await database.query(sql, params);
  } catch {
    rejected = true;
  } finally {
    await database.query('ROLLBACK');
  }
  ensure(rejected, `${label} unexpectedly mutated an append-only ledger.`);
}

async function cleanup() {
  try {
    await database.query('BEGIN');
    await database.query("SELECT set_config('hotelai.allow_room_turnover_cleanup', 'on', true)");
    await database.query("SELECT set_config('hotelai.allow_quote_event_cleanup', 'on', true)");
    await database.query("SELECT set_config('hotelai.allow_ai_shadow_cleanup', 'on', true)");

    if (state.roomIds.length > 0) {
      await database.query(
        `UPDATE rooms
         SET current_status = 'Available',
             occupancy_booking_id = NULL
         WHERE room_id = ANY($1::int[])`,
        [state.roomIds],
      );
    }
    if (state.bookingIds.length > 0) {
      await database.query(
        'DELETE FROM booking_room_assignment_events WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
    }
    if (state.roomIds.length > 0) {
      await database.query(
        'DELETE FROM room_housekeeping_events WHERE room_id = ANY($1::int[])',
        [state.roomIds],
      );
    }

    const aggregateIds = [
      ...state.customerIds,
      ...state.bookingIds,
      ...state.quoteIds,
      ...state.roomIds.map(String),
    ];
    if (aggregateIds.length > 0) {
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'customer_id' = ANY($1::text[])
            OR payload->>'booking_id' = ANY($1::text[])
            OR payload->>'quote_id' = ANY($1::text[])
            OR payload->>'room_id' = ANY($1::text[])
            OR payload->>'old_room_id' = ANY($1::text[])
            OR payload->>'new_room_id' = ANY($1::text[])
            OR payload->>'from_room_id' = ANY($1::text[])
            OR payload->>'to_room_id' = ANY($1::text[])`,
        [aggregateIds],
      );
    }
    if (state.quoteIds.length > 0) {
      await database.query(
        'DELETE FROM ai_pricing_shadow_decisions WHERE quote_id = ANY($1::uuid[])',
        [state.quoteIds],
      );
      await database.query(
        'DELETE FROM ai_pricing_shadow_attempts WHERE quote_id = ANY($1::uuid[])',
        [state.quoteIds],
      );
      await database.query(
        'DELETE FROM pricing_quote_events WHERE quote_id = ANY($1::uuid[])',
        [state.quoteIds],
      );
      await database.query(
        'DELETE FROM pricing_quotes WHERE quote_id = ANY($1::uuid[])',
        [state.quoteIds],
      );
    }
    if (state.bookingIds.length > 0) {
      await database.query(
        'DELETE FROM payment_transactions WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
      await database.query(
        'DELETE FROM daily_pricing_logs WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
      await database.query(
        'DELETE FROM booking_details WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
      await database.query(
        'DELETE FROM bookings WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
    }
    if (state.roomIds.length > 0) {
      await database.query('DELETE FROM rooms WHERE room_id = ANY($1::int[])', [state.roomIds]);
    }
    if (state.roomTypeIds.length > 0) {
      await database.query('DELETE FROM room_types WHERE type_id = ANY($1::int[])', [state.roomTypeIds]);
    }
    if (state.customerIds.length > 0) {
      await database.query(
        `DELETE FROM customer_account_audits
         WHERE customer_id = ANY($1::uuid[]) OR changed_by = ANY($1::uuid[])`,
        [state.customerIds],
      );
      await database.query('DELETE FROM customers WHERE customer_id = ANY($1::uuid[])', [state.customerIds]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }
}

await waitForApi(baseUrl);
await database.connect();

try {
  const admin = await register('Room Turnover Admin', adminEmail);
  const guest = await register('Room Turnover Guest', guestEmail);
  await database.query(
    `UPDATE customers SET role = 'admin' WHERE customer_id = $1::uuid`,
    [admin.id],
  );
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: adminEmail, password },
  });
  ensure(adminLogin.response.status === 201, `Admin login returned ${describeResult(adminLogin)}.`);
  const adminToken = adminLogin.body?.access_token;
  ensure(typeof adminToken === 'string', 'Admin login did not issue a token.');

  const anonymousQueue = await request('/admin/housekeeping');
  ensure(anonymousQueue.response.status === 401, `Anonymous housekeeping queue returned ${describeResult(anonymousQueue)}.`);
  const guestQueue = await request('/admin/housekeeping', { token: guest.token });
  ensure(guestQueue.response.status === 403, `Guest housekeeping queue returned ${describeResult(guestQueue)}.`);

  const today = businessDate();
  const tomorrow = addDays(today, 1);

  // Checkout must release physical occupancy but keep the room out of same-day inventory until cleaned.
  const checkoutType = await createRoomType(`Turnover checkout ${runId}`, 701000);
  const [checkoutRoom] = await createRooms(checkoutType.type_id, [
    { roomNumber: `${roomPrefix}C1` },
  ]);
  const checkoutFixture = await insertBooking({
    customerId: guest.id,
    room: checkoutRoom,
    checkIn: today,
    checkOut: tomorrow,
    appliedPrice: 701000,
  });
  const beforeCheckoutRoom = await roomState(checkoutRoom.room_id);
  const checkIn = await request(`/admin/bookings/${checkoutFixture.bookingId}/check-in`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(checkIn.response.status === 200, `Turnover check-in returned ${describeResult(checkIn)}.`);
  const occupiedQuote = await createQuote({
    room_type_id: Number(checkoutType.type_id),
    check_in_date: today,
    check_out_date: tomorrow,
    guest_count: 1,
    total_of_special_requests: 0,
  });
  ensure(
    Number(occupiedQuote.rooms_sellable) === 1
      && Number(occupiedQuote.rooms_available) === 0
      && Number(occupiedQuote.rooms_booked) === 1
      && Number(occupiedQuote.occupancy_ratio) === 1,
    `Occupied room produced an invalid inventory snapshot: ${JSON.stringify(occupiedQuote)}.`,
  );
  const checkOut = await request(`/admin/bookings/${checkoutFixture.bookingId}/check-out`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(checkOut.response.status === 200, `Turnover checkout returned ${describeResult(checkOut)}.`);
  const dirtyAfterCheckout = await roomState(checkoutRoom.room_id);
  ensure(dirtyAfterCheckout.current_status === 'Available', 'Checkout did not release physical room status.');
  ensure(dirtyAfterCheckout.occupancy_booking_id === null, 'Checkout left an occupancy booking link behind.');
  ensure(dirtyAfterCheckout.housekeeping_status === 'Dirty', 'Checkout did not mark the room Dirty.');
  ensure(
    Number(dirtyAfterCheckout.housekeeping_version) === Number(beforeCheckoutRoom.housekeeping_version) + 1,
    'Checkout did not increment housekeeping_version exactly once.',
  );
  const checkoutLedger = await database.query(
    `SELECT event_id, from_status, to_status, from_version, to_version, changed_by
     FROM room_housekeeping_events
     WHERE room_id = $1
     ORDER BY occurred_at, event_id`,
    [checkoutRoom.room_id],
  );
  ensure(checkoutLedger.rowCount === 1, 'Checkout did not append exactly one housekeeping ledger event.');
  ensure(
    checkoutLedger.rows[0].from_status === 'Ready'
      && checkoutLedger.rows[0].to_status === 'Dirty'
      && Number(checkoutLedger.rows[0].to_version) === Number(dirtyAfterCheckout.housekeeping_version)
      && checkoutLedger.rows[0].changed_by === admin.id,
    'Checkout housekeeping ledger event is inconsistent.',
  );
  const checkoutOutbox = await database.query(
    `SELECT event_id
     FROM event_outbox
     WHERE event_type = 'room.housekeeping-status-changed.v1'
       AND (aggregate_id = $1 OR payload->>'room_id' = $1)`,
    [String(checkoutRoom.room_id)],
  );
  ensure(checkoutOutbox.rowCount === 1, 'Checkout did not atomically enqueue its housekeeping event.');

  const queuedAfterCheckout = await request('/admin/housekeeping', { token: adminToken });
  ensure(queuedAfterCheckout.response.status === 200, `Housekeeping queue returned ${describeResult(queuedAfterCheckout)}.`);
  const queuedRoom = roomList(queuedAfterCheckout.body)
    .find((room) => Number(room.room_id) === Number(checkoutRoom.room_id));
  ensure(queuedRoom?.housekeeping_status === 'Dirty', 'Dirty checkout room is missing from the housekeeping queue.');

  const anonymousTransition = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    headers: { 'Idempotency-Key': `turnover-anon:${randomUUID()}` },
    json: {
      target_status: 'Cleaning',
      expected_version: Number(dirtyAfterCheckout.housekeeping_version),
      reason: 'Anonymous transition must be rejected',
    },
  });
  ensure(anonymousTransition.response.status === 401, `Anonymous housekeeping transition returned ${describeResult(anonymousTransition)}.`);
  const guestTransition = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: guest.token,
    headers: { 'Idempotency-Key': `turnover-guest:${randomUUID()}` },
    json: {
      target_status: 'Cleaning',
      expected_version: Number(dirtyAfterCheckout.housekeeping_version),
      reason: 'Guest transition must be rejected by RBAC',
    },
  });
  ensure(guestTransition.response.status === 403, `Guest housekeeping transition returned ${describeResult(guestTransition)}.`);
  const invalidTransition = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': `turnover-invalid:${randomUUID()}` },
    json: {
      target_status: 'Ready',
      expected_version: Number(dirtyAfterCheckout.housekeeping_version),
      reason: 'Cannot bypass the required Cleaning stage',
    },
  });
  ensure(invalidTransition.response.status === 409, `Dirty to Ready transition returned ${describeResult(invalidTransition)}.`);

  const cleaningKey = `turnover-cleaning:${randomUUID()}`;
  const cleaningPayload = {
    target_status: 'Cleaning',
    expected_version: Number(dirtyAfterCheckout.housekeeping_version),
    reason: 'Housekeeper started cleaning the checkout room',
  };
  const cleaning = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': cleaningKey },
    json: cleaningPayload,
  });
  ensure(cleaning.response.status === 200, `Dirty to Cleaning returned ${describeResult(cleaning)}.`);
  ensure(cleaning.body?.data?.housekeeping_status === 'Cleaning', 'Cleaning response has the wrong state.');
  const cleaningVersion = Number(cleaning.body?.data?.housekeeping_version);
  ensure(
    cleaningVersion === Number(dirtyAfterCheckout.housekeeping_version) + 1,
    'Dirty to Cleaning did not increment version exactly once.',
  );
  const cleaningReplay = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': cleaningKey },
    json: cleaningPayload,
  });
  ensure(cleaningReplay.response.status === 200, `Housekeeping replay returned ${describeResult(cleaningReplay)}.`);
  ensure(
    cleaningReplay.body?.data?.event_id === cleaning.body?.data?.event_id
      && Number(cleaningReplay.body?.data?.housekeeping_version) === cleaningVersion,
    'Housekeeping replay did not return the original event without a second mutation.',
  );
  const changedCleaningReplay = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': cleaningKey },
    json: { ...cleaningPayload, reason: 'Changed payload must not reuse the original key' },
  });
  ensure(changedCleaningReplay.response.status === 409, `Changed housekeeping replay returned ${describeResult(changedCleaningReplay)}.`);
  const staleReady = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': `turnover-stale:${randomUUID()}` },
    json: {
      target_status: 'Ready',
      expected_version: Number(dirtyAfterCheckout.housekeeping_version),
      reason: 'Stale expected version must not overwrite cleaning',
    },
  });
  ensure(staleReady.response.status === 409, `Stale housekeeping transition returned ${describeResult(staleReady)}.`);
  const ready = await request(`/admin/rooms/${checkoutRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': `turnover-ready:${randomUUID()}` },
    json: {
      target_status: 'Ready',
      expected_version: cleaningVersion,
      reason: 'Supervisor verified the room is ready for sale',
    },
  });
  ensure(ready.response.status === 200, `Cleaning to Ready returned ${describeResult(ready)}.`);
  ensure(ready.body?.data?.housekeeping_status === 'Ready', 'Cleaning to Ready response has the wrong state.');

  // Same-day inventory must exclude Dirty rooms; future inventory may use them when dates do not overlap.
  const inventoryType = await createRoomType(`Turnover inventory ${runId}`, 711000);
  const [dirtyCandidate, readyCandidate] = await createRooms(inventoryType.type_id, [
    { roomNumber: `${roomPrefix}A1`, housekeepingStatus: 'Dirty' },
    { roomNumber: `${roomPrefix}A2`, housekeepingStatus: 'Ready' },
  ]);
  const sameDayInput = {
    room_type_id: Number(inventoryType.type_id),
    check_in_date: today,
    check_out_date: tomorrow,
    guest_count: 1,
    total_of_special_requests: 0,
  };
  const sameDayQuote = await createQuote(sameDayInput);
  ensure(
    Number(sameDayQuote.rooms_sellable) === 2
      && Number(sameDayQuote.rooms_available) === 1
      && Number(sameDayQuote.rooms_booked) === 1
      && Number(sameDayQuote.occupancy_ratio) === 0.5,
    `Same-day Dirty inventory snapshot is inconsistent: ${JSON.stringify(sameDayQuote)}.`,
  );
  const sameDayBooking = await createBooking(guest.token, sameDayInput);
  ensure(
    Number(sameDayBooking.room_id) === Number(readyCandidate.room_id),
    `Same-day booking selected room ${sameDayBooking.room_id} instead of Ready room ${readyCandidate.room_id}.`,
  );
  const futureInput = {
    ...sameDayInput,
    check_in_date: addDays(today, 7),
    check_out_date: addDays(today, 9),
  };
  const futureBooking = await createBooking(guest.token, futureInput);
  ensure(
    Number(futureBooking.room_id) === Number(dirtyCandidate.room_id),
    `Future booking did not allow the non-Ready, non-overlapping room: ${JSON.stringify(futureBooking)}.`,
  );

  // A quoted Confirmed booking can move within its room type without changing price or AI lineage.
  const assignmentType = await createRoomType(`Turnover assignment ${runId}`, 721000);
  const assignmentRooms = await createRooms(assignmentType.type_id, [
    { roomNumber: `${roomPrefix}R1` },
    { roomNumber: `${roomPrefix}R2` },
    { roomNumber: `${roomPrefix}R3` },
    { roomNumber: `${roomPrefix}R4` },
    { roomNumber: `${roomPrefix}R5`, currentStatus: 'Maintenance' },
  ]);
  const [assignmentSource, targetOne, targetTwo, overlapTarget, maintenanceTarget] = assignmentRooms;
  const otherType = await createRoomType(`Turnover other ${runId}`, 722000);
  const [differentTypeTarget] = await createRooms(otherType.type_id, [
    { roomNumber: `${roomPrefix}X1` },
  ]);
  const assignmentInput = {
    room_type_id: Number(assignmentType.type_id),
    check_in_date: addDays(today, 20),
    check_out_date: addDays(today, 23),
    guest_count: 1,
    total_of_special_requests: 2,
  };
  const lineageQuote = await createQuote(assignmentInput);
  await exposeQuote(lineageQuote.quote_id);
  const lineageBooking = await createBooking(guest.token, {
    ...assignmentInput,
    quote_id: lineageQuote.quote_id,
  });
  ensure(
    Number(lineageBooking.room_id) === Number(assignmentSource.room_id),
    'Quoted reassignment fixture did not select its deterministic source room.',
  );
  const lineageBookingId = lineageBooking.booking.booking_id;
  const beforeAssignment = await assignmentSnapshot(lineageBookingId);
  const beforeLineage = lineageSnapshot(beforeAssignment);
  ensure(Number(beforeAssignment.room_assignment_version) === 1, 'Initial room_assignment_version is not 1.');
  ensure(beforeAssignment.quote_id === lineageQuote.quote_id, 'Accepted quote is not linked to the reassignment fixture.');
  const overlapBooking = await insertBooking({
    customerId: guest.id,
    room: overlapTarget,
    checkIn: addDays(today, 21),
    checkOut: addDays(today, 24),
    appliedPrice: 721000,
  });

  const rejectedTargets = [
    { label: 'maintenance', room: maintenanceTarget },
    { label: 'different-type', room: differentTypeTarget },
    { label: 'overlapping', room: overlapTarget },
  ];
  for (const rejected of rejectedTargets) {
    const result = await request(`/admin/bookings/${lineageBookingId}/reassign-room`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': `turnover-reject-${rejected.label}:${randomUUID()}` },
      json: {
        target_room_id: Number(rejected.room.room_id),
        expected_assignment_version: 1,
        reason: `Reject ${rejected.label} room reassignment target`,
      },
    });
    ensure(result.response.status === 409, `${rejected.label} reassignment returned ${describeResult(result)}.`);
  }

  const concurrentRequests = [targetOne, targetTwo].map((target, index) => ({
    target,
    key: `turnover-race-${index}:${randomUUID()}`,
    payload: {
      target_room_id: Number(target.room_id),
      expected_assignment_version: 1,
      reason: `Concurrent room reassignment contender ${index + 1}`,
    },
  }));
  const concurrentResults = await Promise.all(concurrentRequests.map((attempt) => (
    request(`/admin/bookings/${lineageBookingId}/reassign-room`, {
      method: 'POST',
      token: adminToken,
      headers: { 'Idempotency-Key': attempt.key },
      json: attempt.payload,
    })
  )));
  const assignmentStatuses = concurrentResults.map(({ response }) => response.status).sort((a, b) => a - b);
  ensure(
    assignmentStatuses.join(',') === '201,409',
    `Concurrent reassignment results were ${JSON.stringify(concurrentResults.map(describeResult))}.`,
  );
  const winnerIndex = concurrentResults.findIndex(({ response }) => response.status === 201);
  const winnerResult = concurrentResults[winnerIndex];
  const winnerRequest = concurrentRequests[winnerIndex];
  ensure(winnerResult.body?.data?.room_assignment_version === 2, 'Winning reassignment did not return version 2.');
  ensure(
    Number(winnerResult.body?.data?.to_room_id) === Number(winnerRequest.target.room_id),
    'Winning reassignment returned a different target room.',
  );
  const assignmentReplay = await request(`/admin/bookings/${lineageBookingId}/reassign-room`, {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': winnerRequest.key },
    json: winnerRequest.payload,
  });
  ensure(assignmentReplay.response.status === 201, `Reassignment replay returned ${describeResult(assignmentReplay)}.`);
  ensure(
    assignmentReplay.body?.data?.event_id === winnerResult.body?.data?.event_id
      && assignmentReplay.body?.data?.room_assignment_version === 2,
    'Reassignment replay did not return the original event and version.',
  );
  const changedAssignmentReplay = await request(`/admin/bookings/${lineageBookingId}/reassign-room`, {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': winnerRequest.key },
    json: { ...winnerRequest.payload, reason: 'Changed reassignment payload must be rejected' },
  });
  ensure(changedAssignmentReplay.response.status === 409, `Changed reassignment replay returned ${describeResult(changedAssignmentReplay)}.`);

  const afterAssignment = await assignmentSnapshot(lineageBookingId);
  ensure(
    JSON.stringify(lineageSnapshot(afterAssignment)) === JSON.stringify(beforeLineage),
    `Reassignment changed immutable pricing/quote lineage: ${JSON.stringify({ before: beforeLineage, after: lineageSnapshot(afterAssignment) })}.`,
  );
  ensure(Number(afterAssignment.room_id) === Number(winnerRequest.target.room_id), 'Stored assignment is not the winning target.');
  ensure(Number(afterAssignment.room_assignment_version) === 2, 'Stored room_assignment_version did not advance once.');
  ensure(
    afterAssignment.room_number_snapshot === winnerRequest.target.room_number,
    'Room number snapshot was not updated to the assigned physical room.',
  );
  const assignmentLedger = await database.query(
    `SELECT event_id, booking_detail_id, from_room_id, to_room_id,
            from_version, to_version, changed_by, reason
     FROM booking_room_assignment_events
     WHERE booking_id = $1::uuid
     ORDER BY occurred_at, event_id`,
    [lineageBookingId],
  );
  ensure(assignmentLedger.rowCount === 1, 'Failed/replayed requests appended extra assignment ledger rows.');
  ensure(
    Number(assignmentLedger.rows[0].from_room_id) === Number(assignmentSource.room_id)
      && Number(assignmentLedger.rows[0].to_room_id) === Number(winnerRequest.target.room_id)
      && Number(assignmentLedger.rows[0].from_version) === 1
      && Number(assignmentLedger.rows[0].to_version) === 2
      && assignmentLedger.rows[0].changed_by === admin.id,
    'Confirmed reassignment ledger row is inconsistent.',
  );
  const assignmentOutbox = await database.query(
    `SELECT event_id
     FROM event_outbox
     WHERE event_type = 'booking.room-reassigned.v1'
       AND (aggregate_id = $1 OR payload->>'booking_id' = $1)`,
    [lineageBookingId],
  );
  ensure(assignmentOutbox.rowCount === 1, 'Confirmed reassignment did not enqueue exactly one outbox event.');

  // An in-house guest moves atomically: target becomes Occupied+Ready and source becomes Available+Dirty.
  const inHouseType = await createRoomType(`Turnover in house ${runId}`, 741000);
  const [inHouseSource, inHouseTarget, nonReadyTarget] = await createRooms(inHouseType.type_id, [
    { roomNumber: `${roomPrefix}I1` },
    { roomNumber: `${roomPrefix}I2` },
    { roomNumber: `${roomPrefix}I3`, housekeepingStatus: 'Dirty' },
  ]);
  const inHouseFixture = await insertBooking({
    customerId: guest.id,
    room: inHouseSource,
    checkIn: today,
    checkOut: tomorrow,
    appliedPrice: 741000,
  });
  const inHouseCheckIn = await request(`/admin/bookings/${inHouseFixture.bookingId}/check-in`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(inHouseCheckIn.response.status === 200, `In-house fixture check-in returned ${describeResult(inHouseCheckIn)}.`);
  const rejectNonReady = await request(`/admin/bookings/${inHouseFixture.bookingId}/reassign-room`, {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `turnover-inhouse-dirty:${randomUUID()}` },
    json: {
      target_room_id: Number(nonReadyTarget.room_id),
      expected_assignment_version: 1,
      reason: 'An in-house guest cannot move into a Dirty room',
    },
  });
  ensure(rejectNonReady.response.status === 409, `In-house Dirty target returned ${describeResult(rejectNonReady)}.`);
  const inHouseMove = await request(`/admin/bookings/${inHouseFixture.bookingId}/reassign-room`, {
    method: 'POST',
    token: adminToken,
    headers: { 'Idempotency-Key': `turnover-inhouse:${randomUUID()}` },
    json: {
      target_room_id: Number(inHouseTarget.room_id),
      expected_assignment_version: 1,
      reason: 'Move checked-in guest while preserving the stay',
    },
  });
  ensure(inHouseMove.response.status === 201, `CheckedIn reassignment returned ${describeResult(inHouseMove)}.`);
  const oldInHouseRoom = await roomState(inHouseSource.room_id);
  const newInHouseRoom = await roomState(inHouseTarget.room_id);
  ensure(
    oldInHouseRoom.current_status === 'Available'
      && oldInHouseRoom.occupancy_booking_id === null
      && oldInHouseRoom.housekeeping_status === 'Dirty',
    'CheckedIn reassignment did not release the source as Available+Dirty.',
  );
  ensure(
    newInHouseRoom.current_status === 'Occupied'
      && newInHouseRoom.occupancy_booking_id === inHouseFixture.bookingId
      && newInHouseRoom.housekeeping_status === 'Ready',
    'CheckedIn reassignment did not claim the target as Occupied+Ready.',
  );
  const inHouseDetail = await assignmentSnapshot(inHouseFixture.bookingId);
  ensure(
    Number(inHouseDetail.room_id) === Number(inHouseTarget.room_id)
      && Number(inHouseDetail.room_assignment_version) === 2
      && inHouseDetail.booking_status === 'CheckedIn'
      && String(inHouseDetail.applied_price) === '741000.00',
    'CheckedIn reassignment did not preserve price and advance assignment version.',
  );
  const inHouseHousekeeping = await database.query(
    `SELECT event_id
     FROM room_housekeeping_events
     WHERE room_id = $1 AND from_status = 'Ready' AND to_status = 'Dirty'`,
    [inHouseSource.room_id],
  );
  ensure(inHouseHousekeeping.rowCount === 1, 'CheckedIn reassignment did not audit source turnover.');
  const inHouseOutbox = await database.query(
    `SELECT event_type
     FROM event_outbox
     WHERE (aggregate_id = $1 OR payload->>'booking_id' = $1 OR payload->>'room_id' = $2)
       AND event_type = ANY($3::text[])`,
    [inHouseFixture.bookingId, String(inHouseSource.room_id), [
      'booking.room-reassigned.v1',
      'room.housekeeping-status-changed.v1',
    ]],
  );
  ensure(
    new Set(inHouseOutbox.rows.map((row) => row.event_type)).size === 2,
    'CheckedIn reassignment did not enqueue both assignment and source-turnover events.',
  );

  // Both operational ledgers must reject direct mutation. Each probe is rolled back even if a guard regresses.
  await assertRejectedMutation(
    `UPDATE room_housekeeping_events SET reason = 'tampered' WHERE event_id = $1::uuid`,
    [checkoutLedger.rows[0].event_id],
    'Housekeeping UPDATE',
  );
  await assertRejectedMutation(
    'DELETE FROM room_housekeeping_events WHERE event_id = $1::uuid',
    [checkoutLedger.rows[0].event_id],
    'Housekeeping DELETE',
  );
  await assertRejectedMutation(
    `UPDATE booking_room_assignment_events SET reason = 'tampered' WHERE event_id = $1::uuid`,
    [assignmentLedger.rows[0].event_id],
    'Room-assignment UPDATE',
  );
  await assertRejectedMutation(
    'DELETE FROM booking_room_assignment_events WHERE event_id = $1::uuid',
    [assignmentLedger.rows[0].event_id],
    'Room-assignment DELETE',
  );

  const finalCheckoutEvents = await database.query(
    `SELECT from_status, to_status, from_version, to_version
     FROM room_housekeeping_events
     WHERE room_id = $1
     ORDER BY occurred_at, event_id`,
    [checkoutRoom.room_id],
  );
  ensure(finalCheckoutEvents.rowCount === 3, 'Checkout/Cleaning/Ready should produce exactly three ledger rows.');
  ensure(
    finalCheckoutEvents.rows.map((event) => `${event.from_status}->${event.to_status}`).join(',')
      === 'Ready->Dirty,Dirty->Cleaning,Cleaning->Ready',
    'Housekeeping ledger does not preserve the expected transition order.',
  );

  console.log(JSON.stringify({
    status: 'ok',
    housekeeping_sequence: finalCheckoutEvents.rows.map((event) => `${event.from_status}->${event.to_status}`),
    housekeeping_replay_idempotent: true,
    occupied_inventory_snapshot_preserved: true,
    same_day_dirty_room_excluded: true,
    future_non_ready_room_allowed: true,
    concurrent_reassignment_statuses: assignmentStatuses,
    confirmed_price_and_ai_lineage_preserved: true,
    checked_in_move_atomic: true,
    ledgers_append_only: true,
    overlap_fixture_booking_id: overlapBooking.bookingId,
  }));
} finally {
  await cleanup();
  await database.end();
}
