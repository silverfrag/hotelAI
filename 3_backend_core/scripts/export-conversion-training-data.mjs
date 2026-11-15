import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
if (!outputArgument) {
  throw new Error('Usage: npm run ai:export-conversion-data -- --output=<dataset.csv>');
}
const outputPath = path.resolve(outputArgument.slice('--output='.length));
if (!outputPath.toLowerCase().endsWith('.csv')) {
  throw new Error('The conversion training export must use a .csv filename.');
}
const temporaryPath = `${outputPath}.tmp-${process.pid}`;
const columns = [
  'quote_id',
  'room_type_name_snapshot',
  'capacity_snapshot',
  'check_in_date',
  'check_out_date',
  'guest_count',
  'lead_time',
  'rooms_available',
  'rooms_sellable_snapshot',
  'rooms_booked_snapshot',
  'occupancy_ratio_snapshot',
  'base_price',
  'nightly_price',
  'currency',
  'pricing_source',
  'ai_model_version',
  'data_provenance',
  'provenance_reference',
  'exposure_at',
  'exposure_confirmed',
  'acceptance_label',
  'inventory_snapshot_consistent',
  'has_disposition_conflict',
];

const database = new pg.Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? process.env.POSTGRES_PORT ?? 5432),
  user: process.env.DB_USER ?? process.env.POSTGRES_USER ?? 'hotel_admin',
  password: process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD,
  database: process.env.DB_NAME ?? process.env.POSTGRES_DB ?? 'hotel_db',
});

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function write(stream, digest, text) {
  digest.update(text);
  if (!stream.write(text)) await once(stream, 'drain');
}

await mkdir(path.dirname(outputPath), { recursive: true });
await database.connect();
const stream = createWriteStream(temporaryPath, { encoding: 'utf8', flags: 'wx' });
const digest = createHash('sha256');
let rowsWritten = 0;
let cursor = '';
let transactionOpen = false;

try {
  // A multi-page export must observe one point-in-time dataset. READ COMMITTED
  // can otherwise mix newly matured labels into later pages or miss rows whose
  // UUID sorts behind the cursor, making the hash impossible to reproduce.
  await database.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  transactionOpen = true;
  await write(stream, digest, `${columns.join(',')}\n`);
  while (true) {
    const result = await database.query(
      `SELECT quote_id,
              room_type_name_snapshot,
              capacity_snapshot,
              check_in_date::text,
              check_out_date::text,
              guest_count,
              lead_time,
              rooms_available,
              rooms_sellable_snapshot,
              rooms_booked_snapshot,
              occupancy_ratio_snapshot,
              base_price,
              nightly_price,
              currency,
              pricing_source,
              ai_model_version,
              CASE
                WHEN COALESCE(ai_model_version, '') ~* '(^|[^a-z0-9])(mock|synthetic|fixture|test|demo)([^a-z0-9]|$)'
                  THEN 'synthetic'
                ELSE 'unverified'
              END AS data_provenance,
              NULL::text AS provenance_reference,
              exposure_at,
              exposure_confirmed,
              acceptance_label,
              inventory_snapshot_consistent,
              has_disposition_conflict
       FROM pricing_quote_training_dataset_v1
       WHERE quote_id::text > $1
       ORDER BY quote_id::text
       LIMIT 10000`,
      [cursor],
    );
    if (result.rows.length === 0) break;
    for (const row of result.rows) {
      const line = `${columns.map((column) => csvCell(row[column])).join(',')}\n`;
      await write(stream, digest, line);
      rowsWritten += 1;
    }
    cursor = String(result.rows.at(-1).quote_id);
  }
  await database.query('COMMIT');
  transactionOpen = false;
  stream.end();
  await once(stream, 'finish');
  // rename replaces a same-filesystem file atomically, so readers see either
  // the previous complete export or this complete snapshot, never a gap.
  await rename(temporaryPath, outputPath);
  console.log(JSON.stringify({
    status: 'ok',
    source_view: 'pricing_quote_training_dataset_v1',
    output_path: outputPath,
    rows: rowsWritten,
    sha256: digest.digest('hex'),
    contains_customer_pii: false,
    provenance_policy: 'Known mock/test models are synthetic; all other legacy rows remain unverified until collection provenance is audited.',
    observed_provenance_supported: false,
  }));
} catch (error) {
  if (transactionOpen) {
    await database.query('ROLLBACK').catch(() => undefined);
  }
  stream.destroy();
  await rm(temporaryPath, { force: true }).catch(() => undefined);
  throw error;
} finally {
  await database.end().catch(() => undefined);
}
