const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
// Component, service and hook unit checks using controlled API responses.
// Run after npm ci: node scripts/lifecycle-unit-check.cjs. No live API calls.
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');
const compile = (source, filename) => swc.transformSync(source, {
  filename,
  jsc: {parser:{syntax:'typescript', tsx:filename.endsWith('.tsx')}, target:'es2022', transform:{react:{runtime:'automatic'}}},
  module: {type:'commonjs'},
}).code;
const React = requireFrontend('react');
const { renderToStaticMarkup } = requireFrontend('react-dom/server');
let reservation;
const mocks = {
  '@/hooks/useAuth': { useAuth: () => ({ accessToken: 'cookie-session', isAuthenticated: true, ready: true }) },
  '@/hooks/useReservation': { useReservation: () => reservation },
  '@/contexts/LanguageContext': { useTranslation: () => ({ t: key => key, formatPrice: value => `${value} VND` }) },
};
const originalLoad = Module._load;
Module._load = function(id, parent, main) {
  if (mocks[id]) return mocks[id];
  return originalLoad.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, parent, main);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => {
  let source = fs.readFileSync(filename, 'utf8');
  if (filename.endsWith('BookingHistory.tsx')) source += '\nexport { BookingCard };';
  if (filename.endsWith('AdminBookingsManager.tsx')) source += '\nexport { BookingActions, StatusBadge };';
  module._compile(compile(source, filename), filename);
};
const { CheckoutForm } = requireFrontend('./src/components/features/booking/CheckoutForm.tsx');
const { BookingCard } = requireFrontend('./src/components/features/booking/BookingHistory.tsx');
const { BookingActions, StatusBadge } = requireFrontend('./src/components/features/admin/AdminBookingsManager.tsx');
const quote = { quote_id: 'quote-1', room_type: { type_id: 1, type_name: 'Real Room', capacity: 2, base_price: 1000000 }, check_in_date: '2026-10-01', check_out_date: '2026-10-02', guest_count: 1, rooms_available: 1, nights: 1, nightly_price: 1000000, total_price: 1000000, ai_multiplier: 1, pricing_source: 'base', price_guaranteed_until: '2026-10-01T12:00:00Z' };
const props = { roomTypes: [{...quote.room_type, total_rooms: 2, available_now: 1}], businessDate: '2026-10-01', initialRoomTypeId: 1, initialCheckInDate: '2026-10-01', initialCheckOutDate: '2026-10-02', initialGuestCount: 1, initialRequests: 0, initialSearchId: 'search-1' };
const result = { booking: { booking_id: 'booking-1', status: 'Pending', deposit_required: 300000, pending_expires_at: '2026-10-01T10:00:00Z', checkout_payment_required: true }, room_number: '101', total_price: 1000000, paid_amount: 0, balance_due: 1000000, payment_status: 'Unpaid' };
const baseReservation = { quote, loading: false, quoteError: '', error: '', result: null, expired: false, submitting: false, retryOnly: false, confirm: async () => {}, changeSelection: () => {}, refreshQuote: () => {} };
const labels = { Pending: 'Chờ đặt cọc', Confirmed: 'Đã xác nhận', CheckedIn: 'Đang lưu trú', Completed: 'Đã hoàn tất', Canceled: 'Đã hủy', Expired: 'Hết hạn giữ phòng', NoShow: 'Không đến nhận phòng' };
const check = (value, message) => { assert.ok(value, message); checks += 1; };
let checks = 0;
for (const [status, label] of Object.entries(labels)) {
  reservation = {...baseReservation, result: {...result, booking: {...result.booking, status}}};
  const html = renderToStaticMarkup(React.createElement(CheckoutForm, props));
  check(html.includes(label), `${status} receipt label`);
  check(!html.includes('Tạo đặt phòng'), `${status} cannot submit another reservation`);
  check(!/Stripe|GPay|Private Pool|Butler|checkout_service_fee|checkout_pay_now|giữ nguyên tử/.test(html), 'No unsupported transaction claims');
  check(/<select[^>]*disabled/.test(html), 'Receipt selection remains locked');
  if (status === 'Pending') {
    const deadline = new Intl.DateTimeFormat('vi-VN', {dateStyle:'short', timeStyle:'short', timeZone:'Asia/Bangkok'}).format(new Date(result.booking.pending_expires_at));
    check(html.includes('300000 VND') && html.includes(deadline), 'Hotel timezone/deposit deadline');
  }
  if (['Canceled', 'Expired', 'NoShow'].includes(status)) check(html.includes('không còn giữ phòng'), 'Terminal result does not claim inventory');
  check(renderToStaticMarkup(React.createElement(StatusBadge, {status})).includes(label), `${status} admin badge`);
}
reservation = {...baseReservation, expired: true};
let html = renderToStaticMarkup(React.createElement(CheckoutForm, props));
check(/<button[^>]*type="submit"[^>]* disabled=""/.test(html), 'Expired quote cannot create');
check(html.includes('lấy báo giá mới'), 'Expired quote refresh action');
reservation = {...baseReservation, expired: true, retryOnly: true};
html = renderToStaticMarkup(React.createElement(CheckoutForm, props));
check(/<button[^>]*type="submit"(?![^>]* disabled="")[^>]*>/.test(html), 'Ambiguous creation can replay after quote expiry');
check(html.includes('Kiểm tra lại yêu cầu đặt phòng') && !html.includes('lấy báo giá mới'), 'Retry uses existing request');
check(/<select[^>]*disabled/.test(html), 'Ambiguous retry freezes selections');
reservation = {...baseReservation, submitting:true};
html = renderToStaticMarkup(React.createElement(CheckoutForm, props));
check(/<button[^>]*type="submit"[^>]* disabled=""/.test(html) && /<select[^>]* disabled=""/.test(html), 'Busy booking locks confirmation and edits');
reservation = baseReservation;
html = renderToStaticMarkup(React.createElement(CheckoutForm, props));
check(html.includes('Giá cơ sở') && !html.includes('Điều chỉnh AI:'), 'Base quote does not imply AI');
const booking = { ...result.booking, check_in_date: '2026-10-01', check_out_date: '2026-10-02', created_at: '2026-09-30T01:00:00Z', status: 'Confirmed', booking_id: 'booking-1', room_number: '101', room_type: 'Real Room', nightly_price: 1000000, nights: 1, total_price: 1000000, paid_amount: 0, net_paid: 0, balance_due: 1000000, refunded_amount: 0, refund_due: 0, payment_status: 'Unpaid', can_cancel: false };
const cardProps = { booking, cancelling: false, actionDisabled: false, paymentOpen: false, paymentLoading: false, paymentError: '', paymentSummary: null, onCancel() {}, onTogglePayment() {} };
check(!renderToStaticMarkup(React.createElement(BookingCard, cardProps)).includes('Hủy đặt phòng'), 'Trust can_cancel=false even for future Confirmed');
check(renderToStaticMarkup(React.createElement(BookingCard, {...cardProps, booking: {...booking, status: 'Pending', can_cancel: true}})).includes('Hủy đặt phòng'), 'Pending cancellation allowed by API');
const admin = {...booking, customer_name: 'Test', can_check_in: false, can_check_out: false, can_mark_no_show: true};
const actions = b => renderToStaticMarkup(React.createElement(BookingActions, {booking:b, pending:false, onAction() {}, onPayment() {}, onRefundLookup() {}}));
check(actions(admin).includes('Không đến'), 'No-show offered by server eligibility');
check(!actions({...admin, can_mark_no_show:false}).includes('Không đến'), 'No-show hidden without eligibility');
check(!actions({...admin, status:'Expired', can_mark_no_show:false, balance_due:0, refund_due:100}).includes('Thu tiền'), 'Terminal booking cannot collect payment');
check(actions({...admin, status:'Expired', can_mark_no_show:false, balance_due:0, refund_due:100}).includes('Hoàn tiền'), 'Terminal refundable booking shows refund path');

