import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';
await waitForApi(baseUrl);
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const password = 'Password123!';
const emails = {
  admin: `payment-admin-${runId}@example.com`,
  customer: `payment-customer-${runId}@example.com`,
  other: `payment-other-${runId}@example.com`,
};

const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});
const state = { customerIds: [], bookingId: null };

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

async function register(label, email) {
  const result = await request('/auth/register', {
    method: 'POST',
    json: { full_name: label, email, password },
  });
  ensure(result.response.status === 201, `Registration ${email} returned ${result.response.status}.`);
  state.customerIds.push(result.body.user.id);
  return result.body;
}

async function cleanup() {
  try {
    await database.query('BEGIN');
    const aggregateIds = [...state.customerIds, ...(state.bookingId ? [state.bookingId] : [])];
    if (aggregateIds.length) {
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'customer_id' = ANY($1::text[])
            OR payload->>'booking_id' = $2`,
        [aggregateIds, state.bookingId ?? ''],
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
    console.error(`Cleanup warning: ${error.message}`);
    process.exitCode = 1;
  }
}

await database.connect();
try {
  const admin = await register('Payment Smoke Admin', emails.admin);
  const customer = await register('Payment Smoke Customer', emails.customer);
  const other = await register('Payment Smoke Other', emails.other);
  await database.query(
    `UPDATE customers SET role = 'admin', updated_at = CURRENT_TIMESTAMP
     WHERE customer_id = $1::uuid`,
    [admin.user.id],
  );

  const rooms = await request('/rooms');
  ensure(rooms.response.status === 200 && rooms.body?.data?.length, 'Payment smoke needs one room type.');
  const uniqueYear = new Date().getUTCFullYear() + 30 + (Number.parseInt(runId.slice(0, 5), 16) % 1400);
  const booking = await request('/bookings', {
    method: 'POST',
    token: customer.access_token,
    json: {
      room_type_id: rooms.body.data[0].type_id,
      check_in_date: `${uniqueYear}-09-10`,
      check_out_date: `${uniqueYear}-09-13`,
      total_of_special_requests: 1,
    },
  });
  ensure(booking.response.status === 201, `Payment booking returned ${booking.response.status}.`);
  state.bookingId = booking.body?.data?.booking?.booking_id;
  const total = Number(booking.body?.data?.total_price);
  ensure(booking.body?.data?.payment_status === 'Unpaid' && booking.body?.data?.balance_due === total, 'New booking payment state is invalid.');

  const anonymousSummary = await request(`/bookings/${state.bookingId}/payment`);
  ensure(anonymousSummary.response.status === 401, `Anonymous payment summary returned ${anonymousSummary.response.status}.`);
  const otherSummary = await request(`/bookings/${state.bookingId}/payment`, { token: other.access_token });
  ensure(otherSummary.response.status === 404, `Other customer payment summary returned ${otherSummary.response.status}.`);
  const initialSummary = await request(`/bookings/${state.bookingId}/payment`, { token: customer.access_token });
  ensure(initialSummary.response.status === 200, 'Owner payment summary failed.');
  ensure(initialSummary.body?.data?.payment_status === 'Unpaid' && initialSummary.body?.data?.transactions?.length === 0, 'Initial ledger is not empty/unpaid.');

  const forbiddenPayment = await request(`/admin/bookings/${state.bookingId}/payments`, {
    method: 'POST',
    token: customer.access_token,
    json: { amount: total, method: 'Cash', idempotency_key: `payment:${runId}:forbidden` },
  });
  ensure(forbiddenPayment.response.status === 403, `Customer payment recording returned ${forbiddenPayment.response.status}.`);

  const firstAmount = Math.floor(total / 2);
  const secondAmount = total - firstAmount;
  const firstInput = {
    amount: firstAmount,
    method: 'BankTransfer',
    idempotency_key: `payment:${runId}:first`,
    external_reference: `BANK-${runId}`,
    note: 'Đợt thanh toán đầu tiên',
  };
  const firstPayment = await request(`/admin/bookings/${state.bookingId}/payments`, {
    method: 'POST', token: admin.access_token, json: firstInput,
  });
  ensure(firstPayment.response.status === 201, `First payment returned ${firstPayment.response.status}.`);
  ensure(firstPayment.body?.data?.summary?.payment_status === 'PartiallyPaid', 'Partial payment state is invalid.');
  const firstPaymentId = firstPayment.body?.data?.transaction?.payment_id;

  const secondInput = {
    amount: secondAmount,
    method: 'CardTerminal',
    idempotency_key: `payment:${runId}:second`,
    external_reference: `POS-${runId}`,
  };
  const concurrentSecondPayments = await Promise.all([
    request(`/admin/bookings/${state.bookingId}/payments`, { method: 'POST', token: admin.access_token, json: secondInput }),
    request(`/admin/bookings/${state.bookingId}/payments`, { method: 'POST', token: admin.access_token, json: secondInput }),
  ]);
  ensure(concurrentSecondPayments.every((item) => item.response.status === 201), 'Concurrent idempotent payments did not both succeed.');
  const secondIds = new Set(concurrentSecondPayments.map((item) => item.body?.data?.transaction?.payment_id));
  ensure(secondIds.size === 1, 'Concurrent idempotent payments created different transactions.');
  const replayFlags = concurrentSecondPayments.map((item) => item.body?.data?.replayed).sort();
  ensure(replayFlags[0] === false && replayFlags[1] === true, 'Concurrent payment replay flags are invalid.');
  const secondPaymentId = concurrentSecondPayments[0].body.data.transaction.payment_id;
  ensure(concurrentSecondPayments[0].body?.data?.summary?.payment_status === 'Paid', 'Full payment state is invalid.');

  const changedReplay = await request(`/admin/bookings/${state.bookingId}/payments`, {
    method: 'POST',
    token: admin.access_token,
    json: { ...secondInput, amount: secondAmount - 1 },
  });
  ensure(changedReplay.response.status === 409, `Changed idempotency replay returned ${changedReplay.response.status}.`);
  const overpayment = await request(`/admin/bookings/${state.bookingId}/payments`, {
    method: 'POST',
    token: admin.access_token,
    json: { amount: 1, method: 'Cash', idempotency_key: `payment:${runId}:overpay` },
  });
  ensure(overpayment.response.status === 409, `Overpayment returned ${overpayment.response.status}.`);

  const refundBeforeCancel = await request(`/admin/payments/${firstPaymentId}/refunds`, {
    method: 'POST',
    token: admin.access_token,
    json: { amount: firstAmount, idempotency_key: `refund:${runId}:too-early` },
  });
  ensure(refundBeforeCancel.response.status === 409, `Refund before cancellation returned ${refundBeforeCancel.response.status}.`);
  const cancel = await request(`/bookings/${state.bookingId}/cancel`, { method: 'PATCH', token: customer.access_token });
  ensure(cancel.response.status === 200, `Paid booking cancellation returned ${cancel.response.status}.`);

  const pendingRefund = await request(`/bookings/${state.bookingId}/payment`, { token: customer.access_token });
  ensure(pendingRefund.body?.data?.payment_status === 'RefundPending' && pendingRefund.body?.data?.refund_due === total, 'Canceled paid booking did not become refund-pending.');

  const firstRefund = await request(`/admin/payments/${firstPaymentId}/refunds`, {
    method: 'POST',
    token: admin.access_token,
    json: { amount: firstAmount, idempotency_key: `refund:${runId}:first`, note: 'Hoàn do khách hủy' },
  });
  ensure(firstRefund.response.status === 201 && firstRefund.body?.data?.summary?.payment_status === 'RefundPending', 'First refund failed.');

  const secondRefundInput = { amount: secondAmount, idempotency_key: `refund:${runId}:second`, note: 'Hoàn phần còn lại' };
  const concurrentSecondRefunds = await Promise.all([
    request(`/admin/payments/${secondPaymentId}/refunds`, { method: 'POST', token: admin.access_token, json: secondRefundInput }),
    request(`/admin/payments/${secondPaymentId}/refunds`, { method: 'POST', token: admin.access_token, json: secondRefundInput }),
  ]);
  ensure(concurrentSecondRefunds.every((item) => item.response.status === 201), 'Concurrent idempotent refunds did not both succeed.');
  const refundIds = new Set(concurrentSecondRefunds.map((item) => item.body?.data?.transaction?.payment_id));
  ensure(refundIds.size === 1, 'Concurrent idempotent refunds created different transactions.');
  ensure(concurrentSecondRefunds[0].body?.data?.summary?.payment_status === 'Refunded', 'Final refund state is invalid.');

  const overrefund = await request(`/admin/payments/${secondPaymentId}/refunds`, {
    method: 'POST',
    token: admin.access_token,
    json: { amount: 1, idempotency_key: `refund:${runId}:over` },
  });
  ensure(overrefund.response.status === 409, `Overrefund returned ${overrefund.response.status}.`);

  const finalSummary = await request(`/bookings/${state.bookingId}/payment`, { token: customer.access_token });
  ensure(finalSummary.response.status === 200, 'Final customer payment summary failed.');
  ensure(finalSummary.body?.data?.payment_status === 'Refunded', 'Final customer status is not Refunded.');
  ensure(finalSummary.body?.data?.net_paid === 0 && finalSummary.body?.data?.refund_due === 0, 'Final ledger balance is not zero.');
  ensure(finalSummary.body?.data?.transactions?.length === 4, 'Final ledger does not contain exactly four immutable entries.');

  const adminLedger = await request(`/admin/payments?search=${state.bookingId}`, { token: admin.access_token });
  ensure(adminLedger.response.status === 200 && adminLedger.body?.total === 4, 'Admin payment ledger search is incomplete.');
  for (const invalidQuery of ['limit=0', 'offset=-1', 'method=Crypto', 'transaction_type=Charge']) {
    const invalid = await request(`/admin/payments?${invalidQuery}`, { token: admin.access_token });
    ensure(invalid.response.status === 400, `Payment ledger ${invalidQuery} returned ${invalid.response.status}.`);
  }

  const adminBookings = await request(`/admin/bookings?search=${state.bookingId}`, { token: admin.access_token });
  const adminBooking = adminBookings.body?.data?.find((item) => item.booking_id === state.bookingId);
  ensure(
    adminBookings.response.status === 200
      && adminBooking?.payment_status === 'Refunded'
      && adminBooking?.net_paid === 0,
    `Admin booking payment projection is stale: ${JSON.stringify(adminBookings.body)}.`,
  );

  const history = await request('/bookings', { token: customer.access_token });
  const historyBooking = history.body?.data?.find((item) => item.booking_id === state.bookingId);
  ensure(
    historyBooking?.payment_status === 'Refunded' && historyBooking?.net_paid === 0,
    `Booking history payment projection is stale: ${JSON.stringify(historyBooking)}.`,
  );

  const storedRows = await database.query(
    `SELECT transaction_type, COUNT(*)::int AS count
     FROM payment_transactions
     WHERE booking_id = $1::uuid
     GROUP BY transaction_type`,
    [state.bookingId],
  );
  const storedCounts = Object.fromEntries(storedRows.rows.map((row) => [row.transaction_type, Number(row.count)]));
  ensure(storedCounts.Payment === 2 && storedCounts.Refund === 2, 'Database ledger has duplicate/missing rows.');

  console.log(JSON.stringify({
    status: 'ok',
    booking_id: state.bookingId,
    booking_total: total,
    payment_rows: storedCounts.Payment,
    refund_rows: storedCounts.Refund,
    final_payment_status: finalSummary.body.data.payment_status,
    concurrent_payment_replayed: true,
    concurrent_refund_replayed: true,
  }));
} finally {
  await cleanup();
  await database.end().catch(() => undefined);
}
