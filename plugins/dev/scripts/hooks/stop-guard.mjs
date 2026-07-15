#!/usr/bin/env node
// Stop（§7 拡張版）:
// 1) 境界違反・整合性違反・成果物ハッシュ不一致が未解決なら停止をブロック（プロトタイプ移植）。
// 2) cursor が gate_open のとき、現在 gate card の検査集合（BEGIN/END マーカー + 全正規化行 +
//    全 [F-n] 行）が直近の assistant メッセージに行単位（trim 一致）で含まれるか検査する。
//    - 欠落 → block（欠落行を列挙）
//    - 全行提示 → attestation を logs/presented.jsonl に追記（approve/advance の機械的前提）
//    - 同一ゲート（同一 card）につき1回満たされれば以降のターンは免除
// 3) stop_hook_active: true は素通し（ブロック1回上限・ハング防止）。
import { existsSync, readFileSync } from 'node:fs';
import { readStdin, logHook, lastAssistantTextFromTranscript } from './hooklib.mjs';
import {
  readState, verifyAuditChain, boundaryScan, verifyArtifactHashes,
  cursorItem, gateCardRelPath, gateCardRequiredLines, hasValidAttestation,
  appendPresented, fileHash, repoRoot,
} from '../flow.mjs';
import { join } from 'node:path';

const input = await readStdin();
if (input?.stop_hook_active === true) process.exit(0); // ループ防止

const state = readState();
if (!state || state.status !== 'active') process.exit(0);

function block(reason) {
  logHook({ hook: 'stop-guard', decision: 'block', reason });
  process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
  process.exit(0);
}

// (1) 未解決の違反
const chain = verifyAuditChain(state.flow_id);
const bs = boundaryScan(state);
const ah = verifyArtifactHashes(state);
if (!chain.ok || !bs.ok || !ah.ok) {
  const parts = [];
  if (!chain.ok) parts.push(`integrity: ${chain.reason}`);
  if (!bs.ok) parts.push(`boundary: ${bs.violations.join(', ')}`);
  if (!ah.ok) parts.push(`artifact hash: ${ah.mismatches.join(', ')}`);
  block(`Unresolved flow violations before stop: ${parts.join('; ')}. Resolve them and re-check with the bookkeeper's \`status\`.`);
}

// (2) ゲート提示忠実性の機械検査
const ci = cursorItem(state);
if (ci && ci.status === 'gate_open') {
  const cardRel = gateCardRelPath(state, ci);
  const cardAbs = join(repoRoot(), cardRel);
  if (!existsSync(cardAbs)) {
    block(`gate is open but its gate card is missing: ${cardRel}. Run \`doctor\`; re-open the gate if needed.`);
  }
  const cardHash = fileHash(cardAbs);
  const att = hasValidAttestation(state, ci);
  if (att.ok) process.exit(0); // 同一ゲートにつき1回で足りる（以降のターンは免除）

  let msg = typeof input?.last_assistant_message === 'string' ? input.last_assistant_message : null;
  if (msg === null && typeof input?.transcript_path === 'string') {
    msg = lastAssistantTextFromTranscript(input.transcript_path);
  }
  if (msg === null) {
    block('cannot verify gate-card presentation: assistant message unavailable from both ' +
      'last_assistant_message and transcript_path. Present the gate card verbatim and end the turn again.');
  }
  const required = gateCardRequiredLines(readFileSync(cardAbs, 'utf8'));
  const msgLines = new Set(msg.split('\n').map(l => l.trim()));
  const missing = required.filter(l => !msgLines.has(l));
  if (missing.length) {
    block(`gate card presentation incomplete for ${ci.id} (r${ci.revision} seq=${ci.gate_seq}). ` +
      `Missing line(s):\n${missing.map(l => '  ' + l).join('\n')}\n` +
      `Present the gate card (${cardRel}) verbatim including these lines, then end the turn.`);
  }
  // 全行提示を確認 → attestation を記録（hook 専有領域）
  appendPresented(state.flow_id, {
    flow_id: state.flow_id, item: ci.id, revision: ci.revision,
    gate_seq: ci.gate_seq, gate_card_hash: cardHash, ts: new Date().toISOString(),
  });
  logHook({ hook: 'stop-guard', decision: 'attest', item: ci.id, revision: ci.revision, gate_seq: ci.gate_seq });
}
process.exit(0); // 正当な停止（承認待ち・質問など）は通す
