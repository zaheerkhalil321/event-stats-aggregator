import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export function getKnownDates() {
  const code = fs.readFileSync('sync_live.mjs', 'utf8');
  const match = code.match(/const KNOWN_DATES = ({[\s\S]*?});/);
  return match ? eval('(' + match[1] + ')') : {};
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

  // 2. Check known calendar dates
  const raceDates = dates || getKnownDates();
  const activeRaces = Object.entries(raceDates).filter(([id, d]) => {
    return today >= d.date && today <= d.end_date;
  });

  if (activeRaces.length > 0) {
    return {
      active: true,
      reason: `${activeRaces.length} race(s) active today (${today})`,
      activeRaces: activeRaces.map(([id, d]) => ({ id, ...d }))
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
