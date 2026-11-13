#!/usr/bin/env node
/**
 * Compares, per race and division, how many results results.hyrox.com lists with how many are in
 * the database. Reads list pages only (no athlete detail pages), through the paced mika client.
 *
 *   node scripts/verify_race_counts.mjs                       # races of the last 21 days
 *   node scripts/verify_race_counts.mjs --from 2026-09-01 --to 2026-10-31
 *   node scripts/verify_race_counts.mjs --race "Mexico City"  # one race (label contains this text)
 *   node scripts/verify_race_counts.mjs --fix                 # re-sync races with missing results
 *   node scripts/verify_race_counts.mjs --json report.json --markdown report.md
 *
 * A race counts as "missing" when the site has more results than the database by more than
 * --threshold (default: 5 results or 0.5%, whichever is larger). Combined "Overall" and "ALL" waves
 * are skipped (they repeat other waves); waves mika lists under "sonstige" are added to their race.
 * Exit code 2 when, after any --fix, a race is still missing results.
 */
import dotenv from 'dotenv';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@libsql/client';
import { createMikaClient } from './lib/mika_http.mjs';
import { baseIdp, divisionLabel, extraWavesFor, isOverallWave, parseListPage, parseSeasonGroups, resolveCalendarRace } from './lib/mika_list.mjs';
import { raceOwners, waveItems } from './lib/overall_owners.mjs';

dotenv.config();

const args = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  return eq ? eq.split('=').slice(1).join('=') : fallback;
};
const flag = (name) => args.includes(`--${name}`);

const SEASON = arg('season', 'season-9');
const SEASON_LABEL = arg('season-label', '26/27');
const today = new Date().toISOString().slice(0, 10);
const FROM = arg('from', new Date(Date.now() - 21 * 86_400_000).toISOString().slice(0, 10));
const TO = arg('to', today);
const RACE = arg('race');
const FIX = flag('fix');
const MIN_GAP = Number(arg('threshold', '5'));
const BASE = `https://results.hyrox.com/${SEASON}/`;

const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const mika = createMikaClient({ rate: Number(arg('rate', '1.5')), maxRate: 3, log: () => {} });


const isTestRow = (item) => /^Ament-/.test(item.name || '');

async function listPage(wave, sex, page) {
  const r = await mika.get(`${BASE}?event=${wave}&pid=list&num_results=100&search[sex]=${sex}&page=${page}`);
  if (!r.text) throw new Error(`no answer for ${wave} ${sex} page ${page} (status ${r.status})`);
  return parseListPage(r.text);
}

/** Results of one wave and sex: exact counter when mika gives one, else a search over page numbers. */
async function countWave(wave, sex) {
  const first = await listPage(wave, sex, 1);
  const real = first.items.filter((i) => !isTestRow(i)).length;
  if (first.items.length < 100) return real;
  if (first.total && !first.totalIsLowerBound) return first.total;
  let lo = 1;
  let hi = 2;
  let hiItems = (await listPage(wave, sex, hi)).items.length;
  while (hiItems === 100) {
    lo = hi;
    hi *= 2;
    hiItems = (await listPage(wave, sex, hi)).items.length;
  }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    const n = (await listPage(wave, sex, mid)).items.length;
    if (n === 100) lo = mid;
    else {
      hi = mid;
      hiItems = n;
    }
  }
  return lo * 100 + hiItems;
}

/**
 * Site results per division. With an owner map (from the Overall lists of the races checked), a
 * result that another race's Overall list claims is counted for that race instead (mika sometimes
 * files a race's results in another race's day wave); those go into `transfers[raceId][division]`.
 */
async function siteCounts(group, sonstige, raceId, owners, transfers) {
  const waves = [...group.options, ...extraWavesFor(group, sonstige)].filter(
    (o) => !isOverallWave(o.val) && !/OVERALL/i.test(o.text) && o.text.trim().toUpperCase() !== 'ALL',
  );
  const byDivision = {};
  for (const w of waves) {
    const up = w.text.toUpperCase();
    const sexes = up.includes('DOUBLES') || up.includes('RELAY') ? ['M', 'W', 'X'] : ['M', 'W'];
    for (const sex of sexes) {
      const div = divisionLabel(w.text, sex);
      let n;
      if (owners.size === 0) {
        n = await countWave(w.val, sex);
      } else {
        const items = (await waveItems(mika, SEASON, w.val, sex)).filter((i) => !isTestRow(i));
        n = 0;
        for (const it of items) {
          const to = owners.get(baseIdp(it.idp));
          if (to && to !== raceId) {
            transfers[to] ??= {};
            transfers[to][div] = (transfers[to][div] ?? 0) + 1;
          } else n++;
        }
      }
      if (n > 0) byDivision[div] = (byDivision[div] ?? 0) + n;
    }
  }
  return byDivision;
}

