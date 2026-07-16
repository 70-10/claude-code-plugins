// S1/S2/S4 相当の不変条件検査（§11-2）: 実 E2E 出力に対して pass、
// 意図的に壊したコピーに対して fail の両側を確認する（自作フィクスチャで pass させない）。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildE2E, FLOW_ID } from './e2e-flow.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECKS = join(HERE, 'checks');

function runCheck(script, args) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  const r = spawnSync('node', [join(CHECKS, script), ...args], { encoding: 'utf8', env });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function copyDir(src) {
  const dst = mkdtempSync(join(tmpdir(), 'devflow-copy-'));
  cpSync(src, dst, { recursive: true });
  return dst;
}
function auditPath(dir) { return join(dir, '.devflow', 'flows', FLOW_ID, 'audit.jsonl'); }
function statePath(dir) { return join(dir, '.devflow', 'flows', FLOW_ID, 'state.json'); }
function editAudit(dir, fn) {
  const lines = readFileSync(auditPath(dir), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
  const out = fn(lines);
  writeFileSync(auditPath(dir), out.map(l => JSON.stringify(l)).join('\n') + '\n');
}
function editState(dir, fn) {
  const st = JSON.parse(readFileSync(statePath(dir), 'utf8'));
  fn(st);
  writeFileSync(statePath(dir), JSON.stringify(st, null, 2) + '\n');
}

let BASE; // 実 E2E 出力（pass 側の土台）
test.before(() => { BASE = mkdtempSync(join(tmpdir(), 'devflow-base-')); buildE2E(BASE); });
test.after(() => { rmSync(BASE, { recursive: true, force: true }); });

test('check-s1: PASS on real E2E output', () => {
  const r = runCheck('check-s1.mjs', ['--dir', BASE]);
  assert.equal(r.status, 0, r.out);
});
test('check-s1: FAIL on tampered audit (broken chain)', () => {
  const d = copyDir(BASE);
  editAudit(d, (lines) => { lines[1].data.tampered = true; return lines; });
  const r = runCheck('check-s1.mjs', ['--dir', d]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL \[S1\] audit chain/);
  rmSync(d, { recursive: true, force: true });
});
test('check-s1: FAIL when a Save Point commit escapes write_globs', () => {
  const d = copyDir(BASE);
  editState(d, (st) => { st.items.find(i => i.id === 'implement:U1').write_globs = ['test/**']; });
  const r = runCheck('check-s1.mjs', ['--dir', d]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL \[S1\] \(d\)/);
  rmSync(d, { recursive: true, force: true });
});
test('check-s1: FAIL when an APPROVED lacks a presented attestation', () => {
  const d = copyDir(BASE);
  writeFileSync(join(d, '.devflow', 'flows', FLOW_ID, 'logs', 'presented.jsonl'), '');
  const r = runCheck('check-s1.mjs', ['--dir', d]);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL \[S1\] \(f\)/);
  rmSync(d, { recursive: true, force: true });
});

test('check-s2: PASS on real E2E output (resume-item = implement:U1)', () => {
  const r = runCheck('check-s2.mjs', ['--dir', BASE, '--resume-item', 'implement:U1']);
  assert.equal(r.status, 0, r.out);
});
test('check-s2: FAIL when a done item is re-advanced in the same revision', () => {
  const d = copyDir(BASE);
  editAudit(d, (lines) => {
    lines.push({ seq: 999, ts: 'x', event: 'ADVANCED', item: 'implement:U1', data: { revision: 1 }, prev_hash: 'x', state_hash: 'x' });
    return lines;
  });
  const r = runCheck('check-s2.mjs', ['--dir', d, '--resume-item', 'implement:U1']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL \[S2\] \(1\)/);
  rmSync(d, { recursive: true, force: true });
});

test('check-s4: PASS on real E2E output', () => {
  const r = runCheck('check-s4.mjs', ['--dir', BASE,
    '--ambiguous', 'いいんじゃない', '--ambiguous', 'うーん、微妙かも',
    '--delegation', '全部まとめて進めて']);
  assert.equal(r.status, 0, r.out);
});
test('check-s4: FAIL (S4a) when an ambiguous phrase counted as approval', () => {
  const d = copyDir(BASE);
  editState(d, (st) => { st.approvals[0].verbatim = 'いいんじゃない'; });
  const r = runCheck('check-s4.mjs', ['--dir', d, '--ambiguous', 'いいんじゃない']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL \[S4\] S4a/);
  rmSync(d, { recursive: true, force: true });
});
test('check-s4: FAIL (S4b) when a gate after delegation lacks approval', () => {
  const d = copyDir(BASE);
  editAudit(d, (lines) => lines.filter(l => !(l.event === 'APPROVED' && l.item === 'verify')));
  const r = runCheck('check-s4.mjs', ['--dir', d, '--delegation', '全部まとめて進めて']);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /FAIL \[S4\] S4b/);
  rmSync(d, { recursive: true, force: true });
});
