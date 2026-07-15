// review 工程（§8）: review-package / findings-record / finding-resolve / advance の Default-FAIL。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, events, item, approve, attest, git,
  writeDecomposeArtifacts, writeVerifyArtifacts, writeU1Code, recordFindings,
  reviewConfig, flowDir,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }

const ONE_UNIT_PLAN = {
  units: [{ id: 'U1', title: 'add', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**'] }],
};

// review が in_progress の状態まで進める。
function toReview(tmp) {
  initFlow(tmp, { config: reviewConfig() });
  writeDecomposeArtifacts(tmp, ONE_UNIT_PLAN);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']);
  writeU1Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']);
  writeVerifyArtifacts(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']); // -> review in_progress
  assert.equal(readState(tmp).cursor, 'review');
}

const F1 = { id: 'F-1', severity: 'major', kind: 'implicit-behavior', claim: '空文字入力の挙動が interpretations に未記録', evidence: 'src/add.mjs: add() throws on empty', suggested_rework_to: 'implement:U1' };

test('review-package: generates package with .devflow excluded from diff', () => {
  const tmp = setupRepo();
  toReview(tmp);
  const r = run(tmp, ['review-package']);
  assert.equal(r.status, 0, r.stderr);
  const dir = join(flowDir(tmp), 'review', 'package-r1');
  for (const f of ['diff.patch', 'intent.txt', 'spec.md', 'plan.md', 'plan.json', 'evidence.json', 'manifest.json']) {
    assert.ok(existsSync(join(dir, f)), `${f} must exist`);
  }
  const diff = readFileSync(join(dir, 'diff.patch'), 'utf8');
  assert.ok(diff.includes('src/add.mjs'), 'product diff included');
  assert.ok(!diff.includes('.devflow/'), '.devflow/** excluded from review diff');
  assert.ok(existsSync(join(dir, 'interpretations', 'implement-U1.md')));
  assert.ok(existsSync(join(dir, 'interpretations', 'decompose.md')));
  assert.ok(!existsSync(join(dir, 'interpretations', 'review.md')), 'review itself is not an input');
  const ev = JSON.parse(readFileSync(join(dir, 'evidence.json'), 'utf8'));
  assert.ok(ev.find(e => e.item === 'implement:U1').evidence.some(x => x.exit === 0));
  cleanup(tmp);
});

test('review-package FAIL: cursor is not the review item', () => {
  const tmp = setupRepo();
  initFlow(tmp, { config: reviewConfig() });
  const r = run(tmp, ['review-package']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cursor must be the review item/);
  cleanup(tmp);
});

test('findings-record: pass side writes artifacts via bookkeeper and records state', () => {
  const tmp = setupRepo();
  toReview(tmp);
  const r = recordFindings(tmp, [F1]);
  assert.equal(r.status, 0, r.stderr);
  const dir = join(flowDir(tmp), 'artifacts', 'review');
  const json = JSON.parse(readFileSync(join(dir, 'findings.json'), 'utf8'));
  assert.equal(json.revision, 1);
  assert.equal(json.findings[0].id, 'F-1');
  assert.ok(existsSync(join(dir, 'findings.md')));
  assert.ok(existsSync(join(dir, 'interpretations.md')));
  assert.ok(events(tmp).includes('FINDINGS_RECORDED'));
  const st = readState(tmp);
  assert.equal(st.findings.length, 1);
  assert.equal(st.findings[0].resolution, null);
  // findings-lint pass
  assert.equal(run(tmp, ['findings-lint']).status, 0);
  cleanup(tmp);
});

test('findings-record: fail sides (schema violations -> FINDINGS_LINT_FAILED)', () => {
  const tmp = setupRepo();
  toReview(tmp);
  for (const [findings, re] of [
    [[{ ...F1, id: 'X-1' }], /"id" must match F-<n>/],
    [[F1, F1], /duplicate id/],
    [[{ ...F1, severity: 'catastrophic' }], /"severity"/],
    [[{ ...F1, claim: 'a\nb' }], /single line/],
    [[{ ...F1, claim: '' }], /"claim"/],
    [[{ ...F1, suggested_rework_to: 'nope' }], /existing item id/],
    ['not-an-array', /must be an array/],
  ]) {
    const r = run(tmp, ['findings-record', '--stdin'], JSON.stringify({
      findings, findings_md: '# f\n- x', interpretations_md: '暗黙の解釈なし',
    }));
    assert.notEqual(r.status, 0, JSON.stringify(findings));
    assert.match(r.stderr, re, JSON.stringify(findings));
  }
  // interpretations_md の形式違反も拒否
  const r = run(tmp, ['findings-record', '--stdin'], JSON.stringify({
    findings: [F1], findings_md: '# f', interpretations_md: '## I-1: x\n- 未指定: a\n',
  }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /interpretations_md/);
  assert.ok(events(tmp).includes('FINDINGS_LINT_FAILED'));
  cleanup(tmp);
});

test('review gate card lists findings as [F-n] lines', () => {
  const tmp = setupRepo();
  toReview(tmp);
  recordFindings(tmp, [F1, { id: 'F-2', severity: 'minor', kind: 'style', claim: '命名が曖昧', evidence: 'src/add.mjs L3' }]);
  const r = run(tmp, ['gate-open']);
  assert.equal(r.status, 0, r.stderr);
  const card = readFileSync(join(flowDir(tmp), 'gate-cards', 'review-r1-1.md'), 'utf8');
  assert.ok(card.includes(`[F-1] major: ${F1.claim}`));
  assert.ok(card.includes('[F-2] minor: 命名が曖昧'));
  cleanup(tmp);
});

test('review advance Default-FAIL: unresolved findings / fix findings remaining', () => {
  const tmp = setupRepo();
  toReview(tmp);
  recordFindings(tmp, [F1, { id: 'F-2', severity: 'minor', kind: 'style', claim: '命名が曖昧', evidence: 'src/add.mjs L3' }]);
  run(tmp, ['gate-open']);
  approve(tmp);
  // 未処理の finding があると advance 不可
  let r = run(tmp, ['advance']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /unresolved finding/);
  // F-1 を fix にすると、resolve 済みでも advance 不可（rework 経路のみ）
  run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'fix', reason: '直すべき', consent: 'F-1 は対応して' }));
  run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-2', action: 'accept', reason: '軽微', consent: 'F-2 は許容' }));
  r = run(tmp, ['advance']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /resolved as fix remain/);
  assert.ok(events(tmp).filter(e => e === 'FINDING_RESOLVED').length === 2);
  cleanup(tmp);
});

test('review advance passes when all findings accepted (zero fix)', () => {
  const tmp = setupRepo();
  toReview(tmp);
  recordFindings(tmp, [F1]);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'accept', reason: '今回は許容する', consent: 'F-1 は許容で' }));
  const r = run(tmp, ['advance']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readState(tmp).status, 'done');
  cleanup(tmp);
});

