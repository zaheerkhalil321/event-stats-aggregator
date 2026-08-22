-- Ensure end_date column exists
ALTER TABLE hyrox_races ADD COLUMN IF NOT EXISTS end_date DATE;

-- ============================================================
-- EXACT MULTI-DAY OFFICIAL DATES FOR HYROX RACES
-- ============================================================

-- ── 2026 Events (Season 26/27) ──────────────────────────────
UPDATE hyrox_races SET date = '2026-12-10', end_date = '2026-12-13' WHERE id LIKE '%stockholm-2026%' AND name NOT LIKE '%World Championships%';
UPDATE hyrox_races SET date = '2026-06-18', end_date = '2026-06-21' WHERE id LIKE '%world-championships%2026%' OR name LIKE '%World Championships Stockholm%';
UPDATE hyrox_races SET date = '2026-08-15', end_date = '2026-08-16' WHERE id LIKE '%szx-2026%' OR id LIKE '%shenzhen-2026%';
UPDATE hyrox_races SET date = '2026-08-14', end_date = '2026-08-16' WHERE id LIKE '%cpt-2026%' OR id LIKE '%cape-town-2026%';
UPDATE hyrox_races SET date = '2026-08-13', end_date = '2026-08-16' WHERE id LIKE '%bkk-2026%' OR id LIKE '%bangkok-2026%';
UPDATE hyrox_races SET date = '2026-08-06', end_date = '2026-08-09' WHERE id LIKE '%chb-2026%' OR id LIKE '%chiba-2026%';
UPDATE hyrox_races SET date = '2026-08-01', end_date = '2026-08-02' WHERE id LIKE '%ist-2026%' OR id LIKE '%istanbul-2026%';
UPDATE hyrox_races SET date = '2026-08-01', end_date = '2026-08-02' WHERE id LIKE '%ctu-2026%' OR id LIKE '%chengdu-2026%';
UPDATE hyrox_races SET date = '2026-07-24', end_date = '2026-07-26' WHERE id LIKE '%del-2026%' OR id LIKE '%delhi-2026%';

-- ── 2025 Events (Season 25/26) ──────────────────────────────
UPDATE hyrox_races SET date = '2025-12-18', end_date = '2025-12-21' WHERE id LIKE '%stockholm-2025%';
UPDATE hyrox_races SET date = '2025-06-13', end_date = '2025-06-15' WHERE id LIKE '%chi-2025%' OR id LIKE '%chicago-2025%';
UPDATE hyrox_races SET date = '2025-06-07', end_date = '2025-06-08' WHERE id LIKE '%fra-2025%' OR id LIKE '%frankfurt-2025%';
UPDATE hyrox_races SET date = '2025-05-24', end_date = '2025-05-25' WHERE id LIKE '%mun-2025%' OR id LIKE '%munich-2025%';
UPDATE hyrox_races SET date = '2025-05-16', end_date = '2025-05-18' WHERE id LIKE '%sin-2025%' OR id LIKE '%singapore-2025%';
UPDATE hyrox_races SET date = '2025-05-10', end_date = '2025-05-11' WHERE id LIKE '%shanghai-2025%';
UPDATE hyrox_races SET date = '2025-05-02', end_date = '2025-05-04' WHERE id LIKE '%tor-2025%' OR id LIKE '%toronto-2025%';
UPDATE hyrox_races SET date = '2025-04-25', end_date = '2025-04-27' WHERE id LIKE '%bar-2025%' OR id LIKE '%barcelona-2025%';
UPDATE hyrox_races SET date = '2025-04-18', end_date = '2025-04-20' WHERE id LIKE '%incheon-2025%';
UPDATE hyrox_races SET date = '2025-04-11', end_date = '2025-04-13' WHERE id LIKE '%nyc-2025%' OR id LIKE '%new-york-2025%';
UPDATE hyrox_races SET date = '2025-04-12', end_date = '2025-04-13' WHERE id LIKE '%cologne-2025%';
UPDATE hyrox_races SET date = '2025-04-04', end_date = '2025-04-06' WHERE id LIKE '%man-2025%' OR id LIKE '%manchester-2025%';
UPDATE hyrox_races SET date = '2025-03-28', end_date = '2025-03-30' WHERE id LIKE '%bangkok-2025%';
UPDATE hyrox_races SET date = '2025-03-21', end_date = '2025-03-23' WHERE id LIKE '%mel-2025%' OR id LIKE '%melbourne-2025%';
UPDATE hyrox_races SET date = '2025-03-22', end_date = '2025-03-23' WHERE id LIKE '%warsaw-2025%';
UPDATE hyrox_races SET date = '2025-03-14', end_date = '2025-03-16' WHERE id LIKE '%ams-2025%' OR id LIKE '%amsterdam-2025%';
UPDATE hyrox_races SET date = '2025-03-15', end_date = '2025-03-16' WHERE id LIKE '%houston-2025%';
UPDATE hyrox_races SET date = '2025-03-07', end_date = '2025-03-09' WHERE id LIKE '%mia-2025%' OR id LIKE '%miami-2025%';
UPDATE hyrox_races SET date = '2025-02-28', end_date = '2025-03-02' WHERE id LIKE '%ber-2025%' OR id LIKE '%berlin-2025%';
UPDATE hyrox_races SET date = '2025-03-01', end_date = '2025-03-02' WHERE id LIKE '%glasgow-2025%';
UPDATE hyrox_races SET date = '2025-02-21', end_date = '2025-02-23' WHERE id LIKE '%syd-2025%' OR id LIKE '%sydney-2025%';
UPDATE hyrox_races SET date = '2025-02-22', end_date = '2025-02-23' WHERE id LIKE '%copenhagen-2025%';
UPDATE hyrox_races SET date = '2025-02-14', end_date = '2025-02-16' WHERE id LIKE '%mad-2025%' OR id LIKE '%madrid-2025%';
UPDATE hyrox_races SET date = '2025-02-07', end_date = '2025-02-09' WHERE id LIKE '%vienna-2025%';
UPDATE hyrox_races SET date = '2025-01-31', end_date = '2025-02-02' WHERE id LIKE '%par-2025%' OR id LIKE '%paris-2025%';
UPDATE hyrox_races SET date = '2025-01-24', end_date = '2025-01-26' WHERE id LIKE '%rotterdam-2025%';
UPDATE hyrox_races SET date = '2025-01-10', end_date = '2025-01-12' WHERE id LIKE '%lon-2025%' OR id LIKE '%london-2025%';

-- ── 2024 Events (Season 24/25) ──────────────────────────────
UPDATE hyrox_races SET date = '2024-06-07', end_date = '2024-06-09' WHERE id LIKE '%nice-2024%';
UPDATE hyrox_races SET date = '2024-05-17', end_date = '2024-05-19' WHERE id LIKE '%lon-2024%';
UPDATE hyrox_races SET date = '2024-05-03', end_date = '2024-05-05' WHERE id LIKE '%nyc-2024%';
UPDATE hyrox_races SET date = '2024-04-19', end_date = '2024-04-21' WHERE id LIKE '%ber-2024%';
UPDATE hyrox_races SET date = '2024-04-05', end_date = '2024-04-07' WHERE id LIKE '%ams-2024%';
UPDATE hyrox_races SET date = '2024-03-22', end_date = '2024-03-24' WHERE id LIKE '%syd-2024%';
UPDATE hyrox_races SET date = '2024-03-08', end_date = '2024-03-10' WHERE id LIKE '%mel-2024%';
