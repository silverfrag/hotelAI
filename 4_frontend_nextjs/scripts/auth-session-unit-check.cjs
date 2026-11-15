// Authentication unit checks with controlled HTTP results; no live API calls.
// Run after npm ci: node scripts/auth-session-unit-check.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');
const compile = (source, filename) => swc.transformSync(source, {
  filename,
  jsc: {parser:{syntax:'typescript', tsx:filename.endsWith('.tsx')}, target:'es2022', transform:{react:{runtime:'automatic'}}},
  module: {type:'commonjs'},
}).code;
const originalLoad = Module._load;
Module._load = function(id, parent, main) {
  return originalLoad.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, parent, main);
};
for (const ext of ['.ts', '.tsx']) Module._extensions[ext] = (module, filename) => module._compile(compile(fs.readFileSync(filename, 'utf8'), filename), filename);
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

async function serviceChecks() {
  const { logoutRequest } = requireFrontend('./src/services/auth.service.ts');
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({url,init});
    return new Response(JSON.stringify({status:'success'}), {status:200});
  };
  await logoutRequest();
  assert.ok(calls[0].url.endsWith('/auth/logout'));
  assert.equal(calls[0].init.method,'POST');
  assert.equal(calls[0].init.credentials,'include');
  global.fetch = async () => {throw new TypeError('Network unavailable');};
  await assert.rejects(logoutRequest(), /Network unavailable/);
  global.fetch = async () => new Response(JSON.stringify({status:'error', message:'Gateway unavailable', request_id:'logout-request-id'}), {status:503});
  await assert.rejects(logoutRequest(), error => error.status === 503 && error.requestId === 'logout-request-id');
  global.fetch = async () => new Response('<html>Gateway page</html>', {status:200});
  await assert.rejects(logoutRequest(), /không hợp lệ/);
  global.fetch = async () => new Response(JSON.stringify({status:'error', message:'Rejected'}), {status:200});
  await assert.rejects(logoutRequest(), /Rejected/);
  global.fetch = async () => new Response(JSON.stringify({}), {status:200});
  await assert.rejects(logoutRequest(), /chưa xác nhận/);
  global.fetch = async () => new Response(null, {status:204});
  await logoutRequest();
  const {clearSession}=requireFrontend('./src/services/auth.service.ts');
  const browser=new EventTarget();
  Object.defineProperty(browser,'localStorage',{get(){throw new Error('Storage disabled');}});
  global.window=browser;
  let cleared=false;browser.addEventListener('hotelai:auth-session-cleared',()=>{cleared=true;});
  clearSession();assert.equal(cleared,true,'Restricted storage does not block session invalidation');
  delete global.window;
}

async function providerChecks() {
  // A minimal hook scheduler controls request completion order without a browser.
  const slots = [];
  let cursor = 0, effects = [];
  const react = {
    createContext: () => ({Provider:()=>null}),
    useState(initial) {const index=cursor++;if(!(index in slots))slots[index]=initial;return [slots[index],value=>{slots[index]=typeof value==='function'?value(slots[index]):value;}];},
    useRef(initial) {const index=cursor++;return slots[index]??={current:initial};},
    useCallback: callback=>callback,
    useMemo: factory=>factory(),
    useEffect: effect=>effects.push(effect),
  };
  const sessions = [], logouts = [];
  const account = {accessToken:'cookie-session', user:{id:'customer-1', full_name:'Guest', role:'customer'}};
  const browser = new EventTarget();
  global.window = browser;
  const authService = {
    AUTH_SESSION_EVENT:'test-session-cleared',
    clearSession: () => browser.dispatchEvent(new Event('test-session-cleared')),
    getCurrentSession: () => {const request=deferred();sessions.push(request);return request.promise;},
    login: async () => account,
    register: async () => account,
    logoutRequest: () => {const request=deferred();logouts.push(request);return request.promise;},
  };
  const filename = path.join(root,'src/components/providers/AuthProvider.tsx');
  const provider = new Module(filename,module);
  provider.filename=filename;
  provider.require=id=>id==='react'?react:id==='@/services/auth.service'?authService:requireFrontend(id);
  provider._compile(compile(fs.readFileSync(filename,'utf8'),filename),filename);
  const render=()=>{cursor=0;effects=[];return provider.exports.AuthProvider({children:null}).props.value;};
  render();
  const cleanup=effects[0]();
  sessions[0].resolve(account);
  await flush();
  assert.equal(render().user.id,'customer-1');
  const pending=render().logout();
  assert.equal(render().logout(),pending,'Concurrent logout callers share one request');
  assert.equal(logouts.length,1);
  assert.equal(render().session,account,'Account remains visible before cookie logout acknowledgment');
  assert.equal(render().loggingOut,true);
  logouts[0].reject(new TypeError('Network unavailable'));
  await assert.rejects(pending,/Network unavailable/);
  assert.equal(render().session,account,'Failure keeps account state for retry');
  assert.equal(render().loggingOut,false);
  assert.ok(render().logoutError.length>0,'Failure is visible');
  const retry=render().logout();
  assert.equal(logouts.length,2,'Failed operation can retry');
  const staleRefresh=render().refreshSession();
  logouts[1].resolve();
  await retry;
  assert.equal(render().session,null,'Successful cookie logout clears account state');
  assert.equal(render().logoutError,'');
  sessions[1].resolve(account);
  await staleRefresh;
  assert.equal(render().session,null,'A pre-logout refresh cannot restore the old session');
  await render().login({email:'guest@example.invalid',password:'test-only'});
  render().invalidateSession();
  assert.equal(render().session,null,'Known 401/password/deactivation invalidates local state immediately');
  assert.equal(logouts.length,2,'Known invalid session does not start another logout request');
  cleanup();
  delete global.window;
}

