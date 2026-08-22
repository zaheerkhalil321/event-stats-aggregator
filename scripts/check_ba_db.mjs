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

async function checkBuenosAiresState() {
  const divisions = await runQuery(`
    SELECT division, COUNT(*) as c, COUNT(CASE WHEN total_time IS NOT NULL THEN 1 END) as with_time
    FROM hyrox_athlete_results
    WHERE race_id = 'buenos-aires-2026'
    GROUP BY division
    ORDER BY division;
  `);

  console.log('=== BUENOS AIRES RESULTS IN DB ===');
  console.table(divisions);

  const race = await runQuery(`
    SELECT id, name, athletes_count
    FROM hyrox_races
    WHERE id = 'buenos-aires-2026';
  `);
  console.log('Race header:', race);
}

checkBuenosAiresState().catch(console.error);
