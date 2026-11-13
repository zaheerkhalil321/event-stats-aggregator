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
});