async function serviceChecks() {
  const calls = [];
  global.fetch = async (url, init) => { calls.push({url, init}); return new Response(JSON.stringify({status:'success', data:{replayed:false, booking:{status:'NoShow', lifecycle_version:4}}}), {status:200, headers:{'Content-Type':'application/json'}}); };
  const { markAdminBookingNoShow } = requireFrontend('./src/services/admin.service.ts');
  await markAdminBookingNoShow('cookie-session', 'booking-1', {expected_version:3, reason:'Guest did not arrive'}, 'stable-no-show-key');
  await markAdminBookingNoShow('cookie-session', 'booking-1', {expected_version:3, reason:'Guest did not arrive'}, 'stable-no-show-key');
  check(calls[0].url.endsWith('/admin/bookings/booking-1/no-show'), 'No-show endpoint');
  check(calls[0].init.method === 'POST', 'No-show method');
  check(calls[0].init.headers.get('Idempotency-Key') === 'stable-no-show-key', 'No-show header key');
  check(calls[0].init.body === JSON.stringify({expected_version:3, reason:'Guest did not arrive'}), 'No-show lifecycle version and audit reason');
  check(calls[0].init.credentials === 'include', 'No-show authenticated cookie');
  check(calls[1].init.headers.get('Idempotency-Key') === calls[0].init.headers.get('Idempotency-Key'), 'No-show retry retains key');
}

