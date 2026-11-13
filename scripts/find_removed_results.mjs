/**
 * Post-race cleanup, step 1 (read only): results in the database that results.hyrox.com no longer
 * lists for a finished race (mika removes DQs, double entries and test rows after a race; the live
 * sync only adds and updates). Writes a report; deleting is a separate, approved step.
 *
 *   node scripts/find_removed_results.mjs --from 2026-10-01 --to 2026-11-09 --json removed.json
 *
 * Per race: every result id mika lists in its waves (and waves parked under "sonstige"). A database
 * row whose id is not there is:
 *   - "elsewhere": another checked race lists it (a copy filed in the wrong race),
 *   - "gone": no race lists it any more,
 *   - "no_id": no mika id stored, cannot be checked (never deleted by this cleanup).
 * A race where more than --max-share (default 2%) would go is marked "too_many" and left alone.
 */
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { createMikaClient } from './lib/mika_http.mjs';
import { baseIdp, extraWavesFor, isOverallWave, parseSeasonGroups, resolveCalendarRace } from './lib/mika_list.mjs';
import { waveItems } from './lib/overall_owners.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  return args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
};
const SEASON = arg('season', 'season-9');
const SEASON_LABEL = arg('season-label', '26/27');
const FROM = arg('from', '2026-10-01');
const TO = arg('to', new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10));
const MAX_SHARE = Number(arg('max-share', '0.02'));

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const mika = createMikaClient({ rate: Number(arg('rate', '2')), maxRate: 4, log: () => {} });

const races = (await db.execute('SELECT id, name, city, date, end_date, season, status FROM hyrox_races')).rows;
const groups = parseSeasonGroups((await mika.get(`https://results.hyrox.com/${SEASON}/?pid=list`)).text);
const sonstige = groups.find((g) => /sonstige/i.test(g.label));

// Races that ended (end date before --to) in the range, matched to their mika group.
const checks = [];
for (const group of groups) {
  if (group === sonstige) continue;
  const candidates = races.filter((r) => String(r.date) >= FROM && String(r.end_date ?? r.date) <= TO);
  const race = candidates.find((r) => resolveCalendarRace(group.label, candidates, String(r.date), SEASON_LABEL)?.id === r.id);
  if (race) checks.push({ group, race });
}

// Every result id mika lists per race.
const listed = new Map(); // raceId -> Set(baseIdp)
const owner = new Map(); // baseIdp -> raceId (first race listing it)
for (const { group, race } of checks) {
  const ids = new Set();
  const waves = [...group.options, ...extraWavesFor(group, sonstige)].filter(
    (o) => !isOverallWave(o.val) && !/OVERALL/i.test(o.text) && o.text.trim().toUpperCase() !== 'ALL',
  );
  for (const w of waves) {
    for (const sex of /DOUBLES|RELAY/i.test(w.text) ? ['M', 'W', 'X'] : ['M', 'W']) {
      for (const it of await waveItems(mika, SEASON, w.val, sex)) {
        if (/^Ament-/.test(it.name || '')) continue; // mika's test rows
        const id = baseIdp(it.idp);
        ids.add(id);
        if (!owner.has(id)) owner.set(id, String(race.id));
      }
    }
  }
  listed.set(String(race.id), ids);
  console.log(`${String(race.id).padEnd(28)} mika lists ${ids.size}`);
}

const report = [];
for (const { race } of checks) {
  const id = String(race.id);
  const rows = (await db.execute({
    sql: 'SELECT id, mika_idp, full_name, division, total_time FROM hyrox_athlete_results WHERE race_id = ?',
    args: [id],
  })).rows;
  const ids = listed.get(id);
  const gone = [];
  const elsewhere = [];
  let noId = 0;
  for (const r of rows) {
    if (!r.mika_idp) { noId++; continue; }
    const b = baseIdp(r.mika_idp);
    if (ids.has(b)) continue;
    const row = { id: Number(r.id), mika_idp: String(r.mika_idp), name: String(r.full_name), division: String(r.division), total_time: r.total_time ? String(r.total_time) : null };
    const to = owner.get(b);
    if (to && to !== id) elsewhere.push({ ...row, listed_in: to });
    else gone.push(row);
  }
  const share = rows.length ? (gone.length + elsewhere.length) / rows.length : 0;
  const entry = { race_id: id, db_rows: rows.length, mika_listed: ids.size, gone, elsewhere, no_id: noId, share, too_many: share > MAX_SHARE };
  report.push(entry);
  console.log(`${entry.too_many ? '⚠️ ' : '  '}${id.padEnd(28)} db ${String(rows.length).padStart(6)}  mika ${String(ids.size).padStart(6)}  gone ${String(gone.length).padStart(4)}  elsewhere ${String(elsewhere.length).padStart(4)}  no id ${noId}${entry.too_many ? '  (too many: left alone)' : ''}`);
}
if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify({ checkedAt: new Date().toISOString(), season: SEASON, from: FROM, to: TO, report }, null, 2));
