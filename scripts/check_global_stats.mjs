import { readFileSync, existsSync } from 'fs';

if (!process.env.SUPABASE_ACCESS_TOKEN && existsSync('.env')) {
  const envContent = readFileSync('.env', 'utf-8');
  const match = envContent.match(/SUPABASE_ACCESS_TOKEN=([^\r\n]+)/);
  if (match) process.env.SUPABASE_ACCESS_TOKEN = match[1].trim();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'jxvwccqhnkteeqeerjua';

async function runQuery(sql) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql }),
    }
  );
  return res.json();
}

async function checkGlobalStats() {
  const totalResults = await runQuery('SELECT count(*) as total_results FROM hyrox_athlete_results');
  const uniqueAthletes = await runQuery('SELECT count(DISTINCT name) as unique_athletes FROM hyrox_athlete_results');
  const sumAthletes = await runQuery('SELECT sum(athletes_count) as total_attendance FROM hyrox_races WHERE status = \'completed\'');
  const races = await runQuery('SELECT id, name, athletes_count FROM hyrox_races WHERE athletes_count > 0 ORDER BY athletes_count DESC');

  console.log('Total Results Rows:', totalResults);
  console.log('Unique Athlete Names:', uniqueAthletes);
  console.log('Sum Attendance across completed races:', sumAthletes);
  console.log('Races with athlete counts:');
  console.table(races);
}

checkGlobalStats().catch(console.error);
