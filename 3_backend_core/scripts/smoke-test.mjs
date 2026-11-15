import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';
await waitForApi(baseUrl);
const email = `smoke-${randomUUID()}@example.com`;
const otherEmail = `smoke-other-${randomUUID()}@example.com`;
const quoteIds = [];

async function cleanupSmokeAccounts() {
  const database = new pg.Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
    password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
    database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
  });
  try {
    await database.connect();
    await database.query('BEGIN');
    await database.query("SELECT set_config('hotelai.allow_quote_event_cleanup', 'on', true)");
    await database.query(
      `DELETE FROM event_outbox
       WHERE aggregate_type = 'pricing_quote'
         AND (aggregate_id = ANY($1::text[]) OR payload->>'quote_id' = ANY($1::text[]))`,
      [quoteIds],
    );
    await database.query(
      'DELETE FROM pricing_quote_events WHERE quote_id = ANY($1::uuid[])',
      [quoteIds],
    );
    await database.query(
      `DELETE FROM pricing_quotes
       WHERE quote_id = ANY($1::uuid[])
          OR customer_id IN (
            SELECT customer_id FROM customers WHERE email = ANY($2::text[])
          )`,
      [quoteIds, [email, otherEmail]],
    );
    await database.query(
      `DELETE FROM event_outbox event
       USING customers customer
       WHERE (event.aggregate_id = customer.customer_id::text
              OR event.payload->>'customer_id' = customer.customer_id::text)
         AND customer.email = ANY($1::text[])`,
      [[email, otherEmail]],
    );
    await database.query(
      `DELETE FROM daily_pricing_logs pricing_log
       USING bookings booking, customers customer
       WHERE pricing_log.booking_id = booking.booking_id
         AND booking.customer_id = customer.customer_id
         AND customer.email = ANY($1::text[])`,
      [[email, otherEmail]],
    );
    await database.query(
      `DELETE FROM booking_details detail
       USING bookings booking, customers customer
       WHERE detail.booking_id = booking.booking_id
         AND booking.customer_id = customer.customer_id
         AND customer.email = ANY($1::text[])`,
      [[email, otherEmail]],
    );
    await database.query(
      `DELETE FROM bookings booking
       USING customers customer
       WHERE booking.customer_id = customer.customer_id
         AND customer.email = ANY($1::text[])`,
      [[email, otherEmail]],
    );
    await database.query('DELETE FROM customers WHERE email = ANY($1::text[])', [[email, otherEmail]]);
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await database.end().catch(() => undefined);
  }
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  let body;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

try {
const rooms = await request('/rooms');
if (!rooms.response.ok || !rooms.body?.data?.length) throw new Error('Rooms API is unavailable or has no seed data.');

const credentials = { full_name: 'Smoke Test Guest', email, password: 'Password123!' };
const registered = await request('/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
if (registered.response.status !== 201 || !registered.body?.access_token) throw new Error(`Registration failed: ${registered.response.status}`);

const year = new Date().getUTCFullYear() + 10 + (Number.parseInt(randomUUID().slice(0, 6), 16) % 3000);
const bookingInput = { room_type_id: rooms.body.data[0].type_id, check_in_date: `${year}-01-15`, check_out_date: `${year}-01-17`, total_of_special_requests: 1 };
const unauthorized = await request('/bookings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(bookingInput) });
if (unauthorized.response.status !== 401) throw new Error(`Booking without JWT should return 401, got ${unauthorized.response.status}.`);

const authHeaders = { 'content-type': 'application/json', authorization: `Bearer ${registered.body.access_token}` };
const me = await request('/auth/me', { headers: authHeaders });
if (!me.response.ok || me.body.email !== email) throw new Error('JWT identity endpoint failed.');

const booking = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify(bookingInput) });
if (booking.response.status !== 201 || booking.body?.data?.booking?.customer_id !== registered.body.user.id) throw new Error(`Authenticated booking failed: ${booking.response.status}`);
if (!(booking.body.data.total_price > booking.body.data.nightly_price)) throw new Error('Booking total price was not calculated.');
if (booking.body.data.booking.guest_count !== 1) throw new Error('Missing guest_count did not default to one.');

const history = await request('/bookings', { headers: authHeaders });
if (!history.response.ok
  || history.body?.count !== 1
  || history.body.data[0].booking_id !== booking.body.data.booking.booking_id
  || history.body.data[0].can_cancel !== true) {
  throw new Error('Customer-scoped booking history or cancellation eligibility failed.');
}

const malformedDate = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...bookingInput, check_in_date: `${year}-02-01T12:00:00Z` }) });
if (malformedDate.response.status !== 400) throw new Error(`Datetime input should be rejected, got ${malformedDate.response.status}.`);

