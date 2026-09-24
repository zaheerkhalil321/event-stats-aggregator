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

function cleanSplit(val) {
  if (!val || val === '–' || val === '-') return null;
  return val.trim();
}

function extractSplit(html, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`${escaped}[\\s\\S]{0,100}?(\\d{1,2}:\\d{2}:\\d{2})`, 'i');
  const m = html.match(re);
  return m ? m[1] : null;
}

async function fetchWithRetry(url, maxRetries = 3) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) return await res.text();
    } catch (e) {
      if (i === maxRetries) throw e;
      await sleep(300 * i);
    }
  }
  return null;
}

// 1. SCRAPE SYDNEY DOUBLES
async function scrapeSydney() {
  console.log('\n🇦🇺 --- SCRAPING SYDNEY 2025 DOUBLES (Friday, Saturday, Sunday) ---');
  const tasks = [
    { event: 'HD_LR3MS4JIBCD', day: 'Friday' },
    { event: 'HD_LR3MS4JIBE2', day: 'Saturday' },
    { event: 'HD_LR3MS4JIBE3', day: 'Sunday' }
  ];

  const sexConfig = [
    { sex: 'W', div: 'HYROX DOUBLES WOMEN', gender: 'F' },
    { sex: 'X', div: 'HYROX DOUBLES MIXED', gender: 'X' },
    { sex: 'M', div: 'HYROX DOUBLES MEN', gender: 'M' },
  ];

  const allPairs = [];
  const seenDetail = new Set();

  for (const cfg of sexConfig) {
    for (const t of tasks) {
      let page = 1;
      let dayCount = 0;
      while (page <= 25) {
        const url = `https://hyrox.r.mikatiming.de/season-8/?event=${t.event}&event_main_group=2025+Sydney&pid=list&search%5Bsex%5D=${cfg.sex}&num_results=100&page=${page}`;
        const html = await fetchWithRetry(url);
        if (!html) break;

        const listItems = [...html.matchAll(/<li[^>]*class=\"[^\"]*list-group-item[^\"]*\"[^>]*>([\s\S]*?)<\/li>/gi)];
        if (listItems.length === 0) break;

        let pageFound = 0;
        for (const item of listItems) {
          const block = item[1];
          const linkMatch = block.match(/href=\"([^\"]*content=detail[^\"]*)\"[^>]*>([^<]+)<\/a>/i);
          if (!linkMatch) continue;

          const rawHref = linkMatch[1].replace(/&amp;/g, '&');
          if (seenDetail.has(rawHref)) continue;
          seenDetail.add(rawHref);

          const rawName = linkMatch[2].trim();
          const rankMatch = block.match(/type-place[^>]*numeric\"[^>]*>(\d+)<\/div>/i);
          const timeMatch = block.match(/type-time\"[^>]*>[\s\S]*?<\/div>([\d:]+)<\/div>/i) || block.match(/(\d{1,2}:\d{2}:\d{2})/);
          const ageMatch = block.match(/type-age_class[^>]*>[\s\S]*?<\/div>([^<]+)<\/div>/i);

          allPairs.push({
            race_id: 'sydney-2025',
            division: cfg.div,
            gender: cfg.gender,
            full_name: rawName,
            detail_href: rawHref,
            overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
            total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
            age_group: ageMatch ? ageMatch[1].trim() : null,
          });
          pageFound++;
          dayCount++;
        }

        if (pageFound === 0) break;
        page++;
        await sleep(80);
      }
      if (dayCount > 0) console.log(`   ${t.day} (${t.event}) ${cfg.div}: ${dayCount} pairs`);
    }
  }

  console.log(`\nTotal Sydney pairs found: ${allPairs.length}`);
  await enrichAndInsert(allPairs, 'sydney-2025');
}

// 2. SCRAPE SINGAPORE PRO
async function scrapeSingapore() {
  console.log('\n🇸🇬 --- SCRAPING SINGAPORE 2025 PRO MEN & PRO WOMEN ---');
  const sexConfig = [
    { sex: 'M', div: 'HYROX PRO MEN', gender: 'M' },
    { sex: 'W', div: 'HYROX PRO WOMEN', gender: 'F' },
  ];

  const allAthletes = [];
  const seenDetail = new Set();

  for (const cfg of sexConfig) {
    let page = 1;
    let count = 0;
    while (page <= 10) {
      const url = `https://hyrox.r.mikatiming.de/season-8/?event=HPRO_LR3MS4JI1469&event_main_group=2026+Singapore&pid=list&search%5Bsex%5D=${cfg.sex}&num_results=100&page=${page}`;
      const html = await fetchWithRetry(url);
      if (!html) break;

      const listItems = [...html.matchAll(/<li[^>]*class=\"[^\"]*list-group-item[^\"]*\"[^>]*>([\s\S]*?)<\/li>/gi)];
      if (listItems.length === 0) break;

      let pageFound = 0;
      for (const item of listItems) {
        const block = item[1];
        const linkMatch = block.match(/href=\"([^\"]*content=detail[^\"]*)\"[^>]*>([^<]+)<\/a>/i);
        if (!linkMatch) continue;

        const rawHref = linkMatch[1].replace(/&amp;/g, '&');
        if (seenDetail.has(rawHref)) continue;
        seenDetail.add(rawHref);

        const rawName = linkMatch[2].trim();
        const rankMatch = block.match(/type-place[^>]*numeric\"[^>]*>(\d+)<\/div>/i);
        const timeMatch = block.match(/type-time\"[^>]*>[\s\S]*?<\/div>([\d:]+)<\/div>/i) || block.match(/(\d{1,2}:\d{2}:\d{2})/);
        const ageMatch = block.match(/type-age_class[^>]*>[\s\S]*?<\/div>([^<]+)<\/div>/i);

        allAthletes.push({
          race_id: 'singapore-2025',
          division: cfg.div,
          gender: cfg.gender,
          full_name: rawName,
          detail_href: rawHref,
          overall_rank: rankMatch ? parseInt(rankMatch[1], 10) : null,
          total_time: timeMatch ? (Array.isArray(timeMatch) ? timeMatch[1] : timeMatch) : null,
          age_group: ageMatch ? ageMatch[1].trim() : null,
        });
        pageFound++;
        count++;
      }

      if (pageFound === 0) break;
      page++;
      await sleep(80);
    }
    console.log(`   ${cfg.div}: ${count} athletes`);
  }

  console.log(`\nTotal Singapore athletes found: ${allAthletes.length}`);
  await enrichAndInsert(allAthletes, 'singapore-2025');
}

// Concurrently enrich and insert
async function enrichAndInsert(items, raceId, concurrency = 10) {
  console.log(`⚡ Enriching and inserting ${items.length} records for ${raceId}...`);
  let completed = 0;

  async function worker(index) {
    while (index < items.length) {
      const p = items[index];
      index += concurrency;

      try {
        const detailUrl = 'https://hyrox.r.mikatiming.de/season-8/' + p.detail_href;
        const html = await fetchWithRetry(detailUrl);
        if (html) {
          const tableData = {};
          const thMatches = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi)];
          for (const row of thMatches) {
            const k = row[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            const v = row[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            tableData[k] = v;
          }

          p.bib_number = cleanSplit(tableData['Bib Number']);
          if (!p.age_group) p.age_group = cleanSplit(tableData['Age Group']);
          if (!p.total_time) p.total_time = cleanSplit(tableData['Overall Time'] || tableData['Total']);

          const member1 = tableData['Member 1'] || tableData['Athlete'] || '';
          const natMatch = member1.match(/\(([A-Za-z]{2,3})\)/) || html.match(/class=\"nation__abbr\"[^>]*>([A-Za-z]{2,3})</i);
          p.nationality = natMatch ? natMatch[1].toUpperCase() : 'XX';

          const genderRank = parseInt(tableData['Rank (M/W)'], 10);
          const agRank = parseInt(tableData['Rank (AG)'], 10);
          if (!isNaN(genderRank)) p.gender_rank = genderRank;
          if (!isNaN(agRank)) p.age_group_rank = agRank;
          p.division_rank = p.overall_rank;

          p.run_1 = cleanSplit(extractSplit(html, 'Running 1'));
          p.skierg = cleanSplit(extractSplit(html, '1000m SkiErg'));
          p.run_2 = cleanSplit(extractSplit(html, 'Running 2'));
          p.sled_push = cleanSplit(extractSplit(html, '50m Sled Push'));
          p.run_3 = cleanSplit(extractSplit(html, 'Running 3'));
          p.sled_pull = cleanSplit(extractSplit(html, '50m Sled Pull'));
          p.run_4 = cleanSplit(extractSplit(html, 'Running 4'));
          p.burpee_jumps = cleanSplit(extractSplit(html, '80m Burpee Broad Jump'));
          p.run_5 = cleanSplit(extractSplit(html, 'Running 5'));
          p.rowing = cleanSplit(extractSplit(html, '1000m Row'));
          p.run_6 = cleanSplit(extractSplit(html, 'Running 6'));
          p.farmers_carry = cleanSplit(extractSplit(html, '200m Farmers Carry'));
          p.run_7 = cleanSplit(extractSplit(html, 'Running 7'));
          p.sandbag_lunges = cleanSplit(extractSplit(html, '100m Sandbag Lunges'));
          p.run_8 = cleanSplit(extractSplit(html, 'Running 8'));
          p.wall_balls = cleanSplit(extractSplit(html, 'Wall Balls'));
          p.roxzone = cleanSplit(extractSplit(html, 'Roxzone Time'));
        }
      } catch (err) {
        // continue
      }

      completed++;
      if (completed % 100 === 0 || completed === items.length) {
        process.stdout.write(`   Enriched: ${completed}/${items.length} (${Math.round((completed / items.length) * 100)}%)\r`);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < concurrency; i++) workers.push(worker(i));
  await Promise.all(workers);
  console.log(`\n   ✅ All items enriched!`);

  // Insert in batches of 50
  console.log(`   💾 Inserting into database...`);
  const batchSize = 50;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const values = batch.map(a => `(
      ${esc(a.race_id)},
      ${esc(a.bib_number)},
      ${esc(a.full_name)},
      ${esc(a.nationality || 'XX')},
      ${esc(a.gender)},
      ${esc(a.age_group)},
      ${esc(a.division)},
      ${esc(a.total_time)},
      ${esc(a.overall_rank)},
      ${esc(a.gender_rank || null)},
      ${esc(a.division_rank || null)},
      ${esc(a.age_group_rank || null)},
      ${esc(a.run_1)},
      ${esc(a.run_2)},
      ${esc(a.run_3)},
      ${esc(a.run_4)},
      ${esc(a.run_5)},
      ${esc(a.run_6)},
      ${esc(a.run_7)},
      ${esc(a.run_8)},
      ${esc(a.skierg)},
      ${esc(a.sled_push)},
      ${esc(a.sled_pull)},
      ${esc(a.burpee_jumps)},
      ${esc(a.rowing)},
      ${esc(a.farmers_carry)},
      ${esc(a.sandbag_lunges)},
      ${esc(a.wall_balls)},
      ${esc(a.roxzone)},
      datetime('now'),
      datetime('now')
    )`).join(',\n');

    await client.execute(`
      INSERT INTO hyrox_athlete_results (
        race_id, bib_number, full_name, nationality, gender, age_group, division,
        total_time, overall_rank, gender_rank, division_rank, age_group_rank,
        run_1, run_2, run_3, run_4, run_5, run_6, run_7, run_8,
        skierg, sled_push, sled_pull, burpee_jumps, rowing, farmers_carry, sandbag_lunges, wall_balls, roxzone,
        created_at, updated_at
      ) VALUES ${values}
      ON CONFLICT (race_id, full_name, division) DO UPDATE SET
        total_time = excluded.total_time,
        overall_rank = excluded.overall_rank,
        gender_rank = excluded.gender_rank,
        division_rank = excluded.division_rank,
        age_group_rank = excluded.age_group_rank,
        bib_number = COALESCE(excluded.bib_number, hyrox_athlete_results.bib_number),
        nationality = CASE WHEN excluded.nationality != 'XX' THEN excluded.nationality ELSE hyrox_athlete_results.nationality END,
        run_1 = COALESCE(excluded.run_1, hyrox_athlete_results.run_1),
        run_2 = COALESCE(excluded.run_2, hyrox_athlete_results.run_2),
        run_3 = COALESCE(excluded.run_3, hyrox_athlete_results.run_3),
        run_4 = COALESCE(excluded.run_4, hyrox_athlete_results.run_4),
        run_5 = COALESCE(excluded.run_5, hyrox_athlete_results.run_5),
        run_6 = COALESCE(excluded.run_6, hyrox_athlete_results.run_6),
        run_7 = COALESCE(excluded.run_7, hyrox_athlete_results.run_7),
        run_8 = COALESCE(excluded.run_8, hyrox_athlete_results.run_8),
        skierg = COALESCE(excluded.skierg, hyrox_athlete_results.skierg),
        sled_push = COALESCE(excluded.sled_push, hyrox_athlete_results.sled_push),
        sled_pull = COALESCE(excluded.sled_pull, hyrox_athlete_results.sled_pull),
        burpee_jumps = COALESCE(excluded.burpee_jumps, hyrox_athlete_results.burpee_jumps),
        rowing = COALESCE(excluded.rowing, hyrox_athlete_results.rowing),
        farmers_carry = COALESCE(excluded.farmers_carry, hyrox_athlete_results.farmers_carry),
        sandbag_lunges = COALESCE(excluded.sandbag_lunges, hyrox_athlete_results.sandbag_lunges),
        wall_balls = COALESCE(excluded.wall_balls, hyrox_athlete_results.wall_balls),
        roxzone = COALESCE(excluded.roxzone, hyrox_athlete_results.roxzone),
        updated_at = datetime('now')
    `);
  }

  // Recalculate athlete count for race
  const r = await client.execute(`SELECT division, count(*) as cnt FROM hyrox_athlete_results WHERE race_id = '${raceId}' GROUP BY division`);
  let calculated = 0;
  for (const row of r.rows) {
    let mul = 1;
    if (row.division.includes('DOUBLES')) mul = 2;
    if (row.division.includes('RELAY')) mul = 4;
    calculated += row.cnt * mul;
  }
  await client.execute(`UPDATE hyrox_races SET athletes_count = ${calculated}, updated_at = datetime('now') WHERE id = '${raceId}'`);
  console.log(`   Updated ${raceId} athletes_count to ${calculated}!`);
}

async function main() {
  await scrapeSydney();
  await scrapeSingapore();
  console.log('\n🎉 ALL FIXES COMPLETED SUCCESSFULLY!');
}

main().catch(console.error);