// ---------- independent check: mika's "Overall" lists ----------
// An "Overall" wave lists every result of one family (H_ = open, HD_ = doubles, ...) across all days
// and groups, wherever mika filed the waves. Comparing those totals with the database does not
// depend on how the scraper finds waves, so it catches waves the wave-by-wave check cannot see.
const FAMILY_OF_PREFIX = { H: 'HYROX', HD: 'HYROX DOUBLES', HA: 'HYROX ADAPTIVE', HPRO: 'HYROX PRO', HDP: 'HYROX PRO DOUBLES', HMR: 'HYROX TEAM RELAY' };

export function familyOfDivision(division) {
  const d = division.toUpperCase();
  const sex = / MIXED$/.test(d) ? 'X' : / WOMEN$/.test(d) ? 'W' : / MEN$/.test(d) ? 'M' : null;
  const base = d.replace(/ (MEN|WOMEN|MIXED)$/, '');
  return sex ? { family: base, sex } : null;
}

async function overallCounts(group, sonstige) {
  const waves = [...group.options, ...extraWavesFor(group, sonstige)].filter((o) => /_OVERALL(_\d+)?$/i.test(o.val));
  const out = {};
  for (const w of waves) {
    const family = FAMILY_OF_PREFIX[w.val.split('_')[0]];
    if (!family) continue;
    for (const sex of ['M', 'W', 'X']) {
      const n = await countWave(w.val, sex);
      if (n > 0) out[`${family}|${sex}`] = (out[`${family}|${sex}`] ?? 0) + n;
    }
  }
  return out;
}

function compareOverall(overall, dbc) {
  const fromDb = {};
  for (const [division, n] of Object.entries(dbc)) {
    const f = familyOfDivision(division);
    if (f) fromDb[`${f.family}|${f.sex}`] = (fromDb[`${f.family}|${f.sex}`] ?? 0) + n;
  }
  return Object.entries(overall).map(([key, site]) => {
    const [family, sex] = key.split('|');
    return { family, sex, site, db: fromDb[key] ?? 0, diff: (fromDb[key] ?? 0) - site };
  });
}

async function dbCounts(raceId) {
  const r = await db.execute({
    sql: 'SELECT division, COUNT(*) AS n FROM hyrox_athlete_results WHERE race_id = ? GROUP BY division',
    args: [raceId],
  });
  return Object.fromEntries(r.rows.map((x) => [String(x.division), Number(x.n)]));
}

function compare(site, dbc) {
  const divisions = [...new Set([...Object.keys(site), ...Object.keys(dbc)])].sort();
  const rows = divisions.map((d) => ({ division: d, site: site[d] ?? 0, db: dbc[d] ?? 0, diff: (dbc[d] ?? 0) - (site[d] ?? 0) }));
  const siteTotal = rows.reduce((a, r) => a + r.site, 0);
  const missing = rows.reduce((a, r) => a + Math.max(0, -r.diff), 0);
  const extra = rows.reduce((a, r) => a + Math.max(0, r.diff), 0);
  const limit = Math.max(MIN_GAP, Math.ceil(siteTotal * 0.005));
  return { rows, siteTotal, dbTotal: rows.reduce((a, r) => a + r.db, 0), missing, extra, missingOverLimit: missing > limit, limit };
}

