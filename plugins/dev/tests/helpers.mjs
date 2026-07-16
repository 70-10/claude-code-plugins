// テスト共通ヘルパー: 一時 git リポジトリを組み、bookkeeper を subprocess で駆動する。
import {
  mkdtempSync, mkdirSync, writeFileSync, appendFileSync, readFileSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PLUGIN_ROOT = join(HERE, '..');
export const FLOW_MJS = join(PLUGIN_ROOT, 'scripts', 'flow.mjs');
export const HOOKS_DIR = join(PLUGIN_ROOT, 'scripts', 'hooks');

export function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' });
}

export function sha256(buf) { return createHash('sha256').update(buf).digest('hex'); }

// init 可能な git リポジトリを作る。dir 省略時は一時ディレクトリ。
export function setupRepo(dir) {
  const tmp = dir || mkdtempSync(join(tmpdir(), 'devflow-test-'));
  writeFileSync(join(tmp, 'SPEC.md'), '# spec\nadd / list / done\n');
  git(tmp, ['init', '-q']);
  git(tmp, ['config', 'user.name', 't']);
  git(tmp, ['config', 'user.email', 't@t']);
  git(tmp, ['add', '-A']);
  git(tmp, ['commit', '-qm', 'base']);
  return tmp;
}

// bookkeeper verb を実行。CLAUDE_PROJECT_DIR と cwd を tmp に固定。
// NODE_TEST_CONTEXT を除去する（gate-open が spawn する check が親の test context を
// 継承すると実運用と挙動が変わり false-green を生むため）。
export function run(tmp, args, stdin) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: tmp };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('node', [FLOW_MJS, ...args], {
    cwd: tmp, encoding: 'utf8', env, input: stdin,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// hook を stdin JSON で起動。
export function invokeHook(tmp, hook, payload) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: tmp, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync('node', [join(HOOKS_DIR, hook)], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: tmp, env,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

// ---------------------------------------------------------------------------
// config / init
// ---------------------------------------------------------------------------

export const WORK_ROOTS = ['src/**', 'test/**', 'package.json'];

export function baseConfig(overrides = {}) {
  return {
    schema: 1,
    work_roots: [...WORK_ROOTS],
    stages: [
      { id: 'decompose', kind: 'stage', check: 'flow:plan-lint' },
      { id: '__implement__', kind: 'implement_placeholder' },
      { id: 'verify', kind: 'stage', artifacts: ['report.md'], check: 'node --test test/*.test.mjs' },
    ],
    ...overrides,
  };
}

export function reviewConfig(overrides = {}) {
  const c = baseConfig(overrides);
  if (!c.stages.some(s => s.kind === 'review')) {
    c.stages = [...c.stages, { id: 'review', kind: 'review' }];
  }
  return c;
}

export function initFlow(tmp, { flowId = 'run1', config = baseConfig(), spec = 'SPEC.md', intent = 'テスト用タスク', consent = 'この構成で開始してください' } = {}) {
  const payload = { config, intent, flow_id: flowId, consent };
  if (spec) payload.spec_path = spec;
  return run(tmp, ['init', '--stdin'], JSON.stringify(payload));
}

// ---------------------------------------------------------------------------
// state / audit の読み出し
// ---------------------------------------------------------------------------

export function flowDir(tmp, id = 'run1') { return join(tmp, '.devflow', 'flows', id); }
export function currentId(tmp) {
  const p = join(tmp, '.devflow', 'current');
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8').trim() || null;
}
export function readState(tmp, id = 'run1') {
  return JSON.parse(readFileSync(join(flowDir(tmp, id), 'state.json'), 'utf8'));
}
export function readAudit(tmp, id = 'run1') {
  const p = join(flowDir(tmp, id), 'audit.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
export function events(tmp, id = 'run1') {
  return readAudit(tmp, id).map(l => l.event);
}
export function item(tmp, id, flowId = 'run1') {
  return readState(tmp, flowId).items.find(i => i.id === id);
}

// ---------------------------------------------------------------------------
// 成果物の書き込み（テストは fs 直書きで業務 skill を代行する）
// ---------------------------------------------------------------------------

export const VALID_PLAN = {
  units: [
    { id: 'U1', title: 'add', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**', 'package.json'] },
    { id: 'U2', title: 'list', check: 'node --test test/list.test.mjs', write_globs: ['src/**', 'test/**'] },
  ],
};

export function artDir(tmp, itemId, flowId = 'run1') {
  return join(flowDir(tmp, flowId), 'artifacts', itemId.replace(/:/g, '-'));
}

export function writeInterp(tmp, itemId, text = '暗黙の解釈なし\n', flowId = 'run1') {
  const dir = artDir(tmp, itemId, flowId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'interpretations.md'), text);
}

export function writeDecomposeArtifacts(tmp, plan = VALID_PLAN, flowId = 'run1') {
  const dir = artDir(tmp, 'decompose', flowId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plan.md'), '# plan\nsplit into units for reasons.\n');
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan, null, 2));
  writeInterp(tmp, 'decompose', '暗黙の解釈なし\n', flowId);
}

export function writeVerifyArtifacts(tmp, flowId = 'run1') {
  const dir = artDir(tmp, 'verify', flowId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'report.md'), '# report\nall specs covered by tests.\n');
  writeInterp(tmp, 'verify', '暗黙の解釈なし\n', flowId);
}

// U1 の製品コード（add + storage）。テストは一時ファイルを使い pass する。
export function writeU1Code(tmp, flowId = 'run1') {
  mkdirSync(join(tmp, 'src'), { recursive: true });
  mkdirSync(join(tmp, 'test'), { recursive: true });
  writeInterp(tmp, 'implement:U1', '暗黙の解釈なし\n', flowId);
  writeFileSync(join(tmp, 'src', 'add.mjs'), `import { readFileSync, writeFileSync, existsSync } from 'node:fs';
export function load(f){ return existsSync(f)?JSON.parse(readFileSync(f,'utf8')):[]; }
export function add(f,text){ if(!text) throw new Error('empty'); const items=load(f); const id=(items.at(-1)?.id||0)+1; items.push({id,text,done:false}); writeFileSync(f,JSON.stringify(items)); return id; }
`);
  writeFileSync(join(tmp, 'test', 'add.test.mjs'), `import { test } from 'node:test'; import assert from 'node:assert';
import { add, load } from '../src/add.mjs';
import { mkdtempSync } from 'node:fs'; import { join } from 'node:path'; import { tmpdir } from 'node:os';
test('add', ()=>{ const f=join(mkdtempSync(join(tmpdir(),'x')),'db.json'); assert.equal(add(f,'a'),1); assert.equal(load(f)[0].text,'a'); });
`);
}

export function writeU2Code(tmp, flowId = 'run1') {
  writeFileSync(join(tmp, 'src', 'list.mjs'), 'export function list(){ return []; }\n');
  writeFileSync(join(tmp, 'test', 'list.test.mjs'),
    "import { test } from 'node:test'; import assert from 'node:assert';\nimport { list } from '../src/list.mjs';\ntest('list', ()=>{ assert.deepEqual(list(),[]); });\n");
  writeInterp(tmp, 'implement:U2', '暗黙の解釈なし\n', flowId);
}

// ---------------------------------------------------------------------------
// attestation / 承認ヘルパー
// ---------------------------------------------------------------------------

export function gateCardPath(tmp, flowId = 'run1') {
  const st = readState(tmp, flowId);
  const ci = st.items.find(i => i.id === st.cursor);
  return join(flowDir(tmp, flowId), 'gate-cards',
    `${ci.id.replace(/:/g, '-')}-r${ci.revision}-${ci.gate_seq}.md`);
}

// stop-guard が書く attestation をフィクスチャとして直接記録する
// （stop-guard 自身の記録経路は hooks.test.mjs が検証する）。
export function attest(tmp, flowId = 'run1') {
  const st = readState(tmp, flowId);
  const ci = st.items.find(i => i.id === st.cursor);
  const card = gateCardPath(tmp, flowId);
  const entry = {
    flow_id: flowId, item: ci.id, revision: ci.revision, gate_seq: ci.gate_seq,
    gate_card_hash: sha256(readFileSync(card)), ts: new Date().toISOString(),
  };
  const logs = join(flowDir(tmp, flowId), 'logs');
  mkdirSync(logs, { recursive: true });
  appendFileSync(join(logs, 'presented.jsonl'), JSON.stringify(entry) + '\n');
  return entry;
}

export function approve(tmp, input = '承認します', flowId = 'run1') {
  attest(tmp, flowId);
  return run(tmp, ['approve', '--stdin'], JSON.stringify({ input }));
}

// decompose を承認まで進めた状態にする。
export function upToDecomposeApproved(tmp, plan = VALID_PLAN, config = baseConfig()) {
  initFlow(tmp, { config });
  writeDecomposeArtifacts(tmp, plan);
  run(tmp, ['gate-open']);
  approve(tmp);
}

// implement:U1 が in_progress の状態にする。
export function toU1(tmp, plan = VALID_PLAN, config = baseConfig()) {
  upToDecomposeApproved(tmp, plan, config);
  run(tmp, ['advance']);
}

// review triage 用: findings を記録する。
export function recordFindings(tmp, findings, extras = {}) {
  return run(tmp, ['findings-record', '--stdin'], JSON.stringify({
    findings,
    findings_md: extras.findings_md || '# findings\n' + (findings.length ? findings.map(f => `- ${f.id} ${f.severity}: ${f.claim}`).join('\n') : '- なし') + '\n',
    interpretations_md: extras.interpretations_md || '暗黙の解釈なし\n',
  }));
}
