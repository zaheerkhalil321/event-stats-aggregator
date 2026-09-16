import fs from 'fs';

// 1. Check if user manually requested a specific race or full sync via dispatch
const forceRace = process.env.FORCE_RACE;
const isManualDispatch = process.env.IS_MANUAL_DISPATCH === 'true';

if (isManualDispatch && forceRace && forceRace.trim() !== '') {
  console.log(`🎯 Manual workflow dispatch with target: "${forceRace}". Proceeding with sync.`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'active=true\n');
  }
  process.exit(0);
}

// 2. Read verified dates from sync_live.mjs
const code = fs.readFileSync('sync_live.mjs', 'utf8');
const match = code.match(/const KNOWN_DATES = ({[\s\S]*?});/);
const dates = match ? eval('(' + match[1] + ')') : {};

const today = new Date().toISOString().slice(0, 10);
const activeRaces = Object.entries(dates).filter(([id, d]) => {
  return today >= d.date && today <= d.end_date;
});

if (activeRaces.length > 0) {
  console.log(`🔥 [LIVE GATEKEEPER] ${activeRaces.length} race(s) active today (${today}):`);
  for (const [id, d] of activeRaces) {
    console.log(`   🏁 ${id} (${d.date} to ${d.end_date})`);
  }
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'active=true\n');
  }
  process.exit(0);
} else {
  console.log(`☕ [LIVE GATEKEEPER] No HYROX races active today (${today}).`);
  console.log('   ⏩ Skipping npm install, Playwright browser install, and scraper execution. Exiting in 0.1s!');
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, 'active=false\n');
  }
  process.exit(0);
}
