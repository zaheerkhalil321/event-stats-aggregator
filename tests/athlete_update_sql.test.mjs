import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import { updateSql, cleanDisqualReason } from '../scripts/lib/athlete_update_sql.mjs';
import { parseDeepDetail } from '../scripts/backfill_splits.mjs';

const COLUMNS = ['run_1', 'skierg', 'run_2', 'sled_push', 'run_3', 'sled_pull', 'run_4', 'burpee_jumps', 'run_5', 'rowing', 'run_6',
  'farmers_carry', 'run_7', 'sandbag_lunges', 'run_8', 'wall_balls', 'roxzone', 'run_total', 'best_run_lap', 'bib_number', 'age_group',
  'start_wave', 'start_time', 'team_members', 'cumulative_times', 'penalty_time', 'bonus_time', 'disqual_reason', 'nationality',
  'station_ranks'];

describe('Athlete enrichment SQL', () => {
  let db;
  beforeEach(async () => {
    db = createClient({ url: ':memory:' });
    await db.execute(`CREATE TABLE hyrox_athlete_results (id INTEGER PRIMARY KEY, ${COLUMNS.map((c) => `${c} TEXT`).join(', ')},
      total_time TEXT, gender_rank INTEGER, age_group_rank INTEGER, updated_at TEXT)`);
  });
  const row = async (id) => (await db.execute({ sql: 'SELECT * FROM hyrox_athlete_results WHERE id = ?', args: [id] })).rows[0];

  it('TC54: a DNS page never wipes splits that already exist', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id, run_1, skierg, wall_balls, nationality) VALUES (1, '00:03:41', '00:03:48', '00:03:51', 'ESP')`);
    await db.execute(updateSql({ id: 1, dns: true, disqual_reason: 'DNS', bib_number: '200022' }));
    const r = await row(1);
    assert.equal(r.run_1, '00:03:41');
    assert.equal(r.skierg, '00:03:48');
    assert.equal(r.disqual_reason, null, 'an athlete with splits is not marked DNS');
    assert.equal(r.bib_number, '200022');
    assert.equal(r.station_ranks, '{}', 'marked as attempted so it is not fetched again');
  });

  it('TC55: a DNS page marks an athlete without splits', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id) VALUES (2)`);
    await db.execute(updateSql({ id: 2, dns: true, disqual_reason: 'DNF' }));
    const r = await row(2);
    assert.equal(r.run_1, '–');
    assert.equal(r.disqual_reason, 'DNF');
    assert.equal(r.station_ranks, '{}');
  });

  it('TC56: a full parse fills splits, keeps known values for missing fields, and replaces an old DNS reason', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id, run_1, bib_number, disqual_reason, nationality) VALUES (3, '–', '777', 'DNS', 'XX')`);
    await db.execute(updateSql({ id: 3, run_1: '00:02:30', skierg: "00:03:23", wall_balls: '00:03:28', nationality: "GBR", gender_rank: 4,
      station_ranks: '{"skierg":1}', cumulative_times: '{"run_1":"00:02:30"}', team_members: '[{"name":"O\'Brien, Ben"}]' }));
    const r = await row(3);
    assert.equal(r.run_1, '00:02:30');
    assert.equal(r.wall_balls, '00:03:28');
    assert.equal(r.bib_number, '777', 'not wiped when the page has no bib');
    assert.equal(r.disqual_reason, null, 'a stale DNS mark is cleared once real splits exist');
    assert.equal(r.nationality, 'GBR', 'placeholder XX nationality is replaced');
    assert.equal(Number(r.gender_rank), 4);
    assert.equal(r.station_ranks, '{"skierg":1}');
    assert.equal(r.team_members, '[{"name":"O\'Brien, Ben"}]', 'quotes are escaped');
  });

  it('TC57: rows whose page has no station ranks are still marked as done', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id) VALUES (4)`);
    await db.execute(updateSql({ id: 4, run_1: '00:04:00' }));
    assert.equal((await row(4)).station_ranks, '{}');
  });

  it('TC59: a page without a race replay marks the replay as read, without wiping one that exists', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id, run_1) VALUES (5, '00:04:00')`);
    await db.execute(`INSERT INTO hyrox_athlete_results (id, run_1, cumulative_times) VALUES (6, '00:04:00', '{"Run 1":"00:04:00"}')`);
    await db.execute(updateSql({ id: 5, run_1: '00:04:00' }));
    await db.execute(updateSql({ id: 6, run_1: '00:04:00' }));
    await db.execute(`INSERT INTO hyrox_athlete_results (id) VALUES (7)`);
    await db.execute(updateSql({ id: 7, dns: true }));
    assert.equal((await row(5)).cumulative_times, '{}', 'not picked again for the replay');
    assert.equal((await row(6)).cumulative_times, '{"Run 1":"00:04:00"}');
    assert.equal((await row(7)).cumulative_times, '{}');
  });

  it('TC60: a live-synced doubles row gets its members, replay and a nationality from the page', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id, run_1, station_ranks, nationality) VALUES (8, '00:04:10', '{"skierg":3}', 'XX')`);
    await db.execute(updateSql({ id: 8, run_1: '00:04:10', nationality: 'ARG', team_members: '[{"label":"Member 1","name":"Vinent, Lucas (ARG)"}]',
      cumulative_times: '{"Run 1":"00:04:10"}', start_wave: 'HD_X', station_ranks: '{"skierg":3}' }));
    const r = await row(8);
    assert.equal(r.nationality, 'ARG');
    assert.match(r.team_members, /Vinent/);
    assert.equal(r.cumulative_times, '{"Run 1":"00:04:10"}');
    assert.equal(r.start_wave, 'HD_X');
  });

  it('TC58: rejects a non-numeric id', () => {
    assert.throws(() => updateSql({ id: '1; DROP TABLE x' }));
  });

  it('TC70: a finisher whose detail page shows no splits is never marked DNS', async () => {
    // Real page: a detail URL without the event code returns mika's empty template (all dashes).
    const html = fs.readFileSync(new URL('./fixtures/detail_no_event.html', import.meta.url), 'utf8');
    const parsed = parseDeepDetail(html);
    assert.equal(parsed.run_1, null);
    assert.equal(cleanDisqualReason(parsed.disqual_reason), null);
    await db.execute(`INSERT INTO hyrox_athlete_results (id, total_time) VALUES (3, '01:15:16')`);
    await db.execute(updateSql({ id: 3, dns: true, disqual_reason: parsed.disqual_reason || 'DNS' }));
    const r = await row(3);
    assert.equal(r.disqual_reason, null, 'a row with a finish time is a finisher, not a DNS');
    assert.equal(r.run_1, '–', 'still marked as attempted');
    assert.equal(r.total_time, '01:15:16');
  });

  it('TC71: the column header is never stored as a disqualification reason', async () => {
    assert.equal(cleanDisqualReason('Disqual Reason'), null);
    assert.equal(cleanDisqualReason(' disqualification reason '), null);
    assert.equal(cleanDisqualReason('–'), null);
    assert.equal(cleanDisqualReason('Code 11 - missing farmers carry lap'), 'Code 11 - missing farmers carry lap');
    await db.execute(`INSERT INTO hyrox_athlete_results (id, total_time) VALUES (4, '01:02:03')`);
    await db.execute(updateSql({ id: 4, run_1: '00:04:00', disqual_reason: 'Disqual Reason' }));
    assert.equal((await row(4)).disqual_reason, null);
    await db.execute(updateSql({ id: 4, run_1: '00:04:00', disqual_reason: 'missing workout' }));
    assert.equal((await row(4)).disqual_reason, 'missing workout');
  });

  it('TC72: a row without a finish time on an empty page is still a DNS', async () => {
    await db.execute(`INSERT INTO hyrox_athlete_results (id, total_time) VALUES (5, NULL)`);
    await db.execute(updateSql({ id: 5, dns: true, disqual_reason: 'Disqual Reason' }));
    assert.equal((await row(5)).disqual_reason, 'DNS');
  });
});
