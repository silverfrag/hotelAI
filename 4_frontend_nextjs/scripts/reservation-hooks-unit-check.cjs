// Real quote/reservation/telemetry hook unit checks with fake time and API results.
// Run after npm ci: node scripts/reservation-hooks-unit-check.cjs. No live API calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');
const flush = () => new Promise(resolve => setImmediate(resolve));
const copy = value => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes,no) => {resolve=yes;reject=no;});
  return {promise,resolve,reject};
}

function createClock() {
  let now = Date.parse('2026-09-09T03:00:00Z'), nextId = 0, visibilityState = 'visible';
  const tasks = new Map(), storage = new Map(), docListeners = new Set();
  const schedule = (callback, delay, interval=false) => {const id=++nextId;tasks.set(id,{callback,due:now+delay,delay,interval});return id;};
  const previousNow = Date.now, previousWindow = global.window, previousDocument = global.document;
  Date.now = () => now;
  global.window = {
    setTimeout:(callback,delay)=>schedule(callback,delay), clearTimeout:id=>tasks.delete(id),
    setInterval:(callback,delay)=>schedule(callback,delay,true), clearInterval:id=>tasks.delete(id),
    sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},
  };
  global.document = {
    get visibilityState() { return visibilityState; },
    addEventListener(type, listener) { if (type === 'visibilitychange') docListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'visibilitychange') docListeners.delete(listener); },
  };
  return {
    setDocumentVisibility(next) {
      visibilityState = next;
      for (const listener of [...docListeners]) listener();
    },
    async advance(ms) {
      const target=now+ms;
      for (;;) {
        const next=[...tasks.entries()].filter(([,task])=>task.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];
        if(!next)break;
        const [id,task]=next;now=task.due;
        if(task.interval)task.due+=task.delay;else tasks.delete(id);
        task.callback();
        await flush();
      }
      now=target;await flush();
    },
    restore() {
      Date.now=previousNow;
      if(previousWindow===undefined)delete global.window;else global.window=previousWindow;
      if(previousDocument===undefined)delete global.document;else global.document=previousDocument;
    },
  };
}

function createRunner() {
  const slots=[];
  let cursor=0, pending=[], dirty=false, output, renderHook;
  const react = {
    useState(initial) {
      const index=cursor++;
      if(!(index in slots))slots[index]={value:typeof initial==='function'?initial():initial};
      return [slots[index].value,value=>{const next=typeof value==='function'?value(slots[index].value):value;if(!Object.is(slots[index].value,next)){slots[index].value=next;dirty=true;}}];
    },
    useRef(initial) {const index=cursor++;return (slots[index]??={value:{current:initial}}).value;},
    useEffect(effect,deps) {
      const index=cursor++, previous=slots[index];
      if(!previous?.deps || deps.some((value,i)=>!Object.is(value,previous.deps[i])))pending.push({index,effect,deps});
    },
  };
  function render(commit=true) {
    cursor=0;pending=[];dirty=false;output=renderHook();
    if(commit)commitEffects();
    return output;
  }
  function commitEffects() {
    const effects=pending;pending=[];
    for(const {index,effect,deps} of effects){slots[index]?.cleanup?.();slots[index]={deps,cleanup:effect()};}
  }
  return {
    react,
    start(hook) {renderHook=hook;return this.settle();},
    render,
    commit:commitEffects,
    settle() {render();for(let attempt=0;dirty;attempt++){assert.ok(attempt<25,'Hook effects converge');render();}return output;},
    unmount() {slots.forEach(slot=>slot?.cleanup?.());},
  };
}

function loadHook(relative, mocks) {
  const filename=path.join(root,'src',relative), loaded=new Module(filename,module);
  loaded.filename=filename;
  loaded.require=id=>Object.hasOwn(mocks,id)?mocks[id]:requireFrontend(id);
  const compiled=swc.transformSync(fs.readFileSync(filename,'utf8'),{
    filename,jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'},
  }).code;
  loaded._compile(compiled,filename);
  return loaded.exports;
}

