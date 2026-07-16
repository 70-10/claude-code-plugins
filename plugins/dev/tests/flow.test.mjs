// bookkeeper 単体テスト: 正常遷移の全経路 + Default-FAIL の否定側（プロトタイプ移植分）。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, readAudit, events, item, git, approve, attest,
  writeDecomposeArtifacts, writeVerifyArtifacts, writeU1Code, writeU2Code, writeInterp,
  upToDecomposeApproved, baseConfig, flowDir, currentId, artDir, VALID_PLAN,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }

test('init: creates state, first item in_progress, FLOW_INIT recorded with consent verbatim', () => {
  const tmp = setupRepo();
  const r = initFlow(tmp);
  assert.equal(r.status, 0, r.stderr);
  const st = readState(tmp);
  assert.equal(st.status, 'active');
  assert.equal(st.cursor, 'decompose');
  assert.equal(st.intent, 'テスト用タスク');
  assert.equal(item(tmp, 'decompose').status, 'in_progress');
  assert.equal(item(tmp, 'verify').status, 'pending');
  assert.ok(st.base_commit && st.base_commit.length >= 7);
  assert.equal(currentId(tmp), 'run1');
  assert.deepEqual(events(tmp), ['FLOW_INIT']);
  assert.equal(readAudit(tmp)[0].data.consent, 'この構成で開始してください');
  // .devflow/.gitignore は bookkeeper 生成の固定内容
  assert.equal(readFileSync(join(tmp, '.devflow', '.gitignore'), 'utf8'), '*\n!.gitignore\n!memory.md\n');
  cleanup(tmp);
});

test('init FAIL: missing payload fields (Default-FAIL)', () => {
  const tmp = setupRepo();
  for (const payload of [
    {},
    { config: baseConfig(), intent: 'x', flow_id: 'r' }, // consent 欠落
    { config: baseConfig(), intent: 'x', consent: 'y' }, // flow_id 欠落
    { config: baseConfig(), flow_id: 'r', consent: 'y' }, // intent 欠落
    { intent: 'x', flow_id: 'r', consent: 'y' }, // config 欠落
  ]) {
    const r = run(tmp, ['init', '--stdin'], JSON.stringify(payload));
    assert.notEqual(r.status, 0, JSON.stringify(payload));
  }
  cleanup(tmp);
});

test('init FAIL: spec_path not found', () => {
  const tmp = setupRepo();
  const r = initFlow(tmp, { spec: 'NO_SUCH_SPEC.md' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /spec_path not found/);
  cleanup(tmp);
});

test('full happy path: decompose -> U1 -> U2 -> verify -> done', () => {
  const tmp = setupRepo();
  upToDecomposeApproved(tmp);
  const commitsBefore = git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim();
  let r = run(tmp, ['advance']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim(), commitsBefore,
    'stage advance must not create a commit');
  assert.equal(item(tmp, 'decompose').status, 'done');
  assert.equal(item(tmp, 'decompose').save_point, git(tmp, ['rev-parse', 'HEAD']).stdout.trim());
  assert.equal(readState(tmp).cursor, 'implement:U1');
  assert.equal(item(tmp, 'implement:U1').status, 'in_progress');
  assert.equal(item(tmp, 'implement:U1').revision, 1);
  assert.ok(events(tmp).includes('UNITS_MATERIALIZED'));

  // implement U1
  writeU1Code(tmp);
  r = run(tmp, ['gate-open']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(item(tmp, 'implement:U1').status, 'gate_open');
  approve(tmp);
  const before = git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim();
  r = run(tmp, ['advance']);
  assert.equal(r.status, 0, r.stderr);
  const after = git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim();
  assert.equal(Number(after), Number(before) + 1, 'implement advance must create exactly one commit');
  const changed = git(tmp, ['show', '--name-only', '--pretty=format:', 'HEAD']).stdout.trim().split('\n').filter(Boolean);
  assert.deepEqual(changed.sort(), ['src/add.mjs', 'test/add.test.mjs'].sort(),
    'save point commit stages only write_globs paths (never .devflow)');
  assert.equal(item(tmp, 'implement:U1').save_point, git(tmp, ['rev-parse', 'HEAD']).stdout.trim());

  // implement U2
  assert.equal(readState(tmp).cursor, 'implement:U2');
  writeU2Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']);
  assert.equal(readState(tmp).cursor, 'verify');

  // verify (stage)
  writeVerifyArtifacts(tmp);
  r = run(tmp, ['gate-open']);
  assert.equal(r.status, 0, r.stderr);
  approve(tmp);
  const beforeVerify = git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim();
  r = run(tmp, ['advance']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim(), beforeVerify);
  assert.equal(readState(tmp).status, 'done');
  assert.ok(events(tmp).includes('FLOW_DONE'));
  assert.equal(currentId(tmp), null, 'current must be cleared when the flow is done');
  assertAuditChainValid(tmp);
  cleanup(tmp);
});

test('gate-open FAIL: declared artifact missing', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  const r = run(tmp, ['gate-open']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /artifact missing/);
  cleanup(tmp);
});

test('gate-open FAIL: check command fails -> CHECK_FAILED', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1' }] }); // plan-lint が fail する
  const r = run(tmp, ['gate-open']);
  assert.notEqual(r.status, 0);
  assert.ok(events(tmp).includes('CHECK_FAILED'));
  assert.notEqual(item(tmp, 'decompose').status, 'gate_open');
  cleanup(tmp);
});

