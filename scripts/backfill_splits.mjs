#!/usr/bin/env node
/**
 * ⚡ Ultra-Fast Deep Splits & Full Analytics Backfill Engine
 * 
 * Extracts 100% of official chip-timing data from Mika Timing:
 *  - 17 Splits (8 Runs + 8 Workout Stations + Roxzone)
 *  - run_total & best_run_lap
 *  - Official Station Place Ranks (direct from chip timing)
 *  - Penalties, Bonuses & Disqualification reasons
 *  - Exact Gender & Age Group ranks
 *  - Team Members for Doubles & Relays (Member 1, Member 2, etc.)
 *  - Cumulative Checkpoint Elapsed Times (Race Replay)
 * 
 * All mika:timing requests go through the self-tuning rate limiter in lib/mika_http.mjs: it keeps
 * a steady pace just below the site's firewall limit and waits out a 403 instead of aborting.
 * Athletes need a mika_idp (see discover_idps.mjs); when mika_event is known, one request per athlete.
 *
 * Usage:
 *   node scripts/backfill_splits.mjs --race bordeaux-2026 --division "HYROX PRO WOMEN"
 *   node scripts/backfill_splits.mjs --race bordeaux-2026
 *   node scripts/backfill_splits.mjs --season 2026
 *   node scripts/backfill_splits.mjs --seasons 2026,2025,2024,all --forever --until <unix time> --exit-when-idle
 *   node scripts/backfill_splits.mjs --test
 */

import fs from 'fs';
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
import { createMikaClient } from './lib/mika_http.mjs';
import { updateSql } from './lib/athlete_update_sql.mjs';
dotenv.config();

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!TURSO_URL) {
  console.error('❌ Missing TURSO_DATABASE_URL in environment.');
  process.exit(1);
}

const client = createClient({
  url: TURSO_URL,
  authToken: TURSO_TOKEN,
});

// CLI Arguments
const args = process.argv.slice(2);
function getArg(key, dflt = null) {
  const eq = args.find(a => a.startsWith(`--${key}=`));
  if (eq) return eq.slice(key.length + 3);
  const idx = args.indexOf(`--${key}`);
  if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  return dflt;
}
const TARGET_RACE = getArg('race', null);
const TARGET_DIV = getArg('division', null);
const TARGET_SEASON = getArg('season', null);
const LIMIT = getArg('limit', null) ? parseInt(getArg('limit'), 10) : null;
const IS_TEST = args.includes('--test');
// Workers in flight; the actual request rate is set by the limiter, not by this number.
const CONCURRENCY = getArg('concurrency', '8') ? parseInt(getArg('concurrency', '8'), 10) : 8;
const SEASONS = (getArg('seasons') || TARGET_SEASON || 'all').split(',').map((s) => s.trim()).filter(Boolean);
const FOREVER = args.includes('--forever');
const EXIT_WHEN_IDLE = args.includes('--exit-when-idle');
const DEADLINE = getArg('until') ? parseInt(getArg('until'), 10) * 1000 : Infinity;

const mika = createMikaClient({
  rate: parseFloat(getArg('rate', '2')),
  maxRate: parseFloat(getArg('max-rate', '6')),
  deadline: DEADLINE,
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cache Optgroups & Wave Values per Season
// ─────────────────────────────────────────────────────────────────────────────
const seasonWavesCache = new Map();

async function getOptgroupsForSeason(seasonSlug) {
  if (seasonWavesCache.has(seasonSlug)) {
    return seasonWavesCache.get(seasonSlug);
  }

  const url = `https://hyrox.r.mikatiming.com/${seasonSlug}/?pid=list`;
  try {
    const res = await mika.get(url);
    if (res.status !== 200) {
      // Not cached: an empty wave list would make every athlete of the season look like a DNS.
      console.warn(`⚠️ Could not fetch optgroups for ${seasonSlug}: HTTP ${res.status}`);
      return [];
    }
    const html = res.text;

    const optgroups = [];
    const ogRegex = /<optgroup[^>]*label="([^"]*)"[^>]*>([\s\S]*?)<\/optgroup>/gi;
    let m;
    while ((m = ogRegex.exec(html)) !== null) {
      const label = m[1].trim();
      const inner = m[2];
      const options = [];
      const optRegex = /<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi;
      let optM;
      while ((optM = optRegex.exec(inner)) !== null) {
        options.push({
          val: optM[1].trim(),
          text: optM[2].replace(/<[^>]+>/g, '').trim(),
        });
      }
      optgroups.push({ label, options });
    }

    seasonWavesCache.set(seasonSlug, optgroups);
    return optgroups;
  } catch (err) {
    console.warn(`⚠️ Could not fetch optgroups for ${seasonSlug}:`, err.message);
    return [];
  }
}

