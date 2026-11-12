import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseListPage, parseSeasonGroups, pickRaceGroup, matchItemsToRows, dedupeItems, normName, timeToSeconds, waveFamily, divisionFamily, resolveCalendarRace, isOverallWave, extraWavesFor, divisionLabel } from '../scripts/lib/mika_list.mjs';

const item = (idp, name, time, event = 'H_LR3MS4JI1632', place = 1) => `
<li class="list-group-item row">
<div class="col-xs-12 col-sm-12 col-md-5 list-field-wrap"><div class="row">
  <div class=" list-field type-place place-primary numeric" style="width: 60px">${place}</div>
  <div class=" list-field type-nation_flag place-primary" style="width: 31px"><span class="nation__labelled-icon"><span class="nation__abbr">GER</span></span></div>
  <h4 class=" list-field type-fullname"><a href="?content=detail&amp;fpid=list&amp;pid=list&amp;idp=${idp}&amp;lang=EN_CAP&amp;event=${event}&amp;num_results=100">${name} (GER)</a></h4>
</div></div>
<div class="col-xs-12 col-sm-12 col-md-7 list-field-wrap"><div class="pull-left"><div class="row">
  <div class=" list-field type-age_class" style="width: auto"><div class="visible-xs-block visible-sm-block list-label">Age Group</div>25-29</div>
</div></div><div class="pull-right"><div class="row">
  <div class=" list-field type-actual_ranking_time" style="width: 130px"><div class="visible-xs-block visible-sm-block list-label">Time</div><span class="text-muted">&ndash;</span></div>
  <div class="right list-field type-time" style="width: 70px"><div class="visible-xs-block visible-sm-block list-label">Total</div>${time}</div>
</div></div></div>
</li>`;

describe('mika list parsing', () => {
  it('TC40: parses idp, exact event, name, nation, age group and finish time', () => {
    const html = `<div>&gt; 600 Results</div><ul><li class="list-group-item list-group-header">x</li>${item('LR3MS4JI51835A', 'Kretschmer, Sarah', '01:14:16')}</ul>`;
    const page = parseListPage(html);
    assert.equal(page.total, 600);
    assert.equal(page.totalIsLowerBound, true, '"> 600 Results" is only a lower bound');
    assert.equal(page.items.length, 1);
    assert.deepEqual(page.items[0], {
      idp: 'LR3MS4JI51835A', event: 'H_LR3MS4JI1632', name: 'Kretschmer, Sarah', nation: 'GER', ageGroup: '25-29', time: '01:14:16', place: 1,
    });
  });

  it('TC41: an exact result count is not a lower bound', () => {
    const page = parseListPage(`<div>2670 Results</div>`);
    assert.equal(page.total, 2670);
    assert.equal(page.totalIsLowerBound, false);
  });

  it('TC42: parses season groups and wave options', () => {
    const groups = parseSeasonGroups(`<select><optgroup label="2026 Berlin"><option value="H_LR3MS4JI1632">HYROX - Fri, 22 May</option><option value="H_BER26_OVERALL">HYROX - Overall</option></optgroup></select>`);
    assert.deepEqual(groups, [{ label: '2026 Berlin', options: [{ val: 'H_LR3MS4JI1632', text: 'HYROX - Fri, 22 May' }, { val: 'H_BER26_OVERALL', text: 'HYROX - Overall' }] }]);
  });

  it('TC43: normalises names and times', () => {
    assert.equal(normName('Kürpper,  Murielle (GER)'), 'kurpper,murielle');
    assert.equal(timeToSeconds('01:14:16'), 4456);
    assert.equal(timeToSeconds('–'), null);
    assert.equal(waveFamily('HDP_LR3MS4JI1633'), 'pro_doubles');
    assert.equal(divisionFamily('HYROX PRO DOUBLES MEN'), 'pro_doubles');
    assert.equal(divisionFamily('HYROX WOMEN'), 'single');
  });
});

