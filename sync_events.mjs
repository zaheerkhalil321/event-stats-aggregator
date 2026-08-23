#!/usr/bin/env node
/**
 * scripts/sync_hyrox.mjs â€” RoxDay Full HYROX Data Pipeline (Playwright Edition)
 * =================================================================================
 * Uses a real headless browser (Playwright/Chromium) to scrape results.hyrox.com.
 * This bypasses Cloudflare/bot protection and handles JavaScript-rendered content.
 *
 * Scrapes:
 *   â€¢ All completed seasons (S6=24/25, S7=25/26, S8=26/27)
 *   â€¢ All 7 divisions per race (PRO MEN/WOMEN, MEN/WOMEN, DOUBLES MEN/WOMEN, RELAY)
 *   â€¢ Top 200 athletes per division (paginated: 2 pages Ã— 100)
 *   â€¢ Full 17-split station times for top 50 athletes per division
 *
 * Usage:
 *   node scripts/sync_hyrox.mjs --test              # dry-run, no DB writes
 *   node scripts/sync_hyrox.mjs --season season-7   # one season only
 *   SUPABASE_ACCESS_TOKEN=xxx node scripts/sync_hyrox.mjs
 *
 * Requirements:
 *   npm install --save-dev playwright
 *   npx playwright install chromium
 */

import { chromium } from 'playwright';
import * as fs from 'fs';
import { readFileSync, existsSync } from 'fs';
import { syncOfficialCalendar } from './sync_calendar.mjs';

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Config & Auto-load .env
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if (!process.env.SUPABASE_ACCESS_TOKEN && existsSync('.env')) {
  const envContent = readFileSync('.env', 'utf-8');
  const match = envContent.match(/SUPABASE_ACCESS_TOKEN=([^\r\n]+)/);
  if (match) process.env.SUPABASE_ACCESS_TOKEN = match[1].trim();
}

const tokenArgIndex = process.argv.indexOf('--token');
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
  || (tokenArgIndex !== -1 ? process.argv[tokenArgIndex + 1] : null);
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'jxvwccqhnkteeqeerjua';

const IS_TEST = process.argv.includes('--test') || process.argv.includes('--dry-run');
const IS_DRY_RUN = IS_TEST;
const FORCE_RESYNC = process.argv.includes('--force'); // Ignored now, we always resync
const ATHLETE_LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='))?.split('=')[1] 
                          || (process.argv.includes('--limit') ? process.argv[process.argv.indexOf('--limit') + 1] : null);
const ATHLETE_LIMIT = ATHLETE_LIMIT_ARG ? parseInt(ATHLETE_LIMIT_ARG, 10) : null;

const seasonArg = process.argv.indexOf('--season');
const FORCE_SEASON = seasonArg !== -1 ? process.argv[seasonArg + 1] : null;

const raceArg = process.argv.indexOf('--race');
const FORCE_RACE = raceArg !== -1 ? process.argv[raceArg + 1] : null;

const divArg = process.argv.indexOf('--division');
const FORCE_DIV = divArg !== -1 ? process.argv[divArg + 1] : null;

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// HYROX Seasons to sync
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SEASONS = [
  { slug: 'season-7', label: '24/25' },
  { slug: 'season-8', label: '25/26' },
  { slug: 'season-9', label: '26/27' },
];

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// All 7 divisions (gender correctly mapped)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DIVISIONS = [
  { label: 'HYROX PRO MEN', sex: 'M', gender: 'M', event: 'HYROX PRO' },
  { label: 'HYROX PRO WOMEN', sex: 'W', gender: 'F', event: 'HYROX PRO' },
  { label: 'HYROX MEN', sex: 'M', gender: 'M', event: 'HYROX' },
  { label: 'HYROX WOMEN', sex: 'W', gender: 'F', event: 'HYROX' },
  { label: 'HYROX PRO DOUBLES MEN', sex: 'M', gender: 'M', event: 'HYROX PRO DOUBLES' },
  { label: 'HYROX PRO DOUBLES WOMEN', sex: 'W', gender: 'F', event: 'HYROX PRO DOUBLES' },
  { label: 'HYROX DOUBLES MEN', sex: 'M', gender: 'M', event: 'HYROX DOUBLES' },
  { label: 'HYROX DOUBLES WOMEN', sex: 'W', gender: 'F', event: 'HYROX DOUBLES' },
  { label: 'HYROX DOUBLES MIXED', sex: 'X', gender: 'X', event: 'HYROX DOUBLES' },
  { label: 'HYROX TEAM RELAY MEN', sex: 'M', gender: 'M', event: 'HYROX TEAM RELAY' },
  { label: 'HYROX TEAM RELAY WOMEN', sex: 'W', gender: 'F', event: 'HYROX TEAM RELAY' },
  { label: 'HYROX TEAM RELAY MIXED', sex: 'X', gender: 'X', event: 'HYROX TEAM RELAY' }
];

