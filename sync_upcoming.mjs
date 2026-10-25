#!/usr/bin/env node
/**
 * 📅 Upcoming HYROX races from the official calendar (https://hyrox.com/find-my-race/).
 *
 * One request reads the whole season calendar (allowed by hyrox.com/robots.txt). Each event has a
 * city code, title, event page link and start/end date. For every calendar event:
 *   - an existing race of the same city starting within a few days, or the same `<city>-<year>` id
 *     with a placeholder date, gets the real dates;
 *   - otherwise a new upcoming race is inserted.
 * Placeholder races left by older imports (date YYYY-01-01 without end date, or YYYY-12-31) that
 * point to the same event page are merged into the real row and deleted, only when they hold no
 * athletes; other placeholder races still marked upcoming with no athletes are deleted too. Finally every race with real dates gets its status from the date
 * (upcoming → live → completed).
 *
 * Usage:
 *   node sync_upcoming.mjs                 # dry run: print what would change
 *   node sync_upcoming.mjs --apply         # write the changes
 *   node sync_upcoming.mjs --status-only --apply   # only refresh statuses by date (no web request)
 */

import { createClient } from '@libsql/client';
import dotenv from 'dotenv';

dotenv.config();

const APPLY = process.argv.includes('--apply');
const STATUS_ONLY = process.argv.includes('--status-only');
const CALENDAR_URL = 'https://hyrox.com/find-my-race/';
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// Cities whose earlier races carry no usable country (fallback for "International").
const COUNTRY_BY_CITY = {
  hamburg: ['Germany', 'DE'], dusseldorf: ['Germany', 'DE'], frankfurt: ['Germany', 'DE'], cologne: ['Germany', 'DE'],
  birmingham: ['United Kingdom', 'GB'], london: ['United Kingdom', 'GB'], manchester: ['United Kingdom', 'GB'],
  glasgow: ['United Kingdom', 'GB'], cardiff: ['United Kingdom', 'GB'],
  tampa: ['United States', 'US'], denver: ['United States', 'US'], nashville: ['United States', 'US'],
  'san-diego': ['United States', 'US'], portland: ['United States', 'US'], dallas: ['United States', 'US'],
  cairo: ['Egypt', 'EG'], guangzhou: ['China', 'CN'], sanya: ['China', 'CN'], 'rio-de-janeiro': ['Brazil', 'BR'],
  utrecht: ['Netherlands', 'NL'], gujarat: ['India', 'IN'], noida: ['India', 'IN'], bengaluru: ['India', 'IN'],
  'kuala-lumpur': ['Malaysia', 'MY'], gent: ['Belgium', 'BE'], mechelen: ['Belgium', 'BE'], helsinki: ['Finland', 'FI'],
  verona: ['Italy', 'IT'], bari: ['Italy', 'IT'], hanoi: ['Vietnam', 'VN'], 'buenos-aires': ['Argentina', 'AR'],
  paris: ['France', 'FR'], lyon: ['France', 'FR'], nagoya: ['Japan', 'JP'], monterrey: ['Mexico', 'MX'],
  ottawa: ['Canada', 'CA'], krakow: ['Poland', 'PL'], riga: ['Latvia', 'LV'], seoul: ['South Korea', 'KR'],
  'world-championships-hong-kong': ['Hong Kong', 'HK'], 'hong-kong': ['Hong Kong', 'HK'],
};
const countryForId = (id) => {
  const key = Object.keys(COUNTRY_BY_CITY).sort((a, b) => b.length - a.length).find((k) => String(id).startsWith(`${k}-`));
  return key ? COUNTRY_BY_CITY[key] : null;
};

const INFO_COLUMNS = ['image_url', 'venue', 'venue_name', 'sponsor_name', 'course_map_url', 'lap_instructions',
  'athlete_guide_url', 'race_schedule', 'check_in_info', 'ceremony_times', 'event_page_url'];

let client = null;
const db = {
  // Connects on first use, so the parser can be imported (tests) without database credentials.
  get c() {
    if (!client) {
      if (!process.env.TURSO_DATABASE_URL) throw new Error('Missing TURSO_DATABASE_URL in environment.');
      client = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
    }
    return client;
  },
  execute: (q) => db.c.execute(q),
  batch: (s, m) => db.c.batch(s, m),
};

