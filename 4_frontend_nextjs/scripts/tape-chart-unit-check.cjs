// Exercise the actual component's filters and out-of-order requests, without HTTP or a browser.
// Run: node scripts/tape-chart-unit-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree)
  ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.actions)];
const textOf = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree)
  ? tree.map(textOf).join(' ') : typeof tree === 'object' ? textOf(tree.props?.children) : String(tree);
const named = (tree, name) => nodes(tree).find(node => node.props?.['aria-label'] === name);
const button = (tree, label) => nodes(tree).find(node => ['button', 'Button'].includes(node.type) && textOf(node).trim() === label);
const options = element => nodes(element).filter(node => node.type === 'option').map(node => node.props.value);
const rowNumbers = tree => {
  const body = nodes(tree).find(node => node.type === 'tbody');
  return nodes(body).filter(node => node.type === 'tr').map(row => textOf(row).trim().split(' ')[0]);
};

function fixture(startDate = '2026-09-23', marker = 'Guest newest') {
  const room = (id, number, floor, type, status = 'Available') => ({
    roomId: id, roomNumber: number, floor, roomTypeId: type, roomTypeName: type === 1 ? 'Deluxe' : 'Family',
    basePrice: 1200000, currentStatus: status, housekeepingStatus: status === 'Occupied' ? 'Dirty' : 'Ready',
    housekeepingVersion: 1, occupancyBookingId: status === 'Occupied' ? 'test-booking' : null,
    slots: { [startDate]: status === 'Occupied' ? {
      bookingId: 'test-booking', customerName: marker, customerPhone: '', customerEmail: 'guest@example.invalid',
      status: 'CheckedIn', checkInDate: startDate, checkOutDate: '2026-12-31', nights: 2,
      appliedPrice: 1200000, isStart: true, isEnd: false, canCheckIn: false, canCheckOut: true,
    } : null },
  });
  return {
    businessDate: '2026-09-23', startDate, endDate: startDate, days: 14,
    timeline: [{ date: startDate, dayOfWeek: 'T4', isToday: startDate === '2026-09-23', isWeekend: false }],
    metrics: { totalRooms: 3, occupiedRoomsToday: 1, occupancyRateToday: 33, readyRooms: 2,
      dirtyRooms: 1, cleaningRooms: 0, maintenanceRooms: 0, arrivalsToday: 999, departuresToday: 888 },
    rooms: [room(1, '101', 1, 1), room(2, '102', 1, 2, 'Occupied'), room(3, '201', 2, 2)],
  };
}

function setup() {
  const slots = [], requests = [];
  let cursor = 0, dirty = false, effects = [], writes = 0;
  const equal = (a, b) => a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        writes++;
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useRef(initial) { return (slots[cursor++] ??= { value: { current: initial } }).value; },
    useMemo(calculate, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, value: calculate() };
      return slots[index].value;
    },
    useCallback(callback, deps) { return react.useMemo(() => callback, deps); },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!equal(slots[index]?.deps, deps)) effects.push({ index, effect, deps });
    },
  };
  const mocks = {
    react,
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/components/common/PageContainer': { PageContainer: 'PageContainer' },
    '@/components/common/PageHeader': { PageHeader: 'PageHeader' },
    '@/components/ui': new Proxy({}, { get: (_, name) => name }),
    '@/hooks/useAuth': { useAuth: () => ({ session: { accessToken: 'synthetic-test-token' } }) },
    '@/utils/formatCurrency': { formatCurrency: String },
    '@/services/admin.service': {
      getAdminTapeChart(token, params) { const request = { ...deferred(), token, params }; requests.push(request); return request.promise; },
    },
  };
  const filename = path.join(root, 'src/components/features/admin/AdminTapeChart.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : requireFrontend(id);
  loaded._compile(swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022',
      transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  }).code, filename);
  const env = {
    requests,
    render() {
      for (let attempt = 0; ; attempt++) {
        assert.ok(attempt < 20, 'Component effects converge');
        cursor = 0; dirty = false; effects = [];
        const tree = loaded.exports.AdminTapeChart();
        for (const { index, effect, deps } of effects) {
          slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
        }
        if (!dirty) return tree;
      }
    },
    change(name, value) { named(env.render(), name).props.onChange({ target: { value } }); return env.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get writes() { return writes; },
  };
  env.render();
  return env;
}

