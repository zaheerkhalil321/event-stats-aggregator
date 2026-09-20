import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function getKnownDates() {
  const code = fs.readFileSync('sync_live.mjs', 'utf8');
  const match = code.match(/const KNOWN_DATES = ({[\s\S]*?});/);
  return match ? eval('(' + match[1] + ')') : {};
}

export function getWrapUpDate(endDateStr) {
  const d = new Date(endDateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function evaluateGatekeeper({
  forceRace = process.env.FORCE_RACE,
  isManualDispatch = process.env.IS_MANUAL_DISPATCH === 'true',
  today = new Date().toISOString().slice(0, 10),
  dates = null,
} = {}) {
  // 1. If manual dispatch specifies a target (or 'all'), allow it to proceed
  if (isManualDispatch && forceRace && forceRace.trim() !== '') {
    return {
      active: true,
      reason: `Manual workflow dispatch with target: "${forceRace}"`,
      activeRaces: []
    };
  }

  // 2. Check known calendar dates (including 1-day Post-Race Wrap-Up window)
  const raceDates = dates || getKnownDates();
  const activeRaces = Object.entries(raceDates).filter(([id, d]) => {
    const wrapUpDate = getWrapUpDate(d.end_date);
    return today >= d.date && today <= wrapUpDate;
  });

  if (activeRaces.length > 0) {
    const wrapUpCount = activeRaces.filter(([id, d]) => today === getWrapUpDate(d.end_date)).length;
    const modeLabel = wrapUpCount > 0 ? ` (including ${wrapUpCount} race(s) in Monday wrap-up)` : '';
    return {
      active: true,
      reason: `${activeRaces.length} race(s) active today (${today})${modeLabel}`,
      activeRaces: activeRaces.map(([id, d]) => ({ 
        id, 
        ...d,
        isWrapUp: today === getWrapUpDate(d.end_date)
      }))
    };
  }

  return {
    active: false,
    reason: `No HYROX races active today (${today})`,
    activeRaces: []
  };
}

// Direct CLI execution block
const isMain = process.argv[1] && (
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
);

if (isMain) {
  const result = evaluateGatekeeper();
  if (result.active) {
    console.log(`🔥 [LIVE GATEKEEPER] ${result.reason}`);
    for (const r of result.activeRaces) {
      console.log(`   🏁 ${r.id} (${r.date} to ${r.end_date})`);
    }
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'active=true\n');
    }
    process.exit(0);
  } else {
    console.log(`☕ [LIVE GATEKEEPER] ${result.reason}`);
    console.log('   ⏩ Skipping npm install, Playwright browser install, and scraper execution. Exiting in 0.1s!');
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, 'active=false\n');
    }
    process.exit(0);
  }
}
