import { createClient } from '@libsql/client';
import fs from 'fs';

let envFile = '';
if (fs.existsSync('.env')) envFile = fs.readFileSync('.env', 'utf8');
else if (fs.existsSync('../.env')) envFile = fs.readFileSync('../.env', 'utf8');

const tursoUrl = process.env.TURSO_DATABASE_URL || envFile.match(/TURSO_DATABASE_URL=(.+)/)?.[1]?.trim();
const tursoToken = process.env.TURSO_AUTH_TOKEN || envFile.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1]?.trim();

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

const missingTasks = [
  // Relays from Sunday wave HMR_LR3MS4JIDC3
  { event: 'HMR_LR3MS4JIDC3', sex: 'M', div: 'HYROX TEAM RELAY MEN', gender: 'M' },
  { event: 'HMR_LR3MS4JIDC3', sex: 'W', div: 'HYROX TEAM RELAY WOMEN', gender: 'F' },
  { event: 'HMR_LR3MS4JIDC3', sex: 'X', div: 'HYROX TEAM RELAY MIXED', gender: 'X' },
  // Pro Doubles Mixed from HDP_OSLO25_OVERALL
  { event: 'HDP_OSLO25_OVERALL', sex: 'X', div: 'HYROX PRO DOUBLES MIXED', gender: 'X' }
];

async function scrapeMissing(t) {
  let page = 1;
  const list = [];
  const seen = new Set();

  while (page <= 10) {
    const url = `https://hyrox.r.mikatiming.de/season-8/?event=${t.event}&num_results=100&page=${page}&pid=list&search%5Bsex%5D=${t.sex}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    const items = [...html.matchAll(/<li[^>]*class=\"[^\"]*list-group-item[^\"]*\"[^>]*>([\s\S]*?)<\/li>/gi)];
    if (items.length === 0) break;

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

      // Deduplicate by team name and rank
      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || rawFullName.match(/\(([A-Za-z]{2,3})\)$/);

      list.push({
        race_id: 'oslo-2025',
        full_name: cleanFullName,
        bib_number: bibMatch ? bibMatch[1].trim() : null,
        nationality: nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : 'NO',
        gender: t.gender,
        age_group: ageMatch ? ageMatch[1].trim() : null,
        division: t.div,
        total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
        overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
      });
    }

    const hasNext = /<li[^>]*class=\"[^\"]*pages-nav-button[^\"]*\"[^>]*><a[^>]*>&gt;<\/a>/i.test(html) &&
      !/<li[^>]*class=\"[^\"]*pages-nav-button[^\"]*disabled[^\"]*\"[^>]*>/i.test(html);
    if (!hasNext) break;
    page++;
    await sleep(150);
  }

  console.log(`✅ ${t.div}: scraped ${list.length} rows`);
  return list;
}

async function run() {
  console.log('🚀 Fixing HYROX Oslo 2025...');
  const newAthletes = [];

  for (const t of missingTasks) {
    const rows = await scrapeMissing(t);
    newAthletes.push(...rows);
  }

  console.log(`\n💾 Inserting ${newAthletes.length} missing rows for Oslo 2025...`);
  for (const a of newAthletes) {
    await client.execute(`
      INSERT INTO hyrox_athlete_results (
        race_id, full_name, bib_number, nationality, gender, age_group, division, total_time, overall_rank, created_at
      ) VALUES (
        ${esc(a.race_id)}, ${esc(a.full_name)}, ${esc(a.bib_number)}, ${esc(a.nationality)},
        ${esc(a.gender)}, ${esc(a.age_group)}, ${esc(a.division)}, ${esc(a.total_time)},
        ${esc(a.overall_rank)}, datetime('now')
      )
      ON CONFLICT (race_id, full_name, division) DO UPDATE SET
        total_time = excluded.total_time,
        overall_rank = excluded.overall_rank,
        bib_number = COALESCE(excluded.bib_number, hyrox_athlete_results.bib_number)
    `);
  }

  // Calculate actual total human finishers
  const countRes = await client.execute(`
    SELECT COALESCE(sum(count * (CASE WHEN division LIKE '%RELAY%' THEN 4 WHEN division LIKE '%DOUBLES%' THEN 2 ELSE 1 END)), 0) as total
    FROM (
      SELECT division, count(*) as count 
      FROM hyrox_athlete_results 
      WHERE race_id = 'oslo-2025' 
      GROUP BY division
    )
  `);
  const totalHumanFinishers = parseInt(countRes.rows[0].total, 10);

  // Update hyrox_races date and athletes_count
  console.log('🔄 Updating hyrox_races for oslo-2025...');
  await client.execute(`
    UPDATE hyrox_races
    SET date = '2025-09-26',
        end_date = '2025-09-29',
        season = '25/26',
        athletes_count = ${totalHumanFinishers},
        updated_at = datetime('now')
    WHERE id = 'oslo-2025'
  `);

  console.log(`\n🎉 Oslo 2025 successfully fixed!`);
  console.log(`- Date: 2025-09-26 to 2025-09-29`);
  console.log(`- Total Human Finishers: ${totalHumanFinishers}`);
}

run().catch(console.error);
