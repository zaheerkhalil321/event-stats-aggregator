// Start lists (startlist.hyrox.com) and in-race detail pages (results.hyrox.com) for live tracking.
// Parsing only; requests go through the paced mika client (scripts/lib/mika_http.mjs).
// startlist.hyrox.com uses the same wave ids ("event") and result ids ("idp") as results.hyrox.com.
import { decodeEntities } from './mika_list.mjs';

const stripTags = (s) => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

export const startlistUrl = (wave, sex, page = 1) =>
  `https://startlist.hyrox.com/?pid=startlist_list&lang=EN_CAP&event=${wave}&num_results=100&search[sex]=${sex}&page=${page}`;

export const detailUrl = (seasonSlug, wave, idp) =>
  `https://results.hyrox.com/${seasonSlug}/?content=detail&event=${wave}&idp=${idp}&lang=EN_CAP`;

/** Rows of one start list page: { idp, name, bib, ageGroup, day, heat ("17:50"), heatLabel }. */
export function parseStartlistPage(html) {
  const rows = [];
  for (const li of String(html).split(/<li class="[^"]*list-group-item[^"]*row[^"]*">/).slice(1)) {
    const idp = li.match(/[?&;]idp=([A-Za-z0-9_]+)/)?.[1];
    if (!idp) continue;
    const field = (label) => {
      const m = li.match(new RegExp(`list-label">\\s*${label}\\s*<\\/div>([\\s\\S]*?)<\\/div>`, 'i'));
      return m ? stripTags(m[1]) || null : null;
    };
    const heatLabel = field('Startwave');
    rows.push({
      idp,
      name: stripTags(li.match(/<h4[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1]),
      bib: field('Bib no\\.') ?? field('Bib'),
      ageGroup: field('Age Group'),
      day: field('Day'),
      heat: heatLabel?.match(/^(\d{1,2}:\d{2})/)?.[1]?.padStart(5, '0') ?? null,
      heatLabel,
    });
  }
  return rows;
}

const SPLIT_KEYS = [
  ['run_1', /^Running 1$/i], ['skierg', /SkiErg/i], ['run_2', /^Running 2$/i], ['sled_push', /Sled Push/i],
  ['run_3', /^Running 3$/i], ['sled_pull', /Sled Pull/i], ['run_4', /^Running 4$/i], ['burpee_jumps', /Burpee/i],
  ['run_5', /^Running 5$/i], ['rowing', /Row$/i], ['run_6', /^Running 6$/i], ['farmers_carry', /Farmers/i],
  ['run_7', /^Running 7$/i], ['sandbag_lunges', /Sandbag/i], ['run_8', /^Running 8$/i], ['wall_balls', /Wall Balls/i],
];
export const SEGMENTS = SPLIT_KEYS.map(([k]) => k);

const isTime = (s) => /^\d{1,2}:\d{2}(:\d{2})?(\.\d+)?$/.test(String(s ?? '').trim());

function tables(html) {
  return [...String(html).matchAll(/<table[\s\S]*?<\/table>/gi)].map((t) =>
    [...t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => stripTags(c[1]))));
}

/**
 * What a detail page shows during the race:
 *   splits   { run_1: "00:03:40", skierg: ... } (only the ones done)
 *   last     { point: "200m Farmers Carry In", elapsed: "00:57:57", tod: "20:38:08" } latest timing mat
 *   startTod clock time the athlete crossed the start ("19:40:11"), from the first stamp
 *   finished true when the page has an overall time
 */
export function parseLiveDetail(html) {
  const splits = {};
  let last = null;
  let first = null;
  let finished = false;
  for (const rows of tables(html)) {
    const head = rows[0] ?? [];
    if (head[0] === 'Split' && head[1] === 'Time') {
      for (const [label, time] of rows.slice(1)) {
        const key = SPLIT_KEYS.find(([, re]) => re.test(label ?? ''))?.[0];
        if (key && !splits[key] && isTime(time)) splits[key] = time;
      }
    } else if (head[0] === 'Split' && /Time Of Day/i.test(head[1] ?? '')) {
      for (const [point, tod, elapsed] of rows.slice(1)) {
        if (!isTime(tod) || !isTime(elapsed)) continue;
        if (!first) first = { tod, elapsed };
        last = { point, elapsed, tod };
      }
    } else {
      for (const [k, v] of rows) if (/^Overall Time$/i.test(k ?? '') && isTime(v)) finished = true;
    }
  }
  const startTod = first ? secondsToClock(clockSeconds(first.tod) - clockSeconds(first.elapsed)) : null;
  return { splits, last, startTod, finished, at: whereOnCourse(splits, last) };
}

