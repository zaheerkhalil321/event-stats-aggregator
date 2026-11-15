/**
 * A database client that survives dropped connections. The HTTP connection to sqld can be closed
 * while a script waits a long time between queries (e.g. during a 40-minute re-sync); the next
 * query then fails with "fetch failed" (ETIMEDOUT, "other side closed"). On such network errors a
 * fresh client is made and the query is tried again. SQL errors are thrown at once.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isConnectionError(err) {
  const text = [err?.message, err?.code, err?.cause?.message, err?.cause?.code].filter(Boolean).join(' ');
  return /fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|other side closed|socket hang up|UND_ERR_SOCKET/i.test(text);
}

export function reconnectingClient(makeClient, { retries = 3, delayMs = 2000, log = console.warn } = {}) {
  let client = makeClient();
  return {
    async execute(stmt) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await client.execute(stmt);
        } catch (err) {
          if (attempt > retries || !isConnectionError(err)) throw err;
          log(`   ↻ database connection dropped (${err?.cause?.code || err?.message}); reconnecting (${attempt}/${retries})`);
          try { client.close?.(); } catch { /* already closed */ }
          await sleep(delayMs * attempt);
          client = makeClient();
        }
      }
    },
  };
}
