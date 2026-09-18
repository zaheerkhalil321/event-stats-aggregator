import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  console.error("❌ Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in .env");
  process.exit(1);
}

const client = createClient({ url, authToken });

async function setup() {
  console.log("🔌 Connecting to Turso:", url);

  // 1. Create hyrox_races table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS hyrox_races (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      country TEXT NOT NULL,
      country_code TEXT NOT NULL,
      venue TEXT,
      date TEXT NOT NULL,
      season TEXT,
      status TEXT DEFAULT 'upcoming',
      registration_url TEXT,
      image_url TEXT,
      athletes_count INTEGER DEFAULT 0,
      city_code TEXT,
      end_date TEXT,
      course_map_url TEXT,
      lap_instructions TEXT,
      athlete_guide_url TEXT,
      lat REAL,
      lng REAL,
      schedule_url TEXT,
      venue_name TEXT,
      sponsor_name TEXT,
      event_page_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
  console.log("✅ hyrox_races table verified/created");

  // 2. Create hyrox_athlete_results table
  await client.execute(`
    CREATE TABLE IF NOT EXISTS hyrox_athlete_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      race_id TEXT NOT NULL REFERENCES hyrox_races(id) ON DELETE CASCADE,
      bib_number TEXT,
      full_name TEXT NOT NULL,
      nationality TEXT,
      gender TEXT,
      age_group TEXT,
      division TEXT NOT NULL,
      total_time TEXT,
      overall_rank INTEGER,
      gender_rank INTEGER,
      division_rank INTEGER,
      age_group_rank INTEGER,
      run_1 TEXT,
      run_2 TEXT,
      run_3 TEXT,
      run_4 TEXT,
      run_5 TEXT,
      run_6 TEXT,
      run_7 TEXT,
      run_8 TEXT,
      skierg TEXT,
      sled_push TEXT,
      sled_pull TEXT,
      burpee_jumps TEXT,
      rowing TEXT,
      farmers_carry TEXT,
      sandbag_lunges TEXT,
      wall_balls TEXT,
      roxzone TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (race_id, full_name, division)
    );
  `);
  console.log("✅ hyrox_athlete_results table verified/created");

  // 3. Create Fast Performance Indexes
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_race_id ON hyrox_athlete_results(race_id);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_division ON hyrox_athlete_results(race_id, division);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_overall_rank ON hyrox_athlete_results(race_id, overall_rank);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_total_time ON hyrox_athlete_results(race_id, total_time);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_full_name ON hyrox_athlete_results(full_name COLLATE NOCASE);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_races_date ON hyrox_races(date);`);
  await client.execute(`CREATE INDEX IF NOT EXISTS idx_turso_races_status ON hyrox_races(status);`);

  console.log("✅ All performance indexes created successfully");

  // Test query
  const testRes = await client.execute("SELECT 1 as connected;");
  console.log("🎉 Turso Connection & Schema Setup SUCCESSFUL! Test Result:", testRes.rows);
}

setup().catch(err => {
  console.error("❌ Setup failed:", err);
  process.exit(1);
});
