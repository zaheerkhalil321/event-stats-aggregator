#!/usr/bin/env node
/**
 * ⚡ HYROX 2025 Historical Backfill & Parity Engine
 * 
 * High-performance, lightweight HTTP ingestor designed for:
 * 1. Missing 33 Races from MikaTiming 'sonstige' groups (Manchester, London Spring, Vancouver, Anaheim, etc.)
 * 2. Incomplete Races (World Championships Chicago Age Groups, Singapore Expo, etc.)
 * 3. Exact TrainRox parity across all 89 races of 2025.
 * 
 * Supports local execution & GitHub Actions cloud runners!
 */

import { createClient } from '@libsql/client';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Database Connection
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

// Map of Known Incomplete & Sonstige 2025 Events
export const KNOWN_2025_TARGETS = [
  // --- CATEGORY A: INCOMPLETE MULTI-DAY RACES ---
  {
    id: 'world-championships-2025',
    name: 'HYROX World Championships Chicago 2025',
    city: 'Chicago',
    country: 'USA',
    season: 'season-7',
    date: '2025-06-12',
    end_date: '2025-06-15',
    category: 'category_a',
    optgroup: '2025 World Championships'
  },
  {
    id: 'singapore-2025',
    name: 'HYROX Singapore Expo 2025',
    city: 'Singapore',
    country: 'SGP',
    season: 'season-8',
    date: '2025-11-29',
    end_date: '2025-11-30',
    category: 'category_a',
    eventCodes: [
      { val: 'HPRO_LR3MS4JI1056', div: 'HYROX PRO', gender: 'M' },
      { val: 'H_LR3MS4JI1056', div: 'HYROX', gender: 'M' },
      { val: 'HDP_LR3MS4JI1056', div: 'HYROX PRO DOUBLES', gender: 'M' },
      { val: 'HD_LR3MS4JI1056', div: 'HYROX DOUBLES', gender: 'M' },
      { val: 'HMR_LR3MS4JI1056', div: 'HYROX TEAM RELAY', gender: 'X' },
      { val: 'HA_LR3MS4JI1056', div: 'HYROX ADAPTIVE', gender: 'M' },
      { val: 'HCR_LR3MS4JI1056', div: 'HYROX CORPORATE RELAY', gender: 'X' }
    ]
  },

  // --- CATEGORY B: MISSING 33 RACES (DISCOVERED IN SONSTIGE) ---
  // Season 7 (Jan - May 2025)
  {
    id: 'manchester-2025',
    name: 'HYROX Manchester 2025',
    city: 'Manchester',
    country: 'GBR',
    season: 'season-7',
    date: '2025-01-24',
    end_date: '2025-01-26',
    category: 'missing_33',
    base: 'JGDMS4JI992'
  },
  {
    id: 'auckland-2025',
    name: 'HYROX Auckland 2025',
    city: 'Auckland',
    country: 'NZL',
    season: 'season-7',
    date: '2025-02-01',
    end_date: '2025-02-02',
    category: 'missing_33',
    base: 'JGDMS4JI98E'
  },
  {
    id: 'maastricht-spring-2025',
    name: 'HYROX Maastricht Spring 2025',
    city: 'Maastricht',
    country: 'NLD',
    season: 'season-7',
    date: '2025-02-01',
    end_date: '2025-02-02',
    category: 'missing_33',
    base: 'JGDMS4JI996'
  },
  {
    id: 'st-gallen-2025',
    name: 'HYROX St. Gallen 2025',
    city: 'St. Gallen',
    country: 'CHE',
    season: 'season-7',
    date: '2025-02-08',
    end_date: '2025-02-09',
    category: 'missing_33',
    base: 'JGDMS4JI998'
  },
  {
    id: 'toulouse-2025',
    name: 'HYROX Toulouse 2025',
    city: 'Toulouse',
    country: 'FRA',
    season: 'season-7',
    date: '2025-02-08',
    end_date: '2025-02-09',
    category: 'missing_33',
    base: 'JGDMS4JI9B1'
  },
  {
    id: 'katowice-2025',
    name: 'HYROX Katowice 2025',
    city: 'Katowice',
    country: 'POL',
    season: 'season-7',
    date: '2025-02-22',
    end_date: '2025-02-23',
    category: 'missing_33',
    base: 'JGDMS4JI98D'
  },
  {
    id: 'vienna-2025',
    name: 'HYROX Vienna 2025',
    city: 'Vienna',
    country: 'AUT',
    season: 'season-7',
    date: '2025-02-22',
    end_date: '2025-02-23',
    category: 'missing_33',
    base: 'JGDMS4JI999'
  },
  {
    id: 'karlsruhe-2025',
    name: 'HYROX Karlsruhe 2025',
    city: 'Karlsruhe',
    country: 'DEU',
    season: 'season-7',
    date: '2025-03-01',
    end_date: '2025-03-02',
    category: 'missing_33',
    base: 'LR3MS4JI9C5'
  },
  {
    id: 'brisbane-2025',
    name: 'HYROX Brisbane 2025',
    city: 'Brisbane',
    country: 'AUS',
    season: 'season-7',
    date: '2025-03-01',
    end_date: '2025-03-02',
    category: 'missing_33',
    base: 'LR3MS4JI9DA'
  },
  {
    id: 'valencia-spring-2025',
    name: 'HYROX Valencia Spring 2025',
    city: 'Valencia',
    country: 'ESP',
    season: 'season-7',
    date: '2025-03-08',
    end_date: '2025-03-09',
    category: 'missing_33',
    optgroup: '2025 Valencia'
  },
  {
    id: 'copenhagen-2025',
    name: 'HYROX Copenhagen 2025',
    city: 'Copenhagen',
    country: 'DNK',
    season: 'season-7',
    date: '2025-03-14',
    end_date: '2025-03-15',
    category: 'missing_33',
    base: 'LR3MS4JIA15'
  },
  {
    id: 'houston-2025',
    name: 'HYROX Houston 2025',
    city: 'Houston',
    country: 'USA',
    season: 'season-7',
    date: '2025-03-15',
    end_date: '2025-03-16',
    category: 'missing_33',
    base: 'LR3MS4JIA19'
  },
  {
    id: 'washington-dc-2025',
    name: 'HYROX Washington D.C. Open 2025',
    city: 'Washington D.C.',
    country: 'USA',
    season: 'season-7',
    date: '2025-03-29',
    end_date: '2025-03-30',
    category: 'missing_33',
    base: 'LR3MS4JIA40'
  },
  {
    id: 'belgium-2025',
    name: 'HYROX Belgium 2025',
    city: 'Mechelen',
    country: 'BEL',
    season: 'season-7',
    date: '2025-04-05',
    end_date: '2025-04-06',
    category: 'missing_33',
    base: 'LR3MS4JIA54'
  },
  {
    id: 'london-spring-2025',
    name: 'HYROX London Spring 2025',
    city: 'London',
    country: 'GBR',
    season: 'season-7',
    date: '2025-05-03',
    end_date: '2025-05-05',
    category: 'missing_33',
    base: 'LR3MS4JIAB7'
  },

  // Season 8 (July - Dec 2025)
  {
    id: 'cape-town-2025',
    name: 'HYROX Cape Town 2025',
    city: 'Cape Town',
    country: 'ZAF',
    season: 'season-8',
    date: '2025-07-19',
    end_date: '2025-07-20',
    category: 'missing_33',
    base: 'LR3MS4JIC31'
  },
  {
    id: 'hong-kong-2025',
    name: 'HYROX Hong Kong 2025',
    city: 'Hong Kong',
    country: 'HKG',
    season: 'season-8',
    date: '2025-07-26',
    end_date: '2025-07-27',
    category: 'missing_33',
    base: 'LR3MS4JIC95'
  },
  {
    id: 'acapulco-2025',
    name: 'HYROX Acapulco 2025',
    city: 'Acapulco',
    country: 'MEX',
    season: 'season-8',
    date: '2025-09-06',
    end_date: '2025-09-07',
    category: 'missing_33',
    base: 'LR3MS4JICFB'
  },
  {
    id: 'seoul-2025',
    name: 'HYROX Seoul 2025',
    city: 'Seoul',
    country: 'KOR',
    season: 'season-8',
    date: '2025-11-08',
    end_date: '2025-11-09',
    category: 'missing_33',
    base: 'LR3MS4JIE3B'
  },
  {
    id: 'dallas-2025',
    name: 'HYROX Dallas 2025',
    city: 'Dallas',
    country: 'USA',
    season: 'season-8',
    date: '2025-11-21',
    end_date: '2025-11-23',
    category: 'missing_33',
    base: 'LR3MS4JIF52'
  },
  {
    id: 'shanghai-fall-2025',
    name: 'HYROX Shanghai Fall 2025',
    city: 'Shanghai',
    country: 'CHN',
    season: 'season-8',
    date: '2025-11-22',
    end_date: '2025-11-23',
    category: 'missing_33',
    base: 'LR3MS4JIFA2'
  },
  {
    id: 'johannesburg-fall-2025',
    name: 'HYROX Johannesburg Fall 2025',
    city: 'Johannesburg',
    country: 'ZAF',
    season: 'season-8',
    date: '2025-11-29',
    end_date: '2025-11-30',
    category: 'missing_33',
    base: 'LR3MS4JI10BA'
  },
  {
    id: 'frankfurt-2025',
    name: 'HYROX Frankfurt 2025',
    city: 'Frankfurt',
    country: 'DEU',
    season: 'season-8',
    date: '2025-12-12',
    end_date: '2025-12-14',
    category: 'missing_33',
    base: 'LR3MS4JIE8B'
  },
  {
    id: 'anaheim-2025',
    name: 'HYROX Anaheim 2025',
    city: 'Anaheim',
    country: 'USA',
    season: 'season-8',
    date: '2025-12-12',
    end_date: '2025-12-14',
    category: 'missing_33',
    base: 'LR3MS4JI11AC'
  },
  {
    id: 'poznan-2025',
    name: 'HYROX Poznań 2025',
    city: 'Poznań',
    country: 'POL',
    season: 'season-8',
    date: '2025-12-13',
    end_date: '2025-12-14',
    category: 'missing_33',
    base: 'LR3MS4JI11E7'
  },
  {
    id: 'shenzhen-2025',
    name: 'HYROX Shenzhen 2025',
    city: 'Shenzhen',
    country: 'CHN',
    season: 'season-8',
    date: '2025-12-20',
    end_date: '2025-12-21',
    category: 'missing_33',
    base: 'LR3MS4JI1223'
  },
  {
    id: 'mumbai-spring-2025',
    name: 'HYROX Mumbai Spring 2025',
    city: 'Mumbai',
    country: 'IND',
    season: 'season-7',
    date: '2025-05-03',
    end_date: '2025-05-03',
    category: 'missing_33',
    optgroup: '2025 Mumbai'
  },
  {
    id: 'paris-spring-2025',
    name: 'HYROX Paris Spring 2025',
    city: 'Paris',
    country: 'FRA',
    season: 'season-7',
    date: '2025-04-18',
    end_date: '2025-04-20',
    category: 'missing_33',
    optgroup: '2025 Paris 1'
  },
  {
    id: 'atlanta-spring-2025',
    name: 'HYROX Atlanta Spring 2025',
    city: 'Atlanta',
    country: 'USA',
    season: 'season-7',
    date: '2025-04-26',
    end_date: '2025-04-27',
    category: 'missing_33',
    optgroup: '2025 Atlanta'
  },
  {
    id: 'rotterdam-spring-2025',
    name: 'HYROX Rotterdam Spring 2025',
    city: 'Rotterdam',
    country: 'NLD',
    season: 'season-7',
    date: '2025-02-27',
    end_date: '2025-03-02',
    category: 'missing_33',
    optgroup: '2025 Rotterdam'
  },
  {
    id: 'boston-2025',
    name: 'HYROX Boston 2025',
    city: 'Boston',
    country: 'USA',
    season: 'season-8',
    date: '2025-09-26',
    end_date: '2025-09-29',
    category: 'missing_33',
    optgroup: '2025 Boston'
  },
  {
    id: 'singapore-asia-open-2025',
    name: 'HYROX Singapore Asia Open 2025',
    city: 'Singapore',
    country: 'SGP',
    season: 'season-8',
    date: '2025-06-28',
    end_date: '2025-06-29',
    category: 'missing_33',
    optgroup: '2025 Singapore'
  },
  {
    id: 'vancouver-2025',
    name: 'HYROX Vancouver 2025',
    city: 'Vancouver',
    country: 'CAN',
    season: 'season-8',
    date: '2025-12-20',
    end_date: '2025-12-21',
    category: 'missing_33',
    base: 'LR3MS4JI120E'
  }
];

