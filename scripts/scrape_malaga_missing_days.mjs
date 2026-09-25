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

// Scrape an option with pagination
async function scrapeWave(eventValue, sexFilter, divisionLabel, genderCode) {
  const athletes = [];
  const seenInOption = new Set();
  let page = 1;
  const numResults = 100;

  while (page <= 100) {
    let url = `https://hyrox.r.mikatiming.de/season-7/?event=${encodeURIComponent(eventValue)}&num_results=${numResults}&page=${page}&pid=list`;
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
        race_id: 'malaga-2025',
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

    if (countOnPage === 0) break;
    const hasNext = html.includes('&gt;') && !html.includes('pages-nav-button disabled');
    if (!hasNext) break;
    page++;
    await sleep(150);
  }

  return athletes;
}

async function upsertBatch(athletes) {
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

const WAVES = [
  // Saturday Waves
  { event: 'H_LR3MS4JIA2A', sex: 'M', div: 'HYROX MEN', gender: 'M' },
  { event: 'H_LR3MS4JIA2A', sex: 'W', div: 'HYROX WOMEN', gender: 'F' },
  { event: 'HPRO_LR3MS4JIA2A', sex: 'M', div: 'HYROX PRO MEN', gender: 'M' },
  { event: 'HPRO_LR3MS4JIA2A', sex: 'W', div: 'HYROX PRO WOMEN', gender: 'F' },
  { event: 'HD_LR3MS4JIA2A', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
  { event: 'HD_LR3MS4JIA2A', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
  { event: 'HD_LR3MS4JIA2A', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
  { event: 'HDP_LR3MS4JIA2A', sex: 'M', div: 'HYROX PRO DOUBLES MEN', gender: 'M' },
  { event: 'HDP_LR3MS4JIA2A', sex: 'W', div: 'HYROX PRO DOUBLES WOMEN', gender: 'F' },

  // Sunday Waves
  { event: 'H_LR3MS4JIA2B', sex: 'M', div: 'HYROX MEN', gender: 'M' },
  { event: 'H_LR3MS4JIA2B', sex: 'W', div: 'HYROX WOMEN', gender: 'F' },
  { event: 'HD_LR3MS4JIA2B', sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
  { event: 'HD_LR3MS4JIA2B', sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
  { event: 'HD_LR3MS4JIA2B', sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
  { event: 'HMR_LR3MS4JIA2B', sex: 'M', div: 'HYROX TEAM RELAY MEN', gender: 'M' },
  { event: 'HMR_LR3MS4JIA2B', sex: 'W', div: 'HYROX TEAM RELAY WOMEN', gender: 'F' },
  { event: 'HMR_LR3MS4JIA2B', sex: 'X', div: 'HYROX TEAM RELAY MIXED', gender: 'X' },
];

async function run() {
  console.log('='.repeat(65));
  console.log('  🚀 Scraping Missing Saturday & Sunday Waves for HYROX Málaga 2025');
  console.log('='.repeat(65));

  let grandTotal = 0;

  for (const wave of WAVES) {
    process.stdout.write(`👉 Fetching ${wave.div} (event=${wave.event}, sex=${wave.sex})... `);
    const athletes = await scrapeWave(wave.event, wave.sex, wave.div, wave.gender);
    process.stdout.write(`found ${athletes.length} athletes.\n`);

    if (athletes.length > 0) {
      process.stdout.write(`   💾 Upserting ${athletes.length} into hyrox_athlete_results... `);
      const inserted = await upsertBatch(athletes);
      process.stdout.write(`done (${inserted} affected)\n`);
      grandTotal += athletes.length;
    }
  }

  console.log(`\n🎉 Total new athlete records scraped & inserted: ${grandTotal}`);

  // Re-verify in DB
  const rowCountRes = await client.execute("SELECT count(*) as total_rows FROM hyrox_athlete_results WHERE race_id = 'malaga-2025'");
  console.log(`📊 Málaga total rows in hyrox_athlete_results now: ${rowCountRes.rows[0].total_rows}`);
}

run().catch(console.error);
