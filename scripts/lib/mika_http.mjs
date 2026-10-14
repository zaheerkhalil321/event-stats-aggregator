/**
 * Polite, self-tuning HTTP client for hyrox.r.mikatiming.com.
 *
 * mika:timing sits behind an AWS load balancer with a rate-based firewall rule: an IP that sends
 * too many requests within a rolling ~5 minute window gets HTTP 403 until its request count drops.
 * Datacenter ranges such as DigitalOcean are refused outright, GitHub runners are not.
 *
 * Instead of bursting until blocked (and then giving up), every request goes through one global
 * pacer that tunes itself (AIMD, like TCP congestion control):
 *   - requests are spaced evenly at `rate` req/s, no matter how many workers are waiting
 *   - after a run of successes the rate creeps up, quickly while far below a known limit, slowly near it
 *   - on the first 403/429 the rate is halved, everything pauses until the window clears, and the
 *     rate that triggered the block becomes a ceiling (we never go back above 90% of it)
 *   - after a pause a single probe request goes first; the others wait until it succeeds
 *   - a blocked request is retried with the same URL, so no athlete is skipped because of a block
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round2 = (n) => Math.round(n * 100) / 100;

export function createMikaClient({
  rate = 2,
  minRate = 0.5,
  maxRate = 6,
  firstPauseMs = 5 * 60_000,
  maxPauseMs = 15 * 60_000,
  deadline = Infinity, // epoch ms after which requests stop being sent
  log = console.log,
  statsEveryMs = 60_000,
} = {}) {
  let currentRate = rate;
  let limitRate = maxRate;   // learned ceiling: 90% of the lowest rate that ever got blocked
  let nextSlot = 0;
  let blockedUntil = 0;
  let pauseMs = 0;
  let okStreak = 0;
  let probeNeeded = false;   // after a pause, only one request may test the water
  let probeInFlight = false;

  const stats = { requests: 0, ok: 0, blocks: 0, blockedResponses: 0, errors: 0, startedAt: Date.now() };
  let windowRequests = 0;

  const statsTimer = setInterval(() => {
    const paused = Date.now() < blockedUntil ? ` | ⏸️ paused ${Math.ceil((blockedUntil - Date.now()) / 1000)}s` : '';
    log(`📈 mika: ${round2(currentRate)} req/s (limit ${round2(limitRate)}) | last ${Math.round(statsEveryMs / 1000)}s: ${windowRequests} req | total ok ${stats.ok}, blocks ${stats.blocks}, errors ${stats.errors}${paused}`);
    windowRequests = 0;
  }, statsEveryMs);
  statsTimer.unref?.();

  const pastDeadline = () => Date.now() >= deadline;

  async function acquire() {
    for (;;) {
      if (pastDeadline()) return false;
      const now = Date.now();
      if (now < blockedUntil) {
        await sleep(Math.min(blockedUntil - now, Math.max(1000, deadline - now)));
        continue;
      }
      if (probeNeeded) {
        if (probeInFlight) { await sleep(1000); continue; }
        probeInFlight = true;
        return true;
      }
      const slot = Math.max(now, nextSlot);
      nextSlot = slot + 1000 / currentRate;
      if (slot > now) await sleep(slot - now);
      if (Date.now() >= blockedUntil && !probeNeeded) return !pastDeadline();
    }
  }

  function settleProbe(succeeded) {
    if (!probeInFlight) return;
    probeInFlight = false;
    if (succeeded) {
      probeNeeded = false;
      pauseMs = 0;
      nextSlot = Date.now() + 1000 / currentRate;
      log(`✅ mika: block lifted, resuming at ${round2(currentRate)} req/s`);
    }
  }

  function onSuccess() {
    stats.ok++;
    okStreak++;
    settleProbe(true);
    const farBelowLimit = currentRate < limitRate * 0.75;
    const needed = farBelowLimit ? 150 : 1000;
    if (okStreak >= needed && currentRate < limitRate) {
      currentRate = round2(Math.min(limitRate, currentRate + (farBelowLimit ? 0.25 : 0.1)));
      okStreak = 0;
    }
  }

  function onBlocked(status) {
    stats.blockedResponses++;
    okStreak = 0;
    const wasProbe = probeInFlight;
    probeInFlight = false;
    // Requests already in flight when the block started all come back 403: count the block once.
    if (Date.now() < blockedUntil && !wasProbe) return;
    stats.blocks++;
    if (!wasProbe) {
      limitRate = round2(Math.max(minRate, Math.min(limitRate, currentRate * 0.9)));
      currentRate = round2(Math.max(minRate, currentRate * 0.5));
    }
    pauseMs = pauseMs ? Math.min(maxPauseMs, Math.round(pauseMs * 1.5)) : firstPauseMs;
    blockedUntil = Date.now() + pauseMs;
    probeNeeded = true;
    log(`⏸️ mika: HTTP ${status}${wasProbe ? ' again on probe' : ''} — pausing ${Math.round(pauseMs / 1000)}s, then continuing at ${round2(currentRate)} req/s (limit now ${round2(limitRate)})`);
  }

  /**
   * GET a mika:timing page. Blocks (403/429) are waited out and retried with the same URL.
   * Resolves to { status, text } — status 0 means a network error that kept failing, or the deadline passed.
   */
  async function get(url, { timeoutMs = 15_000, networkRetries = 3 } = {}) {
    let networkFailures = 0;
    for (;;) {
      if (!(await acquire())) return { status: 0, text: null, stopped: true };
      stats.requests++;
      windowRequests++;
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        if (res.status === 403 || res.status === 429) {
          await res.body?.cancel().catch(() => {});
          onBlocked(res.status);
          continue;
        }
        const text = await res.text();
        if (res.ok) {
          onSuccess();
        } else {
          stats.errors++;
          settleProbe(true); // the site answered, so we are not blocked
        }
        return { status: res.status, text };
      } catch (err) {
        stats.errors++;
        networkFailures++;
        if (probeInFlight) probeInFlight = false; // let another request probe
        if (networkFailures > networkRetries) return { status: 0, text: null, error: err };
        await sleep(1000 * 2 ** networkFailures);
      }
    }
  }

  /**
   * Pace any other kind of request (e.g. a Playwright page.goto). `task` performs one attempt and
   * resolves to its HTTP status; on 403/429 it is waited out and run again. Errors are re-thrown.
   */
  async function paced(task) {
    for (;;) {
      if (!(await acquire())) return { status: 0, stopped: true };
      stats.requests++;
      windowRequests++;
      let status;
      try {
        status = await task();
      } catch (err) {
        stats.errors++;
        if (probeInFlight) probeInFlight = false;
        throw err;
      }
      if (status === 403 || status === 429) {
        onBlocked(status);
        continue;
      }
      if (status >= 200 && status < 400) onSuccess();
      else {
        stats.errors++;
        settleProbe(true);
      }
      return { status };
    }
  }

  return {
    get,
    paced,
    stats,
    pastDeadline,
    get rate() { return currentRate; },
    get limitRate() { return limitRate; },
    close() { clearInterval(statsTimer); },
  };
}