const decode = (s) => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&quot;/g, '"')
  .replace(/&#8211;|&ndash;/g, '–').replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').trim();

const slugify = (s) => String(s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// "23. Oct. 2026" -> "2026-10-23"
export function parseCalendarDate(s) {
  const m = String(s ?? '').match(/(\d{1,2})\.?\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})/);
  if (!m || !MONTHS[m[2].toLowerCase()]) return null;
  return `${m[3]}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

// "MyFitnessPal HYROX Tampa" -> "Tampa"; "HYROX YOUNGSTARS BIRMINGHAM" -> "Birmingham" (youngstars)
export function cityFromTitle(title) {
  const t = decode(title);
  const after = t.split(/\bHYROX\b/i).pop().trim() || t;
  const youngstars = /\byoungstars\b/i.test(t);
  const city = after.replace(/\byoungstars\b/i, '').replace(/\s+/g, ' ').trim()
    .toLowerCase().replace(/(^|[\s-])\S/g, (c) => c.toUpperCase());
  return { city, youngstars };
}

export function parseCalendar(html) {
  const events = [];
  for (const art of html.match(/<article[^>]*\btype-event\b[\s\S]*?<\/article>/g) || []) {
    const link = art.match(/<h2[^>]*post_title[^>]*>\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const code = decode(art.match(/event_city_letter_code[\s\S]*?w-post-elm-value">([^<]*)</)?.[1]);
    const start = parseCalendarDate(decode(art.match(/event_date_1[\s\S]*?w-post-elm-value">([^<]*)</)?.[1]));
    const end = parseCalendarDate(decode(art.match(/event_date_3[\s\S]*?w-post-elm-value">([^<]*)</)?.[1])) || start;
    const image = art.match(/<img[^>]+src="([^"]+)"/)?.[1] ?? null;
    const title = decode(link[2]);
    const { city, youngstars } = cityFromTitle(title);
    events.push({ url: link[1], title, code, city, youngstars, start, end, image });
  }
  return events;
}

const isPlaceholderDate = (r) => /-01-01$/.test(String(r.date)) && !r.end_date || /-12-31$/.test(String(r.date));
const days = (a, b) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const MONTH_SLUG = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function seasonFor(date) {
  const [y, m] = date.split('-').map(Number);
  const startYear = m >= 7 ? y : y - 1;
  return `${String(startYear).slice(2)}/${String(startYear + 1).slice(2)}`;
}

async function refreshStatuses() {
  const sql = `UPDATE hyrox_races SET status = CASE
        WHEN date('now') < date THEN 'upcoming'
        WHEN date('now') <= COALESCE(end_date, date) THEN 'live'
        ELSE 'completed' END,
      updated_at = CURRENT_TIMESTAMP
    WHERE date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
      AND NOT (date LIKE '%-01-01' AND end_date IS NULL) AND date NOT LIKE '%-12-31'
      AND status IS NOT CASE
        WHEN date('now') < date THEN 'upcoming'
        WHEN date('now') <= COALESCE(end_date, date) THEN 'live'
        ELSE 'completed' END`;
  if (!APPLY) {
    const preview = await db.execute(`SELECT id, status, date, end_date, CASE
        WHEN date('now') < date THEN 'upcoming' WHEN date('now') <= COALESCE(end_date, date) THEN 'live' ELSE 'completed' END AS should
      FROM hyrox_races WHERE date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND NOT (date LIKE '%-01-01' AND end_date IS NULL) AND date NOT LIKE '%-12-31'`);
    const changes = preview.rows.filter((r) => r.status !== r.should);
    console.log(`🔄 Status changes (dry run): ${changes.length}`);
    for (const r of changes.slice(0, 30)) console.log(`   ${r.id}: ${r.status} → ${r.should} (${r.date}..${r.end_date ?? r.date})`);
    return;
  }
  const res = await db.execute(sql);
  console.log(`🔄 Statuses refreshed: ${res.rowsAffected} race(s) changed`);
}

async function main() {
  console.log(`📅 HYROX calendar sync ${APPLY ? '' : '(dry run — add --apply to write)'}`);
  if (STATUS_ONLY) return refreshStatuses();

  const res = await fetch(CALENDAR_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hyrox-calendar-sync; weekly)' } });
  if (!res.ok) throw new Error(`calendar page returned HTTP ${res.status}`);
  const events = parseCalendar(await res.text()).filter((e) => e.start);
  console.log(`Calendar events with dates: ${events.length}`);

  const races = (await db.execute(`SELECT r.*, (SELECT COUNT(*) FROM hyrox_athlete_results a WHERE a.race_id = r.id) AS athletes FROM hyrox_races r`)).rows;
  const byId = new Map(races.map((r) => [r.id, r]));
  const plan = { update: [], insert: [], merge: [] };
  const claimed = new Set();

  for (const ev of events) {
    const year = ev.start.slice(0, 4);
    const base = slugify(ev.city);
    const suffix = ev.youngstars ? '-youngstars' : '';
    // Same city (id starts with the city slug), same kind, real date within 4 days of the calendar.
    let target = races.find((r) => !claimed.has(r.id) && !isPlaceholderDate(r) && r.date
      && String(r.id).startsWith(`${base}-`) && /youngstars/.test(r.id) === ev.youngstars && days(r.date, ev.start) <= 4);
    let id = target?.id;
    if (!target) {
      id = `${base}${suffix}-${year}`;
      const existing = byId.get(id);
      if (existing && !claimed.has(id) && (isPlaceholderDate(existing) || (existing.status === 'upcoming' && Number(existing.athletes) === 0))) target = existing;
      else if (existing) id = `${base}${suffix}-${MONTH_SLUG[Number(ev.start.slice(5, 7)) - 1]}-${year}`;
      if (!target && byId.has(id)) target = byId.get(id);
    }
    // Placeholder rows from older imports pointing to the same event page: merge their info, delete them.
    const placeholders = races.filter((r) => r.id !== id && r.event_page_url === ev.url && isPlaceholderDate(r) && Number(r.athletes) === 0);
    const info = {};
    for (const p of placeholders) for (const c of INFO_COLUMNS) if (p[c] != null && info[c] == null) info[c] = p[c];
    if (ev.image) info.image_url = info.image_url ?? ev.image;
    info.event_page_url = ev.url;
    claimed.add(id);

    if (target) {
      const changed = target.date !== ev.start || (target.end_date ?? null) !== ev.end;
      plan.update.push({ id, ev, info, changed, before: `${target.date}..${target.end_date ?? '∅'}` });
    } else {
      // Country from an earlier race in the same city (dublin-2025 → Ireland), else "International".
      const sameCity = races.filter((r) => String(r.id).startsWith(`${base}-`) && r.country && r.country !== 'International')
        .sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
      const mapped = countryForId(id);
      const country = sameCity ? { country: sameCity.country, country_code: sameCity.country_code }
        : mapped ? { country: mapped[0], country_code: mapped[1] } : { country: 'International', country_code: 'INT' };
      plan.insert.push({ id, ev, info, country });
    }
    for (const p of placeholders) plan.merge.push({ from: p.id, into: id });
  }

  // Remaining placeholder rows (fake date, still "upcoming", no athletes, not on the calendar) are
  // leftovers of events that already happened or never had a real date: they only clutter the list.
  const kept = new Set([...plan.update.map((u) => u.id), ...plan.insert.map((i) => i.id)]);
  const merged = new Set(plan.merge.map((m) => m.from));
  plan.drop = races.filter((r) => isPlaceholderDate(r) && r.status === 'upcoming' && Number(r.athletes) === 0
    && !kept.has(r.id) && !merged.has(r.id));

  const dateUpdates = plan.update.filter((u) => u.changed);
  console.log(`\n✏️  Date fixes on existing races: ${dateUpdates.length}`);
  for (const u of dateUpdates) console.log(`   ${u.id}: ${u.before} → ${u.ev.start}..${u.ev.end}  (${u.ev.title})`);
  console.log(`\n➕ New upcoming races: ${plan.insert.length}`);
  for (const i of plan.insert) console.log(`   ${i.id}: ${i.ev.start}..${i.ev.end}  (${i.ev.title})`);
  console.log(`\n🗑️  Placeholder rows merged and deleted (0 athletes): ${plan.merge.length}`);
  for (const m of plan.merge) console.log(`   ${m.from} → ${m.into}`);
  console.log(`\n🧹 Leftover placeholder races deleted (fake date, upcoming, 0 athletes, not on the calendar): ${plan.drop.length}`);
  for (const d of plan.drop) console.log(`   ${d.id} (${d.date})`);

  if (APPLY) {
    const stmts = [];
    for (const u of plan.update) {
      const cols = Object.keys(u.info);
      stmts.push({
        sql: `UPDATE hyrox_races SET date = ?, end_date = ?, ${cols.map((c) => `${c} = COALESCE(${c}, ?)`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        args: [u.ev.start, u.ev.end, ...cols.map((c) => u.info[c]), u.id],
      });
    }
    for (const i of plan.insert) {
      const cols = Object.keys(i.info);
      stmts.push({
        sql: `INSERT INTO hyrox_races (id, name, city, country, country_code, date, end_date, season, status, ${cols.join(', ')}, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'upcoming', ${cols.map(() => '?').join(', ')}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        args: [i.id, `HYROX ${i.ev.youngstars ? 'Youngstars ' : ''}${i.ev.city} ${i.ev.start.slice(0, 4)}`, i.ev.city,
          i.country.country, i.country.country_code, i.ev.start, i.ev.end, seasonFor(i.ev.start), ...cols.map((c) => i.info[c])],
      });
    }
    for (const m of plan.merge) {
      stmts.push({ sql: `DELETE FROM hyrox_races WHERE id = ? AND NOT EXISTS (SELECT 1 FROM hyrox_athlete_results a WHERE a.race_id = ?)`, args: [m.from, m.from] });
    }
    for (const d of plan.drop) {
      stmts.push({ sql: `DELETE FROM hyrox_races WHERE id = ? AND status = 'upcoming' AND NOT EXISTS (SELECT 1 FROM hyrox_athlete_results a WHERE a.race_id = ?)`, args: [d.id, d.id] });
    }
    // Upcoming/live races still marked "International" get the country of their city.
    const intl = races.filter((r) => ['upcoming', 'live'].includes(r.status) && r.country === 'International');
    for (const r of intl) {
      const mapped = countryForId(r.id);
      if (mapped) stmts.push({ sql: `UPDATE hyrox_races SET country = ?, country_code = ? WHERE id = ? AND country = 'International'`, args: [mapped[0], mapped[1], r.id] });
    }
    if (stmts.length) await db.batch(stmts, 'write');
    console.log(`\n✅ Applied ${stmts.length} statement(s).`);
  }
  await refreshStatuses();
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) main().catch((err) => { console.error('❌ Calendar sync failed:', err.message); process.exit(1); });
