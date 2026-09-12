// Fixed disposable targets: never load .env or operate the default live project.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const composeFile = path.join(root, '1_infrastructure/operations/compose.test.yml');
const scripts = [
  'smoke-test', 'user-accounts-smoke-test', 'payments-smoke-test', 'admin-smoke-test',
  'admin-operations-smoke-test', 'stay-lifecycle-smoke-test', 'room-turnover-smoke-test',
  'api-contract-smoke-test', 'events-observability-smoke-test',
  'booking-workflow-smoke-test', 'infrastructure-resilience-smoke-test',
  'ai-outage-smoke-test',
];
const selected = process.argv.slice(2);
if (selected.some(name => !scripts.includes(name))) throw new Error('Unknown validation script.');
const databaseName = `hotel_validation_run_${randomBytes(6).toString('hex')}`;
const environment = {
  ...process.env,
  SMOKE_BASE_URL: 'http://127.0.0.1:53002/api/v1/core',
  API_BASE_URL: 'http://127.0.0.1:53002/api/v1/core',
  SMOKE_ALLOWED_ORIGIN: 'http://127.0.0.1:53002',
  SMOKE_COMPOSE_FILE: composeFile,
  DB_HOST: '127.0.0.1', DB_PORT: '55442', POSTGRES_PORT: '55442',
  DB_USER: 'hotel_validation', POSTGRES_USER: 'hotel_validation',
  DB_PASSWORD: 'ops-validation-only-password', POSTGRES_PASSWORD: 'ops-validation-only-password',
  DB_NAME: databaseName, POSTGRES_DB: databaseName, VALIDATION_DB_NAME: databaseName,
  VALIDATION_APP_USER: 'hotel_validation_app', VALIDATION_APP_PASSWORD: 'validation-app-only-password',
  JWT_SECRET: 'validation-only-jwt-never-deploy-this-development-stack-2026',
  HOTEL_TIMEZONE: 'Asia/Bangkok',
  REDIS_URL: 'redis://127.0.0.1:56380',
  KAFKA_BROKERS: '127.0.0.1:59093',
  KAFKA_DOMAIN_EVENTS_TOPIC: 'hotel.validation.domain-events.v1',
  AI_HEALTH_URL: 'http://127.0.0.1:58000/health',
  AI_CONVERSION_INFO_URL: 'http://127.0.0.1:58000/api/v1/conversion-model-info',
};
function run(command, args, timeout = 180000) {
  const result = spawnSync(command, args, { cwd: root, env: environment, stdio: 'inherit', windowsHide: true, timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Validation command failed (exit ${result.status}).`);
}
// Start from fresh fixtures without deleting previous evidence or live data.
run('docker', ['compose', '-f', composeFile, 'exec', '-T', 'postgres', 'createdb', '-U', 'hotel_validation', databaseName]);
const baseline = ['1_infrastructure/postgres/init_schema.sql', '1_infrastructure/postgres/seed.sql',
  '1_infrastructure/operations/init-migration-history.sql'].map(file => readFileSync(path.join(root, file), 'utf8')).join('\n');
const init = spawnSync('docker', ['compose', '-f', composeFile, 'exec', '-T', 'postgres', 'psql',
  '-v', 'ON_ERROR_STOP=1', '-U', 'hotel_validation', '-d', databaseName],
  { cwd: root, env: environment, input: baseline, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (init.status !== 0) throw new Error(`Validation baseline failed: ${init.stderr}`);
console.log(`[isolated-validation] Database retained for evidence: ${databaseName}`);
run('docker', ['compose', '-f', composeFile, 'run', '--rm', 'db_migrations']);
const appRoleSql = `DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hotel_validation_app') THEN
    CREATE ROLE hotel_validation_app LOGIN PASSWORD 'validation-app-only-password'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END $$; GRANT hotelai_runtime TO hotel_validation_app;`;
const role = spawnSync('docker', ['compose', '-f', composeFile, 'exec', '-T', 'postgres', 'psql',
  '-v', 'ON_ERROR_STOP=1', '-U', 'hotel_validation', '-d', databaseName],
  { cwd: root, env: environment, input: appRoleSql, encoding: 'utf8', windowsHide: true, timeout: 30000 });
if (role.status !== 0) throw new Error(`Validation app role setup failed: ${role.stderr}`);
run('docker', ['compose', '-f', composeFile, 'exec', '-T', 'redis', 'redis-cli', 'DEL', 'hotelai:room-types:v1']);
run('docker', ['compose', '-f', composeFile, 'up', '--no-deps', '-d', 'backend_core']);
for (const script of selected.length ? selected : scripts) {
  console.log(`[isolated-validation] ${script}`);
  run('docker', ['compose', '-f', composeFile, 'restart', 'backend_core']);
  if (script === 'ai-outage-smoke-test') {
    try {
      run('docker', ['compose', '-f', composeFile, 'stop', 'ai_service']);
      run('docker', ['compose', '-f', composeFile, 'restart', 'backend_core']);
      run(process.execPath, [path.join(root, '3_backend_core/scripts', `${script}.mjs`)]);
    } finally {
      run('docker', ['compose', '-f', composeFile, 'start', 'ai_service']);
      run('docker', ['compose', '-f', composeFile, 'restart', 'backend_core']);
    }
  } else run(process.execPath, [path.join(root, '3_backend_core/scripts', `${script}.mjs`)]);
}
console.log(JSON.stringify({ status: 'ok', database: databaseName, scripts: selected.length ? selected : scripts,
  stack: 'hotelai-ops-validation', frontend_tested: false }));
