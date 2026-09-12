import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
export const defaultMigrations = path.resolve(directory, '../postgres/migrations');
const lockName = 'hotelai.schema_migrations.v1';

// Mask strings, comments and dollar-quoted function bodies without changing offsets.
// Only unquoted SQL tokens can affect the transaction owned by this runner.
export function maskSql(sql) {
  let masked = '', index = 0;
  while (index < sql.length) {
    const start = index;
    if (sql.startsWith('--', index)) {
      index = sql.indexOf('\n', index);
      if (index < 0) index = sql.length;
    } else if (sql.startsWith('/*', index)) {
      let depth = 1;
      index += 2;
      while (index < sql.length && depth) {
        if (sql.startsWith('/*', index)) { depth++; index += 2; }
        else if (sql.startsWith('*/', index)) { depth--; index += 2; }
        else index++;
      }
      if (depth) throw new Error('Unterminated SQL comment');
    } else if (sql[index] === "'" || sql[index] === '"') {
      const quote = sql[index++];
      const escaped = quote === "'" && /(?:^|[^\w])E$/i.test(sql.slice(0, start));
      let closed = false;
      while (index < sql.length) {
        if (escaped && sql[index] === '\\') index += 2;
        else if (sql[index] === quote && sql[index + 1] === quote) index += 2;
        else if (sql[index++] === quote) { closed = true; break; }
      }
      if (!closed) throw new Error('Unterminated SQL string or identifier');
    } else {
      const dollar = sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (dollar) {
        const end = sql.indexOf(dollar, index + dollar.length);
        if (end < 0) throw new Error('Unterminated dollar-quoted SQL body');
        index = end + dollar.length;
      } else { masked += sql[index++]; continue; }
    }
    masked += ' '.repeat(index - start);
  }
  return masked;
}

export function prepareMigration(source) {
  const canonical = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const checksum = createHash('sha256').update(canonical, 'utf8').digest('hex');
  const sql = canonical.split('\n').map((line) => {
    if (/^\s*\\set\s+ON_ERROR_STOP\s+(?:on|1|true)\s*$/i.test(line)) return '';
    if (/^\s*\\/.test(line)) throw new Error('Only psql ON_ERROR_STOP is supported in migrations');
    return line;
  }).join('\n');
  const masked = maskSql(sql);
  const statements = [];
  let start = 0;
  for (let index = 0; index <= masked.length; index++) {
    if (index === masked.length || masked[index] === ';') {
      const code = masked.slice(start, index).trim();
      if (code) statements.push({ start, end: index + 1, code });
      start = index + 1;
    }
  }
  if (!statements.length) throw new Error('Migration contains no SQL');
  let first = 0, last = statements.length;
  if (/^BEGIN(?:\s+(?:WORK|TRANSACTION))?$/i.test(statements[0].code)) {
    if (!/^COMMIT(?:\s+(?:WORK|TRANSACTION))?$/i.test(statements.at(-1).code)) {
      throw new Error('Migration BEGIN must have a final COMMIT');
    }
    first++;
    last--;
  }
  const selected = statements.slice(first, last);
  if (!selected.length) throw new Error('Migration contains no executable SQL');
  for (const statement of selected) {
    if (/^(?:BEGIN|COMMIT|END|ROLLBACK|ABORT|SAVEPOINT|RELEASE|START\s+TRANSACTION|PREPARE\s+TRANSACTION|SET\s+(?:LOCAL\s+|SESSION\s+)?TRANSACTION)\b/i.test(statement.code)) {
      throw new Error('Migration cannot control the runner transaction');
    }
    if (/\bCONCURRENTLY\b|^VACUUM\b/i.test(statement.code)) {
      throw new Error('Nontransactional migrations require a separately reviewed operation');
    }
  }
  return { checksum, sql: selected.map((statement) => sql.slice(statement.start, statement.end)).join('\n') };
}

export async function readMigrations(migrationsDirectory = defaultMigrations) {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith('.sql')).sort();
  if (!names.length) throw new Error('No SQL migrations found');
  const versions = new Set();
  return Promise.all(names.map(async (name) => {
    if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(name)) throw new Error(`Invalid migration filename: ${name}`);
    const version = name.slice(0, 3);
    if (versions.has(version)) throw new Error(`Duplicate migration version: ${version}`);
    versions.add(version);
    return { name, ...prepareMigration(await readFile(path.join(migrationsDirectory, name), 'utf8')) };
  }));
}

export function validateHistory(migrations, history) {
  const files = new Map(migrations.map((migration) => [migration.name, migration]));
  const applied = new Set();
  for (const row of history) {
    if (!files.has(row.name)) throw new Error(`Applied migration is missing from release: ${row.name}`);
    if (row.checksum !== files.get(row.name).checksum) throw new Error(`Applied migration checksum changed: ${row.name}`);
    applied.add(row.name);
  }
  let pendingSeen = false;
  for (const migration of migrations) {
    if (!applied.has(migration.name)) pendingSeen = true;
    else if (pendingSeen) throw new Error('Migration history is not a complete prefix of this release');
  }
  return migrations.filter((migration) => !applied.has(migration.name));
}

