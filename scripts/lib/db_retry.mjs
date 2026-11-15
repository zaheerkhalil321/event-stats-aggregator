/**
 * A database client that survives dropped connections and short write locks.
 *
 * - Dropped connection: the HTTP connection to sqld can be closed while a script waits a long time
 *   between queries (e.g. during a 40-minute re-sync); the next query fails with "fetch failed"
 *   (ETIMEDOUT, "other side closed"). A fresh client is made and the query is tried again.
 * - Busy database: while another job writes (the backfill, another live lane), sqld can answer
 *   "SQLITE_BUSY: database is locked". Nothing was written, so the statement waits and is tried again.
 *
 * SQL errors are thrown at once.
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const errorText = (err) => [err?.message, err?.code, err?.cause?.message, err?.cause?.code].filter(Boolean).join(' ');

export function isConnectionError(err) {
  return /fetch failed|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE|other side closed|socket hang up|UND_ERR_SOCKET/i.test(errorText(err));
}

export function isBusyError(err) {
  return /SQLITE_BUSY|database is locked/i.test(errorText(err));
}

export function reconnectingClient(makeClient, { retries = 3, delayMs = 2000, log = console.warn } = {}) {
  let client = makeClient();
  async function run(call) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await call(client);
      } catch (err) {
        const dropped = isConnectionError(err);
        if (attempt > retries || !(dropped || isBusyError(err))) throw err;
        if (dropped) {
          log(`   ↻ database connection dropped (${err?.cause?.code || err?.message}); reconnecting (${attempt}/${retries})`);
          try { client.close?.(); } catch { /* already closed */ }
        } else {
          log(`   ↻ database busy (another job is writing); retrying (${attempt}/${retries})`);
        }
        await sleep(delayMs * attempt);
        if (dropped) client = makeClient();
      }
    }
  }
  return {
    execute: (stmt) => run((c) => c.execute(stmt)),
    batch: (stmts, mode) => run((c) => c.batch(stmts, mode)),
    close: () => client.close?.(),
  };
}
