-- ============================================================
-- 1. DELETE EXISTING COMPLETED RACES & ATHLETES
-- ============================================================
DELETE FROM hyrox_athlete_results;
DELETE FROM hyrox_races WHERE status = 'completed';

-- ============================================================
-- 2. RE-INSERT CLEAN & OFFICIAL COMPLETED HYROX RACES
-- ============================================================
INSERT INTO hyrox_races (id, name, city, country, country_code, venue, date, season, status, athletes_count)
VALUES
  -- ── SEASON 26/27 (2026 Completed Events) ──────────────────
  ('szx-2026-08', 'HYROX Shenzhen 2026', 'Shenzhen', 'China', 'CN', 'NO.111 Fuhuasan Rd, Futian District', '2026-08-15', '26/27', 'completed', 0),
  ('cpt-2026-08', 'HYROX Cape Town 2026', 'Cape Town', 'South Africa', 'ZA', 'Cape Town International Convention Centre', '2026-08-14', '26/27', 'completed', 0),
  ('bkk-2026-08', 'HYROX Bangkok 2026', 'Bangkok', 'Thailand', 'TH', 'Queen Sirikit National Convention Center', '2026-08-13', '26/27', 'completed', 0),
  ('chb-2026-08', 'HYROX Chiba 2026', 'Chiba', 'Japan', 'JP', 'Makuhari Messe', '2026-08-06', '26/27', 'completed', 0),
  ('ist-2026-08', 'HYROX Istanbul 2026', 'Istanbul', 'Turkey', 'TR', 'Istanbul Expo Center', '2026-08-01', '26/27', 'completed', 0),
  ('ctu-2026-08', 'HYROX Chengdu 2026', 'Chengdu', 'China', 'CN', 'Western China International Expo City', '2026-08-01', '26/27', 'completed', 0),
  ('del-2026-07', 'HYROX Delhi 2026', 'Delhi', 'India', 'IN', 'Yashobhoomi (IICC)', '2026-07-24', '26/27', 'completed', 0),

  -- ── SEASON 25/26 (2025 Completed Events) ──────────────────
  ('chi-2025-06', 'HYROX Chicago (World Championships)', 'Chicago', 'United States', 'US', 'McCormick Place', '2025-06-14', '25/26', 'completed', 0),
  ('fra-2025-06', 'HYROX Frankfurt', 'Frankfurt', 'Germany', 'DE', 'Messe Frankfurt', '2025-06-07', '25/26', 'completed', 0),
  ('mun-2025-05', 'HYROX Munich', 'Munich', 'Germany', 'DE', 'Messe München', '2025-05-24', '25/26', 'completed', 0),
  ('sin-2025-05', 'HYROX Singapore', 'Singapore', 'Singapore', 'SG', 'Sands Expo & Convention Centre', '2025-05-17', '25/26', 'completed', 0),
  ('tor-2025-05', 'HYROX Toronto', 'Toronto', 'Canada', 'CA', 'Enercare Centre', '2025-05-03', '25/26', 'completed', 0),
  ('bar-2025-04', 'HYROX Barcelona', 'Barcelona', 'Spain', 'ES', 'Fira Barcelona Gran Via', '2025-04-26', '25/26', 'completed', 0),
  ('nyc-2025-04', 'HYROX New York', 'New York', 'United States', 'US', 'Javits Center', '2025-04-12', '25/26', 'completed', 0),
  ('man-2025-04', 'HYROX Manchester', 'Manchester', 'United Kingdom', 'GB', 'Manchester Central', '2025-04-05', '25/26', 'completed', 0),
  ('mel-2025-03', 'HYROX Melbourne', 'Melbourne', 'Australia', 'AU', 'Melbourne Convention Centre', '2025-03-22', '25/26', 'completed', 0),
  ('ams-2025-03', 'HYROX Amsterdam', 'Amsterdam', 'Netherlands', 'NL', 'Amsterdam RAI', '2025-03-15', '25/26', 'completed', 0),
  ('mia-2025-03', 'HYROX Miami', 'Miami', 'United States', 'US', 'Miami Beach Convention Center', '2025-03-08', '25/26', 'completed', 0),
  ('ber-2025-03', 'HYROX Berlin', 'Berlin', 'Germany', 'DE', 'Messe Berlin', '2025-03-01', '25/26', 'completed', 0),
  ('syd-2025-02', 'HYROX Sydney', 'Sydney', 'Australia', 'AU', 'ICC Sydney', '2025-02-22', '25/26', 'completed', 0),
  ('mad-2025-02', 'HYROX Madrid', 'Madrid', 'Spain', 'ES', 'IFEMA Madrid', '2025-02-15', '25/26', 'completed', 0),
  ('par-2025-02', 'HYROX Paris', 'Paris', 'France', 'FR', 'Paris Expo Porte de Versailles', '2025-02-01', '25/26', 'completed', 0),
  ('lon-2025-01', 'HYROX London', 'London', 'United Kingdom', 'GB', 'ExCeL London', '2025-01-11', '25/26', 'completed', 0),
  ('shanghai-2025', 'HYROX Shanghai 2025', 'Shanghai', 'China', 'CN', 'National Exhibition Center', '2025-05-10', '25/26', 'completed', 0),
  ('incheon-2025', 'HYROX Incheon 2025', 'Incheon', 'South Korea', 'KR', 'Songdo Convensia', '2025-04-19', '25/26', 'completed', 0),
  ('bangkok-2025', 'HYROX Bangkok 2025', 'Bangkok', 'Thailand', 'TH', 'QSNCC', '2025-03-29', '25/26', 'completed', 0),
  ('cologne-2025', 'HYROX Cologne 2025', 'Cologne', 'Germany', 'DE', 'Koelnmesse', '2025-04-12', '25/26', 'completed', 0),
  ('warsaw-2025', 'HYROX Warsaw 2025', 'Warsaw', 'Poland', 'PL', 'Expo XXI', '2025-03-22', '25/26', 'completed', 0),
  ('houston-2025', 'HYROX Houston 2025', 'Houston', 'United States', 'US', 'George R. Brown Convention Center', '2025-03-15', '25/26', 'completed', 0),
  ('glasgow-2025', 'HYROX Glasgow 2025', 'Glasgow', 'United Kingdom', 'GB', 'SEC Glasgow', '2025-03-01', '25/26', 'completed', 0),
  ('copenhagen-2025', 'HYROX Copenhagen 2025', 'Copenhagen', 'Denmark', 'DK', 'Bella Center', '2025-02-22', '25/26', 'completed', 0),
  ('vienna-2025', 'HYROX Vienna 2025', 'Vienna', 'Austria', 'AT', 'Messe Wien', '2025-02-08', '25/26', 'completed', 0),
  ('rotterdam-2025', 'HYROX Rotterdam 2025', 'Rotterdam', 'Netherlands', 'NL', 'Ahoy Rotterdam', '2025-01-25', '25/26', 'completed', 0),

  -- ── SEASON 24/25 (2024 Completed Events) ──────────────────
  ('nice-2024-wc', 'HYROX World Championships 2024', 'Nice', 'France', 'FR', 'Palais des Expositions', '2024-06-08', '24/25', 'completed', 0),
  ('lon-2024-05', 'HYROX London Olympia', 'London', 'United Kingdom', 'GB', 'Olympia London', '2024-05-18', '24/25', 'completed', 0),
  ('nyc-2024-05', 'HYROX New York Spring', 'New York', 'United States', 'US', 'Pier 76', '2024-05-04', '24/25', 'completed', 0),
  ('ber-2024-04', 'HYROX Berlin Spring', 'Berlin', 'Germany', 'DE', 'Messe Berlin', '2024-04-20', '24/25', 'completed', 0),
  ('ams-2024-04', 'HYROX Amsterdam Spring', 'Amsterdam', 'Netherlands', 'NL', 'RAI Amsterdam', '2024-04-06', '24/25', 'completed', 0),
  ('syd-2024-03', 'HYROX Sydney Summer', 'Sydney', 'Australia', 'AU', 'Sydney Showground', '2024-03-23', '24/25', 'completed', 0),
  ('mel-2024-03', 'HYROX Melbourne Grand', 'Melbourne', 'Australia', 'AU', 'MCEC', '2024-03-09', '24/25', 'completed', 0)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  country = EXCLUDED.country,
  country_code = EXCLUDED.country_code,
  venue = EXCLUDED.venue,
  date = EXCLUDED.date,
  season = EXCLUDED.season,
  status = EXCLUDED.status,
  athletes_count = EXCLUDED.athletes_count,
  updated_at = NOW();
