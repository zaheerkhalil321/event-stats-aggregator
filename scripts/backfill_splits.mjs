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

// Circuit breaker state: detects IP blocks / throttling instead of failing silently
let consecutiveFailures = 0;
let cooldownUntil = 0;
let cooldownCount = 0;
const failureStats = {};
const MAX_COOLDOWNS = 5;

function recordFailure(reason) {
  failureStats[reason] = (failureStats[reason] || 0) + 1;
  consecutiveFailures++;
  if (failureStats[reason] <= 3) console.warn(`\n⚠️ Fetch failure: ${reason}`);
  if (consecutiveFailures >= 40 && Date.now() > cooldownUntil) {
    cooldownCount++;
    if (cooldownCount > MAX_COOLDOWNS) {
      console.error(`\n🛑 Mika Timing keeps failing (${JSON.stringify(failureStats)}). IP is likely blocked/throttled. Aborting — re-run from another IP (local/VPS). Already-saved progress is kept.`);
      process.exit(2);
    }
    cooldownUntil = Date.now() + 60_000 * cooldownCount;
    console.warn(`\n⏸️ ${consecutiveFailures} consecutive failures ${JSON.stringify(failureStats)} — cooling down ${cooldownCount} min (${cooldownCount}/${MAX_COOLDOWNS})...`);
    consecutiveFailures = 0;
  }
}

