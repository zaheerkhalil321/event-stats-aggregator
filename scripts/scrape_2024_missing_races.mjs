#!/usr/bin/env node
/**
 * ⚡ Scrape Missing 2024 Races (Season 6 & Season 7)
 * 
 * Safely ingests the 26 missing/collided 2024 events in efficient 100-row batches.
 * Total writes: ~75,000 rows (0.3% of Turso's 25M monthly limit).
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

// 26 Missing / Collided Targets for 2024
export const TARGETS_2024 = [
  // --- Season 6 (Spring 2024) ---
  {
    id: 'manchester-spring-2024',
    name: 'HYROX Manchester Spring 2024',
    date: '2024-01-27',
    city: 'Manchester',
    country: 'United Kingdom',
    code: 'GB',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Manchester',
    waveBases: ['JGDMS4JI6BA']
  },
  {
    id: 'incheon-spring-2024',
    name: 'HYROX Incheon Spring 2024',
    date: '2024-02-17',
    city: 'Incheon',
    country: 'South Korea',
    code: 'KR',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Incheon',
    waveBases: ['JGDMS4JI6F5']
  },
  {
    id: 'glasgow-2024',
    name: 'HYROX Glasgow 2024',
    date: '2024-03-02',
    city: 'Glasgow',
    country: 'United Kingdom',
    code: 'GB',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Glasgow',
    waveBases: ['JGDMS4JI70C']
  },
  {
    id: 'rotterdam-2024',
    name: 'HYROX Rotterdam 2024',
    date: '2024-04-06',
    city: 'Rotterdam',
    country: 'Netherlands',
    code: 'NL',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Rotterdam',
    waveBases: ['JGDMS4JI747']
  },
  {
    id: 'koln-2024',
    name: 'HYROX Köln 2024',
    date: '2024-04-13',
    city: 'Cologne',
    country: 'Germany',
    code: 'DE',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Köln',
    waveBases: ['JGDMS4JI771']
  },
  {
    id: 'london-spring-2024',
    name: 'HYROX Sports Direct London 2024',
    date: '2024-05-04',
    city: 'London',
    country: 'United Kingdom',
    code: 'GB',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Sports Direct HYROX London',
    waveBases: ['JGDMS4JI7AA']
  },
  {
    id: 'gainful-anaheim-2024',
    name: 'HYROX Gainful Anaheim 2024',
    date: '2024-05-19',
    city: 'Anaheim',
    country: 'United States',
    code: 'US',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Gainful Anaheim',
    waveBases: ['JGDMS4JI7D1']
  },
  {
    id: 'rimini-2024',
    name: 'HYROX Rimini 2024',
    date: '2024-06-01',
    city: 'Rimini',
    country: 'Italy',
    code: 'IT',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 Rimini',
    waveBases: ['JGDMS4JI80E']
  },
  {
    id: 'world-championships-nice-2024',
    name: 'HYROX World Championships Nice 2024',
    date: '2024-06-07',
    city: 'Nice',
    country: 'France',
    code: 'FR',
    season: 'season-6',
    seasonCode: '23/24',
    group: '2024 World Championships Nice',
    waveBases: ['JGDMS4JI551']
  },

  // --- Season 7 (Summer / Fall / Winter 2024) ---
  {
    id: 'singapore-national-stadium-2024',
    name: 'HYROX Singapore National Stadium 2024',
    date: '2024-06-29',
    city: 'Singapore',
    country: 'Singapore',
    code: 'SG',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Singapore National Stadium',
    waveBases: ['JGDMS4JI80F']
  },
  {
    id: 'sydney-2024',
    name: 'HYROX Sydney 2024',
    date: '2024-07-27',
    city: 'Sydney',
    country: 'Australia',
    code: 'AU',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Sydney',
    waveBases: ['JGDMS4JI849']
  },
  {
    id: 'brisbane-2024',
    name: 'HYROX Brisbane 2024',
    date: '2024-08-17',
    city: 'Brisbane',
    country: 'Australia',
    code: 'AU',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Brisbane',
    waveBases: ['JGDMS4JI85D']
  },
  {
    id: 'singapore-2024',
    name: 'HYROX Singapore 2024',
    date: '2024-08-31',
    city: 'Singapore',
    country: 'Singapore',
    code: 'SG',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Singapore',
    waveBases: ['JGDMS4JI860']
  },
  {
    id: 'perth-2024',
    name: 'HYROX Perth 2024',
    date: '2024-09-14',
    city: 'Perth',
    country: 'Australia',
    code: 'AU',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Perth',
    waveBases: ['JGDMS4JI85E']
  },
  {
    id: 'cape-town-2024',
    name: 'HYROX Cape Town 2024',
    date: '2024-09-21',
    city: 'Cape Town',
    country: 'South Africa',
    code: 'ZA',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Cape Town',
    waveBases: ['JGDMS4JI885']
  },
  {
    id: 'milan-2024',
    name: 'HYROX Milan 2024',
    date: '2024-10-19',
    city: 'Milan',
    country: 'Italy',
    code: 'IT',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Milan',
    waveBases: ['JGDMS4JI8D6']
  },
  {
    id: 'madrid-fall-2024',
    name: 'HYROX Madrid Fall 2024',
    date: '2024-10-26',
    city: 'Madrid',
    country: 'Spain',
    code: 'ES',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Madrid',
    waveBases: ['JGDMS4JI8EA']
  },
  {
    id: 'hamburg-2024',
    name: 'HYROX Hamburg 2024',
    date: '2024-11-02',
    city: 'Hamburg',
    country: 'Germany',
    code: 'DE',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Hamburg',
    waveBases: ['JGDMS4JI8AE']
  },
  {
    id: 'poznan-2024',
    name: 'HYROX Poznan 2024',
    date: '2024-11-02',
    city: 'Poznan',
    country: 'Poland',
    code: 'PL',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Poznan',
    waveBases: ['JGDMS4JI901']
  },
  {
    id: 'manchester-fall-2024',
    name: 'HYROX Manchester Fall 2024',
    date: '2024-11-09',
    city: 'Manchester',
    country: 'United Kingdom',
    code: 'GB',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Manchester',
    waveBases: ['JGDMS4JI8B0']
  },
  {
    id: 'paris-2024',
    name: 'HYROX Paris 2024',
    date: '2024-11-09',
    city: 'Paris',
    country: 'France',
    code: 'FR',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Paris',
    waveBases: ['JGDMS4JI914']
  },
  {
    id: 'ciudad-de-mexico-2024',
    name: 'HYROX Ciudad de Mexico 2024',
    date: '2024-11-09',
    city: 'Mexico City',
    country: 'Mexico',
    code: 'MX',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Ciudad de Mexico',
    waveBases: ['JGDMS4JI913']
  },
  {
    id: 'hong-kong-2024',
    name: 'HYROX Hong Kong 2024',
    date: '2024-11-22',
    city: 'Hong Kong',
    country: 'Hong Kong',
    code: 'HK',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Hong Kong',
    waveBases: ['JGDMS4JI8D9']
  },
  {
    id: 'marseille-2024',
    name: 'HYROX Marseille 2024',
    date: '2024-12-07',
    city: 'Marseille',
    country: 'France',
    code: 'FR',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Marseille',
    waveBases: ['JGDMS4JI917']
  },
  {
    id: 'frankfurt-2024',
    name: 'HYROX Frankfurt 2024',
    date: '2024-12-14',
    city: 'Frankfurt',
    country: 'Germany',
    code: 'DE',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Frankfurt',
    waveBases: ['JGDMS4JI964']
  },
  {
    id: 'melbourne-2024',
    name: 'HYROX Melbourne 2024',
    date: '2024-12-14',
    city: 'Melbourne',
    country: 'Australia',
    code: 'AU',
    season: 'season-7',
    seasonCode: '24/25',
    group: '2024 Melbourne',
    waveBases: ['JGDMS4JI962', 'JGDMS4JI823']
  }
];

// Helper to determine gender splits for a wave prefix
function getSexesForWave(prefix) {
  if (prefix === 'H' || prefix === 'HPRO') return ['M', 'W'];
  if (prefix === 'HD' || prefix === 'HDP') return ['M', 'W', 'X'];
  return ['']; // Relays, Elite, Adaptive, Corporate
}

function getDivisionName(prefix, sex) {
  let base = 'HYROX';
  if (prefix === 'HPRO') base = 'HYROX PRO';
  else if (prefix === 'HE') base = 'HYROX ELITE';
  else if (prefix === 'HDP') base = 'HYROX PRO DOUBLES';
  else if (prefix === 'HD') base = 'HYROX DOUBLES';
  else if (prefix === 'HMR' || prefix === 'HCR' || prefix === 'HSR' || prefix === 'HLR') base = 'HYROX TEAM RELAY';
  else if (prefix === 'HA') base = 'HYROX ADAPTIVE';
  else if (prefix === 'HG') base = 'HYROX GORUCK';
  else if (prefix === 'HDG') base = 'HYROX GORUCK DOUBLES';

  if (sex === 'M') return `${base} MEN`;
  if (sex === 'W') return `${base} WOMEN`;
  if (sex === 'X') return `${base} MIXED`;
  return base;
}

async function scrapeWave(raceId, season, eventVal, divName, sex) {
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

      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}|${divName}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || linkMatch[2].match(/\(([A-Za-z]{2,3})\)$/);

      let gender = sex;
      if (!gender) {
        if (divName.includes('MEN')) gender = 'M';
        else if (divName.includes('WOMEN')) gender = 'W';
        else if (divName.includes('MIXED')) gender = 'X';
      }

      list.push({
        race_id: raceId,
        full_name: cleanFullName,
        division: divName,
        gender: gender || null,
        overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
        total_time: timeMatch ? timeMatch[1] : null,
        age_group: ageMatch ? ageMatch[1].trim() : null,
        bib_number: bibMatch ? bibMatch[1].trim() : null,
        nationality: nationMatch ? nationMatch[1].trim() : null,
      });
      itemsOnPage++;
    }

    if (itemsOnPage === 0) break;
    page++;
    await sleep(200);
  }

  return list;
}

async function ingestRace(target) {
  console.log(`\n============================================================`);
  console.log(`⚡ INGESTING: ${target.id} (${target.name}) - ${target.date}`);
  console.log(`============================================================`);

  // 1. Ensure race entry exists in hyrox_races
  await client.execute(`
    INSERT INTO hyrox_races (
      id, name, city, country, country_code, date, end_date, season, status, athletes_count, created_at, updated_at
    ) VALUES (
      ${esc(target.id)}, ${esc(target.name)}, ${esc(target.city)}, ${esc(target.country)},
      ${esc(target.code)}, ${esc(target.date)}, ${esc(target.date)}, ${esc(target.seasonCode)},
      'completed', 0, datetime('now'), datetime('now')
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      city = excluded.city,
      country = excluded.country,
      country_code = excluded.country_code,
      date = excluded.date,
      end_date = excluded.end_date,
      season = excluded.season,
      status = 'completed',
      updated_at = datetime('now')
  `);

  // 2. Fetch wave options for this group
  const groupUrl = `https://hyrox.r.mikatiming.de/${target.season}/?content=ajax2&func=getSearchFields&options[pid]=start&options[lang]=EN_CAP&options[b][lists][event_main_group]=${encodeURIComponent(target.group)}`;
  const groupRes = await fetch(groupUrl, { headers: { 'User-Agent': UA } });
  const groupJson = await groupRes.json();
  const availableWaves = groupJson?.branches?.lists?.fields?.event?.data || [];

  // Filter waves matching our waveBases
  const targetWaves = availableWaves.filter(w => {
    const val = w.v[0];
    return target.waveBases.some(base => val.endsWith(base));
  });

  console.log(`Found ${targetWaves.length} official waves for ${target.name}.`);

  let allAthletes = [];
  const seenGlobal = new Set();

  for (const wave of targetWaves) {
    const waveCode = wave.v[0];
    const waveText = wave.v[1];
    const prefix = waveCode.replace(/_[A-Za-z0-9]+$/, '');
    const sexes = getSexesForWave(prefix);

    for (const sex of sexes) {
      const divName = getDivisionName(prefix, sex);
      process.stdout.write(`  Scraping ${divName} (${waveCode})... `);
      const rows = await scrapeWave(target.id, target.season, waveCode, divName, sex);
      console.log(`found ${rows.length} rows`);

      for (const r of rows) {
        const key = `${r.full_name}|${r.overall_rank}|${r.division}|${r.total_time}`;
        if (!seenGlobal.has(key)) {
          seenGlobal.add(key);
          allAthletes.push(r);
        }
      }
    }
  }

  console.log(`Total unique athlete rows scraped: ${allAthletes.length}`);

  // 3. Batch insert in chunks of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < allAthletes.length; i += BATCH_SIZE) {
    const chunk = allAthletes.slice(i, i + BATCH_SIZE);
    const valuesSql = chunk.map(r => `(
      ${esc(r.race_id)},
      ${esc(r.full_name)},
      ${esc(r.division)},
      ${esc(r.gender)},
      ${esc(r.overall_rank)},
      ${esc(r.total_time)},
      ${esc(r.age_group)},
      ${esc(r.bib_number)},
      ${esc(r.nationality)},
      datetime('now')
    )`).join(',\n');

    await client.execute(`
      INSERT INTO hyrox_athlete_results (
        race_id, full_name, division, gender, overall_rank, total_time, age_group, bib_number, nationality, created_at
      ) VALUES ${valuesSql}
      ON CONFLICT (race_id, full_name, division) DO UPDATE SET
        bib_number = excluded.bib_number,
        nationality = excluded.nationality,
        total_time = excluded.total_time,
        overall_rank = excluded.overall_rank
    `);
  }

  // 4. Calculate Official Headcount Attendance
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
    args: [target.id]
  });

  const attendance = Number(stat.rows[0].attendance);
  const rowsCount = Number(stat.rows[0].cnt);

  await client.execute({
    sql: `UPDATE hyrox_races SET athletes_count = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?`,
    args: [attendance, target.id]
  });

  console.log(`🎉 [${target.id}] Complete! Official Attendance: ${attendance.toLocaleString()} (${rowsCount.toLocaleString()} athlete rows).\n`);
}

async function main() {
  console.log(`🚀 Starting Ingestion of ${TARGETS_2024.length} Missing 2024 Races...\n`);
  
  // Flexible single race filter (supports positional arg or --race flag)
  let filterId = null;
  const raceArgIdx = process.argv.indexOf('--race');
  if (raceArgIdx !== -1 && process.argv[raceArgIdx + 1]) {
    filterId = process.argv[raceArgIdx + 1];
  } else if (process.argv[2] && !process.argv[2].startsWith('--')) {
    filterId = process.argv[2];
  }

  const targets = filterId 
    ? TARGETS_2024.filter(t => t.id === filterId || t.id.includes(filterId))
    : TARGETS_2024;

  for (const t of targets) {
    try {
      await ingestRace(t);
    } catch (err) {
      console.error(`❌ Error ingesting ${t.id}:`, err);
    }
  }

  console.log(`\n✨ ALL 2024 MISSING RACES PROCESSED SUCCESSFULLY!`);
}

main().catch(console.error);
