// hook 単体テスト: 確認済みスキーマの JSON を stdin 投入し、allow 側と deny 側の両方を検証する。
// PreToolUse は JSON permissionDecision、PostToolUse は exit code/stderr、Stop は decision。
// Stop 入力のフィールドは §11-0 の実機確認どおり（last_assistant_message / transcript_path）。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, writeFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  setupRepo, run, initFlow, invokeHook, readState, approve, attest, item,
  writeDecomposeArtifacts, writeU1Code, reviewConfig, writeVerifyArtifacts,
  recordFindings, flowDir, gateCardPath,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }
function abs(tmp, rel) { return join(tmp, rel); }
function hooksLog(tmp) {
  const p = join(flowDir(tmp), 'logs', 'hooks.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}
function presented(tmp) {
  const p = join(flowDir(tmp), 'logs', 'presented.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
}
function assertPreDeny(r, reasonRe) {
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  if (reasonRe) assert.match(out.hookSpecificOutput.permissionDecisionReason, reasonRe);
}
function assertPreAllow(r) {
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '');
}

function initDecompose(tmp) { initFlow(tmp); }
function toU1(tmp) {
  initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  approve(tmp);
  run(tmp, ['advance']);
}

// ---- guard-write ----
test('guard-write: DENY product write during decompose', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, 'src/x.mjs'), content: 'x' } });
  assertPreDeny(r, /src\/x\.mjs/);
  assert.equal(hooksLog(tmp).at(-1).file_path, 'src/x.mjs');
  cleanup(tmp);
});
test('guard-write: DENY state writes always (state.json / current / memory.md / audit)', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  for (const rel of [
    '.devflow/flows/run1/state.json', '.devflow/flows/run1/audit.jsonl',
    '.devflow/current', '.devflow/memory.md',
    '.devflow/flows/run1/gate-cards/decompose-r1-1.md',
    '.devflow/flows/run1/logs/presented.jsonl',
  ]) {
    const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, rel), content: 'x' } });
    assertPreDeny(r, /bookkeeper/);
  }
  cleanup(tmp);
});
test('guard-write: DENY paths outside the 3 classifications (other) during a flow', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, 'random-notes.txt'), content: 'x' } });
  assertPreDeny(r, /outside the write scope/);
  cleanup(tmp);
});
test('guard-write: ALLOW in-scope artifact during decompose', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, '.devflow/flows/run1/artifacts/decompose/plan.md'), content: '# p' } });
  assertPreAllow(r);
  cleanup(tmp);
});
test('guard-write: ALLOW product write when implement:U1 in_progress; DENY outside unit globs', () => {
  const tmp = setupRepo(); toU1(tmp);
  assertPreAllow(invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, 'src/add.mjs'), content: 'x' } }));
  assertPreAllow(invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, '.devflow/flows/run1/artifacts/implement-U1/interpretations.md'), content: '暗黙の解釈なし' } }));
  assertPreDeny(invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, 'docs/readme.md'), content: 'x' } }), /outside the write scope/);
  cleanup(tmp);
});
test('guard-write: DENY new write when item is gate_open (frozen)', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, '.devflow/flows/run1/artifacts/decompose/plan.md'), content: 'changed' } });
  assertPreDeny(r, /frozen|gate/i);
  cleanup(tmp);
});
test('guard-write: DENY review artifacts even when review is in_progress (bookkeeper-only)', () => {
  const tmp = setupRepo();
  initFlow(tmp, { config: reviewConfig() });
  writeDecomposeArtifacts(tmp, { units: [{ id: 'U1', title: 'a', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**'] }] });
  run(tmp, ['gate-open']); approve(tmp); run(tmp, ['advance']);
  writeU1Code(tmp);
  run(tmp, ['gate-open']); approve(tmp); run(tmp, ['advance']);
  writeVerifyArtifacts(tmp);
  run(tmp, ['gate-open']); approve(tmp); run(tmp, ['advance']);
  assert.equal(readState(tmp).cursor, 'review');
  const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, '.devflow/flows/run1/artifacts/review/findings.md'), content: 'x' } });
  assertPreDeny(r, /bookkeeper/);
  cleanup(tmp);
});
test('guard-write: ALLOW when no active flow / after done', () => {
  const tmp = setupRepo();
  const r = invokeHook(tmp, 'guard-write.mjs', { tool_name: 'Write', tool_input: { file_path: abs(tmp, 'src/x.mjs'), content: 'x' } });
  assertPreAllow(r);
  cleanup(tmp);
});