export function loadPg() {
  for (const base of [path.join(process.cwd(), 'package.json'), path.resolve(directory, '../../3_backend_core/package.json')]) {
    try { return createRequire(base)('pg'); } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }
  throw new Error('Install backend dependencies with npm ci, or use the backend image');
}

export function databaseConfig(environment = process.env) {
  return {
    host: environment.DB_HOST ?? environment.PGHOST ?? '127.0.0.1',
    port: Number(environment.DB_PORT ?? environment.PGPORT ?? environment.POSTGRES_PORT ?? 5432),
    user: environment.DB_USER ?? environment.PGUSER ?? environment.POSTGRES_USER ?? 'hotel_admin',
    password: environment.DB_PASSWORD ?? environment.PGPASSWORD ?? environment.POSTGRES_PASSWORD,
    database: environment.DB_NAME ?? environment.PGDATABASE ?? environment.POSTGRES_DB ?? 'hotel_db',
    application_name: 'hotelai-migrations',
    connectionTimeoutMillis: 10_000,
  };
}

export async function runMigrations(client, migrations, { checkOnly = false, lockTimeoutMs = 60_000, statementTimeoutMs = 120_000, report = console.log } = {}) {
  let locked = false;
  if (![lockTimeoutMs, statementTimeoutMs].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error('Migration timeouts must be positive integers');
  }
  try {
    const deadline = Date.now() + lockTimeoutMs;
    while (!locked) {
      const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [lockName]);
      locked = result.rows[0].locked;
      if (!locked && Date.now() >= deadline) throw new Error('Timed out waiting for migration advisory lock');
      if (!locked) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    await client.query("SELECT set_config('statement_timeout', $1, false), set_config('lock_timeout', $2, false)", [String(statementTimeoutMs), String(lockTimeoutMs)]);
    const exists = await client.query("SELECT to_regclass('public.schema_migrations') IS NOT NULL AS present");
    if (!exists.rows[0].present && checkOnly) throw new Error('Migration history has not been initialized');
    if (!exists.rows[0].present) {
      const occupied = await client.query("SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS occupied");
      if (occupied.rows[0].occupied) {
        throw new Error('Untracked application schema: refusing to replay migrations. Restore a verified migration ledger or complete a reviewed baseline-adoption procedure first');
      }
      await client.query(`CREATE TABLE public.schema_migrations (
        name text PRIMARY KEY,
        checksum varchar(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        execution_ms integer NOT NULL CHECK (execution_ms >= 0)
      )`);
    }
    const history = await client.query('SELECT name, checksum FROM public.schema_migrations ORDER BY name');
    const pending = validateHistory(migrations, history.rows);
    if (checkOnly && pending.length) throw new Error(`${pending.length} migrations are pending`);
    for (const migration of pending) {
      await client.query('BEGIN');
      const started = Date.now();
      try {
        await client.query("SELECT set_config('search_path', 'public,pg_catalog', true), set_config('standard_conforming_strings', 'on', true)");
        await client.query(migration.sql);
        await client.query('INSERT INTO public.schema_migrations (name, checksum, execution_ms) VALUES ($1, $2, $3)', [migration.name, migration.checksum, Date.now() - started]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        // SQL error detail can contain guest data. Expose only the migration and SQLSTATE.
        throw new Error(`Migration ${migration.name} failed (SQLSTATE ${error.code ?? 'unknown'}); transaction rolled back`);
      }
      // Reporting is not part of the SQL transaction. A failed output callback must
      // never claim that a successfully committed migration was rolled back.
      report(`Applied ${migration.name}`);
    }
    return { status: 'ok', applied: pending.length, total: migrations.length };
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockName]).catch(() => {});
  }
}

async function main() {
  const options = new Set(process.argv.slice(2));
  if ([...options].some((option) => !['--dry-run', '--check', '--apply'].includes(option)) || options.size > 1) {
    throw new Error('Usage: node migrate.mjs [--dry-run | --check | --apply]');
  }
  const migrations = await readMigrations(process.env.MIGRATIONS_DIR ?? defaultMigrations);
  if (!options.has('--apply') && !options.has('--check')) {
    console.log(JSON.stringify({ status: 'plan', migrations: migrations.map(({ name, checksum }) => ({ name, checksum })) }, null, 2));
    return;
  }
  const { Client } = loadPg();
  const client = new Client(databaseConfig());
  try {
    await client.connect();
    console.log(JSON.stringify(await runMigrations(client, migrations, {
      checkOnly: options.has('--check'),
      lockTimeoutMs: Number(process.env.MIGRATION_LOCK_TIMEOUT_MS ?? 60_000),
      statementTimeoutMs: Number(process.env.MIGRATION_STATEMENT_TIMEOUT_MS ?? 120_000),
    })));
  } finally { await client.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.code ? `Database operation failed (code ${error.code})` : error.message);
    process.exitCode = 1;
  });
}
