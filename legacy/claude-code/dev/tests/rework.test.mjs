// rework（revision）と decompose 再 materialize（§5.1）。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, readAudit, events, item, approve, attest,
  writeDecomposeArtifacts, writeVerifyArtifacts, writeU1Code, writeU2Code, writeInterp,
  upToDecomposeApproved, toU1, VALID_PLAN, git,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }
function rework(tmp, to, feedback = 'やり直して', consent = 'その戻り先で進めて') {
  return run(tmp, ['rework', '--stdin'], JSON.stringify({ to, feedback, consent }));
}

// U1 実装済み・U2 in_progress の状態を作る。
function toU2WithU1Done(tmp) {
  toU1(tmp);
  writeU1Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']); // U1 done (commit) -> U2 in_progress
}

test('rework: increments revisions, invalidates downstream, moves cursor back', () => {
  const tmp = setupRepo();
  toU2WithU1Done(tmp);
  const r = rework(tmp, 'implement:U1', 'add の入力検証が足りない');
  assert.equal(r.status, 0, r.stderr);
  const st = readState(tmp);
  assert.equal(st.cursor, 'implement:U1');
  assert.equal(item(tmp, 'implement:U1').status, 'in_progress');
  assert.equal(item(tmp, 'implement:U1').revision, 2);
  assert.equal(item(tmp, 'implement:U2').status, 'pending');
  assert.equal(item(tmp, 'implement:U2').revision, 2, 'progressed items after target are invalidated');
  assert.equal(item(tmp, 'verify').revision, 1, 'untouched pending items keep their revision');
  assert.equal(item(tmp, 'decompose').revision, 1, 'items before target are untouched');
  const rec = readAudit(tmp).find(l => l.event === 'REWORK');
  assert.equal(rec.data.to, 'implement:U1');
  assert.deepEqual(rec.data.invalidated, ['implement:U1', 'implement:U2']);
  assert.equal(rec.data.feedback, 'add の入力検証が足りない');
  assert.equal(rec.data.consent, 'その戻り先で進めて');
  // git は巻き戻さない（追記型）
  assert.ok(git(tmp, ['log', '--oneline']).stdout.includes('implement:U1 approved'));
  cleanup(tmp);
});

test('rework FAIL: forward target / unknown target / missing fields', () => {
  const tmp = setupRepo();
  toU1(tmp);
  assert.match(rework(tmp, 'verify').stderr, /ahead of the cursor/);
  assert.match(rework(tmp, 'nope').stderr, /unknown item/);
  let r = run(tmp, ['rework', '--stdin'], JSON.stringify({ to: 'decompose', feedback: 'x' }));
  assert.match(r.stderr, /consent/);
  r = run(tmp, ['rework', '--stdin'], JSON.stringify({ to: 'decompose', consent: 'x' }));
  assert.match(r.stderr, /feedback/);
  cleanup(tmp);
});

test('rework: old-revision approval cannot advance the new revision', () => {
  const tmp = setupRepo();
  toU1(tmp);
  writeU1Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp); // r1 の承認を記録
  rework(tmp, 'implement:U1', '作り直し'); // r2 へ
  run(tmp, ['gate-open']); // r2 のゲート
  attest(tmp);
  const r = run(tmp, ['advance']); // r1 の APPROVED しかない
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no APPROVED .* revision 2/);
  // r2 で承認し直せば通る
  approve(tmp, '今度こそ承認します');
  assert.equal(run(tmp, ['advance']).status, 0);
  cleanup(tmp);
});

test('rework: feedback is registered as a learn candidate at the next gate-open', () => {
  const tmp = setupRepo();
  toU1(tmp);
  writeU1Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  rework(tmp, 'implement:U1', '境界値テストを足して');
  run(tmp, ['gate-open']);
  const cands = readState(tmp).learn_candidates;
  assert.ok(cands.some(c => c.source.startsWith('feedback:rework:implement:U1') && c.text === '境界値テストを足して'));
  cleanup(tmp);
});