const initialInput = {room_type_id:1,check_in_date:'2026-10-01',check_out_date:'2026-10-02',total_of_special_requests:0,guest_count:1};
const initialAccount = {id:'11111111-1111-4111-8111-111111111111',email:'guest@example.invalid'};
function quoteFor(request,id='quote-1') {
  return {quote_id:id,room_type:{type_id:request.room_type_id,type_name:'Actual room',base_price:1000000,capacity:2},
    check_in_date:request.check_in_date,check_out_date:request.check_out_date,guest_count:request.guest_count,
    rooms_available:1,nightly_price:1000000,total_price:1000000,nights:1,pricing_source:'base',ai_multiplier:1,
    price_guaranteed_until:new Date(Date.now()+60000).toISOString(),expires_at:new Date(Date.now()+60000).toISOString()};
}
class BookingServiceError extends Error {constructor(message,status){super(message);this.status=status;}}

async function dynamicPriceChecks() {
  const clock=createClock(),runner=createRunner(),requests=[];
  let input=null,refresh=0;
  const {useDynamicPrice}=loadHook('hooks/useDynamicPrice.ts',{react:runner.react,'@/services/booking.service':{
    getPriceQuote:(value,signal)=>{const wait=deferred();requests.push({...wait,input:copy(value),signal});return wait.promise;},
  }});
  try {
    assert.equal(runner.start(()=>useDynamicPrice(input,refresh)).quote,null);
    input={...initialInput};runner.settle();
    await clock.advance(349);assert.equal(requests.length,0,'Quote lookup is debounced');
    input={...input,guest_count:2};runner.settle();
    await clock.advance(350);assert.equal(requests.length,1,'Rapid edits issue only the latest quote lookup');
    assert.equal(requests[0].input.guest_count,2);
    const first=quoteFor(input,'guest-two');requests[0].resolve(first);await flush();
    assert.equal(runner.settle().quote.quote_id,'guest-two');
    input={...input,total_of_special_requests:1};
    assert.equal(runner.render(false).quote,null,'Special-request changes hide old quote before effects run');
    runner.commit();runner.settle();
    assert.equal(requests[0].signal.aborted,true,'Previous request is aborted on edit');
    await clock.advance(350);
    const oldRequest=requests[1];
    input={...input,check_out_date:'2026-10-03'};runner.settle();
    await clock.advance(350);assert.equal(requests.length,3);
    requests[2].resolve(quoteFor(input,'newest'));await flush();runner.settle();
    oldRequest.resolve(quoteFor(oldRequest.input,'stale'));await flush();
    assert.equal(runner.settle().quote.quote_id,'newest','Aborted late success cannot replace the latest quote');
    refresh+=1;
    assert.equal(runner.render(false).quote,null,'Manual refresh invalidates the old quote in the same render');
    runner.commit();runner.settle();await clock.advance(350);
    requests[3].reject(new BookingServiceError('AI unavailable',503));await flush();
    let state=runner.settle();assert.equal(state.quote,null);assert.equal(state.error,'AI unavailable');assert.equal(state.loading,false);
    refresh+=1;runner.settle();await clock.advance(350);
    const lateError=requests[4];input=null;runner.settle();lateError.reject(new Error('Old network error'));await flush();
    state=runner.settle();assert.equal(state.quote,null);assert.equal(state.error,'');assert.equal(state.loading,false,'Invalid input clears quote and aborted errors');
    input={...initialInput};runner.settle();runner.unmount();await clock.advance(350);
    assert.equal(requests.length,5,'Unmount cancels a queued quote lookup');
  } finally {runner.unmount();clock.restore();}
}