describe('mika race-group selection', () => {
  const groups = { 'season-8': [{ label: '2026 London Olympia', options: [] }, { label: '2026 London ExCeL', options: [] }, { label: '2025 Berlin', options: [] }, { label: '2026 Berlin', options: [] }, { label: 'sonstige', options: [] }] };

  it('TC44: picks the group whose year and words match the race', () => {
    const pick = pickRaceGroup(groups, { id: 'berlin-2026', name: 'HYROX Berlin 2026', city: 'Berlin', date: '2026-05-22' }, 'season-8');
    assert.equal(pick.group.label, '2026 Berlin');
    const london = pickRaceGroup(groups, { id: 'london-olympia-2026', name: 'HYROX London Olympia 2026', city: 'London', date: '2026-05-29' }, 'season-8');
    assert.equal(london.group.label, '2026 London Olympia');
  });

  it('TC45: returns null instead of guessing between equally good groups', () => {
    const pick = pickRaceGroup(groups, { id: 'london-2026', name: 'HYROX London 2026', city: 'London', date: '2026-03-01' }, 'season-8');
    assert.equal(pick, null);
  });
});

describe('mika list-to-database matching', () => {
  const it_ = (idp, name, time, event = 'H_LR3MS4JI1632') => ({ idp, name, time, event });

  it('TC46: matches one-to-one on name + finish time and keeps the exact event', () => {
    const matches = matchItemsToRows(
      [it_('A1', 'Kretschmer, Sarah', '01:14:16'), it_('A2', 'Müller, Tim', '00:58:00')],
      [{ id: 1, full_name: 'Kretschmer, Sarah', total_time: '01:14:16', division: 'HYROX WOMEN' }, { id: 2, full_name: 'Muller, Tim', total_time: '00:58:00', division: 'HYROX MEN' }],
    );
    assert.deepEqual(matches.map((m) => [m.id, m.idp, m.event]), [[1, 'A1', 'H_LR3MS4JI1632'], [2, 'A2', 'H_LR3MS4JI1632']]);
  });

  it('TC47: never assigns when a name + time is ambiguous on either side', () => {
    const matches = matchItemsToRows(
      [it_('A1', 'Smith, John', '01:00:00'), it_('A2', 'Smith, John', '01:00:00')],
      [{ id: 1, full_name: 'Smith, John', total_time: '01:00:00', division: 'HYROX MEN' }],
    );
    assert.equal(matches.length, 0);
  });

  it('TC48: matches a broken doubles name by time + shared name word, once', () => {
    const matches = matchItemsToRows(
      [it_('D1', 'Camilla Bøeng, Ludwig Wissinger', '01:18:27', 'HD_LR3MS4JI1632')],
      [{ id: 7, full_name: '- -, Camilla Bøeng', total_time: '01:18:27', division: 'HYROX DOUBLES MIXED' }],
    );
    assert.deepEqual(matches.map((m) => [m.id, m.idp, m.via]), [[7, 'D1', 'time+name-word']]);
  });

  it('TC49: skips athletes whose idp already belongs to another row, including overall-suffixed idps', () => {
    const matches = matchItemsToRows(
      [it_('X1_BER', 'Doe, Jane', '01:30:00', 'H_BER26_OVERALL')],
      [{ id: 3, full_name: 'Doe, Jane', total_time: '01:30:00', division: 'HYROX WOMEN' }],
      new Set(['X1']),
    );
    assert.equal(matches.length, 0);
  });

  it('TC50: dedupes day and overall entries of the same athlete, preferring the day wave', () => {
    const items = dedupeItems([it_('X1_BER', 'Doe, Jane', '01:30:00', 'H_BER26_OVERALL'), it_('X1', 'Doe, Jane', '01:30:00', 'H_LR3MS4JI1633')]);
    assert.deepEqual(items.map((i) => [i.idp, i.event]), [['X1', 'H_LR3MS4JI1633']]);
  });

  it('TC63: multi-week events (New York "Week I/II" lists) are treated as merged lists, not as extra days', () => {
    const items = dedupeItems([
      it_('LR3MS4JI5260FF_JFK_1', 'Seeland, Esther', '01:01:24', 'H_JFK26_OVERALL_1'),
      it_('LR3MS4JI5260FF_JFK', 'Seeland, Esther', '01:01:24', 'H_JFK26_OVERALL'),
      it_('LR3MS4JI5260FF', 'Seeland, Esther', '01:01:24', 'H_LR3MS4JI1628'),
    ]);
    assert.deepEqual(items.map((i) => i.event), ['H_LR3MS4JI1628']);
    const matches = matchItemsToRows(items, [{ id: 9, full_name: 'Seeland, Esther', total_time: '01:01:24', division: 'HYROX WOMEN' }]);
    assert.deepEqual(matches.map((m) => [m.id, m.idp]), [[9, 'LR3MS4JI5260FF']]);
  });
});

