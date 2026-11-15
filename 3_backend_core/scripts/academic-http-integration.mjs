import assert from 'node:assert/strict';

const core = process.env.ACADEMIC_CORE_URL ?? 'http://127.0.0.1:53003/api/v1/core/academic';
const ai = process.env.AI_ACADEMIC_URL ?? 'http://127.0.0.1:58000/api/v1/academic';
async function request(url, body) {
  const response = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return { status: response.status, body: await response.json() };
}
const info = await request(`${core}/info`);
assert.equal(info.status, 200);
assert.equal(info.body.data.feature_contract_version, 'academic-booking-v1');
for (const task of ['adr', 'cancellation']) {
  const held = await request(`${core}/holdout?task=${task}&limit=2&order=largest_error`);
  assert.equal(held.status, 200);
  const rowId = held.body.data.rows[0].row_id;
  const experiment = await request(`${core}/experiment`, { task, row_id: rowId });
  assert.equal(experiment.status, 200);
  assert.equal(experiment.body.data.partition, 'test');
  const input = experiment.body.data.input;
  const direct = await request(`${ai}/decision`, input);
  const proxied = await request(`${core}/decision`, input);
  assert.equal(direct.status, 200);
  assert.equal(proxied.status, 200);
  for (const field of ['adr_reference', 'cancellation_probability', 'model_version']) {
    assert.equal(proxied.body.data[field], direct.body[field]);
  }
  const selected = info.body.data.tasks[task].selected;
  const predicted = experiment.body.data.decision[task === 'adr' ? 'adr_reference' : 'cancellation_probability'];
  assert.ok(Math.abs(predicted - experiment.body.data.stored_predictions[selected]) < 1e-8);
  assert.ok(experiment.body.data.decision.explanation[task].length > 0);
  const invalid = { ...input, is_canceled: 1 };
  assert.equal((await request(`${core}/decision`, invalid)).status, 400);
  const missing = { ...input }; delete missing.adults;
  assert.equal((await request(`${core}/decision`, missing)).status, 400);
  assert.equal((await request(`${core}/decision`, { ...input, lead_time: -1 })).status, 400);
  assert.equal((await request(`${core}/decision`, { ...input, reserved_room_type: '   ' })).status, 400);
  const unknown = await request(`${core}/decision`, { ...input, reserved_room_type: 'NEW', children: null, arrival_date: '2026-10-26' });
  assert.equal(unknown.status, 200);
  assert.ok(unknown.body.data.warnings.some(message => message.includes('unknown')));
}
assert.equal((await request(`${core}/holdout?task=conversion`)).status, 400);
assert.equal((await request(`${core}/experiment`, { task: 'adr', row_id: 'booking-999999' })).status, 404);
console.log('PASS HTTP: NestJS → FastAPI → persisted ADR/cancellation pipelines; holdout parity; explanations; invalid/missing/out-of-domain inputs.');
