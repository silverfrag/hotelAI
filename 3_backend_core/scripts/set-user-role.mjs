import pg from 'pg';

const [, , rawEmail, rawRole] = process.argv;
const email = rawEmail?.trim().toLowerCase();
const role = rawRole?.trim().toLowerCase();

if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  throw new Error('Usage: npm run user:set-role -- <email> <admin|customer>');
}
if (role !== 'admin' && role !== 'customer') {
  throw new Error('Role must be either admin or customer.');
}

const client = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER,
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB,
});

await client.connect();
try {
  await client.query('BEGIN');
  await client.query(
    `SELECT pg_advisory_xact_lock(
       hashtextextended('hotelai-active-admin-set', 0)
     )`,
  );
  const currentResult = await client.query(
    `SELECT customer_id, email, role, account_status, version
     FROM customers
     WHERE lower(email) = $1
     FOR UPDATE`,
    [email],
  );
  if (currentResult.rowCount !== 1) throw new Error(`No customer found for ${email}.`);
  const current = currentResult.rows[0];
  if (current.account_status === 'Deactivated') {
    throw new Error('Cannot change the role of a deactivated account.');
  }
  if (current.role === 'admin' && role !== 'admin' && current.account_status === 'Active') {
    const activeAdmins = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM customers
       WHERE role = 'admin' AND account_status = 'Active'`,
    );
    if (Number(activeAdmins.rows[0].count) <= 1) {
      throw new Error('Cannot demote the last active admin.');
    }
  }

  if (current.role === role) {
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'ok', changed: false, user: current }));
  } else {
    const result = await client.query(
      `UPDATE customers
       SET role = $1, version = version + 1, updated_at = CURRENT_TIMESTAMP
       WHERE customer_id = $2::uuid
       RETURNING customer_id, email, role, account_status, version`,
      [role, current.customer_id],
    );
    const updated = result.rows[0];
    await client.query(
      `INSERT INTO customer_account_audits (
         customer_id, action, old_role, new_role, old_status, new_status,
         old_version, new_version, changed_fields, changed_by
       ) VALUES ($1::uuid, 'account_updated', $2, $3, $4, $4, $5, $6,
                 '{"fields":["role"],"source":"set-user-role-cli"}'::jsonb, $1::uuid)`,
      [
        current.customer_id,
        current.role,
        updated.role,
        current.account_status,
        Number(current.version),
        Number(updated.version),
      ],
    );
    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'ok', changed: true, user: updated }));
  }
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
