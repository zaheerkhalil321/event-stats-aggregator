import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { evaluateGatekeeper, getKnownDates } from '../check_active_today.mjs';

const execFileAsync = promisify(execFile);

describe('Gatekeeper Engine (check_active_today.mjs)', () => {
  const mockCalendar = {
    'mumbai-2026': {
      name: 'HYROX Mumbai 2026',
      date: '2026-09-17',
      end_date: '2026-09-20'
    },
    'maastricht-2026': {
      name: 'HYROX Maastricht 2026',
      date: '2026-09-17',
      end_date: '2026-09-20'
    },
    'delhi-2026': {
      name: 'HYROX Delhi 2026',
      date: '2026-11-14',
      end_date: '2026-11-15'
    }
  };

  it('TC1: Should return active=false on an off-day (no active races)', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-01',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, false);
    assert.match(res.reason, /No HYROX races active today/);
    assert.strictEqual(res.activeRaces.length, 0);
  });

  it('TC2: Should return active=true on the exact race start date (boundary check)', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-17',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, true);
    assert.strictEqual(res.activeRaces.length, 2);
    assert.ok(res.activeRaces.some(r => r.id === 'mumbai-2026'));
    assert.ok(res.activeRaces.some(r => r.id === 'maastricht-2026'));
  });

  it('TC3: Should return active=true on intermediate race days', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-19',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, true);
    assert.strictEqual(res.activeRaces.length, 2);
  });

  it('TC4: Should return active=true on the exact race end date (boundary check)', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-20',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, true);
    assert.strictEqual(res.activeRaces.length, 2);
  });

  it('TC5: Should return active=true on Monday for 1-day Post-Race Wrap-Up window', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-21',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, true);
    assert.strictEqual(res.activeRaces.length, 2);
    assert.ok(res.activeRaces.every(r => r.isWrapUp === true));
  });

  it('TC5b: Should return active=false 2 days after race completion (Tuesday off-day)', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-22',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, false);
    assert.strictEqual(res.activeRaces.length, 0);
  });

  it('TC6: Should return active=false between race weekends', () => {
    const res = evaluateGatekeeper({
      today: '2026-10-15',
      dates: mockCalendar,
      isManualDispatch: false
    });
    assert.strictEqual(res.active, false);
    assert.strictEqual(res.activeRaces.length, 0);
  });

  it('TC7: Should return active=true on manual dispatch with specific race override', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-01', // off-day
      dates: mockCalendar,
      forceRace: 'mumbai',
      isManualDispatch: true
    });
    assert.strictEqual(res.active, true);
    assert.match(res.reason, /Manual workflow dispatch with target: "mumbai"/);
  });

  it('TC8: Should return active=true on manual dispatch with "all" target', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-01', // off-day
      dates: mockCalendar,
      forceRace: 'all',
      isManualDispatch: true
    });
    assert.strictEqual(res.active, true);
    assert.match(res.reason, /Manual workflow dispatch with target: "all"/);
  });

  it('TC9: Should fall back to date check if manual dispatch target is empty whitespace', () => {
    const res = evaluateGatekeeper({
      today: '2026-09-01', // off-day
      dates: mockCalendar,
      forceRace: '   ',
      isManualDispatch: true
    });
    assert.strictEqual(res.active, false);
  });

  it('TC10: Subprocess integration test: CLI exits with 0 and writes GITHUB_OUTPUT', async () => {
    const tmpDir = os.tmpdir();
    const outputFile = path.join(tmpDir, `github_output_${Date.now()}.txt`);

    try {
      // 1. Inactive day run
      await execFileAsync('node', ['check_active_today.mjs'], {
        env: {
          ...process.env,
          GITHUB_OUTPUT: outputFile,
          FORCE_RACE: '',
          IS_MANUAL_DISPATCH: 'false'
        }
      });

      const content = fs.readFileSync(outputFile, 'utf8');
      assert.ok(content.includes('active=false') || content.includes('active=true'));
    } finally {
      if (fs.existsSync(outputFile)) fs.unlinkSync(outputFile);
    }
  });
});
