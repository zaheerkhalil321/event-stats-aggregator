// scripts/recalculate_all_ranks.mjs
// Accurately recalculates overall_rank, division_rank, and age_group_rank across all races
import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient({
  url: process.env.TURSO_DATABASE_URL || 'https://db.hyroxresultsapi.com',
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function main() {
  console.log('🚀 Starting rank recalculation for all races...');
  const racesRes = await db.execute('SELECT DISTINCT race_id FROM hyrox_athlete_results ORDER BY race_id ASC');
  const raceIds = racesRes.rows.map(r => String(r.race_id));
  console.log(`Found ${raceIds.length} races to process.`);

  let updatedRaces = 0;
  let totalRowsUpdated = 0;
  const startTotal = Date.now();

  for (let i = 0; i < raceIds.length; i++) {
    const raceId = raceIds[i];
    const t0 = Date.now();
    try {
      const res = await db.execute({
        sql: `
          UPDATE hyrox_athlete_results
          SET overall_rank = ranked.ov_rank,
              division_rank = ranked.ov_rank,
              age_group_rank = ranked.ag_rank
          FROM (
            SELECT id,
                   RANK() OVER (PARTITION BY race_id, division ORDER BY total_time ASC) as ov_rank,
                   RANK() OVER (PARTITION BY race_id, division, age_group ORDER BY total_time ASC) as ag_rank
            FROM hyrox_athlete_results
            WHERE race_id = ? AND total_time IS NOT NULL AND total_time != ''
          ) as ranked
          WHERE hyrox_athlete_results.id = ranked.id
        `,
        args: [raceId]
      });

      const count = res.rowsAffected || 0;
      totalRowsUpdated += count;
      updatedRaces++;
      if (i % 10 === 0 || i === raceIds.length - 1 || count > 5000) {
        console.log(`[${i + 1}/${raceIds.length}] ${raceId}: updated ${count} rows in ${Date.now() - t0}ms`);
      }
    } catch (err) {
      console.error(`❌ Error updating race ${raceId}:`, err.message);
    }
  }

  console.log(`\n🎉 Completed! Updated ${updatedRaces} races (${totalRowsUpdated.toLocaleString()} athletes) in ${((Date.now() - startTotal) / 1000).toFixed(1)}s`);
}

main().catch(console.error);
