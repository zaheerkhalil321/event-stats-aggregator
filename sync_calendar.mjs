import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'fs';

// Auto-load .env
if (!process.env.SUPABASE_ACCESS_TOKEN && existsSync('.env')) {
  const envContent = readFileSync('.env', 'utf-8');
  const match = envContent.match(/SUPABASE_ACCESS_TOKEN=([^\r\n]+)/);
  if (match) process.env.SUPABASE_ACCESS_TOKEN = match[1].trim();
}

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'jxvwccqhnkteeqeerjua';

const MONTH_MAP = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12'
};

function parseDateStr(str) {
  // e.g. "21. Aug. 2026 – 23. Aug. 2026" or "10. Dec. 2026 – 13. Dec. 2026" or "15. Aug. 2026"
  const clean = str.replace(/\s+/g, ' ').trim();
  const parts = clean.split(/–|-/);

  const parseSingle = (s, fallbackYear = '2026') => {
    const m = s.trim().match(/(\d{1,2})\.\s*([A-Za-z]+)\.?\s*(\d{4})?/i);
    if (!m) return null;
    const day = m[1].padStart(2, '0');
    const monthKey = m[2].toLowerCase().slice(0, 3);
    const month = MONTH_MAP[monthKey] || '01';
    const year = m[3] || fallbackYear;
    return `${year}-${month}-${day}`;
  };

  let startDate = parseSingle(parts[0]);
  let endDate = parts[1] ? parseSingle(parts[1], startDate?.split('-')[0]) : startDate;

  if (startDate && !parts[0].match(/\d{4}/) && endDate) {
    const year = endDate.split('-')[0];
    startDate = `${year}-${startDate.slice(5)}`;
  }

  return { startDate: startDate || '2026-06-01', endDate: endDate || startDate || '2026-06-01' };
}

function getCountryByCity(city) {
  const c = (city || '').toLowerCase();
  if (c.includes('london') || c.includes('manchester') || c.includes('birmingham') || c.includes('glasgow') || c.includes('cardiff')) return { name: 'United Kingdom', code: 'GB' };
  if (c.includes('berlin') || c.includes('munich') || c.includes('cologne') || c.includes('frankfurt') || c.includes('hamburg')) return { name: 'Germany', code: 'DE' };
  if (c.includes('paris') || c.includes('nice')) return { name: 'France', code: 'FR' };
  if (c.includes('madrid') || c.includes('barcelona') || c.includes('valencia') || c.includes('malaga')) return { name: 'Spain', code: 'ES' };
  if (c.includes('milan') || c.includes('rome') || c.includes('rimini') || c.includes('turin')) return { name: 'Italy', code: 'IT' };
  if (c.includes('new york') || c.includes('chicago') || c.includes('miami') || c.includes('houston') || c.includes('atlanta') || c.includes('dallas') || c.includes('washington') || c.includes('los angeles') || c.includes('phoenix') || c.includes('las vegas') || c.includes('salt lake')) return { name: 'United States', code: 'US' };
  if (c.includes('sydney') || c.includes('melbourne') || c.includes('brisbane') || c.includes('perth')) return { name: 'Australia', code: 'AU' };
  if (c.includes('singapore')) return { name: 'Singapore', code: 'SG' };
  if (c.includes('hong kong')) return { name: 'Hong Kong', code: 'HK' };
  if (c.includes('bangkok')) return { name: 'Thailand', code: 'TH' };
  if (c.includes('dubai') || c.includes('sharjah') || c.includes('abu dhabi')) return { name: 'United Arab Emirates', code: 'AE' };
  if (c.includes('shanghai') || c.includes('beijing') || c.includes('shenzhen') || c.includes('chengdu')) return { name: 'China', code: 'CN' };
  if (c.includes('incheon') || c.includes('seoul')) return { name: 'South Korea', code: 'KR' };
  if (c.includes('taipei')) return { name: 'Taiwan', code: 'TW' };
  if (c.includes('mumbai') || c.includes('delhi')) return { name: 'India', code: 'IN' };
  if (c.includes('cape town') || c.includes('johannesburg')) return { name: 'South Africa', code: 'ZA' };
  if (c.includes('toronto')) return { name: 'Canada', code: 'CA' };
  if (c.includes('amsterdam') || c.includes('rotterdam') || c.includes('maastricht') || c.includes('heerenveen')) return { name: 'Netherlands', code: 'NL' };
  if (c.includes('vienna')) return { name: 'Austria', code: 'AT' };
  if (c.includes('warsaw') || c.includes('katowice') || c.includes('poznan')) return { name: 'Poland', code: 'PL' };
  if (c.includes('copenhagen')) return { name: 'Denmark', code: 'DK' };
  if (c.includes('stockholm')) return { name: 'Sweden', code: 'SE' };
  if (c.includes('oslo')) return { name: 'Norway', code: 'NO' };
  if (c.includes('helsinki')) return { name: 'Finland', code: 'FI' };
  if (c.includes('chiba') || c.includes('osaka') || c.includes('tokyo')) return { name: 'Japan', code: 'JP' };
  if (c.includes('istanbul') || c.includes('izmir')) return { name: 'Turkey', code: 'TR' };
  return { name: 'International', code: 'XX' };
}

