#!/usr/bin/env node
// PostToolUse: Bash。境界スキャン + 成果物ハッシュ検証を実行し、違反があれば exit 2 で警告。
// PostToolUse はツールをブロックしない仕様のためフィードバックのみ。恒久的な拒否は次の verb が行う。
// 境界スキャンは .devflow/** を常に除外する（§3）。
import { readStdin, logHook } from './hooklib.mjs';
import { readState, boundaryScan, verifyArtifactHashes } from '../flow.mjs';

await readStdin();
const state = readState();
if (!state || state.status !== 'active') process.exit(0);

const bs = boundaryScan(state);
const ah = verifyArtifactHashes(state);

if (!bs.ok || !ah.ok) {
  const parts = [];
  if (!bs.ok) parts.push(`out-of-scope changes: ${bs.violations.join(', ')}`);
  if (!ah.ok) parts.push(`artifact hash mismatch: ${ah.mismatches.join(', ')}`);
  logHook({ hook: 'boundary-scan', decision: 'warn', reason: parts.join('; '), violations: bs.violations, mismatches: ah.mismatches });
  process.stderr.write(
    `FLOW WARN [boundary-scan]\n` +
    `What: ${parts.join('; ')}.\n` +
    `Why:  changes fell outside the current item's write scope, or a gate artifact changed after the gate opened.\n` +
    `How:  Revert the out-of-scope change before the next flow verb; the bookkeeper will otherwise refuse to proceed.\n`);
  process.exit(2);
}
process.exit(0);
