import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareMigration, readMigrations, validateHistory, runMigrations } from './migrate.mjs';

test('repository migrations are executable and CRLF-independent', async () => {
  const migrations = await readMigrations();
  assert.ok(migrations.length >= 14);
  assert.equal(new Set(migrations.map(({ name }) => name)).size, migrations.length);
  assert.equal(prepareMigration('SELECT 1;\r\n').checksum, prepareMigration('SELECT 1;\n').checksum);
});

test('outer transaction and ON_ERROR_STOP are supported without breaking function bodies', () => {
  const migration = prepareMigration("\\set ON_ERROR_STOP on\nBEGIN;\n-- header\nDO $$BEGIN RAISE NOTICE 'COMMIT;'; END$$;\nSELECT 'BEGIN;';\nCOMMIT;\n-- end\n");
  assert.match(migration.sql, /DO \$\$BEGIN/);
  assert.match(migration.sql, /SELECT 'BEGIN;'/);
  assert.doesNotMatch(migration.sql, /\\set|^BEGIN;|\nCOMMIT;/);
});

test('transaction escape, nontransactional SQL and unsafe psql commands are rejected', () => {
  for (const sql of ['SELECT 1; COMMIT;', 'BEGIN; SELECT 1;', 'SELECT 1; ROLLBACK;', '\\! echo bad', 'CREATE INDEX CONCURRENTLY x ON y(z);', 'VACUUM;', 'START TRANSACTION;', "SELECT 'unterminated;"]) {
    assert.throws(() => prepareMigration(sql));
  }
});

test('quoted semicolons and nested comments do not change SQL boundaries', () => {
  assert.doesNotThrow(() => prepareMigration("/* a /* nested */ b */ SELECT E'it\\'s; fine', \"semi;colon\", $tag$COMMIT;$tag$;"));
});

test('history rejects changed, missing and out-of-order migrations before applying', () => {
  const migrations = ['001_a.sql', '002_b.sql'].map((name) => ({ name, checksum: name }));
  assert.equal(validateHistory(migrations, migrations.slice(0, 1)).length, 1);
  assert.throws(() => validateHistory(migrations, [{ name: '001_a.sql', checksum: 'changed' }]), /checksum/);
  assert.throws(() => validateHistory(migrations, [{ name: '003_missing.sql', checksum: '' }]), /missing/);
  assert.throws(() => validateHistory(migrations, [migrations[1]]), /prefix/);
});

test('migration failure rolls back its ledger entry and releases advisory lock', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    if (sql.startsWith('SELECT name')) return { rows: [] };
    if (sql === 'BAD SQL;') throw Object.assign(new Error('sensitive row content'), { code: '42601' });
    return { rows: [] };
  } };
  await assert.rejects(runMigrations(client, [{ name: '001_bad.sql', checksum: 'x', sql: 'BAD SQL;' }]), /42601/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.ok(statements.at(-1).includes('pg_advisory_unlock'));
  assert.ok(!statements.some((sql) => sql.startsWith('INSERT INTO')));
});

test('readiness check does not initialize migration history or execute DDL', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('to_regclass')) return { rows: [{ present: false }] };
    return { rows: [] };
  } };
  await assert.rejects(runMigrations(client, [], { checkOnly: true }), /not been initialized/);
  assert.ok(!statements.some((sql) => /^(?:CREATE|INSERT|BEGIN)/.test(sql)));
  assert.ok(statements.at(-1).includes('pg_advisory_unlock'));
});

test('an existing untracked application schema is never replayed automatically', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('to_regclass')) return { rows: [{ present: false }] };
    if (sql.includes('AS occupied')) return { rows: [{ occupied: true }] };
    return { rows: [] };
  } };
  await assert.rejects(runMigrations(client, []), /Untracked application schema/);
  assert.ok(!statements.some((sql) => /^(?:CREATE|INSERT|BEGIN)/.test(sql)));
  assert.ok(statements.at(-1).includes('pg_advisory_unlock'));
});

test('a reporting failure after COMMIT cannot be mistaken for a rollback', async () => {
  const statements = [];
  const client = { async query(sql) {
    statements.push(sql);
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: true }] };
    if (sql.includes('to_regclass')) return { rows: [{ present: true }] };
    return { rows: [] };
  } };
  await assert.rejects(runMigrations(client, [{ name: '001_good.sql', checksum: 'x', sql: 'SELECT 1;' }], {
    report() { throw new Error('Output unavailable'); },
  }), /^Error: Output unavailable$/);
  assert.ok(statements.includes('COMMIT'));
  assert.ok(!statements.includes('ROLLBACK'));
  assert.ok(statements.at(-1).includes('pg_advisory_unlock'));
});
