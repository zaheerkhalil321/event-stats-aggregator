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
 * Usage:
 *   node scripts/backfill_splits.mjs --race bordeaux-2026 --division "HYROX PRO WOMEN"
 *   node scripts/backfill_splits.mjs --race bordeaux-2026
 *   node scripts/backfill_splits.mjs --season 2026
 *   node scripts/backfill_splits.mjs --test
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
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
  const idx = args.indexOf(`--${key}`);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return dflt;
}
const TARGET_RACE = getArg('race', null);
const TARGET_DIV = getArg('division', null);
const TARGET_SEASON = getArg('season', null);
const LIMIT = getArg('limit', null) ? parseInt(getArg('limit'), 10) : null;
const IS_TEST = args.includes('--test');
const CONCURRENCY = getArg('concurrency', '10') ? parseInt(getArg('concurrency', '10'), 10) : 10;

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
    });
    const html = await res.text();

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

  const getText = (cls) => {
    const re = new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
    const m = html.match(re);
    if (!m) return null;
    const clean = m[1].replace(/<[^>]+>/g, '').replace(/&ndash;/g, '').replace(/[–—]/g, '').trim();
    if (!clean || clean === '-' || clean.startsWith('*') || clean.toLowerCase().includes('disqual reason')) {
      return null;
    }
    return clean;
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

  const mwRankText = getText('f-place_all') || getText('f-place_n_m') || getText('f-place_n_w');
  const agRankText = getText('f-place_age_class');
  const mwRank = mwRankText && !isNaN(parseInt(mwRankText, 10)) ? parseInt(mwRankText, 10) : null;
  const agRank = agRankText && !isNaN(parseInt(agRankText, 10)) ? parseInt(agRankText, 10) : null;

  return {
    run_1: getTime('01'),
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
    penalty_time: getText('f-gimmick_01'),
    bonus_time: getText('f-gimmick_04'),
    disqual_reason: getText('f-disqual_reason'),
    gender_rank: mwRank,
    age_group_rank: agRank,
    station_ranks: Object.keys(stationRanks).length > 0 ? JSON.stringify(stationRanks) : null,
    team_members: teamMembers.length > 0 ? JSON.stringify(teamMembers) : null,
    cumulative_times: Object.keys(cumulativeTimes).length > 0 ? JSON.stringify(cumulativeTimes) : null,
  };
}