test('approve FAIL: no open gate / empty input', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  let r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not at an open gate/);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  attest(tmp);
  r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /non-empty string/);
  cleanup(tmp);
});

test('advance FAIL: no approval recorded', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  attest(tmp); // 提示のみで承認なし
  const r = run(tmp, ['advance']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no APPROVED/);
  cleanup(tmp);
});

test('INTEGRITY_VIOLATION: direct state.json edit', () => {
  const tmp = setupRepo();
  upToDecomposeApproved(tmp);
  const sp = join(flowDir(tmp), 'state.json');
  const s = JSON.parse(readFileSync(sp, 'utf8'));
  s.cursor = 'verify';
  writeFileSync(sp, JSON.stringify(s, null, 2) + '\n');
  const r = run(tmp, ['advance']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /INTEGRITY_VIOLATION/);
  assert.match(r.stderr, /modified outside/);
  cleanup(tmp);
});

test('INTEGRITY_VIOLATION: middle audit line tampered (full-chain recompute)', () => {
  const tmp = setupRepo();
  upToDecomposeApproved(tmp);
  const ap = join(flowDir(tmp), 'audit.jsonl');
  const lines = readFileSync(ap, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  lines[1].data.tampered = true;
  writeFileSync(ap, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
  const r = run(tmp, ['advance']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /INTEGRITY_VIOLATION/);
  assert.match(r.stderr, /seq 1/);
  cleanup(tmp);
});

test('BOUNDARY_VIOLATION: out-of-scope change during decompose, recovery works', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  mkdirSync(join(tmp, 'src'), { recursive: true });
  const sneaky = join(tmp, 'src', 'sneaky.mjs');
  writeFileSync(sneaky, 'export const x=1;\n');
  let r = run(tmp, ['gate-open']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /BOUNDARY_VIOLATION/);
  assert.ok(events(tmp).includes('BOUNDARY_VIOLATION'));
  // 修正イテレーション: 範囲外ファイルを戻すと再 gate-open は成功し、チェーンは整合したまま
  rmSync(sneaky);
  r = run(tmp, ['gate-open']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(item(tmp, 'decompose').status, 'gate_open');
  assertAuditChainValid(tmp);
  assert.equal(approve(tmp).status, 0);
  assert.equal(run(tmp, ['advance']).status, 0);
  assertAuditChainValid(tmp);
  cleanup(tmp);
});

test('boundary scan: .devflow/** is always excluded', () => {
  const tmp = setupRepo();
  toU1viaHelpers(tmp);
  // .devflow 配下の追加ファイル（bookkeeper 外で置かれたとしても）境界違反にならない
  writeFileSync(join(flowDir(tmp), 'stray.txt'), 'not a violation\n');
  const r = run(tmp, ['gate-open']); // interpretations 不足で fail するが境界違反ではない
  assert.doesNotMatch(r.stderr, /BOUNDARY_VIOLATION/);
  cleanup(tmp);
});
function toU1viaHelpers(tmp) {
  upToDecomposeApproved(tmp);
  run(tmp, ['advance']);
}

test('ARTIFACT_HASH_MISMATCH: artifact swapped after gate-open', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  writeFileSync(join(artDir(tmp, 'decompose'), 'plan.json'),
    JSON.stringify({ units: [{ id: 'X', title: 't', check: 'true', write_globs: ['src/**'] }] }, null, 2));
  attest(tmp);
  const r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ARTIFACT_HASH_MISMATCH/);
  assert.ok(events(tmp).includes('ARTIFACT_HASH_MISMATCH'));
  cleanup(tmp);
});

