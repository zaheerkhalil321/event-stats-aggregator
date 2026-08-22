TRUNCATE TABLE hyrox_athlete_results;
UPDATE hyrox_races SET athletes_count = 0 WHERE status = 'completed';