const CITY_COORDINATES = {
  'buenos aires': { lat: -34.5702, lng: -58.4045 },
  'berlin': { lat: 52.5028, lng: 13.2774 },
  'rimini': { lat: 44.0678, lng: 12.5695 },
  'new york': { lat: 40.7614, lng: -73.9776 },
  'riga': { lat: 56.9535, lng: 24.1167 },
  'helsinki': { lat: 60.1920, lng: 24.9458 },
  'barcelona': { lat: 41.3851, lng: 2.1734 },
  'paris': { lat: 48.8566, lng: 2.3522 },
  'london': { lat: 51.5074, lng: -0.1278 },
  'manchester': { lat: 53.4808, lng: -2.2426 },
  'vienna': { lat: 48.2082, lng: 16.3738 },
  'chicago': { lat: 41.8781, lng: -87.6298 },
  'miami': { lat: 25.7617, lng: -80.1918 },
  'houston': { lat: 29.7604, lng: -95.3698 },
  'singapore': { lat: 1.3521, lng: 103.8198 },
  'sydney': { lat: -33.8688, lng: 151.2093 },
  'melbourne': { lat: -37.8136, lng: 144.9631 },
  'brisbane': { lat: -27.4698, lng: 153.0251 },
  'perth': { lat: -31.9505, lng: 115.8605 },
  'warsaw': { lat: 52.2297, lng: 21.0122 },
  'amsterdam': { lat: 52.3676, lng: 4.9041 },
  'incheon': { lat: 37.4563, lng: 126.7052 },
  'toronto': { lat: 43.6532, lng: -79.3832 },
  'mexico': { lat: 19.4326, lng: -99.1332 },
  'madrid': { lat: 40.4168, lng: -3.7038 },
  'stockholm': { lat: 59.3293, lng: 18.0686 },
};

function getCityCoords(city) {
  if (!city) return { lat: 40.7128, lng: -74.0060 };
  const ci = (city || '').toLowerCase().trim();
  for (const [key, coords] of Object.entries(CITY_COORDINATES)) {
    if (ci.includes(key)) return coords;
  }
  return { lat: 40.7128, lng: -74.0060 };
}

