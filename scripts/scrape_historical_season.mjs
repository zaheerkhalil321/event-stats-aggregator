#!/usr/bin/env node
/**
 * ⚡ HYROX Historical Seasons Ingestor & Backfill Engine
 * 
 * Supports:
 *   - season-6 (2023/2024)
 *   - season-5 (2022/2023)
 *   - season-4 (2021/2022)
 *   - all historical seasons
 * 
 * High performance HTTP fetch with batching, dedup shields, and Turso Cloud integration.
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

const COUNTRY_MAP = {
  'gdansk': { city: 'Gdansk', country: 'Poland', code: 'PL' },
  'taipei': { city: 'Taipei', country: 'Taiwan', code: 'TW' },
  'anaheim': { city: 'Anaheim', country: 'United States', code: 'US' },
  'doha': { city: 'Doha', country: 'Qatar', code: 'QA' },
  'bordeaux': { city: 'Bordeaux', country: 'France', code: 'FR' },
  'berlin': { city: 'Berlin', country: 'Germany', code: 'DE' },
  'mexico-city': { city: 'Mexico City', country: 'Mexico', code: 'MX' },
  'malaga': { city: 'Malaga', country: 'Spain', code: 'ES' },
  'copenhagen': { city: 'Copenhagen', country: 'Denmark', code: 'DK' },
  'houston': { city: 'Houston', country: 'United States', code: 'US' },
  'karlsruhe': { city: 'Karlsruhe', country: 'Germany', code: 'DE' },
  'madrid': { city: 'Madrid', country: 'Spain', code: 'ES' },
  'washington': { city: 'Washington', country: 'United States', code: 'US' },
  'fort-lauderdale': { city: 'Fort Lauderdale', country: 'United States', code: 'US' },
  'katowice': { city: 'Katowice', country: 'Poland', code: 'PL' },
  'incheon': { city: 'Incheon', country: 'South Korea', code: 'KR' },
  'bilbao': { city: 'Bilbao', country: 'Spain', code: 'ES' },
  'dubai': { city: 'Dubai', country: 'United Arab Emirates', code: 'AE' },
  'vienna': { city: 'Vienna', country: 'Austria', code: 'AT' },
  'turin': { city: 'Turin', country: 'Italy', code: 'IT' },
  'maastricht': { city: 'Maastricht', country: 'Netherlands', code: 'NL' },
  'los-angeles': { city: 'Los Angeles', country: 'United States', code: 'US' },
  'frankfurt': { city: 'Frankfurt', country: 'Germany', code: 'DE' },
  'stockholm': { city: 'Stockholm', country: 'Sweden', code: 'SE' },
  'dallas': { city: 'Dallas', country: 'United States', code: 'US' },
  'barcelona': { city: 'Barcelona', country: 'Spain', code: 'ES' },
  'hamburg': { city: 'Hamburg', country: 'Germany', code: 'DE' },
  'chicago': { city: 'Chicago', country: 'United States', code: 'US' },
  'paris': { city: 'Paris', country: 'France', code: 'FR' },
  'amsterdam': { city: 'Amsterdam', country: 'Netherlands', code: 'NL' },
  'dublin': { city: 'Dublin', country: 'Ireland', code: 'IE' },
  'valencia': { city: 'Valencia', country: 'Spain', code: 'ES' },
  'munchen': { city: 'Munich', country: 'Germany', code: 'DE' },
  'singapore': { city: 'Singapore', country: 'Singapore', code: 'SG' },
  'milan': { city: 'Milan', country: 'Italy', code: 'IT' },
  'malmo': { city: 'Malmo', country: 'Sweden', code: 'SE' },
  'warschau': { city: 'Warsaw', country: 'Poland', code: 'PL' },
  'melbourne': { city: 'Melbourne', country: 'Australia', code: 'AU' },
  'sydney': { city: 'Sydney', country: 'Australia', code: 'AU' },
  'rotterdam': { city: 'Rotterdam', country: 'Netherlands', code: 'NL' },
  'manchester': { city: 'Manchester', country: 'United Kingdom', code: 'GB' },
  'hannover': { city: 'Hannover', country: 'Germany', code: 'DE' },
  'miami': { city: 'Miami', country: 'United States', code: 'US' },
  'wien': { city: 'Vienna', country: 'Austria', code: 'AT' },
  'glasgow': { city: 'Glasgow', country: 'United Kingdom', code: 'GB' },
  'stuttgart': { city: 'Stuttgart', country: 'Germany', code: 'DE' },
  'london': { city: 'London', country: 'United Kingdom', code: 'GB' },
  'essen': { city: 'Essen', country: 'Germany', code: 'DE' },
  'birmingham': { city: 'Birmingham', country: 'United Kingdom', code: 'GB' },
  'leipzig': { city: 'Leipzig', country: 'Germany', code: 'DE' },
  'new-york': { city: 'New York', country: 'United States', code: 'US' },
  'basel': { city: 'Basel', country: 'Switzerland', code: 'CH' },
  'las-vegas': { city: 'Las Vegas', country: 'United States', code: 'US' },
  'bremen': { city: 'Bremen', country: 'Germany', code: 'DE' },
};

function parseOptgroupLabel(label, seasonSlug) {
  // Examples: '2024 Gdansk', '2024 Washington - North American Championships', '2023 World Championships Manchester'
  let clean = label.trim();
  const yearMatch = clean.match(/^(\d{4})\s+(.+)/);
  let year = yearMatch ? yearMatch[1] : (seasonSlug === 'season-6' ? '2024' : seasonSlug === 'season-5' ? '2023' : '2022');
  let rawName = yearMatch ? yearMatch[2] : clean;

  // Normalize slug
  let slugBase = rawName.toLowerCase()
    .replace(/\s*-\s*.+/, '') // remove suffix like '- European Championship'
    .replace(/world\s+championships?\s*/i, '')
    .replace(/gainful\s*/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (rawName.toLowerCase().includes('world championships') || clean.toLowerCase().includes('worldchampionship')) {
    slugBase = `${slugBase}-world-championships`.replace(/^-+/, '');
  }

  const raceId = `${slugBase}-${year}`;
  const raceName = `HYROX ${rawName} ${year}`.replace(/\s+/g, ' ').trim();

  // Country metadata
  let meta = COUNTRY_MAP[slugBase] || { city: rawName.split(' ')[0], country: 'International', code: 'XX' };

  let seasonCode = '23/24';
  if (seasonSlug === 'season-5') seasonCode = '22/23';
  if (seasonSlug === 'season-4') seasonCode = '21/22';

  return {
    id: raceId,
    name: raceName,
    city: meta.city,
    country: meta.country,
    country_code: meta.code,
    date: `${year}-12-31`,
    end_date: `${year}-12-31`,
    season: seasonCode,
    optgroupLabel: label,
  };
}

