// config-lint / stdin 経路 / work_roots 部分集合検査 / amend。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync } from 'node:fs';
import {
  setupRepo, run, initFlow, readState, events, item, approve,
  writeDecomposeArtifacts, baseConfig, reviewConfig, WORK_ROOTS,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }
function lint(tmp, config) {
  return run(tmp, ['config-lint', '--stdin'], JSON.stringify(config));
}

test('config-lint: pass side (decompose form and inline-units form)', () => {
  const tmp = setupRepo();
  assert.equal(lint(tmp, baseConfig()).status, 0);
  assert.equal(lint(tmp, reviewConfig()).status, 0);
  const inline = {
    schema: 1, work_roots: ['src/**'],
    stages: [
      { id: '__implement__', kind: 'implement_placeholder' },
      { id: 'verify', kind: 'stage', artifacts: ['report.md'], check: 'true' },
    ],
    units: [{ id: 'U1', title: 'one', check: 'true', write_globs: ['src/**'] }],
  };
  assert.equal(lint(tmp, inline).status, 0, lint(tmp, inline).stderr);
  cleanup(tmp);
});

test('config-lint: fail sides (schema / stages / units xor decompose)', () => {
  const tmp = setupRepo();
  // schema 違い
  assert.match(lint(tmp, { ...baseConfig(), schema: 2 }).stderr, /schema must be 1/);
  // work_roots 欠落
  const noRoots = baseConfig(); delete noRoots.work_roots;
  assert.match(lint(tmp, noRoots).stderr, /work_roots/);
  // placeholder 欠落
  const noPh = baseConfig();
  noPh.stages = noPh.stages.filter(s => s.kind !== 'implement_placeholder');
  assert.match(lint(tmp, noPh).stderr, /implement_placeholder/);
  // decompose もインライン units も無い
  const neither = baseConfig();
  neither.stages = neither.stages.filter(s => s.id !== 'decompose');
  assert.match(lint(tmp, neither).stderr, /either a "decompose" stage or inline "units"/);
  // 両方ある
  const both = baseConfig({ units: [{ id: 'U1', title: 'x', check: 'true', write_globs: ['src/**'] }] });
  assert.match(lint(tmp, both).stderr, /mutually exclusive/);
  // review が最後でない
  const cfg = reviewConfig();
  cfg.stages = [cfg.stages.at(-1), ...cfg.stages.slice(0, -1)];
  assert.match(lint(tmp, cfg).stderr, /review stage must be the last/);
  // stage id に ':'
  const badId = baseConfig();
  badId.stages[0] = { ...badId.stages[0], id: 'de:compose' };
  assert.match(lint(tmp, badId).stderr, /path-safe/);
  cleanup(tmp);
});

test('config-lint: forbidden globs in work_roots (Default-FAIL each)', () => {
  const tmp = setupRepo();
  for (const [roots, re] of [
    [['**'], /bare wildcard/],
    [['*'], /bare wildcard/],
    [['*/src/**'], /wildcard-leading/],
    [['.devflow/**'], /protected path/],
    [['.claude/**'], /protected path/],
    [['.git/**'], /protected path/],
    [['/abs/**'], /absolute/],
    [['src/../.git/**'], /".." segments/],
  ]) {
    const r = lint(tmp, baseConfig({ work_roots: roots }));
    assert.notEqual(r.status, 0, roots.join(','));
    assert.match(r.stderr, re, roots.join(','));
  }
  cleanup(tmp);
});

test('config-lint: inline units must be a subset of work_roots', () => {
  const tmp = setupRepo();
  const cfg = {
    schema: 1, work_roots: ['src/**'],
    stages: [
      { id: '__implement__', kind: 'implement_placeholder' },
      { id: 'verify', kind: 'stage', artifacts: ['report.md'], check: 'true' },
    ],
    units: [{ id: 'U1', title: 'x', check: 'true', write_globs: ['docs/**'] }],
  };
  const r = lint(tmp, cfg);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a subset of work_roots/);
  // 完全一致は部分集合として許可（work_root が /** で終わらない場合）
  const exact = {
    ...cfg,
    work_roots: ['src/**', 'package.json'],
    units: [{ id: 'U1', title: 'x', check: 'true', write_globs: ['package.json'] }],
  };
  assert.equal(lint(tmp, exact).status, 0, lint(tmp, exact).stderr);
  // 静的接頭辞の錯覚（src2 は src/** の配下ではない）
  const tricky = {
    ...cfg,
    units: [{ id: 'U1', title: 'x', check: 'true', write_globs: ['src2/**'] }],
  };
  assert.match(lint(tmp, tricky).stderr, /not a subset of work_roots/);
  cleanup(tmp);
});

test('amend: replaces pending stages, refuses touching non-pending items', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']); // decompose done -> implement:U1
  // pending の verify を差し替える（check 変更）: 許可
  const cfg2 = baseConfig();
  cfg2.stages = cfg2.stages.map(s => s.id === 'verify' ? { ...s, check: 'true' } : s);
  let r = run(tmp, ['amend', '--stdin'], JSON.stringify({ config: cfg2, consent: '構成変更に同意' }));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(item(tmp, 'verify').check, 'true');
  assert.ok(events(tmp).includes('AMENDED'));
  // done の decompose を差し替える: 拒否
  const cfg3 = baseConfig();
  cfg3.stages = cfg3.stages.map(s => s.id === 'decompose' ? { ...s, check: 'echo changed' } : s);
  r = run(tmp, ['amend', '--stdin'], JSON.stringify({ config: cfg3, consent: '同意' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /cannot modify non-pending item "decompose"/);
  // done の decompose を取り除く: 拒否
  const cfg4 = baseConfig();
  cfg4.stages = cfg4.stages.filter(s => s.id !== 'decompose');
  cfg4.units = [{ id: 'U1', title: 'add', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**', 'package.json'] }];
  r = run(tmp, ['amend', '--stdin'], JSON.stringify({ config: cfg4, consent: '同意' }));
  assert.notEqual(r.status, 0);
  cleanup(tmp);
});

test('amend: work_roots extension via consent; shrink below existing unit globs is refused', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']); // units materialized
  // 拡張: OK
  const wider = baseConfig({ work_roots: [...WORK_ROOTS, 'docs/**'] });
  let r = run(tmp, ['amend', '--stdin'], JSON.stringify({ config: wider, consent: 'work_roots 拡張に同意' }));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(readState(tmp).work_roots, [...WORK_ROOTS, 'docs/**']);
  // 縮小して既存 unit の glob が範囲外になる: 拒否
  const narrower = baseConfig({ work_roots: ['src/**'] });
  r = run(tmp, ['amend', '--stdin'], JSON.stringify({ config: narrower, consent: '同意' }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a subset of the new work_roots/);
  // consent 欠落: 拒否
  r = run(tmp, ['amend', '--stdin'], JSON.stringify({ config: wider }));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /consent/);
  cleanup(tmp);
});
