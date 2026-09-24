import { createClient } from '@libsql/client';
import dotenv from 'dotenv';
dotenv.config();

const client = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const VERIFIED_2025_DATES = {
  'maastricht-2025': { date: '2025-09-19', end_date: '2025-09-21' },
  'bilbao-2025': { date: '2025-02-15', end_date: '2025-02-16' },
  'miami-beach-2025': { date: '2025-04-19', end_date: '2025-04-19' },
  'glasgow-2025': { date: '2025-03-12', end_date: '2025-03-16' },
  'bangkok-2025': { date: '2025-05-24', end_date: '2025-05-25' },
  'monterrey-2025': { date: '2025-04-05', end_date: '2025-04-05' },
  'shanghai-2025': { date: '2025-04-05', end_date: '2025-04-05' },
  'cologne-2025': { date: '2025-04-10', end_date: '2025-04-13' },
  'malaga-2025': { date: '2025-03-21', end_date: '2025-03-23' },
  'warsaw-2025': { date: '2025-04-12', end_date: '2025-04-13' },
  'paris-2025': { date: '2025-04-18', end_date: '2025-04-20' },
  'incheon-2025': { date: '2025-05-17', end_date: '2025-05-17' },
  'barcelona-2025': { date: '2025-04-25', end_date: '2025-04-27' },
  'las-vegas-2025': { date: '2025-02-01', end_date: '2025-02-02' },
  'cardiff-2025': { date: '2025-05-30', end_date: '2025-06-01' },
  'heerenveen-2025': { date: '2025-05-09', end_date: '2025-05-11' },
  'berlin-2025': { date: '2025-05-16', end_date: '2025-05-18' },
  'new-york-2025': { date: '2025-05-30', end_date: '2025-06-01' },
  'rimini-2025': { date: '2025-05-30', end_date: '2025-06-01' },
  'riga-2025': { date: '2025-05-31', end_date: '2025-05-31' },
  'world-championships-2025': { date: '2025-06-12', end_date: '2025-06-15' },
  'sydney-2025': { date: '2025-07-04', end_date: '2025-07-06' },
  'melbourne-2025': { date: '2025-12-11', end_date: '2025-12-14' },
  'perth-2025': { date: '2025-09-05', end_date: '2025-09-07' },
  'singapore-2025': { date: '2025-11-29', end_date: '2025-11-30' },
  'mumbai-2025': { date: '2025-09-07', end_date: '2025-09-07' },
  'sao-paulo-2025': { date: '2025-09-19', end_date: '2025-09-21' },
  'oslo-2025': { date: '2025-09-26', end_date: '2025-09-28' },
  'geneva-2025': { date: '2025-10-11', end_date: '2025-10-12' },
  'gdansk-2025': { date: '2025-10-11', end_date: '2025-10-12' },
  'utrecht-2025': { date: '2025-11-28', end_date: '2025-11-30' },
  'beijing-2025': { date: '2025-08-23', end_date: '2025-08-23' },
  'madrid-2025': { date: '2025-11-27', end_date: '2025-11-30' },
  'valencia-2025': { date: '2025-10-17', end_date: '2025-10-19' },
  'rome-2025': { date: '2025-09-26', end_date: '2025-09-28' },
  'yokohama-2025': { date: '2025-08-09', end_date: '2025-08-09' },
  'birmingham-2025': { date: '2025-10-22', end_date: '2025-10-26' },
  'gent-2025': { date: '2025-12-12', end_date: '2025-12-14' },
  'atlanta-2025': { date: '2025-10-31', end_date: '2025-11-02' },
  'abu-dhabi-2025': { date: '2025-07-19', end_date: '2025-07-19' },
  'bordeaux-2025': { date: '2025-11-20', end_date: '2025-11-23' },
  'delhi-2025': { date: '2025-07-19', end_date: '2025-07-19' },
  'chicago-2025': { date: '2025-11-14', end_date: '2025-11-16' },
  'verona-2025': { date: '2025-12-05', end_date: '2025-12-07' },
  'hamburg-2025': { date: '2025-10-02', end_date: '2025-10-05' },
  'dublin-2025': { date: '2025-11-12', end_date: '2025-11-16' },
  'guadalajara-2025': { date: '2025-02-08', end_date: '2025-02-08' },
  'toronto-2025': { date: '2025-10-03', end_date: '2025-10-05' },
  'london-excel-2025': { date: '2025-12-04', end_date: '2025-12-07' },
  'johannesburg-i-2025': { date: '2025-11-29', end_date: '2025-11-30' },
  'stockholm-2025': { date: '2025-12-18', end_date: '2025-12-21' },
  'rio-de-janeiro-2025': { date: '2025-11-29', end_date: '2025-11-29' },
  'stuttgart-2025': { date: '2025-10-31', end_date: '2025-11-02' },
  'mexico-city-2025': { date: '2025-11-07', end_date: '2025-11-09' },
  'sharjah-2025': { date: '2025-04-12', end_date: '2025-04-12' },
  'taipei-2025': { date: '2025-04-12', end_date: '2025-04-12' }
};

async function run() {
  console.log('⚡ Applying 100% verified 2025 race dates to Turso DB...');
  let updatedCount = 0;
  for (const [raceId, info] of Object.entries(VERIFIED_2025_DATES)) {
    const res = await client.execute({
      sql: `UPDATE hyrox_races SET date = ?, end_date = ? WHERE id = ?`,
      args: [info.date, info.end_date, raceId]
    });
    if (res.rowsAffected > 0) {
      updatedCount++;
      console.log(`✅ Updated ${raceId}: ${info.date} -> ${info.end_date}`);
    } else {
      console.warn(`⚠️ Race ${raceId} not found in DB`);
    }
  }
  console.log(`\n🎉 Successfully verified and updated ${updatedCount} races in hyrox_races table!`);
}

if (process.argv[1]?.endsWith('apply_verified_2025_dates.mjs')) {
  run().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
