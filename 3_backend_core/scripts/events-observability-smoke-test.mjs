import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { Kafka, logLevel } from 'kafkajs';
import { createClient } from 'redis';
import { waitForApi } from './test-helpers.mjs';

const apiBase = (process.env.API_BASE_URL ?? 'http://localhost/api/v1/core').replace(/\/$/, '');
const topic = process.env.KAFKA_DOMAIN_EVENTS_TOPIC ?? 'hotel.domain-events.v1';
const brokers = (process.env.KAFKA_BROKERS ?? process.env.KAFKA_BROKER ?? 'localhost:9092')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const cacheKey = 'hotelai:room-types:v1';
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const password = 'Password123!';
const emails = {
  admin: `events-admin-${runId}@example.com`,
  customer: `events-customer-${runId}@example.com`,
};

const database = new pg.Client({
  host: process.env.DB_HOST === 'postgres' ? 'localhost' : (process.env.DB_HOST ?? 'localhost'),
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? process.env.DB_USER ?? 'hotel_admin',
  password: process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.POSTGRES_DB ?? process.env.DB_NAME ?? 'hotel_db',
});
const redis = createClient({ url: redisUrl });
redis.on('error', () => undefined);
const kafka = new Kafka({
  clientId: `hotelai-events-smoke-${runId}`,
  brokers,
  connectionTimeout: 3_000,
  requestTimeout: 10_000,
  logLevel: logLevel.NOTHING,
});
const kafkaAdmin = kafka.admin();
const consumer = kafka.consumer({ groupId: `hotelai-events-smoke-${runId}` });
const state = {
  customerIds: [],
  bookingId: null,
  roomTypeId: null,
  originalBasePrice: null,
  roomPriceRestored: false,
  consumerConnected: false,
};

