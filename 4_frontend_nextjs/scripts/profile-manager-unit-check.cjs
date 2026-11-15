// Controlled component request races; no browser or live HTTP requests.
// Run: node scripts/profile-manager-unit-check.cjs
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
const profileFor = (id = 'guest-a', version = 1, full_name = 'Original guest') => ({
  id, version, full_name, email: `${id}@example.invalid`, phone: null, nationality: null,
  role: 'customer', account_status: 'Active', loyalty_tier: 'Bronze', loyalty_points: 0,
  total_stays: 0, total_spent: 0, created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
});

let currentRunner;
const react = Object.fromEntries(['useState', 'useRef', 'useCallback', 'useEffect'].map(name =>
  [name, (...args) => currentRunner.hooks[name](...args)]));
function runner(renderComponent) {
  const slots = [];
  let cursor = 0, effects = [], dirty = false, output, writes = 0;
  const equalDeps = (a, b) => !!a && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const instance = {
    hooks: {
      useState(initial) {
        const index = cursor++;
        if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
        return [slots[index].value, value => {
          writes++;
          const next = typeof value === 'function' ? value(slots[index].value) : value;
          if (!Object.is(slots[index].value, next)) { slots[index].value = next; dirty = true; }
        }];
      },
      useRef(initial) { const index = cursor++; return (slots[index] ??= { value: { current: initial } }).value; },
      useCallback(callback, deps) {
        const index = cursor++;
        if (!equalDeps(slots[index]?.deps, deps)) slots[index] = { deps, value: callback };
        return slots[index].value;
      },
      useEffect(effect, deps) {
        const index = cursor++;
        if (!equalDeps(slots[index]?.deps, deps)) effects.push({ index, effect, deps });
      },
    },
    settle() {
      for (let attempt = 0; ; attempt++) {
        assert.ok(attempt < 20, 'Effects converge');
        currentRunner = instance; cursor = 0; effects = []; dirty = false;
        output = renderComponent();
        for (const { index, effect, deps } of effects) {
          slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: effect() };
        }
        if (!dirty) return output;
      }
    },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
    get writes() { return writes; },
  };
  return instance;
}
function elements(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return [tree, ...elements(tree.props?.children)];
}
function textContent(tree) {
  if (tree == null || typeof tree === 'boolean') return '';
  if (Array.isArray(tree)) return tree.map(textContent).join(' ');
  if (typeof tree === 'object') return textContent(tree.props?.children);
  return String(tree);
}
const formIn = tree => elements(tree).find(node => node.type === 'form');
const fullNameIn = tree => elements(tree).find(node => node.props?.name === 'full_name').props.defaultValue;
class AccountApiError extends Error { constructor(message, status) { super(message); this.status = status; } }

