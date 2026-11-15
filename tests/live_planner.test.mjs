import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { estimateLoad, laneFilter, laneMatrix, peakOnCourse, planLanes, raceFinished, LANE_BUDGET_SECONDS, MAX_LANES } from '../scripts/lib/live_planner.mjs';

const T0 = Date.parse('2026-11-14T08:00:00Z');
const at = (min) => new Date(T0 + min * 60_000).toISOString();
const ids = (lanes) => lanes.flatMap((l) => l.races).sort();

// This weekend (14 Nov 2026), roughly: loads in seconds per pass.
const WEEKEND = [
  { id: 'barcelona-nov-2026', region: 'europe', load: 380 },
  { id: 'dusseldorf-2026', region: 'europe', load: 260 },
  { id: 'dublin-2026', region: 'europe', load: 240 },
  { id: 'cairo-2026', region: 'europe', load: 90 },
  { id: 'seoul-2026', region: 'asia', load: 300 },
  { id: 'delhi-2026', region: 'asia', load: 60 },
  { id: 'denver-2026', region: 'americas', load: 250 },
];

test('every race goes to exactly one lane', () => {
  for (const races of [WEEKEND, WEEKEND.slice(0, 1), WEEKEND.slice(0, 3), []]) {
    const lanes = planLanes(races);
    assert.deepEqual(ids(lanes), races.map((r) => r.id).sort());
    assert.equal(new Set(ids(lanes)).size, ids(lanes).length, 'no race twice');
  }
});

test('enough lanes for the load, never more than the maximum', () => {
  const lanes = planLanes(WEEKEND);
  const total = WEEKEND.reduce((s, r) => s + r.load, 0);
  assert.equal(lanes.length, Math.min(MAX_LANES, Math.ceil(total / LANE_BUDGET_SECONDS)));
  assert.equal(planLanes([{ id: 'a', region: 'europe', load: 50 }]).length, 1);
  const huge = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}`, region: 'europe', load: 400 }));
  assert.equal(planLanes(huge).length, MAX_LANES);
  assert.equal(ids(planLanes(huge)).length, 20);
});

test('lanes are balanced: no lane far above the others', () => {
  const lanes = planLanes(WEEKEND);
  const loads = lanes.map((l) => l.load);
  const biggest = Math.max(...WEEKEND.map((r) => r.load));
  assert.ok(Math.max(...loads) - Math.min(...loads) <= biggest, `loads ${loads}`);
});

test('races of one region share a lane when the load allows (Barcelona with Düsseldorf)', () => {
  const lanes = planLanes([
    { id: 'barcelona-nov-2026', region: 'europe', load: 150 },
    { id: 'dusseldorf-2026', region: 'europe', load: 140 },
    { id: 'denver-2026', region: 'americas', load: 300 },
    { id: 'seoul-2026', region: 'asia', load: 290 },
  ]);
  const laneOf = (id) => lanes.find((l) => l.races.includes(id)).lane;
  assert.equal(laneOf('barcelona-nov-2026'), laneOf('dusseldorf-2026'));
});

test('the same input always gives the same plan', () => {
  const a = JSON.stringify(planLanes(WEEKEND));
  const b = JSON.stringify(planLanes([...WEEKEND].reverse()));
  assert.equal(a, b);
});

test('lane 1 also keeps every race no other lane took', () => {
  const lanes = planLanes(WEEKEND);
  const matrix = laneMatrix(lanes, new Map([['barcelona-nov-2026', 'Barcelona']]));
  assert.equal(matrix.length, lanes.length);
  const first = matrix[0];
  assert.match(first.args, /^--exclude=/);
  const excluded = first.args.replace('--exclude=', '').split(',');
  const others = lanes.slice(1).flatMap((l) => l.races);
  assert.deepEqual(excluded.sort(), others.sort());
  for (const m of matrix.slice(1)) assert.match(m.args, /^--races=/);
  // lane filters: each race is synced by exactly one lane; an unknown race only by lane 1
  const filters = matrix.map((m) => {
    const races = m.args.startsWith('--races=') ? m.args.slice(8).split(',') : null;
    const exclude = m.args.startsWith('--exclude=') ? m.args.slice(10).split(',') : null;
    return laneFilter({ races, exclude });
  });
  for (const r of [...WEEKEND.map((x) => x.id), 'some-old-race-2025']) {
    assert.equal(filters.filter((f) => f(r)).length, 1, r);
  }
  assert.ok(filters[0]('some-old-race-2025'));
  // a single lane syncs everything
  assert.equal(laneMatrix(planLanes(WEEKEND.slice(0, 1)))[0].args, '');
});

test('peak on the course from heat starts', () => {
  const heats = [
    ...Array(50).fill(at(0)), ...Array(50).fill(at(20)), ...Array(50).fill(at(40)),
    ...Array(50).fill(at(200)), // later heat: earlier ones are off the course by then
  ];
  assert.equal(peakOnCourse(heats, T0), 150);
  assert.equal(peakOnCourse(heats, T0 + 150 * 60_000), 50);
  assert.equal(peakOnCourse([], T0), 0);
});

test('load: learned numbers win over the estimate', () => {
  assert.equal(estimateLoad({ waves: 10, peak: 200 }), 60 + 90);
  assert.equal(estimateLoad({ waves: 10, peak: 200, stats: { list_seconds: 30, seconds_per_page: 0.3 } }), 30 + 60);
});

describe('finished races', () => {
  const now = Date.parse('2026-11-15T22:00:00Z');
  it('is over on its last day once the last heat started more than 3 hours ago', () => {
    assert.equal(raceFinished({ heatStarts: ['2026-11-15T08:00:00Z', '2026-11-15T17:30:00Z'], endDate: '2026-11-15', now }), true);
  });
  it('keeps a race whose last heat is recent or still to come', () => {
    assert.equal(raceFinished({ heatStarts: ['2026-11-15T20:30:00Z'], endDate: '2026-11-15', now }), false);
    assert.equal(raceFinished({ heatStarts: ['2026-11-16T09:00:00Z'], endDate: '2026-11-16', now }), false);
  });
  it('keeps a race with days still to come, even when today\'s heats are over', () => {
    assert.equal(raceFinished({ heatStarts: ['2026-11-15T10:00:00Z'], endDate: '2026-11-16', now }), false);
  });
  it('keeps a race without a start list', () => {
    assert.equal(raceFinished({ heatStarts: [], endDate: '2026-11-15', now }), false);
  });
  it('lane 1 skips finished races instead of taking them as "everything else"', () => {
    const m = laneMatrix([{ lane: 1, races: ['denver'], load: 100 }, { lane: 2, races: ['dublin'], load: 90 }], new Map(), ['seoul', 'cairo']);
    assert.equal(m[0].args, '--exclude=dublin,seoul,cairo');
    assert.equal(m[1].args, '--races=dublin');
    const solo = laneMatrix([{ lane: 1, races: ['denver'], load: 100 }], new Map(), ['seoul']);
    assert.equal(solo[0].args, '--exclude=seoul');
  });
});

