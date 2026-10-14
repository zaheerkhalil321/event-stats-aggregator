import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createMikaClient } from '../scripts/lib/mika_http.mjs';

// A fake firewall: allows `burst` requests, then answers 403 until `blockMs` has passed.
function startFakeFirewall({ burst, blockMs }) {
  const state = { served: 0, blockedUntil: 0, hits: [], blockedHits: 0 };
  const server = http.createServer((req, res) => {
    const now = Date.now();
    state.hits.push({ url: req.url, at: now });
    if (now < state.blockedUntil) {
      state.blockedHits++;
      res.writeHead(403).end('403 Forbidden');
      return;
    }
    if (state.served >= burst) {
      state.served = 0;
      state.blockedUntil = now + blockMs;
      state.blockedHits++;
      res.writeHead(403).end('403 Forbidden');
      return;
    }
    state.served++;
    res.writeHead(200, { 'Content-Type': 'text/html' }).end(`ok ${req.url}`);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, state, base: `http://127.0.0.1:${server.address().port}` })));
}

describe('Polite mika HTTP client', () => {
  let fw;
  before(async () => { fw = await startFakeFirewall({ burst: 5, blockMs: 300 }); });
  after(() => fw.server.close());

  it('TC51: spaces requests evenly at the configured rate', async () => {
    const client = createMikaClient({ rate: 20, maxRate: 20, log: () => {} });
    fw.state.hits.length = 0;
    const t0 = Date.now();
    await Promise.all([1, 2, 3, 4].map((i) => client.get(`${fw.base}/pace/${i}`)));
    client.close();
    assert.ok(Date.now() - t0 >= 140, 'four requests at 20 req/s need at least ~150ms');
    fw.state.served = 0;
  });

  it('TC52: waits out a block, halves the rate, and retries the same URL so nothing is skipped', async () => {
    const logs = [];
    const client = createMikaClient({ rate: 50, maxRate: 50, firstPauseMs: 400, log: (m) => logs.push(m) });
    const urls = Array.from({ length: 12 }, (_, i) => `${fw.base}/athlete/${i}`);
    const results = await Promise.all(urls.map((u) => client.get(u)));
    client.close();
    assert.ok(results.every((r) => r.status === 200), 'every URL eventually succeeds');
    assert.deepEqual(results.map((r) => r.text), urls.map((u) => `ok ${u.slice(fw.base.length)}`));
    assert.ok(client.stats.blocks >= 1, 'the block was detected');
    assert.ok(client.rate <= 25, `rate was cut after the block (now ${client.rate})`);
    assert.ok(client.limitRate < 50, 'the blocked rate became a ceiling');
    assert.ok(logs.some((m) => m.includes('pausing')), 'the pause is logged');
  });

  it('TC64: paced() applies the same pacing and block handling to other request types (Playwright page loads)', async () => {
    const client = createMikaClient({ rate: 50, maxRate: 50, firstPauseMs: 300, log: () => {} });
    fw.state.served = 0;
    fw.state.blockedUntil = 0;
    const loads = Array.from({ length: 10 }, (_, i) => client.paced(async () => (await fetch(`${fw.base}/page/${i}`)).status));
    const results = await Promise.all(loads);
    client.close();
    assert.ok(results.every((r) => r.status === 200), 'every page load eventually succeeds');
    assert.ok(client.stats.blocks >= 1, 'the 403 from the fake firewall was handled as a block');
  });

  it('TC53: stops sending once the deadline has passed', async () => {
    const client = createMikaClient({ rate: 5, deadline: Date.now() - 1, log: () => {} });
    const r = await client.get(`${fw.base}/late`);
    client.close();
    assert.equal(r.stopped, true);
    assert.equal(r.status, 0);
  });
});
