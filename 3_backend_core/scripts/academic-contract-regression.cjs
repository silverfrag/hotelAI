const assert = require('node:assert/strict');
const axios = require('axios');
const { AcademicService } = require('../dist/modules/academic/academic.service');

const valid = {
  status: 'success', adr_reference: 100, cancellation_probability: .3, adr_unit: 'EUR',
  model_version: 'fixture', training_run_id: 'fixture', feature_contract_version: 'academic-booking-v1',
  prediction_sources: { adr: 'ml:fixture', cancellation: 'ml:fixture' }, features: {}, explanation: {},
  business_rules: [], caveats: [], warnings: [],
};
const original = axios.request;
const service = new AcademicService({ get: (_key, fallback) => fallback });
(async () => {
  let response = valid;
  axios.request = async () => ({ data: response });
  assert.deepEqual(await service.decide({}), valid);
  for (const change of [{ cancellation_probability: 1.2 }, { adr_reference: NaN },
    { feature_contract_version: 'legacy' }, { adr_unit: 'VND' }, { caveats: null }]) {
    response = { ...valid, ...change };
    await assert.rejects(service.decide({}), error => error.getStatus() === 502);
  }
  axios.request = async () => { throw new Error('offline'); };
  await assert.rejects(service.decide({}), error => error.getStatus() === 503);
  axios.request = async () => { throw { isAxiosError: true, response: { status: 422 } }; };
  await assert.rejects(service.decide({}), error => error.getStatus() === 400);
  console.log('PASS academic boundary: valid response; invalid probability/number/version/unit/caveats rejected; outage 503; upstream input rejection 400.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { axios.request = original; });
