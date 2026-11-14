/**
 * Indexes the API's intelligence endpoints need (safe to run again):
 *   - idx_results_division_time: percentile counts a division without reading the whole table.
 *   - team_names_fts: full-text index of doubles/relay team names (who raced with whom), kept up to
 *     date by triggers on hyrox_athlete_results. Used by GET /v1/athletes/{id}/partners.
 *
 *   node scripts/add_search_indexes.mjs
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const raw = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
// The live sync writes at the same time: wait and retry when the database is busy.
const retry = async (fn) => {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!/locked|BUSY/i.test(String(e.message)) || i >= 10) throw e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
};
const db = { execute: (q) => retry(() => raw.execute(q)), batch: (q, m) => retry(() => raw.batch(q, m)) };
const TEAM = "(division LIKE '%DOUBLES%' OR division LIKE '%RELAY%')";
const time = async (label, fn) => { const t = Date.now(); const r = await fn(); console.log(`${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`); return r; };

await time('index division + total_time', () => db.execute(
  'CREATE INDEX IF NOT EXISTS idx_results_division_time ON hyrox_athlete_results(division, total_time)'));

const exists = (await db.execute("SELECT 1 FROM sqlite_master WHERE name = 'team_names_fts'")).rows.length > 0;
await db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS team_names_fts USING fts5(full_name, tokenize = 'unicode61 remove_diacritics 2')");
// Triggers first, so rows written while the table fills are not missed (the fill skips ids it has).
await db.batch([
  `CREATE TRIGGER IF NOT EXISTS trg_team_fts_ai AFTER INSERT ON hyrox_athlete_results
     WHEN NEW.division LIKE '%DOUBLES%' OR NEW.division LIKE '%RELAY%'
     BEGIN INSERT INTO team_names_fts(rowid, full_name) VALUES (NEW.id, NEW.full_name); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_team_fts_ad AFTER DELETE ON hyrox_athlete_results
     BEGIN DELETE FROM team_names_fts WHERE rowid = OLD.id; END`,
  `CREATE TRIGGER IF NOT EXISTS trg_team_fts_au AFTER UPDATE OF full_name, division ON hyrox_athlete_results
     BEGIN
       DELETE FROM team_names_fts WHERE rowid = OLD.id;
       INSERT INTO team_names_fts(rowid, full_name) SELECT NEW.id, NEW.full_name
         WHERE NEW.division LIKE '%DOUBLES%' OR NEW.division LIKE '%RELAY%';
     END`,
], 'write');

// Fill in chunks of team rows (keyset on id), so the database is never locked for long.
let added = 0;
await time(exists ? 'team names (top-up)' : 'team names', async () => {
  for (let last = 0; ;) {
    const ids = (await db.execute({
      sql: `SELECT id FROM hyrox_athlete_results WHERE id > ? AND ${TEAM} ORDER BY id LIMIT 5000`,
      args: [last],
    })).rows.map((r) => Number(r.id));
    if (!ids.length) break;
    const from = ids[0];
    const to = ids[ids.length - 1];
    const r = await db.execute({
      sql: `INSERT INTO team_names_fts(rowid, full_name)
            SELECT id, full_name FROM hyrox_athlete_results
            WHERE id >= ? AND id <= ? AND ${TEAM}
              AND id NOT IN (SELECT rowid FROM team_names_fts WHERE rowid >= ? AND rowid <= ?)`,
      args: [from, to, from, to],
    });
    added += r.rowsAffected;
    last = to;
  }
});
const n = (await db.execute('SELECT COUNT(*) AS n FROM team_names_fts')).rows[0].n;
console.log(`team_names_fts: ${n} team names (${added} added now)`);
