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

async function main() {
  const racesRes = await client.execute(`
    SELECT id, name, date, end_date, season, athletes_count 
    FROM hyrox_races 
    WHERE (date LIKE '2025%' OR id LIKE '%2025%') 
    ORDER BY date ASC
  `);

  console.log(`Auditing ${racesRes.rows.length} races from 2025...\n`);

  const results = [];

  for (const r of racesRes.rows) {
    const divsRes = await client.execute({
      sql: `SELECT division, count(*) as cnt FROM hyrox_athlete_results WHERE race_id = ? GROUP BY division`,
      args: [r.id]
    });

    const divMap = {};
    let totalDbRows = 0;
    let computedHumans = 0;

    for (const d of divsRes.rows) {
      divMap[d.division] = d.cnt;
      totalDbRows += d.cnt;
      const multiplier = d.division.includes('RELAY') ? 4 : (d.division.includes('DOUBLES') ? 2 : 1);
      computedHumans += d.cnt * multiplier;
    }

    const hasPro = Boolean(divMap['HYROX PRO MEN'] || divMap['HYROX PRO WOMEN']);
    const hasOpen = Boolean(divMap['HYROX MEN'] || divMap['HYROX WOMEN']);
    const hasDoubles = Boolean(divMap['HYROX DOUBLES MEN'] || divMap['HYROX DOUBLES WOMEN'] || divMap['HYROX DOUBLES MIXED']);
    const hasRelay = Boolean(divMap['HYROX TEAM RELAY MEN'] || divMap['HYROX TEAM RELAY WOMEN'] || divMap['HYROX TEAM RELAY MIXED']);

    const warnings = [];
    if (totalDbRows === 0) warnings.push('EMPTY (0 rows)');
    if (!hasOpen && totalDbRows > 0) warnings.push('MISSING OPEN');
    if (!hasDoubles && totalDbRows > 0) warnings.push('MISSING DOUBLES');
    if (!hasRelay && totalDbRows > 0) warnings.push('MISSING RELAYS');

    results.push({
      id: r.id,
      name: r.name,
      date: r.date,
      storedCount: r.athletes_count,
      computedHumans,
      totalDbRows,
      divisions: Object.keys(divMap).length,
      warnings: warnings.join(', ') || 'OK'
    });
  }

  console.table(results);

  const flagged = results.filter(r => r.warnings !== 'OK');
  console.log(`\n⚠️ Total Flagged Races: ${flagged.length} / ${results.length}`);
  for (const f of flagged) {
    console.log(`- [${f.id}] ${f.name} (${f.date}): ${f.warnings} | Humans: ${f.computedHumans} (Stored: ${f.storedCount})`);
  }
}

main().catch(console.error);
