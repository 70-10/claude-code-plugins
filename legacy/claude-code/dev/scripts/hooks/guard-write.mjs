#!/usr/bin/env node
// PreToolUse: Edit|Write|MultiEdit|NotebookEdit。
// active なフローがあるときだけ判定する。cursor の item が in_progress かつ
// path が許可 glob 内（かつ state 区分でない）の場合のみ許可、それ以外は deny。
// 3区分のいずれにも該当しないパスもフロー実行中はすべて deny（§3 の汎用化）。
import { readStdin, logHook, denyPreToolUse } from './hooklib.mjs';
import { readState, cursorItem, classifyPath, matchAny, toRel } from '../flow.mjs';

const input = await readStdin();
const fp = input?.tool_input?.file_path;

const state = readState();
if (!state || state.status !== 'active') process.exit(0); // フロー未実行/完了時は干渉しない
if (!fp) process.exit(0);

const rel = toRel(fp);
const cls = classifyPath(rel, state);
const ci = cursorItem(state);
const allowed = cls !== 'state' &&
  ci && ci.status === 'in_progress' && matchAny(rel, ci.write_globs);

if (allowed) process.exit(0);

const why = cls === 'state'
  ? 'flow state files (.devflow/** outside the current item\'s artifact dir) are written only by the bookkeeper'
  : ci && ci.status !== 'in_progress'
    ? `the current item "${ci.id}" is "${ci.status}"; new writes are frozen until it advances`
    : `"${rel}" (${cls}) is outside the write scope of the current item "${ci ? ci.id : '(none)'}"`;

logHook({
  hook: 'guard-write', decision: 'deny', tool: input.tool_name, file_path: rel,
  classification: cls, cursor: ci ? ci.id : null, cursor_status: ci ? ci.status : null, reason: why,
});

denyPreToolUse(
  `What: write to "${rel}" was blocked. ` +
  `Why: ${why}. ` +
  `How: run the bookkeeper's \`status\` verb to see the current item and its allowed paths.`);
