import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconnectingClient, isConnectionError } from '../scripts/lib/db_retry.mjs';

const dropped = (code) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });

describe('reconnecting database client', () => {
  it('makes a new client and retries when the connection dropped', async () => {
    let made = 0;
    const db = reconnectingClient(() => {
      made++;
      const n = made;
      return { execute: async () => { if (n === 1) throw dropped('ETIMEDOUT'); return { rows: [{ ok: n }] }; } };
    }, { delayMs: 1, log: () => {} });
    assert.deepEqual((await db.execute('SELECT 1')).rows, [{ ok: 2 }]);
    assert.equal(made, 2);
  });

  it('throws SQL errors at once', async () => {
    let calls = 0;
    const db = reconnectingClient(() => ({ execute: async () => { calls++; throw new Error('SQL_INPUT_ERROR: no such column'); } }), { delayMs: 1, log: () => {} });
    await assert.rejects(db.execute('SELECT x'), /no such column/);
    assert.equal(calls, 1);
  });

  it('gives up after the last retry', async () => {
    let calls = 0;
    const db = reconnectingClient(() => ({ execute: async () => { calls++; throw dropped('ECONNRESET'); } }), { retries: 2, delayMs: 1, log: () => {} });
    await assert.rejects(db.execute('SELECT 1'), /fetch failed/);
    assert.equal(calls, 3);
  });

  it('recognises the errors seen in the workflow', () => {
    assert.equal(isConnectionError(dropped('ETIMEDOUT')), true);
    assert.equal(isConnectionError(Object.assign(new TypeError('fetch failed'), { cause: new Error('other side closed') })), true);
    assert.equal(isConnectionError(new Error('SQLITE_CONSTRAINT')), false);
  });
});
