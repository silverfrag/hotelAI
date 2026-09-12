import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const { Client } = pg;
const baseUrl = (process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core').replace(/\/$/, '');
await waitForApi(baseUrl);

const runId = randomUUID().replaceAll('-', '').slice(0, 8);
const adminEmail = `stay-admin-${runId}@example.com`;
const customerEmail = `stay-guest-${runId}@example.com`;
const password = 'StayLifecycle123!';
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
  roomTypeId: null,
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

async function register(fullName, email) {
  const result = await request('/auth/register', {
    method: 'POST',
    json: { full_name: fullName, email, password },
  });
  ensure(result.response.status === 201, `Registration for ${email} returned ${result.response.status}.`);
  const id = result.body?.user?.id;
  const token = result.body?.access_token;
  ensure(typeof id === 'string' && typeof token === 'string', `Registration for ${email} is incomplete.`);
  state.customerIds.push(id);
  return { id, token };
}

async function findAdminBooking(token, bookingId) {
  const result = await request(`/admin/bookings?search=${encodeURIComponent(bookingId)}`, { token });
  ensure(result.response.status === 200, `Admin booking lookup returned ${result.response.status}.`);
  return result.body?.data?.find((booking) => booking.booking_id === bookingId);
}

async function waitForPublishedEvents(bookingId, eventTypes, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await database.query(
      `SELECT event_type, published_at
       FROM event_outbox
       WHERE aggregate_type = 'booking' AND aggregate_id = $1
         AND event_type = ANY($2::text[])
       ORDER BY occurred_at, event_id`,
      [bookingId, eventTypes],
    );
    if (
      rows.rowCount === eventTypes.length
      && rows.rows.every((row) => row.published_at !== null)
      && eventTypes.every((eventType) => rows.rows.some((row) => row.event_type === eventType))
    ) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Stay events for ${bookingId} were not published in time.`);
}

async function cleanup() {
  try {
    await database.query('BEGIN');
    await database.query("SELECT set_config('hotelai.allow_room_turnover_cleanup', 'on', true)");
    if (state.quoteIds.length > 0) {
      await database.query("SELECT set_config('hotelai.allow_quote_event_cleanup', 'on', true)");
      await database.query("SELECT set_config('hotelai.allow_ai_shadow_cleanup', 'on', true)");
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_type = 'pricing_quote'
           AND (aggregate_id = ANY($1::text[]) OR payload->>'quote_id' = ANY($1::text[]))`,
        [state.quoteIds],
      );
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
        `UPDATE rooms
         SET current_status = 'Available', occupancy_booking_id = NULL
         WHERE occupancy_booking_id = ANY($1::uuid[])`,
        [state.bookingIds],
      );
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'booking_id' = ANY($1::text[])`,
        [state.bookingIds],
      );
      await database.query(
        'DELETE FROM booking_room_assignment_events WHERE booking_id = ANY($1::uuid[])',
        [state.bookingIds],
      );
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
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_type = 'room' AND aggregate_id = ANY($1::text[])`,
        [state.roomIds.map(String)],
      );
      await database.query(
        'DELETE FROM room_housekeeping_events WHERE room_id = ANY($1::int[])',
        [state.roomIds],
      );
      await database.query('DELETE FROM rooms WHERE room_id = ANY($1::int[])', [state.roomIds]);
    }
    if (state.roomTypeId !== null) {
      await database.query('DELETE FROM room_types WHERE type_id = $1', [state.roomTypeId]);
    }
    if (state.customerIds.length > 0) {
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'customer_id' = ANY($1::text[])`,
        [state.customerIds],
      );
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

await database.connect();

try {
  const adminRegistration = await register('Stay Lifecycle Admin', adminEmail);
  await database.query(
    `UPDATE customers SET role = 'admin' WHERE customer_id = $1::uuid`,
    [adminRegistration.id],
  );
  const adminLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: adminEmail, password },
  });
  ensure(adminLogin.response.status === 201, `Admin login returned ${adminLogin.response.status}.`);
  const adminToken = adminLogin.body?.access_token;
  ensure(typeof adminToken === 'string', 'Admin login did not issue a token.');

  const guest = await register('Stay Lifecycle Guest', customerEmail);
  const typeRows = await database.query(
    `INSERT INTO room_types (name, base_price, capacity)
     VALUES ($1, 777000, 2)
     RETURNING type_id`,
    [`Stay ${runId}`],
  );
  state.roomTypeId = Number(typeRows.rows[0].type_id);
  const roomRows = await database.query(
    `INSERT INTO rooms (type_id, room_number, current_status)
     VALUES ($1, $2, 'Available'), ($1, $3, 'Maintenance')
     RETURNING room_id, room_number, current_status`,
    [state.roomTypeId, `S${runId.slice(0, 7)}A`, `S${runId.slice(0, 7)}B`],
  );
  const availableRoom = roomRows.rows.find((room) => room.current_status === 'Available');
  const maintenanceRoom = roomRows.rows.find((room) => room.current_status === 'Maintenance');
  state.roomIds.push(...roomRows.rows.map((room) => Number(room.room_id)));

  const today = businessDate();
  const tomorrow = addDays(today, 1);
  const quoteInput = {
    room_type_id: state.roomTypeId,
    check_in_date: today,
    check_out_date: tomorrow,
    total_of_special_requests: 1,
  };
  const quote = await request('/pricing/quote', { method: 'POST', json: quoteInput });
  ensure(quote.response.status === 201, `Initial quote returned ${quote.response.status}.`);
  state.quoteIds.push(quote.body.data.quote_id);
  ensure(quote.body?.data?.rooms_available === 1, 'Isolated room type should have one available room.');

  const creation = await request('/bookings', {
    method: 'POST',
    token: guest.token,
    json: quoteInput,
  });
  ensure(creation.response.status === 201, `Booking creation returned ${creation.response.status}.`);
  const bookingId = creation.body?.data?.booking?.booking_id;
  ensure(typeof bookingId === 'string', 'Created booking ID is missing.');
  state.bookingIds.push(bookingId);
  ensure(Number(creation.body?.data?.room_id) === Number(availableRoom.room_id), 'Booking used the wrong room.');

  const before = await findAdminBooking(adminToken, bookingId);
  ensure(before?.status === 'Confirmed', 'New booking is not Confirmed.');
  ensure(before?.can_check_in === true && before?.can_check_out === false, 'Pre-check-in action flags are wrong.');
  ensure(before?.can_cancel === false && before?.can_complete === false, 'Same-day booking cancellation/completion flags are wrong.');

  const anonymousCheckIn = await request(`/admin/bookings/${bookingId}/check-in`, { method: 'PATCH' });
  ensure(anonymousCheckIn.response.status === 401, `Anonymous check-in returned ${anonymousCheckIn.response.status}.`);
  const guestCheckIn = await request(`/admin/bookings/${bookingId}/check-in`, {
    method: 'PATCH',
    token: guest.token,
  });
  ensure(guestCheckIn.response.status === 403, `Guest check-in returned ${guestCheckIn.response.status}.`);
  const prematureCheckout = await request(`/admin/bookings/${bookingId}/check-out`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(prematureCheckout.response.status === 409, `Checkout before check-in returned ${prematureCheckout.response.status}.`);

  const concurrentCheckIns = await Promise.all([
    request(`/admin/bookings/${bookingId}/check-in`, { method: 'PATCH', token: adminToken }),
    request(`/admin/bookings/${bookingId}/check-in`, { method: 'PATCH', token: adminToken }),
  ]);
  const checkInStatuses = concurrentCheckIns.map(({ response }) => response.status).sort((a, b) => a - b);
  ensure(
    checkInStatuses.join(',') === '200,409',
    `Concurrent check-in results were ${JSON.stringify(concurrentCheckIns.map(({ response, body }) => ({ status: response.status, body })))}.`,
  );
  const checkedIn = concurrentCheckIns.find(({ response }) => response.status === 200)?.body?.data;
  ensure(checkedIn?.status === 'CheckedIn', 'Successful check-in did not return CheckedIn.');
  ensure(checkedIn?.can_check_out === false && checkedIn?.can_check_in === false, 'Unpaid stay must not advertise checkout.');
  ensure(checkedIn?.checked_in_by === adminRegistration.id && checkedIn?.checked_in_at, 'Check-in audit metadata is missing.');

  const storedStay = await database.query(
    `SELECT booking.status, booking.checked_in_at, booking.checked_in_by,
            room.current_status, room.occupancy_booking_id
     FROM bookings booking
     INNER JOIN booking_details detail ON detail.booking_id = booking.booking_id
     INNER JOIN rooms room ON room.room_id = detail.room_id
     WHERE booking.booking_id = $1::uuid`,
    [bookingId],
  );
  ensure(storedStay.rows[0]?.status === 'CheckedIn', 'Database booking status was not updated atomically.');
  ensure(storedStay.rows[0]?.current_status === 'Occupied', 'Physical room was not marked Occupied.');
  ensure(storedStay.rows[0]?.occupancy_booking_id === bookingId, 'Room is not linked to the active booking.');

  const customerHistory = await request('/bookings', { token: guest.token });
  const historyBooking = customerHistory.body?.data?.find((booking) => booking.booking_id === bookingId);
  ensure(historyBooking?.status === 'CheckedIn' && historyBooking?.can_cancel === false, 'Customer history does not expose CheckedIn correctly.');
  const cancelActiveStay = await request(`/bookings/${bookingId}/cancel`, {
    method: 'PATCH',
    token: guest.token,
  });
  ensure(cancelActiveStay.response.status === 409, `Canceling a CheckedIn booking returned ${cancelActiveStay.response.status}.`);
  const deactivateActiveGuest = await request('/users/me/deactivate', {
    method: 'POST',
    token: guest.token,
    json: { password },
  });
  ensure(deactivateActiveGuest.response.status === 409, `Deactivation during a stay returned ${deactivateActiveGuest.response.status}.`);
  const mutateOccupiedRoom = await request(`/admin/rooms/${availableRoom.room_id}`, {
    method: 'PATCH',
    token: adminToken,
    json: { current_status: 'Maintenance' },
  });
  ensure(mutateOccupiedRoom.response.status === 409, `Editing an occupied room returned ${mutateOccupiedRoom.response.status}.`);

  const duringQuote = await request('/pricing/quote', { method: 'POST', json: quoteInput });
  ensure(duringQuote.response.status === 201 && duringQuote.body?.data?.rooms_available === 0, 'CheckedIn room was offered as available.');
  state.quoteIds.push(duringQuote.body.data.quote_id);

  const unpaidCheckout = await request(`/admin/bookings/${bookingId}/check-out`, { method: 'PATCH', token: adminToken });
  ensure(unpaidCheckout.response.status === 409, 'Checkout must require settlement.');
  const settlement = await request(`/admin/bookings/${bookingId}/payments`, {
    method: 'POST', token: adminToken,
    json: { amount: creation.body.data.total_price, method: 'Cash', idempotency_key: `stay-payment:${runId}` },
  });
  ensure(settlement.response.status === 201, `Settlement failed: ${JSON.stringify(settlement.body)}`);
  const concurrentCheckOuts = await Promise.all([
    request(`/admin/bookings/${bookingId}/check-out`, { method: 'PATCH', token: adminToken }),
    request(`/admin/bookings/${bookingId}/check-out`, { method: 'PATCH', token: adminToken }),
  ]);
  const checkOutStatuses = concurrentCheckOuts.map(({ response }) => response.status).sort((a, b) => a - b);
  ensure(
    checkOutStatuses.join(',') === '200,409',
    `Concurrent check-out results were ${JSON.stringify(concurrentCheckOuts.map(({ response, body }) => ({ status: response.status, body })))}.`,
  );
  const checkedOut = concurrentCheckOuts.find(({ response }) => response.status === 200)?.body?.data;
  ensure(checkedOut?.status === 'Completed', 'Successful checkout did not complete the booking.');
  ensure(checkedOut?.checked_out_by === adminRegistration.id && checkedOut?.checked_out_at, 'Checkout audit metadata is missing.');
  ensure(!checkedOut?.can_check_out && !checkedOut?.can_check_in && !checkedOut?.can_cancel, 'Completed action flags are wrong.');

  const releasedRoom = await database.query(
    `SELECT current_status,
            housekeeping_status,
            housekeeping_version,
            occupancy_booking_id
     FROM rooms
     WHERE room_id = $1`,
    [availableRoom.room_id],
  );
  ensure(releasedRoom.rows[0]?.current_status === 'Available', 'Checkout did not release the room.');
  ensure(releasedRoom.rows[0]?.occupancy_booking_id === null, 'Checkout left an occupancy booking link behind.');
  ensure(releasedRoom.rows[0]?.housekeeping_status === 'Dirty', 'Checkout did not mark the room Dirty.');

  const dirtyQuote = await request('/pricing/quote', { method: 'POST', json: quoteInput });
  ensure(
    dirtyQuote.response.status === 201 && dirtyQuote.body?.data?.rooms_available === 0,
    'A Dirty room was offered for same-day arrival.',
  );
  state.quoteIds.push(dirtyQuote.body.data.quote_id);

  const cleaning = await request(`/admin/rooms/${availableRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': `stay-cleaning:${runId}` },
    json: {
      target_status: 'Cleaning',
      expected_version: Number(releasedRoom.rows[0].housekeeping_version),
      reason: 'Stay lifecycle smoke starts room cleaning.',
    },
  });
  ensure(cleaning.response.status === 200, `Dirty to Cleaning returned ${cleaning.response.status}.`);
  const cleaningRoom = await database.query(
    'SELECT housekeeping_status, housekeeping_version FROM rooms WHERE room_id = $1',
    [availableRoom.room_id],
  );
  ensure(cleaningRoom.rows[0]?.housekeeping_status === 'Cleaning', 'Room did not enter Cleaning.');

  const ready = await request(`/admin/rooms/${availableRoom.room_id}/housekeeping`, {
    method: 'PATCH',
    token: adminToken,
    headers: { 'Idempotency-Key': `stay-ready:${runId}` },
    json: {
      target_status: 'Ready',
      expected_version: Number(cleaningRoom.rows[0].housekeeping_version),
      reason: 'Stay lifecycle smoke completes room inspection.',
    },
  });
  ensure(ready.response.status === 200, `Cleaning to Ready returned ${ready.response.status}.`);

  const afterQuote = await request('/pricing/quote', { method: 'POST', json: quoteInput });
  ensure(
    afterQuote.response.status === 201 && afterQuote.body?.data?.rooms_available === 1,
    'Ready transition did not restore same-day availability.',
  );
  state.quoteIds.push(afterQuote.body.data.quote_id);

  const directOccupied = await request(`/admin/rooms/${availableRoom.room_id}`, {
    method: 'PATCH',
    token: adminToken,
    json: { current_status: 'Occupied' },
  });
  ensure(directOccupied.response.status === 400, `Manual Occupied transition returned ${directOccupied.response.status}.`);

  const futureInput = {
    ...quoteInput,
    check_in_date: addDays(today, 5),
    check_out_date: addDays(today, 7),
  };
  const futureCreation = await request('/bookings', {
    method: 'POST',
    token: guest.token,
    json: futureInput,
  });
  ensure(futureCreation.response.status === 201, `Future booking creation returned ${futureCreation.response.status}.`);
  const futureId = futureCreation.body?.data?.booking?.booking_id;
  state.bookingIds.push(futureId);
  const earlyCheckIn = await request(`/admin/bookings/${futureId}/check-in`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(earlyCheckIn.response.status === 409, `Early check-in returned ${earlyCheckIn.response.status}.`);
  const futureCancel = await request(`/bookings/${futureId}/cancel`, { method: 'PATCH', token: guest.token });
  ensure(futureCancel.response.status === 200, `Future booking cleanup cancellation returned ${futureCancel.response.status}.`);

  const maintenanceId = randomUUID();
  await database.query(
    `INSERT INTO bookings (booking_id, customer_id, check_in_date, check_out_date, status)
     VALUES ($1::uuid, $2::uuid, $3::date, $4::date, 'Confirmed')`,
    [maintenanceId, guest.id, today, tomorrow],
  );
  await database.query(
    `INSERT INTO booking_details (
       booking_id, room_id, applied_price, room_number_snapshot, room_type_name_snapshot
     ) VALUES ($1::uuid, $2, 777000, $3, $4)`,
    [maintenanceId, maintenanceRoom.room_id, maintenanceRoom.room_number, `Stay ${runId}`],
  );
  state.bookingIds.push(maintenanceId);
  const maintenanceCheckIn = await request(`/admin/bookings/${maintenanceId}/check-in`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(maintenanceCheckIn.response.status === 409, `Maintenance-room check-in returned ${maintenanceCheckIn.response.status}.`);

  const malformed = await request('/admin/bookings/not-a-uuid/check-in', {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(malformed.response.status === 400, `Malformed check-in UUID returned ${malformed.response.status}.`);
  const missing = await request(`/admin/bookings/${randomUUID()}/check-out`, {
    method: 'PATCH',
    token: adminToken,
  });
  ensure(missing.response.status === 404, `Missing checkout booking returned ${missing.response.status}.`);

  await waitForPublishedEvents(bookingId, ['booking.checked-in.v1', 'booking.checked-out.v1']);
  const dashboard = await request('/admin/dashboard', { token: adminToken });
  ensure(dashboard.response.status === 200, `Dashboard returned ${dashboard.response.status}.`);
  ensure(Number.isInteger(dashboard.body?.data?.summary?.checked_in_bookings), 'Dashboard lacks CheckedIn count.');

  console.log(JSON.stringify({
    status: 'ok',
    booking_id: bookingId,
    concurrent_check_in_statuses: checkInStatuses,
    concurrent_check_out_statuses: checkOutStatuses,
    room_released_dirty_then_ready: true,
    stay_events_published: true,
  }));
} finally {
  await cleanup();
  await database.end();
}
