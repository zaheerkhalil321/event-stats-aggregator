import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeepDetail } from '../scripts/backfill_splits.mjs';

const memberRow = (label, name) => `<tr class=""><th class="desc">${label}</th><td class=" last">${name}</td></tr>`;
const page = (rows) => `<html><body><table class="table table-condensed"><tbody>${rows.join('')}</tbody></table></body></html>`;

describe('detail page team members', () => {
  it('keeps each person once when the page repeats them', () => {
    const html = page([
      memberRow('Member 1', 'Meier, Linda (GER)'), memberRow('Member 2', 'Meier, Linda (GER)'),
      memberRow('Member 3', 'Storath, Lukas (GER)'), memberRow('Member 4', 'Storath, Lukas (GER)'),
    ]);
    assert.deepEqual(JSON.parse(parseDeepDetail(html).team_members), [
      { label: 'Member 1', name: 'Meier, Linda (GER)' },
      { label: 'Member 2', name: 'Storath, Lukas (GER)' },
    ]);
  });

  it('keeps a normal relay as it is', () => {
    const names = ['A, B (GER)', 'C, D (GER)', 'E, F (NED)', 'G, H (GER)'];
    const html = page(names.map((n, i) => memberRow(`Member ${i + 1}`, n)));
    assert.equal(JSON.parse(parseDeepDetail(html).team_members).length, 4);
  });
});
