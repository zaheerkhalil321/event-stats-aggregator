import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconnectingClient, isConnectionError, isBusyError } from '../scripts/lib/db_retry.mjs';

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

  it('waits and retries when the database is locked, on the same client', async () => {
    let made = 0, calls = 0;
    const db = reconnectingClient(() => {
      made++;
      return { execute: async () => { calls++; if (calls < 3) throw new Error('SQLITE_BUSY: SQLite error: database is locked'); return { rows: [] }; } };
    }, { delayMs: 1, log: () => {} });
    await db.execute('INSERT 1');
    assert.equal(calls, 3);
    assert.equal(made, 1);
  });

  it('retries batches too', async () => {
    let calls = 0;
    const db = reconnectingClient(() => ({ batch: async (stmts, mode) => { calls++; if (calls === 1) throw new Error('SQLITE_BUSY: database is locked'); return [stmts.length, mode]; } }), { delayMs: 1, log: () => {} });
    assert.deepEqual(await db.batch(['a', 'b'], 'write'), [2, 'write']);
    assert.equal(calls, 2);
  });

  it('tells a locked database from other errors', () => {
    assert.equal(isBusyError(new Error('SQLITE_BUSY: SQLite error: database is locked')), true);
    assert.equal(isBusyError(new Error('SQLITE_CONSTRAINT: UNIQUE constraint failed')), false);
  });
});

