// Exercise Wave 4 Admin Shadow Control, Drift Monitoring & Explain-Price units without HTTP or DB.
// Run: node scripts/ai-shadow-drift-unit-check.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
const swc = requireFrontend('next/dist/build/swc');

const nodes = (tree) =>
  !tree || typeof tree !== 'object'
    ? []
    : Array.isArray(tree)
      ? tree.flatMap(nodes)
      : [tree, ...nodes(tree.props?.children)];

const textOf = (tree) =>
  tree == null || typeof tree === 'boolean'
    ? ''
    : Array.isArray(tree)
      ? tree.map(textOf).join(' ')
      : typeof tree === 'object'
        ? textOf(tree.props?.children)
        : String(tree);

function load(relativePath, mocks = {}) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = (id) => (Object.hasOwn(mocks, id) ? mocks[id] : requireFrontend(id));
  loaded._compile(
    swc.transformSync(fs.readFileSync(filename, 'utf8'), {
      filename,
      jsc: {
        parser: { syntax: 'typescript', tsx: filename.endsWith('.tsx') },
        target: 'es2022',
        transform: { react: { runtime: 'automatic' } },
      },
      module: { type: 'commonjs' },
    }).code,
    filename,
  );
  return loaded.exports;
}

const coreApi = load('src/services/core-api.ts');

async function testAdminServiceWave4Endpoints() {
  const calls = [];
  const originals = { fetch: global.fetch, window: global.window };
  global.window = { dispatchEvent: () => {} };

  const adminService = load('src/services/admin.service.ts', {
    '@/services/axiosClient': { apiBaseUrl: '/api/v1/core' },
    '@/services/auth.service': { clearSession: () => {} },
    '@/services/core-api': coreApi,
  });

  let nextPayload = {};
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ status: 'success', data: nextPayload }), { status: 200 });
  };

  try {
    nextPayload = { version: 1, shadow_enabled: false, mode: 'shadow_only', automatic_promotion: false };
    const settings = await adminService.getAiShadowSettings('cookie-marker');
    assert.equal(settings.version, 1);
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/settings');

    nextPayload = { ...settings, version: 2 };
    await adminService.updateAiShadowSettings('cookie-marker', {
      expected_version: 1,
      change_reason: 'Update guardrails for shadow verification',
      guardrail_max_change_ratio: 0.15,
    });
    assert.equal(calls.at(-1).init.method, 'PATCH');
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/settings');

    await adminService.pauseAiShadow('cookie-marker', {
      expected_version: 2,
      change_reason: 'Pause shadow evaluation after test',
    });
    assert.equal(calls.at(-1).init.method, 'POST');
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/pause');

    await adminService.rollbackAiShadow('cookie-marker', {
      expected_version: 2,
      target_version: 1,
      change_reason: 'Rollback to clean baseline version',
    });
    assert.equal(calls.at(-1).init.method, 'POST');
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/rollback');

    await adminService.getAiShadowReadiness('cookie-marker');
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/readiness');

    nextPayload = [];
    await adminService.getAiShadowAudits('cookie-marker', 15);
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/audits?limit=15');

    await adminService.getAiShadowRuntimeStatus('cookie-marker');
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/shadow/runtime-status');

    await adminService.getAdminPricingDrift('cookie-marker', 250);
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/drift?sample_size=250');

    nextPayload = { available: false, status_code: 503, reason_vi: '503 controlled' };
    const explain = await adminService.explainPricingSample('cookie-marker', {
      lead_time: 14,
      check_in_date: '2026-12-01',
      check_out_date: '2026-12-03',
      guest_count: 2,
    });
    assert.equal(explain.available, false);
    assert.equal(explain.status_code, 503);
    assert.equal(calls.at(-1).init.method, 'POST');
    assert.equal(calls.at(-1).url, '/api/v1/core/admin/pricing/explain-sample');
  } finally {
    global.fetch = originals.fetch;
    if (originals.window === undefined) delete global.window;
    else global.window = originals.window;
  }
}

