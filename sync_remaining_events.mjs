#!/usr/bin/env node
/**
 * sync_remaining_events.mjs
 * Pipeline to ingest remaining Season 8 HYROX races.
 * Automatically skips completed races (Buenos Aires, Berlin, New York, Rimini).
 *
 * Usage:
 *   SUPABASE_ACCESS_TOKEN=xxx node sync_remaining_events.mjs
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
  console.error('   Please run with: SUPABASE_ACCESS_TOKEN=xxx node sync_remaining_events.mjs\n');
  process.exit(1);
}

// Skip list of protected completed events
const EXCLUDE_RACE_IDS = new Set([
  'buenos-aires-2026',
  'berlin-2026',
  'new-york-2026',
  'rimini-2026'
]);

const SEASON_URL = 'https://results.hyrox.com/season-8/';

const VENUE_CATALOG = {
  'stockholm': { venue: 'Stockholmsmässan', country: 'Sweden', code: 'SE' },
  'helsinki': { venue: 'Messukeskus Helsinki', country: 'Finland', code: 'FI' },
  'cardiff': { venue: 'Principality Stadium', country: 'United Kingdom', code: 'GB' },
  'lisboa': { venue: 'FIL - Feira Internacional de Lisboa', country: 'Portugal', code: 'PT' },
  'paris': { venue: 'Paris Expo Porte de Versailles', country: 'France', code: 'FR' },
  'warsaw': { venue: 'Expo XXI Warszawa', country: 'Poland', code: 'PL' },
  'cologne': { venue: 'Koelnmesse', country: 'Germany', code: 'DE' },
  'malaga': { venue: 'FYCMA - Palacio de Ferias y Congresos', country: 'Spain', code: 'ES' },
  'lyon': { venue: 'Eurexpo Lyon', country: 'France', code: 'FR' },
  'johannesburg': { venue: 'Johannesburg Expo Centre', country: 'South Africa', code: 'ZA' },
  'puebla': { venue: 'Expositor Puebla', country: 'Mexico', code: 'MX' },
  'incheon': { venue: 'Songdo Convensia', country: 'South Korea', code: 'KR' },
  'ottawa': { venue: 'EY Centre Ottawa', country: 'Canada', code: 'CA' },
  'shanghai': { venue: 'National Exhibition and Convention Center', country: 'China', code: 'CN' },
  'heerenveen': { venue: 'Thialf Ice Stadium', country: 'Netherlands', code: 'NL' },
  'barcelona': { venue: 'Fira de Barcelona', country: 'Spain', code: 'ES' },
  'riga': { venue: 'Kipsala International Exhibition Centre', country: 'Latvia', code: 'LV' },
};

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

function generateRaceId(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  console.log('='.repeat(65));
  console.log('🚀 HYROX SEASON 8 - REMAINING RACES INGESTION PIPELINE');
  console.log('='.repeat(65) + '\n');

  console.log('🛡️ Protected / Excluded completed races:');
  EXCLUDE_RACE_IDS.forEach((id) => console.log(`   • [${id}] (Skipped)`));
  console.log('');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log(`🔍 Discovering events from ${SEASON_URL}...`);
    await page.goto(SEASON_URL, { waitUntil: 'networkidle' });

    const eventOptions = await page.$$eval('select[name="event_main_group"] option', (opts) =>
      opts.map((o) => ({ value: o.value, text: o.textContent.trim() }))
    );

    const validEvents = eventOptions.filter((e) => e.value && e.value !== '' && !e.text.includes('Choose'));
    console.log(`Discovered ${validEvents.length} total events in Season 8.`);

    const eventsToProcess = validEvents.filter((e) => {
      const raceId = generateRaceId(e.text);
      return !EXCLUDE_RACE_IDS.has(raceId) && !EXCLUDE_RACE_IDS.has(generateRaceId(e.value));
    });

    console.log(`\n📋 Processing ${eventsToProcess.length} remaining races...\n`);

    for (let idx = 0; idx < eventsToProcess.length; idx++) {
      const ev = eventsToProcess[idx];
      const raceId = generateRaceId(ev.text);
      const cleanCity = ev.text.replace(/\d{4}/g, '').replace(/[-_]/g, ' ').trim();

      console.log(`\n[${idx + 1}/${eventsToProcess.length}] Ingesting: "${ev.text}" (${raceId})...`);

      await page.selectOption('select[name="event_main_group"]', ev.value);
      await page.waitForTimeout(500);

      const submitBtn = page.locator('input[type="submit"], button[type="submit"], #submit');
      if (await submitBtn.count() > 0) {
        await submitBtn.first().click();
        await page.waitForLoadState('networkidle');
      }

      const cityKey = cleanCity.toLowerCase().replace(/[^a-z]/g, '');
      const venueInfo = VENUE_CATALOG[cityKey] || { venue: `${cleanCity} Expo Center`, country: 'International', code: 'XX' };

      // Upsert Race in hyrox_races
      await runQuery(`
        INSERT INTO hyrox_races (
          id, name, city, country, country_code, venue, date, end_date, season, status
        ) VALUES (
          ${esc(raceId)}, ${esc(`HYROX ${cleanCity} 2026`)}, ${esc(cleanCity)},
          ${esc(venueInfo.country)}, ${esc(venueInfo.code)}, ${esc(venueInfo.venue)},
          '2026-06-01', '2026-06-02', '25/26', 'completed'
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          venue = EXCLUDED.venue,
          updated_at = NOW();
      `);

      const eventSelect = page.locator('select[name="event"]');
      if (await eventSelect.count() > 0) {
        const divisions = await eventSelect.locator('option').allInnerTexts();
        const divValues = await eventSelect.locator('option').evaluateAll((opts) => opts.map((o) => o.value));

        let totalAthletesForRace = 0;

        for (let d = 0; d < divisions.length; d++) {
          const divName = divisions[d].trim();
          const divVal = divValues[d];
          if (!divVal || !divName || divName.includes('Choose')) continue;

          await eventSelect.selectOption(divVal);
          await page.waitForLoadState('networkidle');
          await page.waitForTimeout(600);

          let pageNum = 1;
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
                    race_id: raceId,
                    full_name: name,
                    nationality: nat,
                    age_group: ageGroup,
                    division: divName,
                    total_time: totalTime,
                    overall_rank: place,
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

              totalAthletesForRace += athletesBatch.length;
            }

            const nextBtn = page.locator('a:has-text(">"), a.next, .pagination-next a');
            if (await nextBtn.count() > 0 && await nextBtn.first().isVisible() && pageNum < 150) {
              pageNum++;
              await nextBtn.first().click();
              await page.waitForLoadState('networkidle');
              await page.waitForTimeout(600);
            } else {
              break;
            }
          }
        }

        await runQuery(`
          UPDATE hyrox_races 
          SET athletes_count = ${totalAthletesForRace}, updated_at = NOW()
          WHERE id = ${esc(raceId)};
        `);

        console.log(`   🎉 Finished: [${raceId}] -> ${totalAthletesForRace} athletes synced.`);
      }
    }

    console.log(`\n🏆 ALL REMAINING SEASON 8 RACES SUCCESSFULLY SYNCED!`);

  } catch (err) {
    console.error('\n💥 Error during remaining sync:', err.message);
  } finally {
    await browser.close();
  }
}

main();
