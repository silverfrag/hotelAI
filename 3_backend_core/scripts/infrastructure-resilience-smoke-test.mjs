import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const apiBase = (process.env.API_BASE_URL ?? 'http://localhost/api/v1/core').replace(/\/$/, '');
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const email = `resilience-${runId}@example.com`;
const password = 'Password123!';
const database = new pg.Client({
  host: process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST ?? 'localhost'),
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? process.env.DB_USER ?? 'hotel_admin',
  password: process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.POSTGRES_DB ?? process.env.DB_NAME ?? 'hotel_db',
});
const state = {
  customerId: null,
  redisStopped: false,
  kafkaStopped: false,
};

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function compose(args, { quiet = false } = {}) {
  const file = process.env.SMOKE_COMPOSE_FILE;
  if (!file) throw new Error('SMOKE_COMPOSE_FILE must explicitly identify the disposable outage-test stack.');
  const result = spawnSync('docker', ['compose', '-f', file, ...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (!quiet && result.stdout) process.stdout.write(result.stdout);
  if (result.status !== 0) {
    throw new Error(`docker compose ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

async function request(path, { token, json, ...init } = {}) {
  const headers = new Headers(init.headers);
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (json !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
    body: json === undefined ? init.body : JSON.stringify(json),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function poll(check, timeoutMs, message, intervalMs = 500) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${message}${lastError instanceof Error ? ` (${lastError.message})` : ''}`);
}

async function dependencyStatus(name, expected, timeoutMs) {
  return poll(async () => {
    const health = await request('/health/ready');
    if (health.response.status !== 200) return null;
    return health.body?.dependencies?.[name] === expected ? health.body : null;
  }, timeoutMs, `${name} did not become ${expected}.`);
}

async function cleanup() {
  let recoveryFailed = false;
  if (state.redisStopped) {
    try {
      compose(['start', 'redis']);
      state.redisStopped = false;
    } catch (error) {
      recoveryFailed = true;
      console.error(`Redis recovery warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (state.kafkaStopped) {
    try {
      compose(['start', 'kafka']);
      state.kafkaStopped = false;
    } catch (error) {
      recoveryFailed = true;
      console.error(`Kafka recovery warning: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  try {
    const customer = state.customerId
      ? { customer_id: state.customerId }
      : (await database.query('SELECT customer_id FROM customers WHERE email = $1', [email])).rows[0];
    if (customer?.customer_id) {
      await database.query('BEGIN');
      await database.query('DELETE FROM event_outbox WHERE aggregate_id = $1', [customer.customer_id]);
      await database.query(
        'DELETE FROM customer_account_audits WHERE customer_id = $1::uuid OR changed_by = $1::uuid',
        [customer.customer_id],
      );
      await database.query('DELETE FROM customers WHERE customer_id = $1::uuid', [customer.customer_id]);
      await database.query('COMMIT');
    }
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  await database.end().catch(() => undefined);
  if (recoveryFailed) process.exitCode = 1;
}

await waitForApi(apiBase);
await database.connect();

try {
  const initialRooms = await request('/rooms');
  ensure(initialRooms.response.status === 200 && initialRooms.body?.data?.length, 'Initial room catalog failed.');

  compose(['stop', 'redis']);
  state.redisStopped = true;
  const redisDegraded = await dependencyStatus('redis', 'unavailable', 20_000);
  ensure(redisDegraded.status === 'degraded', 'Redis outage did not put readiness in degraded state.');
  ensure(redisDegraded.dependencies.database === 'ok', 'Redis outage affected database readiness.');

  const roomsWithoutRedis = await request('/rooms');
  ensure(
    roomsWithoutRedis.response.status === 200
      && roomsWithoutRedis.body?.data?.length === initialRooms.body.data.length,
    'Room catalog did not fall back to PostgreSQL while Redis was unavailable.',
  );
  compose(['start', 'redis']);
  state.redisStopped = false;
  await dependencyStatus('redis', 'ok', 30_000);

  compose(['stop', 'kafka']);
  state.kafkaStopped = true;
  const kafkaDegraded = await dependencyStatus('kafka', 'unavailable', 25_000);
  ensure(kafkaDegraded.status === 'degraded', 'Kafka outage did not put readiness in degraded state.');
  ensure(kafkaDegraded.dependencies.database === 'ok', 'Kafka outage affected database readiness.');

  const registration = await request('/auth/register', {
    method: 'POST',
    json: { full_name: 'Infrastructure Resilience Smoke', email, password },
  });
  ensure(registration.response.status === 201, `Registration during Kafka outage returned ${registration.response.status}.`);
  state.customerId = registration.body?.user?.id;
  ensure(state.customerId, 'Registration during Kafka outage did not return a customer ID.');

  const profileUpdate = await request('/users/me', {
    method: 'PATCH',
    token: registration.body?.access_token,
    json: {
      full_name: 'Infrastructure Resilience Updated',
      expected_version: 1,
    },
  });
  ensure(profileUpdate.response.status === 200, `Profile update during Kafka outage returned ${profileUpdate.response.status}.`);

  const orderedFailure = await poll(async () => {
    const result = await database.query(
      `SELECT event_id, event_type, attempts, published_at, next_attempt_at, last_error
       FROM event_outbox
       WHERE aggregate_type = 'customer'
         AND aggregate_id = $1
         AND event_type IN ('customer.registered.v1', 'customer.profile-updated.v1')
       ORDER BY occurred_at ASC, event_id ASC`,
      [state.customerId],
    );
    if (result.rows.length !== 2) return null;
    const registrationEvent = result.rows.find((row) => row.event_type === 'customer.registered.v1');
    const profileEvent = result.rows.find((row) => row.event_type === 'customer.profile-updated.v1');
    return registrationEvent
      && profileEvent
      && !registrationEvent.published_at
      && Number(registrationEvent.attempts) >= 2
      && registrationEvent.last_error
      && !profileEvent.published_at
      && Number(profileEvent.attempts) === 0
      ? { registrationEvent, profileEvent }
      : null;
  }, 35_000, 'Outbox did not retry the first aggregate event while holding its successor.');

  const roomsWithoutKafka = await request('/rooms');
  ensure(roomsWithoutKafka.response.status === 200, 'Core reads failed while Kafka was unavailable.');
  const liveness = await request('/health/live');
  ensure(liveness.response.status === 200 && liveness.body?.status === 'ok', 'Liveness failed during Kafka outage.');

  compose(['start', 'kafka']);
  state.kafkaStopped = false;
  await dependencyStatus('kafka', 'ok', 45_000);
  const recoveredEvents = await poll(async () => {
    const result = await database.query(
      `SELECT event_id, event_type, attempts, published_at, last_error
       FROM event_outbox
       WHERE event_id = ANY($1::uuid[])
       ORDER BY published_at ASC, event_id ASC`,
      [[orderedFailure.registrationEvent.event_id, orderedFailure.profileEvent.event_id]],
    );
    return result.rows.length === 2 && result.rows.every((row) => row.published_at) ? result.rows : null;
  }, 45_000, 'Outbox events were not published after Kafka recovered.');
  const recoveredRegistration = recoveredEvents.find((row) => row.event_type === 'customer.registered.v1');
  const recoveredProfile = recoveredEvents.find((row) => row.event_type === 'customer.profile-updated.v1');
  ensure(recoveredRegistration && recoveredProfile, 'Recovered outbox event types are incomplete.');
  ensure(Number(recoveredRegistration.attempts) >= 3, 'Recovered registration event does not show retries and success.');
  ensure(Number(recoveredProfile.attempts) === 1, 'Successor event was attempted before its predecessor recovered.');
  ensure(recoveredEvents.every((row) => row.last_error === null), 'Recovered events retained stale errors.');
  ensure(
    new Date(recoveredRegistration.published_at) <= new Date(recoveredProfile.published_at),
    'Events for one aggregate were published out of order.',
  );

  const finalHealth = await request('/health/ready');
  ensure(finalHealth.response.status === 200 && finalHealth.body?.status === 'ok', 'Readiness did not recover.');
  ensure(
    Object.values(finalHealth.body.dependencies ?? {}).every((status) => status === 'ok'),
    `Dependencies did not recover: ${JSON.stringify(finalHealth.body?.dependencies)}.`,
  );

  const metricsResponse = await fetch(`${apiBase}/metrics`);
  const metrics = await metricsResponse.text();
  ensure(
    metrics.includes('hotelai_outbox_publish_failures_total{event_type="customer.registered.v1"}'),
    'Outbox failure metric was not recorded.',
  );

  console.log(JSON.stringify({
    status: 'ok',
    redis_fail_open: true,
    kafka_fail_open: true,
    outbox_retry_attempts: Number(recoveredRegistration.attempts),
    aggregate_order_preserved: true,
    event_published_after_recovery: true,
    dependencies: finalHealth.body.dependencies,
  }));
} finally {
  await cleanup();
}
