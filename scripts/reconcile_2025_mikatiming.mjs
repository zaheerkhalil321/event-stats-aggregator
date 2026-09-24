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

async function getOptgroups(season) {
  const res = await fetch(`https://hyrox.r.mikatiming.de/${season}/?pid=list`, { headers: { 'User-Agent': UA } });
  const html = await res.text();
  const ogs = [...html.matchAll(/<optgroup[^>]*label=\"([^\"]+)\"[^>]*>([\s\S]*?)<\/optgroup>/gi)];
  return ogs.map(og => {
    const opts = [...og[2].matchAll(/<option[^>]*value=\"([^\"]+)\"[^>]*>([^<]+)<\/option>/gi)].map(m => ({
      val: m[1],
      text: m[2].trim()
    }));
    return {
      season,
      label: og[1],
      options: opts
    };
  });
}

async function main() {
  console.log('🔍 Fetching all 2025 optgroups from MikaTiming Season 7 & 8...');
  const s7 = await getOptgroups('season-7');
  const s8 = await getOptgroups('season-8');
  const allOgs = [...s7, ...s8].filter(og => og.label.includes('2025'));

  console.log(`Found ${allOgs.length} official 2025 event groups on MikaTiming.\n`);

  // Fetch all 2025 races from DB
  const dbRacesRes = await client.execute("SELECT id, name, date, athletes_count FROM hyrox_races WHERE date LIKE '2025%' OR id LIKE '%2025%'");
  const dbRaces = dbRacesRes.rows;

  const discrepancies = [];

  for (const og of allOgs) {
    const cityName = og.label.replace('2025', '').replace('HYROX', '').trim().toLowerCase();
    
    // Match with DB race
    const matchedRace = dbRaces.find(r => {
      const dbId = r.id.toLowerCase();
      const dbName = r.name.toLowerCase();
      return dbId.includes(cityName.replace(/\s+/g, '-')) || dbName.includes(cityName);
    });

    if (!matchedRace) {
      console.log(`❓ Unmatched MikaTiming Event: [${og.label}] (${og.options.length} options)`);
      continue;
    }

    // Check DB divisions
    const divsRes = await client.execute({
      sql: "SELECT division, count(*) as cnt FROM hyrox_athlete_results WHERE race_id = ? GROUP BY division",
      args: [matchedRace.id]
    });

    const divMap = {};
    let totalDbHumans = 0;
    for (const d of divsRes.rows) {
      divMap[d.division] = d.cnt;
      const mult = d.division.includes('RELAY') ? 4 : (d.division.includes('DOUBLES') ? 2 : 1);
      totalDbHumans += d.cnt * mult;
    }

    // Check if options have relay, open, doubles, pro
    const hasRelayOpt = og.options.some(o => o.text.toUpperCase().includes('RELAY'));
    const hasDbRelay = Boolean(divMap['HYROX TEAM RELAY MEN'] || divMap['HYROX TEAM RELAY WOMEN'] || divMap['HYROX TEAM RELAY MIXED']);

    const hasOpenOpt = og.options.some(o => o.text.toUpperCase().includes('HYROX -') || o.text.toUpperCase() === 'HYROX');
    const hasDbOpen = Boolean(divMap['HYROX MEN'] || divMap['HYROX WOMEN']);

    const hasDoublesOpt = og.options.some(o => o.text.toUpperCase().includes('DOUBLES'));
    const hasDbDoubles = Boolean(divMap['HYROX DOUBLES MEN'] || divMap['HYROX DOUBLES WOMEN'] || divMap['HYROX DOUBLES MIXED']);

    const issues = [];
    if (hasRelayOpt && !hasDbRelay) issues.push('MISSING RELAYS IN DB');
    if (hasOpenOpt && !hasDbOpen) issues.push('MISSING OPEN IN DB');
    if (hasDoublesOpt && !hasDbDoubles) issues.push('MISSING DOUBLES IN DB');
    if (matchedRace.date === '2025-12-31') issues.push('DATE IS 2025-12-31');

    if (issues.length > 0) {
      discrepancies.push({
        event: og.label,
        raceId: matchedRace.id,
        date: matchedRace.date,
        totalHumans: totalDbHumans,
        issues: issues.join(' | '),
        optionCount: og.options.length
      });
    }
  }

  console.log(`\n==================================================`);
  console.log(`📊 RECONCILIATION AUDIT RESULTS`);
  console.log(`Total 2025 Events Checked: ${allOgs.length}`);
  console.log(`Events With Potential Issues: ${discrepancies.length}`);
  console.log(`==================================================\n`);

  console.table(discrepancies);
}

main().catch(console.error);