function createReactHarness() {
  const slots = [];
  let cursor = 0;
  let dirty = false;
  let effects = [];
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  return {
    resetCursor() {
      cursor = 0;
      dirty = false;
      effects = [];
    },
    get isDirty() {
      return dirty;
    },
    flushEffects() {
      for (const { index, effect, deps } of effects) {
        slots[index]?.cleanup?.();
        slots[index] = { deps, cleanup: effect() };
      }
    },
    react: {
      useState(initial) {
        const idx = cursor++;
        if (!(idx in slots)) slots[idx] = { value: typeof initial === 'function' ? initial() : initial };
        return [
          slots[idx].value,
          (update) => {
            const next = typeof update === 'function' ? update(slots[idx].value) : update;
            if (!Object.is(next, slots[idx].value)) {
              slots[idx].value = next;
              dirty = true;
            }
          },
        ];
      },
      useMemo(fn, deps) {
        const idx = cursor++;
        if (!equal(slots[idx]?.deps, deps)) slots[idx] = { deps, value: fn() };
        return slots[idx].value;
      },
      useCallback(fn) {
        return fn;
      },
      useRef(initial) {
        const idx = cursor++;
        if (!(idx in slots)) slots[idx] = { current: initial };
        return slots[idx];
      },
      useEffect(effect, deps) {
        const idx = cursor++;
        if (!equal(slots[idx]?.deps, deps)) effects.push({ index: idx, effect, deps });
      },
    },
  };
}

function testAiPriceExplanationTruthfulness() {
  const harness = createReactHarness();
  const mod = load('src/components/features/booking/AiPriceExplanation.tsx', {
    react: harness.react,
    'lucide-react': new Proxy({}, { get: (_, name) => name }),
    '@/components/ui': { Badge: 'Badge' },
    '@/utils/formatCurrency': { formatCurrency: (n) => `${Math.round(n)} đ` },
  });

  harness.resetCursor();
  const tree = mod.default({
    explanation: {
      primary_driver: 'Tháng 7 & cuối tuần chiếm 100% ảnh hưởng',
      demand_share_pct: 0,
      temporal_share_pct: 100,
      attributions: [
        {
          feature: 'arrival_date_month',
          value: 7,
          attribution: 0.14,
          pct_contribution: 60,
          category: 'temporal',
          human_label: 'Tháng lưu trú',
          interpretation: 'Cao điểm mùa hè lịch sử Portugal.',
        },
      ],
      counterfactual: 'Đặt trước 60 ngày: -3.2%',
      ai_vs_script_note: 'Random Forest V2 Portugal benchmark.',
    },
    multiplier: 1.12,
    basePrice: 1200000,
    modelVersion: 'random_forest_v2',
    trainingRunId: 'dc2e163f5cd9b29d',
    featureContractVersion: '2.0.0',
    uncertainty: {
      method: 'split_conformal_normalized_abs_residual',
      calibration_rows: 9029,
      ensemble_p10: 0.9,
      ensemble_p50: 1.12,
      ensemble_p90: 1.34,
      ensemble_std: 0.14,
      conformal_alpha: 0.1,
      target_coverage: 0.9,
      empirical_holdout_coverage: 0.9002,
      conformal_low: 0.65,
      conformal_high: 1.75,
      ood_distance: 4.65,
      ood_p95_threshold: 4.23,
      ood_p99_threshold: 4.99,
      ood_status: 'border',
      ood_notes: ['Số đêm lưu trú (14 đêm) vượt ngưỡng 99% dữ liệu huấn luyện.'],
    },
    defaultExpanded: true,
  });
  const renderedText = textOf(tree);
  assert.match(renderedText, /\(A\) ML Benchmark Portugal V2/);
  assert.match(renderedText, /Saabas Tree Interpreter/);
  assert.match(renderedText, /Đặt trước 60 ngày: -3\.2%/);
  assert.match(renderedText, /Split Conformal\s+90\s*%\s+Interval/);
  assert.match(renderedText, /9,029/);
  assert.match(renderedText, /Mahalanobis OOD Gate/);
  assert.match(renderedText, /Vùng rìa \(Border\)/);
  assert.match(renderedText, /4\.650/);
  assert.match(renderedText, /vượt ngưỡng 99%/);
  assert.doesNotMatch(renderedText, /Theo giờ Real-time|đây là AI thực sự/);
}