// Helper: Fetch event options for a given optgroup label from MikaTiming
async function getOptionsForOptgroup(season, optgroupLabel) {
  const url = `https://hyrox.r.mikatiming.com/${season}/?pid=list`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();

  const groups = html.split(/<optgroup\s+/i);
  const targetLabel = optgroupLabel.toLowerCase().trim();

  for (let i = 1; i < groups.length; i++) {
    const chunk = groups[i];
    const labelMatch = chunk.match(/label="([^"]*)"/i);
    if (!labelMatch) continue;
    const label = labelMatch[1].toLowerCase().trim();
    if (label.includes(targetLabel) || targetLabel.includes(label)) {
      const endIdx = chunk.indexOf('</optgroup>');
      const innerHtml = endIdx !== -1 ? chunk.slice(0, endIdx) : chunk;
      return [...innerHtml.matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)]
        .map(m => ({ val: m[1], name: m[2].trim() }));
    }
  }
  return [];
}

// Helper: Fetch event options for a given base from MikaTiming sonstige
async function getOptionsForBase(season, base) {
  const url = `https://hyrox.r.mikatiming.com/${season}/?pid=list`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const sonstigeMatch = html.match(/<optgroup[^>]*label=\"sonstige\"[^>]*>([\s\S]*?)<\/optgroup>/i);
  if (!sonstigeMatch) return [];

  const opts = [...sonstigeMatch[1].matchAll(/<option[^>]*value=\"([^\"]*)\"[^>]*>([\s\S]*?)<\/option>/gi)]
    .map(m => ({ val: m[1], name: m[2].trim() }));

  return opts.filter(o => o.val.includes(base) || (base === 'OVERALL' && o.val.includes('VALENCIA25_OVERALL')));
}

// Scrape athletes with pagination for a single option
async function scrapeOptionAthletes(season, eventValue, sexFilter, raceId, divisionLabel, defaultGender) {
  const athletes = [];
  const seenInOption = new Set();
  let page = 1;
  const numResults = 100;

  while (page <= 250) {
    let url = `https://hyrox.r.mikatiming.com/${season}/?event=${encodeURIComponent(eventValue)}&num_results=${numResults}&page=${page}&pid=list`;
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
        await sleep(400 * attempt);
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
        gender: sexFilter || defaultGender || 'M',
        age_group: ageMatch ? ageMatch[1].trim() : null,
        division: divisionLabel,
        total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
        overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
      });
      countOnPage++;
    }

    if (countOnPage === 0) break;
    const hasNext = html.includes('&gt;') && !html.includes('pages-nav-button disabled');
    if (!hasNext) break;
    page++;
    await sleep(100);
  }

  return athletes;
}

