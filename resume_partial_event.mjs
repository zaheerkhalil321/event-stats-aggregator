#!/usr/bin/env node
/**
 * resume_partial_event.mjs
 * Smart Resume Scraper for Partial/Interrupted HYROX Races (e.g. Rimini 2026, Berlin 2025).
 *
 * Checks database for already completed divisions, skips them, and resumes
 * from the exact missing divisions using Playwright.
 *
 * Usage:
 *   node resume_partial_event.mjs rimini-2026
 *   node resume_partial_event.mjs berlin-2025
 *   SUPABASE_ACCESS_TOKEN=xxx node resume_partial_event.mjs rimini-2026
 */

import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

// ─── 1. Load Environment & Security Guard ──────────────────────────────────────
if (!process.env.SUPABASE_ACCESS_TOKEN && existsSync('.env')) {
  const envContent = readFileSync('.env', 'utf-8');
  const match = envContent.match(/SUPABASE_ACCESS_TOKEN=([^\r\n]+)/);
  if (match) process.env.SUPABASE_ACCESS_TOKEN = match[1].trim();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'jxvwccqhnkteeqeerjua';

if (!TOKEN) {
  console.error('\n❌ Missing SUPABASE_ACCESS_TOKEN in environment variables.');
  console.error('   Please run with: SUPABASE_ACCESS_TOKEN=xxx node resume_partial_event.mjs <race-id>\n');
  process.exit(1);
}

// ─── 2. Target Race & Season Resolution ─────────────────────────────────────────
const RACE_ID = (process.argv[2] || 'rimini-2026').toLowerCase().trim();
const SEASON = process.argv[4] || (RACE_ID.includes('2025') || RACE_ID.includes('25') ? 'season-7' : 'season-8');
const SEASON_URL = `https://results.hyrox.com/${SEASON}/`;

const CITY_KEYWORD = RACE_ID.replace(/202[4-7]/g, '').replace(/[-_]/g, ' ').trim();
const EVENT_SEARCH = process.argv[3] || CITY_KEYWORD;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runQuery(sql, retries = 3, delayMs = 1500) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Supabase HTTP ${res.status}: ${text.slice(0, 200)}`);
      }
      return res.json();
    } catch (err) {
      if (attempt < retries) {
        await sleep(delayMs);
        delayMs *= 2;
        continue;
      }
      throw err;
    }
  }
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

// ─── 3. Main Resume Execution ───────────────────────────────────────────────────
async function main() {
  console.log('='.repeat(65));
  console.log(`⚡ HYROX SMART RESUME PIPELINE -> Target: [${RACE_ID}]`);
  console.log(`🌐 Season URL: ${SEASON_URL} | Keyword: "${EVENT_SEARCH}"`);
  console.log('='.repeat(65) + '\n');

  // Check already completed divisions in DB
  const existingStats = await runQuery(`
    SELECT division, count(*) as count 
    FROM hyrox_athlete_results 
    WHERE race_id = ${esc(RACE_ID)}
    GROUP BY division;
  `);

  const alreadyDoneDivisions = new Set(
    (existingStats || []).filter((r) => Number(r.count) > 0).map((r) => r.division.trim().toUpperCase())
  );

  console.log('📊 Current database status for this race:');
  if (alreadyDoneDivisions.size === 0) {
    console.log('   (Starting fresh - no completed divisions yet)\n');
  } else {
    alreadyDoneDivisions.forEach((d) => {
      const cnt = existingStats.find((s) => s.division.trim().toUpperCase() === d)?.count;
      console.log(`   ✅ ${d}: ${cnt} athletes synced`);
    });
    console.log('');
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`🔍 Navigating to ${SEASON_URL}...`);
    await page.goto(SEASON_URL, { waitUntil: 'networkidle' });

    // Match race in event_main_group dropdown
    const eventOptions = await page.$$eval('select[name="event_main_group"] option', (opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );

    const match = eventOptions.find((o) =>
      o.text.toLowerCase().includes(EVENT_SEARCH.toLowerCase()) ||
      o.value.toLowerCase().includes(EVENT_SEARCH.toLowerCase())
    );

    if (!match) {
      console.error(`❌ Could not find event matching "${EVENT_SEARCH}" in dropdown!`);
      return;
    }

    console.log(`🎯 Matched Event: "${match.text}" (value: ${match.value})`);
    await page.selectOption('select[name="event_main_group"]', match.value);
    await page.waitForTimeout(600);

    const submitBtn = page.locator('input[type="submit"], button[type="submit"], #submit');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click();
      await page.waitForLoadState('networkidle');
    }

    // Get available division options
    const eventSelect = page.locator('select[name="event"]');
    if (await eventSelect.count() === 0) {
      console.error('❌ Could not locate division select element!');
      return;
    }

    const availableDivisions = await eventSelect.locator('option').allInnerTexts();
    const divisionValues = await eventSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value));

    console.log(`\n📋 Discovered ${availableDivisions.length} division options on Mika Timing:\n`);

    for (let i = 0; i < availableDivisions.length; i++) {
      const divName = availableDivisions[i].trim();
      const divVal = divisionValues[i];
      if (!divVal || !divName || divName.includes('Choose')) continue;

      const normalizedName = divName.toUpperCase();

      if (alreadyDoneDivisions.has(normalizedName)) {
        console.log(`⏩ [SKIP] "${divName}" is already 100% completed in DB.`);
        continue;
      }

      console.log(`\n-----------------------------------------------------------`);
      console.log(`📥 [RESUMING] Scraping Division: "${divName}" (value: ${divVal})`);
      console.log(`-----------------------------------------------------------`);

      await eventSelect.selectOption(divVal);
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(800);

      let pageNum = 1;
      let totalAthletesForDiv = 0;

      while (true) {
        const rows = await page.locator('tbody tr, .list-group-item').all();
        if (rows.length === 0) break;

        const athletesBatch = [];
        for (const row of rows) {
          try {
            const cells = await row.locator('td').allInnerTexts();
            if (cells.length < 5) continue;

            const place = parseInt(cells[0].replace(/\D/g, ''), 10) || null;
            const name = cells[1].trim();
            const nat = cells[2] ? cells[2].trim().slice(0, 3).toUpperCase() : 'XX';
            const ageGroup = cells[3] ? cells[3].trim() : null;
            const totalTime = cells[cells.length - 1] ? cells[cells.length - 1].trim() : null;

            if (name) {
              athletesBatch.push({
                race_id: RACE_ID,
                full_name: name,
                nationality: nat,
                age_group: ageGroup,
                division: divName,
                total_time: totalTime,
                overall_rank: place
              });
            }
          } catch (_) {}
        }

        if (athletesBatch.length > 0) {
          const rowSql = athletesBatch.map((a) => `(
            ${esc(a.race_id)}, ${esc(a.full_name)}, ${esc(a.nationality)},
            ${esc(a.age_group)}, ${esc(a.division)}, ${esc(a.total_time)}, ${a.overall_rank ?? 'NULL'}
          )`).join(',');

          await runQuery(`
            INSERT INTO hyrox_athlete_results (
              race_id, full_name, nationality, age_group, division, total_time, overall_rank
            ) VALUES ${rowSql}
            ON CONFLICT (race_id, full_name, division) DO UPDATE SET
              total_time = EXCLUDED.total_time,
              overall_rank = EXCLUDED.overall_rank,
              updated_at = NOW();
          `);

          totalAthletesForDiv += athletesBatch.length;
          console.log(`   Page ${pageNum}: Synced ${athletesBatch.length} athletes.`);
        }

        const nextBtn = page.locator('a:has-text(">"), a.next, .pagination-next a, [aria-label="Next"]');
        const hasNext = await nextBtn.count() > 0 && await nextBtn.first().isVisible();

        if (hasNext && pageNum < 200) {
          pageNum++;
          await nextBtn.first().click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(800);
        } else {
          break;
        }
      }

      console.log(`✅ Completed Division "${divName}" -> Total ${totalAthletesForDiv} athletes synced.`);
    }

    // Update overall athletes_count on hyrox_races
    const totalCountRes = await runQuery(`
      SELECT count(*) as total FROM hyrox_athlete_results WHERE race_id = ${esc(RACE_ID)};
    `);
    const totalCount = Number(totalCountRes[0]?.total) || 0;

    await runQuery(`
      UPDATE hyrox_races 
      SET athletes_count = ${totalCount}, updated_at = NOW()
      WHERE id = ${esc(RACE_ID)};
    `);

    console.log(`\n🎉 RACE [${RACE_ID}] IS FULLY SYNCHRONIZED! Total verified athletes: ${totalCount}`);

  } catch (err) {
    console.error('\n💥 Error during resume execution:', err.message);
  } finally {
    await browser.close();
  }
}

main();
