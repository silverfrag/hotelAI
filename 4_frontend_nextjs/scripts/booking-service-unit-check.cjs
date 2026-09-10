// Runtime service-contract unit checks with synthetic HTTP responses; no live API calls.
// Run after npm ci: node scripts/booking-service-unit-check.cjs.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const root=path.resolve(__dirname,'..');
const requireFrontend=Module.createRequire(path.join(root,'package.json'));
const swc=requireFrontend('next/dist/build/swc');
const originalLoad=Module._load;
Module._load=function(id,parent,main){return originalLoad.call(this,id.startsWith('@/')?path.join(root,'src',id.slice(2)):id,parent,main);};
Module._extensions['.ts']=(module,filename)=>module._compile(swc.transformSync(fs.readFileSync(filename,'utf8'),{
  filename,jsc:{parser:{syntax:'typescript'},target:'es2022'},module:{type:'commonjs'},
}).code,filename);
const service=requireFrontend('./src/services/booking.service.ts');
const clone=value=>JSON.parse(JSON.stringify(value));
const ids={quote:'11111111-1111-4111-8111-111111111111',booking:'22222222-2222-4222-8222-222222222222',event:'33333333-3333-4333-8333-333333333333',other:'44444444-4444-4444-8444-444444444444'};
const input={room_type_id:1,check_in_date:'2026-10-01',check_out_date:'2026-10-03',guest_count:2,total_of_special_requests:1};
const quote={
  quote_id:ids.quote,room_type:{type_id:1,type_name:'Deluxe King',base_price:1200000,capacity:2},
  check_in_date:input.check_in_date,check_out_date:input.check_out_date,guest_count:2,nights:2,
  rooms_available:1,rooms_sellable:3,rooms_booked:2,occupancy_ratio:2/3,inventory_snapshot_at:'2026-09-09T03:00:00.000Z',
  ai_multiplier:1,ai_model_version:null,ai_training_run_id:null,ai_feature_contract_version:null,
  pricing_source:'base',settings_version:1,nightly_price:1200000,total_price:2400000,currency:'VND',is_estimate:true,availability_is_guaranteed:false,
  created_at:'2026-09-09T03:00:00.000Z',expires_at:'2026-09-09T03:15:00.000Z',price_guaranteed_until:'2026-09-09T03:15:00.000Z',
};
const receipt={
  booking:{booking_id:ids.booking,check_in_date:input.check_in_date,check_out_date:input.check_out_date,guest_count:2,status:'Pending',
    lifecycle_version:1,policy_version:1,deposit_required:720000,checkout_payment_required:true,pending_expires_at:'2026-09-09T04:00:00.000Z'},
  quote_id:ids.quote,room_id:1,room_number:'101',applied_price:1200000,nightly_price:1200000,nights:2,total_price:2400000,
  ai_multiplier:1,ai_model_version:null,ai_training_run_id:null,ai_feature_contract_version:null,pricing_source:'base',settings_version:1,
  payment_status:'Unpaid',paid_amount:0,balance_due:2400000,
};
const context={session_id:ids.booking,search_id:ids.other};
const event={quote_event_id:ids.event,quote_id:ids.quote,event_type:'quote.exposed.v1',occurred_at:'2026-09-09T03:01:00.000Z',replayed:false,...context};
const requests=[];
function respond(data,status=200,envelope=true){
  global.fetch=async(url,init)=>{requests.push({url,init});return Response.json(envelope?{status:'success',data,request_id:'service-contract-trace'}:data,{status,headers:{'X-Request-ID':'service-contract-trace'}});};
}
async function rejects(call,data,status=200){
  respond(data,status);
  await assert.rejects(call,error=>error instanceof service.BookingServiceError&&error.status===status&&error.requestId==='service-contract-trace');
}

async function quoteChecks(){
  respond(quote);assert.deepEqual(await service.getPriceQuote(input),quote);
  assert.deepEqual(JSON.parse(requests.at(-1).init.body),input);
  assert.equal(requests.at(-1).init.method,'POST');
  const malformed=[null,{},[],{...quote,room_type:null},{...quote,room_type:{}},{...quote,quote_id:'bad-id'},
    {...quote,room_type:{...quote.room_type,type_id:2}},{...quote,room_type:{...quote.room_type,capacity:1}},
    {...quote,check_in_date:'2026-10-02'},{...quote,guest_count:1},{...quote,nights:1},{...quote,rooms_available:-1},
    {...quote,nightly_price:-1},{...quote,total_price:NaN},{...quote,ai_multiplier:'1'},{...quote,currency:'USD'},
    {...quote,expires_at:'not-a-date'},{...quote,price_guaranteed_until:'not-a-date'},
    {...quote,created_at:'2026-02-30T03:00:00.000Z'},
    {...quote,price_guaranteed_until:'2026-09-09T03:30:00.000Z'},{...quote,expires_at:'2026-09-08T03:15:00.000Z'}];
  for(const value of malformed)await rejects(()=>service.getPriceQuote(input),value);
  // Network delay can legitimately deliver an already-expired but well-formed quote.
  respond({...quote,rooms_available:0});assert.equal((await service.getPriceQuote(input)).rooms_available,0);
  respond({...quote,pricing_source:'ai',ai_multiplier:1.2,nightly_price:1440000,total_price:2880000,ai_model_version:'random_forest_v2',ai_training_run_id:'training-1',ai_feature_contract_version:'2.0.0'});
  assert.equal((await service.getPriceQuote(input)).pricing_source,'ai');
}