// Upsert chunk into Turso DB
async function upsertAthletesBatch(athletes) {
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
      console.error('      ❌ Batch upsert error:', e.message);
    }
  }

  return totalInserted;
}

// Upsert race header
async function upsertRaceHeader(race) {
  const countryCode = race.country_code || race.country || 'XX';
  const countryName = race.country_name || race.country || 'International';

  const sql = `
    INSERT INTO hyrox_races (
      id, name, city, country, country_code, season, status, date, end_date, athletes_count
    ) VALUES (
      ${esc(race.id)}, ${esc(race.name)}, ${esc(race.city)}, ${esc(countryName)}, ${esc(countryCode)},
      ${esc(race.season)}, 'completed', ${esc(race.date)}, ${esc(race.end_date)}, 0
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      city = EXCLUDED.city,
      country = EXCLUDED.country,
      country_code = EXCLUDED.country_code,
      season = EXCLUDED.season,
      status = 'completed',
      date = EXCLUDED.date,
      end_date = EXCLUDED.end_date;
  `;
  try {
    await client.execute(sql);
  } catch (e) {
    console.error(`      ❌ Header upsert error for ${race.id}:`, e.message);
  }
}

// Recalculate attendance & update header
async function recalculateRaceTotal(raceId) {
  try {
    const res = await client.execute(`
      SELECT division, COUNT(*) as cnt
      FROM hyrox_athlete_results
      WHERE race_id = ${esc(raceId)}
      GROUP BY division
    `);

    let totalAttendance = 0;
    for (const r of res.rows) {
      const div = String(r.division || '').toLowerCase();
      const count = Number(r.cnt);
      if (div.includes('doubles')) totalAttendance += count * 2;
      else if (div.includes('relay')) totalAttendance += count * 4;
      else totalAttendance += count;
    }

    await client.execute(`
      UPDATE hyrox_races
      SET athletes_count = ${totalAttendance},
          status = 'completed'
      WHERE id = ${esc(raceId)}
    `);

    console.log(`   🏁 Race ${raceId} attendance updated: ${totalAttendance} calculated athletes.`);
    return totalAttendance;
  } catch (e) {
    console.error(`   ❌ Failed to recalculate total for ${raceId}:`, e.message);
    return 0;
  }
}