it('matchItemsToRows: team names match when the imported time is wrong', () => {
  const items = [
    { idp: 'X1', event: 'HD_LR3MS4JIA1A', name: 'Aaron Campbell, Ryan McColm', time: '00:58:10' },
    { idp: 'X2', event: 'HD_LR3MS4JIA1A', name: 'Jack Jones, Ross Marshall', time: '00:59:02' },
    { idp: 'X3', event: 'HD_LR3MS4JIA1A', name: 'Same Name, Other Person', time: '01:10:00' },
    { idp: 'X4', event: 'HD_LR3MS4JIA1A', name: 'Same Name, Other Person', time: '01:12:00' },
  ];
  const rows = [
    { id: 1, full_name: 'Ryan McColm, Ryan McColm, Aaron Campbell, Aaron Campbell', division: 'HYROX DOUBLES MEN', total_time: '01:01:48' },
    { id: 2, full_name: 'Jack Jones, Ross Marshall', division: 'HYROX DOUBLES MEN', total_time: '01:01:48' },
    { id: 3, full_name: 'Same Name, Other Person', division: 'HYROX DOUBLES MEN', total_time: '01:01:48' },
    { id: 4, full_name: 'Solo Runner', division: 'HYROX MEN', total_time: '01:01:48' },
  ];
  assert.deepEqual(matchItemsToRows(items, rows), []); // off by default
  const m = matchItemsToRows(items, rows, new Set(), { teamNames: true });
  assert.deepEqual(m.map((x) => [x.id, x.idp]).sort(), [[1, 'X1'], [2, 'X2']]);
  assert.equal(m.find((x) => x.id === 1).time, '00:58:10');
});

