#!/usr/bin/env node
// PreToolUse: Bash。command が .devflow/ 配下を参照し、かつ flow.mjs 呼び出しでない場合 deny。
// 保守的な Trust Boundary として読み取り用途も拒否する（artifacts の読み取りは Read ツールで行う）。
// deny は JSON 出力（permissionDecision:deny, exit 0）。判定入力は tool_input.command のみ。
import { readStdin, logHook, denyPreToolUse } from './hooklib.mjs';
import { readState } from '../flow.mjs';

const input = await readStdin();
const cmd = input?.tool_input?.command || '';

const state = readState();
if (!state || state.status !== 'active') process.exit(0);

const touchesFlow = /\.devflow\b/.test(cmd) || cmd.includes('.devflow/');
const isFlowTool = /flow\.mjs/.test(cmd);

if (touchesFlow && !isFlowTool) {
  logHook({ hook: 'guard-bash', decision: 'deny', tool: 'Bash', command: cmd, reason: 'bash referenced .devflow/ without going through flow.mjs' });
  denyPreToolUse(
    `What: this Bash command references .devflow/ directly. ` +
    `Why: the flow state/artifacts are managed only via the bookkeeper (flow.mjs); read artifacts with the Read tool. ` +
    `How: use the bookkeeper (\`node "<plugin>/scripts/flow.mjs" <verb>\`) for state, and the Read tool for artifact contents.`);
}
process.exit(0);
