// E2E ドライラン: ミニフロー完走と、audit チェーン・成果物ハッシュ・Save Point の整合。
import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { buildE2E, FLOW_ID } from './e2e-flow.mjs';
import { readState, readAudit, git, currentId } from './helpers.mjs';

function sha256(b) { return createHash('sha256').update(b).digest('hex'); }
function stable(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}

test('E2E dry-run completes with consistent chain / hashes / save points', () => {
  const dir = mkdtempSync(join(tmpdir(), 'devflow-e2e-'));
  buildE2E(dir);
  const st = readState(dir, FLOW_ID);

  // 完走（current はクリア）
  assert.equal(st.status, 'done');
  assert.equal(currentId(dir), null);
  for (const it of st.items) {
    assert.equal(it.status, 'done', `${it.id} should be done`);
    assert.ok(it.save_point, `${it.id} should have a save_point`);
  }

  // audit チェーン全行再計算
  const lines = readAudit(dir, FLOW_ID);
  const GEN = '0'.repeat(64);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    assert.equal(l.prev_hash, i === 0 ? GEN : lines[i - 1].state_hash, `chain break at seq ${l.seq}`);
    const body = stable({ seq: l.seq, ts: l.ts, event: l.event, item: l.item, data: l.data });
    assert.equal(l.state_hash, sha256(l.prev_hash + '|' + body), `state_hash mismatch at seq ${l.seq}`);
  }
  // 末尾行の記録 state ハッシュが現 state.json と一致
  assert.equal(lines.at(-1).data.state,
    sha256(readFileSync(join(dir, '.devflow', 'flows', FLOW_ID, 'state.json'))));

  // 成果物ハッシュが記録され、現内容と一致
  for (const id of ['decompose', 'verify', 'review']) {
    const it = st.items.find(i => i.id === id);
    assert.ok(it.artifact_hashes.length > 0, `${id} should have artifact hashes`);
    for (const h of it.artifact_hashes) {
      assert.equal(sha256(readFileSync(join(dir, h.path))), h.sha256, `${h.path} hash should match`);
    }
  }

  // implement:U1 の Save Point コミットは write_globs 内のみ
  const u1 = st.items.find(i => i.id === 'implement:U1');
  const files = git(dir, ['show', '--name-only', '--pretty=format:', u1.save_point]).stdout.trim().split('\n').filter(Boolean);
  assert.deepEqual(files.sort(), ['src/add.mjs', 'test/add.test.mjs'].sort());

  // 全 approve/advance に対応する提示済み attestation が存在する
  const pres = readFileSync(join(dir, '.devflow', 'flows', FLOW_ID, 'logs', 'presented.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map(l => JSON.parse(l));
  for (const gated of ['decompose', 'implement:U1', 'verify', 'review']) {
    assert.ok(pres.some(p => p.item === gated), `attestation for ${gated}`);
  }
  rmSync(dir, { recursive: true, force: true });
});