function reservationHarness() {
  const clock=createClock(),runner=createRunner(),quotes=[],bookings=[],events=[];
  let input={...initialInput},session='cookie-session',user={...initialAccount},refreshCount=0,eventFailure=null;
  const service={BookingServiceError,
    getPriceQuote:(value,signal)=>{const wait=deferred();quotes.push({...wait,input:copy(value),signal});return wait.promise;},
    createBooking:(value,marker,key)=>{const wait=deferred();bookings.push({...wait,input:copy(value),marker,key});return wait.promise;},
    recordQuoteEvent:async(quoteId,eventType,context)=>{events.push({quoteId,eventType,context});if(eventFailure)throw eventFailure;return {quote_id:quoteId,event_type:eventType,...context};},
  };
  const useDynamicPrice=loadHook('hooks/useDynamicPrice.ts',{react:runner.react,'@/services/booking.service':service}).useDynamicPrice;
  const telemetry=loadHook('services/quote-telemetry.ts',{'@/services/booking.service':service});
  const {useReservation}=loadHook('hooks/useReservation.ts',{
    react:runner.react,'@/hooks/useDynamicPrice':{useDynamicPrice},'@/services/booking.service':service,
    '@/services/quote-telemetry':telemetry,'@/hooks/useAuth':{useAuth:()=>({accessToken:session,user,refreshSession:async()=>{refreshCount+=1;session=null;user=null;return null;}})},
  });
  runner.start(()=>useReservation(input,'11111111-1111-4111-8111-111111111111'));
  return {clock,runner,quotes,bookings,events,
    changeInput:value=>{input=value;},setEventFailure:value=>{eventFailure=value;},refreshCount:()=>refreshCount,
    setUser:value=>{user=value;session=value?'cookie-session':null;},
    setDocumentVisibility:value=>{clock.setDocumentVisibility(value);runner.settle();},
    async ready(expose = true) {
      await clock.advance(350);
      quotes.at(-1).resolve(quoteFor(input,`quote-${quotes.length}`));
      await flush();
      let state = runner.settle();
      if (expose && state.quote) {
        state.markQuoteVisible(state.quote.quote_id);
        state = runner.settle();
      }
      await flush();
      return runner.settle();
    },
    close(){runner.unmount();clock.restore();},
  };
}

