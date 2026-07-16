// 学習ループ（§9）: 候補 cid の逐語永続・重複 cid 拒否・free-text 経路・consent 必須・
// memory 専用コミットと LEARNED への SHA 記録。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, readAudit, item, approve, git,
  writeDecomposeArtifacts, writeInterp, upToDecomposeApproved,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }
function learn(tmp, payload) {
  return run(tmp, ['learn', '--stdin'], JSON.stringify(payload));
}
function memory(tmp) {
  return readFileSync(join(tmp, '.devflow', 'memory.md'), 'utf8');
}

const INTERP = '## I-1: 保存形式が未指定\n- 未指定: 保存形式\n- 解釈: JSON を採る\n- 理由: 依存なしで扱えるため\n';

// gate-open で学習候補 c1 が登録された状態にする。
function withCandidate(tmp) {
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  writeInterp(tmp, 'decompose', INTERP);
  run(tmp, ['gate-open']);
  const c = readState(tmp).learn_candidates;
  assert.equal(c.length, 1);
  assert.equal(c[0].cid, 'c1');
  return c[0];
}

test('learn: candidate cid persists the registered verbatim text with a memory-only commit', () => {
  const tmp = setupRepo();
  const cand = withCandidate(tmp);
  const before = Number(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim());
  const r = learn(tmp, { candidate: 'c1', consent: 'c1 を学習して' });
  assert.equal(r.status, 0, r.stderr);
  // 逐語（bookkeeper 所有の登録済みテキスト）がそのまま append される
  const mem = memory(tmp);
  assert.ok(mem.includes(cand.text), 'verbatim candidate text');
  assert.match(mem, /<!-- cid:run1:c1 -->/);
  // memory 専用コミット: 1コミット増え、変更は memory.md と .devflow/.gitignore のみ
  const after = Number(git(tmp, ['rev-list', '--count', 'HEAD']).stdout.trim());
  assert.equal(after, before + 1);
  const files = git(tmp, ['show', '--name-only', '--pretty=format:', 'HEAD']).stdout.trim().split('\n').filter(Boolean);
  assert.deepEqual(files.sort(), ['.devflow/.gitignore', '.devflow/memory.md']);
  // LEARNED audit に SHA が記録される
  const learned = readAudit(tmp).find(l => l.event === 'LEARNED');
  assert.equal(learned.data.cid, 'c1');
  assert.equal(learned.data.commit, git(tmp, ['rev-parse', 'HEAD']).stdout.trim());
  assert.equal(learned.data.consent, 'c1 を学習して');
  // 追跡対象の未コミット差分がフロー中に残らない
  assert.equal(git(tmp, ['status', '--porcelain']).stdout.trim(), '');
  cleanup(tmp);
});

test('learn FAIL: duplicate cid is refused (idempotent append)', () => {
  const tmp = setupRepo();
  withCandidate(tmp);
  assert.equal(learn(tmp, { candidate: 'c1', consent: 'ok' }).status, 0);
  const r = learn(tmp, { candidate: 'c1', consent: 'もう一度' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /already persisted/);
  assert.equal((memory(tmp).match(/cid:run1:c1/g) || []).length, 1);
  cleanup(tmp);
});

test('learn: free_text path appends the human verbatim line', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  const r = learn(tmp, { free_text: 'テストは一時ディレクトリで行うこと', consent: 'これを覚えて' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(memory(tmp).includes('- テストは一時ディレクトリで行うこと (learned '));
  assert.match(memory(tmp), /<!-- cid:run1:ft-1 -->/);
  cleanup(tmp);
});

test('learn FAIL: consent required / exactly one of candidate|free_text / unknown cid', () => {
  const tmp = setupRepo();
  withCandidate(tmp);
  assert.match(learn(tmp, { candidate: 'c1' }).stderr, /consent/);
  assert.match(learn(tmp, { consent: 'x' }).stderr, /exactly one of/);
  assert.match(learn(tmp, { candidate: 'c1', free_text: 'y', consent: 'x' }).stderr, /exactly one of/);
  assert.match(learn(tmp, { candidate: 'c99', consent: 'x' }).stderr, /unknown candidate/);
  cleanup(tmp);
});

test('learn candidates: registration is idempotent across repeated gate-open of the same revision', () => {
  const tmp = setupRepo();
  withCandidate(tmp);
  run(tmp, ['reject', '--stdin'], JSON.stringify({ feedback: '直して' }));
  run(tmp, ['gate-open']); // 同一 (item, revision) の再 gate-open
  const cands = readState(tmp).learn_candidates;
  const interpCands = cands.filter(c => c.source.startsWith('interpretations:decompose:r1'));
  assert.equal(interpCands.length, 1, 'same entry must not be registered twice');
  // reject feedback は新規候補として追加される
  assert.ok(cands.some(c => c.source.startsWith('feedback:reject:decompose:r1')));
  cleanup(tmp);
});

test('gate card carries learn candidates with cid + verbatim', () => {
  const tmp = setupRepo();
  const cand = withCandidate(tmp);
  const card = readFileSync(join(tmp, '.devflow', 'flows', 'run1', 'gate-cards', 'decompose-r1-1.md'), 'utf8');
  assert.ok(card.includes(`- cid=${cand.cid} (${cand.source}) ${cand.text}`));
  cleanup(tmp);
});
