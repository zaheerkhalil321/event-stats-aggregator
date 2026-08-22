#!/usr/bin/env node
/**
 * push_schema.mjs
 * Pushes the Supabase SQL schema directly from terminal using the Management API.
 *
 * Usage:
 *   node scripts/push_schema.mjs --token YOUR_SUPABASE_PERSONAL_ACCESS_TOKEN
 *
 * Get your Personal Access Token from:
 *   https://supabase.com/dashboard/account/tokens
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const tokenIndex = args.indexOf('--token');
const TOKEN = tokenIndex !== -1 ? args[tokenIndex + 1] : process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error('❌ Missing Personal Access Token.');
  console.error('   Usage: node scripts/push_schema.mjs --token YOUR_TOKEN');
  console.error('   Or set env: SUPABASE_ACCESS_TOKEN=YOUR_TOKEN');
  console.error('\n   Get your token from: https://supabase.com/dashboard/account/tokens');
  process.exit(1);
}

const PROJECT_REF = 'jxvwccqhnkteeqeerjua'; // Your Supabase project ref

// ── Read SQL file ──────────────────────────────────────────────────────────────
const sqlPath = join(__dirname, 'supabase_hyrox_schema.sql');
let sql;
try {
  sql = readFileSync(sqlPath, 'utf-8');
  console.log(`📄 Loaded schema: ${sqlPath}`);
  console.log(`   SQL length: ${sql.length} characters\n`);
} catch (err) {
  console.error(`❌ Could not read SQL file: ${sqlPath}`);
  console.error('   Make sure supabase_hyrox_schema.sql is in the scripts/ folder.');
  process.exit(1);
}

// ── Push to Supabase Management API ───────────────────────────────────────────
async function pushSchema() {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

  console.log(`🚀 Pushing schema to Supabase project: ${PROJECT_REF}`);
  console.log(`   Endpoint: ${url}\n`);

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
      console.log('✅ Schema pushed successfully!\n');
      console.log('   Tables created:');
      console.log('   ✓ hyrox_races');
      console.log('   ✓ hyrox_athlete_results');
      console.log('   ✓ Indexes, RLS policies, and triggers\n');
      console.log('Next step: python scripts/sync_hyrox.py');
    } else {
      console.error(`❌ Failed (HTTP ${response.status}):`);
      try {
        const json = JSON.parse(text);
        console.error(JSON.stringify(json, null, 2));
      } catch {
        console.error(text);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Network error:', err.message);
    process.exit(1);
  }
}

pushSchema();
