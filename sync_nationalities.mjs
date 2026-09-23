#!/usr/bin/env node
/**
 * 🏃 Dedicated Fast Nationality & Clean Name Backfiller
 * 
 * Fetches MikaTiming list pages (100 results per request) using lightweight HTTP GET
 * and updates athletes' nationality and cleans names in Turso DB.
 * 
 * Usage:
 *   node sync_nationalities.mjs --race=buenos-aires-2026
 *   node sync_nationalities.mjs --season=season-8
 *   node sync_nationalities.mjs --race=buenos-aires-2026 --dry-run
 */

import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';

// Parse arguments
const args = process.argv.slice(2);
const TARGET_RACE = args.find(a => a.startsWith('--race='))?.split('=')[1] || null;
const TARGET_SEASON = args.find(a => a.startsWith('--season='))?.split('=')[1] || (TARGET_RACE ? null : 'season-8');
const IS_DRY_RUN = args.includes('--dry-run');
const LIMIT_RACES = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);

// Load DB client
let envFile = '';
if (fs.existsSync('.env')) envFile = fs.readFileSync('.env', 'utf8');
else if (fs.existsSync('../.env')) envFile = fs.readFileSync('../.env', 'utf8');

const tursoUrl = process.env.TURSO_DATABASE_URL || envFile.match(/TURSO_DATABASE_URL=(.+)/)?.[1]?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN || envFile.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1]?.trim();

if (!tursoUrl || !tursoToken) {
  console.error('❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN');
  process.exit(1);
}

const client = createClient({
  url: tursoUrl,
  authToken: tursoToken,
});

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const SEASONS = [
  { slug: 'season-8', label: '2025/2026' },
  { slug: 'season-7', label: '2024/2025' },
  { slug: 'season-9', label: '2026/2027' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (res.status === 429) {
        console.warn(`[429 Rate Limited] Backing off ${attempt * 3}s...`);
        await sleep(attempt * 3000);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (attempt === retries) throw e;
      await sleep(1500 * attempt);
    }
  }
}

