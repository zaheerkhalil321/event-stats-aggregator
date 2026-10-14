#!/usr/bin/env node
/**
 * 🔎 Discover missing mika:timing athlete IDs (mika_idp) from result-list pages.
 *
 * Most athletes in hyrox_athlete_results were imported without a mika_idp, so the splits backfill
 * cannot open their detail page. One list page returns 100 athletes with their detail links, so
 * ~1.3M athletes need only ~15k requests. For every race that still has athletes without an idp:
 *   1. find the race's group on the mika season page (wave codes like H_LR3MS4JI1633)
 *   2. page through every day-wave list (100 per page) through the polite rate limiter
 *   3. match list entries to database rows one-to-one (name + finish time, see mika_list.mjs)
 *   4. store mika_idp and the exact wave code (mika_event), so the backfill needs one request per athlete
 * Finished races are recorded in mika_discovery_log and skipped next time.
 *
 * Usage:
 *   node scripts/discover_idps.mjs                         # all races, those missing the most idps first
 *   node scripts/discover_idps.mjs --include-residual      # also races with only a few leftovers
 *   node scripts/discover_idps.mjs --race berlin-2026 --test --max-pages 2   # dry run, no DB writes
 *   node scripts/discover_idps.mjs --until 1791950000      # stop at this unix time (GitHub Actions budget)
 *   node scripts/discover_idps.mjs --retry-done            # re-scan races already marked done
 */

import fs from 'fs';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { createMikaClient } from './lib/mika_http.mjs';
import { parseSeasonGroups, parseListPage, pickRaceGroup, matchItemsToRows, dedupeItems, isOverallWave, waveFamily, divisionFamily } from './lib/mika_list.mjs';

dotenv.config();

if (!process.env.TURSO_DATABASE_URL) {
  console.error('❌ Missing TURSO_DATABASE_URL in environment.');
  process.exit(1);
}

const client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