// Scrape an individual race
async function processRace(race) {
  console.log(`\n======================================================`);
  console.log(`🚀 INGESTING: ${race.name} [ID: ${race.id}] (${race.season})`);
  console.log(`======================================================`);

  await upsertRaceHeader(race);

  let optionsToScrape = [];

  if (race.eventCodes) {
    // Specific pre-mapped event codes (Category A)
    for (const ec of race.eventCodes) {
      if (ec.div.includes('DOUBLES') || ec.div.includes('RELAY')) {
        optionsToScrape.push({ val: ec.val, div: ec.div, sex: 'M', gender: 'M' });
        optionsToScrape.push({ val: ec.val, div: ec.div, sex: 'W', gender: 'F' });
        optionsToScrape.push({ val: ec.val, div: ec.div, sex: 'X', gender: 'X' });
      } else {
        optionsToScrape.push({ val: ec.val, div: `${ec.div} MEN`, sex: 'M', gender: 'M' });
        optionsToScrape.push({ val: ec.val, div: `${ec.div} WOMEN`, sex: 'W', gender: 'F' });
      }
    }
  } else if (race.base) {
    // Discovered base in sonstige
    const opts = await getOptionsForBase(race.season, race.base);
    console.log(`   🔍 Discovered ${opts.length} options for base ${race.base}`);
    for (const opt of opts) {
      const name = opt.name.toUpperCase();
      if (name.includes('DOUBLES') || name.includes('RELAY')) {
        optionsToScrape.push({ val: opt.val, div: opt.name, sex: 'M', gender: 'M' });
        optionsToScrape.push({ val: opt.val, div: opt.name, sex: 'W', gender: 'F' });
        optionsToScrape.push({ val: opt.val, div: opt.name, sex: 'X', gender: 'X' });
      } else {
        optionsToScrape.push({ val: opt.val, div: `${opt.name} MEN`, sex: 'M', gender: 'M' });
        optionsToScrape.push({ val: opt.val, div: `${opt.name} WOMEN`, sex: 'W', gender: 'F' });
      }
    }
  } else if (race.optgroup) {
    // Discovered optgroup
    const opts = await getOptionsForOptgroup(race.season, race.optgroup);
    console.log(`   🔍 Discovered ${opts.length} options for optgroup "${race.optgroup}"`);
    for (const opt of opts) {
      const name = opt.name.toUpperCase();
      if (name.includes('DOUBLES') || name.includes('RELAY')) {
        optionsToScrape.push({ val: opt.val, div: opt.name, sex: 'M', gender: 'M' });
        optionsToScrape.push({ val: opt.val, div: opt.name, sex: 'W', gender: 'F' });
        optionsToScrape.push({ val: opt.val, div: opt.name, sex: 'X', gender: 'X' });
      } else {
        optionsToScrape.push({ val: opt.val, div: `${opt.name} MEN`, sex: 'M', gender: 'M' });
        optionsToScrape.push({ val: opt.val, div: `${opt.name} WOMEN`, sex: 'W', gender: 'F' });
      }
    }
  }

  let totalRaceAthletes = 0;
  for (const item of optionsToScrape) {
    const athletes = await scrapeOptionAthletes(
      race.season,
      item.val,
      item.sex,
      race.id,
      item.div,
      item.gender
    );

    if (athletes.length > 0) {
      const saved = await upsertAthletesBatch(athletes);
      console.log(`   ✅ [${item.val}] ${item.div} (${item.sex || 'ALL'}): scraped ${athletes.length} (saved: ${saved})`);
      totalRaceAthletes += athletes.length;
    }
  }

  const finalAttendance = await recalculateRaceTotal(race.id);
  console.log(`✨ Completed ${race.name} -> Scraped ${totalRaceAthletes} rows | Final Attendance: ${finalAttendance}`);
}

