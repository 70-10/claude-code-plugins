// 提示済み attestation（§7）: attestation なしの approve/advance 拒否・記録後の成立・
// card ハッシュ不一致の拒否。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, attest, approve,
  writeDecomposeArtifacts, flowDir, gateCardPath, sha256,
} from './helpers.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }

function openDecomposeGate(tmp) {
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
}

test('approve FAIL without attestation; passes after attestation', () => {
  const tmp = setupRepo();
  openDecomposeGate(tmp);
  let r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has not been presented/);
  attest(tmp);
  r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 0, r.stderr);
  cleanup(tmp);
});

test('advance FAIL without attestation even when APPROVED exists', () => {
  const tmp = setupRepo();
  openDecomposeGate(tmp);
  approve(tmp); // attest + approve
  // attestation ログを消す（hook 専有ファイルの喪失を模す）
  writeFileSync(join(flowDir(tmp), 'logs', 'presented.jsonl'), '');
  const r = run(tmp, ['advance']);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has not been presented/);
  cleanup(tmp);
});

test('attestation is revision/seq/hash-bound: stale attestation does not satisfy a re-opened gate', () => {
  const tmp = setupRepo();
  openDecomposeGate(tmp);
  attest(tmp); // seq=1 に対する attestation
  run(tmp, ['reject', '--stdin'], JSON.stringify({ feedback: '直して' }));
  run(tmp, ['gate-open']); // seq=2 の新カード
  const r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 2, 'old-seq attestation must not satisfy the new gate');
  assert.match(r.stderr, /has not been presented/);
  cleanup(tmp);
});

test('attestation with mismatching card hash is refused', () => {
  const tmp = setupRepo();
  openDecomposeGate(tmp);
  // 偽の attestation（ハッシュ不一致）を直接書き込んでも成立しない
  const st = readState(tmp);
  appendFileSync(join(flowDir(tmp), 'logs', 'presented.jsonl'), JSON.stringify({
    flow_id: 'run1', item: 'decompose', revision: 1, gate_seq: 1,
    gate_card_hash: 'deadbeef'.repeat(8), ts: new Date().toISOString(),
  }) + '\n');
  let r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has not been presented/);
  // 正しい attestation の後にカードファイルを改竄すると、approve は不成立になる
  attest(tmp);
  const card = gateCardPath(tmp);
  writeFileSync(card, readFileSync(card, 'utf8') + '\n<!-- tampered -->\n');
  r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has not been presented/);
  cleanup(tmp);
});

test('broken lines in presented.jsonl are ignored (not a crash, not an attestation)', () => {
  const tmp = setupRepo();
  openDecomposeGate(tmp);
  const logs = join(flowDir(tmp), 'logs');
  appendFileSync(join(logs, 'presented.jsonl'), 'not-json\n');
  const r = run(tmp, ['approve', '--stdin'], JSON.stringify({ input: '承認します' }));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /has not been presented/);
  cleanup(tmp);
});
