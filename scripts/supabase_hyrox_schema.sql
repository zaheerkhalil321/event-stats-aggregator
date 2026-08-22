-- ============================================================
-- HYROX DATA PIPELINE — Supabase SQL Schema
-- ============================================================

-- ── 1. Races Table ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hyrox_races (
  id            TEXT PRIMARY KEY,               -- e.g. 'london-2025-01'
  name          TEXT NOT NULL,                  -- e.g. 'HYROX London'
  city          TEXT NOT NULL,
  country       TEXT NOT NULL,
  country_code  CHAR(2) NOT NULL,               -- ISO 3166-1 alpha-2
  venue         TEXT,
  date          DATE NOT NULL,
  season        TEXT,                           -- e.g. '2024-25'
  status        TEXT DEFAULT 'upcoming',        -- 'upcoming' | 'completed'
  registration_url TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hyrox_races_date         ON hyrox_races (date);
CREATE INDEX IF NOT EXISTS idx_hyrox_races_country_code ON hyrox_races (country_code);
CREATE INDEX IF NOT EXISTS idx_hyrox_races_status       ON hyrox_races (status);

-- ── 2. Athlete Results Table ────────────────────────────────
CREATE TABLE IF NOT EXISTS hyrox_athlete_results (
  id              BIGSERIAL PRIMARY KEY,
  race_id         TEXT NOT NULL REFERENCES hyrox_races(id) ON DELETE CASCADE,

  -- Athlete Identity
  bib_number      TEXT,
  full_name       TEXT NOT NULL,
  nationality     TEXT,
  gender          TEXT,                         -- 'M' | 'F'
  age_group       TEXT,                         -- e.g. '30-34', '35-39'
  division        TEXT NOT NULL,                -- 'Open' | 'Pro' | 'Doubles' | 'Relay'

  -- Overall Performance
  total_time      INTERVAL,
  overall_rank    INTEGER,
  gender_rank     INTEGER,
  division_rank   INTEGER,
  age_group_rank  INTEGER,

  -- 8 Running Splits (1km each)
  run_1           INTERVAL,
  run_2           INTERVAL,
  run_3           INTERVAL,
  run_4           INTERVAL,
  run_5           INTERVAL,
  run_6           INTERVAL,
  run_7           INTERVAL,
  run_8           INTERVAL,

  -- 8 Station Times
  skierg          INTERVAL,
  sled_push       INTERVAL,
  sled_pull       INTERVAL,
  burpee_jumps    INTERVAL,
  rowing          INTERVAL,
  farmers_carry   INTERVAL,
  sandbag_lunges  INTERVAL,
  wall_balls      INTERVAL,

  -- Roxzone (transition time)
  roxzone         INTERVAL,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (race_id, full_name, division)
);

CREATE INDEX IF NOT EXISTS idx_athlete_name     ON hyrox_athlete_results (lower(full_name) text_pattern_ops);
CREATE INDEX IF NOT EXISTS idx_athlete_race     ON hyrox_athlete_results (race_id);
CREATE INDEX IF NOT EXISTS idx_athlete_division ON hyrox_athlete_results (division);
CREATE INDEX IF NOT EXISTS idx_athlete_rank     ON hyrox_athlete_results (overall_rank);

-- ── 3. Enable Row Level Security ───────────────────────────
ALTER TABLE hyrox_races           ENABLE ROW LEVEL SECURITY;
ALTER TABLE hyrox_athlete_results ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hyrox_races' AND policyname = 'Public can read races'
  ) THEN
    CREATE POLICY "Public can read races" ON hyrox_races FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'hyrox_athlete_results' AND policyname = 'Public can read athlete results'
  ) THEN
    CREATE POLICY "Public can read athlete results" ON hyrox_athlete_results FOR SELECT USING (true);
  END IF;
END $$;

-- ── 4. Updated_at trigger ──────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at_races ON hyrox_races;
CREATE TRIGGER set_updated_at_races
  BEFORE UPDATE ON hyrox_races
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS set_updated_at_results ON hyrox_athlete_results;
CREATE TRIGGER set_updated_at_results
  BEFORE UPDATE ON hyrox_athlete_results
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