const excessiveRequests = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...bookingInput, total_of_special_requests: 6 }) });
if (excessiveRequests.response.status !== 400) throw new Error(`More than five special requests should return 400, got ${excessiveRequests.response.status}.`);

const overflowingRoomType = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...bookingInput, room_type_id: 2_147_483_648 }) });
if (overflowingRoomType.response.status !== 400) throw new Error(`Out-of-range room type should return 400, got ${overflowingRoomType.response.status}.`);

const roomCapacity = Number(rooms.body.data[0].capacity);
if (!Number.isInteger(roomCapacity) || roomCapacity < 1) throw new Error('Seed room type has an invalid capacity.');
const overCapacity = await request('/bookings', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    ...bookingInput,
    check_in_date: `${year}-02-10`,
    check_out_date: `${year}-02-12`,
    guest_count: roomCapacity + 1,
  }),
});
if (overCapacity.response.status !== 400) throw new Error(`Over-capacity booking should return 400, got ${overCapacity.response.status}.`);

const quotedInput = {
  ...bookingInput,
  check_in_date: `${year}-05-10`,
  check_out_date: `${year}-05-13`,
  guest_count: roomCapacity,
};
const quote = await request('/pricing/quote', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(quotedInput),
});
if (quote.response.status !== 201 || !quote.body?.data?.quote_id) {
  throw new Error(`Persistent AI quote failed: ${quote.response.status}.`);
}
quoteIds.push(quote.body.data.quote_id);
if (quote.body.data.pricing_source === 'ai'
  && (!quote.body.data.ai_model_version
    || !quote.body.data.ai_training_run_id
    || !quote.body.data.ai_feature_contract_version)) {
  throw new Error('AI quote did not expose model lineage.');
}
if (!quote.body.data.price_guaranteed_until || quote.body.data.availability_is_guaranteed !== false) {
  throw new Error('Quote guarantee metadata is missing.');
}
if (quote.body.data.rooms_sellable < quote.body.data.rooms_available
  || quote.body.data.rooms_booked !== quote.body.data.rooms_sellable - quote.body.data.rooms_available
  || quote.body.data.occupancy_ratio < 0
  || quote.body.data.occupancy_ratio > 1
  || !quote.body.data.inventory_snapshot_at) {
  throw new Error('Quote inventory snapshot is inconsistent.');
}

