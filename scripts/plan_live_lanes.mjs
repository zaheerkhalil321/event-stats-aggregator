// Plans the lanes of one live-sync run: which races each parallel runner syncs.
// Writes `lanes` (JSON for the workflow matrix) to $GITHUB_OUTPUT and prints the plan.
//
//   node scripts/plan_live_lanes.mjs                # plan for races running now
//   FORCE_RACE=barcelona node scripts/plan_live_lanes.mjs   # one lane for one race (manual run)
//
// Reads only the database (races, start lists, live_pass_stats); never mika. When the database
// cannot be read, one lane syncs everything, as before lanes existed.
import 'dotenv/config';
import fs from 'node:fs';
import { createClient } from '@libsql/client';
import { estimateLoad, laneMatrix, peakOnCourse, planLanes } from './lib/live_planner.mjs';
import { raceRegion } from './lib/startlist.mjs';

export async function planFromDatabase(db, now = Date.now()) {
  const day = (offset) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
  // Running today or tomorrow (Asia starts while UTC is on the day before), or ended yesterday
  // (late corrections).
  const races = (await db.execute({
    sql: `SELECT id, name, city, country_code, date, end_date FROM hyrox_races
          WHERE date <= ? AND COALESCE(end_date, date) >= ? ORDER BY id`,
    args: [day(1), day(-1)],
  })).rows;
  if (!races.length) return { lanes: laneMatrix(planLanes([])), races: [] };

  const marks = races.map(() => '?').join(', ');
  const ids = races.map((r) => String(r.id));
  const [starts, waves, stats] = await Promise.all([
    db.execute({ sql: `SELECT race_id, start_at FROM startlist_entries WHERE race_id IN (${marks}) AND start_at IS NOT NULL`, args: ids }),
    db.execute({ sql: `SELECT race_id, mika_event, division FROM startlist_entries WHERE race_id IN (${marks}) GROUP BY 1, 2, 3`, args: ids }),
    db.execute({ sql: `SELECT * FROM live_pass_stats WHERE race_id IN (${marks})`, args: ids }).catch(() => ({ rows: [] })),
  ]);
  const startsOf = new Map();
  for (const r of starts.rows) startsOf.set(r.race_id, [...(startsOf.get(r.race_id) ?? []), String(r.start_at)]);
  const wavesOf = new Map();
  // One row per wave and division; the division names the sex, so each row is one list to read.
  for (const r of waves.rows) wavesOf.set(r.race_id, (wavesOf.get(r.race_id) ?? 0) + 1);
  const statsOf = new Map(stats.rows.map((r) => [String(r.race_id), r]));

  const planned = races.map((r) => {
    const id = String(r.id);
    const peak = peakOnCourse(startsOf.get(id) ?? [], now);
    const s = statsOf.get(id);
    const load = estimateLoad({
      waves: wavesOf.get(id) || 10,
      peak,
      stats: s ? { list_seconds: s.list_seconds != null ? Number(s.list_seconds) : null, seconds_per_page: s.seconds_per_page != null ? Number(s.seconds_per_page) : null } : null,
    });
    return { id, name: String(r.name).replace(/^HYROX\s+/i, '').replace(/\s+\d{4}$/, ''), region: raceRegion(r), load, peak };
  });
  const lanes = planLanes(planned);
  return { lanes: laneMatrix(lanes, new Map(planned.map((p) => [p.id, p.name]))), races: planned };
}

async function main() {
  const out = process.env.GITHUB_OUTPUT;
  // The workflow matrix: {"include": [{lane, label, args, load}, ...]}.
  const write = (lanes) => {
    const matrix = JSON.stringify({ include: lanes });
    console.log(`matrix=${matrix}`);
    if (out) fs.appendFileSync(out, `matrix=${matrix}\n`);
  };
  const force = (process.env.FORCE_RACE || '').trim();
  if (force) {
    console.log(`Manual run for "${force}": one lane.`);
    return write([{ lane: 1, label: `1: ${force}`, args: `--race=${force}`, load: 0 }]);
  }
  try {
    const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    const { lanes, races } = await planFromDatabase(db);
    for (const r of races) console.log(`  ${r.id.padEnd(28)} ${r.region.padEnd(9)} peak on course ${String(r.peak).padStart(4)}  ~${r.load} s/pass`);
    for (const l of lanes) console.log(`Lane ${l.lane} (~${l.load} s/pass): ${l.label.replace(/^\d+: /, '')}  ${l.args}`);
    write(lanes);
  } catch (err) {
    console.log(`::warning title=Live lanes not planned::${err.message}; one lane syncs every race.`);
    write([{ lane: 1, label: '1: all races', args: '', load: 0 }]);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