async function fetchDetailHtml(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(7000),
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (res.status === 200) {
        return await res.text();
      }
      if (res.status === 403 || res.status === 429) {
        await sleep(1500 * (attempt + 1));
      }
    } catch (_) {
      await sleep(250 * (attempt + 1));
    }
  }
  return null;
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
  console.log(`Target Season:   ${TARGET_SEASON || 'ALL'}`);
  console.log(`Dry Run:         ${IS_TEST ? 'YES' : 'NO'}`);
  console.log(`Concurrency:     ${CONCURRENCY}`);
  if (LIMIT) console.log(`Limit:           ${LIMIT}`);
  console.log('-------------------------------------------------------------\n');

  let query = `
    SELECT 
      a.id, a.race_id, a.full_name, a.division, a.mika_idp,
      r.season, r.city, r.date, r.name as race_name
    FROM hyrox_athlete_results a
    JOIN hyrox_races r ON a.race_id = r.id
    WHERE (a.run_1 IS NULL OR a.run_1 = '') AND a.mika_idp IS NOT NULL AND a.mika_idp != ''
  `;

  if (TARGET_RACE) query += ` AND a.race_id = ${esc(TARGET_RACE)}`;
  if (TARGET_DIV) query += ` AND a.division = ${esc(TARGET_DIV)}`;
  if (TARGET_SEASON) query += ` AND (r.season = ${esc(TARGET_SEASON)} OR r.date LIKE '${TARGET_SEASON}%')`;

  query += ` ORDER BY a.race_id, a.division, a.id ASC`;
  if (LIMIT) query += ` LIMIT ${LIMIT}`;

  console.log('🔍 Querying target athletes needing splits from Turso...');
  const res = await client.execute(query);
  const athletes = res.rows;

  if (athletes.length === 0) {
    console.log('✅ No pending athletes found matching criteria. Database is already complete!');
    return;
  }

  console.log(`📊 Found ${athletes.length.toLocaleString()} athletes requiring deep split backfill.\n`);

  let processedCount = 0;
  let successCount = 0;
  const updatesBatch = [];

  async function flushBatch() {
    if (updatesBatch.length === 0 || IS_TEST) return;
    const statements = updatesBatch.map((u) => ({
      sql: `
        UPDATE hyrox_athlete_results
        SET 
          run_1 = ${esc(u.run_1)},
          skierg = ${esc(u.skierg)},
          run_2 = ${esc(u.run_2)},
          sled_push = ${esc(u.sled_push)},
          run_3 = ${esc(u.run_3)},
          sled_pull = ${esc(u.sled_pull)},
          run_4 = ${esc(u.run_4)},
          burpee_jumps = ${esc(u.burpee_jumps)},
          run_5 = ${esc(u.run_5)},
          rowing = ${esc(u.rowing)},
          run_6 = ${esc(u.run_6)},
          farmers_carry = ${esc(u.farmers_carry)},
          run_7 = ${esc(u.run_7)},
          sandbag_lunges = ${esc(u.sandbag_lunges)},
          run_8 = ${esc(u.run_8)},
          wall_balls = ${esc(u.wall_balls)},
          roxzone = ${esc(u.roxzone)},
          run_total = ${esc(u.run_total)},
          best_run_lap = ${esc(u.best_run_lap)},
          penalty_time = ${esc(u.penalty_time)},
          bonus_time = ${esc(u.bonus_time)},
          disqual_reason = ${esc(u.disqual_reason)},
          gender_rank = COALESCE(${u.gender_rank ?? 'NULL'}, gender_rank),
          age_group_rank = COALESCE(${u.age_group_rank ?? 'NULL'}, age_group_rank),
          station_ranks = ${esc(u.station_ranks)},
          team_members = COALESCE(${esc(u.team_members)}, team_members),
          cumulative_times = ${esc(u.cumulative_times)},
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ${u.id};
      `,
    }));

    await client.batch(statements, 'write');
    updatesBatch.length = 0;
  }

  // Pre-load wave optgroups for active seasons
  const seasonSlug = getSeasonSlug(String(athletes[0].race_id), String(athletes[0].season));
  console.log(`🌐 Loading official heat & wave categories for ${seasonSlug}...`);
  const optgroups = await getOptgroupsForSeason(seasonSlug);
  console.log(`📋 Found ${optgroups.length} event optgroups in ${seasonSlug}.\n`);

  // Cache wave candidate values by race+division key
  const waveCache = new Map();
  const lastSuccessfulWave = new Map();

  function getWaves(city, division) {
    const key = `${city}:::${division}`;
    if (!waveCache.has(key)) {
      waveCache.set(key, findWaveCandidates(optgroups, city, division));
    }
    const rawWaves = waveCache.get(key) || [];
    const lastWave = lastSuccessfulWave.get(key);
    if (lastWave && rawWaves.includes(lastWave)) {
      return [lastWave, ...rawWaves.filter((w) => w !== lastWave)];
    }
    return rawWaves;
  }

  const pool = [];
  for (let i = 0; i < athletes.length; i++) {
    const a = athletes[i];
    const sSlug = getSeasonSlug(String(a.race_id), String(a.season));
    const waves = getWaves(String(a.city || a.race_name), String(a.division));

    const task = (async () => {
      // Form candidate IDPs and waves (handle _BOD or _OVERALL suffixes for doubles)
      const idpCandidates = [a.mika_idp];
      if (a.division.includes('DOUBLES') || a.division.includes('RELAY')) {
        const cityPrefix = String(a.city || '').slice(0, 3).toUpperCase();
        if (cityPrefix) idpCandidates.push(`${a.mika_idp}_${cityPrefix}`);
      }

      for (const curIdp of idpCandidates) {
        let matched = false;
        for (const wVal of (waves.length > 0 ? waves : [''])) {
          const eventParam = wVal ? `&event=${wVal}` : '';
          const detailUrl = `https://hyrox.r.mikatiming.com/${sSlug}/?content=detail&idp=${curIdp}${eventParam}`;
          const html = await fetchDetailHtml(detailUrl);
          if (!html) continue;

          const parsed = parseDeepDetail(html);
          if (parsed.run_1 || parsed.skierg || parsed.run_total) {
            updatesBatch.push({
              id: a.id,
              ...parsed,
            });
            successCount++;
            matched = true;
            if (wVal) {
              lastSuccessfulWave.set(`${String(a.city || a.race_name)}:::${String(a.division)}`, wVal);
            }
            break;
          }
        }
        if (matched) break;
      }
    })();

    pool.push(task);

    if (pool.length >= CONCURRENCY || i === athletes.length - 1) {
      await Promise.all(pool);
      pool.length = 0;
      processedCount = i + 1;

      if (updatesBatch.length >= 10 || i === athletes.length - 1) {
        await flushBatch();
      }

      const progressMsg = `⚡ Processed: ${processedCount.toLocaleString()} / ${athletes.length.toLocaleString()} | Updated: ${successCount.toLocaleString()}`;
      if (processedCount % 50 === 0 || i === athletes.length - 1) {
        console.log(`[${new Date().toISOString().slice(11, 19)}] ${progressMsg}`);
      } else {
        process.stdout.write(`${progressMsg}\r`);
      }
      await sleep(25);
    }
  }

  if (updatesBatch.length > 0) {
    await flushBatch();
  }

  console.log(`\n\n🎉 Backfill Complete!`);
  console.log(`   Total Processed: ${processedCount.toLocaleString()}`);
  console.log(`   Successfully Enriched: ${successCount.toLocaleString()}`);
  console.log(`   Success Rate: ${processedCount > 0 ? ((successCount / processedCount) * 100).toFixed(1) : 0}%`);
}

if (process.argv[1] && process.argv[1].endsWith('backfill_splits.mjs')) {
  main().catch((err) => {
    console.error('\n❌ Fatal backfill error:', err);
    process.exit(1);
  });
}
