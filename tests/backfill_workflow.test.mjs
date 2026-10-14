import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';

function parseYamlWithRuby(filePath) {
  const cmd = `ruby -e 'require "yaml"; require "json"; puts JSON.generate(YAML.load_file("${filePath}"))'`;
  return JSON.parse(execSync(cmd, { encoding: 'utf8' }));
}

describe('Backfill workflow (steady single run + self-chaining)', () => {
  const doc = parseYamlWithRuby('.github/workflows/backfill-splits.yml');
  const job = doc.jobs.backfill;
  const step = (id) => job.steps.find((s) => s.id === id);

  it('TC59: stays inside the GitHub 6-hour job limit and never runs twice at once', () => {
    assert.ok(job['timeout-minutes'] <= 355);
    assert.equal(doc.concurrency.group, 'deep-splits-backfill');
    assert.equal(doc.concurrency['cancel-in-progress'], false);
  });

  it('TC60: inputs reach the scripts through env vars, not inline ${{ }} in shell code', () => {
    for (const s of job.steps.filter((x) => x.run)) {
      assert.ok(!/\$\{\{\s*(inputs|github\.event\.inputs)\./.test(s.run), `step "${s.name}" must not interpolate inputs into the script`);
    }
  });

  it('TC61: the next run is only dispatched when a script reported work left', () => {
    const chain = job.steps.find((s) => /next run/i.test(s.name));
    assert.ok(chain, 'chain step exists');
    assert.match(chain.if, /more_work == 'true'/);
    assert.ok(doc.permissions.actions === 'write', 'GITHUB_TOKEN may dispatch workflows');
  });

  it('TC62: the splits step still runs when discovery failed', () => {
    assert.match(step('splits').if, /!cancelled\(\)/);
  });
});