async function scrapeWave(raceId, seasonSlug, eventVal, waveLabel, sex) {
  let baseLabel = waveLabel.replace(/\s*-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i, '').trim();
  let divLabel = baseLabel;
  if (sex === 'M') divLabel = `${baseLabel} MEN`;
  else if (sex === 'W') divLabel = `${baseLabel} WOMEN`;
  else if (sex === 'X') divLabel = `${baseLabel} MIXED`;
  divLabel = divLabel.toUpperCase().trim();

  const sexParam = sex ? `&search[sex]=${sex}` : '';
  let page = 1;
  const list = [];
  const seen = new Set();

  while (page <= 50) {
    const url = `https://hyrox.r.mikatiming.de/${seasonSlug}/?event=${eventVal}&num_results=100&page=${page}&pid=list${sexParam}`;
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

      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}`;
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
        division: divLabel,
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
    await sleep(100);
  }

  return list;
}

async function scrapeRace(raceMeta, options, seasonSlug) {
  console.log(`\n============================================================`);
  console.log(`⚡ INGESTING: ${raceMeta.id} (${raceMeta.name})`);
  console.log(`============================================================`);

  // 1. Insert Race Header if not exists
  await client.execute(`
    INSERT INTO hyrox_races (
      id, name, city, country, country_code, date, end_date, season, status, athletes_count, created_at, updated_at
    ) VALUES (
      ${esc(raceMeta.id)}, ${esc(raceMeta.name)}, ${esc(raceMeta.city)}, ${esc(raceMeta.country)},
      ${esc(raceMeta.country_code)}, ${esc(raceMeta.date)}, ${esc(raceMeta.end_date)}, ${esc(raceMeta.season)},
      'completed', 0, datetime('now'), datetime('now')
    )
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name,
      city = excluded.city,
      country = excluded.country,
      season = excluded.season,
      status = 'completed',
      updated_at = datetime('now')
  `);

  let totalRows = 0;

  for (const opt of options) {
    if (opt.text.toLowerCase().includes('overall')) continue;

    for (const sex of ['M', 'W', 'X']) {
      const rows = await scrapeWave(raceMeta.id, seasonSlug, opt.val, opt.text, sex);
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
            total_time = excluded.total_time,
            overall_rank = excluded.overall_rank,
            bib_number = COALESCE(excluded.bib_number, hyrox_athlete_results.bib_number),
            nationality = CASE WHEN excluded.nationality != 'XX' THEN excluded.nationality ELSE hyrox_athlete_results.nationality END
        `);
      }

      totalRows += rows.length;
      console.log(`   ✅ ${opt.text} (${sex}): ${rows.length} rows`);
    }
  }

  // 2. Automated Shields: Open/Pro clones and Weekday remnants
  await client.execute(`
    DELETE FROM hyrox_athlete_results
    WHERE race_id = ${esc(raceMeta.id)}
      AND division IN ('HYROX MEN', 'HYROX WOMEN')
      AND id IN (
        SELECT a_open.id
        FROM hyrox_athlete_results a_open
        JOIN hyrox_athlete_results a_pro
          ON a_open.race_id = a_pro.race_id
         AND a_open.full_name = a_pro.full_name
         AND a_open.total_time = a_pro.total_time
         AND a_open.overall_rank = a_pro.overall_rank
        WHERE a_open.race_id = ${esc(raceMeta.id)}
          AND a_open.division IN ('HYROX MEN', 'HYROX WOMEN')
          AND a_pro.division IN ('HYROX PRO MEN', 'HYROX PRO WOMEN')
          AND a_open.id != a_pro.id
      )
  `);

  await client.execute(`
    DELETE FROM hyrox_athlete_results
    WHERE race_id = ${esc(raceMeta.id)}
      AND (
        division LIKE '% - MONDAY %' OR division LIKE '% - MONDAY'
        OR division LIKE '% - TUESDAY %' OR division LIKE '% - TUESDAY'
        OR division LIKE '% - WEDNESDAY %' OR division LIKE '% - WEDNESDAY'
        OR division LIKE '% - THURSDAY %' OR division LIKE '% - THURSDAY'
        OR division LIKE '% - FRIDAY %' OR division LIKE '% - FRIDAY'
        OR division LIKE '% - SATURDAY %' OR division LIKE '% - SATURDAY'
        OR division LIKE '% - SUNDAY %' OR division LIKE '% - SUNDAY'
      )
  `);

  // 3. Final Attendance Calculation
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
    args: [raceMeta.id]
  });

  const attendance = Number(stat.rows[0].attendance);
  const rowsCount = Number(stat.rows[0].cnt);

  await client.execute({
    sql: `UPDATE hyrox_races SET athletes_count = ?, status = 'completed', updated_at = datetime('now') WHERE id = ?`,
    args: [attendance, raceMeta.id]
  });

  console.log(`🎉 [${raceMeta.id}] Complete! Official Attendance: ${attendance.toLocaleString()} (${rowsCount.toLocaleString()} athlete rows).`);
}

