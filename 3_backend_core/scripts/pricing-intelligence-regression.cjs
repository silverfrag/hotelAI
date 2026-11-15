// Read-only boundary regression. No environment file, server, or database needed.
require('reflect-metadata');
const assert = require('node:assert/strict');
const axios = require('axios');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { AdminPricingIntelligenceService } = require('../dist/modules/admin/admin-pricing-intelligence.service.js');
const { AdminPricingController } = require('../dist/modules/admin/admin-pricing.controller.js');
const { AdminAiShadowService } = require('../dist/modules/admin/admin-ai-shadow.service.js');
const { AdminAiShadowController } = require('../dist/modules/admin/admin-ai-shadow.controller.js');
const { PricingIntelligenceQueryDto } = require('../dist/modules/admin/dto/pricing-intelligence.dto.js');

const now = new Date();
const vietnamToday = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const tomorrow = new Date(Date.parse(`${vietnamToday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const rows = [
  { stay_date: vietnamToday, room_type_id: 1, room_type_name: 'Deluxe', sellable_rooms: 10,
    confirmed_rooms: 3, held_rooms: 2, operationally_blocked_rooms: 1, available_rooms: 4 },
  { stay_date: tomorrow, room_type_id: 1, room_type_name: 'Deluxe', sellable_rooms: 10,
    confirmed_rooms: 4, held_rooms: 0, operationally_blocked_rooms: 0, available_rooms: 6 },
  { stay_date: vietnamToday, room_type_id: 2, room_type_name: 'Empty type', sellable_rooms: 0,
    confirmed_rooms: 0, held_rooms: 0, operationally_blocked_rooms: 0, available_rooms: 0 },
];
const metadata = {
  model_version: 'random_forest_v2', feature_contract: { version: '2.0.0' },
  training_run_id: 'reviewed-run', source_file: '/private/training/source.csv',
  evaluation: { passes_baseline_gate: true },
};
let queryCalls = [];
let modelCalls = [];
let modelResponse = { status: 'ready', metadata };
let modelError = null;
let sourceError = null;
let aiUrl = 'http://model.fixture:58000/api/v1/predict-price?private=config';
const dataSource = {
  async query(sql, parameters) {
    queryCalls.push({ sql, parameters });
    if (sourceError) throw sourceError;
    return rows;
  },
};
const config = {
  get(key, fallback) {
    if (key === 'HOTEL_TIMEZONE') return 'Asia/Ho_Chi_Minh';
    if (key === 'AI_SERVICE_URL') return aiUrl;
    return fallback;
  },
};
const originalGet = axios.get;
axios.get = async (url, options) => {
  modelCalls.push({ url, options });
  if (modelError) throw modelError;
  return { data: modelResponse };
};
const service = new AdminPricingIntelligenceService(dataSource, config);
let checks = 0;
function passed() { checks++; }

(async () => {
  const result = await service.getIntelligence({ start_date: vietnamToday, days: 2 });
  assert.deepEqual(result.period, {
    start_date: vietnamToday,
    end_date: new Date(Date.parse(`${tomorrow}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
    days: 2,
  });
  assert.equal(result.timezone, 'Asia/Ho_Chi_Minh');
  assert.deepEqual(result.daily_inventory, rows);
  for (const row of result.daily_inventory) {
    assert.equal(row.sellable_rooms, row.confirmed_rooms + row.held_rooms + row.operationally_blocked_rooms + row.available_rooms);
  }
  passed();

  assert.deepEqual(queryCalls[0].parameters, [vietnamToday, 2, vietnamToday, result.generated_at]);
  const sql = queryCalls[0].sql;
  assert.match(sql, /generate_series\(0, \$2::integer - 1\)/);
  assert.match(sql, /LEFT JOIN rooms room/);
  assert.match(sql, /room\.current_status <> 'Maintenance'/);
  assert.equal((sql.match(/AND booking\.check_in_date <= day\.stay_date/g) || []).length, 2);
  assert.equal((sql.match(/AND booking\.check_out_date > day\.stay_date/g) || []).length, 2);
  assert.match(sql, /booking\.pending_expires_at > \$4::timestamptz/);
  assert.match(sql, /WHEN is_confirmed THEN 'confirmed'\s+WHEN is_held THEN 'held'/);
  assert.match(sql, /WHEN stay_date = \$3::date/);
  assert.equal((sql.match(/EXISTS \(/g) || []).length, 2);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/);
  passed();

  assert.equal(modelCalls[0].url, 'http://model.fixture:58000/api/v1/model-info');
  assert.ok(modelCalls[0].options.timeout > 0 && modelCalls[0].options.timeout <= 2_000);
  assert.equal(modelCalls[0].options.maxRedirects, 0);
  assert.ok(modelCalls[0].options.maxContentLength <= 131_072);
  assert.deepEqual(result.model, {
    status: 'ready', version: 'random_forest_v2', feature_contract_version: '2.0.0',
    training_run_id: 'reviewed-run', scope: 'historical_adr_benchmark', vietnam_validated: false,
  });
  assert.equal(result.forecast.status, 'not_available');
  assert.doesNotMatch(JSON.stringify(result), /private|passes_baseline_gate|model\.fixture/);
  passed();

  const defaults = await service.getIntelligence({});
  assert.equal(defaults.period.start_date, vietnamToday);
  assert.equal(defaults.period.days, 14);
  passed();

  for (const invalid of [
    { start_date: '2030-02-30', days: 2 },
    { start_date: '2030-1-01', days: 2 },
    { start_date: '2030-01-01T00:00:00Z', days: 2 },
    { start_date: '2020-01-01', days: 2 },
    { start_date: vietnamToday, days: 0 },
    { start_date: vietnamToday, days: 31 },
    { start_date: vietnamToday, days: 1.5 },
  ]) {
    const beforeQueries = queryCalls.length;
    const beforeModel = modelCalls.length;
    await assert.rejects(service.getIntelligence(invalid), error => error.getStatus() === 400);
    assert.equal(queryCalls.length, beforeQueries);
    assert.equal(modelCalls.length, beforeModel);
  }
  passed();

  const validated = plainToInstance(PricingIntelligenceQueryDto, { start_date: vietnamToday, days: '30' });
  assert.equal((await validate(validated)).length, 0);
  assert.equal(validated.days, 30);
  for (const raw of [{ days: '31' }, { days: '' }, { days: '1.5' }, { start_date: '2030-02-30' }, { start_date: '2030-01-01T00:00:00Z' }]) {
    assert.ok((await validate(plainToInstance(PricingIntelligenceQueryDto, raw))).length > 0);
  }
  passed();

  modelError = new Error('http://private-model/internal source at C:/private/model.pkl');
  const outage = await service.getIntelligence({ days: 1 });
  assert.deepEqual(outage.daily_inventory, rows);
  assert.equal(outage.model.status, 'unavailable');
  assert.equal(outage.model.version, null);
  assert.equal(outage.forecast.status, 'not_available');
  assert.doesNotMatch(JSON.stringify(outage), /private-model|internal|model\.pkl/);
  passed();

  modelError = null;
  modelResponse = { status: 'ready', metadata: { ...metadata, model_version: 'random_forest_v3', feature_contract: { version: '3.0.0' } } };
  const candidate = await service.getIntelligence({ days: 1 });
  assert.equal(candidate.model.status, 'ready');
  assert.equal(candidate.model.scope, 'unverified');
  assert.equal(candidate.model.vietnam_validated, false);
  passed();

  for (const unsafe of [
    { status: 'error', metadata },
    { status: 'ready', metadata: { ...metadata, feature_contract: {} } },
    { status: 'ready', metadata: { ...metadata, model_version: 'C:/private/model.pkl' } },
    { status: 'ready', metadata: { ...metadata, training_run_id: 'x'.repeat(129) } },
    { status: 'ready', metadata: null },
  ]) {
    modelResponse = unsafe;
    const response = await service.getIntelligence({ days: 1 });
    assert.equal(response.model.status, 'unavailable');
    assert.equal(response.model.version, null);
  }
  passed();

  const beforeMissingUrl = modelCalls.length;
  aiUrl = undefined;
  assert.equal((await service.getIntelligence({ days: 1 })).model.status, 'unavailable');
  aiUrl = 'file:///private/model';
  assert.equal((await service.getIntelligence({ days: 1 })).model.status, 'unavailable');
  assert.equal(modelCalls.length, beforeMissingUrl);
  passed();

  sourceError = new Error('database unavailable');
  await assert.rejects(service.getIntelligence({ days: 1 }), /database unavailable/);
  sourceError = null;
  passed();

  const controller = new AdminPricingController({}, service);
  assert.equal(Reflect.getMetadata('path', AdminPricingController), 'admin/pricing');
  assert.deepEqual(Reflect.getMetadata('roles', AdminPricingController), ['admin']);
  assert.equal(Reflect.getMetadata('__guards__', AdminPricingController).length, 2);
  assert.equal(Reflect.getMetadata('path', controller.getIntelligence), 'intelligence');
  assert.equal(Reflect.getMetadata('path', controller.getDrift), 'drift');
  assert.equal(Reflect.getMetadata('path', controller.explainSample), 'explain-sample');
  const envelope = await controller.getIntelligence({ days: 1 });
  assert.equal(envelope.status, 'success');
  assert.equal(envelope.data.forecast.status, 'not_available');
  passed();

  const originalPost = axios.post;
  aiUrl = 'http://model.fixture:58000/api/v1/predict-price';
  let postCalls = [];
  axios.post = async (url, body) => {
    postCalls.push({ url, body });
    if (url.endsWith('/api/v1/monitoring/evaluate-drift')) {
      return {
        data: {
          status: 'success',
          assessed_at: '2026-11-12T00:00:00Z',
          overall_status: 'healthy',
          baseline_source: 'portugal_v2_training_empirical',
          total_features_monitored: 1,
          features_with_drift: 0,
          features_with_warning: 0,
          reports: [{
            feature: 'lead_time', psi: 0.04, status: 'stable',
            baseline_mean: 71.78, current_mean: 19.0, baseline_std: 79.34, current_std: 13.5,
            ks_stat: 0.2412, ks_pvalue: 0.0315, wasserstein_distance: 52.78,
            baseline_median: 45.0, current_median: 15.5, baseline_rows: 36090,
            baseline_source: 'portugal_v2_training_empirical',
          }],
          recommendations: ['All clear'],
        },
      };
    }
    return {
      data: {
        status: 'success',
        ai_multiplier: 1.05,
        model_version: 'random_forest_v2',
        training_run_id: 'reviewed-run',
        feature_contract_version: '2.0.0',
        features: { lead_time: 14 },
        explanation: {
          primary_driver: 'Test driver',
          demand_share_pct: 0,
          temporal_share_pct: 100,
          attributions: [],
          counterfactual: 'CF',
          ai_vs_script_note: 'Note',
        },
      },
    };
  };
  try {
    const sampleQuotes = Array.from({ length: 12 }, (_, idx) => ({
      lead_time: 10 + idx, stay_nights: 2, guest_count: 2, occupancy_ratio: 0.5, weekend_share: 0.5,
    }));
    const driftDataSource = {
      async query(sql) {
        if (sql.includes('AS total_quotes')) return [{ total_quotes: 12 }];
        return sampleQuotes;
      },
    };
    const driftService = new AdminPricingIntelligenceService(driftDataSource, config);
    const driftController = new AdminPricingController({}, driftService);
    const driftEnvelope = await driftController.getDrift({ sample_size: 100 });
    assert.equal(driftEnvelope.status, 'success');
    assert.equal(driftEnvelope.data.status, 'ready');
    assert.equal(driftEnvelope.data.observation_source, 'live_pricing_quotes');
    assert.equal(driftEnvelope.data.baseline_source, 'portugal_v2_training_empirical');
    assert.equal(driftEnvelope.data.sample_count, 12);
    assert.equal(driftEnvelope.data.reports[0].ks_stat, 0.2412);
    assert.equal(driftEnvelope.data.reports[0].ks_pvalue, 0.0315);
    assert.equal(driftEnvelope.data.reports[0].wasserstein_distance, 52.78);
    assert.equal(driftEnvelope.data.reports[0].baseline_median, 45.0);
    assert.equal(driftEnvelope.data.reports[0].current_median, 15.5);
    assert.equal(driftEnvelope.data.reports[0].baseline_rows, 36090);
    assert.equal(postCalls[0].url, 'http://model.fixture:58000/api/v1/monitoring/evaluate-drift');
    passed();

    // Baseline fallback (<10 quotes) & outage fail-open
    axios.get = async (url) => {
      if (url.endsWith('/api/v1/monitoring/drift')) {
        return {
          data: {
            status: 'success',
            assessed_at: '2026-11-12T00:00:00Z',
            overall_status: 'healthy',
            total_features_monitored: 1,
            features_with_drift: 0,
            features_with_warning: 0,
            reports: [{
              feature: 'lead_time', psi: 0.02, status: 'stable',
              baseline_mean: 18.5, current_mean: 18.8, baseline_std: 14.2, current_std: 13.9,
            }],
            recommendations: ['Baseline ok'],
          },
        };
      }
      if (url.endsWith('/api/v1/conversion-model-info')) {
        const err = new Error('Conversion challenger unavailable');
        err.isAxiosError = true;
        err.response = { status: 503 };
        throw err;
      }
      return { data: { status: 'ready', metadata } };
    };
    const sparseService = new AdminPricingIntelligenceService({
      async query(sql) {
        if (sql.includes('AS total_quotes')) return [{ total_quotes: 3 }];
        return sampleQuotes.slice(0, 3);
      },
    }, config);
    const fallbackDrift = await sparseService.getDriftMonitoring({ sample_size: 50 });
    assert.equal(fallbackDrift.status, 'ready');
    assert.equal(fallbackDrift.observation_source, 'baseline_diagnostic_sample');
    assert.equal(fallbackDrift.sample_count, 3);
    assert.ok(Number.isFinite(fallbackDrift.reports[0].ks_stat));
    assert.ok(Number.isFinite(fallbackDrift.reports[0].wasserstein_distance));

    const outageAiConfig = { get: () => 'http://127.0.0.1:59999' };
    axios.post = async () => {
      const err = new Error('503 unvalidated');
      err.isAxiosError = true;
      err.response = { status: 503 };
      throw err;
    };
    const explainEnvelope = await driftController.explainSample({
      lead_time: 14,
      check_in_date: vietnamToday,
      check_out_date: tomorrow,
      guest_count: 2,
    });
    assert.equal(explainEnvelope.status, 'success');
    assert.equal(explainEnvelope.data.available, false);
    assert.equal(explainEnvelope.data.status_code, 503);

    // Also verify explain-sample happy path on real RF estimators response
    axios.post = async () => ({
      data: {
        status: 'success',
        ai_multiplier: 1.05,
        model_version: 'random_forest_v2',
        training_run_id: 'reviewed-run',
        feature_contract_version: '2.0.0',
        features: { lead_time: 14 },
        uncertainty: {
          method: 'split_conformal_normalized_abs_residual',
          calibration_rows: 9029,
          ensemble_p10: 0.91,
          ensemble_p50: 1.04,
          ensemble_p90: 1.21,
          ensemble_std: 0.11,
          conformal_alpha: 0.1,
          target_coverage: 0.9,
          empirical_holdout_coverage: 0.9002,
          conformal_low: 0.52,
          conformal_high: 1.66,
          ood_distance: 2.35,
          ood_p95_threshold: 4.233,
          ood_p99_threshold: 4.988,
          ood_status: 'in_distribution',
          ood_notes: [],
        },
        explanation: {
          primary_driver: 'Test driver',
          demand_share_pct: 0,
          temporal_share_pct: 100,
          attributions: [],
          counterfactual: 'CF',
          ai_vs_script_note: 'Note',
        },
      },
    });
    const explainOk = await driftController.explainSample({
      lead_time: 14,
      check_in_date: vietnamToday,
      check_out_date: tomorrow,
      guest_count: 2,
    });
    assert.equal(explainOk.status, 'success');
    assert.equal(explainOk.data.available, true);
    assert.equal(explainOk.data.explanation.temporal_share_pct, 100);
    assert.equal(explainOk.data.uncertainty.ood_status, 'in_distribution');
    assert.equal(explainOk.data.uncertainty.conformal_low, 0.52);
    assert.equal(explainOk.data.uncertainty.conformal_high, 1.66);
    assert.equal(explainOk.data.uncertainty.calibration_rows, 9029);
    passed();

    // AdminAiShadowController & AdminAiShadowService.getRuntimeStatus boundary check
    const shadowDataSource = {
      async query() {
        return [{
          total_attempts: 4,
          succeeded_attempts: 1,
          failed_attempts: 3,
          unavailable_attempts: 2,
          timeout_attempts: 1,
          lineage_mismatch_attempts: 0,
          total_decisions: 1,
          last_attempt_at: '2026-11-12T00:00:00Z',
        }];
      },
    };
    const shadowService = new AdminAiShadowService(shadowDataSource, config);
    const shadowController = new AdminAiShadowController(shadowService);
    assert.equal(Reflect.getMetadata('path', AdminAiShadowController), 'admin/pricing/shadow');
    assert.equal(Reflect.getMetadata('path', shadowController.runtimeStatus), 'runtime-status');
    const runtimeEnvelope = await shadowController.runtimeStatus();
    assert.equal(runtimeEnvelope.status, 'success');
    assert.equal(runtimeEnvelope.data.mode, 'shadow_only');
    assert.equal(runtimeEnvelope.data.automatic_promotion, false);
    assert.match(runtimeEnvelope.data.causality_warning, /quote\.exposed\.v1/);
    assert.equal(runtimeEnvelope.data.champion_artifact.status, 'ready');
    assert.equal(runtimeEnvelope.data.challenger_artifact.status, 'unavailable');
    assert.equal(runtimeEnvelope.data.attempt_summary.total_attempts, 4);
    assert.equal(runtimeEnvelope.data.attempt_summary.total_decisions, 1);
    const emptyOutageService = new AdminAiShadowService(shadowDataSource, outageAiConfig);
    axios.get = async () => { throw new Error('ECONNREFUSED'); };
    const shadowOutage = await emptyOutageService.getRuntimeStatus();
    assert.equal(shadowOutage.champion_artifact.status, 'unavailable');
    assert.equal(shadowOutage.challenger_artifact.status, 'unavailable');
    passed();
  } finally {
    axios.post = originalPost;
  }

  console.log(`PASS: ${checks} pricing intelligence checks (dates, read-only inventory query, DTO/admin boundary, model provenance and outage).`);
  console.log('Inventory SQL predicates inspected; this stub suite does not execute PostgreSQL or claim live inventory integration coverage.');
})().catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => { axios.get = originalGet; });
