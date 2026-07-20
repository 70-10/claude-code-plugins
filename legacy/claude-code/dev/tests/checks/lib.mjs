// S チェック共通ヘルパー。対象ディレクトリ（.devflow と git を含む worktree）を
// 引数で受け取り、flows/<id>/ の audit.jsonl・state.json・logs/hooks.jsonl を読む。
// flow id は --flow、無ければ current、無ければ flows/ 配下の唯一のディレクトリ。
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export function parseDir(argv) {
  const i = argv.indexOf('--dir');
  return i >= 0 ? argv[i + 1] : process.cwd();
}
export function detectFlowId(dir, argv = process.argv) {
  const i = argv.indexOf('--flow');
  if (i >= 0) return argv[i + 1];
  const cur = join(dir, '.devflow', 'current');
  if (existsSync(cur)) {
    const id = readFileSync(cur, 'utf8').trim();
    if (id) return id;
  }
  const flows = join(dir, '.devflow', 'flows');
  const entries = existsSync(flows) ? readdirSync(flows) : [];
  if (entries.length === 1) return entries[0];
  throw new Error(`cannot detect flow id in ${dir} (candidates: ${entries.join(', ')}) — pass --flow <id>`);
}
export function flowDir(dir, flowId) { return join(dir, '.devflow', 'flows', flowId); }
export function readAudit(dir, flowId) {
  const p = join(flowDir(dir, flowId), 'audit.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
export function readState(dir, flowId) {
  return JSON.parse(readFileSync(join(flowDir(dir, flowId), 'state.json'), 'utf8'));
}
export function readHooksLog(dir, flowId) {
  const p = join(flowDir(dir, flowId), 'logs', 'hooks.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
export function readPresented(dir, flowId) {
  const p = join(flowDir(dir, flowId), 'logs', 'presented.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
export function git(dir, args) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim() };
}
export function report(name, results) {
  const failures = results.filter(r => !r.ok);
  for (const r of results) process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'} [${name}] ${r.label}${r.detail ? ': ' + r.detail : ''}\n`);
  if (failures.length) { process.stdout.write(`${name}: FAIL (${failures.length})\n`); process.exit(1); }
  process.stdout.write(`${name}: PASS\n`);
}
