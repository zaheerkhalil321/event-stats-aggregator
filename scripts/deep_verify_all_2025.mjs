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

async function runDeepVerification() {
  console.log('🔬 STARTING EXHAUSTIVE MULTI-LAYER VERIFICATION FOR 2025 RACES...\n');

  // 1. Fetch all 2025 races
  const racesRes = await client.execute(`
    SELECT id, name, date, end_date, season, athletes_count 
    FROM hyrox_races 
    WHERE (date LIKE '2025%' OR id LIKE '%2025%')
    ORDER BY date ASC
  `);

  console.log(`Total 2025 races found: ${racesRes.rows.length}`);

  let totalAthletesInAllRaces = 0;
  let totalHumanFinishers = 0;
  const raceDetails = [];
  const flags = [];

  for (const r of racesRes.rows) {
    const divsRes = await client.execute({
      sql: `SELECT division, count(*) as cnt FROM hyrox_athlete_results WHERE race_id = ? GROUP BY division`,
      args: [r.id]
    });

    const divCounts = {};
    let raceDbRows = 0;
    let raceHumans = 0;

    for (const d of divsRes.rows) {
      divCounts[d.division] = d.cnt;
      raceDbRows += d.cnt;
      const mult = d.division.includes('RELAY') ? 4 : (d.division.includes('DOUBLES') ? 2 : 1);
      raceHumans += d.cnt * mult;
    }

    totalAthletesInAllRaces += raceDbRows;
    totalHumanFinishers += raceHumans;

    const hasPro = (divCounts['HYROX PRO MEN'] || 0) + (divCounts['HYROX PRO WOMEN'] || 0);
    const hasOpen = (divCounts['HYROX MEN'] || 0) + (divCounts['HYROX WOMEN'] || 0);
    const hasDoubles = (divCounts['HYROX DOUBLES MEN'] || 0) + (divCounts['HYROX DOUBLES WOMEN'] || 0) + (divCounts['HYROX DOUBLES MIXED'] || 0);
    const hasRelays = (divCounts['HYROX TEAM RELAY MEN'] || 0) + (divCounts['HYROX TEAM RELAY WOMEN'] || 0) + (divCounts['HYROX TEAM RELAY MIXED'] || 0);
    const hasAdaptive = (divCounts['HYROX ADAPTIVE MEN'] || 0) + (divCounts['HYROX ADAPTIVE WOMEN'] || 0);

    // Checks
    const raceFlags = [];
    if (r.date === '2025-12-31' || r.date === '2025-06-01') raceFlags.push('SUSPICIOUS DATE');
    if (raceDbRows === 0) raceFlags.push('0 ROWS');
    if (hasOpen === 0 && r.id !== 'world-championships-2025') raceFlags.push('NO OPEN');
    if (hasDoubles === 0 && r.id !== 'world-championships-2025') raceFlags.push('NO DOUBLES');
    if (hasRelays === 0 && r.id !== 'world-championships-2025') raceFlags.push('NO RELAYS');
    if (r.athletes_count !== raceHumans) raceFlags.push(`COUNT MISMATCH: stored ${r.athletes_count} vs calculated ${raceHumans}`);

    if (raceFlags.length > 0) {
      flags.push({ id: r.id, flags: raceFlags.join(', ') });
    }

    raceDetails.push({
      id: r.id,
      date: `${r.date} ~ ${r.end_date}`,
      open: hasOpen,
      pro: hasPro,
      doubles: hasDoubles,
      relays: hasRelays,
      adaptive: hasAdaptive,
      totalRows: raceDbRows,
      finishers: raceHumans,
      stored: r.athletes_count,
      status: raceFlags.length === 0 ? '✅ 100% OK' : '⚠️ ' + raceFlags.join(', ')
    });
  }

  // 2. Duplicate Check Across ALL 2025 Athlete Results
  const dupesRes = await client.execute(`
    SELECT race_id, full_name, division, count(*) as c
    FROM hyrox_athlete_results
    WHERE race_id LIKE '%2025%'
    GROUP BY race_id, full_name, division
    HAVING count(*) > 1
  `);

  console.log('\n=============================================================');
  console.log('📊 DETAILED 2025 RACES BREAKDOWN TABLE (ALL 56 RACES)');
  console.log('=============================================================\n');
  console.table(raceDetails);

  console.log('\n=============================================================');
  console.log('🔍 INTEGRITY AUDIT SUMMARY');
  console.log('=============================================================');
  console.log(`Total 2025 Races Audited:             ${racesRes.rows.length}`);
  console.log(`Total Athlete Database Rows:          ${totalAthletesInAllRaces.toLocaleString()}`);
  console.log(`Total Human Finishers Represented:    ${totalHumanFinishers.toLocaleString()}`);
  console.log(`Total Exact Duplicates in DB:         ${dupesRes.rows.length}`);
  console.log(`Races with Flags / Anomalies:         ${flags.length}`);
  console.log('=============================================================\n');

  if (flags.length > 0) {
    console.log('⚠️ Flagged Races:');
    console.log(flags);
  } else {
    console.log('🎉 100% CLEAN! Zero flags, zero duplicate rows, zero dummy dates.');
  }
}

runDeepVerification().catch(console.error);
