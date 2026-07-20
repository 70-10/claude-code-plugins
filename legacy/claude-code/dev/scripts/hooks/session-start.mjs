#!/usr/bin/env node
// SessionStart: startup|resume|clear|compact。アクティブなフローがあれば additionalContext を注入する。
import { readStdin } from './hooklib.mjs';
import { readState, cursorItem } from '../flow.mjs';

await readStdin();
const state = readState();
if (!state || state.status !== 'active') process.exit(0);

const ci = cursorItem(state);
const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT || '<plugin root>';
const context =
  `アクティブな開発フローがあります（flow_id=${state.flow_id}, cursor=${state.cursor}` +
  `${ci ? ' [' + ci.status + ']' : ''}）。ファイルに触る前に ` +
  `\`node "${pluginRoot}/scripts/flow.mjs" status\` を実行し、\`/dev:flow\` でフローを再開してください。` +
  `状態ファイル（.devflow/）を直接編集しないでください。`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
}) + '\n');
process.exit(0);