test('interpretations: gate-open FAILs when interpretations.md is missing', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  rmSync(join(artDir(tmp, 'decompose'), 'interpretations.md'));
  const r = run(tmp, ['gate-open']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /interpretations\.md/);
  cleanup(tmp);
});

test('interpretations: gate-open output includes the FULL verbatim text', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  const text = '## I-1: done 後の list 表示\n- 未指定: done 後の表示\n- 解釈: done も表示する\n- 理由: 履歴確認の用途を優先\n';
  writeDecomposeArtifacts(tmp);
  writeInterp(tmp, 'decompose', text);
  const r = run(tmp, ['gate-open']);
  assert.equal(r.status, 0, r.stderr);
  const summary = JSON.parse(r.stdout.replace(/^GATE OPEN\n/, ''));
  const interp = summary.interpretations.find(i => i.path.endsWith('interpretations.md'));
  assert.ok(interp);
  assert.equal(interp.text, text, 'interpretations text must be verbatim');
  cleanup(tmp);
});

test('interpretations: implement unit gets interpretations artifact + augmented write_glob', () => {
  const tmp = setupRepo();
  upToDecomposeApproved(tmp);
  run(tmp, ['advance']);
  const u1 = item(tmp, 'implement:U1');
  const dir = '.devflow/flows/run1/artifacts/implement-U1';
  assert.deepEqual(u1.artifacts, [`${dir}/interpretations.md`]);
  assert.ok(u1.write_globs.includes(`${dir}/**`));
  assert.ok(u1.write_globs.includes('src/**'));
  assert.deepEqual(u1.plan_globs, ['src/**', 'test/**', 'package.json']);
  cleanup(tmp);
});

test('reject: invalidates artifact_hashes, records feedback, re-gate-open re-records', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  assert.equal(item(tmp, 'decompose').artifact_hashes.length, 3);
  const r = run(tmp, ['reject', '--stdin'], JSON.stringify({ feedback: 'plan.md に依存順を追加して' }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(item(tmp, 'decompose').status, 'in_progress');
  assert.equal(item(tmp, 'decompose').artifact_hashes.length, 0);
  assert.ok(events(tmp).includes('REJECTED'));
  assert.equal(readState(tmp).feedbacks.at(-1).text, 'plan.md に依存順を追加して');
  run(tmp, ['gate-open']);
  assert.equal(item(tmp, 'decompose').artifact_hashes.length, 3);
  // reject feedback は学習候補として cid 付き登録される（§9）
  const cands = readState(tmp).learn_candidates;
  assert.ok(cands.some(c => c.source.startsWith('feedback:reject:decompose') && c.text === 'plan.md に依存順を追加して'));
  cleanup(tmp);
});

test('reject x3: escape hatch note emitted', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  let last;
  for (let i = 0; i < 3; i++) {
    run(tmp, ['gate-open']);
    last = run(tmp, ['reject', '--stdin'], JSON.stringify({ feedback: 'again' }));
  }
  assert.match(last.stdout, /escape hatch/i);
  cleanup(tmp);
});

