import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

if (process.env.AI_SHADOW_SMOKE_ALLOW_MUTATION !== 'true') {
  throw new Error('Set AI_SHADOW_SMOKE_ALLOW_MUTATION=true only for an isolated test database.');
}

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000/api/v1/core';
const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

async function setShadowEnabled(expectedVersion, shadowEnabled, reason) {
  await database.query('BEGIN');
  try {
    await database.query(
      `SELECT set_config('hotelai.ai_shadow_change_reason', $1, TRUE)`,
      [reason],
    );
    const result = await database.query(
      `UPDATE ai_pricing_shadow_settings
       SET shadow_enabled = $1,
           version = version + 1
       WHERE setting_id = 1 AND version = $2
       RETURNING shadow_enabled, version`,
      [shadowEnabled, expectedVersion],
    );
    ensure(result.rowCount === 1, 'Shadow policy changed concurrently during fail-open smoke.');
    await database.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

await waitForApi(baseUrl);
await database.connect();

try {
  let policy = (await database.query(
    `SELECT shadow_enabled,
            version,
            champion_model_version,
            challenger_model_version
     FROM ai_pricing_shadow_settings
     WHERE setting_id = 1`,
  )).rows[0];
  ensure(
    policy?.champion_model_version && policy?.challenger_model_version,
    'Fail-open smoke requires configured champion/challenger lineage.',
  );
  const policyAutoEnabled = policy.shadow_enabled !== true;
  if (policyAutoEnabled) {
    policy = await setShadowEnabled(
      Number(policy.version),
      true,
      'Enable isolated fail-open shadow smoke evaluation',
    );
  }
  const roomResponse = await fetch(`${baseUrl}/rooms`);
  const rooms = await roomResponse.json();
  ensure(roomResponse.ok && rooms.data?.length > 0, 'Room catalog is unavailable.');
  const year = new Date().getUTCFullYear() + 30;
  const quoteResponse = await fetch(`${baseUrl}/pricing/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      room_type_id: rooms.data[0].type_id,
      check_in_date: `${year}-11-10`,
      check_out_date: `${year}-11-12`,
      guest_count: 1,
      total_of_special_requests: 0,
    }),
  });
  const quoteBody = await quoteResponse.json();
  ensure(
    quoteResponse.status === 201 && quoteBody.data?.quote_id,
    `Champion quote did not fail open: ${quoteResponse.status} ${JSON.stringify(quoteBody)}`,
  );
  const quote = quoteBody.data;
  ensure(
    Number(quote.nightly_price)
      === Math.round(Number(quote.room_type.base_price) * Number(quote.ai_multiplier) * 100) / 100,
    'Fail-open path changed the customer-facing champion price.',
  );
  const ledger = await database.query(
    `SELECT attempt.outcome, attempt.error_code, decision.decision_id
     FROM ai_pricing_shadow_attempts attempt
     LEFT JOIN ai_pricing_shadow_decisions decision
       ON decision.attempt_id = attempt.attempt_id
     WHERE attempt.quote_id = $1::uuid`,
    [quote.quote_id],
  );
  ensure(ledger.rowCount === 1, 'Failed shadow inference did not record an attempt.');
  ensure(
    ['unavailable', 'timeout', 'error'].includes(ledger.rows[0].outcome),
    `Unexpected fail-open outcome: ${ledger.rows[0].outcome}.`,
  );
  ensure(ledger.rows[0].decision_id === null, 'Failed shadow attempt created a decision.');
  console.log(JSON.stringify({
    status: 'ok',
    quote_id: quote.quote_id,
    customer_price_unchanged: true,
    shadow_outcome: ledger.rows[0].outcome,
    error_code: ledger.rows[0].error_code,
    decision_created: false,
    policy_auto_enabled: policyAutoEnabled,
  }));
} finally {
  try {
    const current = (await database.query(
      `SELECT shadow_enabled, version
       FROM ai_pricing_shadow_settings
       WHERE setting_id = 1`,
    )).rows[0];
    if (current?.shadow_enabled === true) {
      await setShadowEnabled(
        Number(current.version),
        false,
        'Pause shadow policy after isolated fail-open smoke',
      );
    }
  } catch (error) {
    console.error(
      `WARNING: unable to pause shadow policy during cleanup: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  await database.end().catch(() => undefined);
}