const args = process.argv.slice(2);
function getArg(key, dflt = null) {
  const eq = args.find((a) => a.startsWith(`--${key}=`));
  if (eq) return eq.slice(key.length + 3);
  const idx = args.indexOf(`--${key}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return dflt;
}
const TARGET_RACE = getArg('race');
const IS_TEST = args.includes('--test');
const RETRY_DONE = args.includes('--retry-done');
const INCLUDE_RESIDUAL = args.includes('--include-residual');
const MAX_PAGES = getArg('max-pages') ? parseInt(getArg('max-pages'), 10) : 400;
const LIMIT_RACES = getArg('limit-races') ? parseInt(getArg('limit-races'), 10) : null;
const DEADLINE = getArg('until') ? parseInt(getArg('until'), 10) * 1000 : Infinity;
const WAVE_CONCURRENCY = 4;

const SEASON_SLUGS = ['season-9', 'season-8', 'season-7', 'season-6', 'season-5'];
const BASE = 'https://hyrox.r.mikatiming.com';

const mika = createMikaClient({
  rate: parseFloat(getArg('rate', '2')),
  maxRate: parseFloat(getArg('max-rate', '6')),
  deadline: DEADLINE,
});

function expectedSlug(race) {
  if (race.season === '26/27') return 'season-9';
  if (race.season === '25/26') return 'season-8';
  if (race.season === '24/25') return 'season-7';
  if (race.season === '23/24') return 'season-6';
  if (race.season === '22/23') return 'season-5';
  return null;
}

async function ensureSchema() {
  const cols = (await client.execute('PRAGMA table_info(hyrox_athlete_results)')).rows.map((r) => r.name);
  if (!cols.includes('mika_event')) {
    await client.execute('ALTER TABLE hyrox_athlete_results ADD COLUMN mika_event TEXT');
    console.log('🧱 Added column hyrox_athlete_results.mika_event');
  }
  await client.execute(`CREATE TABLE IF NOT EXISTS mika_discovery_log (
    race_id TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    season_slug TEXT,
    group_label TEXT,
    list_items INTEGER,
    matched INTEGER,
    still_missing INTEGER,
    note TEXT,
    finished_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
}

const seasonGroups = {};
async function loadSeason(slug) {
  if (seasonGroups[slug]) return true;
  const res = await mika.get(`${BASE}/${slug}/?pid=list`);
  if (res.status !== 200) return false; // not cached, so a temporary failure is retried for the next race
  seasonGroups[slug] = parseSeasonGroups(res.text);
  return true;
}

// Resolves to { pick } (pick may be null when no group fits) or { error } when a season page could not be loaded.
async function findGroup(race) {
  const preferred = expectedSlug(race);
  if (preferred && !(await loadSeason(preferred))) return { error: `season page ${preferred} unavailable` };
  const pick = preferred ? pickRaceGroup({ [preferred]: seasonGroups[preferred] }, race, preferred) : null;
  if (pick) return { pick };
  for (const slug of SEASON_SLUGS) {
    if (!(await loadSeason(slug))) return { error: `season page ${slug} unavailable` };
  }
  return { pick: pickRaceGroup(seasonGroups, race, preferred) };
}

async function logRace(raceId, fields) {
  if (IS_TEST) return;
  await client.execute({
    sql: `INSERT INTO mika_discovery_log (race_id, status, season_slug, group_label, list_items, matched, still_missing, note, finished_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          ON CONFLICT(race_id) DO UPDATE SET status=excluded.status, season_slug=excluded.season_slug, group_label=excluded.group_label,
            list_items=excluded.list_items, matched=excluded.matched, still_missing=excluded.still_missing, note=excluded.note, finished_at=CURRENT_TIMESTAMP`,
    args: [raceId, fields.status, fields.slug ?? null, fields.label ?? null, fields.listItems ?? null, fields.matched ?? null, fields.stillMissing ?? null, fields.note ?? null],
  });
}

async function writeMatches(matches) {
  for (let i = 0; i < matches.length; i += 200) {
    const chunk = matches.slice(i, i + 200);
    const statements = chunk.map((m) => ({
      sql: `UPDATE hyrox_athlete_results SET mika_idp = ?, mika_event = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ? AND (mika_idp IS NULL OR mika_idp = '')`,
      args: [m.idp, m.event, m.id],
    }));
    for (let attempt = 1; ; attempt++) {
      try {
        await client.batch(statements, 'write');
        break;
      } catch (err) {
        if (attempt === 6) throw err;
        console.warn(`⚠️ DB write attempt ${attempt} failed: ${err.message}`);
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }
}

// Dry-run diagnostics: who stayed unmatched on each side.
function reportUnmatched(rows, items, matches) {
  const matchedRows = new Set(matches.map((m) => m.id));
  const matchedIdps = new Set(matches.map((m) => m.idp));
  const countBy = (list, keyFn) => list.reduce((acc, x) => ({ ...acc, [keyFn(x)]: (acc[keyFn(x)] || 0) + 1 }), {});
  const openRows = rows.filter((r) => !matchedRows.has(r.id));
  const openItems = items.filter((it) => !matchedIdps.has(it.idp));
  console.log(`      unmatched DB rows by division: ${JSON.stringify(countBy(openRows, (r) => r.division))}`);
  console.log(`      unmatched DB rows sample: ${openRows.slice(0, 6).map((r) => `${r.full_name} ${r.total_time} [${r.division}]`).join(' | ')}`);
  console.log(`      listed per family: ${JSON.stringify(countBy(items, (it) => waveFamily(it.event)))} | DB rows per family: ${JSON.stringify(countBy(rows, (r) => divisionFamily(r.division)))}`);
  console.log(`      unmatched list items sample: ${openItems.slice(0, 6).map((it) => `${it.name} ${it.time} [${it.event}]`).join(' | ')}`);
}

// A few waves in flight at once: list pages are slow to render, the limiter still spaces every request.
async function scrapeWaves(slug, waves) {
  const items = [];
  const errors = [];
  const emptyFamilies = new Set();
  let complete = true;
  const queue = [...waves];
  await Promise.all(Array.from({ length: Math.min(WAVE_CONCURRENCY, queue.length) }, async () => {
    while (queue.length && !mika.pastDeadline()) {
      const wave = queue.shift();
      const r = await scrapeWave(slug, wave);
      items.push(...r.items);
      if (r.error) errors.push(r.error);
      else if (r.items.length === 0) emptyFamilies.add(waveFamily(wave.val));
      if (!r.complete) complete = false;
    }
  }));
  if (queue.length) complete = false;
  return { items, errors, complete, emptyFamilies };
}

async function scrapeWave(slug, wave) {
  const items = [];
  let pages = 1;
  for (let p = 1; p <= pages && p <= MAX_PAGES; p++) {
    const res = await mika.get(`${BASE}/${slug}/?event=${wave.val}&pid=list&num_results=100&page=${p}`);
    if (res.stopped) return { items, complete: false };
    if (res.status !== 200) return { items, complete: false, error: `HTTP ${res.status} on ${wave.val} page ${p}` };
    const page = parseListPage(res.text);
    if (p === 1) pages = page.total && !page.totalIsLowerBound ? Math.ceil(page.total / 100) : MAX_PAGES;
    for (const it of page.items) items.push({ ...it, event: it.event || wave.val });
    if (page.items.length < 100) break;
  }
  return { items, complete: pages <= MAX_PAGES };
}

async function discoverRace(race) {
  const lookup = await findGroup(race);
  if (mika.pastDeadline()) return { stopped: true };
  if (lookup.error) {
    console.log(`   ⚠️ ${race.id}: ${lookup.error} — will retry next run`);
    return { matched: 0 };
  }
  if (!lookup.pick) {
    await logRace(race.id, { status: 'no_group', note: 'no unambiguous race group on the mika season pages' });
    console.log(`   ⚠️ ${race.id}: no matching race group on mika — skipped`);
    return { matched: 0 };
  }
  const { slug, group } = lookup.pick;

  const rows = (await client.execute({
    sql: `SELECT id, full_name, total_time, division FROM hyrox_athlete_results WHERE race_id = ? AND (mika_idp IS NULL OR mika_idp = '')`,
    args: [race.id],
  })).rows;
  const existingIdps = new Set((await client.execute({
    sql: `SELECT mika_idp FROM hyrox_athlete_results WHERE race_id = ? AND mika_idp IS NOT NULL AND mika_idp != ''`,
    args: [race.id],
  })).rows.map((r) => r.mika_idp));

  const families = new Set(rows.map((r) => divisionFamily(r.division)));
  const wanted = (o) => { const f = waveFamily(o.val); return f === null || families.has(f); };
  let waves = group.options.filter((o) => !isOverallWave(o.val) && wanted(o));
  if (!waves.length) waves = group.options.filter((o) => isOverallWave(o.val) && wanted(o));

  const day = await scrapeWaves(slug, waves);
  // Some day waves show "no results available" although the athletes exist: they are only listed
  // in that division's _OVERALL wave, so scan it for the families where a day wave came back empty.
  const overallWaves = waves.some((w) => isOverallWave(w.val))
    ? []
    : group.options.filter((o) => isOverallWave(o.val) && day.emptyFamilies.has(waveFamily(o.val)));
  const overall = overallWaves.length ? await scrapeWaves(slug, overallWaves) : { items: [], errors: [], complete: true };
  const items = dedupeItems([...day.items, ...overall.items]);
  const errors = [...day.errors, ...overall.errors];
  const complete = day.complete && overall.complete;
  waves = [...waves, ...overallWaves];

  const matches = matchItemsToRows(items, rows, existingIdps);
  if (!IS_TEST && matches.length) await writeMatches(matches);

  const byVia = matches.reduce((acc, m) => ({ ...acc, [m.via]: (acc[m.via] || 0) + 1 }), {});
  const pct = rows.length ? Math.round((matches.length / rows.length) * 100) : 100;
  console.log(`   ✅ ${race.id} [${group.label} · ${slug}] waves ${waves.length} | listed ${items.length} | matched ${matches.length}/${rows.length} (${pct}%) ${JSON.stringify(byVia)}${errors.length ? ` | ⚠️ ${errors.length} wave errors` : ''}`);
  if (IS_TEST) reportUnmatched(rows, items, matches);

  const finished = complete && errors.length === 0 && !mika.pastDeadline();
  await logRace(race.id, {
    status: finished ? 'done' : 'partial',
    slug,
    label: group.label,
    listItems: items.length,
    matched: matches.length,
    stillMissing: rows.length - matches.length,
    note: errors.slice(0, 3).join('; ') || null,
  });
  return { matched: matches.length, stopped: mika.pastDeadline() };
}

async function main() {
  console.log('\n=============================================================');
  console.log('🔎 HYROX mika ID Discovery');
  console.log('=============================================================');
  console.log(`Target Race: ${TARGET_RACE || 'ALL (most recent first)'} | Dry Run: ${IS_TEST ? 'YES' : 'NO'}`);
  if (DEADLINE !== Infinity) console.log(`Stops at:    ${new Date(DEADLINE).toISOString()}`);

  if (!IS_TEST) await ensureSchema();
  const logExists = (await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='mika_discovery_log'`)).rows.length > 0;

  // Races where most athletes lack an idp come first. A handful of leftovers in an otherwise
  // complete race are almost always duplicate rows whose athlete already has an idp, and scanning
  // the whole race for them costs ~1 request per 100 athletes, so those races are skipped.
  const allRaces = (await client.execute({
    sql: `SELECT r.id, r.name, r.city, r.season, r.date,
            SUM(CASE WHEN a.mika_idp IS NULL OR a.mika_idp = '' THEN 1 ELSE 0 END) AS missing,
            COUNT(*) AS total
          FROM hyrox_athlete_results a JOIN hyrox_races r ON a.race_id = r.id
          WHERE 1 = 1
            ${TARGET_RACE ? 'AND r.id = ?' : ''}
            ${logExists && !RETRY_DONE && !TARGET_RACE ? `AND r.id NOT IN (SELECT race_id FROM mika_discovery_log WHERE status IN ('done', 'no_group'))` : ''}
          GROUP BY r.id
          HAVING missing > 0
          ORDER BY (missing * 1.0 / total) DESC, missing DESC`,
    args: TARGET_RACE ? [TARGET_RACE] : [],
  })).rows;
  const isResidual = (r) => Number(r.missing) < 200 && Number(r.missing) / Number(r.total) < 0.05;
  const races = allRaces.filter((r) => TARGET_RACE || INCLUDE_RESIDUAL || !isResidual(r)).slice(0, LIMIT_RACES ?? undefined);
  const skipped = allRaces.length - races.length;

  console.log(`Races to scan: ${races.length} (${races.reduce((s, r) => s + Number(r.missing), 0).toLocaleString()} athletes without an idp)`);
  if (skipped) console.log(`Skipped ${skipped} nearly complete races (< 200 and < 5% of athletes without an idp; use --include-residual to scan them)`);
  console.log('');

  let matchedTotal = 0;
  let scanned = 0;
  let stopped = false;
  for (const race of races) {
    console.log(`🏁 [${++scanned}/${races.length}] ${race.id} — ${Number(race.missing).toLocaleString()} without idp`);
    const r = await discoverRace(race);
    matchedTotal += r.matched || 0;
    if (r.stopped) { stopped = true; console.log('⏱️ Time budget reached — stopping; the next run continues from here.'); break; }
  }

  mika.close();
  const moreWork = stopped || (LIMIT_RACES !== null && races.length === LIMIT_RACES);
  console.log(`\n🏁 Discovery finished: ${matchedTotal.toLocaleString()} idps matched over ${scanned} races | requests ok ${mika.stats.ok}, blocks ${mika.stats.blocks}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `more_work=${moreWork}\n`);
}

main().catch((err) => {
  console.error('\n❌ Fatal discovery error:', err);
  process.exit(1);
});