async function navigationChecks() {
  let logout=async()=>{};
  const navigations=[];
  const user={id:'customer-1',full_name:'Guest',email:'guest@example.invalid',role:'customer'};
  const common={
    '@/hooks/useAuth':{useAuth:()=>({ready:true,user,session:{accessToken:'cookie-session',user},logout:()=>logout(),loggingOut:false,logoutError:'Please retry sign out',invalidateSession(){}})},
    'next/navigation':{usePathname:()=>'/admin',useRouter:()=>({push:path=>navigations.push(path),replace:path=>navigations.push(path),refresh:()=>navigations.push('refresh')})},
    '@/contexts/LanguageContext':{useTranslation:()=>({language:'en',setLanguage(){},supportedLanguages:[{code:'en',flag:'EN'}],currentLanguageInfo:{code:'en',flag:'EN'},t:key=>key})},
    '@/contexts/ThemeContext':{useTheme:()=>({theme:'light',toggleTheme(){}})},
  };
  const buttonText=node=>{
    if(typeof node==='string')return node;
    if(Array.isArray(node))return node.map(buttonText).join('');
    return node?.props?buttonText(node.props.children):'';
  };
  function find(node,predicate) {
    if(!node||typeof node!=='object')return null;
    if(Array.isArray(node)){for(const child of node){const match=find(child,predicate);if(match)return match;}return null;}
    if(predicate(node))return node;
    return find(node.props?.children,predicate);
  }
  for(const [relative,name,props,label] of [
    ['components/features/figma/AccountMenu.tsx','AccountMenu',{},'account_sign_out'],
    ['components/layout/Header.tsx','Header',{user,onMobileOpen(){}},'Đăng xuất'],
    ['components/layouts/Navbar.tsx','Navbar',{},'nav_logout'],
    ['components/layout/AdminShell.tsx','AdminShell',{children:null},'Đăng nhập tài khoản khác'],
  ]) {
    let stateIndex=0;
    const react={
      useState:initial=>{const index=stateIndex++;return [name==='AdminShell'&&index===2?{token:'cookie-session',user}:initial,()=>{}];},
      useRef:initial=>({current:initial}),useEffect(){},
    };
    const filename=path.join(root,'src',relative),loaded=new Module(filename,module);
    const requireHere=Module.createRequire(filename);
    loaded.filename=filename;
    loaded.require=id=>id==='react'?react:common[id]??requireHere(id.startsWith('@/')?path.join(root,'src',id.slice(2)):id);
    loaded._compile(compile(fs.readFileSync(filename,'utf8'),filename),filename);
    const tree=loaded.exports[name](props);
    const button=find(tree,node=>node.props?.['aria-label']===label||buttonText(node)===label&&typeof node.props?.onClick==='function');
    assert.ok(button,`${name} sign-out action is present`);
    assert.ok(find(tree,node=>node.props?.role==='alert'),`${name} exposes the sign-out failure for retry`);
    const pending=deferred();logout=()=>pending.promise;
    button.props.onClick();await flush();
    assert.deepEqual(navigations,[],`${name} waits before navigation`);
    pending.reject(new Error('Sign-out failed'));await flush();
    assert.deepEqual(navigations,[],`${name} remains on the current page after failure`);
    logout=async()=>{};button.props.onClick();await flush();
    assert.ok(navigations.length>0,`${name} navigates after confirmed sign out`);
    navigations.length=0;
  }
}

(async()=>{
  await serviceChecks();
  await providerChecks();
  await navigationChecks();
  console.log('PASS (unit, mocked APIs): logout cookie request; network/HTTP/malformed errors; deferred clearing; shared pending request; failure retention and retry; stale refresh protection; local invalidation after known revocation; four sign-out UIs wait before navigating and expose retry errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
