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

async function updateRaceTotal() {
  // Update athletes_count to 3158
  await runQuery(`
    UPDATE hyrox_races
    SET athletes_count = 3158
    WHERE id = 'buenos-aires-2026';
  `);
  console.log('✅ Updated buenos-aires-2026 athletes_count to 3158 in hyrox_races table.');
}

updateRaceTotal().catch(console.error);
