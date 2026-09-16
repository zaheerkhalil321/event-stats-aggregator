import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'child_process';
import fs from 'fs';

function parseYamlWithRuby(filePath) {
  const cmd = `ruby -e 'require "yaml"; require "json"; puts JSON.generate(YAML.load_file("${filePath}"))'`;
  const output = execSync(cmd, { encoding: 'utf8' });
  return JSON.parse(output);
}

describe('GitHub Actions Workflow Architecture & Integrity', () => {
  it('TC24: live-sync.yml is valid YAML and parses without error', () => {
    assert.doesNotThrow(() => {
      const doc = parseYamlWithRuby('.github/workflows/live-sync.yml');
      assert.strictEqual(doc.name, '⚡ Live Weekend Sync');
    });
  });

  it('TC25: live-sync.yml contains concurrency lock to prevent overlapping runs', () => {
    const doc = parseYamlWithRuby('.github/workflows/live-sync.yml');
    assert.ok(doc.concurrency, 'Workflow must have a concurrency block');
    assert.strictEqual(doc.concurrency.group, 'live-weekend-sync');
    assert.strictEqual(doc.concurrency['cancel-in-progress'], false);
  });

  it('TC26: live-sync.yml gatekeeper step executes before install steps', () => {
    const doc = parseYamlWithRuby('.github/workflows/live-sync.yml');
    const steps = doc.jobs['live-sync'].steps;
    
    const gatekeeperIndex = steps.findIndex(s => s.id === 'gatekeeper');
    assert.ok(gatekeeperIndex !== -1, 'Gatekeeper step with id: gatekeeper must exist');

    // Subsequent heavy steps must check gatekeeper output
    const downstreamSteps = steps.slice(gatekeeperIndex + 1);
    for (const s of downstreamSteps) {
      assert.strictEqual(
        s.if,
        "steps.gatekeeper.outputs.active == 'true'",
        `Step "${s.name}" must be guarded by gatekeeper active check`
      );
    }
  });

  it('TC27: pipeline.yml is valid YAML and parses without error', () => {
    assert.doesNotThrow(() => {
      const doc = parseYamlWithRuby('.github/workflows/pipeline.yml');
      assert.strictEqual(doc.name, '🚀 Event Data Pipeline (Deep Monday Sync)');
    });
  });

  it('TC28: Checkpoint scripts exist and are readable on disk', () => {
    assert.ok(fs.existsSync('check_active_today.mjs'));
    assert.ok(fs.existsSync('sync_live.mjs'));
    assert.ok(fs.existsSync('sync_events.mjs'));
  });
});
