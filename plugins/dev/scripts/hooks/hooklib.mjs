// hook 共通ヘルパー。hook は state/audit を書かず、deny の記録は
// flows/<id>/logs/hooks.jsonl にのみ追記する（presented.jsonl は stop-guard 専用）。
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { currentFlowId, flowPaths } from '../flow.mjs';

export async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  const s = Buffer.concat(chunks).toString('utf8').trim();
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

export function logHook(entry) {
  try {
    const id = currentFlowId();
    if (!id) return;
    const { logs, hooksLog } = flowPaths(id);
    mkdirSync(logs, { recursive: true });
    appendFileSync(hooksLog, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch { /* ログ失敗で hook を落とさない */ }
}

// PreToolUse の deny は JSON 出力を正とする（exit 0 で permissionDecision:deny を stdout に）。
export function denyPreToolUse(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }) + '\n');
  process.exit(0);
}

// Stop 入力の transcript_path から最後の assistant テキストを抽出する
// （last_assistant_message が無い場合の fallback）。
export function lastAssistantTextFromTranscript(path) {
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      let o;
      try { o = JSON.parse(lines[i]); } catch { continue; }
      if (o.type !== 'assistant' || o.isSidechain) continue;
      const content = o.message && o.message.content;
      if (!Array.isArray(content)) continue;
      const texts = content.filter(c => c && c.type === 'text' && typeof c.text === 'string').map(c => c.text);
      if (texts.length) return texts.join('\n');
    }
  } catch { /* 読めない場合は null */ }
  return null;
}
