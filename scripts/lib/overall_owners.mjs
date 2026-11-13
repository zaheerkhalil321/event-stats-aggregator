// Reads mika list pages to find out which race a result belongs to. Used by sync_live.mjs and
// scripts/verify_race_counts.mjs. All requests go through the paced mika client passed in.
import { buildOwnerMap, extraWavesFor, parseListPage } from './mika_list.mjs';

export const OVERALL_WAVE = /_OVERALL(_\d+)?$/i;

/** Every result of one wave and sex (all pages). */
export async function waveItems(mika, seasonSlug, wave, sex, maxPages = 80) {
  const items = [];
  for (let p = 1; p <= maxPages; p++) {
    const r = await mika.get(`https://results.hyrox.com/${seasonSlug}/?event=${wave}&pid=list&num_results=100&search[sex]=${sex}&page=${p}`);
    if (!r?.text) break;
    const page = parseListPage(r.text);
    items.push(...page.items);
    if (page.items.length < 100) break;
  }
  return items;
}

/** All result ids in a group's Overall lists (every family and sex). */
export async function overallIdps(mika, seasonSlug, group, sonstige) {
  const waves = [...group.options, ...extraWavesFor(group, sonstige)].filter((o) => OVERALL_WAVE.test(o.val));
  const ids = [];
  for (const w of waves) {
    for (const sex of ['M', 'W', 'X']) {
      for (const it of await waveItems(mika, seasonSlug, w.val, sex)) if (it.idp) ids.push(it.idp);
    }
  }
  return ids;
}

/**
 * Map(result id -> race id) from the Overall lists of the given races.
 * races: [{ raceId, group }]
 */
export async function raceOwners(mika, seasonSlug, races, sonstige) {
  const entries = [];
  for (const { raceId, group } of races) {
    const idps = await overallIdps(mika, seasonSlug, group, sonstige);
    if (idps.length) entries.push({ raceId, idps });
  }
  return { owners: buildOwnerMap(entries), racesWithOverall: entries.length };
}
