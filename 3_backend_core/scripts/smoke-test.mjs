import { randomUUID } from 'node:crypto';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  let body;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

const rooms = await request('/rooms');
if (!rooms.response.ok || !rooms.body?.data?.length) throw new Error('Rooms API is unavailable or has no seed data.');

const email = `smoke-${randomUUID()}@example.com`;
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

const history = await request('/bookings', { headers: authHeaders });
if (!history.response.ok || history.body?.count !== 1 || history.body.data[0].booking_id !== booking.body.data.booking.booking_id) throw new Error('Customer-scoped booking history failed.');

const malformedDate = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...bookingInput, check_in_date: `${year}-02-01T12:00:00Z` }) });
if (malformedDate.response.status !== 400) throw new Error(`Datetime input should be rejected, got ${malformedDate.response.status}.`);

const excessiveRequests = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...bookingInput, total_of_special_requests: 6 }) });
if (excessiveRequests.response.status !== 400) throw new Error(`More than five special requests should return 400, got ${excessiveRequests.response.status}.`);

const overflowingRoomType = await request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify({ ...bookingInput, room_type_id: 2_147_483_648 }) });
if (overflowingRoomType.response.status !== 400) throw new Error(`Out-of-range room type should return 400, got ${overflowingRoomType.response.status}.`);

const concurrentInput = { ...bookingInput, check_in_date: `${year}-03-10`, check_out_date: `${year}-03-12` };
const concurrent = await Promise.all(Array.from({ length: 3 }, () => request('/bookings', { method: 'POST', headers: authHeaders, body: JSON.stringify(concurrentInput) })));
const statuses = concurrent.map(({ response }) => response.status).sort((a, b) => a - b);
if (statuses.join(',') !== '201,201,404') throw new Error(`Concurrent inventory protection failed: ${statuses.join(',')}.`);

const bookingId = booking.body.data.booking.booking_id;
const unauthorizedCancel = await request(`/bookings/${bookingId}/cancel`, { method: 'PATCH' });
if (unauthorizedCancel.response.status !== 401) throw new Error(`Cancellation without JWT should return 401, got ${unauthorizedCancel.response.status}.`);

const cancellations = await Promise.all(Array.from({ length: 2 }, () => request(`/bookings/${bookingId}/cancel`, { method: 'PATCH', headers: authHeaders })));
const cancellationStatuses = cancellations.map(({ response }) => response.status).sort((a, b) => a - b);
if (cancellationStatuses.join(',') !== '200,409') throw new Error(`Concurrent cancellation protection failed: ${cancellationStatuses.join(',')}.`);
const canceled = cancellations.find(({ response }) => response.status === 200);
if (canceled?.body?.data?.status !== 'Canceled' || canceled.body.data.booking_id !== bookingId) throw new Error('Cancellation response did not contain the canceled booking summary.');

const historyAfterCancellation = await request('/bookings', { headers: authHeaders });
const canceledHistoryItem = historyAfterCancellation.body?.data?.find((item) => item.booking_id === bookingId);
if (!historyAfterCancellation.response.ok || canceledHistoryItem?.status !== 'Canceled') throw new Error('Canceled booking was not reflected in customer history.');

console.log(JSON.stringify({ status: 'ok', user: email, booking_id: bookingId, total_price: booking.body.data.total_price, concurrency_statuses: statuses, cancellation_statuses: cancellationStatuses }));
