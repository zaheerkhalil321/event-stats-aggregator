import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Checkpoint evaluator function matching the exact decision logic in sync_live.mjs (lines 708-745)
 */
function evaluateRaceCheckpoint({
  race,
  existingDbRace,
  forceRace = null,
  currentDate = new Date().toISOString().slice(0, 10),
  hasProbeResults = false
}) {
  const isPastRace = race.end_date && race.end_date < currentDate;
  const isFutureRace = race.date && race.date > currentDate;
  const isTargetingSpecificRace = forceRace && forceRace.toLowerCase() !== 'all';

  // 🛡️ 1. RACE-LEVEL CHECKPOINT: If past race is already completed with real count in DB, SKIP!
  if (
    isPastRace &&
    !isTargetingSpecificRace &&
    existingDbRace &&
    existingDbRace.status === 'completed' &&
    existingDbRace.athletes_count > 500
  ) {
    return {
      action: 'SKIP_COMPLETED',
      reason: `Race "${race.name}" already completed with ${existingDbRace.athletes_count} athletes in DB.`
    };
  }

  // 🛡️ 2. UPCOMING RACE CHECKPOINT: If race start date is in the future, register header & skip!
  if (isFutureRace && !isTargetingSpecificRace) {
    return {
      action: 'SKIP_UPCOMING',
      reason: `Race "${race.name}" scheduled for ${race.date}. Skipping until event weekend.`
    };
  }

  // ⚡ 3. PRE-FLIGHT CHECK: verify if any results exist for this event before deep scanning
  if (!hasProbeResults && !isTargetingSpecificRace) {
    return {
      action: 'SKIP_NO_RESULTS',
      reason: `No active heats or results yet for "${race.name}". Skipping.`
    };
  }

  return {
    action: 'PROCEED_SYNC',
    reason: `Syncing race "${race.name}"`
  };
}

describe('3-Tier Checkpoints Engine (sync_live.mjs)', () => {
  const pastRace = {
    id: 'beijing-sep-2026',
    name: 'HYROX Beijing September 2026',
    date: '2026-09-11',
    end_date: '2026-09-13'
  };

  const futureRace = {
    id: 'delhi-2026',
    name: 'HYROX Delhi 2026',
    date: '2026-11-14',
    end_date: '2026-11-15'
  };

  const liveRace = {
    id: 'mumbai-2026',
    name: 'HYROX Mumbai 2026',
    date: '2026-09-17',
    end_date: '2026-09-20'
  };

  it('TC11: Past completed race with >500 athletes in DB skips in Tier 1 (Fast-Path)', () => {
    const res = evaluateRaceCheckpoint({
      race: pastRace,
      existingDbRace: { status: 'completed', athletes_count: 11158 },
      currentDate: '2026-09-17'
    });
    assert.strictEqual(res.action, 'SKIP_COMPLETED');
    assert.match(res.reason, /already completed with 11158 athletes/);
  });

  it('TC12: Past race marked incomplete in DB does NOT skip (resumes sync)', () => {
    const res = evaluateRaceCheckpoint({
      race: pastRace,
      existingDbRace: { status: 'in_progress', athletes_count: 420 },
      currentDate: '2026-09-17',
      hasProbeResults: true
    });
    assert.strictEqual(res.action, 'PROCEED_SYNC');
  });

  it('TC13: Past race with low athlete count (<500) does NOT skip (prevents partial data trap)', () => {
    const res = evaluateRaceCheckpoint({
      race: pastRace,
      existingDbRace: { status: 'completed', athletes_count: 45 }, // suspicious low count
      currentDate: '2026-09-17',
      hasProbeResults: true
    });
    assert.strictEqual(res.action, 'PROCEED_SYNC');
  });

  it('TC14: Upcoming race in the future skips in Tier 2 (Upcoming Gatekeeper)', () => {
    const res = evaluateRaceCheckpoint({
      race: futureRace,
      existingDbRace: null,
      currentDate: '2026-09-17'
    });
    assert.strictEqual(res.action, 'SKIP_UPCOMING');
    assert.match(res.reason, /scheduled for 2026-11-14/);
  });

  it('TC15: Active race with results proceeds to sync in Tier 3', () => {
    const res = evaluateRaceCheckpoint({
      race: liveRace,
      existingDbRace: { status: 'in_progress', athletes_count: 50 },
      currentDate: '2026-09-18', // during event
      hasProbeResults: true
    });
    assert.strictEqual(res.action, 'PROCEED_SYNC');
  });

  it('TC16: Active race with NO results yet skips gracefully in Pre-Flight probe', () => {
    const res = evaluateRaceCheckpoint({
      race: liveRace,
      existingDbRace: null,
      currentDate: '2026-09-18',
      hasProbeResults: false
    });
    assert.strictEqual(res.action, 'SKIP_NO_RESULTS');
  });

  it('TC17: FORCE_RACE flag overrides past completed race skip', () => {
    const res = evaluateRaceCheckpoint({
      race: pastRace,
      existingDbRace: { status: 'completed', athletes_count: 11158 },
      forceRace: 'beijing-sep-2026',
      currentDate: '2026-09-17',
      hasProbeResults: true
    });
    assert.strictEqual(res.action, 'PROCEED_SYNC');
  });

  it('TC18: FORCE_RACE flag overrides upcoming race skip', () => {
    const res = evaluateRaceCheckpoint({
      race: futureRace,
      existingDbRace: null,
      forceRace: 'delhi-2026',
      currentDate: '2026-09-17',
      hasProbeResults: true
    });
    assert.strictEqual(res.action, 'PROCEED_SYNC');
  });
});