async function testShadowDriftExplainPanelsRender() {
  const uiProxy = new Proxy({}, { get: (_, name) => name });
  const lucideProxy = new Proxy({}, { get: (_, name) => name });
  const flush = () => new Promise((r) => setImmediate(r));

  // 1. AiShadowControlPanel
  const shadowHarness = createReactHarness();
  const shadowPanel = load('src/components/features/admin/AiShadowControlPanel.tsx', {
    react: shadowHarness.react,
    'lucide-react': lucideProxy,
    '@/components/ui': uiProxy,
    '@/hooks/useAuth': { useAuth: () => ({ session: { accessToken: 'tok', user: { role: 'admin' } } }) },
    '@/services/admin.service': {
      AdminApiError: class extends Error {},
      getAiShadowSettings: async () => ({
        shadow_enabled: false,
        champion: { model_version: null, training_run_id: null, feature_contract_version: null },
        challenger: { model_version: null, training_run_id: null, feature_contract_version: null },
        guardrails: { minimum_multiplier: 0.5, maximum_multiplier: 3, maximum_change_ratio_from_champion: 0.2 },
        readiness_gates: {
          minimum_confirmed_exposures: 2000,
          minimum_conversions: 200,
          minimum_non_conversions: 200,
          minimum_shadow_days: 14,
          minimum_inference_coverage_ratio: 0.99,
          maximum_inference_error_ratio: 0.01,
        },
        version: 1,
        updated_at: '2026-11-12T00:00:00Z',
        updated_by: null,
        mode: 'shadow_only',
        automatic_promotion: false,
      }),
      getAiShadowReadiness: async () => ({
        control_version: 1,
        is_current_control: true,
        shadow_enabled: false,
        minimum_confirmed_exposures: 2000,
        minimum_conversions: 200,
        minimum_non_conversions: 200,
        minimum_shadow_days: 14,
        minimum_inference_coverage_ratio: 0.99,
        maximum_inference_error_ratio: 0.01,
        total_opportunity_quotes: 0,
        total_attempts: 0,
        in_window_attempts: 0,
        out_of_window_attempts: 0,
        succeeded_attempts: 0,
        succeeded_attempts_with_decisions: 0,
        orphan_succeeded_attempts: 0,
        failed_attempts: 0,
        lineage_mismatch_attempts: 0,
        inference_coverage_ratio: null,
        inference_error_ratio: null,
        total_decisions: 0,
        shadow_observation_days: 0,
        confirmed_exposure_decisions: 0,
        matured_labeled_decisions: 0,
        eligible_matured_decisions: 0,
        accepted_decisions: 0,
        non_accepted_decisions: 0,
        excluded_data_quality_decisions: 0,
        guardrail_adjusted_decisions: 0,
        mean_absolute_multiplier_delta: null,
        conversion_brier_score: null,
        readiness_status: 'paused',
        last_attempt_at: null,
        last_decision_at: null,
      }),
      getAiShadowRuntimeStatus: async () => ({
        mode: 'shadow_only',
        automatic_promotion: false,
        causality_warning: 'Cảnh báo quote.exposed.v1 test warning',
        champion_artifact: {
          status: 'ready',
          model_version: 'random_forest_v2',
          training_run_id: 'dc2e163f5cd9b29d',
          feature_contract_version: '2.0.0',
        },
        challenger_artifact: {
          status: 'unavailable',
          lifecycle_stage: null,
          model_version: null,
          training_run_id: null,
          feature_contract_version: null,
          reason_vi: '503 challenger unavailable fixture',
        },
        attempt_summary: {
          total_attempts: 0,
          succeeded_attempts: 0,
          failed_attempts: 0,
          unavailable_attempts: 0,
          timeout_attempts: 0,
          lineage_mismatch_attempts: 0,
          total_decisions: 0,
          last_attempt_at: null,
        },
      }),
      getAiShadowAudits: async () => [{
        audit_id: 'a1',
        setting_id: 1,
        shadow_enabled: false,
        champion_model_version: null,
        challenger_model_version: null,
        guardrail_min_multiplier: 0.5,
        guardrail_max_multiplier: 3,
        guardrail_max_change_ratio: 0.2,
        minimum_confirmed_exposures: 2000,
        minimum_conversions: 200,
        minimum_non_conversions: 200,
        minimum_shadow_days: 14,
        minimum_inference_coverage_ratio: 0.99,
        maximum_inference_error_ratio: 0.01,
        version: 1,
        change_reason: 'Initial shadow evaluation policy',
        changed_at: '2026-11-12T00:00:00Z',
        changed_by: null,
        is_current_control: true,
      }],
      updateAiShadowSettings: async () => {},
      pauseAiShadow: async () => {},
      rollbackAiShadow: async () => {},
    },
  });

  shadowHarness.resetCursor();
  let shadowTree = shadowPanel.AiShadowControlPanel({});
  shadowHarness.flushEffects();
  await flush();
  shadowHarness.resetCursor();
  shadowTree = shadowPanel.AiShadowControlPanel({});
  const shadowText = textOf(shadowTree);
  assert.match(shadowText, /mode: shadow_only/);
  assert.match(shadowText, /Auto-Promote: Tắt/);
  assert.match(shadowText, /Cảnh báo quote\.exposed\.v1 test warning/);
  assert.match(shadowText, /random_forest_v2/);
  assert.match(shadowText, /503 challenger unavailable fixture/);
  assert.doesNotMatch(shadowText, /Nâng cấp lên Champion|Ép Promote/i);

  // 2. AiDriftMonitorPanel
  const driftHarness = createReactHarness();
  const driftPanel = load('src/components/features/admin/AiDriftMonitorPanel.tsx', {
    react: driftHarness.react,
    'lucide-react': lucideProxy,
    '@/components/ui': uiProxy,
    '@/hooks/useAuth': { useAuth: () => ({ session: { accessToken: 'tok', user: { role: 'admin' } } }) },
    '@/services/admin.service': {
      getAdminPricingDrift: async () => ({
        status: 'ready',
        observation_source: 'live_pricing_quotes',
        baseline_source: 'portugal_v2_training_empirical',
        sample_count: 500,
        total_quotes_in_db: 2325,
        assessed_at: '2026-11-12T00:00:00Z',
        overall_status: 'degraded',
        total_features_monitored: 1,
        features_with_drift: 0,
        features_with_warning: 1,
        reports: [{
          feature: 'lead_time',
          psi: 0.145,
          status: 'warning',
          baseline_mean: 71.78,
          current_mean: 23.7,
          baseline_std: 79.34,
          current_std: 16,
          ks_stat: 0.312,
          ks_pvalue: 0.0021,
          wasserstein_distance: 48.08,
          baseline_median: 45,
          current_median: 19,
          baseline_rows: 36090,
          baseline_source: 'portugal_v2_training_empirical',
        }],
        recommendations: ['Theo doi them'],
        note_vi: 'Danh gia PSI tren 500 bao gia thuc',
      }),
    },
  });
  driftHarness.resetCursor();
  driftPanel.AiDriftMonitorPanel({});
  driftHarness.flushEffects();
  await flush();
  driftHarness.resetCursor();
  const driftText = textOf(driftPanel.AiDriftMonitorPanel({}));
  assert.match(driftText, /Báo giá thực PostgreSQL/);
  assert.match(driftText, /Portugal V2 Thực Nghiệm \(n=36,090\)/);
  assert.match(driftText, /500\s+\/\s+2325/);
  assert.match(driftText, /0\.1450/);
  assert.match(driftText, /0\.312/);
  assert.match(driftText, /48\.080/);
  assert.match(driftText, /Med \(p50\):\s*45\.00/);

  // 3. AdminExplainSamplePanel (controlled 503 state)
  const explainHarness = createReactHarness();
  const explainPanel = load('src/components/features/admin/AdminExplainSamplePanel.tsx', {
    react: explainHarness.react,
    'lucide-react': lucideProxy,
    '@/components/ui': uiProxy,
    '@/components/features/booking/AiPriceExplanation': { default: 'AiPriceExplanation' },
    '@/hooks/useAuth': { useAuth: () => ({ session: { accessToken: 'tok', user: { role: 'admin' } } }) },
    '@/services/admin.service': {
      explainPricingSample: async () => ({
        available: false,
        status_code: 503,
        reason_vi: 'Điểm cuối /api/v1/explain-price đang trả 503 có kiểm soát.',
      }),
    },
  });
  explainHarness.resetCursor();
  explainPanel.AdminExplainSamplePanel({});
  explainHarness.flushEffects();
  await flush();
  explainHarness.resetCursor();
  const explainText = textOf(explainPanel.AdminExplainSamplePanel({}));
  assert.match(explainText, /Khóa có kiểm soát \(HTTP\s+503\s*\)/);
  assert.match(explainText, /503 có kiểm soát/);
}

(async () => {
  await testAdminServiceWave4Endpoints();
  testAiPriceExplanationTruthfulness();
  await testShadowDriftExplainPanelsRender();
  console.log('PASS: Wave 4 shadow control, drift monitoring, explain-price truthfulness, and service boundaries.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
