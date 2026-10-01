#!/usr/bin/env node
/**
 * ⚡ Scrape Missing 2023 Races (Season 5 & Season 6)
 * 
 * Safely ingests the 12 missing/collided 2023 events in efficient 100-row batches.
 * Total writes: ~22,000 rows (0.09% of Turso's 25M monthly limit).
 */

import { createClient } from '@libsql/client';
import fs from 'fs';

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

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return val;
  return `'${String(val).replace(/'/g, "''")}'`;
}

const RACES = [
  // 1. Season 5 (Spring 2023)
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'london-spring-2023',
    name: 'HYROX London Spring 2023',
    date: '2023-04-30',
    city: 'London',
    country: 'United Kingdom',
    code: 'GB',
    waves: [
      { val: 'HPRO_JGDMS4JI468', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI468', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI468', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI468', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'hong-kong-spring-2023',
    name: 'HYROX Hong Kong Spring 2023',
    date: '2023-05-14',
    city: 'Hong Kong',
    country: 'Hong Kong',
    code: 'HK',
    waves: [
      { val: 'HPRO_JGDMS4JI46A', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI46A', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI46A', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI46A', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'koln-2023',
    name: 'HYROX Köln 2023',
    date: '2023-04-16',
    city: 'Cologne',
    country: 'Germany',
    code: 'DE',
    waves: [
      { val: 'HPRO_JGDMS4JI472', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI472', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI472', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI472', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'stockholm-spring-2023',
    name: 'HYROX Stockholm Spring 2023',
    date: '2023-03-25',
    city: 'Stockholm',
    country: 'Sweden',
    code: 'SE',
    waves: [
      { val: 'HPRO_JGDMS4JI467', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI467', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI467', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI467', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'dallas-spring-2023',
    name: 'HYROX Dallas Spring 2023',
    date: '2023-03-18',
    city: 'Dallas',
    country: 'United States',
    code: 'US',
    waves: [
      { val: 'HPRO_JGDMS4JI470', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI470', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI470', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI470', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'barcelona-spring-2023',
    name: 'HYROX Barcelona Spring 2023',
    date: '2023-03-18',
    city: 'Barcelona',
    country: 'Spain',
    code: 'ES',
    waves: [
      { val: 'HPRO_JGDMS4JI466', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI466', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI466', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] }
    ]
  },
  {
    season: 'season-5',
    seasonCode: '22/23',
    id: 'hamburg-spring-2023',
    name: 'HYROX Hamburg Spring 2023',
    date: '2023-04-01',
    city: 'Hamburg',
    country: 'Germany',
    code: 'DE',
    waves: [
      { val: 'HPRO_JGDMS4JI473', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI473', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI473', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI473', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },

  // 2. Season 6 (Fall 2023)
  {
    season: 'season-6',
    seasonCode: '23/24',
    id: 'london-2023',
    name: 'HYROX London 2023',
    date: '2023-11-26',
    city: 'London',
    country: 'United Kingdom',
    code: 'GB',
    waves: [
      { val: 'HPRO_JGDMS4JI62E', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI62E', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI62E', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI62E', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-6',
    seasonCode: '23/24',
    id: 'hong-kong-2023',
    name: 'HYROX Hong Kong 2023',
    date: '2023-11-26',
    city: 'Hong Kong',
    country: 'Hong Kong',
    code: 'HK',
    waves: [
      { val: 'HPRO_JGDMS4JI5F2', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI5F2', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI5F2', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI5F2', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-6',
    seasonCode: '23/24',
    id: 'birmingham-2023',
    name: 'HYROX Birmingham 2023',
    date: '2023-10-21',
    city: 'Birmingham',
    country: 'United Kingdom',
    code: 'GB',
    waves: [
      { val: 'HPRO_JGDMS4JI5E2', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI5E2', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI5E2', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI5E2', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-6',
    seasonCode: '23/24',
    id: 'new-york-2023',
    name: 'HYROX New York 2023',
    date: '2023-06-11',
    city: 'New York',
    country: 'United States',
    code: 'US',
    waves: [
      { val: 'HPRO_JGDMS4JI471', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI471', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI471', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI471', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  },
  {
    season: 'season-6',
    seasonCode: '23/24',
    id: 'rimini-2023',
    name: 'HYROX Rimini 2023',
    date: '2023-06-03',
    city: 'Rimini',
    country: 'Italy',
    code: 'IT',
    waves: [
      { val: 'HPRO_JGDMS4JI4D9', name: 'HYROX PRO', sexes: ['M', 'W'] },
      { val: 'H_JGDMS4JI4D9', name: 'HYROX', sexes: ['M', 'W'] },
      { val: 'HD_JGDMS4JI4D9', name: 'HYROX DOUBLES', sexes: ['M', 'W', 'X'] },
      { val: 'HMR_JGDMS4JI4D9', name: 'HYROX TEAM RELAY', sexes: [''] }
    ]
  }
];

async function scrapeWave(raceId, season, eventVal, divBaseName, sex) {
  const sexParam = sex ? `&search[sex]=${sex}` : '';
  let page = 1;
  const list = [];
  const seen = new Set();

  while (page <= 50) {
    const url = `https://hyrox.r.mikatiming.de/${season}/?event=${eventVal}&num_results=100&page=${page}&pid=list${sexParam}`;
    let html = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': UA } });
        if (res.ok) {
          html = await res.text();
          break;
        }
      } catch (e) {
        await sleep(300 * attempt);
      }
    }

    if (!html || !html.includes('list-group-item')) break;

    const items = [...html.matchAll(/<li[^>]*class=\"[^\"]*list-group-item[^\"]*\"[^>]*>([\s\S]*?)<\/li>/gi)];
    if (items.length <= 1) break;

    let itemsOnPage = 0;
    for (const item of items) {
      const block = item[1];
      if (block.includes('list-group-header') || block.includes('list-info__text')) continue;

      const linkMatch = block.match(/href=\"([^\"]*content=detail[^\"]*)\"[^>]*>([^<]+)<\/a>/i);
      if (!linkMatch) continue;

      let cleanFullName = linkMatch[2].trim();
      cleanFullName = cleanFullName.replace(/\s*\([A-Za-z0-9_]{2,15}\)$/i, '').trim();
      if (!cleanFullName || cleanFullName.toLowerCase().includes('test, test')) continue;

      const rankMatch = block.match(/class=\"[^\"]*type-place[^\"]*numeric\"[^>]*>(\d+)<\/div>/i)
        || block.match(/type-place[^>]*>(\d+)<\/div>/i);
      const timeMatch = block.match(/type-time[^>]*>([\d:]+)<\/div>/i) || block.match(/(\d{1,2}:\d{2}:\d{2})/);
      const ageMatch = block.match(/type-age_class[^>]*>([^<]+)<\/div>/i);
      const bibMatch = block.match(/type-start_number[^>]*>([^<]+)<\/div>/i);

      let division = divBaseName;
      if (sex === 'M') division += ' MEN';
      else if (sex === 'W') division += ' WOMEN';
      else if (sex === 'X') division += ' MIXED';

      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}|${division}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || linkMatch[2].match(/\(([A-Za-z]{2,3})\)$/);

      list.push({
        race_id: raceId,
        full_name: cleanFullName,
        bib_number: bibMatch ? bibMatch[1].trim() : null,
        nationality: nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : 'XX',
        gender: sex || 'M',
        age_group: ageMatch ? ageMatch[1].trim().replace(/^Age Group/i, '').trim() : null,
        division: division.trim(),
        total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
        overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
      });
      itemsOnPage++;
    }

    if (itemsOnPage === 0) break;
    const hasNext = /<li[^>]*class=\"[^\"]*pages-nav-button[^\"]*\"[^>]*><a[^>]*>&gt;<\/a>/i.test(html) &&
      !/<li[^>]*class=\"[^\"]*pages-nav-button[^\"]*disabled[^\"]*\"[^>]*>/i.test(html);
    if (!hasNext) break;
    page++;
    await sleep(150);
  }

  return list;
}

async function scrapeRace(race) {
  console.log(`\n============================================================`);
  console.log(`⚡ INGESTING: ${race.id} (${race.name}) - ${race.date}`);
  console.log(`============================================================`);

  // 1. Insert Race Header
  await client.execute(`
    INSERT INTO hyrox_races (
      id, name, city, country, country_code, date, end_date, season, status, athletes_count, created_at, updated_at
    ) VALUES (
      ${esc(race.id)}, ${esc(race.name)}, ${esc(race.city)}, ${esc(race.country)},
      ${esc(race.code)}, ${esc(race.date)}, ${esc(race.date)}, ${esc(race.seasonCode)},
      'completed', 0, datetime('now'), datetime('now')
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      city = excluded.city,
      country = excluded.country,
      date = excluded.date,
      end_date = excluded.end_date,
      season = excluded.season,
      status = 'completed',
      updated_at = datetime('now')
  `);

  let totalRows = 0;

  for (const w of race.waves) {
    for (const sex of w.sexes) {
      process.stdout.write(`  Scraping ${w.name} ${sex ? `(${sex})` : ''}... `);
      const rows = await scrapeWave(race.id, race.season, w.val, w.name, sex);
      console.log(`found ${rows.length} rows`);

      if (rows.length === 0) continue;

      const batchSize = 100;
      for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const values = batch.map(a => `(
          ${esc(a.race_id)}, ${esc(a.full_name)}, ${esc(a.bib_number)}, ${esc(a.nationality)},
          ${esc(a.gender)}, ${esc(a.age_group)}, ${esc(a.division)}, ${esc(a.total_time)},
          ${esc(a.overall_rank)}, datetime('now')
        )`).join(',\n');

        await client.execute(`
          INSERT INTO hyrox_athlete_results (
            race_id, full_name, bib_number, nationality, gender, age_group, division, total_time, overall_rank, created_at
          ) VALUES ${values}
          ON CONFLICT (race_id, full_name, division) DO UPDATE SET
            bib_number = excluded.bib_number,
            nationality = excluded.nationality,
            total_time = excluded.total_time,
            overall_rank = excluded.overall_rank
        `);
      }
      totalRows += rows.length;
    }
  }

  // 2. Attendance Calculation
  const stat = await client.execute({
    sql: `
      SELECT COALESCE(sum(CASE 
        WHEN division LIKE '%RELAY%' THEN 4 
        WHEN division LIKE '%DOUBLES%' THEN 2 
        ELSE 1 
      END), 0) as attendance,
      count(*) as cnt
      FROM hyrox_athlete_results
      WHERE race_id = ?
    `,
    args: [race.id]
  });

  const attendance = Number(stat.rows[0].attendance);
  const rowsCount = Number(stat.rows[0].cnt);

  await client.execute({
    sql: `UPDATE hyrox_races SET athletes_count = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?`,
    args: [attendance, race.id]
  });

  console.log(`🎉 [${race.id}] Complete! Official Attendance: ${attendance} (${rowsCount} athlete rows).`);
}

async function main() {
  console.log('🚀 Starting Ingestion of 12 Missing 2023 Races...\n');
  for (const r of RACES) {
    await scrapeRace(r);
  }
  console.log('\n✨ ALL 12 MISSING 2023 RACES INGESTED SUCCESSFULLY!');
}

main().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
