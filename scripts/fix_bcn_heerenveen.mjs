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

const WAVES = [
  // Barcelona 2025 Daily Waves (Fri, Sat, Sun)
  { season: 'season-7', race_id: 'barcelona-2025', event: 'H_LR3MS4JIAA1', sex: 'M', div: 'HYROX MEN', gender: 'M', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'H_LR3MS4JIAA1', sex: 'W', div: 'HYROX WOMEN', gender: 'F', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'H_LR3MS4JIAA2', sex: 'M', div: 'HYROX MEN', gender: 'M', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'H_LR3MS4JIAA2', sex: 'W', div: 'HYROX WOMEN', gender: 'F', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'H_LR3MS4JIAA4', sex: 'M', div: 'HYROX MEN', gender: 'M', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'H_LR3MS4JIAA4', sex: 'W', div: 'HYROX WOMEN', gender: 'F', country: 'ES' },

  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA1', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA1', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA1', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA2', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA2', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA2', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA4', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA4', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F', country: 'ES' },
  { season: 'season-7', race_id: 'barcelona-2025', event: 'HD_LR3MS4JIAA4', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X', country: 'ES' },

  // Heerenveen 2025 Daily Waves (Fri, Sat, Sun)
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'H_LR3MS4JIAC9', sex: 'M', div: 'HYROX MEN', gender: 'M', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'H_LR3MS4JIAC9', sex: 'W', div: 'HYROX WOMEN', gender: 'F', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'H_LR3MS4JIACA', sex: 'M', div: 'HYROX MEN', gender: 'M', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'H_LR3MS4JIACA', sex: 'W', div: 'HYROX WOMEN', gender: 'F', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'H_LR3MS4JIACB', sex: 'M', div: 'HYROX MEN', gender: 'M', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'H_LR3MS4JIACB', sex: 'W', div: 'HYROX WOMEN', gender: 'F', country: 'NL' },

  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIAC9', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIAC9', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIAC9', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIACA', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIACA', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIACA', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIACB', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIACB', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F', country: 'NL' },
  { season: 'season-7', race_id: 'heerenveen-2025', event: 'HD_LR3MS4JIACB', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X', country: 'NL' },
];

async function scrapeWave(t) {
  let page = 1;
  const list = [];
  const seen = new Set();

  while (page <= 50) {
    const url = `https://hyrox.r.mikatiming.de/${t.season}/?event=${t.event}&num_results=100&page=${page}&pid=list&search%5Bsex%5D=${t.sex}`;
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

      const dedupeKey = `${cleanFullName}|${rankMatch ? rankMatch[1] : ''}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const nationMatch = block.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i)
        || block.match(/class=\"nation__icon\"[^>]*title=\"([A-Za-z]{2,3})\"/i)
        || rawFullName.match(/\(([A-Za-z]{2,3})\)$/);

      list.push({
        race_id: t.race_id,
        full_name: cleanFullName,
        bib_number: bibMatch ? bibMatch[1].trim() : null,
        nationality: nationMatch ? nationMatch[1].trim().slice(0, 3).toUpperCase() : t.country,
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

  console.log(`   ✅ [${t.race_id}] ${t.div} (${t.sex}): scraped ${list.length} rows`);
  return list;
}

async function run() {
  console.log('⚡ Scraping Barcelona & Heerenveen Daily Waves...');
  let totalNew = 0;

  for (const t of WAVES) {
    const rows = await scrapeWave(t);
    if (rows.length === 0) continue;
    totalNew += rows.length;

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
  }

  // Recalculate athletes_count
  for (const rid of ['barcelona-2025', 'heerenveen-2025']) {
    const countRes = await client.execute({
      sql: `
        SELECT COALESCE(sum(count * (CASE WHEN division LIKE '%RELAY%' THEN 4 WHEN division LIKE '%DOUBLES%' THEN 2 ELSE 1 END)), 0) as total
        FROM (
          SELECT division, count(*) as count 
          FROM hyrox_athlete_results 
          WHERE race_id = ? 
          GROUP BY division
        )
      `,
      args: [rid]
    });
    const totalCount = parseInt(countRes.rows[0].total, 10);
    await client.execute({
      sql: `UPDATE hyrox_races SET athletes_count = ? WHERE id = ?`,
      args: [totalCount, rid]
    });
    console.log(`Updated ${rid}: athletes_count = ${totalCount}`);
  }

  console.log(`\n🎉 Ingested ${totalNew} rows for Barcelona & Heerenveen with 0 duplicates.`);
}

run().catch(console.error);
