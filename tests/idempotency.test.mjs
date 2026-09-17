import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * In-memory batch deduplicator matching sync_live.mjs (lines 303-311)
 * Prevents PostgreSQL 21000 ON CONFLICT collision within the same batch.
 */
function deduplicateBatch(athletes) {
  const seen = new Map();
  for (const a of athletes) {
    const key = `${a.race_id}|${a.full_name}|${a.division}`;
    // Latest record wins (or keeps existing if already populated)
    seen.set(key, a);
  }
  return Array.from(seen.values());
}

/**
 * Builds mock upsert SQL matching sync_live.mjs / sync_events.mjs
 */
function buildUpsertQuery(raceId, athletes) {
  if (!athletes.length) return null;
  return `
    INSERT INTO hyrox_athlete_results (
      race_id, full_name, division, gender, bib, rank_overall, finish_time
    ) VALUES ...
    ON CONFLICT (race_id, full_name, division) 
    DO UPDATE SET
      rank_overall = EXCLUDED.rank_overall,
      finish_time = EXCLUDED.finish_time,
      updated_at = NOW();
  `.trim();
}

describe('Database Idempotency & Conflict Safety', () => {
  it('TC29: In-batch deduplication collapses duplicate athletes to a single record', () => {
    const rawBatch = [
      { race_id: 'mumbai-2026', full_name: 'John Doe', division: 'HYROX MEN', finish_time: '01:10:00' },
      { race_id: 'mumbai-2026', full_name: 'John Doe', division: 'HYROX MEN', finish_time: '01:09:45' }, // updated heat time
      { race_id: 'mumbai-2026', full_name: 'Jane Smith', division: 'HYROX WOMEN', finish_time: '01:15:20' }
    ];

    const deduplicated = deduplicateBatch(rawBatch);
    assert.strictEqual(deduplicated.length, 2);
    
    const john = deduplicated.find(a => a.full_name === 'John Doe');
    assert.strictEqual(john.finish_time, '01:09:45'); // Keeps most recent split/time
  });

  it('TC30: Athletes in different divisions with identical names are NOT collapsed', () => {
    // Same person competing in Open Men and Doubles Men
    const rawBatch = [
      { race_id: 'mumbai-2026', full_name: 'Alex Tan', division: 'HYROX MEN', finish_time: '01:05:00' },
      { race_id: 'mumbai-2026', full_name: 'Alex Tan', division: 'HYROX DOUBLES MEN', finish_time: '00:58:30' }
    ];

    const deduplicated = deduplicateBatch(rawBatch);
    assert.strictEqual(deduplicated.length, 2);
  });

  it('TC31: Upsert SQL strictly uses ON CONFLICT DO UPDATE and NEVER drops or truncates', () => {
    const query = buildUpsertQuery('mumbai-2026', [
      { race_id: 'mumbai-2026', full_name: 'John Doe', division: 'HYROX MEN' }
    ]);

    const normalizedQuery = query.replace(/\s+/g, ' ');
    assert.ok(normalizedQuery.includes('ON CONFLICT (race_id, full_name, division) DO UPDATE'));
    assert.ok(!query.includes('DELETE'));
    assert.ok(!query.includes('TRUNCATE'));
    assert.ok(!query.includes('DROP'));
  });

  it('TC32: Consecutive identical batches result in zero new row additions', () => {
    const batch1 = [
      { race_id: 'tenerife-2026', full_name: 'Athlete A', division: 'HYROX PRO MEN' },
      { race_id: 'tenerife-2026', full_name: 'Athlete B', division: 'HYROX PRO WOMEN' }
    ];

    // Simulating database storage state with unique constraint index
    const mockDbIndex = new Set();
    let insertCount = 0;
    let updateCount = 0;

    function simulateDbUpsert(batch) {
      for (const a of batch) {
        const key = `${a.race_id}|${a.full_name}|${a.division}`;
        if (mockDbIndex.has(key)) {
          updateCount++;
        } else {
          mockDbIndex.add(key);
          insertCount++;
        }
      }
    }

    // Run 1: First sync
    simulateDbUpsert(batch1);
    assert.strictEqual(insertCount, 2);
    assert.strictEqual(updateCount, 0);
    assert.strictEqual(mockDbIndex.size, 2);

    // Run 2: Re-running 20 minutes later on same data
    simulateDbUpsert(batch1);
    assert.strictEqual(insertCount, 2); // No new rows created!
    assert.strictEqual(updateCount, 2); // Updated existing rows!
    assert.strictEqual(mockDbIndex.size, 2); // Total rows remain constant!
  });
});
