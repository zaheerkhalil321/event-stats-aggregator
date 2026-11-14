/**
 * Races with a 3-letter ("USA") or unknown ("XX") country code get the 2-letter ISO code (apps build
 * flags from it) and the country name. Source, in order: another race in the same city with a good
 * code; the 3-letter code itself; a city list. Without --apply it only prints the changes.
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const ISO3 = { USA: 'US', FRA: 'FR', DEU: 'DE', POL: 'PL', AUT: 'AT', CAN: 'CA', CHN: 'CN', GBR: 'GB', NLD: 'NL', NZL: 'NZ', ZAF: 'ZA', AUS: 'AU', BEL: 'BE', CHE: 'CH', DNK: 'DK', ESP: 'ES', HKG: 'HK', IND: 'IN', KOR: 'KR', MEX: 'MX', SGP: 'SG', ITA: 'IT', SWE: 'SE', NOR: 'NO', IRL: 'IE', JPN: 'JP', BRA: 'BR', ARE: 'AE', TUR: 'TR', PRT: 'PT', CZE: 'CZ', HUN: 'HU', LVA: 'LV', FIN: 'FI', THA: 'TH', TWN: 'TW', MYS: 'MY', IDN: 'ID', QAT: 'QA', GRC: 'GR', ARG: 'AR', VNM: 'VN', EGY: 'EG' };
const NAME = { US: 'USA', FR: 'France', DE: 'Germany', PL: 'Poland', AT: 'Austria', CA: 'Canada', CN: 'China', GB: 'United Kingdom', NL: 'Netherlands', NZ: 'New Zealand', ZA: 'South Africa', AU: 'Australia', BE: 'Belgium', CH: 'Switzerland', DK: 'Denmark', ES: 'Spain', HK: 'Hong Kong', IN: 'India', KR: 'South Korea', MX: 'Mexico', SG: 'Singapore', IT: 'Italy', SE: 'Sweden', NO: 'Norway', IE: 'Ireland', JP: 'Japan', BR: 'Brazil', AE: 'United Arab Emirates', TR: 'Turkey', PT: 'Portugal', CZ: 'Czech Republic', HU: 'Hungary', LV: 'Latvia', FI: 'Finland', TH: 'Thailand', TW: 'Taiwan', MY: 'Malaysia', ID: 'Indonesia', QA: 'Qatar', GR: 'Greece', AR: 'Argentina', VN: 'Vietnam', EG: 'Egypt' };
const CITY = [
  [/stuttgart|karlsruhe|frankfurt|hamburg|berlin|munich|m[uü]nchen|cologne|k[oö]ln|d[uü]sseldorf|hannover|leipzig/i, 'DE'],
  [/dublin|belfast/i, 'IE'], [/anaheim|dallas|houston|atlanta|washington|new york|chicago|boston|tampa|denver|las vegas|los angeles|phoenix|miami|seattle|salt lake/i, 'US'],
  [/monterrey|acapulco|mexico city|ciudad de m[eé]xico|cancun|guadalajara|puebla/i, 'MX'], [/riga/i, 'LV'], [/gent|ghent|mechelen|antwerp|brussels/i, 'BE'],
  [/geneva|zurich|z[uü]rich|st\.? gallen|basel/i, 'CH'], [/gdansk|gda[nń]sk|pozna[nń]|katowice|warsaw|krak[oó]w/i, 'PL'], [/oslo/i, 'NO'],
  [/s[aã]o paulo|rio de janeiro|fortaleza/i, 'BR'], [/yokohama|tokyo|chiba|osaka/i, 'JP'], [/utrecht|maastricht|rotterdam|amsterdam|heerenveen/i, 'NL'],
  [/cairo/i, 'EG'], [/vienna|wien/i, 'AT'], [/toulouse|paris|nice|lyon|bordeaux|lille/i, 'FR'], [/london|manchester|birmingham|glasgow|cardiff/i, 'GB'],
  [/valencia|madrid|barcelona|m[aá]laga|bilbao/i, 'ES'], [/copenhagen/i, 'DK'], [/stockholm|malm[oö]/i, 'SE'], [/helsinki/i, 'FI'], [/milan|rome|turin|verona|bologna/i, 'IT'],
  [/lisbon|lisboa|porto/i, 'PT'], [/prague/i, 'CZ'], [/budapest/i, 'HU'], [/istanbul/i, 'TR'], [/dubai|abu dhabi/i, 'AE'], [/doha/i, 'QA'], [/singapore/i, 'SG'],
  [/hong kong/i, 'HK'], [/seoul|incheon|busan/i, 'KR'], [/mumbai|delhi|bangalore|bengaluru|gujarat/i, 'IN'], [/shanghai|shenzhen|beijing|guangzhou|chengdu|wuhan/i, 'CN'],
  [/taipei/i, 'TW'], [/bangkok/i, 'TH'], [/kuala lumpur/i, 'MY'], [/jakarta|bali/i, 'ID'], [/sydney|melbourne|brisbane|perth/i, 'AU'], [/auckland|wellington/i, 'NZ'],
  [/cape town|johannesburg/i, 'ZA'], [/toronto|vancouver|montreal|calgary/i, 'CA'], [/buenos aires/i, 'AR'], [/athens/i, 'GR'],
];

const APPLY = process.argv.includes('--apply');
const db = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const all = (await db.execute('SELECT id, city, country, country_code FROM hyrox_races')).rows;
const good = new Map();
for (const r of all) if (/^[A-Z]{2}$/.test(String(r.country_code)) && r.country_code !== 'XX') good.set(String(r.city).toLowerCase(), String(r.country_code));

const changes = [];
const unknown = [];
for (const r of all) {
  const cc = String(r.country_code ?? '');
  if (/^[A-Z]{2}$/.test(cc) && cc !== 'XX') continue;
  const to = good.get(String(r.city).toLowerCase()) ?? ISO3[cc.toUpperCase()] ?? CITY.find(([re]) => re.test(String(r.city)))?.[1];
  if (!to) { unknown.push(`${r.id} (${r.city}, ${cc})`); continue; }
  changes.push({ id: String(r.id), city: String(r.city), from: `${cc} ${r.country}`, to, country: NAME[to] ?? String(r.country) });
}
for (const c of changes) console.log(`${c.id.padEnd(34)} ${c.city.padEnd(22)} ${c.from.padEnd(20)} -> ${c.to} ${c.country}`);
console.log(`\n${changes.length} races to fix; left as they are (no reliable country): ${unknown.join(', ') || 'none'}`);
if (!APPLY) process.exit(0);
for (let i = 0; i < changes.length; i += 50) {
  await db.batch(changes.slice(i, i + 50).map((c) => ({ sql: 'UPDATE hyrox_races SET country_code = ?, country = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', args: [c.to, c.country, c.id] })), 'write');
}
console.log('Done.');
