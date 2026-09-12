import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const file = fileURLToPath(new URL('./compose.test.yml', import.meta.url));
const database = process.argv[2];
assert(/^hotel_validation_run_[a-f0-9]{12}$/.test(database ?? ''));
const common = ['compose', '-f', file, 'run', '--no-deps', '--rm',
  '-e', `DB_NAME=${database}`, '-e', 'DEPLOYMENT_MODE=production',
  '-e', 'CORS_ORIGINS=https://validation.example.invalid'];
function call(args) {
  const result = spawnSync('docker', args, { cwd: root, encoding: 'utf8', timeout: 45000, windowsHide: true });
  if (result.error) throw result.error;
  return result;
}
const insecure = call([...common, '-e', 'COOKIE_SECURE=false', 'backend_core']);
assert.notEqual(insecure.status, 0);
assert.match(insecure.stdout + insecure.stderr, /Production requires secure cookies/);
const owner = call([...common, '-e', 'COOKIE_SECURE=true', '-e', 'DB_USER=hotel_validation',
  '-e', 'DB_PASSWORD=ops-validation-only-password', 'backend_core']);
assert.notEqual(owner.status, 0);
assert.match(owner.stdout + owner.stderr, /Production requires a restricted runtime database login/);
const name = `hotelai-production-guard-probe-${randomBytes(5).toString('hex')}`;
let started = false;
try {
  const safe = call([...common, '-d', '--name', name, '-e', 'COOKIE_SECURE=true',
    '-e', 'DB_USER=hotel_validation_app', '-e', 'DB_PASSWORD=validation-app-only-password', 'backend_core']);
  assert.equal(safe.status, 0); started = true;
  let ready = false;
  for (let count = 0; count < 30; count++) {
    const probe = call(['exec', name, 'node', '-e',
      "fetch('http://127.0.0.1:3000/api/v1/core/health/ready',{signal:AbortSignal.timeout(2000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]);
    if (probe.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert(ready, 'Restricted production configuration failed startup readiness.');
  console.log(JSON.stringify({ status: 'ok', insecure_cookies_rejected: true,
    database_owner_rejected: true, restricted_role_accepted: true, public_tls_tested: false }));
} finally {
  if (started) call(['stop', name]);
}