test('plan-lint: pass and fail sides (incl. work_roots subset)', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  assert.equal(run(tmp, ['plan-lint']).status, 0);
  // fail: duplicate id
  writeDecomposeArtifacts(tmp, { units: [
    { id: 'U1', title: 'a', check: 'true', write_globs: ['src/**'] },
    { id: 'U1', title: 'b', check: 'true', write_globs: ['src/**'] },
  ] });
  assert.match(run(tmp, ['plan-lint']).stderr, /duplicate/);
  // fail: missing field
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1', write_globs: ['src/**'] }] });
  assert.match(run(tmp, ['plan-lint']).stderr, /"title"|"check"/);
  // fail: work_roots の範囲外 glob
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1', title: 'a', check: 'true', write_globs: ['docs/**'] }] });
  assert.match(run(tmp, ['plan-lint']).stderr, /not a subset of work_roots/);
  // fail: 裸の **
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1', title: 'a', check: 'true', write_globs: ['**'] }] });
  assert.match(run(tmp, ['plan-lint']).stderr, /bare wildcard/);
  // fail: ワイルドカード開始
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1', title: 'a', check: 'true', write_globs: ['*/src/**'] }] });
  assert.match(run(tmp, ['plan-lint']).stderr, /wildcard-leading/);
  // fail: 保護パス
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1', title: 'a', check: 'true', write_globs: ['.claude/**'] }] });
  assert.match(run(tmp, ['plan-lint']).stderr, /protected path/);
  cleanup(tmp);
});

test('advance implement: commit created (diff) then skipped (no diff)', () => {
  const tmp = setupRepo();
  const plan = { units: [
    { id: 'U1', title: 'add', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**'] },
    { id: 'U2', title: 'noop', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**'] },
  ] };
  upToDecomposeApproved(tmp, plan);
  run(tmp, ['advance']);
  writeU1Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  const beforeU1 = Number(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim());
  run(tmp, ['advance']);
  const afterU1 = Number(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim());
  assert.equal(afterU1, beforeU1 + 1);
  const headAfterU1 = git(tmp, ['rev-parse', 'HEAD']).stdout.trim();
  // U2: 新規差分なし（interpretations は .devflow 配下なので製品差分にならない）
  assert.equal(readState(tmp).cursor, 'implement:U2');
  writeInterp(tmp, 'implement:U2');
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']);
  assert.equal(Number(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim()), afterU1, 'no-diff commit skip');
  assert.equal(item(tmp, 'implement:U2').save_point, headAfterU1);
  cleanup(tmp);
});

test('free text is accepted only via --stdin (no shell-argument path)', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  for (const args of [
    ['approve', '--input', '承認します'],
    ['reject', '--feedback', 'x'],
    ['rework', '--to', 'decompose', '--feedback', 'x', '--consent', 'y'],
    ['learn', '--free-text', 'x', '--consent', 'y'],
    ['finding-resolve', '--id', 'F-1', '--action', 'accept'],
    ['amend', '--consent', 'y'],
    ['findings-record'],
    ['config-lint'],
    ['init'],
  ]) {
    const r = run(tmp, args);
    assert.notEqual(r.status, 0, args.join(' '));
    assert.match(r.stderr, /--stdin/, args.join(' '));
  }
  cleanup(tmp);
});

// ---- audit チェーン検証ヘルパー（テスト内で全行再計算） ----
import { createHash } from 'node:crypto';
function sha(s) { return createHash('sha256').update(s).digest('hex'); }
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
export function assertAuditChainValid(tmp, id = 'run1') {
  const lines = readAudit(tmp, id);
  const GEN = '0'.repeat(64);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    assert.equal(l.prev_hash, i === 0 ? GEN : lines[i - 1].state_hash, `chain break at seq ${l.seq}`);
    const body = stable({ seq: l.seq, ts: l.ts, event: l.event, item: l.item, data: l.data });
    assert.equal(l.state_hash, sha(l.prev_hash + '|' + body), `state_hash mismatch at seq ${l.seq}`);
  }
}