const MAX_PAGES = 5000;             // Hard safety cap: 5000 pages Ã— 100 = 500,000 athletes max
const splitsLimitArg = process.argv.find(arg => arg.startsWith('--splits='))?.split('=')[1]
                       || (process.argv.includes('--splits') ? process.argv[process.argv.indexOf('--splits') + 1] : null);
const DEEP_SPLITS_LIMIT = splitsLimitArg ? (splitsLimitArg === 'all' || splitsLimitArg === 'Infinity' ? Infinity : parseInt(splitsLimitArg, 10)) : 50;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Banner
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
console.log('='.repeat(68));
console.log('  ðŸƒ HYROX Full Data Pipeline â€” RoxDay (Playwright Edition)');
console.log(`  ðŸ•’ Started: ${new Date().toISOString()}`);
console.log(`  ðŸŽ¯ Mode: ${IS_TEST ? 'DRY-RUN (no DB writes)' : 'LIVE â†’ Supabase'}`);
if (FORCE_SEASON) console.log(`  ðŸ“… Season: ${FORCE_SEASON}`);
console.log('='.repeat(68) + '\n');

if (!IS_TEST && !TOKEN) {
  console.error('âŒ Missing SUPABASE_ACCESS_TOKEN.');
  process.exit(1);
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function runQuery(sql, retries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(
        `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: sql }),
        },
      );
      if (res.status === 429 || res.status >= 500) {
        const errorText = await res.text().catch(() => '');
        console.warn(`   âš ï¸ Supabase rate-limit/server (${res.status}) on attempt ${attempt}/${retries}. Retrying in ${delayMs}ms...`);
        if (attempt < retries) {
          await sleep(delayMs);
          delayMs *= 2;
          continue;
        }
        throw new Error(`Supabase (${res.status}): ${errorText.slice(0, 300)}`);
      }
      if (!res.ok) throw new Error(`Supabase (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return res.json();
    } catch (err) {
      if (attempt < retries && (err.message.includes('429') || err.message.includes('fetch failed'))) {
        console.warn(`   âš ï¸ Supabase connection error: ${err.message}. Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        delayMs *= 2;
        continue;
      }
      throw err;
    }
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Base URL for a season
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function seasonBaseUrl(seasonSlug) {
  return `https://results.hyrox.com/${seasonSlug}/`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Parse athlete rows from rendered HTML
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function parseAthletes(html, raceId, division, gender) {
  const athletes = [];
  const seen = new Set();
  const liRegex = /<li[^>]*class="[^"]*list-group-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;

  while ((match = liRegex.exec(html)) !== null) {
    const block = match[1];
    const rankMatch = block.match(/type-place[^>]*>(\d+)<\/div>/i);
    const linkMatch = block.match(/href="([^"]*content=detail[^"]*)"[^>]*>([^<]+)<\/a>/i);
    const nationMatch = block.match(/country-flag[^>]*title="([^"]+)"/i)
      || block.match(/type-nation[^>]*>([^<]+)<\/div>/i);
    const timeMatch = block.match(/type-time[^>]*>([\d:]+)<\/div>/i)
      || block.match(/(\d{1,2}:\d{2}:\d{2})/);
    const ageMatch = block.match(/type-age_class[^>]*>([^<]+)<\/div>/i);
    const bibMatch = block.match(/type-start_number[^>]*>([^<]+)<\/div>/i);

    if (!linkMatch) continue;
    if (!rankMatch && !timeMatch) continue;

    const rawDetailHref = linkMatch[1].replace(/&amp;/g, '&');
    const detailUrl = rawDetailHref.startsWith('http')
      ? rawDetailHref
      : `https://results.hyrox.com${rawDetailHref.startsWith('/') ? '' : '/'}${rawDetailHref}`;

    const fullName = linkMatch[2].trim();
    const dedupKey = `${fullName.toLowerCase()}:::${detailUrl}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);

    athletes.push({
      race_id: raceId,
      full_name: fullName,
      detail_url: detailUrl,
      overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
      total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
      nationality: nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : 'XX',
      age_group: ageMatch ? ageMatch[1].trim() : null,
      bib_number: bibMatch ? bibMatch[1].trim() : null,
      division,
      gender,
    });
  }
  return athletes;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Parse splits from athlete detail page HTML
// ─────────────────────────────────────────────────────────────────────────────
function parseSplits(html) {
  const getSplit = (keyword) => {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[\\s\\S]{0,300}?(\\d{1,2}:\\d{2}(?::\\d{2})?)`, 'i');
    const m = html.match(re);
    return m ? m[1] : null;
  };

  const getMeta = (labelRegex) => {
    const m = html.match(new RegExp(`<t[hd][^>]*>${labelRegex.source}[^<]*<\\/t[hd]>\\s*<t[hd][^>]*>([^<]+)<\\/t[hd]>`, 'i'))
           || html.match(new RegExp(`${labelRegex.source}[\\s\\S]{0,100}?<td[^>]*>([^<]+)<\\/td>`, 'i'));
    return m ? m[1].replace(/&nbsp;/g, ' ').trim() : null;
  };

  const bib = getMeta(/Bib\s*Number|Startnummer|Bib/i);
  const ageGroup = getMeta(/Age\s*Group|Altersklasse|AK/i);
  const nat = getMeta(/Nat(?:ionality)?|Nation|Country/i);
  const rankMW = getMeta(/Rank.*?[MW]|Gender\s*Rank/i);
  const rankAG = getMeta(/Rank.*?AG|Age\s*Group\s*Rank/i);

  const metaUpdates = {};
  if (bib && bib !== '–' && bib !== '-') metaUpdates.bib_number = bib;
  if (ageGroup && ageGroup !== '–' && ageGroup !== '-') metaUpdates.age_group = ageGroup;
  if (nat && nat !== '–' && nat !== '-' && nat !== 'XX') metaUpdates.nationality = nat;
  if (rankMW && !isNaN(parseInt(rankMW, 10))) metaUpdates.gender_rank = parseInt(rankMW, 10);
  if (rankAG && !isNaN(parseInt(rankAG, 10))) metaUpdates.age_group_rank = parseInt(rankAG, 10);

  return {
    ...metaUpdates,
    run_1: getSplit('Running 1'),
    skierg: getSplit('1000m SkiErg'),
    run_2: getSplit('Running 2'),
    sled_push: getSplit('Sled Push'),
    run_3: getSplit('Running 3'),
    sled_pull: getSplit('Sled Pull'),
    run_4: getSplit('Running 4'),
    burpee_jumps: getSplit('Burpee Broad Jump'),
    run_5: getSplit('Running 5'),
    rowing: getSplit('1000m Rowing'),
    run_6: getSplit('Running 6'),
    farmers_carry: getSplit('Farmers Carry'),
    run_7: getSplit('Running 7'),
    sandbag_lunges: getSplit('Sandbag Lunges'),
    run_8: getSplit('Running 8'),
    wall_balls: getSplit('Wall Balls'),
    roxzone: getSplit('Roxzone'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
async function scrapeAthleteDetail(page, athlete) {
  try {
    if (!athlete.detail_url) return athlete;
    await page.goto(athlete.detail_url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('.detail-box, .f-list_ranking, table, [class*="box"]', { timeout: 3000 }).catch(() => { });
    const html = await page.content();
    return { ...athlete, ...parseSplits(html) };
  } catch (e) {
    return athlete;
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Batch upsert to Supabase
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

async function batchUpsert(athletes) {
  // Fetch splits and rich profile metadata for athletes
          const splitsLimit = Math.min(DEEP_SPLITS_LIMIT, athletes.length);
          if (splitsLimit > 0) {
            console.log(`   ⚡ Fetching all 17 splits & athlete details for ${splitsLimit} athletes...`);
            for (let i = 0; i < splitsLimit; i++) {
              process.stdout.write(`   ⚡ [${i + 1}/${splitsLimit}] ${athletes[i].full_name}...\r`);
              athletes[i] = await scrapeAthleteDetail(page, athletes[i]);
            }
          }

          if (IS_TEST) {
            try {
              const { writeFileSync } = await import('fs');
              writeFileSync('athletes_sample.json', JSON.stringify(athletes.slice(0, Math.max(50, splitsLimit)), null, 2));
              console.log(`\n   💾 Saved enriched sample athletes to athletes_sample.json (with Bibs, Age Groups, Real Nations & Splits!)`);
            } catch (_) {}
          }

          const success = await batchUpsert(athletes);
          if (success) {
            await markDivisionSynced(race.id, div.label, athletes.length);
            raceTotal += athletes.length;
            totalAthletes += athletes.length;
            totalSplits += splitsLimit;
          } else {
            console.warn(`   âš ï¸ ${div.label} partially failed â€” will retry this division next run.`);
          }

          await sleep(300);
        }

        if (raceTotal > 0 || attendanceSum > 0) {
          const trueTotal = await updateRaceAthleteCount(race.id);
          racesSummary.push({ name: race.name, athletes: trueTotal || raceTotal });
        }
        await sleep(300);
      }
    }
  } finally {
    await browser.close();
    console.log('\nðŸŒ Browser closed.');
  }

  console.log('\n' + '='.repeat(68));
  console.log('  ðŸŽ‰ Sync Complete!');
  console.log(`  ðŸ‘¤ Athletes upserted : ${totalAthletes.toLocaleString()}`);
  console.log(`  âš¡ Splits fetched    : ${totalSplits.toLocaleString()}`);
  console.log(`  ðŸŸï¸  Races processed   : ${racesSummary.length}`);
  if (IS_TEST) console.log('  ðŸ§ª DRY-RUN â€” nothing written to DB.');
  console.log('='.repeat(68));
  racesSummary.forEach((r) => console.log(`   â€¢ ${r.name}: ${r.athletes} athletes`));
}

main().catch((err) => {
  console.error('\nðŸ’¥ Fatal:', err.message);
  process.exit(1);
});