function ensure(condition, message) {
  if (!condition) throw new Error(message);
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

async function register(label, email) {
  const result = await request('/auth/register', {
    method: 'POST',
    json: { full_name: label, email, password },
  });
  ensure(result.response.status === 201, `Registration ${email} returned ${result.response.status}.`);
  state.customerIds.push(result.body.user.id);
  return result.body;
}

async function poll(check, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${message}${lastError instanceof Error ? ` (${lastError.message})` : ''}`);
}

async function cleanup() {
  if (state.consumerConnected) {
    await consumer.stop().catch(() => undefined);
    await consumer.disconnect().catch(() => undefined);
    state.consumerConnected = false;
  }
  await kafkaAdmin.disconnect().catch(() => undefined);

  try {
    if (
      !state.roomPriceRestored
      && state.roomTypeId !== null
      && state.originalBasePrice !== null
    ) {
      await database.query(
        'UPDATE room_types SET base_price = $2 WHERE type_id = $1',
        [state.roomTypeId, state.originalBasePrice],
      );
    }
    if (redis.isReady) await redis.del(cacheKey).catch(() => undefined);

    await database.query('BEGIN');
    const aggregateIds = [
      ...state.customerIds,
      ...(state.bookingId ? [state.bookingId] : []),
    ];
    if (aggregateIds.length) {
      await database.query(
        'DELETE FROM event_outbox WHERE aggregate_id = ANY($1::text[])',
        [aggregateIds],
      );
    }
    if (state.bookingId) {
      await database.query('DELETE FROM payment_transactions WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM daily_pricing_logs WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM booking_details WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM bookings WHERE booking_id = $1::uuid', [state.bookingId]);
    }
    if (state.customerIds.length) {
      await database.query(
        'DELETE FROM customer_account_audits WHERE customer_id = ANY($1::uuid[]) OR changed_by = ANY($1::uuid[])',
        [state.customerIds],
      );
      await database.query('DELETE FROM customers WHERE customer_id = ANY($1::uuid[])', [state.customerIds]);
    }
    await database.query('COMMIT');
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined);
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }

  if (redis.isOpen) await redis.quit().catch(() => undefined);
  await database.end().catch(() => undefined);
}

await waitForApi(apiBase);
await database.connect();
await redis.connect();
await kafkaAdmin.connect();

try {
  await kafkaAdmin.createTopics({
    waitForLeaders: true,
    topics: [{ topic, numPartitions: 1, replicationFactor: 1 }],
  });

  const admin = await register('Events Smoke Admin', emails.admin);
  const customer = await register('Events Smoke Customer', emails.customer);
  await database.query(
    `UPDATE customers SET role = 'admin', updated_at = CURRENT_TIMESTAMP
     WHERE customer_id = $1::uuid`,
    [admin.user.id],
  );

  await redis.del(cacheKey);
  const firstRooms = await request('/rooms');
  ensure(firstRooms.response.status === 200 && firstRooms.body?.data?.length, 'Room catalog request failed.');
  const roomType = firstRooms.body.data.find((item) => item.total_rooms > 0);
  ensure(roomType, 'No room type with inventory is available.');
  state.roomTypeId = roomType.type_id;
  state.originalBasePrice = Number(roomType.base_price);
  ensure(await redis.get(cacheKey), 'Room catalog was not written to Redis.');
  ensure((await redis.ttl(cacheKey)) > 0, 'Room catalog cache has no expiration.');

  const temporaryBasePrice = state.originalBasePrice + 1;
  const updateRoomType = await request(`/admin/room-types/${state.roomTypeId}`, {
    method: 'PATCH',
    token: admin.access_token,
    json: { base_price: temporaryBasePrice },
  });
  ensure(updateRoomType.response.status === 200, `Room type update returned ${updateRoomType.response.status}.`);
  ensure((await redis.get(cacheKey)) === null, 'Admin catalog update did not invalidate Redis.');

  const updatedRooms = await request('/rooms');
  ensure(
    Number(updatedRooms.body?.data?.find((item) => item.type_id === state.roomTypeId)?.base_price)
      === temporaryBasePrice,
    'Room catalog did not repopulate with the updated price.',
  );
  ensure(await redis.get(cacheKey), 'Updated room catalog was not cached again.');

  const restoreRoomType = await request(`/admin/room-types/${state.roomTypeId}`, {
    method: 'PATCH',
    token: admin.access_token,
    json: { base_price: state.originalBasePrice },
  });
  ensure(restoreRoomType.response.status === 200, 'Room type price restoration failed.');
  state.roomPriceRestored = true;
  ensure((await redis.get(cacheKey)) === null, 'Price restoration did not invalidate Redis.');
  await request('/rooms');

  const year = new Date().getUTCFullYear() + 40 + (Number.parseInt(runId.slice(0, 4), 16) % 900);
  const booking = await request('/bookings', {
    method: 'POST',
    token: customer.access_token,
    json: {
      room_type_id: state.roomTypeId,
      check_in_date: `${year}-10-10`,
      check_out_date: `${year}-10-12`,
      total_of_special_requests: 1,
    },
  });
  ensure(booking.response.status === 201, `Event booking returned ${booking.response.status}.`);
  state.bookingId = booking.body?.data?.booking?.booking_id;
  ensure(state.bookingId, 'Event booking did not return an ID.');

  const cancellation = await request(`/bookings/${state.bookingId}/cancel`, {
    method: 'PATCH',
    token: customer.access_token,
  });
  ensure(cancellation.response.status === 200, `Event booking cancellation returned ${cancellation.response.status}.`);

  const outboxRows = await poll(async () => {
    const result = await database.query(
      `SELECT event_id, aggregate_type, aggregate_id, event_type, payload,
              attempts, published_at, last_error
       FROM event_outbox
       WHERE aggregate_id = ANY($1::text[])
       ORDER BY occurred_at ASC, event_id ASC`,
      [[...state.customerIds, state.bookingId]],
    );
    return result.rows.length === 4 && result.rows.every((row) => row.published_at) ? result.rows : null;
  }, 20_000, 'Outbox events were not acknowledged by Kafka.');

  const eventTypes = outboxRows.map((row) => row.event_type);
  ensure(eventTypes.filter((value) => value === 'customer.registered.v1').length === 2, 'Registration events are incomplete.');
  ensure(eventTypes.includes('booking.created.v1'), 'booking.created.v1 is missing.');
  ensure(eventTypes.includes('booking.canceled.v1'), 'booking.canceled.v1 is missing.');
  ensure(new Set(outboxRows.map((row) => row.event_id)).size === 4, 'Outbox event IDs are not unique.');
  ensure(outboxRows.every((row) => Number(row.attempts) >= 1 && row.last_error === null), 'Published outbox state is invalid.');
  const serializedPayloads = JSON.stringify(outboxRows.map((row) => row.payload));
  ensure(!serializedPayloads.includes(password), 'A domain event leaked a password.');
  ensure(!serializedPayloads.includes(emails.admin) && !serializedPayloads.includes(emails.customer), 'A domain event leaked an email address.');

  const expectedIds = new Set(outboxRows.map((row) => row.event_id));
  const consumed = new Map();
  await consumer.connect();
  state.consumerConnected = true;
  await consumer.subscribe({ topic, fromBeginning: true });
  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const envelope = JSON.parse(message.value?.toString('utf8') ?? 'null');
        if (!expectedIds.has(envelope?.event_id)) return;
        consumed.set(envelope.event_id, {
          envelope,
          headerEventId: message.headers?.['event-id']?.toString('utf8'),
        });
      } catch {
        // Ignore unrelated malformed messages; assertions target this run's event IDs.
      }
    },
  });
  await poll(
    () => consumed.size === expectedIds.size,
    20_000,
    'Kafka consumer did not observe every outbox event.',
  );
  ensure(
    [...consumed.values()].every(({ envelope, headerEventId }) => envelope.event_id === headerEventId),
    'Kafka event-id headers do not match their envelopes.',
  );
  await consumer.stop();
  await consumer.disconnect();
  state.consumerConnected = false;

  const health = await request('/health/ready');
  ensure(health.response.status === 200 && health.body?.status === 'ok', 'Backend readiness is not healthy.');
  ensure(
    Object.values(health.body.dependencies ?? {}).every((status) => status === 'ok'),
    `A dependency is not ready: ${JSON.stringify(health.body?.dependencies)}.`,
  );
  ensure(health.body?.outbox?.pending === 0, 'Readiness reports unpublished events.');

  const requestIdInput = `events-${runId}`;
  const requestIdResponse = await fetch(`${apiBase}/health/live`, {
    headers: { 'x-request-id': requestIdInput },
  });
  const requestId = requestIdResponse.headers.get('x-request-id') ?? '';
  ensure(requestIdResponse.status === 200, 'Liveness endpoint failed.');
  ensure(!requestId.includes(',') && /^[A-Za-z0-9._:-]{8,100}$/.test(requestId), 'Response request ID is missing or duplicated.');

  const metricsResponse = await fetch(`${apiBase}/metrics`);
  const metrics = await metricsResponse.text();
  ensure(metricsResponse.status === 200, 'Metrics endpoint failed.');
  for (const metric of [
    'hotelai_http_requests_total',
    'hotelai_http_request_duration_seconds',
    'hotelai_outbox_published_total',
    'hotelai_outbox_pending 0',
  ]) {
    ensure(metrics.includes(metric), `Metrics output is missing ${metric}.`);
  }

  console.log(JSON.stringify({
    status: 'ok',
    cache: { populated: true, invalidated: true, ttl: true },
    outbox_events: outboxRows.length,
    kafka_events_consumed: consumed.size,
    dependencies: health.body.dependencies,
    request_id: requestId,
  }));
} finally {
  await cleanup();
}