// Match division & race to candidate wave options
function findWaveCandidates(optgroups, raceCity, division) {
  const normCity = raceCity.toLowerCase().replace(/[^a-z]/g, '');
  const matchingGroup = optgroups.find((g) => {
    const normLabel = g.label.toLowerCase().replace(/[^a-z]/g, '');
    return normLabel.includes(normCity);
  });

  if (!matchingGroup) return [];

  const divUpper = division.toUpperCase();
  const isPro = divUpper.includes('PRO');
  const isDoubles = divUpper.includes('DOUBLES');
  const isRelay = divUpper.includes('RELAY');
  const isAdaptive = divUpper.includes('ADAPTIVE');

  return matchingGroup.options
    .filter((o) => {
      const t = o.text.toUpperCase();
      const val = o.val.toUpperCase();

      if (isAdaptive) return t.includes('ADAPTIVE') || val.startsWith('HA_');
      if (isRelay) return t.includes('RELAY') || val.startsWith('HMR_');

      if (isPro && isDoubles) {
        return (t.includes('PRO DOUBLES') || (t.includes('PRO') && t.includes('DOUBLES'))) || val.startsWith('HDP_');
      }
      if (isPro && !isDoubles) {
        return (t.includes('PRO') && !t.includes('DOUBLES')) || (val.startsWith('HPRO_') && !val.startsWith('HDP_'));
      }
      if (isDoubles && !isPro) {
        return (t.includes('DOUBLES') && !t.includes('PRO')) || (val.startsWith('HD_') && !val.startsWith('HDP_'));
      }
      // Standard singles
      return (!t.includes('PRO') && !t.includes('DOUBLES') && !t.includes('RELAY') && !t.includes('ADAPTIVE')) || val.startsWith('H_');
    })
    .map((o) => o.val);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML Deep Parser for Mika Timing Detail Page
// ─────────────────────────────────────────────────────────────────────────────
export function parseDeepDetail(html) {
  const getTime = (code) => {
    const match = html.match(new RegExp(`class="[^"]*f-time_${code}[^"]*"[^>]*>([0-9:]+)`));
    return match ? match[1].trim() : null;
  };

  const getRank = (code) => {
    const re = new RegExp(`<tr[^>]*f-time_${code}[^>]*>[\\s\\S]*?<td[^>]*class="[^"]*last[^"]*"[^>]*>([0-9]+)<\\/td>`, 'i');
    const m = html.match(re);
    return m ? parseInt(m[1].trim(), 10) : null;
  };

  const getCleanTd = (cls) => {
    const m = html.match(new RegExp(`<td[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, 'i'));
    if (!m) return null;
    const clean = m[1].replace(/<[^>]+>/g, '').replace(/&ndash;/g, '').replace(/[–—]/g, '').trim();
    return clean && clean !== '-' ? clean : null;
  };

  const getNumTd = (cls) => {
    const v = getCleanTd(cls);
    if (!v) return null;
    const n = parseInt(v.replace(/[^0-9]/g, ''), 10);
    return isNaN(n) ? null : n;
  };

  // Station place ranks from chip timing sensors
  const stationRanks = {};
  const stationCodes = [
    ['skierg', '11'],
    ['sled_push', '12'],
    ['sled_pull', '13'],
    ['burpee_jumps', '14'],
    ['rowing', '15'],
    ['farmers_carry', '16'],
    ['sandbag_lunges', '17'],
    ['wall_balls', '18'],
    ['roxzone', '60'],
    ['run_total', '49'],
    ['best_run_lap', '50'],
  ];

  for (const [name, code] of stationCodes) {
    const r = getRank(code);
    if (r !== null) stationRanks[name] = r;
  }

  // Parse team members (Member 1, Member 2, etc.) for Doubles / Relays
  const teamMembers = [];
  const memberRegex = /<tr[^>]*>[\s\S]*?<th[^>]*>(Member\s*[0-9]+)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>/gi;
  let memM;
  while ((memM = memberRegex.exec(html)) !== null) {
    const label = memM[1].trim();
    const name = memM[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (name) teamMembers.push({ label, name });
  }

  // Parse nationality (flags or members)
  const natM = html.match(/class="nation__abbr"[^>]*>([A-Z]{2,3})/i);
  let nation = natM ? natM[1].toUpperCase() : getCleanTd('f-__nation');
  if (!nation && teamMembers.length > 0) {
    const mem1Nat = teamMembers[0].name.match(/\(([A-Z]{2,3})\)/i);
    if (mem1Nat) nation = mem1Nat[1].toUpperCase();
  }

  // Parse cumulative elapsed times from Table 2 (Race Replay)
  const cumulativeTimes = {};
  const replayRegex = /<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([0-9:]+)<\/td>[\s\S]*?<td[^>]*class="[^"]*last[^"]*"[^>]*>[0-9:]+<\/td>[\s\S]*?<\/tr>/gi;
  let repM;
  while ((repM = replayRegex.exec(html)) !== null) {
    const point = repM[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const elapsed = repM[2].trim();
    if (point && elapsed && !point.toLowerCase().includes('member') && !point.toLowerCase().includes('rank')) {
      cumulativeTimes[point] = elapsed;
    }
  }

  // Parse athlete start clock time
  let startTime = null;
  const split1OfDay = html.match(/<td[^>]*class="[^"]*time_day[^"]*"[^>]*>([0-9:]+)<\/td>/i)?.[1];
  const run1 = getTime('01');
  if (split1OfDay && run1) {
    const [h, m, s] = split1OfDay.split(':').map(Number);
    const [rh, rm, rs] = (run1.length === 5 ? '00:' + run1 : run1).split(':').map(Number);
    const totalDaySec = (h * 3600 + m * 60 + s) - (rh * 3600 + rm * 60 + rs);
    if (totalDaySec >= 0) {
      const sh = String(Math.floor(totalDaySec / 3600) % 24).padStart(2, '0');
      const sm = String(Math.floor((totalDaySec % 3600) / 60)).padStart(2, '0');
      const ss = String(totalDaySec % 60).padStart(2, '0');
      startTime = `${sh}:${sm}:${ss}`;
    }
  }

  const genderRank = getNumTd('f-place_all') ?? getNumTd('f-place_n_m') ?? getNumTd('f-place_n_w');
  const ageGroupRank = getNumTd('f-place_age') ?? getNumTd('f-place_age_class');

  return {
    run_1: run1,
    skierg: getTime('11'),
    run_2: getTime('02'),
    sled_push: getTime('12'),
    run_3: getTime('03'),
    sled_pull: getTime('13'),
    run_4: getTime('04'),
    burpee_jumps: getTime('14'),
    run_5: getTime('05'),
    rowing: getTime('15'),
    run_6: getTime('06'),
    farmers_carry: getTime('16'),
    run_7: getTime('07'),
    sandbag_lunges: getTime('17'),
    run_8: getTime('08'),
    wall_balls: getTime('18'),
    roxzone: getTime('60'),
    run_total: getTime('49'),
    best_run_lap: getTime('50'),
    penalty_time: getCleanTd('f-gimmick_01'),
    bonus_time: getCleanTd('f-gimmick_04'),
    disqual_reason: getCleanTd('f-disqual_reason'),
    bib_number: getCleanTd('f-start_no_text'),
    nationality: nation,
    age_group: getCleanTd('f-_type_age_class'),
    start_wave: getCleanTd('f-__event'),
    start_time: startTime,
    gender_rank: genderRank,
    age_group_rank: ageGroupRank,
    station_ranks: Object.keys(stationRanks).length > 0 ? JSON.stringify(stationRanks) : null,
    team_members: teamMembers.length > 0 ? JSON.stringify(teamMembers) : null,
    cumulative_times: Object.keys(cumulativeTimes).length > 0 ? JSON.stringify(cumulativeTimes) : null,
  };
}

// Blocks (403/429) are waited out and retried inside the limiter, so null means "no usable page".
async function fetchDetailHtml(url) {
  const res = await mika.get(url, { timeoutMs: 15000 });
  return res.status === 200 ? res.text : null;
}

function getSeasonSlug(raceId, raceSeason) {
  if (raceSeason === '26/27') return 'season-9';
  if (raceSeason === '25/26') return 'season-8';
  if (raceSeason === '24/25') return 'season-7';
  if (raceSeason === '23/24') return 'season-6';
  if (raceId.includes('2026')) return 'season-9';
  if (raceId.includes('2025')) return 'season-8';
  if (raceId.includes('2024')) return 'season-7';
  return 'season-8';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Ingestion Workflow
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=============================================================');
  console.log('⚡ HYROX Full Analytics & Deep Splits Backfill Engine');
  console.log('=============================================================');
  console.log(`Target Race:     ${TARGET_RACE || 'ALL'}`);
  console.log(`Target Division: ${TARGET_DIV || 'ALL'}`);
  console.log(`Seasons:         ${SEASONS.join(' → ')}`);
  console.log(`Dry Run:         ${IS_TEST ? 'YES' : 'NO'}`);
  console.log(`Workers:         ${CONCURRENCY} (pace set by the rate limiter, starting at ${mika.rate} req/s)`);
  if (FOREVER) console.log(`Mode:            run until nothing is pending${EXIT_WHEN_IDLE ? ', then exit' : ', then keep checking'}`);
  if (DEADLINE !== Infinity) console.log(`Stops at:        ${new Date(DEADLINE).toISOString()}`);
  if (LIMIT) console.log(`Limit:           ${LIMIT}`);
  console.log('-------------------------------------------------------------\n');

  const columns = (await client.execute('PRAGMA table_info(hyrox_athlete_results)')).rows.map((r) => r.name);
  const hasMikaEvent = columns.includes('mika_event');
  const hasDiscoveryLog = (await client.execute(`SELECT name FROM sqlite_master WHERE type='table' AND name='mika_discovery_log'`)).rows.length > 0;

  let totalProcessed = 0;
  let totalEnriched = 0;
  let totalWritten = 0;
  let idle = false;

  sweeps:
  for (let sweep = 1; ; sweep++) {
    let sweepWritten = 0;
    for (const season of SEASONS) {
      let lastMaxId = 0;
      for (let pass = 1; ; pass++) {
        if (mika.pastDeadline()) break sweeps;
        console.log(`\n🔍 [Sweep ${sweep} · season ${season} · pass ${pass}] Querying pending athletes (cursor a.id > ${lastMaxId})...`);
        const athletes = await fetchPending(season, lastMaxId, hasMikaEvent, hasDiscoveryLog);
        if (athletes.length === 0) {
          console.log(`   ✅ Nothing pending for season ${season}.`);
          break;
        }
        lastMaxId = athletes[athletes.length - 1].id;
        console.log(`📊 Found ${athletes.length.toLocaleString()} athletes (ID range ${athletes[0].id} -> ${lastMaxId}).\n`);

        const r = await processBatch(athletes);
        totalProcessed += r.processed;
        totalEnriched += r.enriched;
        totalWritten += r.written;
        sweepWritten += r.written;
        console.log(`\n🎉 Pass complete: processed ${r.processed.toLocaleString()} | enriched ${r.enriched.toLocaleString()} | written ${r.written.toLocaleString()}`);
        console.log(`   Cumulative Enriched So Far: ${totalEnriched.toLocaleString()}`);

        if (LIMIT || IS_TEST) break sweeps;
      }
    }
    if (!FOREVER) break;
    if (sweepWritten === 0) {
      if (EXIT_WHEN_IDLE) { idle = true; break; }
      console.log('\n😴 Nothing left to fetch — checking again in 15 minutes.');
      await sleep(Math.min(15 * 60_000, Math.max(0, DEADLINE - Date.now())));
      if (mika.pastDeadline()) break;
    }
  }

  mika.close();
  const moreWork = FOREVER && !idle && mika.pastDeadline();
  console.log(`\n\n🏁 Backfill Engine Finished${mika.pastDeadline() ? ' (time budget reached)' : ''}!`);
  console.log(`   Grand Total Processed: ${totalProcessed.toLocaleString()}`);
  console.log(`   Grand Total Enriched:  ${totalEnriched.toLocaleString()}`);
  console.log(`   Rows Written:          ${totalWritten.toLocaleString()}`);
  console.log(`   mika requests ok ${mika.stats.ok}, blocks ${mika.stats.blocks}, errors ${mika.stats.errors} | final rate ${mika.rate} req/s (limit ${mika.limitRate})`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `more_work=${moreWork}\n`);
}

function seasonFilter(season) {
  if (!season || season === 'all') return '';
  if (season === '2026') return ` AND (r.season = '2026' OR r.season = '25/26' OR r.season = '26/27' OR r.season = 'season-9' OR r.date LIKE '2026%' OR a.race_id LIKE '%2026%')`;
  if (season === '2025') return ` AND (r.season = '2025' OR r.season = '24/25' OR r.season = 'season-8' OR r.date LIKE '2025%' OR a.race_id LIKE '%2025%')`;
  if (season === '2024') return ` AND (r.season = '2024' OR r.season = '23/24' OR r.season = 'season-7' OR r.date LIKE '2024%' OR a.race_id LIKE '%2024%')`;
  return ` AND (r.season = ${esc(season)} OR r.date LIKE ${esc(`${season}%`)} OR a.race_id LIKE ${esc(`%${season}%`)})`;
}

// Pending = has a mika_idp, and either no splits yet or never got station ranks / replay data.
async function fetchPending(season, lastMaxId, hasMikaEvent, hasDiscoveryLog) {
  let query = `
    SELECT
      a.id, a.race_id, a.full_name, a.division, a.mika_idp${hasMikaEvent ? ', a.mika_event' : ''},
      r.season, r.city, r.date, r.name as race_name${hasDiscoveryLog ? ', d.season_slug AS mika_slug' : ''}
    FROM hyrox_athlete_results a
    JOIN hyrox_races r ON a.race_id = r.id
    ${hasDiscoveryLog ? 'LEFT JOIN mika_discovery_log d ON d.race_id = a.race_id' : ''}
    WHERE a.id > ${lastMaxId}
      AND a.mika_idp IS NOT NULL AND a.mika_idp != ''
      AND (a.run_1 IS NULL OR a.run_1 = '' OR a.station_ranks IS NULL)
  `;
  if (TARGET_RACE) query += ` AND a.race_id = ${esc(TARGET_RACE)}`;
  if (TARGET_DIV) query += ` AND a.division = ${esc(TARGET_DIV)}`;
  query += seasonFilter(season);
  query += ` ORDER BY a.id ASC LIMIT ${LIMIT || 3000}`;
  return (await client.execute(query)).rows;
}

// Wave candidates per race+division, plus the wave that last worked so it is tried first.
const waveCache = new Map();
const lastSuccessfulWave = new Map();

async function getWaves(city, division, sSlug) {
  const key = `${sSlug}:::${city}:::${division}`;
  if (!waveCache.has(key)) {
    const optgroups = await getOptgroupsForSeason(sSlug);
    if (optgroups.length === 0) return [];
    waveCache.set(key, findWaveCandidates(optgroups, city, division));
  }
  const rawWaves = waveCache.get(key) || [];
  const lastWave = lastSuccessfulWave.get(key);
  if (lastWave && rawWaves.includes(lastWave)) {
    return [lastWave, ...rawWaves.filter((w) => w !== lastWave)];
  }
  return rawWaves;
}

async function enrichAthlete(a) {
  const sSlug = a.mika_slug ? String(a.mika_slug) : getSeasonSlug(String(a.race_id), String(a.season));
  const cityOrName = String(a.city || a.race_name);
  const divStr = String(a.division);
  const cacheKey = `${sSlug}:::${cityOrName}:::${divStr}`;
  const knownEvent = a.mika_event ? String(a.mika_event) : null;

  // The discovery step stores the exact wave, so one request is enough; otherwise guess the wave.
  const waves = knownEvent ? [knownEvent] : await getWaves(cityOrName, divStr, sSlug);
  if (!knownEvent && waves.length === 0 && mika.pastDeadline()) return null;

  // Form candidate IDPs (handle _BOD or _OVERALL suffixes for doubles)
  const idpCandidates = [String(a.mika_idp)];
  if (!knownEvent && (divStr.includes('DOUBLES') || divStr.includes('RELAY'))) {
    const cityPrefix = String(a.city || '').slice(0, 3).toUpperCase();
    if (cityPrefix) idpCandidates.push(`${a.mika_idp}_${cityPrefix}`);
  }

  let lastHtml = null;
  for (const curIdp of idpCandidates) {
    for (const wVal of (waves.length > 0 ? waves : [''])) {
      if (mika.pastDeadline()) return null;
      const eventParam = wVal ? `&event=${wVal}` : '';
      const detailUrl = `https://hyrox.r.mikatiming.com/${sSlug}/?content=detail&idp=${curIdp}${eventParam}`;
      const html = await fetchDetailHtml(detailUrl);
      if (!html) continue;
      lastHtml = html;

      const parsed = parseDeepDetail(html);
      if (parsed.run_1 || parsed.skierg || parsed.run_total) {
        if (!parsed.run_1) parsed.run_1 = '–'; // Missed timing mat at start
        if (wVal && !knownEvent) lastSuccessfulWave.set(cacheKey, wVal);
        return { id: a.id, ...parsed, enriched: true };
      }
    }
  }

  if (lastHtml) {
    // Athlete profile exists on Mika Timing but has zero split times (DNS / DNF)
    const parsed = parseDeepDetail(lastHtml);
    return {
      id: a.id,
      dns: true,
      disqual_reason: parsed.disqual_reason || 'DNS',
      bib_number: parsed.bib_number,
      nationality: parsed.nationality,
      age_group: parsed.age_group,
      team_members: parsed.team_members,
    };
  }
  return null;
}

async function writeUpdates(items) {
  if (IS_TEST) {
    if (items.length) console.log(`   [dry run] would write ${items.length} rows, e.g. ${JSON.stringify(items[0]).slice(0, 300)}`);
    return;
  }
  const statements = items.map((u) => ({ sql: updateSql(u) }));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await client.batch(statements, 'write');
      return;
    } catch (err) {
      console.warn(`⚠️ [Flush] DB batch write attempt ${attempt} failed:`, err.message);
      if (attempt === 3) throw err;
      await sleep(1000 * attempt);
    }
  }
}