async function historyChecks() {
  // Minimal hook scheduler drives the real hook with out-of-order HTTP completion.
  const values = [];
  let cursor = 0;
  let effects = [];
  const reactHooks = {
    useState(initial) { const index = cursor++; if (!(index in values)) values[index] = initial; return [values[index], value => {values[index] = typeof value === 'function' ? value(values[index]) : value;}]; },
    useRef(initial) { const index = cursor++; return values[index] ??= {current:initial}; },
    useCallback(callback) { return callback; },
    useEffect(effect) { effects.push(effect); },
  };
  const requests = [];
  const canceled = {...booking, status:'Canceled', can_cancel:false, net_paid:100, balance_due:0, refund_due:100, payment_status:'RefundPending'};
  class BookingServiceError extends Error { constructor(message, status) { super(message); this.status=status; } }
  const bookingService = { BookingServiceError,
    getBookings: () => new Promise((resolve, reject) => requests.push(Object.assign(resolve, { reject }))),
    cancelBooking: async () => canceled };
  const file = path.join(root, 'src/hooks/useBookingHistory.ts');
  const hookModule = new Module(file, module);
  hookModule.filename = file;
  hookModule.require = id => id === 'react' ? reactHooks : id === '@/services/booking.service' ? bookingService : requireFrontend(id);
  hookModule._compile(compile(fs.readFileSync(file,'utf8'), file), file);
  const options = {accessToken:'cookie-session', enabled:true, onUnauthorized() {}};
  const render = () => {cursor=0;effects=[];return hookModule.exports.useBookingHistory(options);};
  let hook = render();
  const cleanup = effects.at(-1)(); // Starts foreground history request.
  hook = render();
  check(hook.loading, 'Foreground history starts loading');
  const refresh = hook.reload(false); // Focus refresh supersedes foreground request.
  requests[1]([booking]);
  await refresh;
  hook = render();
  check(!hook.loading && hook.bookings[0].booking_id === booking.booking_id, 'Silent refresh finishes foreground loading');
  requests[0]([{...booking, booking_id:'stale'}]);
  await new Promise(resolve => setImmediate(resolve));
  check(render().bookings[0].booking_id === booking.booking_id, 'Older response cannot overwrite fresh history');
  const cancellation = render().cancel(booking.booking_id);
  await new Promise(resolve => setImmediate(resolve));
  hook = render();
  check(hook.bookings[0].refund_due === 100 && hook.bookings[0].payment_status === 'RefundPending' && !hook.bookings[0].can_cancel, 'Cancellation immediately uses authoritative ledger and eligibility');
  requests[2]([canceled]);
  check(await cancellation, 'Cancellation completes after refresh');
  const unmountedLoad = render().reload(false);
  cleanup();
  requests[3]([{...booking, booking_id:'after-unmount'}]);
  await unmountedLoad;
  check(render().bookings[0].status === 'Canceled', 'Unmount invalidates background responses');

  const offline = render().reload(false);
  requests.at(-1).reject(new TypeError('Failed to fetch'));
  await offline;
  hook = render();
  check(hook.loadFailed && !hook.refreshing && !hook.loading, 'Network failure exposes a finished retryable state');
  check(hook.bookings[0].status === 'Canceled', 'Refresh failure preserves the last confirmed booking');
  check(hook.error.includes('Không thể tải lịch sử đặt phòng') && !hook.error.includes('Failed to fetch'), 'Network exception becomes useful Vietnamese guidance');
  const retry = hook.reload(false);
  hook = render();
  check(hook.refreshing && hook.loadFailed && !!hook.error, 'Warning stays visible while retry has not succeeded');
  requests.at(-1)([{...canceled, room_number:'102'}]);
  await retry;
  hook = render();
  check(!hook.refreshing && !hook.loadFailed && !hook.error && hook.bookings[0].room_number === '102', 'Successful retry replaces cached data and clears the stale warning');
  const unavailable = hook.reload(false);
  requests.at(-1).reject(new BookingServiceError('upstream internal detail', 503));
  await unavailable;
  check(!render().error.includes('upstream internal detail'), 'Server outages do not expose infrastructure details');
  bookingService.cancelBooking = async () => { throw new TypeError('Failed to fetch'); };
  check(!(await render().cancel(booking.booking_id)), 'Ambiguous cancellation does not claim success');
  hook = render();
  check(hook.error.includes('Chưa xác nhận được kết quả hủy') && !hook.actionMessage && !hook.cancellingId, 'Ambiguous cancellation offers state lookup and releases busy state');
}

(async () => {
  await serviceChecks();
  await historyChecks();
  console.log('PASS (unit, mocked APIs): seven receipt/admin states; deposit deadline; terminal inventory messaging; expired/ambiguous retry controls; server eligibility; no-show version/key/cookie; history races and cancellation ledger.');
})().catch(error => { console.error(error); process.exitCode = 1; });
