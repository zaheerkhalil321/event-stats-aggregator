/**
 * Parsing and matching helpers for mika:timing season and result-list pages.
 *
 * Season page (`/<season-slug>/?pid=list`): one <optgroup> per race ("2026 Berlin"), one <option>
 * per wave. Wave codes are `<division prefix>_<race code>`, e.g. H_LR3MS4JI1633 (HYROX, one day),
 * HD_… (doubles), HPRO_…, HDP_…, HMR_… (relay), HA_… (adaptive), plus `…_OVERALL` waves that merge all days.
 *
 * List page (`?event=<wave>&pid=list&num_results=100&page=N`): 100 athletes per request, each with
 * the detail link that carries the athlete's idp and the exact event code.
 */

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—' };

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

const stripTags = (s) => decodeEntities(String(s ?? '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export function parseSeasonGroups(html) {
  const groups = [];
  for (const g of String(html).matchAll(/<optgroup[^>]*label="([^"]*)"[^>]*>([\s\S]*?)<\/optgroup>/gi)) {
    const options = [...g[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([\s\S]*?)<\/option>/gi)]
      .map((o) => ({ val: o[1].trim(), text: stripTags(o[2]) }))
      .filter((o) => o.val);
    groups.push({ label: decodeEntities(g[1]).trim(), options });
  }
  return groups;
}

