import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

if (process.env.AI_SHADOW_SMOKE_ALLOW_MUTATION !== 'true') {
  throw new Error(
    'Refusing to run AI shadow smoke against an unconfirmed database. '
      + 'Set AI_SHADOW_SMOKE_ALLOW_MUTATION=true only for an isolated test database.',
  );
}

const { Client } = pg;
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1/core';
const conversionInfoUrl = process.env.AI_CONVERSION_INFO_URL
  ?? 'http://localhost:8000/api/v1/conversion-model-info';
const database = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function request(path, { token, json, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (json !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    body: json === undefined ? init.body : JSON.stringify(json),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

await waitForApi(baseUrl);
await database.connect();

const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const email = `ai-shadow-smoke-${runId}@example.invalid`;
const password = 'Password123!';

try {
  const registration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'AI Shadow Smoke Admin', email, password },
  });
  ensure(registration.response.status === 201, 'Could not register shadow smoke admin.');
  const actorId = registration.body?.user?.id;
  ensure(typeof actorId === 'string', 'Registration did not return an actor ID.');
  await database.query(
    `UPDATE customers SET role = 'admin' WHERE customer_id = $1::uuid`,
    [actorId],
  );
  const login = await request('/auth/login', {
    method: 'POST',
    json: { email, password },
  });
  const token = login.body?.access_token;
  ensure(login.response.status === 201 && typeof token === 'string', 'Admin login failed.');

  const rooms = await request('/rooms');
  ensure(rooms.response.ok && rooms.body?.data?.length > 0, 'Seed room catalog is empty.');
  const room = rooms.body.data[0];
  const year = new Date().getUTCFullYear() + 20;
  const quoteInput = {
    room_type_id: room.type_id,
    check_in_date: `${year}-10-10`,
    check_out_date: `${year}-10-12`,
    guest_count: 1,
    total_of_special_requests: 0,
  };
  const championQuote = await request('/pricing/quote', {
    method: 'POST',
    json: quoteInput,
  });
  ensure(championQuote.response.status === 201, 'Could not obtain champion lineage quote.');
  const champion = championQuote.body.data;
  ensure(
    champion.pricing_source === 'ai'
      && champion.ai_model_version
      && champion.ai_training_run_id
      && champion.ai_feature_contract_version,
    'Champion quote has no complete AI lineage.',
  );

  const modelInfoResponse = await fetch(conversionInfoUrl);
  const modelInfo = await modelInfoResponse.json();
  ensure(modelInfoResponse.ok, 'Conversion challenger model-info is unavailable.');
  const challenger = modelInfo.metadata;
  ensure(challenger.lifecycle_stage === 'shadow_only', 'Challenger is not shadow-only.');

  const initialPolicy = await request('/admin/pricing/shadow/settings', { token });
  ensure(initialPolicy.response.ok, 'Could not read initial shadow policy.');
  const enabledPolicy = await request('/admin/pricing/shadow/settings', {
    method: 'PATCH',
    token,
    json: {
      expected_version: initialPolicy.body.data.version,
      change_reason: 'Enable isolated end-to-end AI shadow smoke evaluation',
      shadow_enabled: true,
      champion_model_version: champion.ai_model_version,
      champion_training_run_id: champion.ai_training_run_id,
      champion_feature_contract_version: champion.ai_feature_contract_version,
      challenger_model_version: challenger.model_version,
      challenger_training_run_id: challenger.training_run_id,
      challenger_feature_contract_version: challenger.feature_contract.version,
      guardrail_min_multiplier: 0.5,
      guardrail_max_multiplier: 3,
      guardrail_max_change_ratio: 0.1,
      minimum_confirmed_exposures: 2,
      minimum_conversions: 1,
      minimum_non_conversions: 1,
      minimum_shadow_days: 1,
      minimum_inference_coverage_ratio: 0.99,
      maximum_inference_error_ratio: 0.01,
    },
  });
  ensure(enabledPolicy.response.status === 200, `Enable shadow failed: ${JSON.stringify(enabledPolicy.body)}`);
  ensure(enabledPolicy.body.data.shadow_enabled === true, 'Shadow policy was not enabled.');
  const noOpNumericPolicy = await request('/admin/pricing/shadow/settings', {
    method: 'PATCH',
    token,
    json: {
      expected_version: enabledPolicy.body.data.version,
      change_reason: 'Verify canonical decimal equality does not reset the shadow window',
      guardrail_min_multiplier: enabledPolicy.body.data.guardrails.minimum_multiplier,
    },
  });
  ensure(noOpNumericPolicy.response.status === 200, 'Numeric no-op policy update failed.');
  ensure(
    noOpNumericPolicy.body.data.version === enabledPolicy.body.data.version,
    'Numeric no-op unexpectedly incremented the shadow policy version.',
  );

  const shadowQuote = await request('/pricing/quote', {
    method: 'POST',
    json: { ...quoteInput, check_in_date: `${year}-10-13`, check_out_date: `${year}-10-15` },
  });
  ensure(shadowQuote.response.status === 201, `Shadow quote failed: ${JSON.stringify(shadowQuote.body)}`);
  const quote = shadowQuote.body.data;
  ensure(
    Number(quote.nightly_price)
      === Math.round(Number(quote.room_type.base_price) * Number(quote.ai_multiplier) * 100) / 100,
    'Shadow evaluation changed the customer-facing champion price.',
  );

  const ledger = await database.query(
    `SELECT attempt.outcome,
            decision.predicted_conversion_probability,
            decision.proposed_multiplier,
            decision.guardrailed_multiplier,
            decision.relative_price_delta_from_champion,
            decision.champion_multiplier
     FROM ai_pricing_shadow_attempts attempt
     LEFT JOIN ai_pricing_shadow_decisions decision
       ON decision.attempt_id = attempt.attempt_id
     WHERE attempt.quote_id = $1::uuid`,
    [quote.quote_id],
  );
  ensure(ledger.rowCount === 1, 'Shadow quote did not create exactly one attempt.');
  const decision = ledger.rows[0];
  ensure(decision.outcome === 'succeeded', `Shadow inference outcome was ${decision.outcome}.`);
  ensure(decision.predicted_conversion_probability !== null, 'Conversion probability was not persisted.');
  ensure(decision.proposed_multiplier !== null, 'Optimizer proposal was not persisted.');
  ensure(
    Math.abs(Number(decision.relative_price_delta_from_champion)) <= 0.100001,
    'Database guardrail allowed a delta above the configured limit.',
  );

  const exposed = await request(`/pricing/quotes/${quote.quote_id}/events`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `shadow-exposed:${quote.quote_id}` },
    json: {
      event_type: 'quote.exposed.v1',
      session_id: randomUUID(),
      search_id: randomUUID(),
    },
  });
  ensure(exposed.response.status === 201, 'Could not record explicit shadow quote exposure.');
  const rejected = await request(`/pricing/quotes/${quote.quote_id}/events`, {
    method: 'POST',
    headers: { 'Idempotency-Key': `shadow-rejected:${quote.quote_id}` },
    json: { event_type: 'quote.rejected.v1' },
  });
  ensure(rejected.response.status === 201, 'Could not mature the shadow quote label.');

  const readiness = await request('/admin/pricing/shadow/readiness', { token });
  ensure(readiness.response.ok, 'Shadow readiness endpoint failed.');
  ensure(readiness.body.data.inference_coverage_ratio === 1, 'Readiness coverage is not 100%.');
  ensure(readiness.body.data.non_accepted_decisions === 1, 'Explicit rejection was not labeled negative.');
  ensure(
    readiness.body.data.readiness_status === 'insufficient_confirmed_exposures',
    `Unexpected pre-pause readiness: ${readiness.body.data.readiness_status}.`,
  );

  const paused = await request('/admin/pricing/shadow/pause', {
    method: 'POST',
    token,
    json: {
      expected_version: enabledPolicy.body.data.version,
      change_reason: 'Pause isolated smoke policy after validating fail-open telemetry',
    },
  });
  ensure(paused.response.status === 201, `Pause endpoint failed: ${JSON.stringify(paused.body)}`);
  ensure(paused.body.data.shadow_enabled === false, 'Pause endpoint left shadow enabled.');

  const attemptsBeforePausedQuote = Number((await database.query(
    'SELECT COUNT(*)::int AS count FROM ai_pricing_shadow_attempts',
  )).rows[0].count);
  const pausedQuote = await request('/pricing/quote', {
    method: 'POST',
    json: { ...quoteInput, check_in_date: `${year}-10-16`, check_out_date: `${year}-10-18` },
  });
  ensure(pausedQuote.response.status === 201, 'Champion quote failed while shadow was paused.');
  const attemptsAfterPausedQuote = Number((await database.query(
    'SELECT COUNT(*)::int AS count FROM ai_pricing_shadow_attempts',
  )).rows[0].count);
  ensure(attemptsAfterPausedQuote === attemptsBeforePausedQuote, 'Paused shadow still called the challenger.');

  const rolledBack = await request('/admin/pricing/shadow/rollback', {
    method: 'POST',
    token,
    json: {
      expected_version: paused.body.data.version,
      target_version: enabledPolicy.body.data.version,
      change_reason: 'Validate rollback creates a new safely paused policy version',
    },
  });
  ensure(rolledBack.response.status === 201, `Rollback endpoint failed: ${JSON.stringify(rolledBack.body)}`);
  ensure(
    rolledBack.body.data.shadow_enabled === false
      && rolledBack.body.data.version > paused.body.data.version,
    'Rollback did not produce a new safely paused version.',
  );
  const audits = await request('/admin/pricing/shadow/audits?limit=10', { token });
  ensure(audits.response.ok && audits.body.data.length >= 4, 'Shadow policy audit history is incomplete.');

  console.log(JSON.stringify({
    status: 'ok',
    quote_id: quote.quote_id,
    attempt_outcome: decision.outcome,
    proposed_multiplier: Number(decision.proposed_multiplier),
    guardrailed_multiplier: Number(decision.guardrailed_multiplier),
    customer_price_unchanged: true,
    readiness_before_pause: readiness.body.data.readiness_status,
    pause_endpoint: true,
    numeric_noop_preserved_version: true,
    rollback_version: rolledBack.body.data.version,
  }));
} finally {
  await database.end().catch(() => undefined);
}
