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

const tasks = [
  // Sunday Pro
  { event: 'HPRO_LR3MS4JIEC6', sex: 'M', div: 'HYROX PRO MEN', gender: 'M' },
  { event: 'HPRO_LR3MS4JIEC6', sex: 'W', div: 'HYROX PRO WOMEN', gender: 'F' },

  // Friday Pro Doubles
  { event: 'HDP_LR3MS4JIEB3', sex: 'M', div: 'HYROX PRO DOUBLES MEN', gender: 'M' },
  { event: 'HDP_LR3MS4JIEB3', sex: 'W', div: 'HYROX PRO DOUBLES WOMEN', gender: 'F' },

  // Saturday Open Men & Sunday Open Women
  { event: 'H_LR3MS4JIEB2', sex: 'M', div: 'HYROX MEN', gender: 'M' },
  { event: 'H_LR3MS4JIEC6', sex: 'W', div: 'HYROX WOMEN', gender: 'F' },

  // Friday Doubles Women, Saturday Doubles Mixed, Sunday Doubles Men
  { event: 'HD_LR3MS4JIEB3', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
  { event: 'HD_LR3MS4JIEB2', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
  { event: 'HD_LR3MS4JIEC6', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },

  // Friday Relays
  { event: 'HMR_LR3MS4JIEB3', sex: 'M', div: 'HYROX TEAM RELAY MEN', gender: 'M' },
  { event: 'HMR_LR3MS4JIEB3', sex: 'W', div: 'HYROX TEAM RELAY WOMEN', gender: 'F' },
  { event: 'HMR_LR3MS4JIEB3', sex: 'X', div: 'HYROX TEAM RELAY MIXED', gender: 'X' },

  // Adaptive
  { event: 'HA_LR3MS4JIEB2', sex: 'M', div: 'HYROX ADAPTIVE MEN', gender: 'M' },
  { event: 'HA_LR3MS4JIEC6', sex: 'W', div: 'HYROX ADAPTIVE WOMEN', gender: 'F' },
];

async function scrapeTask(t) {
  let page = 1;
  const list = [];
  const seen = new Set();

  while (page <= 50) {
    const url = `https://hyrox.r.mikatiming.de/season-8/?event=${t.event}&num_results=100&page=${page}&pid=list&search%5Bsex%5D=${t.sex}`;
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

      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}|${timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || rawFullName.match(/\(([A-Za-z]{2,3})\)$/);

      list.push({
        race_id: 'atlanta-2025',
        full_name: cleanFullName,
        bib_number: bibMatch ? bibMatch[1].trim() : null,
        nationality: nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : 'XX',
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

  console.log(`✅ ${t.div} (${t.sex}): scraped ${list.length} rows`);
  return list;
}

async function run() {
  console.log('🚀 Starting clean ingest for HYROX Atlanta 2025 (Season 8)...');

  const allAthletes = [];
  for (const t of tasks) {
    const athletes = await scrapeTask(t);
    allAthletes.push(...athletes);
  }

  console.log(`\n📊 Total rows scraped: ${allAthletes.length}`);

  // Delete old mismatched Atlanta 2025 rows
  console.log('🗑️ Deleting old atlanta-2025 rows...');
  await client.execute("DELETE FROM hyrox_athlete_results WHERE race_id = 'atlanta-2025'");

  // Insert in batches of 100
  console.log('💾 Inserting new rows into hyrox_athlete_results...');
  const batchSize = 100;
  for (let i = 0; i < allAthletes.length; i += batchSize) {
    const batch = allAthletes.slice(i, i + batchSize);
    const values = batch.map(a => `(
      ${esc(a.race_id)},
      ${esc(a.full_name)},
      ${esc(a.bib_number)},
      ${esc(a.nationality)},
      ${esc(a.gender)},
      ${esc(a.age_group)},
      ${esc(a.division)},
      ${esc(a.total_time)},
      ${esc(a.overall_rank)},
      datetime('now')
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

  // Calculate actual athletes_count (Doubles * 2, Relays * 4, Singles * 1)
  const countRes = await client.execute(`
    SELECT COALESCE(sum(count * (CASE WHEN division LIKE '%RELAY%' THEN 4 WHEN division LIKE '%DOUBLES%' THEN 2 ELSE 1 END)), 0) as total
    FROM (
      SELECT division, count(*) as count 
      FROM hyrox_athlete_results 
      WHERE race_id = 'atlanta-2025' 
      GROUP BY division
    )
  `);
  const totalHumanFinishers = parseInt(countRes.rows[0].total, 10);

  // Update hyrox_races with correct date and athletes_count
  console.log('🔄 Updating hyrox_races table...');
  await client.execute(`
    UPDATE hyrox_races
    SET date = '2025-10-31',
        end_date = '2025-11-02',
        season = '25/26',
        athletes_count = ${totalHumanFinishers},
        updated_at = datetime('now')
    WHERE id = 'atlanta-2025'
  `);

  console.log(`\n🎉 Success! atlanta-2025 updated:`);
  console.log(`- Date: 2025-10-31 to 2025-11-02`);
  console.log(`- Total Human Finishers: ${totalHumanFinishers}`);
  console.log(`- Database Rows: ${allAthletes.length}`);
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