async function receiptChecks(){
  const createInput={...input,quote_id:ids.quote};
  const create=()=>service.createBooking(createInput,'cookie-session','booking:stable');
  respond(receipt,201);assert.deepEqual(await create(),receipt);
  assert.equal(requests.at(-1).init.credentials,'include');assert.equal(requests.at(-1).init.headers['Idempotency-Key'],'booking:stable');
  assert.deepEqual(JSON.parse(requests.at(-1).init.body),createInput);
  const malformed=[{},[],{...receipt,booking:null},{...receipt,booking:{}},{...receipt,quote_id:ids.other},
    {...receipt,room_number:null},{...receipt,total_price:Infinity},{...receipt,paid_amount:-1},{...receipt,balance_due:'0'},
    {...receipt,payment_status:'Captured'},{...receipt,booking:{...receipt.booking,booking_id:'bad-id'}},
    {...receipt,booking:{...receipt.booking,status:'Reserved'}},{...receipt,booking:{...receipt.booking,guest_count:1}},
    {...receipt,booking:{...receipt.booking,check_out_date:'2026-10-04'}},{...receipt,booking:{...receipt.booking,lifecycle_version:0}},
    {...receipt,booking:{...receipt.booking,deposit_required:null}},{...receipt,booking:{...receipt.booking,deposit_required:'720000.00'}},
    {...receipt,booking:{...receipt.booking,checkout_payment_required:'true'}},
    {...receipt,booking:{...receipt.booking,pending_expires_at:null}},{...receipt,booking:{...receipt.booking,pending_expires_at:'yesterday'}},
    {...receipt,booking:{...receipt.booking,pending_expires_at:'2026-02-30T04:00:00Z'}}];
  // Keep the 201 status: this malformed response may hide a committed booking,
  // and the reservation hook must retry its existing idempotency key.
  for(const value of malformed)await rejects(create,value,201);
  for(const status of ['Pending','Confirmed','CheckedIn','Completed','Canceled','Expired','NoShow']){
    const replay={...receipt,booking:{...receipt.booking,status,lifecycle_version:3},payment_status:status==='Pending'?'PartiallyPaid':'Paid',paid_amount:720000,balance_due:1680000};
    respond(replay,201);assert.equal((await create()).booking.status,status);
  }
  for(const payment_status of ['RefundPending','PartiallyRefunded','Refunded']){
    const replay={...receipt,booking:{...receipt.booking,status:'Canceled'},payment_status,paid_amount:720000,balance_due:0};
    respond(replay,201);assert.equal((await create()).payment_status,payment_status);
  }
  respond({...receipt,booking:{...receipt.booking,status:'Confirmed',deposit_required:0,pending_expires_at:null}},201);
  assert.equal((await create()).booking.status,'Confirmed','Zero-deposit confirmation needs no hold deadline');
}

async function eventChecks(){
  const expose=()=>service.recordQuoteEvent(ids.quote,'quote.exposed.v1',context);
  respond(event,201);assert.deepEqual(await expose(),event);
  assert.equal(requests.at(-1).init.headers['Idempotency-Key'],`quote-event:quote.exposed.v1:${ids.quote}`);
  for(const value of [{},null,{...event,quote_id:ids.other},{...event,event_type:'quote.rejected.v1'},{...event,quote_event_id:'bad'},{...event,occurred_at:'yesterday'},{...event,replayed:'yes'}])await rejects(expose,value,201);
  respond({...event,replayed:true},201);assert.equal((await expose()).replayed,true);
  const rejected={...event,event_type:'quote.rejected.v1'};respond(rejected,201);
  assert.equal((await service.recordQuoteEvent(ids.quote,'quote.rejected.v1',context)).event_type,'quote.rejected.v1');
}

(async()=>{
  await quoteChecks();await receiptChecks();await eventChecks();
  console.log('PASS (unit, mocked HTTP): real booking service accepts backend-shaped quotes/receipts/event replays; rejects missing/nested/mismatched/invalid amounts and expiry; preserves malformed-201 status and trace for safe booking recovery; exposure acknowledgment must match quote and event.');
})().catch(error=>{console.error(error);process.exitCode=1;});
