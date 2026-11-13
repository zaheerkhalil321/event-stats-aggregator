/**
 * Removes copies of one race's results stored under another race (old imports put e.g. Atlanta
 * spring 2025 results into Atlanta fall 2025). Without --apply it only reports.
 *
 *   node scripts/dedupe_races.mjs                         # dry run
 *   node scripts/dedupe_races.mjs --apply --backup b.json
 *
 * For each pair (keeper = the race mika lists these results under, copy = the race holding copies),
 * checked with mika's own lists beforehand (2026-11-13, see PAIRS):
 *   1. keeper rows whose division is an old raw name ("HYROX - Saturday MEN", "HYROX DOUBLES -
 *      Sunday") take the clean division of the copy of the same result, when it is clean;
 *   2. copy rows whose mika id the keeper also has are deleted;
 *   3. with moveRest, copy rows the keeper lacks are moved to the keeper (same mika race).
 * Full rows are backed up before anything changes. Rows without a mika id are never touched.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@libsql/client';

// keeper: race whose mika race lists these ids; copy: race that holds copies of them.
export const PAIRS = [
  { keeper: 'paris-spring-2025', copy: 'paris-1-2025', moveRest: true, note: 'both are mika season-7 "2025 Paris 1"' },
  { keeper: 'atlanta-spring-2025', copy: 'atlanta-2025', note: 'ids are season-7 "2025 Atlanta" (April); atlanta-2025 is the October race' },
  { keeper: 'beijing-sep-2026', copy: 'beijing-2026', note: 'ids are season-9 "2026 Beijing" (September); beijing-2026 is January' },
  { keeper: 'mumbai-spring-2025', copy: 'mumbai-2025', note: 'ids are season-7 "2025 Mumbai" (May); mumbai-2025 is September' },
  { keeper: 'shanghai-2025', copy: 'shanghai-fall-2025', note: 'ids are season-7 "2025 Shanghai" (April)' },
];

const CLEAN = /^HYROX (PRO |ADAPTIVE |PRO DOUBLES |DOUBLES |TEAM RELAY )?(MEN|WOMEN|MIXED)$/;
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const backupFile = args[args.indexOf('--backup') + 1] && args.includes('--backup')
  ? args[args.indexOf('--backup') + 1]
  : `dedupe-backup-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.json`;

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
// Read in pages: a whole race in one answer is more than the database sends at once.
async function rowsOf(raceId) {
  const out = [];
  for (let last = 0; ;) {
    const page = (await db.execute({ sql: 'SELECT * FROM hyrox_athlete_results WHERE race_id = ? AND id > ? ORDER BY id LIMIT 1000', args: [raceId, last] })).rows;
    out.push(...page);
    if (page.length < 1000) return out;
    last = Number(page[page.length - 1].id);
  }
}

const plan = [];
for (const p of PAIRS) {
  const keeper = await rowsOf(p.keeper);
  const copy = await rowsOf(p.copy);
  const keeperByIdp = new Map(keeper.filter((r) => r.mika_idp).map((r) => [String(r.mika_idp), r]));
  const keeperNames = new Set(keeper.map((r) => `${String(r.full_name).toLowerCase()}|${r.division}`));
  const renames = [];
  const deletes = [];
  const moves = [];
  for (const c of copy) {
    if (!c.mika_idp) continue;
    const k = keeperByIdp.get(String(c.mika_idp));
    if (k) {
      deletes.push(c);
      if (!CLEAN.test(String(k.division)) && CLEAN.test(String(c.division))) {
        // the keeper's (race, name, division) must stay unique
        if (!keeperNames.has(`${String(k.full_name).toLowerCase()}|${c.division}`)) {
          renames.push({ id: Number(k.id), from: String(k.division), to: String(c.division) });
          keeperNames.add(`${String(k.full_name).toLowerCase()}|${c.division}`);
        }
      }
    } else if (p.moveRest) {
      if (!keeperNames.has(`${String(c.full_name).toLowerCase()}|${c.division}`)) moves.push(c);
    }
  }
  plan.push({ ...p, keeperRows: keeper.length, copyRows: copy.length, renames, deletes, moves });
  console.log(`${p.copy.padEnd(20)} -> keeper ${p.keeper.padEnd(20)} | copy rows ${String(copy.length).padStart(6)}: delete ${String(deletes.length).padStart(5)}, move ${moves.length} | keeper divisions fixed ${renames.length} | ${p.note}`);
}

const total = plan.reduce((a, p) => a + p.deletes.length, 0);
console.log(`\n${APPLY ? 'Applying' : 'Would'}: delete ${total} copies, move ${plan.reduce((a, p) => a + p.moves.length, 0)}, fix ${plan.reduce((a, p) => a + p.renames.length, 0)} division names.`);
if (!APPLY) process.exit(0);

fs.writeFileSync(backupFile, JSON.stringify({
  at: new Date().toISOString(),
  pairs: plan.map((p) => ({ keeper: p.keeper, copy: p.copy, deleted: p.deletes, moved: p.moves, renamed: p.renames })),
}));
console.log(`Backup: ${backupFile}`);
for (const p of plan) {
  for (let i = 0; i < p.renames.length; i += 100) {
    await db.batch(p.renames.slice(i, i + 100).map((r) => ({ sql: 'UPDATE hyrox_athlete_results SET division = ? WHERE id = ?', args: [r.to, r.id] })), 'write');
  }
  for (let i = 0; i < p.deletes.length; i += 200) {
    const ids = p.deletes.slice(i, i + 200).map((r) => Number(r.id));
    await db.execute({ sql: `DELETE FROM hyrox_athlete_results WHERE id IN (${ids.map(() => '?').join(',')})`, args: ids });
  }
  for (const m of p.moves) {
    await db.execute({ sql: 'UPDATE hyrox_athlete_results SET race_id = ? WHERE id = ?', args: [p.keeper, Number(m.id)] });
  }
  console.log(`  ${p.copy}: ${p.deletes.length} deleted, ${p.moves.length} moved; ${p.keeper}: ${p.renames.length} divisions fixed`);
}
console.log('Done.');
