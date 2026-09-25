import fs from 'fs';
import path from 'path';

const HYROX_HERO_ROOT = path.resolve('../HyroxHeroMobile');

console.log('Target HyroxHeroMobile root:', HYROX_HERO_ROOT);
if (!fs.existsSync(HYROX_HERO_ROOT)) {
  console.error('Error: HyroxHeroMobile not found at', HYROX_HERO_ROOT);
  process.exit(1);
}

// 1. Update src/types/index.ts
const typesPath = path.join(HYROX_HERO_ROOT, 'src/types/index.ts');
let typesContent = fs.readFileSync(typesPath, 'utf8');
if (!typesContent.includes('race_event_id?: string;')) {
  typesContent = typesContent.replace(
    'race_date?: string;',
    'race_date?: string;\n  race_event_id?: string;\n  race_event_name?: string;'
  );
  fs.writeFileSync(typesPath, typesContent, 'utf8');
  console.log('✅ Updated src/types/index.ts with race_event_id & race_event_name');
} else {
  console.log('ℹ️ src/types/index.ts already has race_event_id');
}

// 2. Create src/services/eventsApi.ts
const eventsApiServiceContent = `import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Sentry from '@sentry/react-native';

export interface HyroxEvent {
  id: string;
  name: string;
  city: string;
  country: string;
  country_code: string;
  venue: string | null;
  date: string;
  end_date: string;
  season: string;
  status: 'upcoming' | 'completed' | 'live';
  athletes_count: number;
  course_map_url: string | null;
  lap_instructions: string | null;
}

export interface EventDivisionBreakdown {
  division: string;
  teams_count: number;
  athletes_count: number;
}

export interface EventDetails extends HyroxEvent {
  division_breakdown: EventDivisionBreakdown[];
}

export interface EventResult {
  id: number;
  race_id: string;
  bib_number: string;
  full_name: string;
  nationality: string;
  gender: string;
  age_group: string;
  division: string;
  total_time: string;
  overall_rank: number;
  division_rank: number;
  age_group_rank: number;
  roxzone: string;
}

export interface EventsResponse {
  success: boolean;
  data: HyroxEvent[];
  pagination: {
    page: number;
    limit: number;
    total_events: number;
    total_pages: number;
  };
}

export interface EventResultsResponse {
  success: boolean;
  race_id: string;
  filters: {
    division?: string | null;
    age_group?: string | null;
    gender?: string | null;
    sort_by: string;
    order: string;
  };
  pagination: {
    page: number;
    limit: number;
    total_athletes: number;
    total_pages: number;
  };
  data: EventResult[];
}

const HYROX_API_URL =
  process.env.EXPO_PUBLIC_HYROX_API_URL ||
  'https://hyrox-results-api.vercel.app';

const HYROX_API_KEY =
  process.env.EXPO_PUBLIC_HYROX_API_KEY ||
  'hx_demo_free';

const CACHE_KEYS = {
  UPCOMING: '@hyrox_events_upcoming',
  COMPLETED: '@hyrox_events_completed',
  EVENT_DETAILS: '@hyrox_event_detail_',
};

const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes cache

interface CacheWrapper<T> {
  timestamp: number;
  data: T;
}

async function getCached<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed: CacheWrapper<T> = JSON.parse(raw);
    if (Date.now() - parsed.timestamp < CACHE_TTL_MS) {
      return parsed.data;
    }
  } catch (error) {
    // Ignore cache read failures gracefully
  }
  return null;
}

async function setCached<T>(key: string, data: T): Promise<void> {
  try {
    const wrapper: CacheWrapper<T> = { timestamp: Date.now(), data };
    await AsyncStorage.setItem(key, JSON.stringify(wrapper));
  } catch (error) {
    // Ignore cache write failures gracefully
  }
}

/**
 * Fetch HYROX events list with optional filters
 */
export async function fetchEvents(options?: {
  status?: 'upcoming' | 'completed' | 'live' | 'all';
  season?: string;
  q?: string;
  page?: number;
  limit?: number;
  country_code?: string;
}): Promise<HyroxEvent[]> {
  try {
    const params = new URLSearchParams();
    if (options?.status && options.status !== 'all') {
      params.append('status', options.status);
    }
    if (options?.season) params.append('season', options.season);
    if (options?.q) params.append('q', options.q);
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.country_code) params.append('country_code', options.country_code);

    const url = \`\${HYROX_API_URL}/v1/events?\${params.toString()}\`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': \`Bearer \${HYROX_API_KEY}\`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(\`Events API HTTP \${response.status}\`);
    }

    const json: EventsResponse = await response.json();
    return json.data || [];
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag('feature', 'hyrox_events');
      scope.setExtra('options', options);
      Sentry.captureException(error);
    });
    console.error('[eventsApi] Error fetching events:', error);
    return [];
  }
}

/**
 * Fetch upcoming official HYROX races (with caching for speed)
 */
export async function fetchUpcomingEvents(searchQuery?: string): Promise<HyroxEvent[]> {
  const cacheKey = searchQuery ? \`\${CACHE_KEYS.UPCOMING}_\${searchQuery.trim().toLowerCase()}\` : CACHE_KEYS.UPCOMING;
  
  // Return cached version if fresh
  const cached = await getCached<HyroxEvent[]>(cacheKey);
  
  try {
    const live = await fetchEvents({
      status: 'upcoming',
      q: searchQuery || undefined,
      limit: 100,
    });

    if (live && live.length > 0) {
      await setCached(cacheKey, live);
      return live;
    }
  } catch (error) {
    console.warn('[eventsApi] Using cached upcoming events due to error:', error);
  }

  return cached || [];
}

/**
 * Fetch completed official HYROX races (with caching)
 */
export async function fetchCompletedEvents(searchQuery?: string, page = 1): Promise<HyroxEvent[]> {
  const cacheKey = \`\${CACHE_KEYS.COMPLETED}_\${searchQuery || ''}_\${page}\`;
  const cached = await getCached<HyroxEvent[]>(cacheKey);

  try {
    const live = await fetchEvents({
      status: 'completed',
      q: searchQuery || undefined,
      page,
      limit: 30,
    });

    if (live && live.length > 0) {
      await setCached(cacheKey, live);
      return live;
    }
  } catch (error) {
    console.warn('[eventsApi] Using cached completed events due to error:', error);
  }

  return cached || [];
}

/**
 * Fetch detailed event information including division participant counts
 */
export async function fetchEventDetails(eventId: string): Promise<EventDetails | null> {
  const cacheKey = \`\${CACHE_KEYS.EVENT_DETAILS}\${eventId}\`;
  const cached = await getCached<EventDetails>(cacheKey);
  if (cached) return cached;

  try {
    const url = \`\${HYROX_API_URL}/v1/events/\${encodeURIComponent(eventId)}\`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': \`Bearer \${HYROX_API_KEY}\`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(\`Event details API HTTP \${response.status}\`);
    }

    const json = await response.json();
    if (json.success && json.data) {
      await setCached(cacheKey, json.data);
      return json.data;
    }
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag('feature', 'hyrox_event_details');
      scope.setExtra('eventId', eventId);
      Sentry.captureException(error);
    });
    console.error(\`[eventsApi] Error fetching event details for \${eventId}:\`, error);
  }

  return null;
}

/**
 * Fetch leaderboards and results for a specific completed event
 */
export async function fetchEventResults(
  eventId: string,
  options?: {
    division?: string;
    age_group?: string;
    gender?: string;
    sort_by?: string;
    order?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  }
): Promise<EventResultsResponse | null> {
  try {
    const params = new URLSearchParams();
    if (options?.division) params.append('division', options.division);
    if (options?.age_group) params.append('age_group', options.age_group);
    if (options?.gender) params.append('gender', options.gender);
    if (options?.sort_by) params.append('sort_by', options.sort_by);
    if (options?.order) params.append('order', options.order);
    if (options?.page) params.append('page', options.page.toString());
    if (options?.limit) params.append('limit', options.limit.toString());

    const url = \`\${HYROX_API_URL}/v1/events/\${encodeURIComponent(eventId)}/results?\${params.toString()}\`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': \`Bearer \${HYROX_API_KEY}\`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(\`Event results API HTTP \${response.status}\`);
    }

    const json: EventResultsResponse = await response.json();
    return json;
  } catch (error) {
    Sentry.withScope((scope) => {
      scope.setTag('feature', 'hyrox_event_results');
      scope.setExtra('eventId', eventId);
      Sentry.captureException(error);
    });
    console.error(\`[eventsApi] Error fetching results for \${eventId}:\`, error);
    return null;
  }
}

/**
 * Helper to calculate number of weeks between today and race date
 */
export function getWeeksUntilDate(dateStr: string): number {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + 'T00:00:00');
    const diffMs = target.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24 * 7)));
  } catch {
    return 0;
  }
}

/**
 * Format ISO YYYY-MM-DD to human friendly string
 */
export function formatHyroxEventDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}
`;

const eventsServicePath = path.join(HYROX_HERO_ROOT, 'src/services/eventsApi.ts');
fs.writeFileSync(eventsServicePath, eventsApiServiceContent, 'utf8');
console.log('✅ Created src/services/eventsApi.ts');
