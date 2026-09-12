// Read a disposable validation DB, restore into a NEW DB, compare exact table
// contents and migration history. No live DB or existing restore target is used.
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const composeFile = path.join(root, '1_infrastructure/operations/compose.test.yml');
const source = process.argv[2];
assert(/^hotel_validation(?:_run_[a-f0-9]{12})?$/.test(source ?? ''), 'Provide an isolated validation database name.');
const suffix = randomBytes(6).toString('hex');
const target = `hotel_validation_restore_${suffix}`;
const evidence = path.join(root, '.tmp/operations-evidence', suffix);
mkdirSync(evidence, { recursive: true });
function docker(args, input) {
  const result = spawnSync('docker', ['compose', '-f', composeFile, 'exec', '-T', 'postgres', ...args],
    { cwd: root, input, windowsHide: true, timeout: 60000, maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Validation backup/restore failed (exit ${result.status}); source was not modified.`);
  return result.stdout;
}
function query(database, sql) {
  return docker(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-U', 'hotel_validation', '-d', database, '-c', sql]).toString().trim();
}
function fingerprint(database) {
  const tables = query(database, "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").split('\n');
  return Object.fromEntries(tables.map(table => {
    assert(/^[a-z_]+$/.test(table));
    return [table, query(database, `SELECT COUNT(*)::text || ':' ||
      COALESCE(md5(string_agg(to_jsonb(row)::text, E'\\n' ORDER BY to_jsonb(row)::text)), md5(''))
      FROM public."${table}" row`)];
  }));
}
const started = Date.now();
const before = fingerprint(source);
const archive = docker(['pg_dump', '-Fc', '--no-owner', '--no-privileges', '-U', 'hotel_validation', '-d', source]);
assert.equal(archive.subarray(0, 5).toString(), 'PGDMP');
const checksum = createHash('sha256').update(archive).digest('hex');
writeFileSync(path.join(evidence, 'database.dump'), archive, { flag: 'wx', mode: 0o600 });
docker(['createdb', '-U', 'hotel_validation', target]);
// No --clean: an existing DB is never overwritten.
docker(['pg_restore', '--exit-on-error', '--no-owner', '--no-privileges', '-U', 'hotel_validation', '-d', target], archive);
assert.deepEqual(fingerprint(source), before, 'Source changed during drill; rerun on a quiescent snapshot.');
assert.deepEqual(fingerprint(target), before, 'Restored data differs from source.');
const constraints = query(target, "SELECT COUNT(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated");
assert.equal(constraints, '0');
const result = { status: 'ok', source, restored_database: target, tables_verified: Object.keys(before).length,
  archive_sha256: checksum, archive_bytes: archive.length, elapsed_ms: Date.now() - started,
  destructive_restore: false, production_backup_validated: false, retained_evidence: evidence };
writeFileSync(path.join(evidence, 'restore-report.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify(result));