function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runQuery(sql, retries = 3, delayMs = 1500) {
  const url = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql })
      });
      if (res.status === 429 || res.status >= 500) {
        const errorText = await res.text().catch(() => '');
        console.warn(`   ⚠️ Supabase rate-limit/server (${res.status}) on attempt ${attempt}/${retries}. Retrying in ${delayMs}ms...`);
        if (attempt < retries) {
          await sleep(delayMs);
          delayMs *= 2;
          continue;
        }
        throw new Error(`Supabase (${res.status}): ${errorText.slice(0, 300)}`);
      }
      if (!res.ok) {
        const err = await res.text();
        throw new Error(err);
      }
      return res.json().catch(() => ({}));
    } catch (err) {
      if (attempt < retries && (err.message.includes('429') || err.message.includes('fetch failed'))) {
        console.warn(`   ⚠️ Supabase connection error: ${err.message}. Retrying in ${delayMs}ms...`);
        await sleep(delayMs);
        delayMs *= 2;
        continue;
      }
      throw err;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep scrape an individual event page:
//   - og:image         → high-quality banner (1500×844 JPEG from wp-content)
//   - athlete_guide_url → PDF link containing 'athlete', 'guide', 'race'
//   - schedule_url     → PDF with 'schedule', 'program', 'timetable'
//   - venue_name       → text near 'venue' / 'location' / 'arena' headings
//   - sponsor_name     → prefix before 'HYROX' in h1 (e.g. "AirAsia", "InBody")
// ─────────────────────────────────────────────────────────────────────────────
async function scrapeEventDetailPage(page, eventUrl) {
  const result = { banner_image_url: null, athlete_guide_url: null, schedule_url: null, venue_name: null, sponsor_name: null, course_map_url: null, lap_instructions: null };
  try {
    await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(800);

    const data = await page.evaluate(() => {
      // og:image → best quality official banner from WordPress
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || null;

      // All links and images on page
      const links = Array.from(document.querySelectorAll('a[href]'));
      const imgs = Array.from(document.querySelectorAll('img[src]'));

      // Athlete Guide PDF
      const guideLink = links.find(a =>
        (/athlete.?guide|race.?guide|event.?info|information.?guide/i.test(a.innerText?.trim() || a.href)) &&
        (a.href.includes('.pdf') || /guide|athlete/i.test(a.href))
      );

      // Schedule / Program PDF
      const scheduleLink = links.find(a =>
        (/schedule|program|timetable|race.?day/i.test(a.innerText?.trim() || a.href)) &&
        a.href.includes('.pdf')
      );

      // Course Map / Arena floorplan image or link
      const mapImg = imgs.find(img => {
        const src = (img.getAttribute('src') || '').toLowerCase();
        const alt = (img.getAttribute('alt') || '').toLowerCase();
        return (src.includes('course') || src.includes('arena') || src.includes('map') || src.includes('floorplan') || src.includes('track'))
          || (alt.includes('course') || alt.includes('arena') || alt.includes('map'));
      });
      const mapLink = links.find(a => /course.?map|arena.?map|site.?map/i.test(a.innerText?.trim() || a.href));

      // Venue / Arena name from page body text
      const bodyText = document.body.innerText || '';
      const venueMatch = bodyText.match(/(?:venue|location|arena|hall|exhibition|centre|center|convention|palais)[:\s]+([^\n]{5,80})/i);

      // Lap instructions (e.g. "Run 1–8: Go 'IN' the SECOND time you see the 'IN'" or "Laps to run: ...")
      const lapMatch = bodyText.match(/(?:laps?\s+to\s+run|course\s+details|lap\s+count)[:\s]*([^\n]{10,180})/i)
        || bodyText.match(/(?:run\s+1[–-]8[^\n]{10,120})/i);

      // Sponsor from h1 title (e.g. "AirAsia HYROX Perth" → "AirAsia")
      const h1 = document.querySelector('h1')?.innerText?.trim() || '';
      const sponsorMatch = h1.match(/^(.+?)\s+HYROX/i);
      const sponsor = sponsorMatch ? sponsorMatch[1].trim() : null;

      return {
        banner_image_url: ogImage,
        athlete_guide_url: guideLink?.href || null,
        schedule_url: scheduleLink?.href || null,
        course_map_url: mapImg?.getAttribute('src') || mapLink?.href || null,
        lap_instructions: lapMatch ? lapMatch[0].trim().slice(0, 250) : null,
        venue_name: venueMatch ? venueMatch[1].trim().slice(0, 120) : null,
        sponsor_name: sponsor && sponsor !== 'HYROX' ? sponsor : null,
      };
    }).catch(() => ({}));

    Object.assign(result, data);
  } catch (_) { /* non-critical */ }
  return result;
}

export async function syncOfficialCalendar(page) {
  console.log('📡 Scraping HYROX Calendar from https://hyrox.com/find-my-race/...');
  await page.goto('https://hyrox.com/find-my-race/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(3000);

  // Use the exact DOM structure discovered from HYROX website
  const rawEvents = await page.evaluate(() => {
    // Matches the real card containers: .w-vwrapper.usg_vwrapper_5 each card
    const cards = Array.from(document.querySelectorAll(
      '.w-vwrapper.usg_vwrapper_5, [class*="eventteaser"], article[class*="event"], .elementor-post'
    ));
    const unique = new Map();

    cards.forEach(card => {
      // Event page URL (title link, not Buy Tickets button)
      const titleLink = card.querySelector('h2 a, h3 a, .post_title a, .w-post-elm.post_title a')?.getAttribute('href')
        || card.querySelector('a[href*="/event/"]')?.getAttribute('href') || '';
      if (!titleLink) return;

      // High-quality card image
      const img = card.querySelector('.wp-post-image, img[class*="wp-post-image"], img')?.getAttribute('src') || '';

      // 3-letter city IATA code
      const cityCode = card.querySelector('[class*="event_city_letter_code"] span, [class*="city_letter"] span')?.innerText?.trim() || '';

      // Event title
      const title = card.querySelector('h2 a, h3 a, .post_title a, .w-post-elm.post_title a')?.innerText?.trim() || '';

      // Start date and end date from structured custom fields
      const date1El = card.querySelector('[class*="event_date_1"] .w-post-elm-value, [class*="event_date_1"] span:last-child');
      const date2El = card.querySelector('[class*="event_date_3"] .w-post-elm-value, [class*="event_date_3"] span:last-child');
      const date1 = date1El?.innerText?.trim() || '';
      const date2 = date2El?.innerText?.trim() || '';

      if (title && !unique.has(titleLink)) {
        unique.set(titleLink, { link: titleLink, img, cityCode, title, date1, date2 });
      }
    });

    return Array.from(unique.values());
  });

  console.log(`   ✅ Extracted ${rawEvents.length} official event cards.`);

  // Ensure ALL needed columns exist
  try {
    await runQuery(`
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS course_map_url text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS lap_instructions text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS athlete_guide_url text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS schedule_url text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS venue_name text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS sponsor_name text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS event_page_url text;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS lat float8;
      ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS lng float8;
    `);
  } catch (_) {}

  const defaultLapInstructions = "Run 1–8: Go 'IN' the SECOND time you see the 'IN' archway.";
  const parsedRaces = [];

  for (const item of rawEvents) {
    const dateLine = item.date2 ? `${item.date1} – ${item.date2}` : item.date1;
    const { startDate, endDate } = parseDateStr(dateLine);
    const year = startDate.split('-')[0];

    const cleanName = item.title.replace(/BUY TICKETS|SOLD OUT|WAITLIST/gi, '').trim();
    const city = cleanName.replace(/.*HYROX\s+/i, '').replace(/\s+\d{4}.*/, '').trim() || 'Global';
    const slug = `${city.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${year}`;
    const season = (year === '2026' || year === '2027') ? '26/27' : '25/26';
    const isPast = new Date(endDate) < new Date();
    const countryObj = getCountryByCity(city);
    const coords = getCityCoords(city);

    parsedRaces.push({
      id: slug,
      name: cleanName.startsWith('HYROX') ? cleanName : `HYROX ${city} ${year}`,
      city,
      city_code: item.cityCode || null,
      country: countryObj.name,
      country_code: countryObj.code,
      date: startDate,
      end_date: endDate,
      season,
      status: isPast ? 'completed' : 'upcoming',
      image_url: item.img || null,
      registration_url: item.link || null,
      event_page_url: item.link || null,
      lap_instructions: defaultLapInstructions,
      lat: coords.lat,
      lng: coords.lng,
      // Filled by deep scrape below:
      banner_image_url: null,
      athlete_guide_url: null,
      schedule_url: null,
      venue_name: null,
      sponsor_name: null,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DEEP SCRAPE: Visit each event page to collect og:image banner, guides, venues
  // ─────────────────────────────────────────────────────────────────────────
  console.log(`\n   🔍 Deep scraping ${parsedRaces.length} event pages for banners, athlete guides & venues...`);

  for (let i = 0; i < parsedRaces.length; i++) {
    const race = parsedRaces[i];
    if (!race.event_page_url) continue;
    process.stdout.write(`   🌐 [${i + 1}/${parsedRaces.length}] ${race.name}...\r`);

    const extra = await scrapeEventDetailPage(page, race.event_page_url);

    // og:image is higher quality than card thumbnail — prefer it
    if (extra.banner_image_url) race.image_url = extra.banner_image_url;
    race.athlete_guide_url = extra.athlete_guide_url;
    race.schedule_url      = extra.schedule_url;
    race.venue_name        = extra.venue_name;
    race.sponsor_name      = extra.sponsor_name;
    race.course_map_url    = extra.course_map_url;
    if (extra.lap_instructions) race.lap_instructions = extra.lap_instructions;

    await new Promise(r => setTimeout(r, 400));
  }

  console.log(`\n   ✅ Deep scrape done. Upserting ${parsedRaces.length} races into Supabase...`);

  const CHUNK = 20;
  for (let i = 0; i < parsedRaces.length; i += CHUNK) {
    const chunk = parsedRaces.slice(i, i + CHUNK);
    const values = chunk.map(r => `(
      ${esc(r.id)}, ${esc(r.name)}, ${esc(r.city)}, ${esc(r.city_code)},
      ${esc(r.country)}, ${esc(r.country_code)},
      ${esc(r.date)}, ${esc(r.end_date)}, ${esc(r.season)}, ${esc(r.status)},
      ${esc(r.image_url)}, ${esc(r.registration_url)}, ${esc(r.event_page_url)},
      ${esc(r.lap_instructions)}, ${esc(r.venue_name)}, ${esc(r.sponsor_name)},
      ${esc(r.athlete_guide_url)}, ${esc(r.schedule_url)}, ${esc(r.course_map_url)},
      ${r.lat}, ${r.lng}
    )`).join(',\n');

    const sql = `
      INSERT INTO hyrox_races (
        id, name, city, city_code, country, country_code,
        date, end_date, season, status,
        image_url, registration_url, event_page_url,
        lap_instructions, venue_name, sponsor_name,
        athlete_guide_url, schedule_url, course_map_url,
        lat, lng
      ) VALUES ${values}
      ON CONFLICT (id) DO UPDATE SET
        name              = EXCLUDED.name,
        city              = EXCLUDED.city,
        city_code         = COALESCE(EXCLUDED.city_code,         hyrox_races.city_code),
        country           = COALESCE(EXCLUDED.country,           hyrox_races.country),
        country_code      = COALESCE(EXCLUDED.country_code,      hyrox_races.country_code),
        date              = EXCLUDED.date,
        end_date          = EXCLUDED.end_date,
        season            = EXCLUDED.season,
        status            = EXCLUDED.status,
        image_url         = COALESCE(EXCLUDED.image_url,         hyrox_races.image_url),
        registration_url  = COALESCE(EXCLUDED.registration_url,  hyrox_races.registration_url),
        event_page_url    = COALESCE(EXCLUDED.event_page_url,    hyrox_races.event_page_url),
        lap_instructions  = COALESCE(EXCLUDED.lap_instructions,  hyrox_races.lap_instructions),
        venue_name        = COALESCE(EXCLUDED.venue_name,        hyrox_races.venue_name),
        sponsor_name      = COALESCE(EXCLUDED.sponsor_name,      hyrox_races.sponsor_name),
        athlete_guide_url = COALESCE(EXCLUDED.athlete_guide_url, hyrox_races.athlete_guide_url),
        schedule_url      = COALESCE(EXCLUDED.schedule_url,      hyrox_races.schedule_url),
        course_map_url    = COALESCE(EXCLUDED.course_map_url,    hyrox_races.course_map_url),
        lat               = COALESCE(EXCLUDED.lat,               hyrox_races.lat),
        lng               = COALESCE(EXCLUDED.lng,               hyrox_races.lng),
        updated_at        = NOW();
    `;

    try {
      await runQuery(sql);
      process.stdout.write(`   💾 [${i + 1}–${Math.min(i + CHUNK, parsedRaces.length)}/${parsedRaces.length}] synced\r`);
    } catch (e) {
      console.warn(`\n   ⚠️ Chunk error:`, e.message.slice(0, 100));
    }
  }

  console.log('\n   🎉 Full calendar sync complete! (banners, venues, athlete guides all saved)\n');
}

// Standalone runner
if (process.argv[1]?.includes('sync_hyrox_calendar.mjs')) {
  (async () => {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars'],
      ignoreDefaultArgs: ['--enable-automation']
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
    });
    const page = await context.newPage();
    await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });
    await syncOfficialCalendar(page);
    await browser.close();
  })();
}
