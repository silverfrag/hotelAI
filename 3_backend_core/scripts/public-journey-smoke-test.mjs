import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const apiBase = (process.env.API_BASE_URL ?? 'http://localhost/api/v1/core').replace(/\/$/, '');
await waitForApi(apiBase);
const suffix = randomBytes(6).toString('hex');
const email = `public-journey-${suffix}@example.com`;
const password = `Journey-${suffix}-Aa1!`;
let accessToken = '';
let sessionCookie = '';
let bookingId = '';
const quoteIds = [];

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, options);
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: process.env.HOTEL_TIMEZONE ?? 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

async function cleanup() {
  const client = new pg.Client({
    host: process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST ?? 'localhost'),
    port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
    user: process.env.POSTGRES_USER ?? process.env.DB_USER,
    password: process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD,
    database: process.env.POSTGRES_DB ?? process.env.DB_NAME,
  });

  await client.connect();
  try {
    await client.query('BEGIN');
    if (quoteIds.length > 0) {
      await client.query("SELECT set_config('hotelai.allow_quote_event_cleanup', 'on', true)");
      await client.query(
        `DELETE FROM event_outbox
         WHERE aggregate_type = 'pricing_quote'
           AND (aggregate_id = ANY($1::text[]) OR payload->>'quote_id' = ANY($1::text[]))`,
        [quoteIds],
      );
      await client.query('DELETE FROM pricing_quote_events WHERE quote_id = ANY($1::uuid[])', [quoteIds]);
      await client.query('DELETE FROM pricing_quotes WHERE quote_id = ANY($1::uuid[])', [quoteIds]);
    }
    const customer = await client.query('SELECT customer_id FROM customers WHERE email = $1', [email]);
    if (customer.rows[0]) {
      const customerId = customer.rows[0].customer_id;
      await client.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = $1::text
            OR payload->>'customer_id' = $1::text`,
        [customerId],
      );
      await client.query(
        `DELETE FROM daily_pricing_logs
         WHERE booking_id IN (SELECT booking_id FROM bookings WHERE customer_id = $1)`,
        [customerId],
      );
      await client.query(
        `DELETE FROM booking_details
         WHERE booking_id IN (SELECT booking_id FROM bookings WHERE customer_id = $1)`,
        [customerId],
      );
      await client.query('DELETE FROM bookings WHERE customer_id = $1', [customerId]);
      await client.query('DELETE FROM customers WHERE customer_id = $1', [customerId]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

try {
  const roomsResult = await request('/rooms');
  ensure(roomsResult.response.status === 200, `Room list returned ${roomsResult.response.status}.`);
  ensure(Array.isArray(roomsResult.payload?.data), 'Room list payload is invalid.');
  const roomType = roomsResult.payload.data.find((room) => room.total_rooms > 0);
  ensure(roomType, 'No room type with physical inventory is available for the test.');
  ensure(Number.isInteger(roomType.available_now), 'Room inventory metadata is missing.');

  const detailResult = await request(`/rooms/${roomType.type_id}`);
  ensure(detailResult.response.status === 200, `Room detail returned ${detailResult.response.status}.`);
  ensure(detailResult.payload?.data?.type_id === roomType.type_id, 'Room detail does not match list data.');

  const invalidIdResult = await request('/rooms/2147483648');
  ensure(invalidIdResult.response.status === 400, `Oversized room ID returned ${invalidIdResult.response.status}.`);

  const checkIn = addDays(businessDate(), 450);
  const checkOut = addDays(checkIn, 2);
  const quoteInput = {
    room_type_id: roomType.type_id,
    check_in_date: checkIn,
    check_out_date: checkOut,
    total_of_special_requests: 2,
  };

  const crossOriginQuote = await request('/pricing/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.example' },
    body: JSON.stringify(quoteInput),
  });
  ensure(crossOriginQuote.response.status === 403, `Cross-origin quote returned ${crossOriginQuote.response.status}.`);

  const invalidQuote = await request('/pricing/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...quoteInput, check_out_date: checkIn }),
  });
  ensure(invalidQuote.response.status === 400, `Invalid date quote returned ${invalidQuote.response.status}.`);

  const initialQuoteResult = await request('/pricing/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quoteInput),
  });
  ensure(initialQuoteResult.response.status === 201, `Initial quote returned ${initialQuoteResult.response.status}.`);
  const initialQuote = initialQuoteResult.payload?.data;
  ensure(initialQuote?.rooms_available > 0, 'No inventory is available for the quote test dates.');
  quoteIds.push(initialQuote.quote_id);
  ensure(initialQuote.total_price === initialQuote.nightly_price * initialQuote.nights, 'Quote total is inconsistent.');
  ensure(initialQuote.is_estimate === true && initialQuote.currency === 'VND', 'Quote metadata is incomplete.');

  const registration = await request('/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'Public Journey Smoke', email, password }),
  });
  ensure(registration.response.status === 201, `Registration returned ${registration.response.status}.`);
  accessToken = registration.payload?.access_token;
  ensure(typeof accessToken === 'string' && accessToken.length > 0, 'Registration did not issue a token.');
  const setCookie = registration.response.headers.get('set-cookie') ?? '';
  ensure(setCookie.includes('hotelai_session='), 'Registration did not set the session cookie.');
  ensure(/HttpOnly/i.test(setCookie), 'Session cookie is not HttpOnly.');
  ensure(/SameSite=Lax/i.test(setCookie), 'Session cookie is not SameSite=Lax.');
  ensure(/Path=\//i.test(setCookie), 'Session cookie does not apply to the full site.');
  sessionCookie = setCookie.split(';', 1)[0];

  const cookieIdentity = await request('/auth/me', {
    headers: { Cookie: sessionCookie },
  });
  ensure(cookieIdentity.response.status === 200, `Cookie authentication returned ${cookieIdentity.response.status}.`);
  ensure(cookieIdentity.payload?.email === email, 'Cookie authentication returned the wrong user.');

  const bookingResult = await request('/bookings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: sessionCookie,
    },
    body: JSON.stringify(quoteInput),
  });
  ensure(bookingResult.response.status === 201, `Booking returned ${bookingResult.response.status}.`);
  const booking = bookingResult.payload?.data;
  bookingId = booking?.booking?.booking_id;
  ensure(typeof bookingId === 'string', 'Booking ID is missing.');
  ensure(booking.nightly_price === initialQuote.nightly_price, 'Booked nightly price differs from the quote.');
  ensure(booking.total_price === initialQuote.total_price, 'Booked total differs from the quote.');

  const reducedQuoteResult = await request('/pricing/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quoteInput),
  });
  ensure(reducedQuoteResult.response.status === 201, `Post-booking quote returned ${reducedQuoteResult.response.status}.`);
  ensure(
    reducedQuoteResult.payload?.data?.rooms_available === initialQuote.rooms_available - 1,
    'Availability did not decrease after booking.',
  );
  quoteIds.push(reducedQuoteResult.payload.data.quote_id);

  const cancellation = await request(`/bookings/${bookingId}/cancel`, {
    method: 'PATCH',
    headers: { Cookie: sessionCookie },
  });
  ensure(cancellation.response.status === 200, `Cancellation returned ${cancellation.response.status}.`);

  const restoredQuoteResult = await request('/pricing/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(quoteInput),
  });
  ensure(restoredQuoteResult.response.status === 201, `Post-cancellation quote returned ${restoredQuoteResult.response.status}.`);
  ensure(
    restoredQuoteResult.payload?.data?.rooms_available === initialQuote.rooms_available,
    'Availability did not recover after cancellation.',
  );
  quoteIds.push(restoredQuoteResult.payload.data.quote_id);

  const logout = await request('/auth/logout', {
    method: 'POST',
    headers: { Cookie: sessionCookie },
  });
  ensure(logout.response.status === 200, `Logout returned ${logout.response.status}.`);
  const clearedCookie = logout.response.headers.get('set-cookie') ?? '';
  ensure(
    /hotelai_session=;/i.test(clearedCookie) && /Expires=/i.test(clearedCookie),
    'Logout did not clear the session cookie.',
  );

  console.log(JSON.stringify({
    status: 'ok',
    room_type_id: roomType.type_id,
    initial_availability: initialQuote.rooms_available,
    booked_availability: reducedQuoteResult.payload.data.rooms_available,
    restored_availability: restoredQuoteResult.payload.data.rooms_available,
    quoted_total: initialQuote.total_price,
    pricing_source: initialQuote.pricing_source,
  }));
} finally {
  await cleanup();
}
