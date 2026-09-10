// Pure URL security and inline reauthentication checks; no browser or API calls.
// Run after npm ci: node scripts/auth-recovery-unit-check.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');

function load(relative, imports = {}) {
  const filename = path.join(root, relative);
  const compiled = swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') },
      target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  }).code;
  const result = { exports: {} };
  const guardedRequire = name => {
    if (name in imports) return imports[name];
    if (name === 'next/navigation' || name === 'next/link') throw new Error('Recovery must not navigate.');
    return requireFrontend(name);
  };
  new Function('require', 'module', 'exports', compiled)(guardedRequire, result, result.exports);
  return result.exports;
}

function redirectChecks() {
  const { safeAuthDestination } = load('src/utils/authDestination.ts');
  const origin = 'https://hotel.example';
  const booking = '/book?room_type_id=2&check_in_date=2026-10-01#review';
  assert.equal(safeAuthDestination(booking, origin), booking);
  assert.equal(safeAuthDestination('/rooms/../book?guests=2', origin), '/book?guests=2');
  assert.equal(safeAuthDestination('/rooms/%E6%97%A5%E6%9C%AC?next=%2Fbook', origin), '/rooms/%E6%97%A5%E6%9C%AC?next=%2Fbook');
  const attacks = [null, '', 'book', 'https://evil.example', 'javascript:alert(1)',
    '//evil.example', '///evil.example', '/\\evil.example', '/\\/evil.example',
    '/\t/evil.example', '/\n/evil.example', '/\r/evil.example', '/book\0', '/book\x7f',
    '/safe/..//evil.example', '/safe/../\\evil.example'];
  for (const candidate of attacks) {
    const destination = safeAuthDestination(candidate, origin);
    assert.equal(destination, '/', `Reject ${JSON.stringify(candidate)}`);
    assert.equal(new URL(destination, origin).origin, origin);
  }
  // Match the browser's decoding of a crafted login query parameter.
  for (const encoded of ['%2F%5Cevil.example', '%2F%09%2Fevil.example', '%2F%0A%2Fevil.example']) {
    assert.equal(safeAuthDestination(new URLSearchParams(`next=${encoded}`).get('next'), origin), '/');
  }
  assert.equal(safeAuthDestination('/book', 'invalid origin'), '/');
}

async function recoveryFormChecks() {
  const state = [];
  let cursor = 0, calls = [], loginResponse, resets = 0;
  let currentUser = null;
  const account = { id: 'guest-original', email: 'original@example.test' };
  const react = {
    useRef(initial) { const index = cursor++; return state[index] ??= { current: initial }; },
    useState(initial) { const index = cursor++; if (!(index in state)) state[index] = initial;
      return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }]; },
  };
  const { ReservationRecoverySignIn } = load('src/components/features/auth/ReservationRecoverySignIn.tsx', {
    react,
    '@/hooks/useAuth': { useAuth: () => ({ ready: true, user: currentUser,
      login: input => { calls.push(input); return loginResponse; } }) },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
  });
  const render = () => { cursor = 0; return ReservationRecoverySignIn({ account }); };
  const find = (node, predicate) => {
    if (!node || typeof node !== 'object') return null;
    if (predicate(node)) return node;
    return [node.props?.children].flat(Infinity).map(child => find(child, predicate)).find(Boolean) ?? null;
  };
  const previousFormData = global.FormData;
  global.FormData = class { get(key) { return key === 'password' ? 'test-password-only' : 'different@example.test'; } };
  try {
    let resolveLogin;
    loginResponse = new Promise(resolve => { resolveLogin = resolve; });
    const first = render();
    assert.equal(find(first, n => n.props?.name === 'email').props.readOnly, true);
    const event = { preventDefault() {}, currentTarget: { reset() { resets++; } } };
    const submitting = first.props.onSubmit(event);
    await first.props.onSubmit(event);
    assert.equal(calls.length, 1, 'Coalesce repeated submit while login is pending');
    assert.deepEqual(calls[0], { email: account.email, password: 'test-password-only' }, 'Use captured account email, not submitted email');
    assert.equal(find(render(), n => n.props?.type === 'submit').props.disabled, true);
    resolveLogin({ user: account });
    await submitting;
    assert.equal(resets, 1, 'Clear password after sign-in');
    assert.equal(find(render(), n => n.props?.role === 'alert'), null);

    currentUser = { id: 'other-guest', email: 'other@example.test' };
    loginResponse = Promise.resolve({ user: currentUser });
    await render().props.onSubmit(event);
    assert.match(find(render(), n => n.props?.role === 'alert').props.children, /does not match/);
    loginResponse = Promise.reject(new Error('Credentials rejected'));
    await render().props.onSubmit(event);
    assert.match(find(render(), n => n.props?.role === 'alert').props.children, /Credentials rejected/);
    loginResponse = Promise.resolve({ user: account });
    await render().props.onSubmit(event);
    assert.equal(find(render(), n => n.props?.role === 'alert'), null, 'Retry clears earlier error');
  } finally { global.FormData = previousFormData; }
}

(async () => {
  redirectChecks();
  await recoveryFormChecks();
  console.log('PASS (unit, no live APIs): same-origin post-auth redirects, backslash/control/normalization attacks, inline account-locked recovery sign-in, duplicate-submit guard, errors and retry, no router navigation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
