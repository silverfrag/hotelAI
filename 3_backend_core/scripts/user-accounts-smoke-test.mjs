import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { waitForApi } from './test-helpers.mjs';

const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost/api/v1/core';
await waitForApi(baseUrl);
const runId = randomUUID().replaceAll('-', '').slice(0, 12);
const adminEmail = `account-admin-${runId}@example.com`;
const customerEmail = `account-customer-${runId}@example.com`;
const raceAdminEmail = `account-race-admin-${runId}@example.com`;
const password = 'Password123!';
const newPassword = 'ChangedPassword456!';

const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

const state = { adminId: null, customerId: null, raceAdminId: null, bookingId: null };

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

async function register(fullName, email) {
  const result = await request('/auth/register', {
    method: 'POST',
    json: { full_name: fullName, email, password },
  });
  ensure(result.response.status === 201, `Registration for ${email} returned ${result.response.status}.`);
  ensure(result.body?.user?.account_status === 'Active', 'New account is not active.');
  ensure(result.body?.user?.version === 1, 'New account did not start at version 1.');
  ensure(typeof result.body?.access_token === 'string', 'Registration did not issue a token.');
  return result.body;
}

async function cleanup() {
  try {
    await database.query('BEGIN');
    if (state.bookingId) {
      await database.query('DELETE FROM daily_pricing_logs WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM booking_details WHERE booking_id = $1::uuid', [state.bookingId]);
      await database.query('DELETE FROM bookings WHERE booking_id = $1::uuid', [state.bookingId]);
    }
    const ids = [state.adminId, state.customerId, state.raceAdminId].filter(Boolean);
    if (ids.length) {
      const aggregateIds = [...ids, ...(state.bookingId ? [state.bookingId] : [])];
      await database.query(
        `DELETE FROM event_outbox
         WHERE aggregate_id = ANY($1::text[])
            OR payload->>'customer_id' = ANY($1::text[])`,
        [aggregateIds],
      );
      await database.query(
        'DELETE FROM customer_account_audits WHERE customer_id = ANY($1::uuid[]) OR changed_by = ANY($1::uuid[])',
        [ids],
      );
      await database.query('DELETE FROM customers WHERE customer_id = ANY($1::uuid[])', [ids]);
    } else {
      await database.query('DELETE FROM customers WHERE email = ANY($1::text[])', [[adminEmail, customerEmail, raceAdminEmail]]);
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
  const admin = await register('Account Smoke Admin', adminEmail);
  state.adminId = admin.user.id;
  const adminToken = admin.access_token;
  await database.query(
    `UPDATE customers SET role = 'admin', updated_at = CURRENT_TIMESTAMP WHERE customer_id = $1::uuid`,
    [state.adminId],
  );
  const adminAccess = await request('/admin/users', { token: adminToken });
  ensure(adminAccess.response.status === 200, `Live role promotion returned ${adminAccess.response.status}.`);
  const lastAdminDeactivation = await request('/users/me/deactivate', {
    method: 'POST',
    token: adminToken,
    json: { password },
  });
  ensure(
    lastAdminDeactivation.response.status === 409,
    `Last active admin deactivation returned ${lastAdminDeactivation.response.status}.`,
  );

  const customer = await register('Account Smoke Customer', customerEmail);
  state.customerId = customer.user.id;
  const firstToken = customer.access_token;

  const profile = await request('/users/me', { token: firstToken });
  ensure(profile.response.status === 200 && profile.body?.data?.version === 1, 'Initial profile lookup failed.');

  const profileUpdate = await request('/users/me', {
    method: 'PATCH',
    token: firstToken,
    json: {
      full_name: 'Account Smoke Updated',
      phone: '+84 912 345 678',
      nationality: 'Việt Nam',
      expected_version: 1,
    },
  });
  ensure(profileUpdate.response.status === 200, `Profile update returned ${profileUpdate.response.status}.`);
  ensure(profileUpdate.body?.data?.version === 2, 'Profile version was not incremented.');
  ensure(profileUpdate.body?.data?.phone === '+84 912 345 678', 'Profile phone was not persisted.');

  const staleProfile = await request('/users/me', {
    method: 'PATCH',
    token: firstToken,
    json: { full_name: 'Stale Update', expected_version: 1 },
  });
  ensure(staleProfile.response.status === 409, `Stale profile update returned ${staleProfile.response.status}.`);
  const profileTokenStillValid = await request('/auth/me', { token: firstToken });
  ensure(profileTokenStillValid.response.status === 200, 'A profile update unexpectedly revoked the session.');

  const wrongPassword = await request('/users/me/password', {
    method: 'PATCH',
    token: firstToken,
    json: { current_password: 'WrongPassword!', new_password: newPassword },
  });
  ensure(wrongPassword.response.status === 400, `Wrong current password returned ${wrongPassword.response.status}.`);
  const tokenAfterWrongPassword = await request('/auth/me', { token: firstToken });
  ensure(tokenAfterWrongPassword.response.status === 200, 'Wrong confirmation password revoked a valid session.');
  const samePassword = await request('/users/me/password', {
    method: 'PATCH',
    token: firstToken,
    json: { current_password: password, new_password: password },
  });
  ensure(samePassword.response.status === 400, `Reused password returned ${samePassword.response.status}.`);

  const changedPassword = await request('/users/me/password', {
    method: 'PATCH',
    token: firstToken,
    json: { current_password: password, new_password: newPassword },
  });
  ensure(changedPassword.response.status === 200, `Password change returned ${changedPassword.response.status}.`);
  ensure(changedPassword.body?.data?.version === 3, 'Password change did not increment the account version.');
  ensure(
    changedPassword.response.headers.get('set-cookie')?.includes('hotelai_session='),
    'Password change did not clear the browser session cookie.',
  );
  const revokedAfterPassword = await request('/auth/me', { token: firstToken });
  ensure(revokedAfterPassword.response.status === 401, `Old token after password change returned ${revokedAfterPassword.response.status}.`);
  const oldPasswordLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: customerEmail, password },
  });
  ensure(oldPasswordLogin.response.status === 401, 'Old password remained valid.');
  const customerLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: customerEmail, password: newPassword },
  });
  ensure(customerLogin.response.status === 201, `New password login returned ${customerLogin.response.status}.`);
  const customerToken = customerLogin.body.access_token;

  for (const invalidQuery of ['limit=0', 'offset=-1', 'role=owner', 'status=Locked']) {
    const invalid = await request(`/admin/users?${invalidQuery}`, { token: adminToken });
    ensure(invalid.response.status === 400, `Admin users ${invalidQuery} returned ${invalid.response.status}.`);
  }
  const listed = await request(`/admin/users?search=${encodeURIComponent(customerEmail)}`, { token: adminToken });
  ensure(listed.response.status === 200 && listed.body?.total === 1, 'Admin user search did not return exactly the test customer.');
  ensure(listed.body.data[0].booking_count === 0, 'New customer unexpectedly has booking metrics.');

  const selfLockout = await request(`/admin/users/${state.adminId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'customer', account_status: 'Active', expected_version: 1 },
  });
  ensure(selfLockout.response.status === 403, `Admin self-demotion returned ${selfLockout.response.status}.`);

  const promotion = await request(`/admin/users/${state.customerId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'admin', account_status: 'Active', expected_version: 3 },
  });
  ensure(promotion.response.status === 200 && promotion.body?.data?.version === 4, 'Customer promotion failed.');
  const livePromotion = await request('/admin/users', { token: customerToken });
  ensure(livePromotion.response.status === 200, `Promoted user's existing token returned ${livePromotion.response.status}.`);
  const staleAdminUpdate = await request(`/admin/users/${state.customerId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'customer', account_status: 'Active', expected_version: 3 },
  });
  ensure(staleAdminUpdate.response.status === 409, `Stale admin update returned ${staleAdminUpdate.response.status}.`);

  const demotion = await request(`/admin/users/${state.customerId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'customer', account_status: 'Active', expected_version: 4 },
  });
  ensure(demotion.response.status === 200 && demotion.body?.data?.version === 5, 'Customer demotion failed.');
  const liveDemotion = await request('/admin/users', { token: customerToken });
  ensure(liveDemotion.response.status === 403, `Demoted user's existing token returned ${liveDemotion.response.status}.`);

  const suspension = await request(`/admin/users/${state.customerId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'customer', account_status: 'Suspended', expected_version: 5 },
  });
  ensure(suspension.response.status === 200 && suspension.body?.data?.version === 6, 'Account suspension failed.');
  const blockedToken = await request('/auth/me', { token: customerToken });
  ensure(blockedToken.response.status === 403, `Suspended token returned ${blockedToken.response.status}.`);
  const blockedLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: customerEmail, password: newPassword },
  });
  ensure(blockedLogin.response.status === 403, `Suspended login returned ${blockedLogin.response.status}.`);

  const reactivation = await request(`/admin/users/${state.customerId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'customer', account_status: 'Active', expected_version: 6 },
  });
  ensure(reactivation.response.status === 200 && reactivation.body?.data?.version === 7, 'Account reactivation failed.');
  const staleAfterReactivation = await request('/auth/me', { token: customerToken });
  ensure(staleAfterReactivation.response.status === 401, `Pre-suspension token after reactivation returned ${staleAfterReactivation.response.status}.`);
  const reactivatedLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: customerEmail, password: newPassword },
  });
  ensure(reactivatedLogin.response.status === 201, 'Reactivated account could not log in.');
  const finalToken = reactivatedLogin.body.access_token;

  const rooms = await request('/rooms');
  ensure(rooms.response.status === 200 && rooms.body?.data?.length, 'No room type is available for deactivation test.');
  const uniqueYear = new Date().getUTCFullYear() + 20 + (Number.parseInt(runId.slice(0, 5), 16) % 1500);
  const booking = await request('/bookings', {
    method: 'POST',
    token: finalToken,
    json: {
      room_type_id: rooms.body.data[0].type_id,
      check_in_date: `${uniqueYear}-07-10`,
      check_out_date: `${uniqueYear}-07-12`,
      total_of_special_requests: 0,
    },
  });
  ensure(booking.response.status === 201, `Confirmed booking setup returned ${booking.response.status}.`);
  state.bookingId = booking.body?.data?.booking?.booking_id;

  const blockedDeactivation = await request('/users/me/deactivate', {
    method: 'POST',
    token: finalToken,
    json: { password: newPassword },
  });
  ensure(blockedDeactivation.response.status === 409, `Deactivation with confirmed booking returned ${blockedDeactivation.response.status}.`);
  const cancellation = await request(`/bookings/${state.bookingId}/cancel`, { method: 'PATCH', token: finalToken });
  ensure(cancellation.response.status === 200, `Booking cancellation returned ${cancellation.response.status}.`);

  const deactivation = await request('/users/me/deactivate', {
    method: 'POST',
    token: finalToken,
    json: { password: newPassword },
  });
  ensure(deactivation.response.status === 200, `Account deactivation returned ${deactivation.response.status}.`);
  ensure(deactivation.response.headers.get('set-cookie')?.includes('hotelai_session='), 'Deactivation did not clear the browser session cookie.');
  const deactivatedToken = await request('/auth/me', { token: finalToken });
  ensure(deactivatedToken.response.status === 403, `Deactivated token returned ${deactivatedToken.response.status}.`);
  const deactivatedLogin = await request('/auth/login', {
    method: 'POST',
    json: { email: customerEmail, password: newPassword },
  });
  ensure(deactivatedLogin.response.status === 401, 'Original identity remained usable after deactivation.');

  const stored = await database.query(
    `SELECT full_name, email, phone, nationality, password_hash, role, account_status, deleted_at
     FROM customers WHERE customer_id = $1::uuid`,
    [state.customerId],
  );
  const storedCustomer = stored.rows[0];
  ensure(storedCustomer.full_name === 'Deleted user', 'Deactivated name was not anonymized.');
  ensure(storedCustomer.email.startsWith('deleted+'), 'Deactivated email was not anonymized.');
  ensure(storedCustomer.phone === null && storedCustomer.nationality === null && storedCustomer.password_hash === null, 'Deactivated PII or credential remained.');
  ensure(storedCustomer.role === 'customer' && storedCustomer.account_status === 'Deactivated' && storedCustomer.deleted_at, 'Deactivated lifecycle state is incomplete.');

  const audits = await request(`/admin/users/${state.customerId}/audits?limit=50`, { token: adminToken });
  ensure(audits.response.status === 200 && audits.body?.total >= 7, 'Account audit trail is incomplete.');
  const actions = new Set(audits.body.data.map((item) => item.action));
  for (const action of ['profile_updated', 'password_changed', 'account_updated', 'deactivated']) {
    ensure(actions.has(action), `Audit trail is missing ${action}.`);
  }

  // Concurrency proof for the last-active-admin invariant. Both requests pass
  // the HTTP guard while two admins are active; the shared DB advisory lock
  // must allow exactly one self-deactivation and reject the other.
  const raceAdmin = await register('Account Race Admin', raceAdminEmail);
  state.raceAdminId = raceAdmin.user.id;
  const racePromotion = await request(`/admin/users/${state.raceAdminId}`, {
    method: 'PATCH',
    token: adminToken,
    json: { role: 'admin', account_status: 'Active', expected_version: 1 },
  });
  ensure(racePromotion.response.status === 200, 'Could not prepare the concurrent-admin invariant test.');
  const concurrentAdminDeactivations = await Promise.all([
    request('/users/me/deactivate', { method: 'POST', token: adminToken, json: { password } }),
    request('/users/me/deactivate', { method: 'POST', token: raceAdmin.access_token, json: { password } }),
  ]);
  const adminDeactivationStatuses = concurrentAdminDeactivations
    .map(({ response }) => response.status)
    .sort((left, right) => left - right);
  ensure(
    adminDeactivationStatuses[0] === 200 && adminDeactivationStatuses[1] === 409,
    `Concurrent admin deactivation returned ${adminDeactivationStatuses.join(',')}.`,
  );
  const activeAdminRows = await database.query(
    `SELECT COUNT(*)::int AS count
     FROM customers
     WHERE customer_id = ANY($1::uuid[])
       AND role = 'admin'
       AND account_status = 'Active'`,
    [[state.adminId, state.raceAdminId]],
  );
  ensure(Number(activeAdminRows.rows[0].count) === 1, 'Concurrent deactivation left an invalid active-admin count.');

  console.log(JSON.stringify({
    status: 'ok',
    customer_id: state.customerId,
    final_version: 8,
    audit_count: audits.body.total,
    password_revoked: true,
    suspension_revoked: true,
    pii_anonymized: true,
    concurrent_admin_deactivation_statuses: adminDeactivationStatuses,
  }));
} finally {
  await cleanup();
  await database.end().catch(() => undefined);
}