// Main Runner
async function main() {
  const args = process.argv.slice(2);
  const targetArg = args.find(a => a.startsWith('--target='))?.split('=')[1]
    || (args.includes('--target') ? args[args.indexOf('--target') + 1] : 'missing_33');
  const raceArg = args.find(a => a.startsWith('--race='))?.split('=')[1]
    || (args.includes('--race') ? args[args.indexOf('--race') + 1] : null);

  console.log(`\n======================================================`);
  console.log(`  ⚡ HYROX 2025 Historical Backfill Engine`);
  console.log(`  🎯 Target: ${targetArg} ${raceArg ? `(Race: ${raceArg})` : ''}`);
  console.log(`  🕒 Time: ${new Date().toISOString()}`);
  console.log(`======================================================\n`);

  let targets = [];

  if (raceArg) {
    const match = KNOWN_2025_TARGETS.find(r => r.id === raceArg || r.id.includes(raceArg));
    if (!match) {
      console.error(`❌ Race ${raceArg} not found in KNOWN_2025_TARGETS.`);
      process.exit(1);
    }
    targets = [match];
  } else if (targetArg === 'final_8' || targetArg === 'pending_8') {
    const finalIds = ['mumbai-spring-2025', 'rotterdam-spring-2025', 'paris-spring-2025', 'atlanta-spring-2025', 'boston-2025', 'singapore-asia-open-2025', 'valencia-spring-2025', 'world-championships-2025'];
    targets = KNOWN_2025_TARGETS.filter(r => finalIds.includes(r.id));
  } else if (targetArg === 'missing_33' || targetArg === 'missing_races') {
    targets = KNOWN_2025_TARGETS.filter(r => r.category === 'missing_33');
  } else if (targetArg === 'category_a' || targetArg === 'incomplete_races') {
    targets = KNOWN_2025_TARGETS.filter(r => r.category === 'category_a');
  } else if (targetArg === 'all_2025' || targetArg === 'all') {
    targets = KNOWN_2025_TARGETS;
  } else {
    console.error(`❌ Unknown target: ${targetArg}`);
    process.exit(1);
  }

  console.log(`📋 Queued ${targets.length} races for processing...`);

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    console.log(`\n[${i + 1}/${targets.length}] Starting ${t.name}...`);
    try {
      await processRace(t);
    } catch (e) {
      console.error(`❌ Error processing ${t.name}:`, e.message);
    }
  }

  console.log(`\n🎉 All targeted races processed successfully!`);
}

const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isMain) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
