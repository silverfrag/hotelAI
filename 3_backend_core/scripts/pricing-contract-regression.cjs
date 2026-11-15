// Exercise the compiled request/response boundary without touching a database.
const assert = require('node:assert/strict');
const axios = require('axios');
const { PricingService } = require('../dist/modules/pricing/pricing.service.js');

const input = {
  lead_time: 21, check_in_date: '2026-08-14',
  check_out_date: '2026-08-17', guest_count: 2,
};
const response = {
  status: 'success', ai_multiplier: 1.2, model_version: 'benchmark-v2',
  training_run_id: 'boundary-fixture', feature_contract_version: '2.0.0',
  features: {
    lead_time: 21, arrival_month_sin: -0.5, arrival_month_cos: -0.8660254038,
    arrival_weekday_sin: -0.4338837391, arrival_weekday_cos: -0.9009688679,
    stay_nights: 3, weekend_nights: 2, weekend_share: 0.6666666667, guest_count: 2,
  },
};
const config = {
  get: (_key, fallback) => fallback,
  getOrThrow: () => 'http://fixture.invalid/api/v1/predict-price',
};
const service = new PricingService({}, config, {});
const originalPost = axios.post;
let calls = 0;
let returned = response;
axios.post = async (_url, body) => {
  calls++;
  assert.deepEqual(body, input, 'V2 requests must not include unsupported demand fields');
  return { data: returned };
};

(async () => {
  const result = await service.getAiPrediction({ ...input, occupancy_ratio: 0.9, rooms_available: 1, rooms_sellable: 10 });
  assert.equal(result.multiplier, 1.2);
  assert.equal(result.featureContractVersion, '2.0.0');
  returned = { ...response, feature_contract_version: '3.0.0' };
  await assert.rejects(service.getAiPrediction(input), error => error.getStatus() === 503);
  returned = { ...response, features: { ...response.features, guest_count: 4 } };
  await assert.rejects(service.getAiPrediction(input), error => error.getStatus() === 503);
  assert.equal(calls, 3);
  console.log('PASS: V2 request compatibility; experimental contract rejected; mismatched quote context rejected.');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { axios.post = originalPost; });
