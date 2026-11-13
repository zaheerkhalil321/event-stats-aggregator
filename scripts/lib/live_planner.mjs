// Shares a race weekend's live sync out over parallel GitHub runners ("lanes"). Each runner has its
// own IP and so its own mika rate limit; a lane gets races whose pass fits in its time budget.
//
// The plan is made once per workflow run (scripts/plan_live_lanes.mjs) and every lane runs
// `sync_live.mjs --races=...`. Lane 1 also keeps every race no other lane took (--exclude=...), so
// a race the planner did not see is still synced, as before lanes existed.

export const LANE_BUDGET_SECONDS = 7 * 60; // a pass every 10 minutes, with room to spare
export const MAX_LANES = 5;
export const SECONDS_PER_PAGE = 0.45;      // one paced mika request, measured on GitHub runners
const LIST_SECONDS_PER_WAVE = 6;          // count probe + list pages of one wave and sex, typical

/**
 * Most athletes of a race on the course at the same time during the next hours (heat starts from
 * the start list; an athlete counts as on the course for 90 minutes after their heat starts).
 */
export function peakOnCourse(heatStarts, from, hours = 6, onCourseMinutes = 90) {
  const starts = heatStarts.map((s) => Date.parse(s)).filter(Number.isFinite).sort((a, b) => a - b);
  const span = onCourseMinutes * 60_000;
  let peak = 0;
  // The count only changes at a heat start, so checking just after each start (and now) is enough.
  const checks = [from, ...starts.filter((t) => t >= from && t <= from + hours * 3_600_000)];
  for (const t of checks) {
    let n = 0;
    for (const s of starts) if (s <= t && s > t - span) n++;
    peak = Math.max(peak, n);
  }
  return peak;
}

/**
 * Seconds one pass of a race takes. Learned when the live sync measured it (stats), else from
 * the start list: the list pages of its waves plus a detail page for everyone on the course.
 */
export function estimateLoad({ waves = 10, peak = 0, stats = null }) {
  const lists = stats?.list_seconds ?? waves * LIST_SECONDS_PER_WAVE;
  const perPage = stats?.seconds_per_page ?? SECONDS_PER_PAGE;
  return Math.round(lists + peak * perPage);
}

/**
 * races: [{ id, region, load }]. Returns lanes [{ lane, races: [id], load }] (lane 1 first).
 * Heaviest race first into the lightest lane (LPT). Between lanes of equal load a race prefers
 * one that already holds a race of its region: races mika mixes up (same region, same days) then
 * usually share a lane. The number of lanes is what the load needs, within 1..maxLanes.
 * Deterministic: the same input always gives the same plan.
 */
export function planLanes(races, { budget = LANE_BUDGET_SECONDS, maxLanes = MAX_LANES } = {}) {
  const sorted = [...races].sort((a, b) => b.load - a.load || a.id.localeCompare(b.id));
  const total = sorted.reduce((s, r) => s + r.load, 0);
  const count = Math.max(1, Math.min(maxLanes, sorted.length, Math.ceil(total / budget)));
  const lanes = Array.from({ length: count }, (_, i) => ({ lane: i + 1, races: [], regions: new Set(), load: 0 }));
  for (const r of sorted) {
    const min = Math.min(...lanes.map((l) => l.load));
    // "Equal" within 10% of the budget: keeping a region together is worth a small imbalance.
    const close = lanes.filter((l) => l.load <= min + budget * 0.1);
    const pick = close.find((l) => l.regions.has(r.region)) ?? close.find((l) => l.load === min) ?? close[0];
    pick.races.push(r.id);
    pick.regions.add(r.region);
    pick.load += r.load;
  }
  return lanes.filter((l) => l.races.length || l.lane === 1).map(({ lane, races: ids, load }) => ({ lane, races: ids, load }));
}

/** Matrix entries for the workflow: lane 1 takes its races plus everything no other lane took. */
export function laneMatrix(lanes, names = new Map()) {
  const others = (lane) => lanes.filter((l) => l.lane !== lane).flatMap((l) => l.races);
  return lanes.map((l) => {
    const label = l.races.map((id) => names.get(id) ?? id).join(' + ') || 'other races';
    const args = l.lane === 1
      ? (others(1).length ? `--exclude=${others(1).join(',')}` : '')
      : `--races=${l.races.join(',')}`;
    return { lane: l.lane, label: `${l.lane}: ${label}`, args, load: l.load };
  });
}

/** Which groups a lane syncs: --races keeps only those races, --exclude drops those. */
export function laneFilter({ races = null, exclude = null } = {}) {
  const only = races ? new Set(races) : null;
  const skip = new Set(exclude ?? []);
  return (raceId) => (only ? only.has(raceId) : true) && !skip.has(raceId);
}
