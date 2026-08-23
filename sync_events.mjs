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
function parseAthletes(html, raceId, division, gender, seasonSlug, rawDropdownName) {
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
    const slug = seasonSlug || 'season-7';
    const cleanHref = rawDetailHref.startsWith('/') ? rawDetailHref.slice(1) : rawDetailHref;
    let detailUrl = rawDetailHref.startsWith('http')
      ? rawDetailHref
      : `https://results.hyrox.com/${slug}/${cleanHref}`;

    if (!detailUrl.includes('event_main_group=') && rawDropdownName) {
      detailUrl += (detailUrl.includes('?') ? '&' : '?') + `event_main_group=${encodeURIComponent(rawDropdownName)}`;
    }


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
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

function parseSplits(html) {
  const rowRegex = /<tr[^>]*>[\s\S]*?<th[^>]*>([\s\S]*?)<\/th>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td>[\s\S]*?<\/tr>/gi;
  const tableData = {};
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const key = rowMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    const val = rowMatch[2].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (key && val) {
      tableData[key] = val;
    }
  }

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

  const getSplit = (keyword) => {
    const fromTable = getVal(keyword);
    if (fromTable) return fromTable;
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}[\\s\\S]{0,300}?(\\d{1,2}:\\d{2}(?::\\d{2})?)`, 'i');
    const m = html.match(re);
    return m ? m[1] : null;
  };

  const bib = getVal('Bib Number', 'Startnummer', 'Bib');
  const ageGroup = getVal('Age Group', 'Altersklasse', 'AK');
  const nat = getVal('Nat', 'Nation', 'Country');
  const rankMW = getVal('Rank (M/W)', 'Gender Rank');
  const rankAG = getVal('Rank (AG)', 'Age Group Rank');

  const metaUpdates = {};
  if (bib && bib !== '–' && bib !== '-') metaUpdates.bib_number = bib;
  if (ageGroup && ageGroup !== '–' && ageGroup !== '-') metaUpdates.age_group = ageGroup;
  if (nat && nat !== '–' && nat !== '-' && nat !== 'XX') metaUpdates.nationality = nat;
  if (rankMW && !isNaN(parseInt(rankMW, 10))) metaUpdates.gender_rank = parseInt(rankMW, 10);
  if (rankAG && !isNaN(parseInt(rankAG, 10))) metaUpdates.age_group_rank = parseInt(rankAG, 10);

  const res = {
    ...metaUpdates,
    run_1: getSplit('Running 1'),
    skierg: getSplit('SkiErg'),
    run_2: getSplit('Running 2'),
    sled_push: getSplit('Sled Push'),
    run_3: getSplit('Running 3'),
    sled_pull: getSplit('Sled Pull'),
    run_4: getSplit('Running 4'),
    burpee_jumps: getSplit('Burpee'),
    run_5: getSplit('Running 5'),
    rowing: getSplit('Row'),
    run_6: getSplit('Running 6'),
    farmers_carry: getSplit('Farmers'),
    run_7: getSplit('Running 7'),
    sandbag_lunges: getSplit('Sandbag'),
    run_8: getSplit('Running 8'),
    wall_balls: getSplit('Wall Balls'),
    roxzone: getSplit('Roxzone'),
  };

  // If roxzone is missing or dash, calculate mathematically from Total Time - (8 Runs + 8 Workouts)
  if (!res.roxzone || res.roxzone === '–' || res.roxzone === '-') {
    const totalSec = timeToSeconds(tableData['Overall Time'] || tableData['Total'] || tableData['Finish Time']);
    const splits = [
      res.run_1, res.skierg, res.run_2, res.sled_push,
      res.run_3, res.sled_pull, res.run_4, res.burpee_jumps,
      res.run_5, res.rowing, res.run_6, res.farmers_carry,
      res.run_7, res.sandbag_lunges, res.run_8, res.wall_balls
    ].map(timeToSeconds);

    if (totalSec > 0 && splits.every(s => s > 0)) {
      const sumSplits = splits.reduce((a, b) => a + b, 0);
      const diff = totalSec - sumSplits;
      if (diff >= 0 && diff < totalSec) {
        res.roxzone = secondsToTime(diff);
      }
    }
  }

  return res;
}

// Scrape leaderboard by interacting with Mika Timing form
// (URL params alone don't work â€” the site needs form submit)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scrapeDivisionLeaderboard(page, seasonSlug, race, div, maxPages) {
  const athletes = [];
  const listUrl = `https://results.hyrox.com/${seasonSlug}/?pid=list`;
  let targetPages = maxPages || 99999;
  let totalNumAthletes = 0;
  let lastPageSignature = '';

  for (let p = 1; p <= targetPages; p++) {
    process.stdout.write(`   ðŸ“¥ [${div.label}] Page ${p}${targetPages < 50000 ? '/' + targetPages : ''} (${athletes.length} loaded)\r`);

    try {
      // On page 1: ensure we are on the list form, select fields, and submit
      if (p === 1) {
        const currentUrl = page.url();
        const hasLegacyForm = await page.locator('select[name="event_main_group"]').isVisible().catch(() => false);
        const hasModernForm = await page.locator('select[name="event"]').isVisible().catch(() => false);

        if (!currentUrl.includes(seasonSlug) || (!hasLegacyForm && !hasModernForm)) {
          await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForSelector('select[name="event_main_group"], select[name="event"]', { timeout: 6000 }).catch(() => { });
        }

        // Wait up to 5 seconds for either select to appear
        await Promise.any([
          page.waitForSelector('select[name="event"]', { timeout: 5000 }).catch(() => {}),
          page.waitForSelector('select[name="event_main_group"]', { timeout: 5000 }).catch(() => {})
        ]);
        const isModern = await page.locator('select[name="event"]').isVisible().catch(() => false);

        if (isModern) {
          // Season 8+ modern UI with <optgroup>
          const eventSelect = page.locator('select[name="event"]');
          if (await eventSelect.isVisible().catch(() => false)) {
            const targetValue = await page.evaluate(({ cityName, divEvent }) => {
              const select = document.querySelector('select[name="event"]');
              if (!select) return null;
              const optgroups = Array.from(select.querySelectorAll('optgroup'));
              const og = optgroups.find(g => {
                const label = (g.getAttribute('label') || '').toLowerCase();
                const c = cityName.toLowerCase().trim();
                if (label.includes(c)) return true;
                const cityParts = c.split(' ').filter(p => p.length > 2);
                return cityParts.length > 0 && cityParts.every(part => label.includes(part));
              });
              if (!og) return null;

              const options = Array.from(og.querySelectorAll('option'));
              const expectedEvent = divEvent.toUpperCase();
              
              // 1. OVERALL aggregated option (single value covers all waves)
              const overallOpt = options.find(o => {
                const t = o.text.toUpperCase().trim();
                const isOverall = t.includes('OVERALL') || o.value.endsWith('_OVERALL');
                const beforeOverall = t.replace(/\s*[-\u2013\u2014(]?\s*OVERALL\s*\)?$/i, '').trim();
                return isOverall && beforeOverall === expectedEvent;
              });
              if (overallOpt) return [overallOpt.value];

              // 2. Standard single-day exact match
              const exactOpt = options.find(o => o.text.toUpperCase().trim() === expectedEvent);
              if (exactOpt) return [exactOpt.value];

              // 3. KEY FIX: Multi-Day Wave Collection
              // Gathers ALL day variants: "HYROX - Saturday", "HYROX - Sunday", "HYROX - Week I"
              // Fixes New York, Riga, Johannesburg, Berlin under-counting.
              const waveOpts = options.filter(o => {
                const t = o.text.toUpperCase().trim();
                const isOv = t.includes('OVERALL') || o.value.endsWith('_OVERALL');
                if (isOv) return false;
                return (
                  t === expectedEvent ||
                  t.startsWith(`${expectedEvent} -`) ||
                  t.startsWith(`${expectedEvent} –`) ||
                  t.startsWith(`${expectedEvent} (`) ||
                  t.startsWith(`${expectedEvent} :`)
                );
              });

              return waveOpts.length > 0 ? waveOpts.map(o => o.value) : [];
            }, { cityName: race.city, divEvent: div.event });

            if (targetValues && targetValues.length > 0) {
              // Multi-Wave Loop:
              // - Standard events: targetValues=[singleValue] → same as before
              // - Multi-day events: targetValues=[Sat,Sun,WeekI...] → scrapes ALL waves
              const waveAthletes = [];
              let waveTotalCount = 0;

              for (const waveValue of targetValues) {
                if (div.sex !== '%') {
                  await page.evaluate((sex) => {
                    const form = document.querySelector('form#lbglobal, form[name="lbglobal"]');
                    if (form) {
                      let input = form.querySelector('input[name="search[sex]"]');
                      if (!input) {
                        input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = 'search[sex]';
                        form.appendChild(input);
                      }
                      input.value = sex;
                    }
                  }, div.sex);
                }

                await Promise.all([
                  page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {}),
                  eventSelect.selectOption({ value: waveValue }, { timeout: 4000 }).catch(() => {})
                ]);
                await page.waitForTimeout(1000);

                const waveLabel = await page.evaluate((v) => {
                  const opt = document.querySelector(`select[name="event"] option[value="${v}"]`);
                  return opt ? opt.text.trim() : v;
                }, waveValue).catch(() => waveValue);
                if (targetValues.length > 1) process.stdout.write(`\n      🌊 Wave: ${waveLabel}\n`);

                // Paginate this wave
                let wavePageSig = '';
                let waveTargetPages = maxPages;
                let waveP = 1;

                while (waveP <= waveTargetPages) {
                  if (waveP > 1) {
                    const nxtDis = await page.locator('.pages-nav-button.inactive, .pages-nav-button.disabled, a.silver-link.disabled').isVisible().catch(() => false);
                    if (nxtDis) break;
                    let wClick = false;
                    const numLnk = page.locator(`.pagination a:text-is("${waveP}"), a[data-silver*="page=${waveP}"], a[href*="page=${waveP}"]`).first();
                    if (await numLnk.isVisible().catch(() => false)) { await numLnk.click(); wClick = true; }
                    else {
                      const nxtBtn = page.locator('.pages-nav-button:not(.inactive):not(.disabled) a[aria-label="Next"], a.silver-link:not(.disabled):has-text("›"), a.silver-link:not(.disabled):has-text("»"), a.silver-link:not(.disabled):has-text(">"), li.pages-nav-button a:has-text("›"), li.pages-nav-button a:has-text("»"), li.pages-nav-button a:has-text(">")').first();
                      if (await nxtBtn.isVisible().catch(() => false)) { await nxtBtn.click(); wClick = true; }
                    }
                    if (!wClick) break;
                    await page.waitForTimeout(800);
                    await page.waitForSelector('.list-active, .list-info, .list-field, tbody tr', { timeout: 5000 }).catch(() => {});
                  }

                  const wHtml = await page.content();
                  const wPA = parseAthletes(wHtml, race.id, div.label, div.gender, seasonSlug, race.rawDropdownName);
                  if (wPA.length === 0) break;
                  const wSig = wPA.map(a => `${a.full_name}|${a.bib_number || ""}|${a.overall_rank || ""}`).join(";;");
                  if (wSig === wavePageSig) break;
                  wavePageSig = wSig;

                  if (waveP === 1) {
                    const wTxt = await page.evaluate(() => document.querySelector('.list-info, .str_num, .list-field-header')?.innerText?.trim() || '').catch(() => '');
                    const mC = wTxt.match(/([\d,]+)\s+Result/i) || wTxt.match(/Results?[:\s]+([\d,]+)/i) || wTxt.match(/of\s+([\d,]+)/i);
                    const wCnt = mC ? parseInt(mC[1].replace(/,/g, ''), 10) : 0;
                    if (wCnt > 0) {
                      waveTotalCount += wCnt;
                      waveTargetPages = Math.min(Math.ceil(wCnt / Math.max(wPA.length, 1)), maxPages);
                    }
                  }

                  waveAthletes.push(...wPA);
                  process.stdout.write(`      📥 pg${waveP}: +${wPA.length} (wave: ${waveAthletes.length})\r`);
                  if (ATHLETE_LIMIT && waveAthletes.length >= ATHLETE_LIMIT) break;
                  if (waveP >= waveTargetPages) break;
                  await sleep(600);
                  waveP++;
                }

                // Go back to list page before next wave
                if (targetValues.indexOf(waveValue) < targetValues.length - 1) {
                  await page.goto(listUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
                  await page.waitForSelector('select[name="event"]', { timeout: 6000 }).catch(() => {});
                  await page.waitForTimeout(500);
                }
              }

              // Merge all waves → athletes array, then exit outer page loop
              athletes.push(...waveAthletes);
              totalNumAthletes = waveTotalCount || waveAthletes.length;
              break;
            } else {
              console.log(`   ⭕  [${div.label}] Not found in dropdown – skipping.`);
              break;
            }
          } else {
             console.log(`   â­ï¸  [${div.label}] Form event select not found â€” skipping.`);
             break;
          }

          // No need to look for visual sex select in modern UI, we injected it above.
        } else {
          // Legacy Season 7 UI (event_main_group & search[event])
          const mainGroupSelect = page.locator('select[name="event_main_group"]');
          if (await mainGroupSelect.isVisible().catch(() => false)) {
            const groupValue = await page.evaluate(({ cityName, raceName }) => {
              const select = document.querySelector('select[name="event_main_group"]');
              if (!select) return null;
              const options = Array.from(select.options);
              const opt = options.find(o => {
                const text = o.text.toLowerCase();
                return text.includes(cityName.toLowerCase()) || (raceName && text.includes(raceName.toLowerCase()));
              });
              return opt ? opt.value : null;
            }, { cityName: race.city, raceName: race.name });

            if (groupValue) {
              await mainGroupSelect.selectOption(groupValue, { timeout: 3000 }).catch(() => { });
              await page.waitForTimeout(1000);
            }
          }

          if (div.sex !== '%') {
            const sexSelect = page.locator('select[name="search[sex]"]');
            if (await sexSelect.isVisible().catch(() => false)) {
              await sexSelect.selectOption(div.sex, { timeout: 2000 }).catch(() => { });
            }
          }

          const numSelect = page.locator('select[name="num_results"]');
          if (await numSelect.isVisible().catch(() => false)) {
            await numSelect.selectOption('100', { timeout: 2000 }).catch(() => { });
          }

          const eventSelect = page.locator('select[name="search[event]"]');
          if (await eventSelect.isVisible().catch(() => false)) {
            await eventSelect.selectOption({ value: div.event }, { timeout: 2000 }).catch(async () => {
              await eventSelect.selectOption({ label: div.event }, { timeout: 2000 }).catch(() => { });
            });
          }

          const submitBtn = page.locator('button[type="submit"], input[type="submit"]').first();
          if (await submitBtn.isVisible().catch(() => false)) {
            await Promise.all([
              page.waitForResponse(res => res.url().includes('ajax') || res.url().includes('pid=list'), { timeout: 3000 }).catch(() => {}),
              submitBtn.click()
            ]);
          } else {
            await page.evaluate(() => {
              const form = document.querySelector('form[name="form_lists_default"]');
              if (form) form.submit();
            });
            await page.waitForTimeout(3000);
          }
        }

        // Wait for results selector
        await page.waitForSelector('.list-active, .list-info, .list-field, .f-list_ranking, tbody tr, p.alert', { timeout: 4000 }).catch(() => { });
      } else {
        // Subsequent pages: check if disabled first
        const isNextDisabled = await page.locator('.pages-nav-button.inactive, .pages-nav-button.disabled, a.silver-link.disabled').isVisible().catch(() => false);
        if (isNextDisabled) break;

        let clicked = false;
        const numPageLink = page.locator(`.pagination a:text-is("${p}"), a[data-silver*="page=${p}"], a[href*="page=${p}"]`).first();
        if (await numPageLink.isVisible().catch(() => false)) {
          await numPageLink.click();
          clicked = true;
        } else {
          const nextBtn = page.locator('.pages-nav-button:not(.inactive):not(.disabled) a[aria-label="Next"], a.silver-link:not(.disabled):has-text("â€º"), a.silver-link:not(.disabled):has-text("Â»"), a.silver-link:not(.disabled):has-text(">"), li.pages-nav-button a:has-text("â€º"), li.pages-nav-button a:has-text("Â»"), li.pages-nav-button a:has-text(">")').first();
          if (await nextBtn.isVisible().catch(() => false)) {
            await nextBtn.click();
            clicked = true;
          }
        }

        if (clicked) {
          await page.waitForTimeout(800);
          await page.waitForSelector('.list-active, .list-info, .list-field, tbody tr', { timeout: 5000 }).catch(() => { });
        } else {
          break; // No more pages link found
        }
      }

      const html = await page.content();
      const pageAthletes = parseAthletes(html, race.id, div.label, div.gender, seasonSlug, race.rawDropdownName);

      if (pageAthletes.length === 0) {
        break;
      }

      // â”€â”€ Loop-Breaker: Check if page returned the exact same athletes as previous page â”€â”€
      const currentSig = pageAthletes.map(a => `${a.full_name}|${a.bib_number || ''}|${a.overall_rank || ''}`).join(';;');
      if (currentSig === lastPageSignature) {
        // Reached end of pagination (Mika Timing repeats last page when clicking beyond end)
        break;
      }
      lastPageSignature = currentSig;

      // On Page 1: Read total official attendance if explicitly stated in info headers
      if (p === 1) {
        const totalText = await page.evaluate(() => {
          const info = document.querySelector('.list-info, .str_num, .list-field-header');
          return info?.innerText?.trim() || '';
        }).catch(() => '');

        const matchCount = totalText.match(/([\d,]+)\s+Result/i) 
          || totalText.match(/Results?\s*[:\s]*([\d,]+)/i)
          || totalText.match(/of\s+([\d,]+)/i);
          
        totalNumAthletes = matchCount ? parseInt(matchCount[1].replace(/,/g, ''), 10) : 0;

        if (totalNumAthletes > 0 && pageAthletes.length > 0) {
          const exactPages = Math.ceil(totalNumAthletes / pageAthletes.length);
          targetPages = Math.min(exactPages, maxPages);
        } else {
          targetPages = maxPages; // Natural pagination: keeps going until no next-page link exists
        }
      }

      if (pageAthletes.length === 0) {
        const msg = totalNumAthletes === 0
          ? `â„¹ï¸  0 results â€” division may not exist in this season.`
          : `âš ï¸  ${totalNumAthletes} total but 0 rows parsed.`;
        process.stdout.write(`   ${msg}\n`);
        break;
      }

      athletes.push(...pageAthletes);

      // Stop if test limit reached
      if (ATHLETE_LIMIT && athletes.length >= ATHLETE_LIMIT) {
        process.stdout.write(`\n   ðŸ›‘ Reached test limit of ${ATHLETE_LIMIT} athletes. Stopping pagination.`);
        break;
      }

      // Stop if reached calculated target pages
      if (p >= targetPages) break;
      await sleep(600);

    } catch (err) {
      console.warn(`\n   âš ï¸  Error page ${p}:`, err.message.slice(0, 150));
      break;
    }
  }

  const uniqueMap = new Map();
  for (const a of athletes) {
    const key = `${a.full_name.toLowerCase()}:::${a.detail_url || a.bib_number || a.overall_rank}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, a);
    }
  }
  const cleanAthletes = Array.from(uniqueMap.values());
  return { athletes: cleanAthletes, totalCount: totalNumAthletes || cleanAthletes.length };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helper: Update official total race attendance
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function updateRaceAthleteCountLive(raceId, count) {
  if (IS_TEST || !count) return;
  try {
    await runQuery(`
      UPDATE hyrox_races
      SET athletes_count = GREATEST(COALESCE(athletes_count, 0), ${count}),
          updated_at = NOW()
      WHERE id = '${raceId}';
    `);
  } catch (_) { }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Scrape athlete detail page for splits
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function scrapeAthleteDetail(page, athlete, linkLocator) {
  try {
    if (linkLocator) {
      await linkLocator.click();
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(1000);
      const html = await page.content();
      const splitsAndMeta = parseSplits(html);
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await page.waitForTimeout(500);
      return { ...athlete, ...splitsAndMeta };
    } else if (athlete.detail_url) {
      await page.goto(athlete.detail_url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForSelector('.detail-box, .f-list_ranking, table, [class*="box"]', { timeout: 3000 }).catch(() => { });
      const html = await page.content();
      return { ...athlete, ...parseSplits(html) };
    }
    return athlete;
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
  if (IS_TEST) {
    console.log(`   ðŸ§ª [DRY-RUN] Would upsert ${athletes.length} athletes.`);
    return true;
  }

  // Deduplicate by conflict key (race_id, full_name, division) to prevent Postgres ERROR 21000
  const uniqueMap = new Map();
  for (const a of athletes) {
    const key = `${a.race_id}:::${a.full_name.toLowerCase()}:::${a.division}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, a);
    }
  }
  const uniqueAthletes = Array.from(uniqueMap.values());

  let allChunksOk = true;
  const CHUNK = 50;
  for (let i = 0; i < uniqueAthletes.length; i += CHUNK) {
    const chunk = uniqueAthletes.slice(i, i + CHUNK);
    const rows = chunk.map((a) => `(
      ${esc(a.race_id)},   ${esc(a.full_name)},       ${esc(a.bib_number)},
      ${esc(a.nationality)}, ${esc(a.gender)},         ${esc(a.age_group)},   ${esc(a.division)},
      ${esc(a.total_time)},  ${a.overall_rank ?? 'NULL'}, ${a.overall_rank ?? 'NULL'}, ${a.overall_rank ?? 'NULL'},
      ${esc(a.run_1)},  ${esc(a.run_2)},  ${esc(a.run_3)},  ${esc(a.run_4)},
      ${esc(a.run_5)},  ${esc(a.run_6)},  ${esc(a.run_7)},  ${esc(a.run_8)},
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
        total_time       = EXCLUDED.total_time,
        overall_rank     = EXCLUDED.overall_rank,
        division_rank    = EXCLUDED.division_rank,
        age_group_rank   = EXCLUDED.age_group_rank,
        nationality      = EXCLUDED.nationality,
        gender           = EXCLUDED.gender,
        age_group        = EXCLUDED.age_group,
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
    try {
      await runQuery(sql);
      process.stdout.write(`   ðŸ’¾ [${i + 1}â€“${Math.min(i + CHUNK, athletes.length)}/${athletes.length}] synced\r`);
    } catch (e) {
      console.error(`\n   âŒ Chunk [${i}â€“${i + CHUNK}] failed:`, e.message.slice(0, 200));
      allChunksOk = false;
    }
  }
  console.log('');
  return allChunksOk;
}

async function markDivisionSynced(raceId, division, count) {
  if (IS_TEST) return;
  try {
    await runQuery(`
      INSERT INTO hyrox_sync_log (race_id, division, athlete_count, synced_at)
      VALUES (${esc(raceId)}, ${esc(division)}, ${count}, NOW())
      ON CONFLICT (race_id, division) DO UPDATE SET
        athlete_count = EXCLUDED.athlete_count,
        synced_at = NOW();
    `);
  } catch (_) { }
}

async function getRaceTotalFromLog(raceId) {
  if (IS_TEST) return 0;
  try {
    const res = await runQuery(`
      SELECT COALESCE(SUM(athlete_count), 0) AS total
      FROM hyrox_sync_log WHERE race_id = ${esc(raceId)};
    `);
    return Array.isArray(res) && res[0] ? parseInt(res[0].total, 10) : 0;
  } catch (_) {
    return 0;
  }
}

async function initSyncLogTable() {
  if (IS_TEST) return;
  try {
    await runQuery(`
      CREATE TABLE IF NOT EXISTS hyrox_sync_log (
        race_id text NOT NULL,
        division text NOT NULL,
        athlete_count int NOT NULL,
        synced_at timestamptz DEFAULT now(),
        PRIMARY KEY (race_id, division)
      );

      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS course_map_url text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS lap_instructions text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS athlete_guide_url text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS lat float8;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS lng float8;
    `);

    if (FORCE_RESYNC) {
      console.log('ðŸ§¹ [FORCE RESYNC] Resetting sync checkpoints to re-fetch 100% of athletes...');
      await runQuery(`TRUNCATE TABLE hyrox_sync_log;`);
    }
  } catch (_) { }
}

async function getSyncProgress() {
  if (IS_TEST || FORCE_RESYNC) return new Set();
  try {
    const res = await runQuery(`SELECT race_id, division FROM hyrox_sync_log;`);
    const keys = Array.isArray(res) ? res.map((r) => `${r.race_id}::${r.division}`) : [];
    return new Set(keys);
  } catch (_) {
    return new Set();
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helper: Country mapper
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function getCountryByCity(city) {
  const c = city.toLowerCase();
  if (c.includes('london') || c.includes('manchester') || c.includes('birmingham') || c.includes('glasgow') || c.includes('cardiff')) return { name: 'United Kingdom', code: 'GB' };
  if (c.includes('berlin') || c.includes('munich') || c.includes('cologne') || c.includes('frankfurt') || c.includes('hamburg')) return { name: 'Germany', code: 'DE' };
  if (c.includes('paris') || c.includes('nice')) return { name: 'France', code: 'FR' };
  if (c.includes('madrid') || c.includes('barcelona') || c.includes('valencia') || c.includes('malaga')) return { name: 'Spain', code: 'ES' };
  if (c.includes('milan') || c.includes('rome') || c.includes('rimini')) return { name: 'Italy', code: 'IT' };
  if (c.includes('new york') || c.includes('chicago') || c.includes('miami') || c.includes('houston') || c.includes('atlanta') || c.includes('dallas') || c.includes('washington') || c.includes('los angeles')) return { name: 'United States', code: 'US' };
  if (c.includes('sydney') || c.includes('melbourne') || c.includes('brisbane') || c.includes('perth')) return { name: 'Australia', code: 'AU' };
  if (c.includes('singapore')) return { name: 'Singapore', code: 'SG' };
  if (c.includes('hong kong')) return { name: 'Hong Kong', code: 'HK' };
  if (c.includes('bangkok')) return { name: 'Thailand', code: 'TH' };
  if (c.includes('dubai') || c.includes('sharjah') || c.includes('abu dhabi')) return { name: 'United Arab Emirates', code: 'AE' };
  if (c.includes('shanghai') || c.includes('beijing') || c.includes('shenzhen') || c.includes('chengdu')) return { name: 'China', code: 'CN' };
  if (c.includes('incheon') || c.includes('seoul')) return { name: 'South Korea', code: 'KR' };
  if (c.includes('taipei')) return { name: 'Taiwan', code: 'TW' };
  if (c.includes('mumbai') || c.includes('delhi')) return { name: 'India', code: 'IN' };
  if (c.includes('cape town') || c.includes('johannesburg')) return { name: 'South Africa', code: 'ZA' };
  if (c.includes('toronto')) return { name: 'Canada', code: 'CA' };
  if (c.includes('amsterdam') || c.includes('rotterdam') || c.includes('maastricht') || c.includes('heerenveen')) return { name: 'Netherlands', code: 'NL' };
  if (c.includes('vienna')) return { name: 'Austria', code: 'AT' };
  if (c.includes('warsaw') || c.includes('katowice') || c.includes('poznan')) return { name: 'Poland', code: 'PL' };
  if (c.includes('copenhagen')) return { name: 'Denmark', code: 'DK' };
  if (c.includes('stockholm')) return { name: 'Sweden', code: 'SE' };
  return { name: 'International', code: 'XX' };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Master Verified Race Schedule (100% Official Tour Dates)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MASTER_RACE_DATES = {
  // 2025 Official Completed Dates
  'manchester-2025': { date: '2025-01-24', end_date: '2025-01-26', status: 'completed' },
  'maastricht-2025': { date: '2025-01-25', end_date: '2025-01-26', status: 'completed' },
  'turin-2025': { date: '2025-02-01', end_date: '2025-02-02', status: 'completed' },
  'vienna-2025': { date: '2025-02-07', end_date: '2025-02-09', status: 'completed' },
  'bilbao-2025': { date: '2025-02-15', end_date: '2025-02-16', status: 'completed' },
  'miami-beach-2025': { date: '2025-02-22', end_date: '2025-02-23', status: 'completed' },
  'katowice-2025': { date: '2025-02-22', end_date: '2025-02-23', status: 'completed' },
  'glasgow-2025': { date: '2025-03-07', end_date: '2025-03-09', status: 'completed' },
  'houston-2025': { date: '2025-03-14', end_date: '2025-03-16', status: 'completed' },
  'karlsruhe-2025': { date: '2025-03-15', end_date: '2025-03-16', status: 'completed' },
  'washington-dc-2025': { date: '2025-03-21', end_date: '2025-03-23', status: 'completed' },
  'copenhagen-2025': { date: '2025-03-22', end_date: '2025-03-23', status: 'completed' },
  'rotterdam-2025': { date: '2025-04-04', end_date: '2025-04-06', status: 'completed' },
  'cologne-2025': { date: '2025-04-10', end_date: '2025-04-13', status: 'completed' },
  'malaga-2025': { date: '2025-04-12', end_date: '2025-04-13', status: 'completed' },
  'paris-2025': { date: '2025-04-18', end_date: '2025-04-20', status: 'completed' },
  'las-vegas-2025': { date: '2025-04-26', end_date: '2025-04-27', status: 'completed' },
  'berlin-2025': { date: '2025-05-16', end_date: '2025-05-18', status: 'completed' },
    'cardiff-2025': { date: '2025-05-02', end_date: '2025-05-04', status: 'completed' },
    'riga-2025': { date: '2025-05-31', end_date: '2025-05-31', status: 'completed' },
    'bangkok-2025': { date: '2025-03-29', end_date: '2025-03-30', status: 'completed' },
    'rimini-2025': { date: '2025-05-30', end_date: '2025-06-01', status: 'completed' },
    'new-york-2025': { date: '2025-05-30', end_date: '2025-06-01', status: 'completed' },
  'london-2025': { date: '2025-05-23', end_date: '2025-05-26', status: 'completed' },
  'world-championships-2025': { date: '2025-06-12', end_date: '2025-06-15', status: 'completed' },
  'brisbane-2025': { date: '2025-07-04', end_date: '2025-07-06', status: 'completed' },
  'sydney-2025': { date: '2025-07-18', end_date: '2025-07-20', status: 'completed' },
  'melbourne-2025': { date: '2025-08-01', end_date: '2025-08-03', status: 'completed' },
  'perth-2025': { date: '2025-08-08', end_date: '2025-08-10', status: 'completed' },
  'singapore-2025': { date: '2025-08-29', end_date: '2025-08-31', status: 'completed' },
  'hong-kong-2025': { date: '2025-09-12', end_date: '2025-09-14', status: 'completed' },
  'incheon-2025': { date: '2025-09-26', end_date: '2025-09-28', status: 'completed' },
  'madrid-2025': { date: '2025-10-17', end_date: '2025-10-19', status: 'completed' },
  'birmingham-2025': { date: '2025-10-24', end_date: '2025-10-26', status: 'completed' },
  'amsterdam-2025': { date: '2025-10-31', end_date: '2025-11-02', status: 'completed' },
  'chicago-2025': { date: '2025-11-14', end_date: '2025-11-16', status: 'completed' },
  'stockholm-2025': { date: '2025-12-05', end_date: '2025-12-07', status: 'completed' },

  // 2026 Official Completed Dates (Seasons 25/26 & 26/27)
  'berlin-2026': { date: '2026-05-22', end_date: '2026-05-31', status: 'completed' },
  'london-olympia-2026': { date: '2026-05-29', end_date: '2026-05-31', status: 'completed' },
  'buenos-aires-2026': { date: '2026-06-13', end_date: '2026-06-14', status: 'completed' },
  'new-york-2026': { date: '2026-05-28', end_date: '2026-06-07', status: 'completed' },
  'rimini-2026': { date: '2026-05-28', end_date: '2026-05-31', status: 'completed' },
  'johannesburg-2026': { date: '2026-02-28', end_date: '2026-03-01', status: 'completed' },
  'riga-2026': { date: '2026-05-09', end_date: '2026-05-10', status: 'completed' },
  'lyon-2026': { date: '2026-02-21', end_date: '2026-02-22', status: 'completed' },
  'barcelona-2026': { date: '2026-04-25', end_date: '2026-04-26', status: 'completed' },
  'heerenveen-2026': { date: '2026-04-18', end_date: '2026-04-19', status: 'completed' },
  'incheon-2026': { date: '2026-03-28', end_date: '2026-03-29', status: 'completed' },
  'ottawa-2026': { date: '2026-04-11', end_date: '2026-04-12', status: 'completed' },
  'puebla-2026': { date: '2026-03-21', end_date: '2026-03-22', status: 'completed' },
  'shanghai-2026': { date: '2026-04-11', end_date: '2026-04-12', status: 'completed' },
  'helsinki-2026': { date: '2026-05-02', end_date: '2026-05-03', status: 'completed' },
  'hong-kong-2026': { date: '2026-05-09', end_date: '2026-05-10', status: 'completed' },
  'cardiff-2026': { date: '2026-03-14', end_date: '2026-03-15', status: 'completed' },
  'lisboa-2026': { date: '2026-04-18', end_date: '2026-04-19', status: 'completed' },
  'paris-gp-2026': { date: '2026-04-24', end_date: '2026-04-26', status: 'completed' },
  'sao-paulo-2026': { date: '2026-03-07', end_date: '2026-03-08', status: 'completed' },
  'warsaw-2026': { date: '2026-03-28', end_date: '2026-03-29', status: 'completed' },
  'cologne-2026': { date: '2026-04-09', end_date: '2026-04-12', status: 'completed' },
  'malaga-2026': { date: '2026-04-11', end_date: '2026-04-12', status: 'completed' },
  'rotterdam-2026': { date: '2026-04-03', end_date: '2026-04-05', status: 'completed' },
  'monterrey-2026': { date: '2026-02-21', end_date: '2026-02-22', status: 'completed' },
  'brisbane-2026': { date: '2026-02-14', end_date: '2026-02-15', status: 'completed' },
  'bengaluru-2026': { date: '2026-02-07', end_date: '2026-02-08', status: 'completed' },
  'wuhan-2026': { date: '2026-01-17', end_date: '2026-01-18', status: 'completed' },
  'miami-2026': { date: '2026-02-21', end_date: '2026-02-22', status: 'completed' },
  'cape-town-1-2026': { date: '2026-02-07', end_date: '2026-02-08', status: 'completed' },
  'bologna-2026': { date: '2026-01-31', end_date: '2026-02-01', status: 'completed' },
  'singapore-2026': { date: '2026-01-24', end_date: '2026-01-25', status: 'completed' },
  'houston-2026': { date: '2026-03-13', end_date: '2026-03-15', status: 'completed' },
  'mechelen-2026': { date: '2026-03-06', end_date: '2026-03-08', status: 'completed' },
  'bangkok-1-2026': { date: '2026-01-10', end_date: '2026-01-11', status: 'completed' },
  'beijing-2026': { date: '2026-01-10', end_date: '2026-01-11', status: 'completed' },
  'toulouse-2026': { date: '2026-02-14', end_date: '2026-02-15', status: 'completed' },
  'glasgow-2026': { date: '2026-03-06', end_date: '2026-03-08', status: 'completed' },
  'cancun-2026': { date: '2026-01-31', end_date: '2026-02-01', status: 'completed' },
  'copenhagen-2026': { date: '2026-03-20', end_date: '2026-03-22', status: 'completed' },
  'washington-dc-2026': { date: '2026-03-20', end_date: '2026-03-22', status: 'completed' },
  'taipei-2026': { date: '2026-01-24', end_date: '2026-01-25', status: 'completed' },
  'fortaleza-2026': { date: '2026-01-17', end_date: '2026-01-18', status: 'completed' },
  'las-vegas-2026': { date: '2026-04-24', end_date: '2026-04-26', status: 'completed' },
  'katowice-2026': { date: '2026-02-20', end_date: '2026-02-22', status: 'completed' },
  'istanbul-1-2026': { date: '2026-01-17', end_date: '2026-01-18', status: 'completed' },
  'nice-2026': { date: '2026-04-17', end_date: '2026-04-19', status: 'completed' },
  'bilbao-2026': { date: '2026-02-13', end_date: '2026-02-15', status: 'completed' },
  'guadalajara-2026': { date: '2026-01-24', end_date: '2026-01-25', status: 'completed' },
  'vienna-2026': { date: '2026-02-06', end_date: '2026-02-08', status: 'completed' },
  'phoenix-2026': { date: '2026-01-30', end_date: '2026-02-01', status: 'completed' },
  'auckland-2026': { date: '2026-01-31', end_date: '2026-02-01', status: 'completed' },
  'osaka-2026': { date: '2026-01-17', end_date: '2026-01-18', status: 'completed' },
  'turin-2026': { date: '2026-01-30', end_date: '2026-02-01', status: 'completed' },
  'amsterdam-2026': { date: '2026-01-23', end_date: '2026-01-25', status: 'completed' },
  'manchester-2026': { date: '2026-01-16', end_date: '2026-01-18', status: 'completed' },
  'st-gallen-2026': { date: '2026-01-09', end_date: '2026-01-11', status: 'completed' },

  // 2026 Future / Upcoming
  'stockholm-2026': { date: '2026-12-10', end_date: '2026-12-13', status: 'upcoming' },
};

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Helper: Dynamically discover official races from site
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function discoverOfficialRaces(page, seasonSlug, seasonLabel) {
  const url = `https://results.hyrox.com/${seasonSlug}/?pid=list`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForSelector('select[name="event_main_group"], select[name="event"]', { timeout: 6000 }).catch(() => { });

  const raceOptions = await page.evaluate(() => {
    // Format A (Season 7): select[name="event_main_group"]
    const select = document.querySelector('select[name="event_main_group"]');
    if (select && select.options.length > 1) {
      return Array.from(select.options)
        .map((opt) => opt.textContent?.trim())
        .filter((t) => t && t !== 'All' && t !== '%');
    }

    // Format B (Season 8 / 9): select[name="event"] optgroup labels
    const optgroups = Array.from(document.querySelectorAll('select[name="event"] optgroup'));
    if (optgroups.length > 0) {
      const labels = optgroups
        .map((og) => og.getAttribute('label')?.trim())
        .filter((t) => t && !t.toLowerCase().includes('sonstige') && t !== 'All' && t !== '%');
      return Array.from(new Set(labels));
    }

    return [];
  });

  const today = new Date().toISOString().slice(0, 10);

  return raceOptions.map((rawName) => {
    const match = rawName.match(/^(\d{4})\s+(.+)$/);
    const year = match ? match[1] : '2025';
    const cityName = match ? match[2] : rawName;
    const cleanCity = cityName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const raceId = `${cleanCity}-${year}`;
    const country = getCountryByCity(cityName);

    const master = MASTER_RACE_DATES[raceId] || {};
    const exactDate = master.date || `${year}-12-31`;
    const exactEndDate = master.end_date || exactDate;
    const status = master.status || (exactDate > today ? 'upcoming' : 'completed');

    return {
      id: raceId,
      name: `HYROX ${cityName} ${year}`,
      rawDropdownName: rawName,
      city: cityName,
      country: country.name,
      country_code: country.code,
      date: exactDate,
      end_date: exactEndDate,
      season: seasonLabel,
      status: status,
    };
  });
}

async function upsertRaceHeader(race) {
  if (IS_TEST) return;
  const sql = `
    INSERT INTO hyrox_races (id, name, city, country, country_code, date, end_date, season, status, athletes_count)
    VALUES (
      ${esc(race.id)}, ${esc(race.name)}, ${esc(race.city)},
      ${esc(race.country)}, ${esc(race.country_code)}, ${esc(race.date)},
      ${esc(race.end_date)}, ${esc(race.season)}, ${esc(race.status)}, 0
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      city = EXCLUDED.city,
      country = EXCLUDED.country,
      country_code = EXCLUDED.country_code,
      date = COALESCE(hyrox_races.date, EXCLUDED.date),
      end_date = COALESCE(hyrox_races.end_date, EXCLUDED.end_date),
      season = EXCLUDED.season,
      status = EXCLUDED.status,
      updated_at = NOW();
  `;
  try {
    await runQuery(sql);
  } catch (e) {
    console.warn(`   âš ï¸ Race header upsert failed for ${race.id}:`, e.message.slice(0, 100));
  }
}

async function updateRaceAthleteCount(raceId) {
  if (IS_TEST) return 0;
  try {
    const res = await runQuery(`
      SELECT division, COUNT(*) as c
      FROM hyrox_athlete_results
      WHERE race_id = ${esc(raceId)}
      GROUP BY division;
    `);
    if (res && res.length > 0) {
      let total = 0;
      for (const row of res) {
        const u = (row.division || '').toUpperCase();
        const mult = u.includes('DOUBLES') ? 2 : (u.includes('RELAY') ? 4 : 1);
        total += parseInt(row.c || 0, 10) * mult;
      }
      if (total > 0) {
        await runQuery(`
          UPDATE hyrox_races
          SET athletes_count = ${total}
          WHERE id = ${esc(raceId)};
        `);
        console.log(`   ðŸ“Š Calculated authentic human attendance: ${total.toLocaleString()} athletes (saved to hyrox_races)`);
        return total;
      }
    }
  } catch (e) {
    console.warn(`   âš ï¸ Could not update race total for ${raceId}:`, e.message.slice(0, 100));
  }
  return 0;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// MAIN
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function main() {
  const seasonsToRun = FORCE_SEASON
    ? SEASONS.filter((s) => s.slug === FORCE_SEASON)
    : SEASONS;

  // Launch headless Chromium browser
  console.log('ðŸŒ Launching Chromium browser (Stealth Mode)...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--window-size=1920,1080',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1920, height: 1080 },
    locale: 'en-US',
  });

  const page = await context.newPage();

  // Mask webdriver
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  console.log('   âœ… Browser ready.\n');

  // 1. Sync official calendar (exact dates, venues, images) - run on main job or standalone
  if (!FORCE_SEASON && !FORCE_RACE && !IS_TEST) {
    try {
      await syncOfficialCalendar(page);
    } catch (err) {
      console.warn('âš ï¸  Calendar sync error (proceeding to results):', err.message);
    }
  }

  let totalAthletes = 0;
  let totalSplits = 0;
  const racesSummary = [];

  try {
    await initSyncLogTable();
    const syncedDivisions = await getSyncProgress();
    if (syncedDivisions.size > 0) {
      console.log(`⚡ [SMART RESUME] Found ${syncedDivisions.size} race-divisions already synced in DB.\n`);
    }

    for (const season of seasonsToRun) {
      console.log(`\n${'â”€'.repeat(60)}`);
      console.log(`ðŸ—“ï¸  Season: ${season.label} (${season.slug})`);
      console.log('â”€'.repeat(60));

      console.log(`ðŸ” Discovering official races from results.hyrox.com/${season.slug}...`);
      const allSeasonRaces = await discoverOfficialRaces(page, season.slug, season.label);
      let seasonRaces = allSeasonRaces.filter(r => r.status === 'completed');
      
      if (FORCE_RACE) {
        seasonRaces = allSeasonRaces.filter(r => 
          r.name.toLowerCase().includes(FORCE_RACE.toLowerCase()) || 
          r.city.toLowerCase().includes(FORCE_RACE.toLowerCase()) ||
          r.id.toLowerCase().includes(FORCE_RACE.toLowerCase())
        );
        console.log(`   ðŸŽ¯ Filtered to specific race: "${FORCE_RACE}" (${seasonRaces.length} matching)`);
      } else {
        console.log(`   âœ… Found ${allSeasonRaces.length} official races. Filtered to ${seasonRaces.length} completed races.\n`);
      }

      if (seasonRaces.length === 0) {
        console.log(`   â„¹ï¸  No matching races found for ${season.label} â€” skipping.\n`);
        continue;
      }

      for (const race of seasonRaces) {
        console.log(`\nðŸŸï¸  Race: ${race.name} (${race.rawDropdownName})`);
        console.log(`   ðŸ“… Date: ${race.date} | Status: ${race.status}`);
        await upsertRaceHeader(race);

        if (race.status === 'upcoming' && !FORCE_RACE) {
          console.log(`   â© Upcoming race â€” skipping division scraping (calendar already synced).`);
          continue;
        }

        let raceTotal = 0;
        let attendanceSum = 0;

        const divisionsToRun = FORCE_DIV 
          ? DIVISIONS.filter(d => d.label.toLowerCase().includes(FORCE_DIV.toLowerCase()) || d.event.toLowerCase().includes(FORCE_DIV.toLowerCase()))
          : DIVISIONS;

        for (const div of divisionsToRun) {
          const divKey = `${race.id}::${div.label}`;
          if (syncedDivisions.has(divKey) && !FORCE_RESYNC) {
            console.log(`\n   ⏩ [DIVISION SYNCED] ${div.label} — already completed in database, skipping.`);
            continue;
          }

          console.log(`\n   📋 ${div.label}`);

          const { athletes, totalCount } = await scrapeDivisionLeaderboard(page, season.slug, race, div, MAX_PAGES);
          attendanceSum += (totalCount || 0);
          console.log(`\n   âœ… ${athletes.length} athletes found`);

          if (athletes.length === 0) {
            console.log(`   â­ï¸  No results found in ${div.label} â€” checking next division.`);
            continue;
          }

          // Fetch splits and rich profile metadata for all athletes
          const splitsLimit = Math.min(DEEP_SPLITS_LIMIT, athletes.length);
          if (splitsLimit > 0) {
            console.log(`   ⚡ Fetching all 17 splits & profile details for ${splitsLimit} athletes...`);
            const links = page.locator('a[href*="content=detail"]');
            for (let i = 0; i < splitsLimit; i++) {
              process.stdout.write(`   ⚡ [${i + 1}/${splitsLimit}] ${athletes[i].full_name}...\r`);
              const linkLocator = i < await links.count() ? links.nth(i) : null;
              athletes[i] = await scrapeAthleteDetail(page, athletes[i], linkLocator);
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



