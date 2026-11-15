import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { clockTime } from '../scripts/lib/clock_time.mjs';

describe('clockTime', () => {
  it('reads Elite times with hundredths', () => {
    assert.equal(clockTime('53:47.18'), '00:53:47');
    assert.equal(clockTime('1:02:03.4'), '01:02:03');
  });
  it('keeps normal times and rejects the rest', () => {
    assert.equal(clockTime('00:55:23'), '00:55:23');
    assert.equal(clockTime('–'), null);
    assert.equal(clockTime(''), null);
    assert.equal(clockTime(null), null);
  });
});