// ---- guard-bash ----
test('guard-bash: DENY bash referencing .devflow/ (non flow.mjs)', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  const r = invokeHook(tmp, 'guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'cat .devflow/flows/run1/state.json' } });
  assertPreDeny(r, /flow\.mjs|\.devflow/);
  assert.equal(hooksLog(tmp).at(-1).hook, 'guard-bash');
  cleanup(tmp);
});
test('guard-bash: ALLOW flow.mjs invocation and unrelated bash', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  assertPreAllow(invokeHook(tmp, 'guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'node "/x/plugins/dev/scripts/flow.mjs" status' } }));
  assertPreAllow(invokeHook(tmp, 'guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'echo hello' } }));
  cleanup(tmp);
});
test('guard-bash: ALLOW when no active flow', () => {
  const tmp = setupRepo();
  assertPreAllow(invokeHook(tmp, 'guard-bash.mjs', { tool_name: 'Bash', tool_input: { command: 'rm -rf .devflow' } }));
  cleanup(tmp);
});

// ---- boundary-scan (PostToolUse) ----
test('boundary-scan: exit 0 when in-scope only; .devflow content never counts', () => {
  const tmp = setupRepo(); toU1(tmp);
  mkdirSync(join(tmp, 'src'), { recursive: true });
  writeFileSync(abs(tmp, 'src/add.mjs'), 'export const a=1;\n');
  writeFileSync(join(flowDir(tmp), 'stray.txt'), 'ignored\n'); // .devflow 配下は常に除外
  const r = invokeHook(tmp, 'boundary-scan.mjs', { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: {} });
  assert.equal(r.status, 0, r.stderr);
  cleanup(tmp);
});
test('boundary-scan: exit 2 warning when out-of-scope change exists', () => {
  const tmp = setupRepo(); toU1(tmp);
  writeFileSync(abs(tmp, 'evil.txt'), 'x\n');
  const r = invokeHook(tmp, 'boundary-scan.mjs', { tool_name: 'Bash', tool_input: { command: 'x' }, tool_response: {} });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /boundary-scan/);
  cleanup(tmp);
});

// ---- stop-guard ----
test('stop-guard: exit 0 when stop_hook_active true (loop guard)', () => {
  const tmp = setupRepo(); toU1(tmp);
  writeFileSync(abs(tmp, 'evil.txt'), 'x\n'); // violation present but must be ignored
  const r = invokeHook(tmp, 'stop-guard.mjs', { hook_event_name: 'Stop', stop_hook_active: true });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  cleanup(tmp);
});
test('stop-guard: block when unresolved boundary violation', () => {
  const tmp = setupRepo(); toU1(tmp);
  writeFileSync(abs(tmp, 'evil.txt'), 'x\n');
  const r = invokeHook(tmp, 'stop-guard.mjs', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'done' });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /boundary/);
  cleanup(tmp);
});
test('stop-guard: allow legitimate stop (in_progress, clean)', () => {
  const tmp = setupRepo(); toU1(tmp);
  const r = invokeHook(tmp, 'stop-guard.mjs', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: '質問があります' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  cleanup(tmp);
});
test('stop-guard: gate_open + incomplete presentation -> block listing missing lines', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  const r = invokeHook(tmp, 'stop-guard.mjs', {
    hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: 'ゲートを開きました。承認しますか？',
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /GATE-CARD BEGIN/);
  assert.equal(presented(tmp).length, 0, 'no attestation on failure');
  cleanup(tmp);
});
test('stop-guard: gate_open + full presentation -> attestation recorded, then later turns exempt', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  const card = readFileSync(gateCardPath(tmp), 'utf8');
  let r = invokeHook(tmp, 'stop-guard.mjs', {
    hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: `ゲート提示:\n${card}\nApprove / Request Changes?`,
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  const att = presented(tmp);
  assert.equal(att.length, 1);
  assert.equal(att[0].item, 'decompose');
  assert.equal(att[0].revision, 1);
  assert.equal(att[0].gate_seq, 1);
  assert.match(att[0].gate_card_hash, /^[0-9a-f]{64}$/);
  // 免除: 同一ゲートの以降のターンはカードを含まないメッセージでも素通し
  r = invokeHook(tmp, 'stop-guard.mjs', {
    hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: '明確化の質問: どちらの案がよいですか？',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  assert.equal(presented(tmp).length, 1, 'no duplicate attestation');
  cleanup(tmp);
});
test('stop-guard: re-gate-open (new seq) requires re-presentation', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  const card1 = readFileSync(gateCardPath(tmp), 'utf8');
  invokeHook(tmp, 'stop-guard.mjs', { hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: card1 });
  run(tmp, ['reject', '--stdin'], JSON.stringify({ feedback: 'x' }));
  run(tmp, ['gate-open']); // seq=2
  const r = invokeHook(tmp, 'stop-guard.mjs', {
    hook_event_name: 'Stop', stop_hook_active: false,
    last_assistant_message: card1, // 旧カードの提示では不足（seq が変わる）
  });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  cleanup(tmp);
});
test('stop-guard: falls back to transcript_path when last_assistant_message is absent', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  const card = readFileSync(gateCardPath(tmp), 'utf8');
  const transcript = join(mkdtempSync(join(tmpdir(), 'devflow-tr-')), 'transcript.jsonl');
  const entries = [
    { type: 'user', message: { role: 'user', content: 'x' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `提示:\n${card}` }] } },
  ];
  writeFileSync(transcript, entries.map(e => JSON.stringify(e)).join('\n') + '\n');
  const r = invokeHook(tmp, 'stop-guard.mjs', {
    hook_event_name: 'Stop', stop_hook_active: false, transcript_path: transcript,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(r.stdout.trim(), '');
  assert.equal(presented(tmp).length, 1, 'attestation via transcript fallback');
  cleanup(tmp);
});
test('stop-guard: blocks when assistant message unavailable from both routes', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  const r = invokeHook(tmp, 'stop-guard.mjs', { hook_event_name: 'Stop', stop_hook_active: false });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /assistant message unavailable/);
  cleanup(tmp);
});

// ---- session-start ----
test('session-start: injects additionalContext when flow active; silent otherwise', () => {
  const tmp = setupRepo(); initDecompose(tmp);
  let r = invokeHook(tmp, 'session-start.mjs', { hook_event_name: 'SessionStart', source: 'resume' });
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(out.hookSpecificOutput.additionalContext, /dev:flow/);
  cleanup(tmp);
  const tmp2 = setupRepo();
  r = invokeHook(tmp2, 'session-start.mjs', { hook_event_name: 'SessionStart', source: 'startup' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  cleanup(tmp2);
});
