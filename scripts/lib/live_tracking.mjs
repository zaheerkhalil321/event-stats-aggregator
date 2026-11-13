// Live tracking for sync_live.mjs: start lists into `startlist_entries`, and the detail pages of
// athletes who are racing right now (splits so far, where on the course). Plan: docs/live-tracking-plan.md.
//
// deps: { mika (paced client), query(sql, args) -> rows, batch([{sql, args}]), log }
import { baseIdp, divisionLabel, isOverallWave } from './mika_list.mjs';
import { clockSeconds, detailUrl, localToUtc, parseLiveDetail, parseStartlistPage, raceDayDate, raceTimezone, startlistUrl } from './startlist.mjs';

export const STARTLIST_DDL = [
  `CREATE TABLE IF NOT EXISTS startlist_entries (
    race_id TEXT NOT NULL,
    mika_idp TEXT NOT NULL,
    mika_event TEXT,
    division TEXT,
    full_name TEXT,
    bib_number TEXT,
    age_group TEXT,
    day TEXT,
    heat TEXT,
    start_at TEXT,
    live TEXT,
    live_updated_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (race_id, mika_idp)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_startlist_race_div_start ON startlist_entries(race_id, division, start_at)',
  'CREATE INDEX IF NOT EXISTS idx_startlist_race_start ON startlist_entries(race_id, start_at)',
];

export const STARTLIST_REFRESH_MS = 3 * 60 * 60 * 1000; // start lists change little during a race
export const RACING_WINDOW_MS = 3 * 60 * 60 * 1000;     // longer than this without a finish: no result
const NO_SIGNAL_RETRY_MS = 30 * 60 * 1000;               // started, but no timing mat yet: look again later

const sexesFor = (waveText) => (/DOUBLES|RELAY/i.test(waveText) ? ['M', 'W', 'X'] : ['M', 'W']);
const iso = (ms) => new Date(ms).toISOString();

/** Is the race on today or tomorrow (UTC)? Asian races start while UTC is still on the day before. */
export function raceInStartlistWindow(race, now = Date.now()) {
  const today = iso(now).slice(0, 10);
  const tomorrow = iso(now + 86_400_000).slice(0, 10);
  return Boolean(race?.date) && race.date <= tomorrow && (race.end_date || race.date) >= today;
}

/** The waves of a race that have a start list (not the Overall lists). */
export const startlistWaves = (waves) => waves.filter((o) => !isOverallWave(o.val) && !/OVERALL/i.test(o.text));

/** Start list rows of one race, with their division and heat start in UTC. */
export async function readStartlist(deps, race, waves, owners = new Map()) {
  const tz = raceTimezone(race);
  if (!tz) deps.log(`   ⚠️ No time zone known for ${race.city} (${race.country_code}); heats get no start time.`);
  const rows = [];
  let complete = true;
  for (const opt of startlistWaves(waves)) {
    for (const sex of sexesFor(opt.text)) {
      for (let page = 1; page <= 60; page++) {
        const r = await deps.mika.get(startlistUrl(opt.val, sex, page));
        if (!r?.text) { complete = false; break; }
        const items = parseStartlistPage(r.text);
        for (const it of items) {
          const date = raceDayDate(race.date, race.end_date, it.day ?? opt.text.split('-').pop());
          rows.push({
            race_id: owners.get(baseIdp(it.idp)) ?? owners.get(it.idp) ?? race.id,
            mika_idp: it.idp,
            mika_event: opt.val,
            division: divisionLabel(opt.text, sex),
            full_name: it.name,
            bib_number: it.bib,
            age_group: it.ageGroup,
            day: it.day,
            heat: it.heat,
            start_at: localToUtc(date, it.heat, tz),
          });
        }
        if (items.length < 100) break;
      }
    }
  }
  return { rows, complete };
}

/** Store a race's start list (every 3 h). Rows that left the start list are removed after a full read. */
export async function syncStartlist(deps, race, waves, owners, { force = false, now = Date.now() } = {}) {
  if (!force) {
    // By the waves read, not by race id: entries another race's Overall list claims are stored under that
    // race, and must neither make this race look fresh nor keep it from being read.
    const ids = startlistWaves(waves).map((o) => o.val);
    if (!ids.length) return { stored: 0 };
    const [last] = await deps.query(
      `SELECT MAX(updated_at) AS at FROM startlist_entries WHERE race_id = ? AND mika_event IN (${ids.map(() => '?').join(', ')})`,
      [race.id, ...ids],
    );
    if (last?.at && now - Date.parse(last.at) < STARTLIST_REFRESH_MS) return { skipped: true };
  }
  const { rows, complete } = await readStartlist(deps, race, waves, owners);
  if (!rows.length) return { stored: 0 };
  const stamp = iso(now);
  const stmts = rows.map((r) => ({
    sql: `INSERT INTO startlist_entries (race_id, mika_idp, mika_event, division, full_name, bib_number, age_group, day, heat, start_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (race_id, mika_idp) DO UPDATE SET mika_event = excluded.mika_event, division = excluded.division,
            full_name = excluded.full_name, bib_number = excluded.bib_number, age_group = excluded.age_group,
            day = excluded.day, heat = excluded.heat, start_at = excluded.start_at, updated_at = excluded.updated_at`,
    args: [r.race_id, r.mika_idp, r.mika_event, r.division, r.full_name, r.bib_number, r.age_group, r.day, r.heat, r.start_at, stamp],
  }));
  for (let i = 0; i < stmts.length; i += 200) await deps.batch(stmts.slice(i, i + 200));
  let removed = 0;
  if (complete) {
    // Only entries read from these waves and not seen now: entries of other races (also ones moved
    // there from these waves earlier and still listed) keep their rows.
    const ids = [...new Set(rows.map((r) => r.mika_event))];
    const where = `mika_event IN (${ids.map(() => '?').join(', ')}) AND updated_at < ?`;
    const res = await deps.query(`SELECT COUNT(*) AS n FROM startlist_entries WHERE ${where}`, [...ids, stamp]);
    removed = Number(res[0]?.n ?? 0);
    if (removed) await deps.batch([{ sql: `DELETE FROM startlist_entries WHERE ${where}`, args: [...ids, stamp] }]);
  }
  return { stored: rows.length, removed, complete };
}

/** Start lists of races that ended over 7 days ago are not needed any more (results keep the rest). */
export async function removeOldStartlists(deps) {
  await deps.batch([{
    sql: `DELETE FROM startlist_entries WHERE race_id IN
            (SELECT id FROM hyrox_races WHERE COALESCE(end_date, date) < date('now', '-7 days'))`,
    args: [],
  }]);
}

/** Athletes of a race who started less than 3 h ago and have no finish yet, least recently read first. */
export async function racingAthletes(deps, raceId, now = Date.now()) {
  return deps.query(`
    SELECT s.mika_idp, s.mika_event, s.heat, s.start_at FROM startlist_entries s
    WHERE s.race_id = ? AND s.start_at IS NOT NULL AND s.start_at <= ? AND s.start_at > ?
      AND NOT EXISTS (SELECT 1 FROM hyrox_athlete_results r
                      WHERE r.mika_idp = s.mika_idp AND r.total_time IS NOT NULL AND r.total_time != '')
      AND (s.live IS NULL OR json_extract(s.live, '$.finished') IS NOT 1)
      AND NOT (s.live IS NOT NULL AND json_extract(s.live, '$.last') IS NULL AND s.live_updated_at > ?)
    ORDER BY s.live_updated_at IS NOT NULL, s.live_updated_at`,
  [raceId, iso(now), iso(now - RACING_WINDOW_MS), iso(now - NO_SIGNAL_RETRY_MS)]);
}

/**
 * Actual start and last timing mat in UTC. The page shows local clock times; the heat's local time
 * and its UTC start (from the start list) give the offset, so no time zone is needed here.
 */
export function withUtcTimes(live, heat, heatStartUtc) {
  const heatMs = Date.parse(heatStartUtc ?? '');
  const startSec = clockSeconds(live.startTod);
  const heatSec = clockSeconds(`${heat}:00`); // heat is hh:mm
  if (!Number.isFinite(heatMs) || !Number.isFinite(startSec) || !Number.isFinite(heatSec)) return live;
  let diff = startSec - heatSec;
  if (diff > 43_200) diff -= 86_400; // around midnight
  if (diff < -43_200) diff += 86_400;
  const startedMs = heatMs + diff * 1000;
  const lastMs = live.last ? startedMs + clockSeconds(live.last.elapsed) * 1000 : null;
  return { ...live, startedAt: iso(startedMs), lastAt: lastMs ? iso(lastMs) : null };
}

/** Read detail pages of racing athletes until the deadline; store splits so far and position. */
export async function refreshRacing(deps, seasonSlug, raceId, deadline) {
  const list = await racingAthletes(deps, raceId);
  let read = 0;
  let pending = [];
  const flush = async () => { if (pending.length) await deps.batch(pending); pending = []; };
  for (const a of list) {
    if (Date.now() >= deadline) break;
    const r = await deps.mika.get(detailUrl(seasonSlug, a.mika_event, a.mika_idp)).catch(() => null);
    if (!r?.text) continue;
    const live = withUtcTimes(parseLiveDetail(r.text), a.heat, a.start_at);
    pending.push({
      sql: 'UPDATE startlist_entries SET live = ?, live_updated_at = ? WHERE race_id = ? AND mika_idp = ?',
      args: [JSON.stringify(live), iso(Date.now()), raceId, a.mika_idp],
    });
    read++;
    if (pending.length >= 25) await flush();
  }
  await flush();
  return { racing: list.length, read };
}