const exposureSessionId = randomUUID();
const exposureSearchId = randomUUID();
const exposureKey = `quote-exposed:${randomUUID()}`;
const exposureInput = {
  event_type: 'quote.exposed.v1',
  session_id: exposureSessionId,
  search_id: exposureSearchId,
};
const exposed = await request(`/pricing/quotes/${quote.body.data.quote_id}/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'Idempotency-Key': exposureKey },
  body: JSON.stringify(exposureInput),
});
if (exposed.response.status !== 201 || exposed.body?.data?.replayed !== false) {
  throw new Error(`Quote exposure event failed: ${exposed.response.status}.`);
}
const exposedReplay = await request(`/pricing/quotes/${quote.body.data.quote_id}/events`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'Idempotency-Key': exposureKey },
  body: JSON.stringify(exposureInput),
});
if (exposedReplay.response.status !== 201
  || exposedReplay.body?.data?.replayed !== true
  || exposedReplay.body?.data?.quote_event_id !== exposed.body.data.quote_event_id) {
  throw new Error('Quote exposure event was not idempotent.');
}

const rejectedQuote = await request('/pricing/quote', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(quotedInput),
});
if (rejectedQuote.response.status !== 201 || !rejectedQuote.body?.data?.quote_id) {
  throw new Error(`Rejected-quote setup failed: ${rejectedQuote.response.status}.`);
}
quoteIds.push(rejectedQuote.body.data.quote_id);
const bookingWithoutExposure = await request('/bookings', {
  method: 'POST',
  headers: {
    ...authHeaders,
    'Idempotency-Key': `quote-booking-without-exposure:${randomUUID()}`,
  },
  body: JSON.stringify({ ...quotedInput, quote_id: rejectedQuote.body.data.quote_id }),
});
if (bookingWithoutExposure.response.status !== 409) {
  throw new Error(
    `Booking without confirmed exposure should return 409, got ${bookingWithoutExposure.response.status}.`,
  );
}
const rejectionWithoutExposure = await request(`/pricing/quotes/${rejectedQuote.body.data.quote_id}/events`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'Idempotency-Key': `quote-rejected-without-exposure:${randomUUID()}`,
  },
  body: JSON.stringify({ event_type: 'quote.rejected.v1' }),
});
if (rejectionWithoutExposure.response.status !== 409) {
  throw new Error(
    `Rejection without confirmed exposure should return 409, got ${rejectionWithoutExposure.response.status}.`,
  );
}
const rejectedExposure = await request(`/pricing/quotes/${rejectedQuote.body.data.quote_id}/events`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'Idempotency-Key': `quote-exposed-before-rejection:${randomUUID()}`,
  },
  body: JSON.stringify({
    event_type: 'quote.exposed.v1',
    session_id: randomUUID(),
    search_id: randomUUID(),
  }),
});
if (rejectedExposure.response.status !== 201) {
  throw new Error(`Rejected-quote exposure setup failed: ${rejectedExposure.response.status}.`);
}
const rejectedEvent = await request(`/pricing/quotes/${rejectedQuote.body.data.quote_id}/events`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'Idempotency-Key': `quote-rejected:${randomUUID()}`,
  },
  body: JSON.stringify({ event_type: 'quote.rejected.v1' }),
});
if (rejectedEvent.response.status !== 201) {
  throw new Error(`Quote rejection event failed: ${rejectedEvent.response.status}.`);
}
const rejectedBooking = await request('/bookings', {
  method: 'POST',
  headers: { ...authHeaders, 'Idempotency-Key': `rejected-booking:${randomUUID()}` },
  body: JSON.stringify({ ...quotedInput, quote_id: rejectedQuote.body.data.quote_id }),
});
if (rejectedBooking.response.status !== 409) {
  throw new Error(`Rejected quote created a booking: ${rejectedBooking.response.status}.`);
}

const quotedBookingInput = { ...quotedInput, quote_id: quote.body.data.quote_id };
const quotedRoomInput = {
  room_type_id: quotedInput.room_type_id,
  guest_count: quotedInput.guest_count,
  quote_id: quote.body.data.quote_id,
};
const arrayBookingInput = {
  check_in_date: quotedInput.check_in_date,
  check_out_date: quotedInput.check_out_date,
  total_of_special_requests: quotedInput.total_of_special_requests,
  rooms: [quotedRoomInput],
};
for (const rejectedRooms of [[], [quotedRoomInput, quotedRoomInput], Array(9).fill(quotedRoomInput)]) {
  const unsupported = await request('/bookings', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ ...arrayBookingInput, rooms: rejectedRooms }),
  });
  if (unsupported.response.status !== 400) {
    throw new Error(`Unsupported room count ${rejectedRooms.length} should return 400, got ${unsupported.response.status}.`);
  }
}
const quotedBookingKey = `quote:${randomUUID()}`;
const quotedBooking = await request('/bookings', {
  method: 'POST',
  headers: { ...authHeaders, 'Idempotency-Key': quotedBookingKey },
  body: JSON.stringify(quotedBookingInput),
});
if (quotedBooking.response.status !== 201
  || quotedBooking.body?.data?.quote_id !== quote.body.data.quote_id
  || Number(quotedBooking.body?.data?.total_price) !== Number(quote.body.data.total_price)
  || quotedBooking.body?.data?.ai_model_version !== quote.body.data.ai_model_version
  || quotedBooking.body?.data?.ai_training_run_id !== quote.body.data.ai_training_run_id
  || quotedBooking.body?.data?.ai_feature_contract_version
      !== quote.body.data.ai_feature_contract_version) {
  throw new Error(
    `Booking did not accept the immutable quote: ${quotedBooking.response.status} ${JSON.stringify(quotedBooking.body)}.`,
  );
}
const arrayReplay = await request('/bookings', {
  method: 'POST', headers: { ...authHeaders, 'Idempotency-Key': quotedBookingKey },
  body: JSON.stringify(arrayBookingInput),
});
if (arrayReplay.response.status !== 201
  || arrayReplay.body?.data?.booking?.booking_id !== quotedBooking.body.data.booking.booking_id
  || arrayReplay.body?.data?.quote_id !== quotedBooking.body.data.quote_id
  || arrayReplay.body?.data?.total_price !== quotedBooking.body.data.total_price
  || arrayReplay.body?.data?.nightly_price !== quotedBooking.body.data.nightly_price
  || JSON.stringify(arrayReplay.body?.data?.rooms) !== JSON.stringify(quotedBooking.body.data.rooms)) {
  throw new Error(`Single-room array replay must match the legacy quoted receipt: ${JSON.stringify(arrayReplay.body)}.`);
}
for (const changedRoom of [
  { ...quotedRoomInput, room_type_id: quotedRoomInput.room_type_id + 1 },
  { ...quotedRoomInput, guest_count: quotedRoomInput.guest_count + 1 },
  { ...quotedRoomInput, quote_id: randomUUID() },
]) {
  const changedArray = await request('/bookings', {
    method: 'POST', headers: { ...authHeaders, 'Idempotency-Key': quotedBookingKey },
    body: JSON.stringify({ ...arrayBookingInput, rooms: [changedRoom] }),
  });
  if (changedArray.response.status !== 409) {
    throw new Error(`Changed array room/guest/quote must invalidate replay, got ${changedArray.response.status}.`);
  }
}
const conflictingInputs = await request('/bookings', {
  method: 'POST', headers: authHeaders,
  body: JSON.stringify({ ...arrayBookingInput, quote_id: randomUUID() }),
});
if (conflictingInputs.response.status !== 400) throw new Error('Conflicting legacy and array quote IDs must be rejected.');
const reusedQuote = await request('/bookings', {
  method: 'POST',
  headers: { ...authHeaders, 'Idempotency-Key': `quote-reuse:${randomUUID()}` },
  body: JSON.stringify(quotedBookingInput),
});
if (reusedQuote.response.status !== 409) {
  throw new Error(`A quote must only create one booking, got ${reusedQuote.response.status}.`);
}

const idempotencyKey = `booking:${randomUUID()}`;
const idempotentInput = {
  ...bookingInput,
  check_in_date: `${year}-04-10`,
  check_out_date: `${year}-04-12`,
  guest_count: roomCapacity,
};
const idempotencyHeaders = { ...authHeaders, 'Idempotency-Key': idempotencyKey };
const idempotentAttempts = await Promise.all(Array.from({ length: 2 }, () => request('/bookings', {
  method: 'POST',
  headers: idempotencyHeaders,
  body: JSON.stringify(idempotentInput),
})));
const idempotentStatuses = idempotentAttempts.map(({ response }) => response.status).sort((a, b) => a - b);
if (idempotentStatuses.join(',') !== '201,201') throw new Error(`Idempotent booking replay failed: ${idempotentStatuses.join(',')}.`);
const idempotentIds = idempotentAttempts.map(({ body }) => body?.data?.booking?.booking_id);
if (!idempotentIds[0] || new Set(idempotentIds).size !== 1) throw new Error('Concurrent idempotent requests created different bookings.');
if (idempotentAttempts.some(({ body }) => body?.data?.booking?.guest_count !== roomCapacity)) {
  throw new Error('Idempotent booking did not persist guest_count.');
}
const historyAfterIdempotency = await request('/bookings', { headers: authHeaders });
const idempotentHistory = historyAfterIdempotency.body?.data?.filter((item) => (
  item.check_in_date === idempotentInput.check_in_date
  && item.check_out_date === idempotentInput.check_out_date
));
if (historyAfterIdempotency.response.status !== 200
  || idempotentHistory?.length !== 1
  || idempotentHistory[0].guest_count !== roomCapacity) {
  throw new Error(
    `Idempotent retry created an extra booking or lost guest_count in history: ${JSON.stringify({
      status: historyAfterIdempotency.response.status,
      matches: idempotentHistory,
      history: historyAfterIdempotency.body,
    })}.`,
  );
}
const changedReplay = await request('/bookings', {
  method: 'POST',
  headers: idempotencyHeaders,
  body: JSON.stringify({ ...idempotentInput, check_out_date: `${year}-04-13` }),
});
if (changedReplay.response.status !== 409) throw new Error(`Changed idempotency replay should return 409, got ${changedReplay.response.status}.`);
const invalidIdempotencyKey = await request('/bookings', {
  method: 'POST',
  headers: { ...authHeaders, 'Idempotency-Key': 'short' },
  body: JSON.stringify(idempotentInput),
});
if (invalidIdempotencyKey.response.status !== 400) throw new Error(`Invalid Idempotency-Key should return 400, got ${invalidIdempotencyKey.response.status}.`);

const concurrencyRoom = rooms.body.data.filter(room => room.total_rooms > 0).sort((a, b) => a.total_rooms - b.total_rooms)[0];
const concurrentInput = { ...bookingInput, room_type_id: concurrencyRoom.type_id, check_in_date: `${year}-03-10`, check_out_date: `${year}-03-12` };
const inventoryQuote = await request('/pricing/quote', { method: 'POST', headers: authHeaders, body: JSON.stringify(concurrentInput) });
if (inventoryQuote.response.status !== 201) throw new Error('Could not read capacity for the concurrency check.');
quoteIds.push(inventoryQuote.body.data.quote_id);
const availableCapacity = inventoryQuote.body.data.rooms_available;
if (!Number.isSafeInteger(availableCapacity) || availableCapacity < 1 || availableCapacity > 100) throw new Error('Unexpected validation inventory capacity.');
const concurrent = await Promise.all(Array.from({ length: availableCapacity + 1 }, () => request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify(concurrentInput) })));
const statuses = concurrent.map(({ response }) => response.status).sort((a, b) => a - b);
if (statuses.filter(status => status === 201).length !== availableCapacity || statuses.at(-1) !== 404) throw new Error(`Concurrent inventory protection failed: ${statuses.join(',')}.`);
const assignedRooms = concurrent.filter(({response}) => response.status === 201).map(({body}) => body.data.room_id);
if (new Set(assignedRooms).size !== availableCapacity) throw new Error('Concurrent bookings assigned the same physical room.');

const cancellableBooking = concurrent.find(({ response }) => response.status === 201);
const bookingId = cancellableBooking?.body?.data?.booking?.booking_id;
if (!bookingId) throw new Error('Could not identify a booking for cancellation checks.');

const unauthorizedCancel = await request(`/bookings/${bookingId}/cancel`, { method: 'PATCH' });
if (unauthorizedCancel.response.status !== 401) throw new Error(`Cancellation without JWT should return 401, got ${unauthorizedCancel.response.status}.`);

const otherRegistration = await request('/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ full_name: 'Other Smoke Guest', email: otherEmail, password: 'Password123!' }),
});
if (otherRegistration.response.status !== 201 || !otherRegistration.body?.access_token) {
  throw new Error(`Second registration failed: ${otherRegistration.response.status}`);
}
const otherHeaders = { authorization: `Bearer ${otherRegistration.body.access_token}` };
const forbiddenCancel = await request(`/bookings/${bookingId}/cancel`, { method: 'PATCH', headers: otherHeaders });
if (forbiddenCancel.response.status !== 404) throw new Error(`Canceling another customer's booking should return 404, got ${forbiddenCancel.response.status}.`);

const invalidCancellationId = await request('/bookings/not-a-uuid/cancel', { method: 'PATCH', headers: authHeaders });
if (invalidCancellationId.response.status !== 400) throw new Error(`Invalid cancellation UUID should return 400, got ${invalidCancellationId.response.status}.`);

const cancellations = await Promise.all(Array.from({ length: 2 }, () => request(`/bookings/${bookingId}/cancel`, { method: 'PATCH', headers: authHeaders })));
const cancellationStatuses = cancellations.map(({ response }) => response.status).sort((a, b) => a - b);
if (cancellationStatuses.join(',') !== '200,409') throw new Error(`Concurrent cancellation protection failed: ${cancellationStatuses.join(',')}.`);
const canceled = cancellations.find(({ response }) => response.status === 200);
if (canceled?.body?.data?.status !== 'Canceled' || canceled.body.data.booking_id !== bookingId) throw new Error('Cancellation response did not contain the canceled booking summary.');

const historyAfterCancellation = await request('/bookings', { headers: authHeaders });
const canceledHistoryItem = historyAfterCancellation.body?.data?.find((item) => item.booking_id === bookingId);
if (!historyAfterCancellation.response.ok || canceledHistoryItem?.status !== 'Canceled' || canceledHistoryItem.can_cancel !== false) {
  throw new Error('Canceled booking was not reflected correctly in customer history.');
}

const replacement = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify(concurrentInput) });
if (replacement.response.status !== 201) throw new Error(`Canceled inventory was not released: ${replacement.response.status}.`);

console.log(JSON.stringify({
  status: 'ok',
  user: email,
  booking_id: bookingId,
  total_price: booking.body.data.total_price,
  default_guest_count: booking.body.data.booking.guest_count,
  accepted_quote_id: quote.body.data.quote_id,
  quote_exposure_idempotent: true,
  unexposed_quote_booking_blocked: true,
  rejected_quote_blocked: true,
  idempotency_statuses: idempotentStatuses,
  concurrency_statuses: statuses,
  cancellation_statuses: cancellationStatuses,
  unauthorized_owner_status: forbiddenCancel.response.status,
  replacement_status: replacement.response.status,
}));
} finally {
  await cleanupSmokeAccounts();
}