async function reservationChecks() {
  const h=reservationHarness();
  try {
    let state=await h.ready(false);
    assert.equal(h.events.length,0,'Quote is not exposed before viewport intersection confirms visibility');
    h.setDocumentVisibility('hidden');
    state.markQuoteVisible(state.quote.quote_id);
    state=h.runner.settle();await flush();
    assert.equal(h.events.length,0,'Hidden document tab suppresses quote exposure even when card intersected');
    h.setDocumentVisibility('visible');await flush();
    assert.equal(h.events.length,1,'Visible rendered quote is exposed once when tab returns visible');
    state.markQuoteVisible(state.quote.quote_id);h.runner.settle();await flush();
    assert.equal(h.events.length,1,'Repeated visibility signals do not duplicate quote exposure');
    assert.equal(h.events[0].context.search_id,'11111111-1111-4111-8111-111111111111','Existing search lineage is preserved');
    h.changeInput({...initialInput,coupon_code:'WHITESAND10'});
    assert.equal(h.runner.render(false).quote,null,'Adding a coupon hides the previous un-discounted quote synchronously');
    h.changeInput({...initialInput,total_of_special_requests:2});
    state=h.runner.render(false);assert.equal(state.quote,null,'Reservation cannot use the previous special-request quote');
    h.runner.commit();h.runner.settle();state=await h.ready();
    const create=state.confirm(),duplicate=state.confirm();await flush();
    assert.equal(h.bookings.length,1,'Immediate double submit sends one create request');
    await duplicate;
    state=h.runner.settle();assert.equal(state.submitting,true);
    state.refreshQuote();state.changeSelection();h.runner.settle();await h.clock.advance(350);
    assert.equal(h.quotes.length,2,'Busy submission cannot refresh its quote');
    assert.equal(h.events.filter(item=>item.eventType==='quote.rejected.v1').length,0,'Busy submission never rejects its own quote');
    h.bookings[0].reject(new TypeError('Response disconnected'));await create;
    state=h.runner.settle();assert.equal(state.retryOnly,true,'Ambiguous response retains the current attempt');
    state.refreshQuote();state.changeSelection();h.runner.settle();await h.clock.advance(61000);
    state=h.runner.settle();assert.equal(state.expired,true);assert.equal(h.quotes.length,2,'Ambiguous attempt cannot replace its quote');
    const recover=state.confirm();await flush();assert.equal(h.bookings.length,2,'Expired ambiguous attempt can retry');
    assert.equal(h.bookings[1].key,h.bookings[0].key,'Retry keeps the same idempotency key');
    assert.deepEqual(h.bookings[1].input,h.bookings[0].input,'Retry keeps the exact payload');
    const receipt={booking:{booking_id:'actual-booking',status:'Pending',deposit_required:300000},room_number:'101',total_price:1000000};
    h.bookings[1].resolve(receipt);await recover;state=h.runner.settle();assert.equal(state.result,receipt);
    await state.confirm();state.refreshQuote();state.changeSelection();h.runner.settle();await h.clock.advance(350);
    assert.equal(h.bookings.length,2,'A result cannot submit another reservation');assert.equal(h.quotes.length,2,'A result cannot refresh its quote');
    assert.equal(h.events.filter(item=>item.eventType==='quote.rejected.v1').length,0,'Recovered booking does not emit rejection');
  } finally {h.close();}
  const unauthorized=reservationHarness();
  try {
    const state=await unauthorized.ready(),create=state.confirm();await flush();
    unauthorized.bookings[0].reject(new BookingServiceError('Session expired',401));await create;
    assert.equal(unauthorized.refreshCount(),1);assert.equal(unauthorized.runner.settle().retryOnly,false);
    await unauthorized.runner.settle().confirm();assert.equal(unauthorized.bookings.length,1,'Invalidated session cannot create again');
  } finally {unauthorized.close();}
  const exposure=reservationHarness();
  try {
    exposure.setEventFailure(new TypeError('Exposure response unavailable'));
    const state=await exposure.ready();
    const submitted=state.confirm();await flush();
    assert.equal(exposure.bookings.length,1,'Failed exposure telemetry does not block customer reservation creation');
    exposure.bookings[0].resolve({booking:{booking_id:'exposed-booking',status:'Confirmed'},total_price:1000000});await submitted;
    assert.equal(exposure.runner.settle().result.booking.booking_id,'exposed-booking');
  } finally {exposure.close();}
  const changed=reservationHarness();
  try {
    let state=await changed.ready();
    assert.deepEqual(changed.events.map(event=>event.eventType),['quote.exposed.v1']);
    state.changeSelection();await flush();
    assert.deepEqual(changed.events.map(event=>event.eventType),['quote.exposed.v1'],'Selection edit clears visibility instead of fabricating an explicit quote rejection');
    changed.changeInput({...initialInput,guest_count:2});changed.runner.settle();state=await changed.ready();
    await changed.clock.advance(61000);state=changed.runner.settle();await state.confirm();
    assert.equal(changed.bookings.length,0,'An expired quote without an ambiguous POST cannot create');
    const rejected=changed.events.filter(event=>event.eventType==='quote.rejected.v1').length;
    changed.runner.unmount();await flush();
    assert.equal(changed.events.filter(event=>event.eventType==='quote.rejected.v1').length,rejected,'Unmount is not user rejection');
  } finally {changed.close();}
  for (const status of [200,201,503]) {
    const ambiguous=reservationHarness();
    try {
      const state=await ambiguous.ready(),create=state.confirm();await flush();
      ambiguous.bookings[0].reject(new BookingServiceError(status<300?'Invalid successful payload':'Backend unavailable',status));await create;
      assert.equal(ambiguous.runner.settle().retryOnly,true,`HTTP ${status} may hide a committed booking and keeps the attempt`);
      const retry=ambiguous.runner.settle().confirm();await flush();
      assert.equal(ambiguous.bookings[1].key,ambiguous.bookings[0].key);
      assert.deepEqual(ambiguous.bookings[1].input,ambiguous.bookings[0].input);
      ambiguous.bookings[1].resolve({booking:{booking_id:`recovered-${status}`,status:'Expired'},total_price:1000000});await retry;
      assert.equal(ambiguous.runner.settle().result.booking.status,'Expired','Replay preserves the authoritative terminal state');
    } finally {ambiguous.close();}
  }
  for (const retryStatus of [401,403,409,429]) {
    const unresolved=reservationHarness();
    try {
      const state=await unresolved.ready(),create=state.confirm();await flush();
      unresolved.bookings[0].reject(new BookingServiceError('Unknown booking outcome',503));await create;
      const retry=unresolved.runner.settle().confirm();await flush();
      unresolved.bookings[1].reject(new BookingServiceError('Recovery rejected',retryStatus));await retry;
      const blocked=unresolved.runner.settle();
      assert.equal(blocked.retryOnly,true,`Recovery HTTP ${retryStatus} cannot establish whether the original booking committed`);
      blocked.refreshQuote();blocked.changeSelection();unresolved.runner.settle();await unresolved.clock.advance(350);
      assert.equal(unresolved.quotes.length,1,'Unresolved original attempt cannot refresh');
      assert.equal(unresolved.events.filter(event=>event.eventType==='quote.rejected.v1').length,0,'Unresolved original attempt cannot reject its quote');
      assert.equal(unresolved.bookings[1].key,unresolved.bookings[0].key);
    } finally {unresolved.close();}
  }
  const reauthentication=reservationHarness();
  try {
    const state=await reauthentication.ready(),create=state.confirm();await flush();
    reauthentication.bookings[0].reject(new BookingServiceError('Unknown outcome',503));await create;
    assert.deepEqual(reauthentication.runner.settle().recoveryAccount,initialAccount,'Original customer identity is retained before the POST');
    const recovery=reauthentication.runner.settle().confirm();await flush();
    reauthentication.bookings[1].reject(new BookingServiceError('Session expired',401));await recovery;
    let locked=reauthentication.runner.settle();
    assert.equal(locked.retryOnly,true);assert.equal(locked.recoveryNeedsSignIn,true,'Lost auth requests in-form recovery sign-in');
    await locked.confirm();assert.equal(reauthentication.bookings.length,2,'Lost auth never posts a recovery request');
    // Email matching alone is insufficient; backend idempotency is customer-ID scoped.
    reauthentication.setUser({...initialAccount,id:'22222222-2222-4222-8222-222222222222'});
    locked=reauthentication.runner.settle();assert.equal(locked.recoveryNeedsSignIn,true);
    await locked.confirm();assert.equal(reauthentication.bookings.length,2,'Another customer cannot reuse the original request');
    assert.ok(reauthentication.runner.settle().error.includes('original')||reauthentication.runner.settle().error.includes(initialAccount.email));
    reauthentication.setUser({...initialAccount});await reauthentication.clock.advance(61000);
    locked=reauthentication.runner.settle();assert.equal(locked.recoveryNeedsSignIn,false);assert.equal(locked.expired,true);
    const resumed=locked.confirm();await flush();assert.equal(reauthentication.bookings.length,3,'Original customer can recover after sign-in and quote expiry');
    assert.equal(reauthentication.bookings[2].key,reauthentication.bookings[0].key);
    assert.deepEqual(reauthentication.bookings[2].input,reauthentication.bookings[0].input);
    reauthentication.bookings[2].resolve({booking:{booking_id:'same-customer-recovery',status:'Confirmed'},total_price:1000000});await resumed;
    assert.equal(reauthentication.runner.settle().result.booking.booking_id,'same-customer-recovery');
  } finally {reauthentication.close();}
  const priceMismatch=reservationHarness();
  try {
    const state=await priceMismatch.ready(),create=state.confirm();await flush();
    priceMismatch.bookings[0].resolve({booking:{booking_id:'mismatched-price',status:'Pending'},total_price:1200000});
    await create;
    const locked=priceMismatch.runner.settle();
    assert.equal(locked.result,null,'A changed saved total must not become a successful receipt');
    assert.equal(locked.retryOnly,true,'A saved-price mismatch may hide a committed booking and retains its recovery key');
    locked.refreshQuote();priceMismatch.runner.settle();await priceMismatch.clock.advance(350);
    assert.equal(priceMismatch.quotes.length,1,'Mismatch cannot silently reprice the accepted booking');
  } finally {priceMismatch.close();}
}

(async()=>{
  await dynamicPriceChecks();await reservationChecks();
  console.log('PASS (unit, mocked APIs and fake time): real quote debounce; same-render invalidation; aborted response/error isolation; AI failure; unmount cleanup; exposure lineage/recovery and rejection; double-submit guard; network/2xx-malformed/5xx recovery with exact key/payload; subsequent 401/403/409/429 retain the lock; original customer alone can recover after reauthentication and expiry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