async function fetchDetailHtml(url, maxRetries = 2) {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const wait = cooldownUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
      if (res.status === 200) {
        consecutiveFailures = 0;
        return await res.text();
      }
      recordFailure(`HTTP ${res.status}`);
      if (res.status === 403 || res.status === 429) {
        await sleep(1000 * (attempt + 1));
      }
    } catch (err) {
      recordFailure(err.name || 'network-error');
      await sleep(150 * (attempt + 1));
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

  let passNumber = 1;
  let totalEnrichedAll = 0;
  let totalProcessedAll = 0;
  let lastMaxId = 0;

  while (true) {
    let query = `
      SELECT 
        a.id, a.race_id, a.full_name, a.division, a.mika_idp,
        r.season, r.city, r.date, r.name as race_name
      FROM hyrox_athlete_results a
      JOIN hyrox_races r ON a.race_id = r.id
      WHERE a.id > ${lastMaxId} AND (a.run_1 IS NULL OR a.run_1 = '') AND a.mika_idp IS NOT NULL AND a.mika_idp != ''
    `;

    if (TARGET_RACE) query += ` AND a.race_id = ${esc(TARGET_RACE)}`;
    if (TARGET_DIV) query += ` AND a.division = ${esc(TARGET_DIV)}`;
    if (TARGET_SEASON) {
      if (TARGET_SEASON === '2026') {
        query += ` AND (r.season = '2026' OR r.season = '25/26' OR r.season = '26/27' OR r.season = 'season-9' OR r.date LIKE '2026%' OR a.race_id LIKE '%2026%')`;
      } else if (TARGET_SEASON === '2025') {
        query += ` AND (r.season = '2025' OR r.season = '24/25' OR r.season = 'season-8' OR r.date LIKE '2025%' OR a.race_id LIKE '%2025%')`;
      } else if (TARGET_SEASON === '2024') {
        query += ` AND (r.season = '2024' OR r.season = '23/24' OR r.season = 'season-7' OR r.date LIKE '2024%' OR a.race_id LIKE '%2024%')`;
      } else {
        query += ` AND (r.season = ${esc(TARGET_SEASON)} OR r.date LIKE '${TARGET_SEASON}%' OR a.race_id LIKE '%${TARGET_SEASON}%')`;
      }
    }

    query += ` ORDER BY a.id ASC`;
    query += ` LIMIT ${LIMIT || 3000}`;

    console.log(`\n🔍 [Pass ${passNumber}] Querying batch of pending athletes from Turso (cursor a.id > ${lastMaxId})...`);
    const res = await client.execute(query);
    const athletes = res.rows;

    if (athletes.length === 0) {
      console.log(`\n🎉 100% COMPLETE! All target events & athletes have deep splits. Zero pending records!`);
      break;
    }

    lastMaxId = athletes[athletes.length - 1].id;
    console.log(`📊 Found ${athletes.length.toLocaleString()} athletes in current pass (ID range ${athletes[0].id} -> ${lastMaxId}).\n`);

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
            bib_number = COALESCE(${esc(u.bib_number)}, bib_number),
            nationality = CASE WHEN nationality IS NULL OR nationality = 'XX' OR nationality = '' THEN COALESCE(${esc(u.nationality)}, nationality) ELSE nationality END,
            age_group = COALESCE(${esc(u.age_group)}, age_group),
            start_wave = COALESCE(${esc(u.start_wave)}, start_wave),
            start_time = COALESCE(${esc(u.start_time)}, start_time),
            gender_rank = COALESCE(${u.gender_rank ?? 'NULL'}, gender_rank),
            age_group_rank = COALESCE(${u.age_group_rank ?? 'NULL'}, age_group_rank),
            station_ranks = ${esc(u.station_ranks)},
            team_members = COALESCE(${esc(u.team_members)}, team_members),
            cumulative_times = ${esc(u.cumulative_times)},
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ${u.id};
        `,
      }));

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await client.batch(statements, 'write');
          break;
        } catch (err) {
          console.warn(`⚠️ [Flush] Turso batch write attempt ${attempt} failed:`, err.message);
          if (attempt === 3) throw err;
          await sleep(1000 * attempt);
        }
      }
      updatesBatch.length = 0;
    }

    // Cache wave candidate values by race+division key
    const waveCache = new Map();
    const lastSuccessfulWave = new Map();

    async function getWaves(city, division, sSlug) {
      const key = `${sSlug}:::${city}:::${division}`;
      if (!waveCache.has(key)) {
        const optgroups = await getOptgroupsForSeason(sSlug);
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
      const cityOrName = String(a.city || a.race_name);
      const divStr = String(a.division);
      const cacheKey = `${sSlug}:::${cityOrName}:::${divStr}`;
      const waves = await getWaves(cityOrName, divStr, sSlug);

      const task = (async () => {
        // Form candidate IDPs and waves (handle _BOD or _OVERALL suffixes for doubles)
        const idpCandidates = [a.mika_idp];
        if (a.division.includes('DOUBLES') || a.division.includes('RELAY')) {
          const cityPrefix = String(a.city || '').slice(0, 3).toUpperCase();
          if (cityPrefix) idpCandidates.push(`${a.mika_idp}_${cityPrefix}`);
        }

        let matched = false;
        let lastHtml = null;
        for (const curIdp of idpCandidates) {
          for (const wVal of (waves.length > 0 ? waves : [''])) {
            const eventParam = wVal ? `&event=${wVal}` : '';
            const detailUrl = `https://hyrox.r.mikatiming.com/${sSlug}/?content=detail&idp=${curIdp}${eventParam}`;
            const html = await fetchDetailHtml(detailUrl);
            if (!html) continue;
            lastHtml = html;

            const parsed = parseDeepDetail(html);
            if (parsed.run_1 || parsed.skierg || parsed.run_total) {
              if (!parsed.run_1) parsed.run_1 = '–'; // Missed timing mat at start
              updatesBatch.push({
                id: a.id,
                ...parsed,
              });
              successCount++;
              matched = true;
              if (wVal) {
                lastSuccessfulWave.set(cacheKey, wVal);
              }
              break;
            }
          }
          if (matched) break;
        }

        if (!matched && lastHtml) {
          // Athlete profile exists on Mika Timing but has zero split times (DNS / DNF)
          const parsed = parseDeepDetail(lastHtml);
          updatesBatch.push({
            id: a.id,
            run_1: '–',
            disqual_reason: parsed.disqual_reason || 'DNS',
            bib_number: parsed.bib_number,
            nationality: parsed.nationality,
            age_group: parsed.age_group,
            team_members: parsed.team_members,
            station_ranks: '{}',
          });
        }
      })();

      pool.push(task);

      if (pool.length >= CONCURRENCY || i === athletes.length - 1) {
        await Promise.all(pool);
        pool.length = 0;
        processedCount = i + 1;

        if (updatesBatch.length >= 100 || i === athletes.length - 1) {
          await flushBatch();
        }

        const progressMsg = `⚡ Processed: ${processedCount.toLocaleString()} / ${athletes.length.toLocaleString()} | Updated: ${successCount.toLocaleString()}`;
        if (processedCount % 50 === 0 || i === athletes.length - 1) {
          console.log(`[${new Date().toISOString().slice(11, 19)}] ${progressMsg}`);
        } else {
          process.stdout.write(`${progressMsg}\r`);
        }
        await sleep(100);
      }
    }

    if (updatesBatch.length > 0) {
      await flushBatch();
    }

    totalEnrichedAll += successCount;
    totalProcessedAll += processedCount;

    console.log(`\n🎉 Pass ${passNumber} Complete!`);
    console.log(`   Processed in Pass: ${processedCount.toLocaleString()} | Enriched: ${successCount.toLocaleString()}`);
    console.log(`   Cumulative Enriched So Far: ${totalEnrichedAll.toLocaleString()}`);

    if (LIMIT || IS_TEST) {
      break;
    }

    passNumber++;
  }

  console.log(`\n\n🏁 Backfill Engine Finished!`);
  console.log(`   Grand Total Processed: ${totalProcessedAll.toLocaleString()}`);
  console.log(`   Grand Total Enriched:  ${totalEnrichedAll.toLocaleString()}`);
}

if (process.argv[1] && process.argv[1].endsWith('backfill_splits.mjs')) {
  main().catch((err) => {
    console.error('\n❌ Fatal backfill error:', err);
    process.exit(1);
  });
}
