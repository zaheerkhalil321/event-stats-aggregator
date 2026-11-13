/**
 * Post-race cleanup, step 2: delete the results a report of find_removed_results.mjs lists as
 * "gone" (no longer on results.hyrox.com). Without --apply it only prints what it would do.
 *
 *   node scripts/remove_results.mjs --report removed.json                       # dry run
 *   node scripts/remove_results.mjs --report removed.json --apply --backup b.json
 *
 * Safety: races marked "too_many" are skipped; every row is re-read and checked to still match the
 * report (same race, mika id and name) right before it is deleted; full rows are written to the
 * backup file first; at most --max (default 500) rows per run. Rows without a mika id are never
 * touched. Afterwards, refresh hyrox_races.athletes_count of the races touched.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@libsql/client';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return fallback;
};
const APPLY = args.includes('--apply');
const MAX = Number(arg('max', '500'));
const reportFile = arg('report');
if (!reportFile) throw new Error('--report <file> is required');
const backupFile = arg('backup', `removed-results-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`);

const { report } = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const planned = [];
for (const r of report) {
  if (r.too_many) { console.log(`skip ${r.race_id}: ${r.gone.length} would go, more than the share limit`); continue; }
  for (const g of r.gone) planned.push({ race_id: r.race_id, ...g });
}
if (planned.length > MAX) throw new Error(`${planned.length} rows planned, more than --max ${MAX}; nothing done`);

// Re-read every row: it must still be the same result as in the report.
const rows = [];
for (let i = 0; i < planned.length; i += 200) {
  const part = planned.slice(i, i + 200);
  const found = (await db.execute({ sql: `SELECT * FROM hyrox_athlete_results WHERE id IN (${part.map(() => '?').join(',')})`, args: part.map((p) => p.id) })).rows;
  const byId = new Map(found.map((f) => [Number(f.id), f]));
  for (const p of part) {
    const f = byId.get(p.id);
    if (!f) { console.log(`  gone already: ${p.race_id} #${p.id} ${p.name}`); continue; }
    if (String(f.race_id) !== p.race_id || String(f.mika_idp) !== p.mika_idp || String(f.full_name) !== p.name) {
      console.log(`  changed since the report, kept: ${p.race_id} #${p.id} ${p.name}`);
      continue;
    }
    rows.push({ ...f });
  }
}

const perRace = {};
for (const r of rows) perRace[r.race_id] = (perRace[r.race_id] ?? 0) + 1;
console.log(`${APPLY ? 'Deleting' : 'Would delete'} ${rows.length} results:`);
for (const [race, n] of Object.entries(perRace)) console.log(`  ${race.padEnd(28)} ${n}`);
if (!APPLY) process.exit(0);

fs.writeFileSync(backupFile, JSON.stringify({ deletedAt: new Date().toISOString(), report: reportFile, rows }, null, 1));
console.log(`Backup of ${rows.length} full rows: ${backupFile}`);
for (let i = 0; i < rows.length; i += 100) {
  const ids = rows.slice(i, i + 100).map((r) => Number(r.id));
  await db.execute({ sql: `DELETE FROM hyrox_athlete_results WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids });
}
console.log('Done.');
