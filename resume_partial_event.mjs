#!/usr/bin/env node
/**
 * resume_partial_event.mjs
 * Hardened Smart Resume Scraper for Partial HYROX Races (e.g. Rimini 2026, Berlin 2025).
 * 
 * Features:
 *   • Overall-Priority Resolution (prevents day-specific duplicate overcounting)
 *   • Maps only standard 12 divisions (PRO MEN/WOMEN, MEN/WOMEN, DOUBLES, RELAYS)
 *   • Checkpoints via DB query to skip already completed divisions
 *   • Zero hardcoded secrets (process.env.SUPABASE_ACCESS_TOKEN only)
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

// Standard 12 HYROX Divisions & their matching targets
const STANDARD_DIVISIONS = [
  { label: 'HYROX PRO MEN', sex: 'M', event: 'HYROX PRO' },
  { label: 'HYROX PRO WOMEN', sex: 'W', event: 'HYROX PRO' },
  { label: 'HYROX MEN', sex: 'M', event: 'HYROX' },
  { label: 'HYROX WOMEN', sex: 'W', event: 'HYROX' },
  { label: 'HYROX PRO DOUBLES MEN', sex: 'M', event: 'HYROX PRO DOUBLES' },
  { label: 'HYROX PRO DOUBLES WOMEN', sex: 'W', event: 'HYROX PRO DOUBLES' },
  { label: 'HYROX DOUBLES MEN', sex: 'M', event: 'HYROX DOUBLES' },
  { label: 'HYROX DOUBLES WOMEN', sex: 'W', event: 'HYROX DOUBLES' },
  { label: 'HYROX DOUBLES MIXED', sex: 'X', event: 'HYROX DOUBLES' },
  { label: 'HYROX TEAM RELAY MEN', sex: 'M', event: 'HYROX TEAM RELAY' },
  { label: 'HYROX TEAM RELAY WOMEN', sex: 'W', event: 'HYROX TEAM RELAY' },
  { label: 'HYROX TEAM RELAY MIXED', sex: 'X', event: 'HYROX TEAM RELAY' }
];

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

async function main() {
  console.log('='.repeat(68));
  console.log(`⚡ HYROX SMART RESUME PIPELINE -> Target: [${RACE_ID}]`);
  console.log(`🌐 Season URL: ${SEASON_URL} | Search: "${EVENT_SEARCH}"`);
  console.log('='.repeat(68) + '\n');

  const existingStats = await runQuery(`
    SELECT division, count(*) as count 
    FROM hyrox_athlete_results 
    WHERE race_id = ${esc(RACE_ID)}
    GROUP BY division;
  `);

  const alreadyDoneDivisions = new Set(
    (existingStats || []).filter((r) => Number(r.count) > 0).map((r) => r.division.trim().toUpperCase())
  );

  console.log('📊 Current verified database status:');
  if (alreadyDoneDivisions.size === 0) {
    console.log('   (Starting fresh - 0 completed divisions)\n');
  } else {
    alreadyDoneDivisions.forEach((d) => {
      const cnt = existingStats.find((s) => s.division.trim().toUpperCase() === d)?.count;
      console.log(`   ✅ ${d}: ${cnt} athletes`);
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

    // Get all available division options from Mika Timing
    const dropdownOptions = await page.$$eval('select[name="event"] option', (opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );

    console.log(`\n📋 Discovered ${dropdownOptions.length} raw division options. Resolving Overall-priority mappings...\n`);

    for (const div of STANDARD_DIVISIONS) {
      if (alreadyDoneDivisions.has(div.label.toUpperCase())) {
        console.log(`⏩ [SKIP] "${div.label}" is already completed in DB.`);
        continue;
      }

      // ─── OVERALL-PRIORITY RESOLUTION ─────────────────────────────────────────
      // 1. Check for multi-day Overall option (e.g. "HYROX - Overall" or "HYROX PRO - Overall")
      const expectedEvent = div.event.toUpperCase();
      let matchedVal = null;
      let matchedText = null;

      const overallOpt = dropdownOptions.find((o) => {
        const t = o.text.toUpperCase().trim();
        const isOverall = t.includes('OVERALL') || o.value.endsWith('_OVERALL');
        const beforeOverall = t.replace(/\s*[-–(]?\s*OVERALL\s*\)?$/i, '').trim();
        return isOverall && beforeOverall === expectedEvent;
      });

      if (overallOpt) {
        matchedVal = overallOpt.value;
        matchedText = overallOpt.text;
      } else {
        // 2. Standard single-weekend exact match
        const exactOpt = dropdownOptions.find((o) => o.text.toUpperCase().trim() === expectedEvent);
        if (exactOpt) {
          matchedVal = exactOpt.value;
          matchedText = exactOpt.text;
        }
      }

      if (!matchedVal) {
        console.log(`⚠️  Division "${div.label}" not offered at this event.`);
        continue;
      }

      console.log(`\n-----------------------------------------------------------`);
      console.log(`📥 [RESUMING] ${div.label} -> Mapped to: "${matchedText}" (Sex: ${div.sex})`);
      console.log(`-----------------------------------------------------------`);

      // Select division
      await page.selectOption('select[name="event"]', matchedVal);
      await page.waitForTimeout(500);

      // Select gender / sex if available
      const sexSelect = page.locator('select[name="sex"]');
      if (await sexSelect.count() > 0 && div.sex) {
        try {
          await sexSelect.selectOption(div.sex);
          await page.waitForTimeout(400);
        } catch (_) {}
      }

      const searchBtn = page.locator('input[type="submit"], button[type="submit"], #submit');
      if (await searchBtn.count() > 0) {
        await searchBtn.first().click();
        await page.waitForLoadState('networkidle');
      }

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
                division: div.label, // Stored strictly with standard division name!
                total_time: totalTime,
                overall_rank: place,
                gender: div.sex === 'W' ? 'F' : (div.sex === 'X' ? 'X' : 'M')
              });
            }
          } catch (_) {}
        }

        if (athletesBatch.length > 0) {
          const rowSql = athletesBatch.map((a) => `(
            ${esc(a.race_id)}, ${esc(a.full_name)}, ${esc(a.nationality)},
            ${esc(a.gender)}, ${esc(a.age_group)}, ${esc(a.division)},
            ${esc(a.total_time)}, ${a.overall_rank ?? 'NULL'}
          )`).join(',');

          await runQuery(`
            INSERT INTO hyrox_athlete_results (
              race_id, full_name, nationality, gender, age_group, division, total_time, overall_rank
            ) VALUES ${rowSql}
            ON CONFLICT (race_id, full_name, division) DO UPDATE SET
              total_time = EXCLUDED.total_time,
              overall_rank = EXCLUDED.overall_rank,
              updated_at = NOW();
          `);

          totalAthletesForDiv += athletesBatch.length;
          console.log(`   Page ${pageNum}: Synced ${athletesBatch.length} athletes.`);
        }

        const nextBtn = page.locator('a:has-text(">"), a.next, .pagination-next a');
        const hasNext = await nextBtn.count() > 0 && await nextBtn.first().isVisible();

        if (hasNext && pageNum < 250) {
          pageNum++;
          await nextBtn.first().click();
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(800);
        } else {
          break;
        }
      }

      console.log(`✅ Completed ${div.label} -> Synced ${totalAthletesForDiv} athletes.`);
    }

    // Update verified total athletes count on hyrox_races
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
