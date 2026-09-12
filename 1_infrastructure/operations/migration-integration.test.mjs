import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { databaseConfig, loadPg, prepareMigration, runMigrations } from './migrate.mjs';

// This opt-in suite creates and drops only a random, dedicated test database in
// the isolated validation cluster. Never silently fall back to live DB defaults.
test('real PostgreSQL: migration replay, checksums, rollback and concurrent runners', {
  skip: process.env.OPS_MIGRATION_INTEGRATION !== '1',
}, async () => {
  const config = databaseConfig();
  assert.equal(config.host, '127.0.0.1', 'Use the isolated validation host');
  assert.equal(config.port, 55442, 'Use the isolated validation port');
  assert.equal(config.database, 'hotel_validation', 'Use the isolated validation database');
  assert.equal(config.user, 'hotel_validation', 'Use the isolated validation user');
  const { Client } = loadPg();
  const admin = new Client(config);
  const probeName = `hotel_validation_migrations_probe_${randomBytes(6).toString('hex')}`;
  assert.match(probeName, /^hotel_validation_migrations_probe_[a-f0-9]{12}$/);
  const client = new Client({ ...config, database: probeName });
  const concurrent = new Client({ ...config, database: probeName });
  const migration = (name, sql) => ({ name, ...prepareMigration(sql) });
  const migrations = [
    migration('001_fixture.sql', 'BEGIN; CREATE TABLE migration_probe (id integer PRIMARY KEY, value text NOT NULL); COMMIT;'),
    migration('002_seed.sql', "INSERT INTO migration_probe VALUES (1, 'preserved');"),
  ];
  const options = { report() {} };
  let created = false;
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${probeName}"`);
    created = true;
    await client.connect();
    await concurrent.connect();
    await assert.rejects(runMigrations(client, migrations, { ...options, checkOnly: true }), /not been initialized/);
    await client.query('CREATE TABLE migration_probe_untracked (id integer)');
    await assert.rejects(runMigrations(client, migrations, options), /Untracked application schema/);
    assert.equal((await client.query("SELECT to_regclass('public.schema_migrations') IS NULL AS absent")).rows[0].absent, true);
    await client.query('DROP TABLE migration_probe_untracked');
    assert.equal((await runMigrations(client, migrations, options)).applied, 2);
    assert.equal((await runMigrations(client, migrations, options)).applied, 0);
    assert.equal((await runMigrations(client, migrations, { ...options, checkOnly: true })).total, 2);

    const changed = [migration('001_fixture.sql', 'SELECT 123;'), migrations[1]];
    await assert.rejects(runMigrations(client, changed, options), /checksum changed/);
    const broken = migration('003_broken.sql', 'ALTER TABLE migration_probe ADD COLUMN leaked boolean; SELECT missing_private_column FROM migration_probe;');
    await assert.rejects(runMigrations(client, [...migrations, broken], options), (error) => {
      assert.match(error.message, /42703.*rolled back/);
      assert.doesNotMatch(error.message, /missing_private_column/);
      return true;
    });
    assert.equal((await client.query("SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_name = 'migration_probe' AND column_name = 'leaked'")).rows[0].count, 0);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0].count, 2);
    assert.equal((await client.query('SELECT value FROM migration_probe WHERE id = 1')).rows[0].value, 'preserved');

    const extended = [...migrations, migration('003_concurrent.sql', "SELECT pg_sleep(0.3); INSERT INTO migration_probe VALUES (2, 'once');")];
    const results = await Promise.all([
      runMigrations(client, extended, options),
      runMigrations(concurrent, extended, options),
    ]);
    assert.deepEqual(results.map(({ applied }) => applied).sort(), [0, 1]);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM migration_probe')).rows[0].count, 2);
    assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM schema_migrations')).rows[0].count, 3);
  } finally {
    await Promise.all([client.end(), concurrent.end()]);
    if (created) await admin.query(`DROP DATABASE "${probeName}"`);
    await admin.end();
  }
});