describe('resolveCalendarRace', () => {
  const races = [
    { id: 'barcelona-2026', name: 'HYROX Barcelona 2026', city: 'Barcelona', date: '2026-05-14', end_date: '2026-05-17', season: '25/26' },
    { id: 'barcelona-nov-2026', name: 'HYROX Barcelona 2026', city: 'Barcelona', date: '2026-11-11', end_date: '2026-11-15', season: '26/27' },
    { id: 'dusseldorf-2026', name: 'HYROX Düsseldorf 2026', city: 'Düsseldorf', date: '2026-11-11', end_date: '2026-11-15', season: '26/27' },
    { id: 'd-sseldorf-2026', name: 'HYROX Düsseldorf 2026', city: 'Düsseldorf', date: '2026-12-31', end_date: '2026-12-31', season: '26/27' },
    { id: 'dublin-2026', name: 'HYROX Dublin 2026', city: 'Dublin', date: '2026-11-11', end_date: '2026-11-15', season: '26/27' },
    { id: 'london-2026', name: 'HYROX London 2026', city: 'London', date: '2026-03-20', end_date: '2026-03-22', season: '26/27' },
    { id: 'london-dec-2026', name: 'HYROX London 2026', city: 'London', date: '2026-12-04', end_date: '2026-12-06', season: '26/27' },
    { id: 'beijing-2026', name: 'HYROX Beijing 2026', city: 'Beijing', date: '2026-01-10', end_date: '2026-01-11', season: '26/27' },
    { id: 'beijing-sep-2026', name: 'HYROX Beijing September 2026', city: 'Beijing', date: '2026-09-10', end_date: '2026-09-13', season: '26/27' },
    { id: 'birmingham-2026', name: 'HYROX Birmingham 2026', city: 'Birmingham', date: '2026-10-27', end_date: '2026-11-01', season: '26/27' },
    { id: 'birmingham-youngstars-2026', name: 'HYROX Birmingham - Youngstars 2026', city: 'Birmingham - Youngstars', date: '2026-10-31', end_date: '2026-11-01', season: '26/27' },
  ];
  const today = '2026-11-12';

  it('picks the November race, not the finished May race of the same city', () => {
    assert.equal(resolveCalendarRace('2026 Barcelona', races, today, '26/27').id, 'barcelona-nov-2026');
  });
  it('matches accented city names and prefers a real date over a placeholder row', () => {
    assert.equal(resolveCalendarRace('2026 Düsseldorf', races, today, '26/27').id, 'dusseldorf-2026');
  });
  it('without a race today, takes the closest date', () => {
    assert.equal(resolveCalendarRace('2026 London', races, today, '26/27').id, 'london-dec-2026');
  });
  it('prefers the main race over a side event of the same city', () => {
    assert.equal(resolveCalendarRace('2026 Birmingham', races, today, '26/27').id, 'birmingham-2026');
    assert.equal(resolveCalendarRace('2026 Birmingham', races, '2026-10-31', '26/27').id, 'birmingham-2026');
  });
  it('does not count words of the race name such as "September" against it', () => {
    assert.equal(resolveCalendarRace('2026 Beijing', races, today, '26/27').id, 'beijing-sep-2026');
  });
  it('returns null when no calendar race fits', () => {
    assert.equal(resolveCalendarRace('2026 Atlantis', races, today, '26/27'), null);
    assert.equal(resolveCalendarRace('2025 Dublin', races, today, '26/27'), null);
    assert.equal(resolveCalendarRace('Dublin', races, today, '26/27'), null);
  });
});

describe('isOverallWave', () => {
  it('flags combined lists that repeat other waves', () => {
    assert.equal(isOverallWave('H_MEX26_OVERALL'), true);
    assert.equal(isOverallWave('HD_MEX26_OVERALL_2'), true);
    assert.equal(isOverallWave('ALL__H_HA_HD_LR3MS4JI1802'), true);
    assert.equal(isOverallWave('ALL__HE_LR3MS4JI179B'), true);
  });
  it('keeps real waves', () => {
    assert.equal(isOverallWave('H_LR3MS4JI1803'), false);
    assert.equal(isOverallWave('HD_LR3MS4JI17A0'), false);
  });
});

describe('extraWavesFor', () => {
  const istanbul = { label: '2026 Istanbul', options: [
    { text: 'HYROX PRO', val: 'HPRO_LR3MS4JI1722' },
    { text: 'HYROX - Sunday', val: 'H_LR3MS4JI1723' },
  ] };
  const sonstige = { label: 'sonstige', options: [
    { text: 'HYROX DOUBLES', val: 'HD_LR3MS4JI1723' },
    { text: 'HYROX ADAPTIVE', val: 'HA_LR3MS4JI1722' },
    { text: 'HYROX DOUBLES', val: 'HD_LR3MS4JI173A' },
  ] };
  it('adds the sonstige waves whose code matches one of the race waves', () => {
    assert.deepEqual(extraWavesFor(istanbul, sonstige).map((o) => o.val), ['HD_LR3MS4JI1723', 'HA_LR3MS4JI1722']);
  });
  it('adds nothing without a sonstige group or a match', () => {
    assert.deepEqual(extraWavesFor(istanbul, null), []);
    assert.deepEqual(extraWavesFor({ label: 'x', options: [{ text: 'a', val: 'H_ZZZ' }] }, sonstige), []);
  });
});

