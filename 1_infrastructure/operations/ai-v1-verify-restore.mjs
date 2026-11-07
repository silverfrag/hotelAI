import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const runtime = path.join(root, '.tmp/ai-v1-local');
const target = process.argv[2], archive = process.argv[3];
assert(/^hotelai_ai_v1_restore_\d{14}$/.test(target ?? ''));
assert(/^ai-v1-\d{14}\.dump$/.test(archive ?? ''));
const { password } = JSON.parse(readFileSync(path.join(runtime, 'secrets.json'), 'utf8').replace(/^\uFEFF/, ''));
const { Client } = createRequire(path.join(root, '3_backend_core/package.json'))('pg');
async function fingerprint(database) {
  const client = new Client({ host: '127.0.0.1', port: 55321, user: 'ai_v1_demo', password, database });
  await client.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const hashes = {};
    for (const { tablename } of rows) {
      const escaped = '"' + tablename.replaceAll('"', '""') + '"';
      const result = await client.query(`SELECT count(*)::text AS rows,
        md5(COALESCE(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),'')) AS digest
        FROM public.${escaped} t`);
      hashes[tablename] = result.rows[0];
    }
    const constraints = await client.query("SELECT count(*)::int AS invalid FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated");
    assert.equal(constraints.rows[0].invalid, 0);
    await client.query('COMMIT');
    return hashes;
  } finally { await client.end(); }
}
const source = await fingerprint('hotelai_ai_v1_demo');
const restored = await fingerprint(target);
assert.deepEqual(restored, source, 'Restore contents differ from the quiescent demo source');
const sourceAfter = await fingerprint('hotelai_ai_v1_demo');
assert.deepEqual(sourceAfter, source, 'Source changed during comparison; rerun on a quiescent source');
const report = { status: 'ok', measured_at: new Date().toISOString(), source: 'hotelai_ai_v1_demo',
  restored_database: target, tables_verified: Object.keys(source).length, fingerprints: source,
  archive_sha256: createHash('sha256').update(readFileSync(path.join(runtime, archive))).digest('hex'),
  exact_contents_verified: true, invalid_constraints: 0, existing_database_overwritten: false,
  scope: 'demo_only; source must be quiescent; not a production backup certification' };
writeFileSync(path.join(runtime, `${target}.report.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