export function parseListPage(html) {
  html = String(html);
  // mika caps the counter ("> 600 Results"), so a ">" count is only a lower bound.
  const totalMatch = html.match(/(&gt;\s*)?(\d[\d.,]*)\s*Results/i);
  const total = totalMatch ? parseInt(totalMatch[2].replace(/\D/g, ''), 10) : null;
  const totalIsLowerBound = Boolean(totalMatch?.[1]);
  const items = [];
  for (const li of html.matchAll(/<li class="[^"]*list-group-item[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const body = li[1];
    const link = body.match(/<a[^>]*href="([^"]*content=detail[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const href = decodeEntities(link[1]);
    const idp = href.match(/[?&]idp=([A-Za-z0-9_]+)/)?.[1];
    if (!idp) continue;
    const rawName = stripTags(link[2]);
    const fieldValue = (cls) => {
      const m = body.match(new RegExp(`list-field ${cls}"[^>]*>(?:<div[^>]*list-label[^>]*>[\\s\\S]*?<\\/div>)?([\\s\\S]*?)<\\/div>`, 'i'));
      return m ? stripTags(m[1]) : null;
    };
    const time = fieldValue('type-time');
    items.push({
      idp,
      event: href.match(/[?&]event=([A-Za-z0-9_]+)/)?.[1] || null,
      name: rawName.replace(/\s*\([A-Za-z]{2,3}\)\s*$/, '').trim(),
      nation: body.match(/nation__abbr">\s*([A-Z]{2,3})\s*</)?.[1] || rawName.match(/\(([A-Za-z]{2,3})\)\s*$/)?.[1]?.toUpperCase() || null,
      ageGroup: fieldValue('type-age_class') || null,
      time: /\d:\d\d/.test(time || '') ? time : null,
      place: parseInt(body.match(/type-place place-primary[^"]*"[^>]*>\s*(\d+)\s*</)?.[1] ?? '', 10) || null,
    });
  }
  return { total, totalIsLowerBound, items };
}

export function normName(s) {
  return String(s ?? '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s*\([a-z]{2,3}\)\s*$/, '')
    .replace(/[^a-z0-9, ]+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

const nameTokens = (s) => new Set(normName(s).split(/[ ,]+/).filter((t) => t.length >= 3));

export function timeToSeconds(t) {
  const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

const WAVE_FAMILIES = { H: 'single', HPRO: 'pro', HD: 'doubles', HDP: 'pro_doubles', HMR: 'relay', HA: 'adaptive' };

export function waveFamily(waveVal) {
  return WAVE_FAMILIES[String(waveVal ?? '').split('_')[0].toUpperCase()] ?? null;
}

export function divisionFamily(division) {
  const d = String(division ?? '').toUpperCase();
  if (d.includes('RELAY')) return 'relay';
  if (d.includes('ADAPTIVE')) return 'adaptive';
  if (d.includes('PRO') && d.includes('DOUBLES')) return 'pro_doubles';
  if (d.includes('DOUBLES')) return 'doubles';
  if (d.includes('PRO')) return 'pro';
  if (d.includes('ELITE')) return 'elite';
  return 'single';
}

// Merged lists: H_BER26_OVERALL, and per-week ones on multi-week events (H_JFK26_OVERALL_1).
export const isOverallWave = (val) => /_OVERALL(_\d+)?$/i.test(String(val ?? ''));

// Merged-list links carry a suffix on the idp (LR3MS4JI517A9D_BER, LR3MS4JI5260FF_JFK_1);
// mika idps themselves never contain "_", so the athlete is identified by the part before it.
export const baseIdp = (idp) => String(idp ?? '').split('_')[0];

// One entry per athlete, preferring the day-wave entry (exact wave code) over the overall one.
export function dedupeItems(items) {
  const byAthlete = new Map();
  for (const it of items) {
    const key = baseIdp(it.idp);
    const prev = byAthlete.get(key);
    if (!prev || (isOverallWave(prev.event) && !isOverallWave(it.event))) byAthlete.set(key, it);
  }
  return [...byAthlete.values()];
}

const words = (s) => String(s ?? '')
  .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().split(/[^a-z0-9]+/)
  .filter((w) => w && w !== 'hyrox' && !/^\d{4}$/.test(w));

/**
 * Pick the season-page group for a race. `groupsBySlug` maps season slug -> parsed groups.
 * A group qualifies when its year matches the race year and either all its words appear in the
 * race's name/city/id, or all city words appear in the label. Returns null when nothing or
 * more than one group fits equally well.
 */
export function pickRaceGroup(groupsBySlug, race, preferredSlug) {
  const raceYear = String(race.date ?? '').slice(0, 4) || String(race.id).match(/(\d{4})/)?.[1];
  const raceWords = new Set([...words(race.name), ...words(race.city), ...words(race.id)]);
  const cityWords = words(race.city);
  const scored = [];
  for (const [slug, groups] of Object.entries(groupsBySlug)) {
    for (const group of groups) {
      const m = group.label.match(/^(\d{4})\s+(.*)$/);
      if (!m || m[1] !== raceYear) continue;
      const labelWords = words(m[2]);
      if (!labelWords.length) continue;
      const labelInRace = labelWords.every((w) => raceWords.has(w));
      const cityInLabel = cityWords.length > 0 && cityWords.every((w) => labelWords.includes(w));
      if (!labelInRace && !cityInLabel) continue;
      const score = labelWords.filter((w) => raceWords.has(w)).length
        + (labelInRace ? 2 : 0)
        - (labelInRace ? 0 : labelWords.filter((w) => !raceWords.has(w)).length)
        + (slug === preferredSlug ? 0.5 : 0);
      scored.push({ slug, group, score });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null; // ambiguous
  return scored[0];
}

/**
 * Match list items to database rows that have no idp yet. Only one-to-one matches are accepted:
 *   1. same division family + same normalised name + same finish time
 *   2. same normalised name + same finish time (division labels sometimes differ)
 *   3. same family + same finish time + at least one shared name word, when exactly one candidate exists
 *   4. same family + same name, for athletes without a finish time (DNF)
 * Items whose idp already belongs to another row of the race are ignored.
 */
export function matchItemsToRows(items, rows, existingIdps = new Set()) {
  const taken = new Set([...existingIdps].map(baseIdp));
  const freeItems = dedupeItems(items)
    .filter((it) => !taken.has(baseIdp(it.idp)))
    .map((it) => ({ ...it, _name: normName(it.name), _time: timeToSeconds(it.time), _family: waveFamily(it.event) }));
  const freeRows = rows.map((r) => ({ ...r, _name: normName(r.full_name), _time: timeToSeconds(r.total_time), _family: divisionFamily(r.division) }));
  const usedItems = new Set();
  const usedRows = new Set();
  const usedIdps = new Set();
  const matches = [];

  const accept = (row, item, via) => {
    usedRows.add(row.id);
    usedItems.add(item);
    usedIdps.add(item.idp); // items are deduped by base idp, so the raw idp is unique here
    matches.push({ id: row.id, idp: item.idp, event: item.event, via });
  };

  const uniqueIndex = (list, keyFn) => {
    const map = new Map();
    for (const x of list) {
      const k = keyFn(x);
      if (k === null) continue;
      map.set(k, map.has(k) ? null : x); // null marks an ambiguous key
    }
    return map;
  };

  const pass = (via, keyFn) => {
    const openItems = freeItems.filter((it) => !usedItems.has(it) && !usedIdps.has(it.idp));
    const openRows = freeRows.filter((r) => !usedRows.has(r.id));
    const itemIndex = uniqueIndex(openItems, keyFn);
    const rowIndex = uniqueIndex(openRows, keyFn);
    for (const [k, row] of rowIndex) {
      const item = itemIndex.get(k);
      if (row && item && !usedIdps.has(item.idp)) accept(row, item, via);
    }
  };

  pass('family+name+time', (x) => (x._time !== null && x._name ? `${x._family}|${x._name}|${x._time}` : null));
  pass('name+time', (x) => (x._time !== null && x._name ? `${x._name}|${x._time}` : null));

  // 3. finish time + one shared name word, only when the time identifies a single candidate on both sides
  const byTime = (list) => {
    const map = new Map();
    for (const x of list) {
      if (x._time === null) continue;
      const k = `${x._family}|${x._time}`;
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    }
    return map;
  };
  const openItemsByTime = byTime(freeItems.filter((it) => !usedItems.has(it) && !usedIdps.has(it.idp)));
  const openRowsByTime = byTime(freeRows.filter((r) => !usedRows.has(r.id)));
  for (const [k, rowList] of openRowsByTime) {
    const itemList = openItemsByTime.get(k);
    if (!itemList || rowList.length !== 1 || itemList.length !== 1) continue;
    const [row] = rowList;
    const [item] = itemList;
    const rowWords = nameTokens(row.full_name);
    if ([...nameTokens(item.name)].some((w) => rowWords.has(w)) && !usedIdps.has(item.idp)) accept(row, item, 'time+name-word');
  }

  pass('family+name (no time)', (x) => (x._time === null && x._name ? `${x._family}|${x._name}` : null));

  return matches;
}
