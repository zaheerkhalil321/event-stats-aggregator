import dotenv from 'dotenv';
import { createClient } from '@libsql/client';

dotenv.config();

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

if (!PROJECT_REF || !TOKEN || !TURSO_URL || !TURSO_TOKEN) {
  console.error("❌ Missing Supabase or Turso credentials in .env");
  process.exit(1);
}

const turso = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

async function querySupabase(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Supabase query failed (${res.status}): ${txt}`);
  }
  return await res.json();
}

function formatInterval(val) {
  if (!val) return null;
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const hours = String(val.hours || 0).padStart(2, '0');
    const minutes = String(val.minutes || 0).padStart(2, '0');
    const seconds = String(val.seconds || 0).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
  }
  return String(val);
}

async function migrateRaces() {
  console.log("\n📋 Step 1: Migrating Races...");
  const races = await querySupabase("SELECT * FROM hyrox_races ORDER BY date ASC;");
  console.log(`Fetched ${races.length} races from Supabase.`);

  const batch = races.map(r => ({
    sql: `INSERT OR REPLACE INTO hyrox_races (
      id, name, city, country, country_code, venue, date, season, status,
      registration_url, image_url, athletes_count, city_code, end_date,
      course_map_url, lap_instructions, athlete_guide_url, lat, lng,
      schedule_url, venue_name, sponsor_name, event_page_url, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    args: [
      r.id, r.name, r.city, r.country, r.country_code, r.venue, r.date, r.season, r.status,
      r.registration_url, r.image_url, r.athletes_count || 0, r.city_code, r.end_date,
      r.course_map_url, r.lap_instructions, r.athlete_guide_url, r.lat, r.lng,
      r.schedule_url, r.venue_name, r.sponsor_name, r.event_page_url, r.created_at, r.updated_at
    ]
  }));

  await turso.batch(batch, "write");
  console.log(`✅ Successfully migrated all ${races.length} races to Turso!`);
}

async function migrateAthletes() {
  console.log("\n🏃 Step 2: Migrating Athlete Results (High-Speed Multi-Threaded)...");

  const countData = await querySupabase("SELECT count(*) as total FROM hyrox_athlete_results;");
  const totalAthletes = parseInt(countData[0].total, 10);
  console.log(`Total Athletes in Supabase to migrate: ${totalAthletes.toLocaleString()}`);

  const tursoCountRes = await turso.execute("SELECT count(*) as cnt, COALESCE(max(id), 0) as max_id FROM hyrox_athlete_results;");
  let currentTursoCount = Number(tursoCountRes.rows[0].cnt);
  let lastId = Number(tursoCountRes.rows[0].max_id);

  console.log(`Currently in Turso: ${currentTursoCount.toLocaleString()} (Starting from Supabase ID > ${lastId})`);

  const FETCH_SIZE = 1600;
  const WORKER_CHUNK = 200;
  const startTime = Date.now();
  let migratedInThisRun = 0;

  while (true) {
    const query = `
      SELECT 
        id, race_id, bib_number, full_name, nationality, gender, age_group, division,
        total_time::text, overall_rank, gender_rank, division_rank, age_group_rank,
        run_1::text, run_2::text, run_3::text, run_4::text, run_5::text, run_6::text, run_7::text, run_8::text,
        skierg::text, sled_push::text, sled_pull::text, burpee_jumps::text, rowing::text,
        farmers_carry::text, sandbag_lunges::text, wall_balls::text, roxzone::text,
        created_at::text, updated_at::text
      FROM hyrox_athlete_results
      WHERE id > ${lastId}
      ORDER BY id ASC
      LIMIT ${FETCH_SIZE};
    `;

    const rows = await querySupabase(query);
    if (!rows || rows.length === 0) {
      console.log("\n🎉 All athlete rows have been fetched from Supabase!");
      break;
    }

    // Split rows into parallel worker chunks
    const tasks = [];
    for (let i = 0; i < rows.length; i += WORKER_CHUNK) {
      const chunk = rows.slice(i, i + WORKER_CHUNK);
      const statements = chunk.map(a => ({
        sql: `INSERT OR IGNORE INTO hyrox_athlete_results (
          id, race_id, bib_number, full_name, nationality, gender, age_group, division,
          total_time, overall_rank, gender_rank, division_rank, age_group_rank,
          run_1, run_2, run_3, run_4, run_5, run_6, run_7, run_8,
          skierg, sled_push, sled_pull, burpee_jumps, rowing,
          farmers_carry, sandbag_lunges, wall_balls, roxzone,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        args: [
          a.id, a.race_id, a.bib_number, a.full_name, a.nationality, a.gender, a.age_group, a.division,
          formatInterval(a.total_time), a.overall_rank, a.gender_rank, a.division_rank, a.age_group_rank,
          formatInterval(a.run_1), formatInterval(a.run_2), formatInterval(a.run_3), formatInterval(a.run_4),
          formatInterval(a.run_5), formatInterval(a.run_6), formatInterval(a.run_7), formatInterval(a.run_8),
          formatInterval(a.skierg), formatInterval(a.sled_push), formatInterval(a.sled_pull),
          formatInterval(a.burpee_jumps), formatInterval(a.rowing), formatInterval(a.farmers_carry),
          formatInterval(a.sandbag_lunges), formatInterval(a.wall_balls), formatInterval(a.roxzone),
          a.created_at, a.updated_at
        ]
      }));

      tasks.push(turso.batch(statements, "write"));
    }

    await Promise.all(tasks);

    lastId = rows[rows.length - 1].id;
    migratedInThisRun += rows.length;
    const totalDone = currentTursoCount + migratedInThisRun;
    const pct = ((totalDone / totalAthletes) * 100).toFixed(1);
    const elapsedSec = (Date.now() - startTime) / 1000;
    const speed = (migratedInThisRun / elapsedSec).toFixed(0);
    const remainingSec = speed > 0 ? Math.round((totalAthletes - totalDone) / speed) : 0;
    const etaMin = Math.floor(remainingSec / 60);
    const etaSec = remainingSec % 60;

    process.stdout.write(`\r🚀 Migrated: ${totalDone.toLocaleString()} / ${totalAthletes.toLocaleString()} (${pct}%) | Speed: ${speed} rows/s | ETA: ${etaMin}m ${etaSec}s`);
  }

  console.log("\n\n✅ Athlete Migration Complete!");
  const finalTursoCount = await turso.execute("SELECT count(*) as cnt FROM hyrox_athlete_results;");
  console.log(`📊 Final Count in Turso: ${Number(finalTursoCount.rows[0].cnt).toLocaleString()} rows`);
}

async function run() {
  console.log("==========================================");
  console.log("⚡ SUPABASE -> TURSO HIGH-SPEED MIGRATION");
  console.log("==========================================");
  await migrateRaces();
  await migrateAthletes();
  console.log("==========================================");
  console.log("🏆 MIGRATION 100% FINISHED!");
  console.log("==========================================");
}

run().catch(err => {
  console.error("\n❌ Migration error:", err);
  process.exit(1);
});
