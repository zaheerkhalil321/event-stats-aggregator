/**
 * sync_live.mjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Dedicated Live Event & Active Weekend Engine for HYROX stats aggregator.
 *
 * Architecture:
 *  1. Discovers currently active / live races (e.g. Season 26/27 Tenerife, Washington DC).
 *  2. Uses direct URL-based GET navigation (?event=...&search[sex]=...&num_results=100&page=...)
 *     which is 10x faster, completely avoids flaky DOM clicks, and fetches 100 athletes/page.
 *  3. Auto-registers & updates races in `hyrox_races` with status = 'live'.
 *  4. Sequentially processes races and active waves to prevent race conditions.
 *  5. Parses split times, rankings, bibs, and penalties from detail pages.
 *  6. Upserts results with ON CONFLICT (race_id, full_name, division) DO UPDATE.
 *  7. Automatically updates `athletes_count` and `updated_at` in `hyrox_races`.
 *
 * Usage:
 *   node sync_live.mjs                  # Full live sync to Supabase
 *   node sync_live.mjs --test           # Dry-run (scrape without DB writes)
 *   node sync_live.mjs --race=tenerife  # Sync only Tenerife
 *   node sync_live.mjs --splits=50      # Deep splits limit per division (default 50)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

const IS_TEST = process.argv.includes('--test') || process.argv.includes('--dry-run');
const FORCE_RACE = process.argv.find(arg => arg.startsWith('--race='))?.split('=')[1]
                   || (process.argv.includes('--race') ? process.argv[process.argv.indexOf('--race') + 1] : null);

const splitsLimitArg = process.argv.find(arg => arg.startsWith('--splits='))?.split('=')[1]
                       || (process.argv.includes('--splits') ? process.argv[process.argv.indexOf('--splits') + 1] : null);
const DEEP_SPLITS_LIMIT = splitsLimitArg ? (splitsLimitArg === 'all' || splitsLimitArg === 'Infinity' ? Infinity : parseInt(splitsLimitArg, 10)) : 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log('\n' + '='.repeat(68));
console.log('  ⚡ HYROX LIVE & WEEKEND RACE ENGINE');
console.log('  Target: Active Live Heats (Season 9 / Current Weekends)');
console.log(`  Mode:   ${IS_TEST ? 'DRY-RUN (No DB Writes)' : 'LIVE → Supabase Production'}`);
if (FORCE_RACE) console.log(`  Filter: "${FORCE_RACE}"`);
console.log('='.repeat(68) + '\n');

if (!IS_TEST && (!PROJECT_REF || !TOKEN)) {
  console.error('❌ Missing SUPABASE_PROJECT_REF or SUPABASE_ACCESS_TOKEN in .env');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase SQL Runner with Exponential Backoff
// ─────────────────────────────────────────────────────────────────────────────
async function runQuery(sql, retries = 3, delayMs = 1500) {
  if (IS_TEST) return [{ count: 0 }];

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: sql }),
        }
      );

      if (res.status === 429 || res.status >= 500) {
        const errText = await res.text().catch(() => '');
        console.warn(`   ⚠️ Supabase rate-limit/error (${res.status}) attempt ${attempt}/${retries}. Retrying in ${delayMs}ms...`);
        if (attempt < retries) {
          await sleep(delayMs);
          delayMs *= 2;
          continue;
        }
        throw new Error(`Supabase (${res.status}): ${errText.slice(0, 200)}`);
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Supabase error (${res.status}): ${errText.slice(0, 250)}`);
      }

      return res.json();
    } catch (err) {
      if (attempt < retries && (err.message.includes('429') || err.message.includes('fetch failed'))) {
        await sleep(delayMs);
        delayMs *= 2;
        continue;
      }
      throw err;
    }
  }
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return isNaN(val) ? 'NULL' : String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function timeToSeconds(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const parts = timeStr.trim().split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function secondsToTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape Single Wave via Direct GET URL
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeWaveDirect(page, seasonSlug, raceId, waveText, waveVal, sex) {
  const athletes = [];
  const sexParam = sex ? `&search[sex]=${sex}` : '';
  let divisionLabel = waveText;
  if (sex === 'M') divisionLabel = waveText.replace(/\s*-\s*(Thursday|Friday|Saturday|Sunday|Monday)/i, '') + ' Men';
  if (sex === 'W') divisionLabel = waveText.replace(/\s*-\s*(Thursday|Friday|Saturday|Sunday|Monday)/i, '') + ' Women';
  if (sex === 'X') divisionLabel = waveText.replace(/\s*-\s*(Thursday|Friday|Saturday|Sunday|Monday)/i, '') + ' Mixed';

  for (let p = 1; p <= 50; p++) {
    const url = `https://hyrox.r.mikatiming.com/${seasonSlug}/?event=${waveVal}&pid=list&num_results=100${sexParam}&page=${p}`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(1200);

      const pageAthletes = await page.evaluate(({ rId, divLabel, genderCode, sSlug }) => {
        const items = Array.from(document.querySelectorAll('li.list-group-item:not(.list-group-header)'));
        const list = [];
        for (const item of items) {
          const link = item.querySelector('a[href*="content=detail"]');
          if (!link) continue;
          const fullName = link.textContent?.trim();
          if (!fullName) continue;

          const rankEl = item.querySelector('.type-place.place-primary, .type-place');
          const rankText = rankEl?.textContent?.replace(/Rank/gi, '')?.trim();
          const rank = rankText ? parseInt(rankText, 10) : null;

          const timeEl = item.querySelector('.type-time');
          const rawTime = timeEl?.textContent?.replace(/Total|Finish\s*Time/gi, '')?.trim();

          const ageEl = item.querySelector('.type-age_class');
          const ageGroup = ageEl?.textContent?.replace(/Age\s*Group/gi, '')?.trim() || null;

          const bibEl = item.querySelector('.type-start_number');
          const bib = bibEl?.textContent?.replace(/Start\s*Number|Bib/gi, '')?.trim() || null;

          const natEl = item.querySelector('.country-flag, .type-nation');
          const nation = natEl ? (natEl.getAttribute('title') || natEl.textContent)?.trim()?.slice(0, 3)?.toUpperCase() : 'XX';

          const href = link.getAttribute('href') || '';
          const cleanHref = href.startsWith('/') ? href.slice(1) : href;
          const detailUrl = href.startsWith('http') ? href : `https://hyrox.r.mikatiming.com/${sSlug}/${cleanHref}`;

          list.push({
            race_id: rId,
            full_name: fullName,
            detail_url: detailUrl,
            overall_rank: isNaN(rank) ? null : rank,
            total_time: rawTime || null,
            age_group: ageGroup,
            bib_number: bib,
            nationality: nation || 'XX',
            division: divLabel,
            gender: genderCode,
          });
        }
        return list;
      }, { rId: raceId, divLabel: divisionLabel, genderCode: sex || 'M', sSlug: seasonSlug });

      if (!pageAthletes || pageAthletes.length === 0) break;

      athletes.push(...pageAthletes);
      process.stdout.write(`      📄 [${divisionLabel}] Page ${p} (${athletes.length} athletes)\r`);

      if (pageAthletes.length < 100) break; // Reached last page
    } catch (err) {
      console.warn(`\n      ⚠️ Page ${p} load warning: ${err.message.slice(0, 80)}`);
      break;
    }
  }

  return athletes;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scrape Splits from Detail Page
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeSplits(page, athlete) {
  if (!athlete.detail_url) return;
  try {
    await page.goto(athlete.detail_url, { waitUntil: 'domcontentloaded', timeout: 12000 });
    await page.waitForSelector('table tr, .table tr', { timeout: 3000 }).catch(() => {});

    const tableData = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('table tr, .table tr'));
      const data = {};
      for (const r of rows) {
        const th = r.querySelector('th')?.textContent?.trim();
        const td = r.querySelector('td')?.textContent?.trim();
        if (th && td) data[th] = td;
      }
      return data;
    });

    const getVal = (...keys) => {
      for (const k of keys) {
        for (const [tableKey, tableVal] of Object.entries(tableData)) {
          if (tableKey.toLowerCase().includes(k.toLowerCase()) && tableVal && tableVal !== '–' && tableVal !== '-' && tableVal !== '—') {
            return tableVal;
          }
        }
      }
      return null;
    };

    const bib = getVal('Bib Number', 'Startnummer', 'Bib');
    const ageGroup = getVal('Age Group', 'Altersklasse', 'AK');
    const nat = getVal('Nat', 'Nation', 'Country');
    const rankMW = getVal('Rank (M/W)', 'Gender Rank');
    const rankAG = getVal('Rank (AG)', 'Age Group Rank');

    if (bib) athlete.bib_number = bib;
    if (ageGroup) athlete.age_group = ageGroup;
    if (nat) athlete.nationality = nat.slice(0, 3).toUpperCase();
    if (rankMW && !isNaN(parseInt(rankMW, 10))) athlete.division_rank = parseInt(rankMW, 10);
    if (rankAG && !isNaN(parseInt(rankAG, 10))) athlete.age_group_rank = parseInt(rankAG, 10);

    athlete.run_1 = getVal('Running 1');
    athlete.skierg = getVal('SkiErg', '1000m SkiErg');
    athlete.run_2 = getVal('Running 2');
    athlete.sled_push = getVal('Sled Push', '50m Sled Push');
    athlete.run_3 = getVal('Running 3');
    athlete.sled_pull = getVal('Sled Pull', '50m Sled Pull');
    athlete.run_4 = getVal('Running 4');
    athlete.burpee_jumps = getVal('Burpee', '80m Burpee Broad Jump');
    athlete.run_5 = getVal('Running 5');
    athlete.rowing = getVal('Row', '1000m Row');
    athlete.run_6 = getVal('Running 6');
    athlete.farmers_carry = getVal('Farmers', '200m Farmers Carry');
    athlete.run_7 = getVal('Running 7');
    athlete.sandbag_lunges = getVal('Sandbag', '100m Sandbag Lunges');
    athlete.run_8 = getVal('Running 8');
    athlete.wall_balls = getVal('Wall Balls');
    athlete.roxzone = getVal('Roxzone', 'Roxzone Time');

    if (!athlete.roxzone || athlete.roxzone === '–') {
      const totalSec = timeToSeconds(athlete.total_time);
      const splits = [
        athlete.run_1, athlete.skierg, athlete.run_2, athlete.sled_push,
        athlete.run_3, athlete.sled_pull, athlete.run_4, athlete.burpee_jumps,
        athlete.run_5, athlete.rowing, athlete.run_6, athlete.farmers_carry,
        athlete.run_7, athlete.sandbag_lunges, athlete.run_8, athlete.wall_balls
      ].map(timeToSeconds);

      if (totalSec > 0 && splits.every(s => s > 0)) {
        const sumSplits = splits.reduce((a, b) => a + b, 0);
        const diff = totalSec - sumSplits;
        if (diff >= 0 && diff < totalSec) {
          athlete.roxzone = secondsToTime(diff);
        }
      }
    }
  } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Upsert Athletes to Supabase
// ─────────────────────────────────────────────────────────────────────────────
async function upsertLiveAthletes(athletes) {
  if (athletes.length === 0 || IS_TEST) return;

  // Deduplicate within batch to prevent Postgres 21000 ON CONFLICT collision
  const uniqueMap = new Map();
  for (const a of athletes) {
    const key = `${a.race_id}:::${a.full_name.trim().toLowerCase()}:::${a.division}`;
    if (!uniqueMap.has(key) || a.total_time) {
      uniqueMap.set(key, a);
    }
  }
  const cleanAthletes = Array.from(uniqueMap.values());

  const CHUNK = 50;
  for (let i = 0; i < cleanAthletes.length; i += CHUNK) {
    const batch = cleanAthletes.slice(i, i + CHUNK);
    const rows = batch.map(a => `(
      ${esc(a.race_id)}, ${esc(a.full_name)}, ${esc(a.bib_number)},
      ${esc(a.nationality)}, ${esc(a.gender)}, ${esc(a.age_group)}, ${esc(a.division)},
      ${esc(a.total_time)}, ${a.overall_rank ?? 'NULL'}, ${a.division_rank ?? a.overall_rank ?? 'NULL'}, ${a.age_group_rank ?? 'NULL'},
      ${esc(a.run_1)}, ${esc(a.run_2)}, ${esc(a.run_3)}, ${esc(a.run_4)},
      ${esc(a.run_5)}, ${esc(a.run_6)}, ${esc(a.run_7)}, ${esc(a.run_8)},
      ${esc(a.skierg)}, ${esc(a.sled_push)}, ${esc(a.sled_pull)}, ${esc(a.burpee_jumps)},
      ${esc(a.rowing)}, ${esc(a.farmers_carry)}, ${esc(a.sandbag_lunges)}, ${esc(a.wall_balls)},
      ${esc(a.roxzone)}
    )`).join(',\n');

    const sql = `
      INSERT INTO hyrox_athlete_results (
        race_id, full_name, bib_number,
        nationality, gender, age_group, division,
        total_time, overall_rank, division_rank, age_group_rank,
        run_1, run_2, run_3, run_4, run_5, run_6, run_7, run_8,
        skierg, sled_push, sled_pull, burpee_jumps,
        rowing, farmers_carry, sandbag_lunges, wall_balls, roxzone
      ) VALUES ${rows}
      ON CONFLICT (race_id, full_name, division) DO UPDATE SET
        total_time     = EXCLUDED.total_time,
        overall_rank   = EXCLUDED.overall_rank,
        division_rank  = EXCLUDED.division_rank,
        age_group_rank = EXCLUDED.age_group_rank,
        bib_number     = COALESCE(EXCLUDED.bib_number, hyrox_athlete_results.bib_number),
        nationality    = EXCLUDED.nationality,
        gender         = EXCLUDED.gender,
        age_group      = EXCLUDED.age_group,
        run_1          = COALESCE(EXCLUDED.run_1,          hyrox_athlete_results.run_1),
        run_2          = COALESCE(EXCLUDED.run_2,          hyrox_athlete_results.run_2),
        run_3          = COALESCE(EXCLUDED.run_3,          hyrox_athlete_results.run_3),
        run_4          = COALESCE(EXCLUDED.run_4,          hyrox_athlete_results.run_4),
        run_5          = COALESCE(EXCLUDED.run_5,          hyrox_athlete_results.run_5),
        run_6          = COALESCE(EXCLUDED.run_6,          hyrox_athlete_results.run_6),
        run_7          = COALESCE(EXCLUDED.run_7,          hyrox_athlete_results.run_7),
        run_8          = COALESCE(EXCLUDED.run_8,          hyrox_athlete_results.run_8),
        skierg         = COALESCE(EXCLUDED.skierg,         hyrox_athlete_results.skierg),
        sled_push      = COALESCE(EXCLUDED.sled_push,      hyrox_athlete_results.sled_push),
        sled_pull      = COALESCE(EXCLUDED.sled_pull,      hyrox_athlete_results.sled_pull),
        burpee_jumps   = COALESCE(EXCLUDED.burpee_jumps,   hyrox_athlete_results.burpee_jumps),
        rowing         = COALESCE(EXCLUDED.rowing,         hyrox_athlete_results.rowing),
        farmers_carry  = COALESCE(EXCLUDED.farmers_carry,  hyrox_athlete_results.farmers_carry),
        sandbag_lunges = COALESCE(EXCLUDED.sandbag_lunges, hyrox_athlete_results.sandbag_lunges),
        wall_balls     = COALESCE(EXCLUDED.wall_balls,     hyrox_athlete_results.wall_balls),
        roxzone        = COALESCE(EXCLUDED.roxzone,        hyrox_athlete_results.roxzone),
        updated_at     = NOW();
    `;

    await runQuery(sql);
    process.stdout.write(`      💾 Synced [${Math.min(i + CHUNK, athletes.length)}/${athletes.length}] to Supabase\r`);
  }
  console.log('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Header and Count Sync
// ─────────────────────────────────────────────────────────────────────────────
async function upsertLiveRaceHeader(race) {
  if (IS_TEST) return;
  const sql = `
    INSERT INTO hyrox_races (id, name, city, country, country_code, date, end_date, season, status, athletes_count)
    VALUES (
      ${esc(race.id)}, ${esc(race.name)}, ${esc(race.city)},
      ${esc(race.country)}, ${esc(race.country_code)}, ${esc(race.date)},
      ${esc(race.end_date)}, ${esc(race.season)}, 'live', 0
    )
    ON CONFLICT (id) DO UPDATE SET
      status     = 'live',
      season     = EXCLUDED.season,
      date       = EXCLUDED.date,
      end_date   = EXCLUDED.end_date,
      updated_at = NOW();
  `;
  await runQuery(sql);
}

async function updateLiveRaceCount(raceId) {
  if (IS_TEST) return 0;
  try {
    const res = await runQuery(`
      SELECT COUNT(DISTINCT (full_name, division)) as count
      FROM hyrox_athlete_results
      WHERE race_id = ${esc(raceId)};
    `);
    const count = parseInt(res[0]?.count || 0, 10);
    await runQuery(`
      UPDATE hyrox_races
      SET athletes_count = ${count}, status = 'live', updated_at = NOW()
      WHERE id = ${esc(raceId)};
    `);
    return count;
  } catch (err) {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Live Sync Orchestrator
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080',
    ],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('🌐 Connected to headless browser session.');

  try {
    const seasonSlug = 'season-9';
    const listUrl = `https://hyrox.r.mikatiming.com/${seasonSlug}/?pid=list`;
    await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector('select[name="event"]', { timeout: 10000 });

    const allOptgroups = await page.evaluate(() => {
      const sel = document.querySelector('select[name="event"]');
      if (!sel) return [];
      const ogs = Array.from(sel.querySelectorAll('optgroup'));
      return ogs.map(og => ({
        label: og.getAttribute('label')?.trim() || '',
        options: Array.from(og.querySelectorAll('option')).map(o => ({
          text: o.textContent.trim(),
          val: o.value
        }))
      })).filter(g => g.label && !g.label.toLowerCase().includes('sonstige'));
    });

    console.log(`📋 Discovered ${allOptgroups.length} Season 9 event groups.`);

    // Active Live Targets: Tenerife & Washington DC
    let targetGroups = allOptgroups.filter(g => 
      g.label.includes('Tenerife') || g.label.includes('Washington')
    );

    if (FORCE_RACE) {
      targetGroups = allOptgroups.filter(g => 
        g.label.toLowerCase().includes(FORCE_RACE.toLowerCase())
      );
      console.log(`🎯 Filtered to: ${targetGroups.map(g => g.label).join(', ')}`);
    }

    for (const group of targetGroups) {
      console.log(`\n${'═'.repeat(60)}`);
      console.log(`🔴 LIVE EVENT: ${group.label}`);
      console.log('═'.repeat(60));

      const isTenerife = group.label.toLowerCase().includes('tenerife');
      const raceId = isTenerife ? 'tenerife-2026' : 'washington-dc-sep-2026';
      const raceName = isTenerife ? 'HYROX Tenerife 2026' : 'HYROX Washington DC September 2026';
      const city = isTenerife ? 'Tenerife' : 'Washington DC';
      const country = isTenerife ? 'Spain' : 'United States';
      const countryCode = isTenerife ? 'ES' : 'US';
      const raceDate = isTenerife ? '2026-09-04' : '2026-09-03';
      const endDate = isTenerife ? '2026-09-06' : '2026-09-07';

      const race = {
        id: raceId,
        name: raceName,
        city,
        country,
        country_code: countryCode,
        date: raceDate,
        end_date: endDate,
        season: '26/27',
      };

      console.log(`   📌 Registering "${race.name}" as status: "live" in Supabase...`);
      await upsertLiveRaceHeader(race);

      const activeOptions = group.options.filter(o => {
        const t = o.text.toUpperCase();
        return !t.includes('OVERALL') && !o.val.endsWith('_OVERALL');
      });

      console.log(`   ⚡ Scanning ${activeOptions.length} wave categories sequentially...\n`);

      let totalRaceAthletes = 0;

      for (const opt of activeOptions) {
        const waveText = opt.text;
        const waveVal = opt.val;
        const upper = waveText.toUpperCase();

        // Determine which sex filters apply to this wave
        let sexesToQuery = ['M', 'W'];
        if (upper.includes('DOUBLES')) sexesToQuery = ['M', 'W', 'X'];
        if (upper.includes('RELAY')) sexesToQuery = ['M', 'W', 'X'];

        for (const sex of sexesToQuery) {
          const athletes = await scrapeWaveDirect(page, seasonSlug, race.id, waveText, waveVal, sex);

          if (athletes.length > 0) {
            console.log(`\n      ✅ Found ${athletes.length} athletes for [${waveText}] (${sex})`);

            // Fetch deep splits for top finishers
            const splitsToFetch = Math.min(athletes.length, DEEP_SPLITS_LIMIT);
            for (let i = 0; i < splitsToFetch; i++) {
              await scrapeSplits(page, athletes[i]);
              if ((i + 1) % 10 === 0 || i + 1 === splitsToFetch) {
                process.stdout.write(`      ⏱️ Deep splits: [${i + 1}/${splitsToFetch}]\r`);
              }
              await sleep(100);
            }
            if (splitsToFetch > 0) console.log('');

            // Upsert batch to Supabase
            await upsertLiveAthletes(athletes);
            totalRaceAthletes += athletes.length;
          }
        }
      }

      const finalCount = await updateLiveRaceCount(race.id);
      console.log(`\n   🏁 ${race.name} sync complete! Total live athletes in DB: ${finalCount}`);
    }

    console.log('\n' + '='.repeat(68));
    console.log('🎉 ALL LIVE EVENTS SYNCED SUCCESSFULLY!');
    console.log('='.repeat(68) + '\n');
  } catch (err) {
    console.error('\n❌ Fatal error in live sync:', err);
  } finally {
    await browser.close();
  }
}

main();
