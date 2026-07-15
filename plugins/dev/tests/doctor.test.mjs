// doctor（read-only 診断）: 健全なフローで PASS、破損の各種で FAIL。自動復旧しない。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, writeDecomposeArtifacts, flowDir,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }

test('doctor: PASS on a healthy active flow (and no-op without .devflow)', () => {
  const tmp = setupRepo();
  let r = run(tmp, ['doctor']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /nothing to diagnose/);
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  r = run(tmp, ['doctor']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /doctor: PASS/);
  assert.match(r.stdout, /current gate card exists/);
  cleanup(tmp);
});

test('doctor: FAIL on tampered state.json (no auto-repair)', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  const sp = join(flowDir(tmp), 'state.json');
  const st = JSON.parse(readFileSync(sp, 'utf8'));
  st.cursor = 'verify';
  writeFileSync(sp, JSON.stringify(st, null, 2) + '\n');
  const r = run(tmp, ['doctor']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL audit chain integrity/);
  // 破損は残ったまま（自動復旧しない）
  assert.equal(JSON.parse(readFileSync(sp, 'utf8')).cursor, 'verify');
  cleanup(tmp);
});

test('doctor: FAIL when current points to a missing flow', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeFileSync(join(tmp, '.devflow', 'current'), 'ghost\n');
  const r = run(tmp, ['doctor']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL current -> \.devflow\/flows\/ghost/);
  cleanup(tmp);
});

test('doctor: FAIL on boundary violation and broken presented.jsonl lines', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeFileSync(join(tmp, 'evil.txt'), 'x\n'); // decompose 中の範囲外 untracked
  appendFileSync(join(flowDir(tmp), 'logs', 'presented.jsonl'), 'broken-line\n');
  const r = run(tmp, ['doctor']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL boundary scan/);
  assert.match(r.stdout, /FAIL presented\.jsonl lines parse/);
  cleanup(tmp);
});

test('doctor: FAIL on duplicate cid in memory.md', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeFileSync(join(tmp, '.devflow', 'memory.md'),
    '- a (learned 2026-01-01) <!-- cid:run1:c1 -->\n- b (learned 2026-01-01) <!-- cid:run1:c1 -->\n');
  const r = run(tmp, ['doctor']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /FAIL memory\.md cid uniqueness/);
  cleanup(tmp);
});