// Workers pull athletes from a shared queue; writes are batched and serialised.
async function processBatch(athletes) {
  let next = 0;
  let processed = 0;
  let enriched = 0;
  let written = 0;
  let writeError = null;
  const pendingWrites = [];
  let writeChain = Promise.resolve();

  const flush = () => {
    const items = pendingWrites.splice(0);
    if (items.length) {
      writeChain = writeChain
        .then(() => writeUpdates(items))
        .then(() => { written += IS_TEST ? 0 : items.length; })
        .catch((err) => { writeError = err; });
    }
    return writeChain;
  };

  const worker = async () => {
    while (next < athletes.length && !mika.pastDeadline() && !writeError) {
      const a = athletes[next++];
      const u = await enrichAthlete(a);
      processed++;
      if (u) {
        pendingWrites.push(u);
        if (u.enriched) enriched++;
      }
      if (pendingWrites.length >= 100) flush();
      if (processed % 100 === 0 || processed === athletes.length) {
        console.log(`[${new Date().toISOString().slice(11, 19)}] ⚡ Processed: ${processed.toLocaleString()} / ${athletes.length.toLocaleString()} | Enriched: ${enriched.toLocaleString()}`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, athletes.length) }, worker));
  await flush();
  if (writeError) throw writeError;
  return { processed, enriched, written };
}

if (process.argv[1] && process.argv[1].endsWith('backfill_splits.mjs')) {
  main().catch((err) => {
    console.error('\n❌ Fatal backfill error:', err);
    process.exit(1);
  });
}
