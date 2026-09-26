import { createClient } from '@libsql/client';
import fs from 'fs';
import * as dotenv from 'dotenv';
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log('🚀 Starting forensic cleanup of cross-event duplicates in Turso DB...\n');

  // --- 1. CLEANUP BANGKOK 2025 (Remove Paris Spring duplicates) ---
  console.log('📌 1. Cleaning HYROX Bangkok 2025 (bangkok-2025)...');
  const bkkBefore = await db.execute("SELECT count(*) as c FROM hyrox_athlete_results WHERE race_id = 'bangkok-2025'");
  console.log(`   Rows before: ${bkkBefore.rows[0].c}`);

  const delBkk = await db.execute(`
    DELETE FROM hyrox_athlete_results
    WHERE race_id = 'bangkok-2025'
    AND id IN (
      SELECT a.id
      FROM hyrox_athlete_results a
      JOIN hyrox_athlete_results b
        ON a.full_name = b.full_name
        AND a.total_time = b.total_time
        AND a.race_id = 'bangkok-2025'
        AND b.race_id = 'paris-spring-2025'
    )
  `);
  console.log(`   ✅ Deleted ${delBkk.rowsAffected} duplicate Paris rows from bangkok-2025.`);

  // Recalculate Bangkok attendance
  const bkkDivs = await db.execute("SELECT division, count(*) as c FROM hyrox_athlete_results WHERE race_id = 'bangkok-2025' GROUP BY division");
  let bkkAtt = 0;
  for (const d of bkkDivs.rows) {
    const isDoubles = d.division.includes('DOUBLES');
    const isRelay = d.division.includes('RELAY');
    bkkAtt += d.c * (isRelay ? 4 : (isDoubles ? 2 : 1));
  }
  await db.execute({
    sql: "UPDATE hyrox_races SET athletes_count = ?, updated_at = datetime('now') WHERE id = 'bangkok-2025'",
    args: [bkkAtt]
  });
  console.log(`   🏆 Updated bangkok-2025 athletes_count to ${bkkAtt} (TrainRox: 8321, Diff: +${bkkAtt - 8321} / +${(((bkkAtt - 8321) / 8321) * 100).toFixed(1)}%).\n`);


  // --- 2. CLEANUP MUMBAI 2025 (Remove Mumbai Spring duplicates) ---
  console.log('📌 2. Cleaning HYROX Mumbai 2025 (mumbai-2025)...');
  const mumBefore = await db.execute("SELECT count(*) as c FROM hyrox_athlete_results WHERE race_id = 'mumbai-2025'");
  console.log(`   Rows before: ${mumBefore.rows[0].c}`);

  const delMum = await db.execute(`
    DELETE FROM hyrox_athlete_results
    WHERE race_id = 'mumbai-2025'
    AND id IN (
      SELECT a.id
      FROM hyrox_athlete_results a
      JOIN hyrox_athlete_results b
        ON a.full_name = b.full_name
        AND a.total_time = b.total_time
        AND a.race_id = 'mumbai-2025'
        AND b.race_id = 'mumbai-spring-2025'
    )
  `);
  console.log(`   ✅ Deleted ${delMum.rowsAffected} duplicate Spring rows from mumbai-2025.`);

  // Recalculate Mumbai attendance
  const mumDivs = await db.execute("SELECT division, count(*) as c FROM hyrox_athlete_results WHERE race_id = 'mumbai-2025' GROUP BY division");
  let mumAtt = 0;
  for (const d of mumDivs.rows) {
    const isDoubles = d.division.includes('DOUBLES');
    const isRelay = d.division.includes('RELAY');
    mumAtt += d.c * (isRelay ? 4 : (isDoubles ? 2 : 1));
  }
  await db.execute({
    sql: "UPDATE hyrox_races SET athletes_count = ?, updated_at = datetime('now') WHERE id = 'mumbai-2025'",
    args: [mumAtt]
  });
  console.log(`   🏆 Updated mumbai-2025 athletes_count to ${mumAtt} (TrainRox: 2918, Diff: +${mumAtt - 2918} / +${(((mumAtt - 2918) / 2918) * 100).toFixed(1)}%).\n`);


  // --- 3. CLEANUP SINGAPORE EXPO 2025 (Remove Singapore Asia Open duplicates) ---
  console.log('📌 3. Cleaning HYROX Singapore Expo 2025 (singapore-2025)...');
  const sinBefore = await db.execute("SELECT count(*) as c FROM hyrox_athlete_results WHERE race_id = 'singapore-2025'");
  console.log(`   Rows before: ${sinBefore.rows[0].c}`);

  const delSin = await db.execute(`
    DELETE FROM hyrox_athlete_results
    WHERE race_id = 'singapore-2025'
    AND id IN (
      SELECT a.id
      FROM hyrox_athlete_results a
      JOIN hyrox_athlete_results b
        ON a.full_name = b.full_name
        AND a.total_time = b.total_time
        AND a.race_id = 'singapore-2025'
        AND b.race_id = 'singapore-asia-open-2025'
    )
  `);
  console.log(`   ✅ Deleted ${delSin.rowsAffected} duplicate June Asia Open rows from singapore-2025.`);

  const sinDivs = await db.execute("SELECT division, count(*) as c FROM hyrox_athlete_results WHERE race_id = 'singapore-2025' GROUP BY division");
  let sinAtt = 0;
  for (const d of sinDivs.rows) {
    const isDoubles = d.division.includes('DOUBLES');
    const isRelay = d.division.includes('RELAY');
    sinAtt += d.c * (isRelay ? 4 : (isDoubles ? 2 : 1));
  }
  await db.execute({
    sql: "UPDATE hyrox_races SET athletes_count = ?, updated_at = datetime('now') WHERE id = 'singapore-2025'",
    args: [sinAtt]
  });
  console.log(`   🏆 Updated singapore-2025 athletes_count to ${sinAtt}.\n`);

  console.log('✨ All 3 races successfully remediated in Turso DB!');
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Cleanup failed:', err);
  process.exit(1);
});
