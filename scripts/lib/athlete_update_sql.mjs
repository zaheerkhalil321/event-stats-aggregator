/**
 * UPDATE statements for enriching one hyrox_athlete_results row from its mika:timing detail page.
 *
 * Existing values are never overwritten with NULL: rows selected only because they lack station
 * ranks may already hold splits from another source, and a DNS page must not wipe them.
 */

export function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  return `'${String(val).replace(/'/g, "''")}'`;
}

const SPLIT_AND_INFO_COLUMNS = [
  'run_1', 'skierg', 'run_2', 'sled_push', 'run_3', 'sled_pull', 'run_4', 'burpee_jumps',
  'run_5', 'rowing', 'run_6', 'farmers_carry', 'run_7', 'sandbag_lunges', 'run_8', 'wall_balls',
  'roxzone', 'run_total', 'best_run_lap', 'bib_number', 'age_group', 'start_wave', 'start_time',
  'team_members', 'cumulative_times',
];

const intOrNull = (n) => (Number.isInteger(n) ? String(n) : 'NULL');

export function updateSql(u) {
  if (!Number.isInteger(Number(u.id))) throw new Error(`invalid athlete id: ${u.id}`);
  const id = Number(u.id);
  const keepNationality = `nationality = CASE WHEN nationality IS NULL OR nationality = 'XX' OR nationality = '' THEN COALESCE(${esc(u.nationality)}, nationality) ELSE nationality END`;
  if (u.dns) {
    // Profile exists but shows no splits: mark it as attempted without touching existing data.
    return `
      UPDATE hyrox_athlete_results
      SET
        run_1 = CASE WHEN run_1 IS NULL OR run_1 = '' THEN '–' ELSE run_1 END,
        disqual_reason = CASE WHEN run_1 IS NULL OR run_1 = '' THEN ${esc(u.disqual_reason || 'DNS')} ELSE disqual_reason END,
        bib_number = COALESCE(${esc(u.bib_number)}, bib_number),
        ${keepNationality},
        age_group = COALESCE(${esc(u.age_group)}, age_group),
        team_members = COALESCE(${esc(u.team_members)}, team_members),
        station_ranks = COALESCE(station_ranks, '{}'),
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
      disqual_reason = ${esc(u.disqual_reason)},
      ${keepNationality},
      gender_rank = COALESCE(${intOrNull(u.gender_rank)}, gender_rank),
      age_group_rank = COALESCE(${intOrNull(u.age_group_rank)}, age_group_rank),
      station_ranks = COALESCE(${esc(u.station_ranks)}, station_ranks, '{}'),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id};
  `;
}
