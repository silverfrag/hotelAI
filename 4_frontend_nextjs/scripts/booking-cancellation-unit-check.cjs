// Exercise the real history/card confirmation UI with an isolated hook fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');
let current;
const react = {
  useState(initial) {
    const owner = current, index = owner.cursor++;
    if (!(index in owner.slots)) owner.slots[index] = initial;
    return [owner.slots[index], value => { owner.slots[index] = value; }];
  },
  useRef(initial) { return react.useState({ current: initial })[0]; },
  useEffect() {},
};
function mount(component) {
  const owner = { slots: [], cursor: 0 };
  return () => { current = owner; owner.cursor = 0; return component(); };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(text).join('');
  return typeof tree === 'object' ? text(tree.props?.children) : String(tree);
}
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label);
const booking = {
  booking_id: 'test-booking', room_number: '101', room_type: 'Test Room', status: 'Confirmed',
  check_in_date: '2026-11-12', check_out_date: '2026-11-14', nights: 2, nightly_price: 100000,
  total_price: 200000, payment_status: 'Unpaid', paid_amount: 0, net_paid: 0,
  balance_due: 200000, refunded_amount: 0, refund_due: 0, can_cancel: true,
  created_at: '2026-09-17T00:00:00Z',
};
const canceledIds = [];
const reloadCalls = [];
let historyState = { bookings: [booking], loading: false, refreshing: false, loadFailed: false,
  error: '', actionMessage: '', cancellingId: null,
  reload: async showLoading => { reloadCalls.push(showLoading); },
  cancel: async id => { canceledIds.push(id); return true; } };
const mocks = {
  react, 'next/link': 'a',
  'lucide-react': new Proxy({}, { get: (_, key) => key }),
  '@/hooks/useAuth': { useAuth: () => ({ accessToken: 'fixture', ready: true, isAuthenticated: true }) },
  '@/hooks/useBookingHistory': { useBookingHistory: () => historyState },
  '@/services/booking.service': {}, '@/utils/formatCurrency': { formatCurrency: String },
};
const filename = path.join(root, 'src/components/features/booking/BookingHistory.tsx');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : requireFrontend(id);
loaded._compile(swc.transformSync(fs.readFileSync(filename, 'utf8'), {
  filename, jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022',
    transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
}).code, filename);
global.window = { confirm() { throw new Error('Blocking browser dialogs must not be used'); } };
const renderHistory = mount(() => loaded.exports.BookingHistory());
const card = nodes(renderHistory()).find(node => node.props?.booking?.booking_id === booking.booking_id);
assert.ok(card, 'History renders the actual fixture booking');
let props = card.props;
const renderCard = mount(() => card.type(props));
button(renderCard(), 'Hủy đặt phòng').props.onClick();
assert.equal(canceledIds.length, 0, 'Opening confirmation cannot cancel');
assert.match(text(renderCard()), /12\/11\/2026.*14\/11\/2026/);
button(renderCard(), 'Giữ đặt phòng').props.onClick();
assert.equal(button(renderCard(), 'Xác nhận hủy'), undefined);
assert.equal(canceledIds.length, 0, 'Keeping a booking cannot call cancellation');
button(renderCard(), 'Hủy đặt phòng').props.onClick();
button(renderCard(), 'Xác nhận hủy').props.onClick();
assert.deepEqual(canceledIds, ['test-booking'], 'Only explicit confirmation calls the selected booking');
props = { ...props, cancelling: true, actionDisabled: true };
assert.equal(button(renderCard(), 'Đang hủy…').props.disabled, true);
assert.equal(button(renderCard(), 'Giữ đặt phòng').props.disabled, true);
props = { ...props, cancelling: false, actionDisabled: false };
assert.equal(button(renderCard(), 'Xác nhận hủy').props.disabled, false, 'Failed cancellation can be retried');
props = { ...props, booking: { ...booking, can_cancel: false, status: 'Canceled' } };
assert.equal(button(renderCard(), 'Xác nhận hủy'), undefined, 'Terminal booking cannot be canceled again');
assert.equal(button(renderCard(), 'Hủy đặt phòng'), undefined);
historyState = {...historyState, error: 'Không thể tải lịch sử đặt phòng.', loadFailed: true, actionMessage:'Old success'};
let history = renderHistory();
assert.match(text(history), /dữ liệu đã tải trước đó/);
assert.ok(!text(history).includes('Old success'), 'Stale success cannot compete with the current error');
assert.ok(nodes(history).some(node => node.props?.booking === booking), 'Retry UI preserves cached bookings');
button(history, 'Thử tải lại').props.onClick();
assert.deepEqual(reloadCalls, [false], 'Retry keeps cached bookings visible');
historyState = {...historyState, refreshing:true};
assert.equal(button(renderHistory(), 'Đang tải lại…').props.disabled, true);
historyState = {...historyState, refreshing:false, error:'', loadFailed:false, actionMessage:''};
history = renderHistory();
assert.equal(button(history, 'Thử tải lại'), undefined);
assert.ok(!text(history).includes('dữ liệu đã tải trước đó'));
console.log('PASS booking cancellation and recovery: review, keep, confirm, pending, terminal state; cached-data warning, retry and recovery');
