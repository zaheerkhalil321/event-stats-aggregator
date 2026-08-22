#!/usr/bin/env node
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const tokenIndex = args.indexOf('--token');
const fileIndex = args.indexOf('--file');

const TOKEN = tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.SUPABASE_ACCESS_TOKEN;
const targetFile = fileIndex !== -1 ? args[fileIndex + 1] : 'seed_official_races.sql';

if (!TOKEN) {
  console.error('\n❌ Missing Supabase Personal Access Token.');
  console.error('\n📌 Usage:');
  console.error(`   node scripts/push_sql.mjs --token sbp_your_token_here --file scripts/seed_official_races.sql\n`);
  console.error('🔗 Get your Personal Access Token in 5 seconds from:');
  console.error('   https://supabase.com/dashboard/account/tokens\n');
  process.exit(1);
}

const PROJECT_REF = 'jxvwccqhnkteeqeerjua';
const sqlPath = targetFile.startsWith('/') || targetFile.includes(':') ? targetFile : join(process.cwd(), targetFile);

let sql;
try {
  sql = readFileSync(sqlPath, 'utf-8');
  console.log(`📄 Loaded SQL: ${sqlPath}`);
} catch (err) {
  console.error(`❌ Could not read SQL file: ${sqlPath}`);
  process.exit(1);
}

async function pushSql() {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  console.log(`🚀 Executing SQL on Supabase project: ${PROJECT_REF}...`);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: sql }),
    });

    const text = await response.text();

    if (response.ok) {
      console.log('✅ SQL executed and pushed successfully!');
      console.log('🎉 232 Official Races are now live in your Supabase database!\n');
    } else {
      console.error(`❌ Failed (HTTP ${response.status}):`, text);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Network error:', err.message);
    process.exit(1);
  }
}

pushSql();
