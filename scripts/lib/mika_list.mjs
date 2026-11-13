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

/**
 * Finish time from a list page cell, as HH:MM:SS. The cell can carry a label ("Total", "Finish Time",
 * "Finish Times") and Elite 15 races show hundredths and no hours ("47:54.15" -> "00:47:54").
 * Text without a time (e.g. "DNF") is returned as it is; an empty cell gives null.
 */
export function normalizeFinishTime(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const m = text.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?/);
  if (!m) return text.replace(/^(Total|Finish\s*Times?)\s*/i, '').trim() || null;
  const [h, mm, ss] = m[3] !== undefined ? [m[1], m[2], m[3]] : ['0', m[1], m[2]];
  return [h, mm, ss].map((v) => v.padStart(2, '0')).join(':');
}

export function timeToSeconds(t) {
  const m = String(t ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  return m[3] !== undefined ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : (+m[1]) * 60 + (+m[2]);
}

const TEAM_FAMILIES = new Set(['doubles', 'pro_doubles', 'relay']);

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
// Combined lists that repeat results of the real waves: "... - Overall" (H_MEX26_OVERALL) and
// "ALL" (ALL__H_HA_HD_LR3MS4JI1802). Reading them stores every athlete a second time.
export const isOverallWave = (val) => /_OVERALL(_\d+)?$/i.test(String(val ?? '')) || /^ALL__/i.test(String(val ?? ''));

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

export const labelWords = (s) => String(s ?? '')
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
  const raceWords = new Set([...labelWords(race.name), ...labelWords(race.city), ...labelWords(race.id)]);
  const cityWords = labelWords(race.city);
  const scored = [];
  for (const [slug, groups] of Object.entries(groupsBySlug)) {
    for (const group of groups) {
      const m = group.label.match(/^(\d{4})\s+(.*)$/);
      if (!m || m[1] !== raceYear) continue;
      const groupWords = labelWords(m[2]);
      if (!groupWords.length) continue;
      const labelInRace = groupWords.every((w) => raceWords.has(w));
      const cityInLabel = cityWords.length > 0 && cityWords.every((w) => groupWords.includes(w));
      if (!labelInRace && !cityInLabel) continue;
      const score = groupWords.filter((w) => raceWords.has(w)).length
        + (labelInRace ? 2 : 0)
        - (labelInRace ? 0 : groupWords.filter((w) => !raceWords.has(w)).length)
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
export function matchItemsToRows(items, rows, existingIdps = new Set(), { teamNames = false } = {}) {
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
    matches.push({ id: row.id, idp: item.idp, event: item.event, via, time: item.time ?? null });
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

  // 5. Team divisions only (opt-in): the same set of member names, ignoring the finish time. Older imports
  // gave many doubles teams a wrong time (often one shared time per heat) and wrote names as
  // "A, A, B, B"; a two-person name set that is unique on both sides is still a safe match.
  // Only allowed in the race's own named group: in another event the same team may have raced too.
  if (teamNames) pass('team names (time differs)', (x) => {
    if (!TEAM_FAMILIES.has(x._family)) return null;
    const words = [...new Set(String(x._name).split(/[ ,]+/).filter((w) => w.length >= 2))].sort();
    return words.length >= 3 && String(x._name).includes(',') ? `${x._family}|${words.join(' ')}` : null;
  });

  return matches;
}

/**
 * Waves of a race that mika lists in the catch-all "sonstige" group instead of the race's own
 * group (Istanbul 2026 doubles: HD_LR3MS4JI1723 while the group holds H_LR3MS4JI1723). A wave
 * belongs to the race when its code after the last "_" matches one of the group's waves.
 */
export function extraWavesFor(group, sonstige) {
  if (!group || !sonstige) return [];
  const suffix = (val) => String(val ?? '').split('_').pop();
  const own = new Set((group.options ?? []).map((o) => suffix(o.val)).filter(Boolean));
  const have = new Set((group.options ?? []).map((o) => o.val));
  return (sonstige.options ?? []).filter((o) => own.has(suffix(o.val)) && !have.has(o.val));
}

/** Division label the live scraper stores for a wave and sex ("HYROX DOUBLES - Sunday", "X" -> "HYROX DOUBLES MIXED"). */
export function divisionLabel(waveText, sex) {
  const base = String(waveText ?? '').replace(/\s*-\s*(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i, '').trim();
  const suffix = sex === 'M' ? ' MEN' : sex === 'W' ? ' WOMEN' : ' MIXED';
  return `${base}${suffix}`.toUpperCase().trim();
}

const PLACEHOLDER_DATE = /-12-31$/; // races registered without a known date get Dec 31

/**
 * The calendar race (row of hyrox_races) that a live season-page group such as "2026 Düsseldorf"
 * belongs to. Cities hold several races a year ("2026 Barcelona" is both May and November), so
 * among the races of that season whose name/city/id contain every word of the label it prefers:
 * the race running today, then races with a real date, then races without extra words (the main
 * race over e.g. "Birmingham - Youngstars"), then the date closest to today.
 * Returns null when no race fits.
 */
export function resolveCalendarRace(label, races, today, season) {
  const m = String(label ?? '').match(/^(\d{4})\s+(.*)$/);
  if (!m) return null;
  const words = labelWords(m[2]);
  if (!words.length) return null;
  const dayMs = (d) => Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`);
  const candidates = races.filter((r) => {
    if (season && r.season && r.season !== season) return false;
    if (String(r.date ?? '').slice(0, 4) !== m[1]) return false;
    const raceWords = new Set([...labelWords(r.name), ...labelWords(r.city), ...labelWords(r.id)]);
    return words.every((w) => raceWords.has(w));
  });
  if (!candidates.length) return null;
  const labelSet = new Set(words);
  const rank = (r) => {
    const start = String(r.date ?? '');
    const end = String(r.end_date ?? r.date ?? '');
    const runningToday = start <= today && today <= end;
    const placeholder = PLACEHOLDER_DATE.test(start);
    // Words of the race city that the label does not have, e.g. "Birmingham - Youngstars" for the
    // label "Birmingham": the side event loses against the main race. (Only the city: names carry
    // words like "September" that say nothing about which race it is.)
    const extra = new Set(labelWords(r.city).filter((w) => !labelSet.has(w))).size;
    return [runningToday ? 0 : 1, placeholder ? 1 : 0, extra, Math.abs(dayMs(start) - dayMs(today)) || 0];
  };
  return [...candidates].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    return ra[0] - rb[0] || ra[1] - rb[1] || ra[2] - rb[2] || ra[3] - rb[3];
  })[0];
}

// ---------- athletes who share a name ----------
// The database keeps one row per (race, name, division). When two different athletes (different
// mika_idp) have the same name in one division, the later one is stored as "Name (bib 123)", or as
// "Name (#585839)" (end of the mika id) when the list page has no bib, so neither overwrites the
// other. Names stay stable between syncs: an athlete already stored under a name keeps it.

const nameKey = (name, division) => `${String(name).trim().toLowerCase()}|${division}`;
const baseName = (name) => String(name).replace(/ \((?:bib [^)]*|#[^)]*)\)$/, '');

/**
 * @param athletes  scraped rows ({ full_name, division, mika_idp, bib_number })
 * @param stored    { nameOfIdp: Map(idp -> stored full_name), ownerOfName: Map(nameKey -> stored idp or null) }
 * @returns the same rows, with full_name changed where needed
 */
export function assignDistinctNames(athletes, stored = {}) {
  const nameOfIdp = stored.nameOfIdp ?? new Map();
  const ownerOfName = new Map(stored.ownerOfName ?? []);
  const taken = (key, idp) => ownerOfName.has(key) && ownerOfName.get(key) != null && ownerOfName.get(key) !== idp;
  return athletes.map((a) => {
    if (!a.mika_idp || !a.full_name) return a;
    const prev = nameOfIdp.get(a.mika_idp);
    // Already stored: keep its name when it is this name or a "(bib …)" variant of it.
    if (prev && baseName(prev).toLowerCase() === a.full_name.trim().toLowerCase()) {
      ownerOfName.set(nameKey(prev, a.division), a.mika_idp);
      return prev === a.full_name ? a : { ...a, full_name: prev };
    }
    const key = nameKey(a.full_name, a.division);
    if (!taken(key, a.mika_idp)) {
      ownerOfName.set(key, a.mika_idp);
      return a;
    }
    const tag = a.bib_number ? `bib ${a.bib_number}` : `#${a.mika_idp.slice(-6)}`;
    const name = `${a.full_name.trim()} (${tag})`;
    ownerOfName.set(nameKey(name, a.division), a.mika_idp);
    return { ...a, full_name: name };
  });
}

// ---------- which race a result belongs to (Overall lists) ----------
// mika sometimes files a race's results inside another race's day wave (Barcelona 2026: 37
// Doubles Women teams sat in Düsseldorf's Thursday wave). The race's own Overall list still names
// them, with the race code appended to the id ("LR3MS4JI5BDE89_BAR"). These helpers use the
// Overall lists to put such results back in their race.

// baseIdp (above) drops the race suffix that Overall lists add ("…_BAR" -> "…").

/**
 * entries: [{ raceId, idps: iterable }] from each race's Overall lists.
 * Returns Map(baseIdp -> raceId). An id listed by two races is left out (we cannot tell).
 */
export function buildOwnerMap(entries) {
  const owner = new Map();
  const clash = new Set();
  for (const { raceId, idps } of entries) {
    for (const raw of idps) {
      const id = baseIdp(raw);
      if (!id || clash.has(id)) continue;
      const prev = owner.get(id);
      if (prev === undefined) owner.set(id, raceId);
      else if (prev !== raceId) {
        owner.delete(id);
        clash.add(id);
      }
    }
  }
  return owner;
}

/**
 * Split one wave's results into those that stay in raceId and those another race's Overall list
 * claims. If more than maxShare of the wave would move, nothing moves (that points to a different
 * problem, such as a wrong race mapping) and `skipped` is true.
 */
export function reassignByOwner(athletes, raceId, owner, { maxShare = 0.2 } = {}) {
  const moved = [];
  const kept = [];
  for (const a of athletes) {
    const to = a.mika_idp ? owner.get(baseIdp(a.mika_idp)) : undefined;
    if (to && to !== raceId) moved.push({ ...a, race_id: to, moved_from: raceId });
    else kept.push(a);
  }
  if (moved.length && moved.length > Math.max(1, athletes.length * maxShare)) {
    return { kept: athletes, moved: [], skipped: moved.length };
  }
  return { kept, moved, skipped: 0 };
}
