import { createClient } from '@libsql/client';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8');
const urlMatch = env.match(/TURSO_DATABASE_URL=(.+)/);
const tokenMatch = env.match(/TURSO_AUTH_TOKEN=(.+)/);

const client = createClient({
  url: urlMatch[1].trim(),
  authToken: tokenMatch[1].trim(),
});

async function main() {
  console.log('🚀 Starting Turso duplicate cleanup...');

  // 1. Verify duplicates count
  const check = await client.execute("SELECT COUNT(*) as count FROM hyrox_athlete_results WHERE created_at >= '2026-09-22 22:00:00'");
  const dupCount = check.rows[0].count;
  console.log(`Found ${dupCount} duplicate rows to delete.`);

  if (dupCount === 0) {
    console.log('No duplicates found. Exiting.');
    return;
  }

  // 2. Delete duplicates
  console.log('🗑️ Deleting duplicate rows...');
  const delRes = await client.execute("DELETE FROM hyrox_athlete_results WHERE created_at >= '2026-09-22 22:00:00'");
  console.log(`✅ Deleted successfully! Rows affected: ${delRes.rowsAffected}`);

  // 3. Recalculate athletes_count for all races
  console.log('🔄 Recalculating athletes_count for all races...');
  await client.execute(`
    UPDATE hyrox_races 
    SET athletes_count = (
      SELECT COUNT(*) FROM hyrox_athlete_results WHERE race_id = hyrox_races.id
    )
  `);
  console.log('✅ Updated athletes_count on hyrox_races!');

  // 4. Verify New York 2026 count
  const ny = await client.execute("SELECT id, name, athletes_count FROM hyrox_races WHERE id = 'new-york-2026'");
  console.log('New York 2026 race info:', ny.rows[0]);

  const totalNow = await client.execute("SELECT COUNT(*) as total FROM hyrox_athlete_results");
  console.log('Total athletes in DB now:', totalNow.rows[0]);
}

main().catch(err => {
  console.error('❌ Error during cleanup:', err);
  process.exit(1);
});