describe('divisionLabel', () => {
  it('matches the labels live sync stores', () => {
    assert.equal(divisionLabel('HYROX DOUBLES - Sunday', 'X'), 'HYROX DOUBLES MIXED');
    assert.equal(divisionLabel('HYROX PRO', 'W'), 'HYROX PRO WOMEN');
    assert.equal(divisionLabel('HYROX - Saturday', 'M'), 'HYROX MEN');
    assert.equal(divisionLabel('HYROX TEAM RELAY', 'M'), 'HYROX TEAM RELAY MEN');
  });
});

// ---------- assignDistinctNames ----------
import { it as test } from "node:test";
import { assignDistinctNames } from '../scripts/lib/mika_list.mjs';

test('assignDistinctNames: two athletes with one name in one batch both stay', () => {
  const out = assignDistinctNames([
    { full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'A1', bib_number: '101' },
    { full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'B2', bib_number: '202' },
  ]);
  assert.deepEqual(out.map((a) => a.full_name), ['Rahul Shah', 'Rahul Shah (bib 202)']);
});

test('assignDistinctNames: a later wave does not overwrite the stored athlete', () => {
  const out = assignDistinctNames(
    [{ full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'B2', bib_number: '202' }],
    { nameOfIdp: new Map([['A1', 'Rahul Shah']]), ownerOfName: new Map([['rahul shah|HYROX MEN', 'A1']]) },
  );
  assert.equal(out[0].full_name, 'Rahul Shah (bib 202)');
});

test('assignDistinctNames: names stay the same on the next sync', () => {
  const stored = {
    nameOfIdp: new Map([['A1', 'Rahul Shah'], ['B2', 'Rahul Shah (bib 202)']]),
    ownerOfName: new Map([['rahul shah|HYROX MEN', 'A1'], ['rahul shah (bib 202)|HYROX MEN', 'B2']]),
  };
  // Even when the second athlete comes first this time.
  const out = assignDistinctNames([
    { full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'B2', bib_number: '202' },
    { full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'A1', bib_number: '101' },
  ], stored);
  assert.deepEqual(out.map((a) => a.full_name), ['Rahul Shah (bib 202)', 'Rahul Shah']);
});

test('assignDistinctNames: same athlete, other divisions, rows without idp are left alone', () => {
  const out = assignDistinctNames(
    [
      { full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'A1', bib_number: '101' },
      { full_name: 'Rahul Shah', division: 'HYROX PRO MEN', mika_idp: 'C3', bib_number: '303' },
      { full_name: 'Sara Ali', division: 'HYROX WOMEN', mika_idp: null, bib_number: '5' },
    ],
    { ownerOfName: new Map([['sara ali|HYROX WOMEN', 'Z9']]) },
  );
  assert.deepEqual(out.map((a) => a.full_name), ['Rahul Shah', 'Rahul Shah', 'Sara Ali']);
});

test('assignDistinctNames: a stored row without idp is not treated as another athlete', () => {
  const out = assignDistinctNames(
    [{ full_name: 'Rahul Shah', division: 'HYROX MEN', mika_idp: 'A1', bib_number: '101' }],
    { ownerOfName: new Map([['rahul shah|HYROX MEN', null]]) },
  );
  assert.equal(out[0].full_name, 'Rahul Shah');
});

// ---------- normalizeFinishTime ----------
import { normalizeFinishTime } from '../scripts/lib/mika_list.mjs';

test('normalizeFinishTime: Elite 15 cells with label and hundredths', () => {
  assert.equal(normalizeFinishTime('Finish Times47:54.15'), '00:47:54');
  assert.equal(normalizeFinishTime('s47:54.15'), '00:47:54');
});
test('normalizeFinishTime: normal cells stay HH:MM:SS', () => {
  assert.equal(normalizeFinishTime('Total01:02:33'), '01:02:33');
  assert.equal(normalizeFinishTime('00:55:04'), '00:55:04');
  assert.equal(normalizeFinishTime('1:02:33'), '01:02:33');
});
test('normalizeFinishTime: no time keeps the text, empty is null', () => {
  assert.equal(normalizeFinishTime('DNF'), 'DNF');
  assert.equal(normalizeFinishTime('  '), null);
  assert.equal(normalizeFinishTime(undefined), null);
});