function setup() {
  const loads = [], saves = [], refreshes = [], redirects = [];
  const router = { replace: target => redirects.push(target) };
  const auth = {
    ready: true, user: profileFor(), invalidateSession() {},
    refreshSession() { const request = deferred(); refreshes.push(request); return request.promise; },
  };
  const mocks = {
    react, 'next/navigation': { useRouter: () => router }, 'next/link': 'a',
    'lucide-react': new Proxy({}, { get: (_, key) => key }),
    '@/hooks/useAuth': { useAuth: () => auth },
    '@/contexts/LanguageContext': { useTranslation: () => ({ formatPrice: String }) },
    '@/services/user.service': {
      AccountApiError,
      getOwnProfile(signal) { const request = { ...deferred(), signal }; loads.push(request); return request.promise; },
      updateOwnProfile(input) { const request = { ...deferred(), input }; saves.push(request); return request.promise; },
    },
  };
  const filename = path.join(root, 'src/components/features/account/ProfileManager.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : requireFrontend(id);
  loaded._compile(swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code, filename);
  const boundary = runner(() => loaded.exports.ProfileManager());
  const editorElement = boundary.settle();
  const editor = runner(() => editorElement.type(editorElement.props));
  editor.settle();
  return { auth, boundary, editor, loads, saves, refreshes, redirects };
}
const submitEvent = { preventDefault() {}, currentTarget: { values: { full_name: ' Saved guest ', phone: '', nationality: '' } } };

async function ownerAndLoadChecks() {
  const env = setup();
  assert.equal(env.boundary.settle().key, 'guest-a');
  env.loads[0].resolve(profileFor()); await flush(); env.editor.settle();
  env.auth.user = { ...env.auth.user, full_name: 'Session name changed', version: 2 };
  assert.equal(env.boundary.settle().key, 'guest-a'); env.editor.settle();
  assert.equal(env.loads.length, 1, 'Same-account refresh must not reload or unmount forms');
  env.auth.user = profileFor('guest-b');
  const nextElement = env.boundary.settle();
  assert.equal(nextElement.key, 'guest-b', 'Account change creates an isolated editor before effects');
  env.editor.unmount();
  const nextEditor = runner(() => nextElement.type(nextElement.props)); nextEditor.settle();
  env.loads[1].resolve(profileFor('guest-b', 1, 'Guest B')); await flush();
  assert.equal(fullNameIn(nextEditor.settle()), 'Guest B');
  nextEditor.unmount(); env.boundary.unmount();

  const disposed = setup();
  disposed.editor.unmount();
  assert.equal(disposed.loads[0].signal.aborted, true);
  const before = disposed.editor.writes;
  disposed.loads[0].resolve(profileFor()); await flush();
  assert.equal(disposed.editor.writes, before, 'A disposed load cannot write state');
  disposed.boundary.unmount();

  const retry = setup();
  retry.loads[0].reject(new Error('Temporary outage')); await flush();
  const retryButton = elements(retry.editor.settle()).find(node => node.type === 'button');
  retryButton.props.onClick(); retryButton.props.onClick();
  assert.equal(retry.loads[1].signal.aborted, true);
  retry.loads[2].resolve(profileFor('guest-a', 3, 'Newest guest')); await flush(); retry.editor.settle();
  retry.loads[1].resolve(profileFor('guest-a', 2, 'Stale guest')); await flush();
  assert.equal(fullNameIn(retry.editor.settle()), 'Newest guest', 'Late superseded results cannot replace the latest profile');
  retry.editor.unmount(); retry.boundary.unmount();
}

async function saveChecks() {
  const env = setup();
  env.loads[0].resolve(profileFor()); await flush();
  const form = formIn(env.editor.settle());
  const saving = form.props.onSubmit(submitEvent);
  await form.props.onSubmit(submitEvent);
  assert.equal(env.saves.length, 1, 'Rapid duplicate submissions share one mutation');
  assert.deepEqual(env.saves[0].input, { full_name: 'Saved guest', phone: null, nationality: null, expected_version: 1 });
  env.saves[0].resolve(profileFor('guest-a', 2, 'Saved guest')); await flush();
  assert.match(textContent(env.editor.settle()), /Hồ sơ đã được cập nhật thành công/);
  env.refreshes[0].reject(new Error('Auth endpoint unavailable')); await saving;
  const savedTree = env.editor.settle();
  assert.equal(fullNameIn(savedTree), 'Saved guest');
  assert.equal(formIn(savedTree).key, '2', 'The form adopts canonical server values after the version changes');
  assert.match(textContent(savedTree), /Hồ sơ đã được cập nhật thành công/);
  assert.match(textContent(savedTree), /Chưa thể đồng bộ/);
  assert.equal(elements(savedTree).some(node => node.props?.role === 'alert'), false, 'A successful PATCH is not reported as a failed save');
  assert.equal(env.loads.length, 1, 'Saved profile does not require a redundant GET');

  const retrySave = formIn(savedTree).props.onSubmit(submitEvent);
  env.saves[1].reject(new AccountApiError('Version conflict', 409)); await retrySave;
  assert.equal(env.loads.length, 2, 'Version conflicts reload server state');
  env.loads[1].resolve(profileFor('guest-a', 3, 'Concurrent edit')); await flush();
  assert.equal(fullNameIn(env.editor.settle()), 'Concurrent edit');
  env.editor.unmount(); env.boundary.unmount();

  const disposed = setup();
  disposed.loads[0].resolve(profileFor()); await flush();
  const pending = formIn(disposed.editor.settle()).props.onSubmit(submitEvent);
  disposed.editor.unmount();
  const before = disposed.editor.writes;
  disposed.saves[0].resolve(profileFor('guest-a', 2)); await pending;
  assert.equal(disposed.editor.writes, before, 'An old account mutation cannot write to a disposed editor');
  assert.equal(disposed.refreshes.length, 0, 'An old account mutation cannot refresh the new account session');
  disposed.boundary.unmount();
}

(async () => {
  const originalFormData = global.FormData;
  global.FormData = class { constructor(form) { this.values = form.values; } get(name) { return this.values[name] ?? null; } };
  try { await ownerAndLoadChecks(); await saveChecks(); }
  finally { global.FormData = originalFormData; }
  console.log('PASS (mocked component requests): profile account isolation, same-account refresh stability, obsolete/disposed load guards, duplicate-save guard, canonical saved values, success despite session refresh failure, conflict reload, and disposed-save isolation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
