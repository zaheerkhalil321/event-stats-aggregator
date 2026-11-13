import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { localToUtc, parseLiveDetail, parseStartlistPage, raceDayDate, raceTimezone, whereOnCourse } from '../scripts/lib/startlist.mjs';

const fixture = (f) => fs.readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

test('start list rows: id, bib, age group, day and heat', () => {
  const rows = parseStartlistPage(fixture('startlist-page.html'));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], {
    idp: 'LR3MS4JI5BAE2C', name: 'INHYE CHOI, QINGDONG MA', bib: '182046', ageGroup: '35-39',
    day: 'Friday', heat: '18:20', heatLabel: '18:20 HYROX DOUBLES MIXED',
  });
});

test('in-race detail page: splits so far, last timing mat, start clock', () => {
  const d = parseLiveDetail(fixture('live-detail.html'));
  assert.equal(d.finished, false);
  assert.deepEqual(Object.keys(d.splits), ['run_1', 'skierg', 'run_2', 'sled_push', 'run_3', 'sled_pull', 'run_4', 'burpee_jumps', 'run_5', 'rowing', 'run_6']);
  assert.equal(d.splits.rowing, '00:05:37');
  assert.deepEqual(d.last, { point: '200m Farmers Carry In', elapsed: '00:57:57', tod: '20:38:08' });
  assert.equal(d.startTod, '19:40:11');
  assert.deepEqual(d.at, { segment: 'farmers_carry', phase: 'station' });
});

test('where on course after each kind of timing mat', () => {
  const s = { run_1: '00:05:00', skierg: '00:04:00' };
  assert.deepEqual(whereOnCourse(s, { point: 'Rox Out' }), { segment: 'run_2', phase: 'run' });
  assert.deepEqual(whereOnCourse({ ...s, run_2: '00:05:00' }, { point: 'Rox In' }), { segment: 'sled_push', phase: 'roxzone' });
  assert.deepEqual(whereOnCourse(s, { point: '1000m SkiErg Out' }), { segment: 'run_2', phase: 'roxzone' });
  assert.equal(whereOnCourse(s, null), null);
});

test('race day dates and heat times in UTC', () => {
  assert.equal(raceDayDate('2026-11-13', '2026-11-15', 'Sunday'), '2026-11-15');
  assert.equal(raceDayDate('2026-11-13', '2026-11-15', 'Monday'), null);
  assert.equal(localToUtc('2026-11-13', '17:50', raceTimezone({ city: 'Seoul', country_code: 'KR' })), '2026-11-13T08:50:00.000Z');
  assert.equal(localToUtc('2026-11-14', '08:00', raceTimezone({ city: 'Denver', country_code: 'US' })), '2026-11-14T15:00:00.000Z');
  assert.equal(localToUtc('2026-03-29', '10:00', 'Europe/Berlin'), '2026-03-29T08:00:00.000Z'); // first day of summer time
  assert.equal(raceTimezone({ city: 'Atlantis', country_code: 'ZZ' }), null);
  assert.equal(raceTimezone({ city: 'Dublin', country_code: 'XX' }), 'Europe/Dublin');
  assert.equal(raceTimezone({ city: 'Cairo', country_code: 'XX' }), 'Africa/Cairo');
});

test('actual start and last timing mat in UTC from the heat start', async () => {
  const { withUtcTimes } = await import('../scripts/lib/live_tracking.mjs');
  const live = { startTod: '19:40:11', last: { point: 'Rox Out', elapsed: '00:53:48', tod: '20:34:00' } };
  const out = withUtcTimes(live, '19:40', '2026-11-13T10:40:00.000Z');
  assert.equal(out.startedAt, '2026-11-13T10:40:11.000Z');
  assert.equal(out.lastAt, '2026-11-13T11:33:59.000Z');
  assert.equal(withUtcTimes(live, null, null), live);
});

test('a start list refresh removes only its own waves\' old entries', async () => {
  const { syncStartlist } = await import('../scripts/lib/live_tracking.mjs');
  const page = fixture('startlist-page.html');
  const calls = [];
  const deps = {
    mika: { get: async () => ({ text: page }) },
    query: async (sql, args) => { calls.push({ sql, args }); return [{ n: 0, at: null }]; },
    batch: async (stmts) => { for (const s of stmts) calls.push(s); },
    log: () => {},
  };
  const race = { id: 'dusseldorf-2026', city: 'Düsseldorf', country_code: 'DE', date: '2026-11-11', end_date: '2026-11-15' };
  const owners = new Map([['LR3MS4JI5BAE2C', 'barcelona-nov-2026']]);
  await syncStartlist(deps, race, [{ val: 'HD_X', text: 'HYROX DOUBLES - Friday' }, { val: 'H_OVERALL', text: 'HYROX - Overall' }], owners, { force: true });
  const inserts = calls.filter((c) => /^\s*INSERT/.test(c.sql));
  assert.ok(inserts.some((c) => c.args[0] === 'barcelona-nov-2026'), 'claimed entry stored under its race');
  const cleanup = calls.filter((c) => /DELETE|COUNT/.test(c.sql));
  assert.ok(cleanup.length > 0);
  for (const c of cleanup) {
    assert.match(c.sql, /mika_event IN \(\?\)/);
    assert.doesNotMatch(c.sql, /race_id/);
    assert.equal(c.args[0], 'HD_X');
  }
});

test('each race goes to one regional runner', async () => {
  const { raceRegion } = await import('../scripts/lib/startlist.mjs');
  assert.equal(raceRegion({ city: 'Barcelona', country_code: 'ES' }), 'europe');
  assert.equal(raceRegion({ city: 'Dublin', country_code: 'XX' }), 'europe');
  assert.equal(raceRegion({ city: 'Cairo', country_code: 'XX' }), 'europe');
  assert.equal(raceRegion({ city: 'Seoul', country_code: 'KR' }), 'asia');
  assert.equal(raceRegion({ city: 'Delhi', country_code: 'IN' }), 'asia');
  assert.equal(raceRegion({ city: 'Abu Dhabi', country_code: 'AE' }), 'asia');
  assert.equal(raceRegion({ city: 'Denver', country_code: 'US' }), 'americas');
  assert.equal(raceRegion({ city: 'Mexico City', country_code: 'MX' }), 'americas');
  assert.equal(raceRegion({ city: 'Atlantis', country_code: 'ZZ' }), 'europe');
});