/**
 * Where the athlete is after the last timing mat: { segment: "run_6" | "farmers_carry" | ..., phase }.
 * phase "run" (on a run), "station" (doing the station), "roxzone" (between run and station).
 * The order on the course is: Rox In (run done) -> Station In -> Station Out -> Rox Out (next run starts).
 */
export function whereOnCourse(splits, last) {
  if (!last) return null;
  const done = SEGMENTS.filter((k) => splits[k]).length;
  const next = SEGMENTS[done] ?? null;
  const p = String(last.point ?? '');
  if (/^Rox Out$/i.test(p)) return { segment: next, phase: 'run' };
  if (/^Rox In$/i.test(p)) return { segment: next, phase: 'roxzone' };
  if (/\sIn$/i.test(p)) return { segment: next, phase: 'station' };
  if (/\sOut$/i.test(p)) return { segment: next, phase: 'roxzone' };
  return { segment: next, phase: null };
}

export function clockSeconds(t) {
  const p = String(t ?? '').split(':').map(Number);
  if (p.some(Number.isNaN) || p.length < 2) return NaN;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
}

function secondsToClock(s) {
  if (!Number.isFinite(s)) return null;
  s = ((Math.round(s) % 86400) + 86400) % 86400;
  return [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':');
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The date ("2026-11-13") of a weekday name within a race's date range, or null. */
export function raceDayDate(startDate, endDate, dayName) {
  const want = WEEKDAYS.indexOf(String(dayName ?? '').trim().toLowerCase());
  if (want < 0 || !startDate) return null;
  const end = endDate || startDate;
  for (let d = new Date(`${startDate}T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === want) return d.toISOString().slice(0, 10);
  }
  return null;
}

// Race time zones: one per country, with city overrides for countries that span several.
const COUNTRY_TZ = {
  AE: 'Asia/Dubai', AR: 'America/Argentina/Buenos_Aires', AT: 'Europe/Vienna', AU: 'Australia/Sydney',
  BE: 'Europe/Brussels', BR: 'America/Sao_Paulo', CA: 'America/Toronto', CH: 'Europe/Zurich', CL: 'America/Santiago',
  CN: 'Asia/Shanghai', EG: 'Africa/Cairo', CO: 'America/Bogota', CZ: 'Europe/Prague', DE: 'Europe/Berlin', DK: 'Europe/Copenhagen',
  ES: 'Europe/Madrid', FI: 'Europe/Helsinki', FR: 'Europe/Paris', GB: 'Europe/London', UK: 'Europe/London',
  GR: 'Europe/Athens', HK: 'Asia/Hong_Kong', HU: 'Europe/Budapest', ID: 'Asia/Jakarta', IE: 'Europe/Dublin',
  IN: 'Asia/Kolkata', IT: 'Europe/Rome', JP: 'Asia/Tokyo', KR: 'Asia/Seoul', KW: 'Asia/Kuwait', MX: 'America/Mexico_City',
  MY: 'Asia/Kuala_Lumpur', NL: 'Europe/Amsterdam', NO: 'Europe/Oslo', NZ: 'Pacific/Auckland', PH: 'Asia/Manila',
  PL: 'Europe/Warsaw', PT: 'Europe/Lisbon', QA: 'Asia/Qatar', RO: 'Europe/Bucharest', SA: 'Asia/Riyadh',
  SE: 'Europe/Stockholm', SG: 'Asia/Singapore', TH: 'Asia/Bangkok', TR: 'Europe/Istanbul', TW: 'Asia/Taipei',
  US: 'America/New_York', VN: 'Asia/Ho_Chi_Minh', ZA: 'Africa/Johannesburg',
};
const CITY_TZ = [
  [/denver|salt lake|colorado/i, 'America/Denver'],
  [/phoenix|scottsdale|arizona/i, 'America/Phoenix'],
  [/los angeles|anaheim|san diego|san francisco|las vegas|seattle|portland|sacramento|san jose|oakland/i, 'America/Los_Angeles'],
  [/chicago|dallas|houston|austin|fort worth|minneapolis|kansas|nashville|new orleans|st\.? louis|milwaukee|san antonio|oklahoma|indianapolis/i, 'America/Chicago'],
  [/vancouver/i, 'America/Vancouver'], [/calgary|edmonton/i, 'America/Edmonton'],
  [/perth/i, 'Australia/Perth'], [/brisbane|gold coast/i, 'Australia/Brisbane'], [/adelaide/i, 'Australia/Adelaide'],
  [/cancun|cancún/i, 'America/Cancun'], [/tijuana/i, 'America/Tijuana'], [/monterrey/i, 'America/Monterrey'],
  [/hawaii|honolulu/i, 'Pacific/Honolulu'],
];

// Some races are stored without a real country ("XX"): fall back to the city.
const CITY_ONLY_TZ = [
  [/dublin|belfast/i, 'Europe/Dublin'], [/cairo/i, 'Africa/Cairo'],
  [/london|manchester|birmingham|glasgow|cardiff|liverpool|leeds|edinburgh/i, 'Europe/London'],
  [/paris|nice|lyon|marseille|bordeaux|lille|toulouse/i, 'Europe/Paris'],
  [/berlin|hamburg|munich|münchen|cologne|köln|d[uü]sseldorf|frankfurt|stuttgart|karlsruhe|leipzig|hannover/i, 'Europe/Berlin'],
  [/madrid|barcelona|valencia|m[aá]laga|bilbao|sevilla|seville/i, 'Europe/Madrid'],
  [/amsterdam|rotterdam|utrecht|heerenveen|maastricht/i, 'Europe/Amsterdam'], [/brussels|bruxelles|gent|ghent|antwerp/i, 'Europe/Brussels'],
  [/vienna|wien/i, 'Europe/Vienna'], [/zurich|zürich|geneva|basel/i, 'Europe/Zurich'], [/lisbon|lisboa|porto/i, 'Europe/Lisbon'],
  [/milan|milano|rome|roma|turin|torino|verona|bologna/i, 'Europe/Rome'], [/stockholm|gothenburg/i, 'Europe/Stockholm'],
  [/copenhagen/i, 'Europe/Copenhagen'], [/oslo/i, 'Europe/Oslo'], [/helsinki/i, 'Europe/Helsinki'], [/warsaw|krak[oó]w|pozna[nń]/i, 'Europe/Warsaw'],
  [/prague/i, 'Europe/Prague'], [/athens/i, 'Europe/Athens'], [/istanbul/i, 'Europe/Istanbul'],
  [/dubai|abu dhabi/i, 'Asia/Dubai'], [/doha/i, 'Asia/Qatar'], [/riyadh|jeddah/i, 'Asia/Riyadh'], [/kuwait/i, 'Asia/Kuwait'],
  [/mumbai|delhi|bangalore|bengaluru|hyderabad|chennai|pune/i, 'Asia/Kolkata'],
  [/singapore/i, 'Asia/Singapore'], [/hong kong/i, 'Asia/Hong_Kong'], [/shanghai|beijing|shenzhen|guangzhou|chengdu|hangzhou/i, 'Asia/Shanghai'],
  [/taipei/i, 'Asia/Taipei'], [/tokyo|chiba|osaka|yokohama|nagoya/i, 'Asia/Tokyo'], [/seoul|incheon|busan/i, 'Asia/Seoul'],
  [/bangkok/i, 'Asia/Bangkok'], [/kuala lumpur/i, 'Asia/Kuala_Lumpur'], [/jakarta|bali/i, 'Asia/Jakarta'], [/manila/i, 'Asia/Manila'],
  [/sydney|melbourne/i, 'Australia/Sydney'], [/auckland|wellington/i, 'Pacific/Auckland'],
  [/cape town|johannesburg/i, 'Africa/Johannesburg'], [/toronto|montreal|ottawa/i, 'America/Toronto'],
  [/new york|boston|atlanta|miami|washington|philadelphia|orlando|tampa|charlotte/i, 'America/New_York'],
  [/mexico city|ciudad de m[eé]xico|acapulco|guadalajara/i, 'America/Mexico_City'], [/s[aã]o paulo|rio de janeiro/i, 'America/Sao_Paulo'],
  [/buenos aires/i, 'America/Argentina/Buenos_Aires'], [/santiago/i, 'America/Santiago'], [/bogot[aá]/i, 'America/Bogota'],
];

export function raceTimezone({ city, country_code: cc } = {}) {
  const byCity = CITY_TZ.find(([re]) => re.test(city ?? ''))?.[1];
  return byCity ?? COUNTRY_TZ[String(cc ?? '').toUpperCase()] ?? CITY_ONLY_TZ.find(([re]) => re.test(city ?? ''))?.[1] ?? null;
}

/** A local wall-clock time ("2026-11-13", "17:50") in an IANA zone as a UTC ISO string. */
export function localToUtc(date, hhmm, timeZone) {
  if (!date || !hhmm || !timeZone) return null;
  const [h, m] = hhmm.split(':').map(Number);
  const guess = Date.UTC(...date.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))), h, m);
  const offsetAt = (ms) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let utc = guess - offsetAt(guess);
  utc = guess - offsetAt(utc); // second pass settles DST edges
  return new Date(utc).toISOString();
}
