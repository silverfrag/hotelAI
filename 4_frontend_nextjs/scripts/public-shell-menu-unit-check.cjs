// Render the actual shell with controlled hooks/media events; no browser or network.
// Run: node scripts/public-shell-menu-unit-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    emit(type, event = {}) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event); },
    count(type) { return listeners.get(type)?.size ?? 0; },
  };
}

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}

function setup() {
  const media = { ...eventTarget(), matches: false };
  const browser = { ...eventTarget(), scrollY: 0, matchMedia(query) {
    assert.equal(query, '(min-width: 48rem)', 'Media query must match the installed Tailwind md breakpoint');
    return media;
  } };
  global.window = browser;
  global.document = { body: { style: { overflow: 'auto' } } };
  let pathname = '/rooms', cursor = 0, dirty = false, pending = [];
  const slots = [];
  const react = {
    useState(initial) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { value: initial };
      return [slots[index].value, update => {
        const next = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; }
      }];
    },
    useEffect(effect, deps) {
      const index = cursor++;
      if (!slots[index]?.deps || !deps.every((value, i) => Object.is(value, slots[index].deps[i]))) {
        pending.push({ index, effect, deps });
      }
    },
  };
  const mocks = {
    react, 'next/link': 'a', 'next/navigation': { usePathname: () => pathname },
    '@/components/features/figma/AccountMenu': { AccountMenu: 'account-menu' },
    '@/components/features/figma/LanguageSwitch': { LanguageSwitch: 'language-switch' },
    '@/contexts/ThemeContext': { useTheme: () => ({ theme: 'dark', toggleTheme() {} }) },
    '@/contexts/LanguageContext': { useTranslation: () => ({ t: key => key }) },
  };
  const filename = path.join(root, 'src/components/features/figma/PublicShell.tsx');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : requireFrontend(id);
  loaded._compile(swc.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022',
      transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' },
  }).code, filename);
  const env = {
    browser, media,
    render() {
      for (let attempt = 0; ; attempt++) {
        assert.ok(attempt < 20, 'Shell effects converge');
        cursor = 0; dirty = false; pending = [];
        const tree = loaded.exports.default({ children: 'Page content' });
        for (const { index, effect, deps } of pending) {
          slots[index]?.cleanup?.();
          slots[index] = { deps, cleanup: effect() };
        }
        if (!dirty) return tree;
      }
    },
    navigate(next) { pathname = next; return env.render(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
  return env;
}

const byId = (tree, id) => nodes(tree).find(node => node.props?.id === id);
const trigger = tree => nodes(tree).find(node => node.props?.['aria-controls'] === 'public-mobile-menu');
function assertOpen(tree, open) {
  assert.equal(trigger(tree).props['aria-expanded'], open);
  assert.equal(byId(tree, 'public-content').props.inert, open, 'Page interaction follows menu visibility');
  assert.equal(nodes(tree).find(node => node.type === 'footer').props.inert, open);
  assert.equal(byId(tree, 'public-mobile-menu').props.inert, !open);
  assert.equal(byId(tree, 'public-mobile-menu').props['aria-hidden'], !open);
  assert.equal(document.body.style.overflow, open ? 'hidden' : 'auto', 'Closing restores the previous scroll policy');
}
function openMenu(env) {
  trigger(env.render()).props.onClick();
  const tree = env.render();
  assertOpen(tree, true);
  return tree;
}

const originalWindow = global.window, originalDocument = global.document;
try {
  const env = setup();
  assertOpen(env.render(), false);
  assert.equal(env.media.count('change'), 1);
  openMenu(env);
  env.media.emit('change', { matches: false });
  assertOpen(env.render(), true);
  env.media.matches = true;
  env.media.emit('change', { matches: true });
  assertOpen(env.render(), false);
  assert.equal(env.browser.count('keydown'), 0, 'Desktop recovery removes the menu keyboard listener');
  env.media.matches = false;
  env.media.emit('change', { matches: false });
  assertOpen(env.render(), false, 'Returning to mobile must not reopen the menu');

  let tree = openMenu(env);
  nodes(byId(tree, 'public-mobile-menu')).find(node => node.props?.href === '/rooms').props.onClick();
  assertOpen(env.render(), false); // The pathname deliberately remains /rooms.
  env.navigate('/book');
  tree = openMenu(env);
  nodes(byId(tree, 'public-mobile-menu')).find(node => node.props?.href === '/book').props.onClick();
  assertOpen(env.render(), false);
  env.navigate('/');
  tree = openMenu(env);
  nodes(tree).find(node => node.type === 'a' && node.props.href === '/').props.onClick();
  assertOpen(env.render(), false);

  openMenu(env);
  env.browser.emit('keydown', { key: 'Escape' });
  assertOpen(env.render(), false);
  openMenu(env);
  assertOpen(env.navigate('/profile'), false);
  openMenu(env);
  env.unmount();
  assert.equal(document.body.style.overflow, 'auto');
  assert.equal(env.media.count('change'), 0, 'Unmount removes the media listener');
  assert.equal(env.browser.count('keydown'), 0);
  assert.equal(env.browser.count('scroll'), 0);
  console.log('PASS public shell menu: desktop recovery, page interaction/scroll restoration, same-route links, logo, Escape, navigation, and listener cleanup.');
} finally {
  global.window = originalWindow;
  global.document = originalDocument;
}
