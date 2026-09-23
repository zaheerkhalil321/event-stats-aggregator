import { createClient } from '@libsql/client';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/TURSO_DATABASE_URL=(.+)/);
const tokenMatch = env.match(/TURSO_AUTH_TOKEN=(.+)/);

const client = createClient({
  url: urlMatch[1].trim(),
  authToken: tokenMatch[1].trim(),
});

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchSeasonOptgroups(seasonSlug) {
  const url = `https://hyrox.r.mikatiming.de/${seasonSlug}/?pid=list`;
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const ogs = [...html.matchAll(/<optgroup\s+label=\"([^\"]+)\">([\s\S]*?)<\/optgroup>/gi)];
  return ogs.map(g => ({
    label: g[1].trim(),
    options: [...g[2].matchAll(/<option\s+value=\"([^\"]+)\"[^>]*>([^<]+)<\/option>/gi)].map(o => ({
      value: o[1].trim(),
      name: o[2].trim(),
    }))
  }));
}

function findOptgroup(race, optgroups) {
  const c = (race.city || '').toLowerCase().trim();
  const year = race.date ? race.date.split('-')[0] : '2025';
  
  // 1. Label contains city and year
  let og = optgroups.find(g => {
    const l = g.label.toLowerCase();
    return l.includes(c) && l.includes(year);
  });
  if (og) return og;

  // 2. Label contains city
  og = optgroups.find(g => g.label.toLowerCase().includes(c));
  if (og) return og;

  // 3. Fallback on race.id tokens
  const tokens = race.id.toLowerCase().split('-').filter(t => t.length > 2 && !t.match(/^\d+$/));
  return optgroups.find(g => tokens.every(tok => g.label.toLowerCase().includes(tok)));
}

async function audit() {
  console.log('🔍 Fetching MikaTiming Season 7 & Season 8 directories...');
  const ogsSeason7 = await fetchSeasonOptgroups('season-7');
  const ogsSeason8 = await fetchSeasonOptgroups('season-8');

  console.log(`Found ${ogsSeason7.length} groups in season-7, ${ogsSeason8.length} groups in season-8.`);

  const racesRes = await client.execute(`
    SELECT r.id, r.name, r.city, r.date, r.season,
           COUNT(a.id) as db_rows,
           SUM(CASE 
                 WHEN a.division LIKE '%DOUBLES%' THEN 2 
                 WHEN a.division LIKE '%RELAY%' THEN 4 
                 ELSE 1 
               END) as human_finishers
    FROM hyrox_races r
    LEFT JOIN hyrox_athlete_results a ON r.id = a.race_id
    WHERE r.id LIKE '%2025' OR r.date LIKE '2025%'
    GROUP BY r.id
    ORDER BY r.date ASC
  `);

  const races = racesRes.rows;
  console.log(`Auditing all ${races.length} races of 2025 against MikaTiming...\n`);

  const auditReport = [];
  const issues = [];

  for (const r of races) {
    const isSeason8 = r.season === '25/26';
    const primaryOgs = isSeason8 ? ogsSeason8 : ogsSeason7;
    const secondaryOgs = isSeason8 ? ogsSeason7 : ogsSeason8;

    let og = findOptgroup(r, primaryOgs) || findOptgroup(r, secondaryOgs);
    const seasonSlug = og ? (primaryOgs.includes(og) ? (isSeason8 ? 'season-8' : 'season-7') : (isSeason8 ? 'season-7' : 'season-8')) : (isSeason8 ? 'season-8' : 'season-7');

    const dbHuman = Number(r.human_finishers) || 0;
    const dbRows = Number(r.db_rows) || 0;

    auditReport.push({
      id: r.id,
      name: r.name,
      season: r.season,
      dbRows,
      dbHuman,
      mikaGroup: og ? og.label : 'NOT_FOUND',
      optionsCount: og ? og.options.length : 0,
    });
  }

  console.log('Sample audit report:');
  console.table(auditReport.slice(0, 15).map(a => ({
    name: a.name,
    dbHuman: a.dbHuman,
    dbRows: a.dbRows,
    mikaGroup: a.mikaGroup,
    options: a.optionsCount
  })));

  // Save full report
  fs.writeFileSync('scripts/audit_2025_report.json', JSON.stringify(auditReport, null, 2));
  console.log('Saved audit report to scripts/audit_2025_report.json');
}

audit().catch(console.error);
