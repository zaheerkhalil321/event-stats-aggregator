-- ============================================================
-- Seed 2024/2025/2026 Major HYROX Global Races
-- ============================================================

INSERT INTO hyrox_races (id, name, city, country, country_code, venue, date, season, status)
VALUES
  ('lon-2025-01', 'HYROX London', 'London', 'United Kingdom', 'GB', 'ExCeL London', '2025-01-11', '2024-25', 'completed'),
  ('par-2025-02', 'HYROX Paris', 'Paris', 'France', 'FR', 'Paris Expo Porte de Versailles', '2025-02-01', '2024-25', 'completed'),
  ('mad-2025-02', 'HYROX Madrid', 'Madrid', 'Spain', 'ES', 'IFEMA Madrid', '2025-02-15', '2024-25', 'completed'),
  ('syd-2025-02', 'HYROX Sydney', 'Sydney', 'Australia', 'AU', 'ICC Sydney', '2025-02-22', '2024-25', 'completed'),
  ('ber-2025-03', 'HYROX Berlin', 'Berlin', 'Germany', 'DE', 'Messe Berlin', '2025-03-01', '2024-25', 'completed'),
  ('mia-2025-03', 'HYROX Miami', 'Miami', 'United States', 'US', 'Miami Beach Convention Center', '2025-03-08', '2024-25', 'completed'),
  ('ams-2025-03', 'HYROX Amsterdam', 'Amsterdam', 'Netherlands', 'NL', 'Amsterdam RAI', '2025-03-15', '2024-25', 'completed'),
  ('mel-2025-03', 'HYROX Melbourne', 'Melbourne', 'Australia', 'AU', 'Melbourne Convention Centre', '2025-03-22', '2024-25', 'completed'),
  ('man-2025-04', 'HYROX Manchester', 'Manchester', 'United Kingdom', 'GB', 'Manchester Central', '2025-04-05', '2024-25', 'completed'),
  ('nyc-2025-04', 'HYROX New York', 'New York', 'United States', 'US', 'Javits Center', '2025-04-12', '2024-25', 'completed'),
  ('bar-2025-04', 'HYROX Barcelona', 'Barcelona', 'Spain', 'ES', 'Fira Barcelona', '2025-04-26', '2024-25', 'completed'),
  ('tor-2025-05', 'HYROX Toronto', 'Toronto', 'Canada', 'CA', 'Enercare Centre', '2025-05-03', '2024-25', 'completed'),
  ('sin-2025-05', 'HYROX Singapore', 'Singapore', 'Singapore', 'SG', 'Sands Expo', '2025-05-17', '2024-25', 'completed'),
  ('mun-2025-05', 'HYROX Munich', 'Munich', 'Germany', 'DE', 'Messe München', '2025-05-24', '2024-25', 'completed'),
  ('fra-2025-06', 'HYROX Frankfurt', 'Frankfurt', 'Germany', 'DE', 'Messe Frankfurt', '2025-06-07', '2024-25', 'completed'),
  ('chi-2025-06', 'HYROX Chicago (World Championships)', 'Chicago', 'United States', 'US', 'McCormick Place', '2025-06-14', '2024-25', 'completed'),
  ('bru-2025-09', 'HYROX Brussels', 'Brussels', 'Belgium', 'BE', 'Brussels Expo', '2025-09-13', '2025-26', 'upcoming'),
  ('dub-2025-10', 'HYROX Dubai', 'Dubai', 'UAE', 'AE', 'Dubai World Trade Centre', '2025-10-04', '2025-26', 'upcoming'),
  ('lon-2025-10', 'HYROX London Autumn', 'London', 'United Kingdom', 'GB', 'ExCeL London', '2025-10-18', '2025-26', 'upcoming'),
  ('las-2025-11', 'HYROX Las Vegas', 'Las Vegas', 'United States', 'US', 'Las Vegas Convention Center', '2025-11-01', '2025-26', 'upcoming'),
  ('ham-2025-11', 'HYROX Hamburg', 'Hamburg', 'Germany', 'DE', 'Messehallen Hamburg', '2025-11-15', '2025-26', 'upcoming'),
  ('lon-2026-01', 'HYROX London Winter', 'London', 'United Kingdom', 'GB', 'ExCeL London', '2026-01-10', '2025-26', 'upcoming'),
  ('par-2026-01', 'HYROX Paris Winter', 'Paris', 'France', 'FR', 'Paris Expo Porte de Versailles', '2026-01-31', '2025-26', 'upcoming'),
  ('mad-2026-02', 'HYROX Madrid Winter', 'Madrid', 'Spain', 'ES', 'IFEMA Madrid', '2026-02-14', '2025-26', 'upcoming'),
  ('syd-2026-02', 'HYROX Sydney Summer', 'Sydney', 'Australia', 'AU', 'ICC Sydney', '2026-02-21', '2025-26', 'upcoming'),
  ('ber-2026-03', 'HYROX Berlin Spring', 'Berlin', 'Germany', 'DE', 'Messe Berlin', '2026-03-07', '2025-26', 'upcoming'),
  ('ams-2026-03', 'HYROX Amsterdam Spring', 'Amsterdam', 'Netherlands', 'NL', 'Amsterdam RAI', '2026-03-21', '2025-26', 'upcoming'),
  ('sin-2026-05', 'HYROX Singapore Open', 'Singapore', 'Singapore', 'SG', 'Sands Expo', '2026-05-16', '2025-26', 'upcoming'),
  ('nyc-2026-05', 'HYROX New York Open', 'New York', 'United States', 'US', 'Javits Center', '2026-05-30', '2025-26', 'upcoming')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  city = EXCLUDED.city,
  country = EXCLUDED.country,
  country_code = EXCLUDED.country_code,
  venue = EXCLUDED.venue,
  date = EXCLUDED.date,
  season = EXCLUDED.season,
  status = EXCLUDED.status,
  updated_at = NOW();
