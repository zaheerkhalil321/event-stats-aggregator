import fs from 'fs';
import path from 'path';

const enPath = path.resolve('../HyroxHeroMobile/src/i18n/translations/en.json');
const en = JSON.parse(fs.readFileSync(enPath, 'utf8'));

// 1. Dashboard keys
if (!en.dashboard) en.dashboard = {};
if (!en.dashboard.hyrox_events) {
  en.dashboard.hyrox_events = {
    title: 'HYROX Events',
    subtitle: 'Official races & global results',
  };
}

// 2. HyroxEvents screen keys
en.hyroxEvents = {
  screenTitle: 'HYROX Events',
  upcomingTab: 'Upcoming Races',
  completedTab: 'Past Results',
  searchPlaceholder: 'Search city or race name...',
  loading: 'Loading HYROX events...',
  noEventsTitle: 'No events found',
  tryDifferentSearch: 'Try searching for a different city or location',
  noEventsSubtitle: 'No races currently available for this section.',
  weeksToGo: '{weeks}w to go',
  soon: 'Soon',
  setAsMyRace: 'Set as My Race',
  confirmRaceTitle: 'Set Target Race?',
  confirmRaceMessage: 'Set {raceName} ({date}) as your target HYROX race? Your training plan will sync to this timeline.',
  updateFailed: 'Could not update your race. Please try again.',
  successTitle: 'Target Race Updated! 🏆',
  successMessage: 'Your race is set to {raceName}. Keep up the great training!',
  finishers: 'finishers',
  hideDetails: 'Hide',
  viewDivisions: 'Divisions',
  divisionBreakdown: 'Division Breakdown',
  athletes: 'athletes',
  noDivisionData: 'No division breakdown available.',
  loginRequired: 'Please sign in to set your target race.',
  ...(en.hyroxEvents || {}),
};

// 3. Onboarding race date keys
if (!en.onboarding) en.onboarding = {};
if (!en.onboarding.race_date) en.onboarding.race_date = {};
en.onboarding.race_date = {
  ...en.onboarding.race_date,
  officialRaces: 'Official HYROX',
  customDate: 'Custom Date',
  searchEvents: 'Search city or race...',
  loadingEvents: 'Loading official races...',
  noRacesFound: 'No upcoming races found. You can choose a custom date above.',
};

fs.writeFileSync(enPath, JSON.stringify(en, null, 2), 'utf8');
console.log('✅ Updated en.json translations with HYROX events keys');