test('review advance passes with zero findings', () => {
  const tmp = setupRepo();
  toReview(tmp);
  recordFindings(tmp, []);
  const r0 = run(tmp, ['gate-open']);
  assert.equal(r0.status, 0, r0.stderr);
  approve(tmp);
  assert.equal(run(tmp, ['advance']).status, 0);
  cleanup(tmp);
});

test('finding-resolve FAIL: unknown id / double resolve / bad action / missing consent', () => {
  const tmp = setupRepo();
  toReview(tmp);
  recordFindings(tmp, [F1]);
  let r = run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-9', action: 'accept', reason: 'x', consent: 'y' }));
  assert.match(r.stderr, /unknown finding/);
  r = run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'defer', reason: 'x', consent: 'y' }));
  assert.match(r.stderr, /"action" must be/);
  r = run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'accept', reason: 'x' }));
  assert.match(r.stderr, /consent/);
  assert.equal(run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'accept', reason: 'x', consent: 'y' })).status, 0);
  r = run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'accept', reason: 'x', consent: 'y' }));
  assert.match(r.stderr, /already resolved/);
  cleanup(tmp);
});

test('review rework path: fix finding -> rework -> new revision review with fresh findings', () => {
  const tmp = setupRepo();
  toReview(tmp);
  recordFindings(tmp, [F1]);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['finding-resolve', '--stdin'], JSON.stringify({ id: 'F-1', action: 'fix', reason: '仕様違反', consent: '対応して' }));
  const r = run(tmp, ['rework', '--stdin'], JSON.stringify({ to: 'implement:U1', feedback: F1.claim, consent: 'U1 に戻して' }));
  assert.equal(r.status, 0, r.stderr);
  // U1 を再前進（差分なし）
  run(tmp, ['gate-open']);
  approve(tmp, '再承認');
  run(tmp, ['advance']);
  // verify 再前進
  run(tmp, ['gate-open']);
  approve(tmp, '再承認');
  run(tmp, ['advance']);
  assert.equal(readState(tmp).cursor, 'review');
  assert.equal(item(tmp, 'review').revision, 2);
  // 旧 revision の findings は現 revision の判定に混入しない
  recordFindings(tmp, []);
  const r2 = run(tmp, ['gate-open']);
  assert.equal(r2.status, 0, r2.stderr);
  approve(tmp, '再承認');
  assert.equal(run(tmp, ['advance']).status, 0, 'old-revision fix finding must not block the new revision');
  cleanup(tmp);
});

test('findings-lint FAIL: findings.json written outside findings-record does not match state', () => {
  const tmp = setupRepo();
  toReview(tmp);
  // findings-record を経ず fs で直接書いた findings.json は、findings-lint が状態不一致で拒否する
  const dir = join(flowDir(tmp), 'artifacts', 'review');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({
    revision: 1,
    findings: [{ id: 'F-1', severity: 'minor', kind: 'k', claim: 'c', evidence: 'e' }],
  }, null, 2) + '\n');
  writeFileSync(join(dir, 'findings.md'), 'x\n');
  writeFileSync(join(dir, 'interpretations.md'), '暗黙の解釈なし\n');
  const r = run(tmp, ['findings-lint']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /does not match the recorded state/);
  cleanup(tmp);
});