async function filters() {
  const env = setup();
  assert.deepEqual(env.requests[0].params, { days: 14 }, 'Initial fetch must include every room type/floor');
  env.requests[0].resolve(fixture()); await flush();
  let tree = env.render();
  assert.deepEqual(rowNumbers(tree), ['101', '102', '201']);
  const assertOptions = tree => {
    assert.deepEqual(options(named(tree, 'Lọc theo hạng phòng')), ['all', '1', '2']);
    assert.deepEqual(options(named(tree, 'Lọc theo tầng')), ['all', '1', '2']);
  };
  assertOptions(tree);
  tree = env.change('Lọc theo hạng phòng', '1');
  assert.deepEqual(rowNumbers(tree), ['101']); assertOptions(tree);
  tree = env.change('Lọc theo tầng', '2');
  assert.deepEqual(rowNumbers(tree), []); assertOptions(tree);
  assert.match(textOf(tree), /Không có phòng nào phù hợp/);
  assert.match(textOf(tree), /Hiển thị\s+0\s*\/\s*3\s+phòng/);
  tree = env.change('Lọc theo hạng phòng', '2');
  assert.deepEqual(rowNumbers(tree), ['201'], 'Switch directly out of an empty combined filter'); assertOptions(tree);
  tree = env.change('Lọc theo tầng', '1');
  assert.deepEqual(rowNumbers(tree), ['102'], 'Switch directly between floors'); assertOptions(tree);
  tree = env.change('Lọc theo trạng thái phòng', 'available');
  assert.deepEqual(rowNumbers(tree), []); assertOptions(tree);
  env.change('Lọc theo trạng thái phòng', 'occupied');
  tree = env.change('Tìm phòng hoặc khách', '  guest NEWEST  ');
  assert.deepEqual(rowNumbers(tree), ['102'], 'Text search composes with all filters and trims whitespace');
  assert.equal(env.requests.length, 1, 'Local filters must not shrink the server inventory or trigger requests');
  const metricText = textOf(named(tree, 'Tình trạng hiện tại toàn khách sạn'));
  assert.match(metricText, /toàn khách sạn, không thay đổi theo bộ lọc/);
  assert.match(metricText, /Tổng phòng\s+3\s+2\s+hạng phòng/);
  assert.doesNotMatch(metricText, /999|888|Khách đến|Khách đi/, 'Window-derived arrivals/departures cannot be presented as daily totals');
  assert.doesNotMatch(nodes(tree).find(node => node.type === 'PageHeader').props.description, /98|resort/);
  env.unmount();
}

async function requestRaces() {
  const env = setup();
  env.requests[0].resolve(fixture()); await flush(); env.render();
  env.change('Ngày bắt đầu lịch', '2026-10-01');
  env.change('Ngày bắt đầu lịch', '2026-11-01');
  assert.deepEqual(env.requests[2].params, { days: 14, startDate: '2026-11-01' });
  env.requests[1].resolve(fixture('2026-10-01', 'Obsolete guest')); await flush();
  assert.equal(nodes(env.render()).some(node => node.type === 'table'), false, 'A stale response must not dismiss the latest loading state');
  env.requests[2].resolve(fixture('2026-11-01', 'November guest')); await flush();
  assert.match(textOf(env.render()), /November guest/);
  env.change('Ngày bắt đầu lịch', '2026-12-01');
  env.change('Ngày bắt đầu lịch', '2026-12-08');
  env.requests[4].resolve(fixture('2026-12-08', 'December guest')); await flush();
  env.requests[3].reject(new Error('Obsolete failure')); await flush();
  const newest = env.render();
  assert.match(textOf(newest), /December guest/);
  assert.doesNotMatch(textOf(newest), /Obsolete failure/);
  env.change('Ngày bắt đầu lịch', '2026-12-15');
  env.change('Ngày bắt đầu lịch', '2026-12-22');
  env.requests[6].resolve(fixture('2026-12-22', 'Latest guest')); await flush(); env.render();
  env.requests[5].resolve(fixture('2026-12-15', 'Late obsolete guest')); await flush();
  assert.match(textOf(env.render()), /Latest guest/);
  assert.doesNotMatch(textOf(env.render()), /Late obsolete guest/, 'Late successful replies cannot overwrite the chosen window');
  button(env.render(), 'Làm mới dữ liệu').props.onClick();
  const request = env.requests.at(-1);
  env.unmount();
  const writes = env.writes;
  request.resolve(fixture('2026-12-08', 'Disposed guest')); await flush();
  assert.equal(env.writes, writes, 'Disposed requests cannot update state');
}

(async () => {
  await filters(); await requestRaces();
  console.log('PASS: persistent room/floor options, direct recovery from empty combined filters, composed local search/status, property-wide metrics, stale success/error/loading guards, and unmount isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