async function main() {
  const races = (await db.execute('SELECT id, name, city, date, end_date, season, status FROM hyrox_races')).rows;
  const groups = parseSeasonGroups((await mika.get(`${BASE}?pid=list`)).text);
  const sonstige = groups.find((g) => /sonstige/i.test(g.label));
  const report = [];

  // 1. The races to check, matched to the calendar as of their own days.
  const checks = [];
  for (const group of groups) {
    if (group === sonstige) continue;
    if (RACE && !group.label.toLowerCase().includes(RACE.toLowerCase())) continue;
    const candidates = races.filter((r) => String(r.date) >= FROM && String(r.date) <= TO && String(r.date) <= today);
    const race = candidates.find((r) => resolveCalendarRace(group.label, candidates, String(r.date), SEASON_LABEL)?.id === r.id);
    if (race) checks.push({ group, race });
  }

  // 2. Which race each result belongs to, from the Overall lists of every race in the date range
  //    (also when only one race is checked, so a race running the same weekend is seen).
  const inRange = [];
  for (const group of groups) {
    if (group === sonstige) continue;
    const candidates = races.filter((r) => String(r.date) >= FROM && String(r.date) <= TO && String(r.date) <= today);
    const race = candidates.find((r) => resolveCalendarRace(group.label, candidates, String(r.date), SEASON_LABEL)?.id === r.id);
    if (race && checks.some((c) => String(race.date) <= String(c.race.end_date ?? c.race.date) && String(race.end_date ?? race.date) >= String(c.race.date))) {
      inRange.push({ raceId: String(race.id), group });
    }
  }
  const { owners } = await raceOwners(mika, SEASON, inRange, sonstige);
  console.log(`Overall lists of ${inRange.length} race(s) give ${owners.size} results a race.`);

  // 3. Site counts per race (results moved to the race whose Overall list claims them).
  const transfers = {};
  for (const c of checks) c.site = await siteCounts(c.group, sonstige, String(c.race.id), owners, transfers);
  // Races running at the same time that are not checked themselves can still hold results of a
  // checked race in their waves: read them only for those transfers.
  if (owners.size) {
    for (const r of inRange) {
      if (!checks.some((c) => String(c.race.id) === r.raceId)) await siteCounts(r.group, sonstige, r.raceId, owners, transfers);
    }
  }
  for (const c of checks) {
    for (const [div, n] of Object.entries(transfers[String(c.race.id)] ?? {})) c.site[div] = (c.site[div] ?? 0) + n;
  }

  // 4. Compare with the database, re-sync what is missing.
  for (const { group, race, site } of checks) {
    let result = compare(site, await dbCounts(String(race.id)));
    const overall = await overallCounts(group, sonstige);
    let overallRows = compareOverall(overall, await dbCounts(String(race.id)));
    const overallMissing = () => overallRows.reduce((a, r) => a + Math.max(0, -r.diff), 0);
    // Missing by either check counts as missing.
    const markMissing = () => {
      const om = overallMissing();
      if (om > result.limit) result.missingOverLimit = true;
      result.overallMissing = om;
    };
    markMissing();
    let fixed = false;
    if (FIX && result.missingOverLimit) {
      console.log(`↻ ${race.id}: ${result.missing} results missing, re-syncing "${group.label}"…`);
      const run = spawnSync('node', ['sync_live.mjs', `--race=${group.label}`, '--splits=0'], { stdio: 'inherit', env: process.env });
      fixed = run.status === 0;
      result = compare(site, await dbCounts(String(race.id)));
      overallRows = compareOverall(overall, await dbCounts(String(race.id)));
      markMissing();
    }
    const moved = Object.values(transfers[String(race.id)] ?? {}).reduce((a, n) => a + n, 0);
    report.push({ race: String(race.id), label: group.label, date: String(race.date), status: String(race.status), fixed, movedIn: moved, ...result, overall: overallRows });
    const mark = result.missingOverLimit ? '❌' : result.extra > result.limit ? '⚠️ ' : '✅';
    console.log(`${mark} ${String(race.id).padEnd(30)} site ${String(result.siteTotal).padStart(6)}  db ${String(result.dbTotal).padStart(6)}  missing ${String(result.missing).padStart(5)}  extra ${String(result.extra).padStart(5)}  | overall lists: missing ${result.overallMissing}${moved ? `  | ${moved} filed by mika under another race` : ''}`);
    for (const r of overallRows.filter((x) => x.diff < 0)) {
      console.log(`     overall ${(r.family + ' ' + r.sex).padEnd(26)} site ${String(r.site).padStart(6)}  db ${String(r.db).padStart(6)}  ${r.diff}`);
    }
    for (const r of result.rows.filter((x) => Math.abs(x.diff) > 0)) {
      console.log(`     ${r.division.padEnd(32)} site ${String(r.site).padStart(6)}  db ${String(r.db).padStart(6)}  ${r.diff > 0 ? '+' : ''}${r.diff}`);
    }
  }

  const bad = report.filter((r) => r.missingOverLimit);
  if (arg('json')) fs.writeFileSync(arg('json'), JSON.stringify({ checkedAt: new Date().toISOString(), from: FROM, to: TO, races: report }, null, 2));
  if (arg('markdown')) {
    const lines = [
      `Checked ${report.length} races (${FROM} to ${TO}) on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      '',
      bad.length ? `**${bad.length} race(s) still miss results:**` : 'All races match the results site.',
      '',
    ];
    for (const r of bad) {
      lines.push(`- **${r.race}** (${r.date}): site ${r.siteTotal}, database ${r.dbTotal}, missing ${r.missing} (by waves), ${r.overallMissing} (by Overall lists)`);
      for (const o of (r.overall || []).filter((x) => x.diff < 0)) lines.push(`  - Overall ${o.family} ${o.sex}: site ${o.site}, database ${o.db}`);
      for (const d of r.rows.filter((x) => x.diff < 0)) lines.push(`  - ${d.division}: site ${d.site}, database ${d.db}`);
    }
    fs.writeFileSync(arg('markdown'), lines.join('\n') + '\n');
  }
  console.log(`\n${report.length} races checked, ${bad.length} with missing results.`);
  process.exitCode = bad.length ? 2 : 0;
}

main().catch((err) => {
  console.error('verify failed:', err);
  process.exitCode = 1;
});
