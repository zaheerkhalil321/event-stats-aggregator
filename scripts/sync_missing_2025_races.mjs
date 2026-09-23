#!/usr/bin/env node
/**
 * ⚡ Ultra-Fast Targeted Ingestor for Incomplete 2025 Races
 * Uses direct HTTP GET (100 results/page) to fetch and upsert missing athletes into Turso DB.
 */

import { createClient } from '@libsql/client';
import fs from 'fs';

let envFile = '';
if (fs.existsSync('.env')) envFile = fs.readFileSync('.env', 'utf8');
else if (fs.existsSync('../.env')) envFile = fs.readFileSync('../.env', 'utf8');

const tursoUrl = process.env.TURSO_DATABASE_URL || envFile.match(/TURSO_DATABASE_URL=(.+)/)?.[1]?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN || envFile.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1]?.trim();

if (!tursoUrl || !tursoToken) {
  console.error('❌ Missing TURSO credentials');
  process.exit(1);
}

const client = createClient({
  url: tursoUrl,
  authToken: tursoToken,
});

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return `'${String(val).replace(/'/g, "''")}'`;
}

// Scrape an option with pagination
async function scrapeOption(seasonSlug, eventValue, sexFilter, raceId, divisionLabel, genderCode) {
  const athletes = [];
  const seenInOption = new Set();
  let page = 1;
  const numResults = 100;

  while (page <= 200) {
    let url = `https://hyrox.r.mikatiming.de/${seasonSlug}/?event=${encodeURIComponent(eventValue)}&num_results=${numResults}&page=${page}&pid=list`;
    if (sexFilter) url += `&search%5Bsex%5D=${encodeURIComponent(sexFilter)}`;

    let html = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (res.ok) {
          html = await res.text();
          break;
        }
      } catch (e) {
        await sleep(500 * attempt);
      }
    }

    if (!html || !html.includes('list-group-item')) break;

    const items = [...html.matchAll(/<li[^>]*class=\"[^\"]*list-group-item[^\"]*\"[^>]*>([\s\S]*?)<\/li>/gi)];
    let countOnPage = 0;

    for (const item of items) {
      const block = item[1];
      const linkMatch = block.match(/href=\"([^\"]*content=detail[^\"]*)\"[^>]*>([^<]+)<\/a>/i);
      if (!linkMatch) continue;

      const rawFullName = linkMatch[2].trim();
      const cleanFullName = rawFullName.replace(/\s*\([A-Za-z]{2,3}\)$/i, '').trim();

      if (cleanFullName.toLowerCase().includes('test, test')) continue;

      const rankMatch = block.match(/type-place[^>]*>(\d+)<\/div>/i);
      const timeMatch = block.match(/type-time[^>]*>([\d:]+)<\/div>/i) || block.match(/(\d{1,2}:\d{2}:\d{2})/);
      const ageMatch = block.match(/type-age_class[^>]*>([^<]+)<\/div>/i);
      const bibMatch = block.match(/type-start_number[^>]*>([^<]+)<\/div>/i);

      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}|${timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : ''}`;
      if (seenInOption.has(dedupeKey)) continue;
      seenInOption.add(dedupeKey);

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || rawFullName.match(/\(([A-Za-z]{2,3})\)$/);

      const nationality = nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : 'XX';

      athletes.push({
        race_id: raceId,
        full_name: cleanFullName,
        bib_number: bibMatch ? bibMatch[1].trim() : null,
        nationality,
        gender: genderCode,
        age_group: ageMatch ? ageMatch[1].trim() : null,
        division: divisionLabel,
        total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
        overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
      });
      countOnPage++;
    }

    if (items.length === 0) break;
    const hasNext = /<li[^>]*class=\"[^\"]*pages-nav-button[^\"]*\"[^>]*><a[^>]*>&gt;<\/a>/i.test(html) &&
      !/<li[^>]*class=\"[^\"]*pages-nav-button[^\"]*disabled[^\"]*\"[^>]*>/i.test(html);
    if (!hasNext) break;
    page++;
    await sleep(150);
  }

  return athletes;
}

// Upsert chunk into Turso DB
async function upsertAthletes(athletes) {
  if (athletes.length === 0) return 0;
  let totalInserted = 0;
  const CHUNK = 50;

  for (let i = 0; i < athletes.length; i += CHUNK) {
    const chunk = athletes.slice(i, i + CHUNK);
    const rows = chunk.map(a => `(
      ${esc(a.race_id)}, ${esc(a.full_name)}, ${esc(a.bib_number)},
      ${esc(a.nationality)}, ${esc(a.gender)}, ${esc(a.age_group)}, ${esc(a.division)},
      ${esc(a.total_time)}, ${a.overall_rank ?? 'NULL'}
    )`).join(',\n');

    const sql = `
      INSERT INTO hyrox_athlete_results (
        race_id, full_name, bib_number,
        nationality, gender, age_group, division,
        total_time, overall_rank
      ) VALUES ${rows}
      ON CONFLICT (race_id, full_name, division) DO UPDATE SET
        total_time = EXCLUDED.total_time,
        overall_rank = EXCLUDED.overall_rank,
        nationality = CASE WHEN hyrox_athlete_results.nationality = 'XX' AND EXCLUDED.nationality != 'XX' THEN EXCLUDED.nationality ELSE hyrox_athlete_results.nationality END,
        bib_number = COALESCE(EXCLUDED.bib_number, hyrox_athlete_results.bib_number)
    `;

    try {
      const res = await client.execute(sql);
      totalInserted += res.rowsAffected || 0;
    } catch (e) {
      console.error('      ❌ Upsert error:', e.message);
    }
  }

  return totalInserted;
}

// Jobs definition for incomplete 2025 races
const JOBS = [
  // 1. Birmingham 2025: Missing Doubles Men (2,463 pairs)
  {
    raceId: 'birmingham-2025',
    season: 'season-8',
    tasks: [
      { event: 'HD_Birmingham_1025_OVERALL', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
    ]
  },
  // 2. Berlin 2025: Missing Doubles (Men, Women, Mixed)
  {
    raceId: 'berlin-2025',
    season: 'season-7',
    tasks: [
      { event: 'HD_BERLIN2025_OVERALL', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
      { event: 'HD_BERLIN2025_OVERALL', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
      { event: 'HD_BERLIN2025_OVERALL', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
    ]
  },
  // 3. Singapore 2025: Missing Doubles & Pro Doubles
  {
    raceId: 'singapore-2025',
    season: 'season-7',
    tasks: [
      { event: 'HD_JGDMS4JI80F', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
      { event: 'HD_JGDMS4JI80F', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
      { event: 'HD_JGDMS4JI80F', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
      { event: 'HDP_JGDMS4JI80F', sex: 'M', div: 'HYROX PRO DOUBLES MEN', gender: 'M' },
      { event: 'HDP_JGDMS4JI80F', sex: 'W', div: 'HYROX PRO DOUBLES WOMEN', gender: 'F' },
    ]
  },
  // 4. Mexico City 2025: Daily Wave Options (Friday, Saturday, Sunday)
  {
    raceId: 'mexico-city-2025',
    season: 'season-8',
    tasks: [
      // Pro Friday & Saturday
      { event: 'HPRO_LR3MS4JIF66', sex: 'M', div: 'HYROX PRO MEN', gender: 'M' },
      { event: 'HPRO_LR3MS4JIF66', sex: 'W', div: 'HYROX PRO WOMEN', gender: 'F' },
      { event: 'HPRO_LR3MS4JIF67', sex: 'M', div: 'HYROX PRO MEN', gender: 'M' },
      { event: 'HPRO_LR3MS4JIF67', sex: 'W', div: 'HYROX PRO WOMEN', gender: 'F' },

      // Open Friday, Saturday, Sunday
      { event: 'H_LR3MS4JIF66', sex: 'M', div: 'HYROX MEN', gender: 'M' },
      { event: 'H_LR3MS4JIF66', sex: 'W', div: 'HYROX WOMEN', gender: 'F' },
      { event: 'H_LR3MS4JIF67', sex: 'M', div: 'HYROX MEN', gender: 'M' },
      { event: 'H_LR3MS4JIF67', sex: 'W', div: 'HYROX WOMEN', gender: 'F' },
      { event: 'H_LR3MS4JIF68', sex: 'M', div: 'HYROX MEN', gender: 'M' },
      { event: 'H_LR3MS4JIF68', sex: 'W', div: 'HYROX WOMEN', gender: 'F' },

      // Pro Doubles Friday & Saturday
      { event: 'HDP_LR3MS4JIF66', sex: 'M', div: 'HYROX PRO DOUBLES MEN', gender: 'M' },
      { event: 'HDP_LR3MS4JIF66', sex: 'W', div: 'HYROX PRO DOUBLES WOMEN', gender: 'F' },
      { event: 'HDP_LR3MS4JIF67', sex: 'M', div: 'HYROX PRO DOUBLES MEN', gender: 'M' },
      { event: 'HDP_LR3MS4JIF67', sex: 'W', div: 'HYROX PRO DOUBLES WOMEN', gender: 'F' },

      // Doubles Friday, Saturday, Sunday
      { event: 'HD_LR3MS4JIF66', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
      { event: 'HD_LR3MS4JIF66', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
      { event: 'HD_LR3MS4JIF66', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
      { event: 'HD_LR3MS4JIF67', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
      { event: 'HD_LR3MS4JIF67', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
      { event: 'HD_LR3MS4JIF68', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
      { event: 'HD_LR3MS4JIF68', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
      { event: 'HD_LR3MS4JIF68', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
    ]
  }
];

async function run() {
  console.log('='.repeat(65));
  console.log('  🚀 Fast Ingestion: Syncing Incomplete 2025 Races');
  console.log(`  🕒 Started: ${new Date().toISOString()}`);
  console.log('='.repeat(65));

  for (const job of JOBS) {
    console.log(`\n🏟️  Processing: [${job.raceId}] (Season: ${job.season})`);
    let raceTotal = 0;

    for (const task of job.tasks) {
      process.stdout.write(`   👉 Fetching ${task.div} (event=${task.event}, sex=${task.sex})... `);
      const list = await scrapeOption(job.season, task.event, task.sex, job.raceId, task.div, task.gender);
      process.stdout.write(`found ${list.length} athletes.\n`);

      if (list.length > 0) {
        process.stdout.write(`      💾 Upserting ${list.length} rows into Turso DB... `);
        const affected = await upsertAthletes(list);
        process.stdout.write(`done (rowsAffected: ${affected})\n`);
        raceTotal += list.length;
      }
    }

    // Recompute athletes_count on hyrox_races
    await client.execute({
      sql: `UPDATE hyrox_races 
            SET athletes_count = (SELECT COUNT(*) FROM hyrox_athlete_results WHERE race_id = ?) 
            WHERE id = ?`,
      args: [job.raceId, job.raceId]
    });

    console.log(`   ✅ Finished [${job.raceId}]: ${raceTotal} athletes processed.`);
  }

  console.log('\n' + '='.repeat(65));
  console.log('🎉 All 4 incomplete races have been successfully synced and updated!');
  console.log('='.repeat(65));
}

run().catch(console.error);