test('re-materialize: kept ids keep revision (no double increment), new ids start at 1, pending removal ok', () => {
  const tmp = setupRepo();
  toU2WithU1Done(tmp);
  const r0 = rework(tmp, 'decompose', '分割を見直す');
  assert.equal(r0.status, 0, r0.stderr);
  assert.equal(item(tmp, 'decompose').revision, 2);
  assert.equal(item(tmp, 'implement:U1').revision, 2);
  assert.equal(item(tmp, 'implement:U2').revision, 2, 'U2 was in_progress -> invalidated');
  // 新 plan: U1 維持 / U2（pending・未実行だが…実行済み扱いか確認）
  // U2 は advance していない（save_point なし）ので除去できる。U3 を新設。
  const newPlan = { units: [
    { id: 'U1', title: 'add v2', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**'] },
    { id: 'U3', title: 'remove', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**'] },
  ] };
  writeDecomposeArtifacts(tmp, newPlan);
  run(tmp, ['gate-open']);
  approve(tmp, '再分解を承認');
  const r = run(tmp, ['advance']);
  assert.equal(r.status, 0, r.stderr);
  const st = readState(tmp);
  const ids = st.items.map(i => i.id);
  assert.ok(ids.includes('implement:U1') && ids.includes('implement:U3'));
  assert.ok(!ids.includes('implement:U2'), 'never-advanced pending unit may be removed');
  assert.equal(item(tmp, 'implement:U1').revision, 2, 're-materialize must NOT re-increment (rework already did)');
  assert.equal(item(tmp, 'implement:U1').title, 'add v2', 'definition updated from new plan');
  assert.ok(item(tmp, 'implement:U1').save_point, 'save_point history is kept');
  assert.equal(item(tmp, 'implement:U3').revision, 1, 'new id starts at revision 1');
  assert.equal(st.cursor, 'implement:U1');
  cleanup(tmp);
});

test('re-materialize FAIL: removing an already-implemented unit id is Default-FAIL', () => {
  const tmp = setupRepo();
  toU2WithU1Done(tmp); // U1 は save_point 持ち
  rework(tmp, 'decompose', '分割を見直す');
  const newPlan = { units: [
    { id: 'U9', title: 'other', check: 'true', write_globs: ['src/**'] },
  ] }; // U1 が消えている
  writeDecomposeArtifacts(tmp, newPlan);
  run(tmp, ['gate-open']);
  approve(tmp, '再分解を承認');
  const r = run(tmp, ['advance']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /removes already-implemented unit "implement:U1"/);
  cleanup(tmp);
});

test('re-materialize: work_roots subset is re-validated', () => {
  const tmp = setupRepo();
  toU2WithU1Done(tmp);
  rework(tmp, 'decompose', '見直し');
  const badPlan = { units: [
    { id: 'U1', title: 'add', check: 'true', write_globs: ['src/**'] },
    { id: 'U2', title: 'list', check: 'true', write_globs: ['docs/**'] }, // 範囲外
  ] };
  writeDecomposeArtifacts(tmp, badPlan);
  const r = run(tmp, ['gate-open']); // check=plan-lint が範囲外 glob で fail
  assert.notEqual(r.status, 0);
  assert.ok(events(tmp).includes('CHECK_FAILED'));
  cleanup(tmp);
});

test('rework then full re-advance: flow reaches verify again on new revisions', () => {
  const tmp = setupRepo();
  toU2WithU1Done(tmp);
  writeU2Code(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']); // -> verify
  rework(tmp, 'implement:U2', 'list の仕様が違う');
  // U2 を修正して再前進
  writeFileSync(join(tmp, 'src', 'list.mjs'), 'export function list(){ return [1]; }\n');
  writeFileSync(join(tmp, 'test', 'list.test.mjs'),
    "import { test } from 'node:test'; import assert from 'node:assert';\nimport { list } from '../src/list.mjs';\ntest('list', ()=>{ assert.deepEqual(list(),[1]); });\n");
  run(tmp, ['gate-open']);
  approve(tmp, '修正を承認');
  const r = run(tmp, ['advance']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readState(tmp).cursor, 'verify');
  assert.equal(item(tmp, 'verify').revision, 2, 'verify was invalidated by the first pass through');
  cleanup(tmp);
});
