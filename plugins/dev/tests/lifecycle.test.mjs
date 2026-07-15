// フローのライフサイクル（§3）: active 中の init 拒否・done 後の連続 init・current 整合・履歴保持。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, currentId, flowDir, approve,
  writeDecomposeArtifacts, baseConfig,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }

// decompose 1工程だけの最小 config で完走させる。
function miniConfig() {
  return {
    schema: 1,
    work_roots: ['src/**'],
    stages: [
      { id: '__implement__', kind: 'implement_placeholder' },
      { id: 'wrap', kind: 'stage', artifacts: ['note.md'], check: 'true' },
    ],
    units: [{ id: 'U1', title: 'one', check: 'true', write_globs: ['src/**'] }],
  };
}

function finishMiniFlow(tmp, flowId) {
  // implement:U1（差分なしで通す）
  writeFileSync(join(flowDir(tmp, flowId), 'artifacts', 'implement-U1', 'interpretations.md'), '暗黙の解釈なし\n');
  run(tmp, ['gate-open']);
  approve(tmp, '承認します', flowId);
  run(tmp, ['advance']);
  // wrap stage
  const dir = join(flowDir(tmp, flowId), 'artifacts', 'wrap');
  writeFileSync(join(dir, 'note.md'), 'done\n');
  writeFileSync(join(dir, 'interpretations.md'), '暗黙の解釈なし\n');
  run(tmp, ['gate-open']);
  approve(tmp, '承認します', flowId);
  run(tmp, ['advance']);
}

// init は artifacts ディレクトリを掘らないので、mini flow のディレクトリを用意する。
import { mkdirSync } from 'node:fs';
function prepMiniDirs(tmp, flowId) {
  mkdirSync(join(flowDir(tmp, flowId), 'artifacts', 'implement-U1'), { recursive: true });
  mkdirSync(join(flowDir(tmp, flowId), 'artifacts', 'wrap'), { recursive: true });
}

test('lifecycle: init while active is refused (Default-FAIL)', () => {
  const tmp = setupRepo();
  assert.equal(initFlow(tmp).status, 0);
  const r = initFlow(tmp, { flowId: 'run2' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /active flow "run1" already exists/);
  cleanup(tmp);
});

test('lifecycle: done clears current, next init creates a new flow, history retained', () => {
  const tmp = setupRepo();
  assert.equal(initFlow(tmp, { flowId: 'flow-a', config: miniConfig(), spec: null }).status, 0);
  prepMiniDirs(tmp, 'flow-a');
  finishMiniFlow(tmp, 'flow-a');
  assert.equal(readState(tmp, 'flow-a').status, 'done');
  assert.equal(currentId(tmp), null, 'current must be cleared after done');
  // 連続 init
  const r = initFlow(tmp, { flowId: 'flow-b', config: miniConfig(), spec: null });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(currentId(tmp), 'flow-b');
  // done フローのディレクトリは履歴として保持される
  assert.ok(existsSync(join(flowDir(tmp, 'flow-a'), 'state.json')));
  assert.equal(readState(tmp, 'flow-a').status, 'done');
  cleanup(tmp);
});

test('lifecycle: init refuses reusing an existing flow directory', () => {
  const tmp = setupRepo();
  initFlow(tmp, { flowId: 'flow-a', config: miniConfig(), spec: null });
  prepMiniDirs(tmp, 'flow-a');
  finishMiniFlow(tmp, 'flow-a');
  const r = initFlow(tmp, { flowId: 'flow-a', config: miniConfig(), spec: null });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /flow directory already exists/);
  cleanup(tmp);
});

test('lifecycle: stale current (pointing to missing state) is refused with doctor guidance', () => {
  const tmp = setupRepo();
  mkdirSync(join(tmp, '.devflow'), { recursive: true });
  writeFileSync(join(tmp, '.devflow', 'current'), 'ghost\n');
  const r = initFlow(tmp);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /doctor/);
  cleanup(tmp);
});

test('lifecycle: status resolves via current -> flows/<id>/state.json', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  const r = run(tmp, ['status', '--json']);
  assert.equal(r.status, 0);
  const st = JSON.parse(r.stdout);
  assert.equal(st.flow_id, 'run1');
  assert.equal(st.flow_dir, '.devflow/flows/run1');
  assert.equal(st.cursor, 'decompose');
  assert.ok(st.next);
  cleanup(tmp);
});