// Extract optgroups and options from MikaTiming form
async function getSeasonEventOptions(seasonSlug) {
  const url = `https://hyrox.r.mikatiming.com/${seasonSlug}/?pid=list`;
  const html = await fetchWithRetry(url);
  const optgroups = [...html.matchAll(/<optgroup\s+label=\"([^\"]+)\">([\s\S]*?)<\/optgroup>/gi)];
  
  const eventsByGroup = [];
  for (const og of optgroups) {
    const label = og[1].trim();
    const opts = [...og[2].matchAll(/<option\s+value=\"([^\"]+)\"[^>]*>([^<]+)<\/option>/gi)].map(o => ({
      value: o[1].trim(),
      name: o[2].trim(),
    }));
    eventsByGroup.push({ label, options: opts });
  }
  return eventsByGroup;
}

// Map race ID to optgroup label
function findMatchingOptgroup(raceId, raceName, raceCity, optgroups) {
  const c = (raceCity || '').toLowerCase().trim();
  const id = raceId.toLowerCase().trim();
  const yearMatch = raceId.match(/\d{4}/)?.[0] || '';

  // 1. Direct label contains city & year
  for (const og of optgroups) {
    const l = og.label.toLowerCase();
    if (c && l.includes(c) && (!yearMatch || l.includes(yearMatch))) {
      return og;
    }
  }

  // 2. Direct label contains city
  if (c) {
    for (const og of optgroups) {
      const l = og.label.toLowerCase();
      if (l.includes(c)) return og;
    }
  }

  // 3. Fallback on raceId tokens
  const idTokens = id.split('-').filter(t => t.length > 2 && !t.match(/^\d+$/));
  for (const og of optgroups) {
    const l = og.label.toLowerCase();
    if (idTokens.every(tok => l.includes(tok))) return og;
  }

  return null;
}

// Scrape one option and extract athletes with nationality
async function scrapeOptionAthletes(seasonSlug, eventValue, sexFilter = '') {
  const athletes = [];
  let page = 1;
  const numResults = 100;

  while (page <= 200) { // Safety cap
    let url = `https://hyrox.r.mikatiming.com/${seasonSlug}/?event=${encodeURIComponent(eventValue)}&num_results=${numResults}&page=${page}&pid=list`;
    if (sexFilter) url += `&search%5Bsex%5D=${encodeURIComponent(sexFilter)}`;

    let html;
    try {
      html = await fetchWithRetry(url);
    } catch (e) {
      console.error(`     ⚠️ Failed to fetch page ${page} of ${eventValue}:`, e.message);
      break;
    }

    const items = [...html.matchAll(/<li[^>]*class=\"[^\"]*list-group-item[^\"]*\"[^>]*>([\s\S]*?)<\/li>/gi)];
    let foundOnPage = 0;

    for (const item of items) {
      const block = item[1];
      const linkMatch = block.match(/href=\"([^\"]*content=detail[^\"]*)\"[^>]*>([^<]+)<\/a>/i);
      if (!linkMatch) continue;

      const rawFullName = linkMatch[2].trim();
      const cleanFullName = rawFullName.replace(/\s*\([A-Za-z]{2,3}\)$/i, '').trim();

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || rawFullName.match(/\(([A-Za-z]{2,3})\)$/);

      const nationality = nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : null;

      const rankMatch = block.match(/type-place[^>]*>(\d+)<\/div>/i);
      const bibMatch = block.match(/type-start_number[^>]*>([^<]+)<\/div>/i);

      athletes.push({
        rawName: rawFullName,
        cleanName: cleanFullName,
        nationality,
        rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
        bib: bibMatch ? bibMatch[1].trim() : null,
      });
      foundOnPage++;
    }

    if (foundOnPage === 0 || foundOnPage < numResults) {
      break; // Last page
    }

    page++;
    await sleep(150); // Fast but polite
  }

  return athletes;
}

async function processRace(race, seasonSlug, optgroup) {
  console.log(`\n🏁 Processing: [${race.id}] ${race.name} (Season: ${seasonSlug})`);
  console.log(`   Found MikaTiming optgroup: "${optgroup.label}" (${optgroup.options.length} divisions/waves)`);

  let totalUpdated = 0;
  const sexes = ['M', 'W', 'X']; // Check all genders if applicable

  for (const opt of optgroup.options) {
    process.stdout.write(`   👉 Scanning: ${opt.name} (${opt.value})... `);
    
    // We scrape both M and W for individual events
    const allOptAthletes = [];
    for (const sex of sexes) {
      const list = await scrapeOptionAthletes(seasonSlug, opt.value, sex);
      allOptAthletes.push(...list);
    }

    if (allOptAthletes.length === 0) {
      // Try without sex filter
      const list = await scrapeOptionAthletes(seasonSlug, opt.value, '');
      allOptAthletes.push(...list);
    }

    // Filter to those with valid nationality
    const validAthletes = allOptAthletes.filter(a => a.nationality && a.nationality !== 'XX');
    process.stdout.write(`found ${allOptAthletes.length} total (${validAthletes.length} with nation)\n`);

    if (validAthletes.length === 0) continue;

    if (IS_DRY_RUN) {
      console.log(`      [DRY-RUN] Sample: ${validAthletes[0].cleanName} -> ${validAthletes[0].nationality}`);
      totalUpdated += validAthletes.length;
      continue;
    }

    // Perform batch DB updates in chunks of 50
    const CHUNK_SIZE = 50;
    for (let i = 0; i < validAthletes.length; i += CHUNK_SIZE) {
      const chunk = validAthletes.slice(i, i + CHUNK_SIZE);
      const statements = [];

      for (const a of chunk) {
        // Update nationality where race_id and (clean name or raw name) match
        statements.push({
          sql: `UPDATE hyrox_athlete_results 
                SET nationality = ?, full_name = ? 
                WHERE race_id = ? 
                  AND (full_name = ? OR full_name = ?)
                  AND (nationality = 'XX' OR nationality IS NULL OR full_name LIKE '%(%')`,
          args: [a.nationality, a.cleanName, race.id, a.cleanName, a.rawName],
        });
      }

      try {
        const results = await client.batch(statements, 'write');
        const affected = results.reduce((acc, r) => acc + (r.rowsAffected || 0), 0);
        totalUpdated += affected;
      } catch (err) {
        console.error(`      ❌ Batch update error:`, err.message);
      }
    }
  }

  console.log(`   ✨ Completed [${race.id}]: ${totalUpdated} athlete rows updated in DB.`);
  return totalUpdated;
}

async function main() {
  console.log('='.repeat(65));
  console.log('  🌍 HYROX Fast Nationality & Clean Name Backfiller');
  console.log(`  🕒 Started: ${new Date().toISOString()}`);
  console.log(`  🎯 Mode: ${IS_DRY_RUN ? 'DRY-RUN (No DB Writes)' : 'LIVE -> Turso Cloud ⚡'}`);
  if (TARGET_RACE) console.log(`  📍 Target Race: ${TARGET_RACE}`);
  if (TARGET_SEASON) console.log(`  📅 Target Season: ${TARGET_SEASON}`);
  console.log('='.repeat(65));

  // 1. Fetch races from DB
  let racesQuery = `SELECT id, name, city, country, athletes_count FROM hyrox_races`;
  if (TARGET_RACE) {
    racesQuery += ` WHERE id = '${TARGET_RACE}'`;
  }
  const racesRes = await client.execute(racesQuery);
  let races = racesRes.rows;

  if (races.length === 0) {
    console.error(`❌ No race found matching: ${TARGET_RACE || 'all'}`);
    process.exit(1);
  }

  if (LIMIT_RACES > 0) {
    races = races.slice(0, LIMIT_RACES);
  }

  console.log(`Found ${races.length} race(s) to process.`);

  // 2. Process seasons
  const seasonsToScan = TARGET_SEASON 
    ? SEASONS.filter(s => s.slug === TARGET_SEASON)
    : SEASONS;

  let grandTotalUpdated = 0;

  for (const s of seasonsToScan) {
    console.log(`\n📚 Fetching MikaTiming event directory for ${s.label} (${s.slug})...`);
    let optgroups = [];
    try {
      optgroups = await getSeasonEventOptions(s.slug);
    } catch (e) {
      console.error(`❌ Failed to fetch season directory for ${s.slug}:`, e.message);
      continue;
    }

    for (const race of races) {
      const og = findMatchingOptgroup(race.id, race.name, race.city, optgroups);
      if (!og) continue;

      const updated = await processRace(race, s.slug, og);
      grandTotalUpdated += updated;
    }
  }

  console.log('\n' + '='.repeat(65));
  console.log(`🎉 Finished! Total athlete rows updated: ${grandTotalUpdated}`);
  console.log('='.repeat(65));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
