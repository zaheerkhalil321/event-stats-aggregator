/**
 * UPDATE statements for enriching one hyrox_athlete_results row from its mika:timing detail page.
 *
 * Existing values are never overwritten with NULL: rows selected only because they lack station
 * ranks may already hold splits from another source, and a DNS page must not wipe them.
 * A page read without a race replay stores cumulative_times '{}' (empty, but read), so the row is
 * not picked again for it.
 */

export function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

const SPLIT_AND_INFO_COLUMNS = [
  'run_1', 'skierg', 'run_2', 'sled_push', 'run_3', 'sled_pull', 'run_4', 'burpee_jumps',
  'run_5', 'rowing', 'run_6', 'farmers_carry', 'run_7', 'sandbag_lunges', 'run_8', 'wall_balls',
  'roxzone', 'run_total', 'best_run_lap', 'bib_number', 'age_group', 'start_wave', 'start_time',
  'team_members',
];

const intOrNull = (n) => (Number.isInteger(n) ? String(n) : 'NULL');

// A disqualification text from a detail page, or null. Pages repeat the column header in a cell
// with the same class, so a value equal to the label ("Disqual Reason") is not a reason.
export function cleanDisqualReason(v) {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!t || /^[-–—]+$/.test(t)) return null;
  if (/^(disqual(ification)?\s*reason|dq\s*reason|grund)$/i.test(t)) return null;
  return t;
}

// SQL condition: the row has no real finish time (only then can it be a DNS).
const NO_FINISH_TIME = `(total_time IS NULL OR total_time NOT GLOB '*[0-9]:[0-9][0-9]:[0-9][0-9]*')`;

export function updateSql(u) {
  if (!Number.isInteger(Number(u.id))) throw new Error(`invalid athlete id: ${u.id}`);
  const id = Number(u.id);
  const keepNationality = `nationality = CASE WHEN nationality IS NULL OR nationality = 'XX' OR nationality = '' THEN COALESCE(${esc(u.nationality)}, nationality) ELSE nationality END`;
  if (u.dns) {
    // Profile exists but shows no splits: mark it as attempted ('–') without touching existing data.
    // Only a row without a finish time can be a DNS; a finisher whose page shows no splits (wrong
    // wave, or a race without split timing) keeps disqual_reason as it is.
    return `
      UPDATE hyrox_athlete_results
      SET
        run_1 = CASE WHEN run_1 IS NULL OR run_1 = '' THEN '–' ELSE run_1 END,
        disqual_reason = CASE WHEN (run_1 IS NULL OR run_1 = '') AND ${NO_FINISH_TIME}
          THEN ${esc(cleanDisqualReason(u.disqual_reason) || 'DNS')} ELSE disqual_reason END,
        bib_number = COALESCE(${esc(u.bib_number)}, bib_number),
        ${keepNationality},
        age_group = COALESCE(${esc(u.age_group)}, age_group),
        team_members = COALESCE(${esc(u.team_members)}, team_members),
        station_ranks = COALESCE(station_ranks, '{}'),
        cumulative_times = COALESCE(cumulative_times, '{}'),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id};
    `;
  }
  return `
    UPDATE hyrox_athlete_results
    SET
      ${SPLIT_AND_INFO_COLUMNS.map((c) => `${c} = COALESCE(${esc(u[c])}, ${c})`).join(',\n      ')},
      penalty_time = ${esc(u.penalty_time)},
      bonus_time = ${esc(u.bonus_time)},
      disqual_reason = ${esc(cleanDisqualReason(u.disqual_reason))},
      ${keepNationality},
      gender_rank = COALESCE(${intOrNull(u.gender_rank)}, gender_rank),
      age_group_rank = COALESCE(${intOrNull(u.age_group_rank)}, age_group_rank),
      station_ranks = COALESCE(${esc(u.station_ranks)}, station_ranks, '{}'),
      cumulative_times = COALESCE(${esc(u.cumulative_times)}, cumulative_times, '{}'),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id};
  `;
}