async function runSeason(seasonSlug, filterRaceId = null) {
  console.log(`\n============================================================`);
  console.log(`🌟 RUNNING HISTORICAL BACKFILL: ${seasonSlug.toUpperCase()}`);
  console.log(`============================================================`);

  const listUrl = `https://hyrox.r.mikatiming.de/${seasonSlug}/?pid=list`;
  const res = await fetch(listUrl, { headers: { 'User-Agent': UA } });
  const html = await res.text();

  const optgroups = [...html.matchAll(/<optgroup label=\"([^\"]+)\">([\s\S]*?)<\/optgroup>/g)].map(m => {
    const label = m[1];
    const options = [...m[2].matchAll(/<option value=\"([^\"]+)\">([^<]+)<\/option>/g)].map(o => ({ val: o[1], text: o[2] }));
    return { label, options };
  });

  console.log(`Found ${optgroups.length} event optgroups in ${seasonSlug}.`);

  for (const group of optgroups) {
    if (group.label.toLowerCase() === 'sonstige') continue;

    const raceMeta = parseOptgroupLabel(group.label, seasonSlug);

    if (filterRaceId && !raceMeta.id.includes(filterRaceId.toLowerCase()) && !filterRaceId.toLowerCase().includes(raceMeta.id)) {
      continue;
    }

    // Check if already in DB with complete count
    const existing = await client.execute({
      sql: `SELECT athletes_count FROM hyrox_races WHERE id = ?`,
      args: [raceMeta.id]
    });

    if (existing.rows.length > 0 && Number(existing.rows[0].athletes_count) > 0 && !filterRaceId) {
      console.log(`⏩ Skipping ${raceMeta.id}: already complete in DB (${existing.rows[0].athletes_count} athletes).`);
      continue;
    }

    await scrapeRace(raceMeta, group.options, seasonSlug);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const seasonArg = args.find(a => a.startsWith('--season='))?.split('=')[1] || (args.includes('--season') ? args[args.indexOf('--season') + 1] : null) || 'season-6';
  const raceArg = args.find(a => a.startsWith('--race='))?.split('=')[1] || (args.includes('--race') ? args[args.indexOf('--race') + 1] : null) || null;

  if (seasonArg === 'all') {
    await runSeason('season-6', raceArg);
    await runSeason('season-5', raceArg);
    await runSeason('season-4', raceArg);
  } else {
    await runSeason(seasonArg, raceArg);
  }

  console.log(`\n✅ ALL TASKS FINISHED SUCCESSFULLY!`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
