#!/usr/bin/env node
// bookkeeper: dev plugin の状態管理・共通ガード・verb 契約。
// 依存パッケージなし（node: 標準モジュールのみ）。CLI としても、hook からの
// import ライブラリとしても使う。共通ガード（境界スキャン・成果物ハッシュ検証・
// 監査チェーン整合）は本ファイルに一元化し、hook はここから import する。
//
// 人間由来の自由文（consent / feedback / verbatim 等）はすべて JSON stdin
// （--stdin）で受け取る。シェル引数に自由文を渡す経路は存在しない。

import { createHash } from 'node:crypto';
import {
  existsSync, readFileSync, writeFileSync, appendFileSync,
  mkdirSync, statSync, realpathSync, rmSync, copyFileSync,
} from 'node:fs';
import { join, resolve, relative, isAbsolute, basename, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// 定数・パス
// ---------------------------------------------------------------------------

export const GENESIS = '0'.repeat(64);
export const DEVFLOW = '.devflow';
const PROTECTED_PREFIXES = ['.devflow', '.claude', '.git'];
const GITIGNORE_CONTENT = '*\n!.gitignore\n!memory.md\n';
export const NO_INTERPRETATIONS = '暗黙の解釈なし';

export function repoRoot() {
  return process.env.CLAUDE_PROJECT_DIR || process.cwd();
}
function P(...seg) { return join(repoRoot(), ...seg); }

export function devflowPaths() {
  return {
    root: P(DEVFLOW),
    gitignore: P(DEVFLOW, '.gitignore'),
    memory: P(DEVFLOW, 'memory.md'),
    current: P(DEVFLOW, 'current'),
    flows: P(DEVFLOW, 'flows'),
  };
}

export function currentFlowId() {
  const { current } = devflowPaths();
  if (!existsSync(current)) return null;
  const id = readFileSync(current, 'utf8').trim();
  return id || null;
}

export function flowDirRel(id) { return `${DEVFLOW}/flows/${id}`; }

export function flowPaths(id) {
  const rel = flowDirRel(id);
  return {
    rel,
    dir: P(rel),
    config: P(rel, 'flow-config.json'),
    state: P(rel, 'state.json'),
    audit: P(rel, 'audit.jsonl'),
    evidence: P(rel, 'evidence'),
    artifacts: P(rel, 'artifacts'),
    gateCards: P(rel, 'gate-cards'),
    review: P(rel, 'review'),
    logs: P(rel, 'logs'),
    hooksLog: P(rel, 'logs', 'hooks.jsonl'),
    presented: P(rel, 'logs', 'presented.jsonl'),
  };
}

// ---------------------------------------------------------------------------
// ハッシュ・安定シリアライズ
// ---------------------------------------------------------------------------

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}
export function fileHash(absPath) {
  return sha256(readFileSync(absPath));
}
// キーを再帰的にソートした決定的な JSON 文字列（ハッシュ入力用）。
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// ---------------------------------------------------------------------------
// glob マッチ（** と * のみ対応。依存なし）
// ---------------------------------------------------------------------------

export function globToRegex(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; }
      else re += '[^/]*';
    } else if ('.+?^${}()|[]\\/'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}
export function matchGlob(path, glob) { return globToRegex(glob).test(path); }
export function matchAny(path, globs) { return (globs || []).some(g => matchGlob(path, g)); }

// ---------------------------------------------------------------------------
// glob の禁止条件と work_roots 部分集合検査（§3）
// ---------------------------------------------------------------------------

// glob の静的接頭辞（最初のワイルドカードより前の部分）。
export function staticPrefix(glob) {
  const i = glob.indexOf('*');
  return i < 0 ? glob : glob.slice(0, i);
}

// work_roots / write_globs 共通の禁止条件。違反理由の配列を返す（空 = OK）。
export function globErrors(g, label = 'glob') {
  const errors = [];
  if (typeof g !== 'string' || g.trim() === '') return [`${label}: must be a non-empty string`];
  if (g.includes('\\')) errors.push(`${label} "${g}": backslashes are not allowed`);
  if (isAbsolute(g) || g.startsWith('/')) errors.push(`${label} "${g}": absolute paths are not allowed`);
  if (g.split('/').some(seg => seg === '..')) errors.push(`${label} "${g}": ".." segments are not allowed`);
  if (g === '**' || g === '*') errors.push(`${label} "${g}": bare wildcard is not allowed`);
  if (/^\*/.test(g)) errors.push(`${label} "${g}": wildcard-leading globs are not allowed`);
  for (const p of PROTECTED_PREFIXES) {
    if (g === p || g.startsWith(p + '/') ||
        matchGlob(p, g) || matchGlob(p + '/x', g) || matchGlob(p + '/x/y', g)) {
      errors.push(`${label} "${g}": touches protected path "${p}/"`);
      break;
    }
  }
  return errors;
}

// unit glob が work_roots の部分集合か（保守的判定）:
// (a) いずれかの work_root と完全一致、または
// (b) 静的接頭辞が「/** で終わる work_root」の静的接頭辞配下にある。
export function isSubsetOfWorkRoots(unitGlob, workRoots) {
  for (const wr of workRoots || []) {
    if (unitGlob === wr) return true;
    if (wr.endsWith('/**')) {
      const rootPrefix = wr.slice(0, -3);
      const up = staticPrefix(unitGlob).replace(/\/$/, '');
      if (up === rootPrefix || up.startsWith(rootPrefix + '/')) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// パス分類（§3 の3区分）
// ---------------------------------------------------------------------------

// 'state' | 'artifact' | 'product' | 'other'
// review stage の artifacts は bookkeeper 専有のため state として扱う。
export function classifyPath(rel, state) {
  rel = rel.replace(/^\.\//, '');
  if (rel === DEVFLOW || rel.startsWith(DEVFLOW + '/')) {
    if (state) {
      const artPrefix = `${flowDirRel(state.flow_id)}/artifacts/`;
      if (rel.startsWith(artPrefix)) {
        const slug = rel.slice(artPrefix.length).split('/')[0];
        const reviewSlugs = state.items.filter(i => i.kind === 'review').map(i => itemSlug(i.id));
        if (reviewSlugs.includes(slug)) return 'state';
        return 'artifact';
      }
    }
    return 'state';
  }
  if (state && matchAny(rel, state.work_roots || [])) return 'product';
  return 'other';
}

// 存在する最長の接頭辞を realpath し、存在しない末尾はそのまま連結する。
function safeReal(p) {
  let cur = p; const tail = [];
  while (cur && !existsSync(cur)) {
    tail.unshift(basename(cur));
    const par = dirname(cur);
    if (par === cur) break;
    cur = par;
  }
  try { const r = realpathSync(cur); return tail.length ? join(r, ...tail) : r; }
  catch { return p; }
}

// リポジトリルート相対パスへ正規化（symlink 実体で突き合わせる）。
export function toRel(p) {
  const rootRaw = repoRoot();
  const root = safeReal(rootRaw);
  const absRaw = isAbsolute(p) ? p : resolve(rootRaw, p);
  const abs = safeReal(absRaw);
  let rel = relative(root, abs);
  return rel.split('\\').join('/');
}

// ---------------------------------------------------------------------------
// git ヘルパー
// ---------------------------------------------------------------------------

function git(args) {
  const r = spawnSync('git', args, { cwd: repoRoot(), encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

// ---------------------------------------------------------------------------
// state / audit の入出力（current -> flows/<id>/ 経由で現在フローを解決）
// ---------------------------------------------------------------------------

export function readState() {
  const id = currentFlowId();
  if (!id) return null;
  const { state } = flowPaths(id);
  if (!existsSync(state)) return null;
  return JSON.parse(readFileSync(state, 'utf8'));
}
function writeState(state) {
  const { state: sp } = flowPaths(state.flow_id);
  writeFileSync(sp, JSON.stringify(state, null, 2) + '\n');
}
export function readAuditLines(flowId) {
  const id = flowId || currentFlowId();
  if (!id) return [];
  const { audit } = flowPaths(id);
  if (!existsSync(audit)) return [];
  return readFileSync(audit, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

// data.state に「操作後の正当な state.json ハッシュ」を保持する。
function appendAudit(flowId, event, item, data = {}, stateChanged = true) {
  const { audit, state } = flowPaths(flowId);
  const lines = readAuditLines(flowId);
  const seq = lines.length;
  const prev_hash = lines.length ? lines[lines.length - 1].state_hash : GENESIS;
  let stateContentHash;
  if (stateChanged) {
    stateContentHash = existsSync(state) ? fileHash(state) : GENESIS;
  } else {
    stateContentHash = lines.length ? lines[lines.length - 1].data.state
      : (existsSync(state) ? fileHash(state) : GENESIS);
  }
  const fullData = { ...data, state: stateContentHash };
  const ts = new Date().toISOString();
  const body = stableStringify({ seq, ts, event, item, data: fullData });
  const state_hash = sha256(prev_hash + '|' + body);
  const line = { seq, ts, event, item, data: fullData, prev_hash, state_hash };
  appendFileSync(audit, JSON.stringify(line) + '\n');
  return line;
}

// ---------------------------------------------------------------------------
// item ヘルパー
// ---------------------------------------------------------------------------

export function itemSlug(id) { return id.replace(/:/g, '-'); }

export function cursorIndex(state) {
  return state.items.findIndex(i => i.id === state.cursor);
}
export function cursorItem(state) {
  return state.items.find(i => i.id === state.cursor) || null;
}
export function lastSavePointBeforeCursor(state) {
  const ci = cursorIndex(state);
  let sp = null;
  for (let i = 0; i < ci; i++) {
    if (state.items[i].save_point) sp = state.items[i].save_point;
  }
  return sp;
}
function auditHasAdvanced(state, id) {
  return readAuditLines(state.flow_id).some(l => l.event === 'ADVANCED' && l.item === id);
}

// ---------------------------------------------------------------------------
// 共通ガード3つ（状態を変更する全 verb の前に通す）
// ---------------------------------------------------------------------------

// 監査チェーン整合検査（全行を先頭から再計算）＋ state.json 直接改竄検知。
export function verifyAuditChain(flowId) {
  const id = flowId || currentFlowId();
  const lines = readAuditLines(id);
  if (lines.length === 0) return { ok: true };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const expectedPrev = i === 0 ? GENESIS : lines[i - 1].state_hash;
    if (l.prev_hash !== expectedPrev) {
      return { ok: false, reason: `broken chain at seq ${l.seq} (prev_hash mismatch)` };
    }
    const body = stableStringify({ seq: l.seq, ts: l.ts, event: l.event, item: l.item, data: l.data });
    const recomputed = sha256(l.prev_hash + '|' + body);
    if (recomputed !== l.state_hash) {
      return { ok: false, reason: `tampered line at seq ${l.seq} (state_hash mismatch)` };
    }
  }
  if (id) {
    const { state } = flowPaths(id);
    if (existsSync(state)) {
      const expected = lines[lines.length - 1].data.state;
      const current = fileHash(state);
      if (current !== expected) {
        return { ok: false, reason: 'state.json was modified outside the bookkeeper' };
      }
    }
  }
  return { ok: true };
}

// 境界スキャンの基準コミット: フロー全体で最後に ADVANCED した save point。
// 線形進行では「直前 Save Point」と等価。rework 後も承認済みの下流コミット
// （履歴として保持。git は巻き戻さない）を違反扱いしない。
export function scanBase(state) {
  const lines = readAuditLines(state.flow_id);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].event === 'ADVANCED' && lines[i].data && lines[i].data.commit) {
      return lines[i].data.commit;
    }
  }
  return state.base_commit;
}

// 境界スキャン: 基準コミットからの git 差分・untracked を cursor の write_globs に照合。
// `.devflow/**` は常に除外する（この領域の保護は hook の deny + audit 整合検査が担う）。
export function boundaryScan(state) {
  const base = scanBase(state);
  const ci = cursorItem(state);
  const allowed = ci ? ci.write_globs || [] : [];
  const diff = git(['diff', '--name-only', base, '--']);
  const others = git(['ls-files', '--others', '--exclude-standard']);
  const changed = new Set();
  for (const p of diff.out.split('\n').filter(Boolean)) changed.add(p);
  for (const p of others.out.split('\n').filter(Boolean)) changed.add(p);
  const filtered = [...changed].filter(p => !(p === DEVFLOW || p.startsWith(DEVFLOW + '/')));
  const violations = filtered.filter(p => !matchAny(p, allowed));
  return { ok: violations.length === 0, violations, base, changed: filtered };
}

// 成果物ハッシュ検証: cursor が gate_open のとき記録済みハッシュと現内容を突合。
export function verifyArtifactHashes(state) {
  const ci = cursorItem(state);
  if (!ci || ci.status !== 'gate_open') return { ok: true, mismatches: [] };
  const mismatches = [];
  for (const rec of ci.artifact_hashes || []) {
    const abs = P(rec.path);
    if (!existsSync(abs) || fileHash(abs) !== rec.sha256) mismatches.push(rec.path);
  }
  return { ok: mismatches.length === 0, mismatches };
}

function runGuards(state) {
  const chain = verifyAuditChain(state.flow_id);
  if (!chain.ok) {
    fail(state, 'INTEGRITY_VIOLATION', state.cursor, { reason: chain.reason },
      'Audit/state integrity check failed',
      chain.reason,
      'Do not edit .devflow/ by hand. Run `doctor` for diagnosis; restore from git or start a new flow.');
  }
  const bs = boundaryScan(state);
  if (!bs.ok) {
    fail(state, 'BOUNDARY_VIOLATION', state.cursor, { violations: bs.violations, base: bs.base },
      `Changes outside the current item's write scope: ${bs.violations.join(', ')}`,
      `The cursor item "${state.cursor}" may only touch: ${(cursorItem(state)?.write_globs || []).join(', ')}`,
      'Revert the out-of-scope changes, then re-run. Check `status` for the current item.');
  }
  const ah = verifyArtifactHashes(state);
  if (!ah.ok) {
    fail(state, 'ARTIFACT_HASH_MISMATCH', state.cursor, { mismatches: ah.mismatches },
      `Gate artifacts were modified after the gate was opened: ${ah.mismatches.join(', ')}`,
      'Artifacts presented at a gate must not change before approval/advance.',
      'Reject the gate and re-open it (`gate-open`) so the new content is recorded and re-checked.');
  }
}

// ---------------------------------------------------------------------------
// 失敗ヘルパー（What/Why/How を stderr、違反を audit に記録、exit 2）
// ---------------------------------------------------------------------------

function fail(state, event, item, data, what, why, how) {
  try { if (state) appendAudit(state.flow_id, event, item, data, false); } catch { /* audit 破損時も落ちない */ }
  process.stderr.write(`FLOW DENY [${event}]\nWhat: ${what}\nWhy:  ${why}\nHow:  ${how}\n`);
  process.exit(2);
}
function die(msg, code = 2) {
  process.stderr.write(msg + '\n');
  process.exit(code);
}

// ---------------------------------------------------------------------------
// stdin payload（人間の自由文はすべて構造化 stdin で渡す）
// ---------------------------------------------------------------------------

function readStdinJSON(verb) {
  let raw;
  try { raw = readFileSync(0, 'utf8'); }
  catch { die(`${verb} failed: could not read stdin`); }
  if (!raw || raw.trim() === '') die(`${verb} failed: empty stdin (JSON payload required)`);
  try { return JSON.parse(raw); }
  catch (e) { die(`${verb} failed: stdin is not valid JSON: ${e.message}`); }
}
function requireStdinFlag(verb, opts) {
  if (!opts.stdin) {
    die(`${verb} failed: this verb accepts input only as JSON via --stdin ` +
      '(free text is never passed as a shell argument)');
  }
  return readStdinJSON(verb);
}
function requireString(verb, payload, field) {
  const v = payload[field];
  if (typeof v !== 'string' || v.trim() === '') die(`${verb} failed: payload field "${field}" must be a non-empty string`);
  return v;
}

// ---------------------------------------------------------------------------
// interpretations の形式検証（§6）
// ---------------------------------------------------------------------------

// 戻り値: { ok, errors, entries: [{n, title, adr, fields: {未指定, 解釈, 理由}}] }
export function validateInterpretations(text) {
  const errors = [];
  const lines = String(text).split('\n');
  const entries = [];
  const seen = new Set();
  const entryLineIdx = [];
  lines.forEach((l, i) => { if (/^##\s*I-/.test(l)) entryLineIdx.push(i); });
  for (const i of entryLineIdx) {
    const m = lines[i].match(/^## I-(\d+): (.+?)( \[ADR候補\])?$/);
    if (!m) {
      errors.push(`line ${i + 1}: entry heading must be "## I-<n>: <未指定点の一行>" (optionally " [ADR候補]")`);
      continue;
    }
    const n = Number(m[1]);
    if (seen.has(n)) errors.push(`duplicate entry id I-${n}`);
    seen.add(n);
    const fields = {};
    let j = i + 1;
    for (const key of ['未指定', '解釈', '理由']) {
      while (j < lines.length && lines[j].trim() === '') j++;
      const fm = j < lines.length ? lines[j].match(/^- (未指定|解釈|理由): (.+)$/) : null;
      if (!fm || fm[1] !== key || fm[2].trim() === '') {
        errors.push(`I-${n}: required line "- ${key}: <一行>" missing or malformed`);
        fields[key] = null;
        break;
      }
      fields[key] = fm[2].trim();
      j++;
    }
    entries.push({ n, title: m[2].trim(), adr: Boolean(m[3]), fields });
  }
  if (entryLineIdx.length === 0) {
    const hasNone = lines.some(l => l.trim() === NO_INTERPRETATIONS);
    if (!hasNone) {
      errors.push(`no "## I-<n>:" entries and no "${NO_INTERPRETATIONS}" line — ` +
        'record each interpretation in the required form, or state explicitly that there is none');
    }
  }
  return { ok: errors.length === 0, errors, entries };
}

// エントリから正規化3行を決定論生成する。
export function normalizedLines(entries) {
  const out = [];
  for (const e of entries) {
    out.push(`[I-${e.n}] 未指定: ${e.fields['未指定']}`);
    out.push(`[I-${e.n}] 解釈: ${e.fields['解釈']}`);
    out.push(`[I-${e.n}] 理由: ${e.fields['理由']}`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// findings の検証（§8）
// ---------------------------------------------------------------------------

const SEVERITIES = ['blocker', 'major', 'minor'];

export function validateFindings(findings, state) {
  const errors = [];
  if (!Array.isArray(findings)) return ['findings must be an array'];
  const seen = new Set();
  findings.forEach((f, idx) => {
    const where = `findings[${idx}]`;
    if (!f || typeof f !== 'object') { errors.push(`${where}: not an object`); return; }
    if (typeof f.id !== 'string' || !/^F-\d+$/.test(f.id)) errors.push(`${where}: "id" must match F-<n>`);
    else if (seen.has(f.id)) errors.push(`${where}: duplicate id ${f.id}`);
    else seen.add(f.id);
    if (!SEVERITIES.includes(f.severity)) errors.push(`${where}: "severity" must be one of ${SEVERITIES.join('|')}`);
    for (const field of ['kind', 'claim', 'evidence']) {
      if (typeof f[field] !== 'string' || f[field].trim() === '') errors.push(`${where}: "${field}" must be a non-empty string`);
    }
    if (typeof f.claim === 'string' && f.claim.includes('\n')) errors.push(`${where}: "claim" must be a single line`);
    if (f.suggested_rework_to !== undefined) {
      if (typeof f.suggested_rework_to !== 'string' ||
          (state && !state.items.some(i => i.id === f.suggested_rework_to))) {
        errors.push(`${where}: "suggested_rework_to" must be an existing item id`);
      }
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// plan / units の検証（work_roots 部分集合検査を含む）
// ---------------------------------------------------------------------------

export function validateUnits(units, workRoots) {
  const errors = [];
  if (!Array.isArray(units) || units.length === 0) {
    return ['units must be a non-empty array'];
  }
  const seen = new Set();
  units.forEach((u, idx) => {
    const where = `units[${idx}]`;
    if (!u || typeof u !== 'object') { errors.push(`${where}: not an object`); return; }
    if (typeof u.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(u.id)) {
      errors.push(`${where}: "id" must be a path-safe identifier`);
    } else if (seen.has(u.id)) {
      errors.push(`${where}: duplicate unit id "${u.id}"`);
    } else seen.add(u.id);
    for (const f of ['title', 'check']) {
      if (typeof u[f] !== 'string' || u[f].trim() === '') errors.push(`${where}: "${f}" must be a non-empty string`);
    }
    if (!Array.isArray(u.write_globs) || u.write_globs.length === 0) {
      errors.push(`${where}: "write_globs" must be a non-empty array`);
    } else {
      for (const g of u.write_globs) {
        const ge = globErrors(g, `${where} write_glob`);
        if (ge.length) { errors.push(...ge); continue; }
        if (!isSubsetOfWorkRoots(g, workRoots)) {
          errors.push(`${where}: write_glob "${g}" is not a subset of work_roots`);
        }
      }
    }
  });
  return errors;
}

export function validatePlan(planObj, workRoots) {
  if (!planObj || typeof planObj !== 'object' || !Array.isArray(planObj.units)) {
    return ['plan.json must be an object with a "units" array'];
  }
  return validateUnits(planObj.units, workRoots);
}

// ---------------------------------------------------------------------------
// config の検証（config-lint / init / amend で共用）
// ---------------------------------------------------------------------------

const STAGE_KINDS = ['stage', 'implement_placeholder', 'review'];

// 戻り値: { ok, errors, normalized }
export function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errors: ['config must be an object'], normalized: null };
  }
  if (config.schema !== 1) errors.push('config.schema must be 1');
  // work_roots
  if (!Array.isArray(config.work_roots) || config.work_roots.length === 0) {
    errors.push('config.work_roots must be a non-empty array of globs');
  } else {
    for (const g of config.work_roots) errors.push(...globErrors(g, 'work_root'));
  }
  // stages
  if (!Array.isArray(config.stages) || config.stages.length === 0) {
    errors.push('config.stages must be a non-empty array');
    return { ok: false, errors, normalized: null };
  }
  const ids = new Set();
  let placeholderCount = 0;
  let placeholderIdx = -1;
  let reviewCount = 0;
  let decomposeIdx = -1;
  config.stages.forEach((s, idx) => {
    const where = `stages[${idx}]`;
    if (!s || typeof s !== 'object') { errors.push(`${where}: not an object`); return; }
    if (typeof s.id !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_-]*$/.test(s.id)) {
      errors.push(`${where}: "id" must be a path-safe identifier (no ":")`);
    } else if (ids.has(s.id)) {
      errors.push(`${where}: duplicate stage id "${s.id}"`);
    } else ids.add(s.id);
    if (!STAGE_KINDS.includes(s.kind)) { errors.push(`${where}: "kind" must be one of ${STAGE_KINDS.join('|')}`); return; }
    if (s.kind === 'implement_placeholder') { placeholderCount++; placeholderIdx = idx; return; }
    if (s.kind === 'review') {
      reviewCount++;
      if (idx !== config.stages.length - 1) errors.push(`${where}: review stage must be the last stage`);
      if (s.check !== undefined && s.check !== 'flow:findings-lint') {
        errors.push(`${where}: review stage check is fixed to "flow:findings-lint"`);
      }
      return;
    }
    // kind: stage
    if (s.id === 'decompose') decomposeIdx = idx;
    const check = s.check !== undefined ? s.check : (s.id === 'decompose' ? 'flow:plan-lint' : undefined);
    if (typeof check !== 'string' || check.trim() === '') errors.push(`${where}: "check" must be a non-empty string`);
    if (s.artifacts !== undefined) {
      if (!Array.isArray(s.artifacts)) errors.push(`${where}: "artifacts" must be an array of file names`);
      else {
        for (const a of s.artifacts) {
          if (typeof a !== 'string' || a.trim() === '' || a.includes('*') ||
              a.startsWith('/') || a.split('/').some(seg => seg === '..')) {
            errors.push(`${where}: artifact name "${a}" is invalid`);
          }
        }
      }
    }
  });
  if (placeholderCount !== 1) errors.push('config.stages must contain exactly one implement_placeholder');
  if (reviewCount > 1) errors.push('config.stages may contain at most one review stage');
  if (decomposeIdx >= 0 && placeholderIdx >= 0 && decomposeIdx > placeholderIdx) {
    errors.push('the decompose stage must come before the implement_placeholder');
  }
  // units（インライン定義: decompose 省略）
  const hasUnits = config.units !== undefined;
  if (hasUnits && decomposeIdx >= 0) errors.push('config.units (inline) and a "decompose" stage are mutually exclusive');
  if (!hasUnits && decomposeIdx < 0) errors.push('config must have either a "decompose" stage or inline "units"');
  if (hasUnits && Array.isArray(config.work_roots)) {
    errors.push(...validateUnits(config.units, config.work_roots));
  }
  if (errors.length) return { ok: false, errors, normalized: null };

  // normalize: 既定値を埋める
  const normalized = {
    schema: 1,
    work_roots: [...config.work_roots],
    stages: config.stages.map(s => {
      if (s.kind === 'implement_placeholder') return { id: s.id, kind: s.kind };
      if (s.kind === 'review') return { id: s.id, kind: 'review', check: 'flow:findings-lint' };
      const artifacts = [...new Set([
        ...(s.id === 'decompose' ? ['plan.md', 'plan.json'] : []),
        ...(s.artifacts || []),
        'interpretations.md',
      ])];
      return {
        id: s.id, kind: 'stage',
        check: s.check !== undefined ? s.check : 'flow:plan-lint',
        artifacts,
      };
    }),
  };
  if (hasUnits) {
    normalized.units = config.units.map(u => ({
      id: u.id, title: u.title, check: u.check, write_globs: [...u.write_globs],
    }));
  }
  return { ok: true, errors: [], normalized };
}

// ---------------------------------------------------------------------------
// item 構築
// ---------------------------------------------------------------------------

function makeUnitItem(u, flowId, revision) {
  const id = `implement:${u.id}`;
  const artDir = `${flowDirRel(flowId)}/artifacts/${itemSlug(id)}`;
  return {
    id, kind: 'unit', title: u.title, status: 'pending', revision,
    artifacts: [`${artDir}/interpretations.md`],
    check: u.check,
    write_globs: [...u.write_globs, `${artDir}/**`],
    plan_globs: [...u.write_globs],
    artifact_hashes: [], save_point: null, gate_seq: 0,
  };
}

function makeStageItem(s, flowId) {
  const artDir = `${flowDirRel(flowId)}/artifacts/${itemSlug(s.id)}`;
  if (s.kind === 'review') {
    return {
      id: s.id, kind: 'review', status: 'pending', revision: 1,
      artifacts: [`${artDir}/findings.json`, `${artDir}/findings.md`, `${artDir}/interpretations.md`],
      check: 'flow:findings-lint',
      write_globs: [], // review 成果物は bookkeeper のみが書く（モデルからは state 区分）
      artifact_hashes: [], save_point: null, gate_seq: 0,
    };
  }
  return {
    id: s.id, kind: 'stage', status: 'pending', revision: 1,
    artifacts: s.artifacts.map(a => `${artDir}/${a}`),
    check: s.check,
    write_globs: [`${artDir}/**`],
    artifact_hashes: [], save_point: null, gate_seq: 0,
  };
}

function buildItems(cfg, flowId) {
  const items = [];
  let insertBefore = null;
  const phIdx = cfg.stages.findIndex(s => s.kind === 'implement_placeholder');
  if (phIdx >= 0 && cfg.stages[phIdx + 1]) insertBefore = cfg.stages[phIdx + 1].id;
  for (const s of cfg.stages) {
    if (s.kind === 'implement_placeholder') {
      if (cfg.units) for (const u of cfg.units) items.push(makeUnitItem(u, flowId, 1));
      continue;
    }
    items.push(makeStageItem(s, flowId));
  }
  return { items, insertBefore };
}

// ---------------------------------------------------------------------------
// gate card（§7）
// ---------------------------------------------------------------------------

export function gateCardRelPath(state, item) {
  return `${flowDirRel(state.flow_id)}/gate-cards/${itemSlug(item.id)}-r${item.revision}-${item.gate_seq}.md`;
}

// stop-guard / テストが使う検査集合の決定論抽出:
// BEGIN/END マーカー + 全 [I-n] 正規化行 + 全 [F-n] 行。
export function gateCardRequiredLines(cardText) {
  return String(cardText).split('\n').map(l => l.trim()).filter(l =>
    l.startsWith('<!-- GATE-CARD BEGIN') || l.startsWith('<!-- GATE-CARD END') ||
    /^\[I-\d+\]/.test(l) || /^\[F-\d+\]/.test(l));
}

function buildGateCard(st, ci, interpText, entries, evidenceEntry, changed) {
  const seq = ci.gate_seq;
  const meta = `flow=${st.flow_id} item=${ci.id} revision=${ci.revision} seq=${seq}`;
  const norm = normalizedLines(entries);
  const adr = entries.filter(e => e.adr);
  const cands = (st.learn_candidates || []).filter(c => c.item === ci.id && c.revision === ci.revision);
  const findings = ci.kind === 'review'
    ? (st.findings || []).filter(f => f.item === ci.id && f.revision === ci.revision) : [];
  const L = [];
  L.push(`<!-- GATE-CARD BEGIN ${meta} -->`);
  L.push(`# Gate: ${ci.id} (revision ${ci.revision}, seq ${seq}, flow ${st.flow_id})`);
  L.push('');
  L.push('## 成果物');
  for (const h of ci.artifact_hashes) L.push(`- ${h.path} sha256=${h.sha256}`);
  L.push('');
  L.push('## Interpretations（全文）');
  L.push('');
  L.push(String(interpText).replace(/\n$/, ''));
  L.push('');
  L.push('## 正規化行');
  if (norm.length) L.push(...norm);
  else L.push(`（解釈エントリなし: ${NO_INTERPRETATIONS}）`);
  L.push('');
  L.push('## Evidence');
  L.push(`- check: ${evidenceEntry.cmd}`);
  L.push(`- exit: ${evidenceEntry.exit}`);
  L.push(`- log: ${evidenceEntry.log}`);
  L.push('');
  L.push('## 変更ファイル');
  if (changed.length) for (const f of changed) L.push(`- ${f}`);
  else L.push('- （なし）');
  L.push('');
  L.push('## 未解決事項・ADR 候補');
  if (adr.length) for (const e of adr) L.push(`- I-${e.n} [ADR候補] ${e.title}`);
  else L.push('- なし');
  L.push('');
  L.push('## 学習候補');
  if (cands.length) for (const c of cands) L.push(`- cid=${c.cid} (${c.source}) ${c.text}`);
  else L.push('- なし');
  if (ci.kind === 'review') {
    L.push('');
    L.push('## Findings');
    if (findings.length) for (const f of findings) L.push(`[F-${f.id.slice(2)}] ${f.severity}: ${f.claim}`);
    else L.push('- なし（finding ゼロ）');
  }
  L.push('');
  L.push(`<!-- GATE-CARD END ${meta} -->`);
  L.push('');
  return L.join('\n');
}

// ---------------------------------------------------------------------------
// 提示済み attestation（§7）
// ---------------------------------------------------------------------------

export function readPresented(flowId) {
  const { presented } = flowPaths(flowId);
  if (!existsSync(presented)) return [];
  return readFileSync(presented, 'utf8').split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

export function appendPresented(flowId, entry) {
  const { logs, presented } = flowPaths(flowId);
  mkdirSync(logs, { recursive: true });
  appendFileSync(presented, JSON.stringify(entry) + '\n');
}

// 現在の gate card（同一 item / revision / gate_seq / card ハッシュ）に対応する
// attestation が存在するか。
export function hasValidAttestation(state, item) {
  const rel = gateCardRelPath(state, item);
  const abs = P(rel);
  if (!existsSync(abs)) return { ok: false, reason: `gate card not found: ${rel}` };
  const hash = fileHash(abs);
  const found = readPresented(state.flow_id).some(a =>
    a && a.flow_id === state.flow_id && a.item === item.id &&
    a.revision === item.revision && a.gate_seq === item.gate_seq &&
    a.gate_card_hash === hash);
  return found ? { ok: true } : {
    ok: false,
    reason: `no presented attestation for gate card ${rel} (item=${item.id} r${item.revision} seq=${item.gate_seq})`,
  };
}

// ---------------------------------------------------------------------------
// 学習候補の登録（§9。gate-open 時に決定論で登録）
// ---------------------------------------------------------------------------

function registerLearnCandidates(st, ci, entries) {
  st.learn_candidates = st.learn_candidates || [];
  const added = [];
  for (const e of entries) {
    const key = `interp|${ci.id}|r${ci.revision}|I-${e.n}`;
    if (st.learn_candidates.some(c => c.key === key)) continue;
    const cid = `c${st.learn_seq++}`;
    st.learn_candidates.push({
      cid, key,
      source: `interpretations:${ci.id}:r${ci.revision}:I-${e.n}`,
      item: ci.id, revision: ci.revision,
      text: `${e.title} — 未指定: ${e.fields['未指定']} / 解釈: ${e.fields['解釈']} / 理由: ${e.fields['理由']}`,
    });
    added.push(cid);
  }
  for (const f of (st.feedbacks || []).filter(f => f.item === ci.id && f.revision === ci.revision)) {
    const key = `feedback|${f.item}|r${f.revision}|${f.ts}`;
    if (st.learn_candidates.some(c => c.key === key)) continue;
    const cid = `c${st.learn_seq++}`;
    st.learn_candidates.push({
      cid, key,
      source: `feedback:${f.kind}:${f.item}:r${f.revision}`,
      item: f.item, revision: f.revision, text: f.text,
    });
    added.push(cid);
  }
  return added;
}

// ---------------------------------------------------------------------------
// 内蔵 check（flow:plan-lint / flow:findings-lint）
// ---------------------------------------------------------------------------

function planLintResult(st) {
  const rel = `${flowDirRel(st.flow_id)}/artifacts/decompose/plan.json`;
  const abs = P(rel);
  if (!existsSync(abs)) return { exit: 1, out: `plan-lint FAILED: plan not found: ${rel}` };
  let obj;
  try { obj = JSON.parse(readFileSync(abs, 'utf8')); }
  catch (e) { return { exit: 1, out: `plan-lint FAILED: invalid JSON: ${e.message}` }; }
  const errors = validatePlan(obj, st.work_roots);
  if (errors.length) return { exit: 1, out: 'plan-lint FAILED:\n' + errors.map(e => '  - ' + e).join('\n') };
  return { exit: 0, out: `plan-lint OK: ${obj.units.length} unit(s)` };
}

function findingsLintResult(st) {
  const ri = st.items.find(i => i.kind === 'review');
  if (!ri) return { exit: 1, out: 'findings-lint FAILED: no review item in this flow' };
  const dir = `${flowDirRel(st.flow_id)}/artifacts/${itemSlug(ri.id)}`;
  const jsonAbs = P(dir, 'findings.json');
  if (!existsSync(jsonAbs)) return { exit: 1, out: `findings-lint FAILED: ${dir}/findings.json not found (run findings-record first)` };
  let obj;
  try { obj = JSON.parse(readFileSync(jsonAbs, 'utf8')); }
  catch (e) { return { exit: 1, out: `findings-lint FAILED: invalid JSON: ${e.message}` }; }
  if (!obj || obj.revision !== ri.revision || !Array.isArray(obj.findings)) {
    return { exit: 1, out: `findings-lint FAILED: findings.json is not for current revision r${ri.revision}` };
  }
  const errors = validateFindings(obj.findings, st);
  if (errors.length) return { exit: 1, out: 'findings-lint FAILED:\n' + errors.map(e => '  - ' + e).join('\n') };
  const recorded = (st.findings || []).filter(f => f.item === ri.id && f.revision === ri.revision);
  const a = stableStringify(obj.findings.map(f => ({ id: f.id, severity: f.severity, kind: f.kind, claim: f.claim, evidence: f.evidence })));
  const b = stableStringify(recorded.map(f => ({ id: f.id, severity: f.severity, kind: f.kind, claim: f.claim, evidence: f.evidence })));
  if (a !== b) return { exit: 1, out: 'findings-lint FAILED: findings.json does not match the recorded state (use findings-record)' };
  return { exit: 0, out: `findings-lint OK: ${obj.findings.length} finding(s) for r${ri.revision}` };
}

function runCheck(st, ci) {
  if (ci.check === 'flow:plan-lint') return planLintResult(st);
  if (ci.check === 'flow:findings-lint') return findingsLintResult(st);
  const r = spawnSync(ci.check, { cwd: repoRoot(), shell: true, encoding: 'utf8' });
  return { exit: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

// ---------------------------------------------------------------------------
// verb 実装
// ---------------------------------------------------------------------------

function verbConfigLint(opts) {
  const payload = requireStdinFlag('config-lint', opts);
  const config = payload && typeof payload === 'object' && payload.config !== undefined ? payload.config : payload;
  const v = validateConfig(config);
  if (!v.ok) die('config-lint FAILED:\n' + v.errors.map(e => '  - ' + e).join('\n'), 1);
  process.stdout.write(`config-lint OK: ${v.normalized.stages.length} stage entr${v.normalized.stages.length === 1 ? 'y' : 'ies'}` +
    (v.normalized.units ? `, ${v.normalized.units.length} inline unit(s)` : '') + '\n');
}

function verbInit(opts) {
  const payload = requireStdinFlag('init', opts);
  const intent = requireString('init', payload, 'intent');
  const consent = requireString('init', payload, 'consent');
  const flowId = requireString('init', payload, 'flow_id');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(flowId)) die('init failed: flow_id must be a path-safe identifier');
  if (!payload.config) die('init failed: payload field "config" is required');
  const specPath = payload.spec_path;
  if (specPath !== undefined) {
    if (typeof specPath !== 'string' || specPath.trim() === '') die('init failed: spec_path must be a non-empty string when given');
    if (!existsSync(P(specPath))) die(`init failed: spec_path not found: ${specPath}`);
  }

  // ライフサイクル: current が active フローを指している間は拒否（Default-FAIL）。
  const curId = currentFlowId();
  if (curId) {
    const st = readState();
    if (st && st.status === 'active') {
      die(`init failed: an active flow "${curId}" already exists (finish it or inspect with \`status\`)`);
    }
    die(`init failed: .devflow/current points to "${curId}" but its state is missing or not cleared — run \`doctor\``);
  }
  const fp = flowPaths(flowId);
  if (existsSync(fp.dir)) die(`init failed: flow directory already exists: ${flowDirRel(flowId)}`);

  const head = git(['rev-parse', 'HEAD']);
  if (head.code !== 0) die('init failed: repository has no HEAD commit');

  const v = validateConfig(payload.config);
  if (!v.ok) die('init failed: invalid config:\n' + v.errors.map(e => '  - ' + e).join('\n'));
  const cfg = v.normalized;

  const dv = devflowPaths();
  mkdirSync(dv.root, { recursive: true });
  if (!existsSync(dv.gitignore)) writeFileSync(dv.gitignore, GITIGNORE_CONTENT);
  mkdirSync(fp.evidence, { recursive: true });
  mkdirSync(fp.artifacts, { recursive: true });
  mkdirSync(fp.gateCards, { recursive: true });
  mkdirSync(fp.logs, { recursive: true });
  mkdirSync(fp.review, { recursive: true });
  writeFileSync(fp.config, JSON.stringify(cfg, null, 2) + '\n');

  const { items, insertBefore } = buildItems(cfg, flowId);
  if (items.length === 0) die('init failed: config produced no items');
  items[0].status = 'in_progress';
  const st = {
    schema: 2, flow_id: flowId, status: 'active',
    spec_path: specPath ?? null, intent,
    base_commit: head.out, work_roots: cfg.work_roots,
    implement_insert_before: insertBefore,
    items, cursor: items[0].id,
    approvals: [], evidence: [], rejections: {}, feedbacks: [],
    findings: [], learn_candidates: [], learn_seq: 1,
  };
  writeState(st);
  writeFileSync(dv.current, flowId + '\n');
  appendAudit(flowId, 'FLOW_INIT', st.cursor, {
    flow_id: flowId, spec_path: st.spec_path, intent, consent,
    base_commit: st.base_commit, work_roots: st.work_roots,
    items: items.map(i => i.id), units_inline: Boolean(cfg.units),
  });
  if (cfg.units) {
    appendAudit(flowId, 'UNITS_MATERIALIZED', st.cursor,
      { units: items.filter(i => i.kind === 'unit').map(i => i.id), via: 'init-inline' }, false);
  }
  process.stdout.write(`initialized flow "${flowId}" at ${st.cursor}\n`);
}

function nextAction(st, ci) {
  if (st.status === 'done') return 'flow complete';
  if (!ci) return 'unknown';
  if (ci.status === 'in_progress') {
    if (ci.kind === 'review') return `run \`review-package\`, launch the reviewer with the package path, record its JSON via \`findings-record --stdin\`, then \`gate-open\``;
    return `work on "${ci.id}", then \`gate-open\``;
  }
  if (ci.status === 'gate_open') return 'present the gate card verbatim; on explicit approval `approve --stdin` then `advance`';
  return 'advance cursor';
}

function verbStatus(opts) {
  const st = readState();
  if (!st) die('no active flow (.devflow/current does not point to a flow)', 1);
  const ci = cursorItem(st);
  if (opts.json) {
    const out = {
      ...st,
      flow_dir: flowDirRel(st.flow_id),
      gate_card: ci && ci.status === 'gate_open' ? gateCardRelPath(st, ci) : null,
      next: nextAction(st, ci),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    return;
  }
  process.stdout.write(`flow ${st.flow_id} [${st.status}]  cursor=${st.cursor} (${ci ? ci.status : '?'})\n`);
  for (const it of st.items) {
    const mark = it.id === st.cursor ? '>' : ' ';
    process.stdout.write(`${mark} ${it.id.padEnd(18)} ${it.kind.padEnd(6)} r${it.revision} ${it.status}\n`);
  }
  process.stdout.write(`next: ${nextAction(st, ci)}\n`);
}

function verbPlanLint() {
  const st = readState();
  if (!st) die('plan-lint failed: no active flow', 1);
  const r = planLintResult(st);
  if (r.exit !== 0) die(r.out, 1);
  process.stdout.write(r.out + '\n');
}

function verbFindingsLint() {
  const st = readState();
  if (!st) die('findings-lint failed: no active flow', 1);
  const r = findingsLintResult(st);
  if (r.exit !== 0) die(r.out, 1);
  process.stdout.write(r.out + '\n');
}

function verbGateOpen() {
  const st = readState();
  if (!st) die('gate-open failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci) die('gate-open failed: no cursor item');
  if (ci.status !== 'in_progress') die(`gate-open failed: item "${ci.id}" is "${ci.status}", expected in_progress`);
  // 宣言 artifacts が全て存在し非空
  for (const a of ci.artifacts) {
    const abs = P(a);
    if (!existsSync(abs) || statSync(abs).size === 0) die(`gate-open failed: artifact missing or empty: ${a}`);
  }
  // interpretations の形式検証（Default-FAIL）
  const interpRel = ci.artifacts.find(a => a.endsWith('interpretations.md'));
  const interpText = readFileSync(P(interpRel), 'utf8');
  const iv = validateInterpretations(interpText);
  if (!iv.ok) {
    die('gate-open failed: interpretations format invalid:\n' + iv.errors.map(e => '  - ' + e).join('\n'));
  }
  // check コマンド（内蔵 or shell）を実行し evidence に保存
  const { evidence } = flowPaths(st.flow_id);
  mkdirSync(evidence, { recursive: true });
  const stamp = Date.now();
  const logPath = join(evidence, `${itemSlug(ci.id)}-r${ci.revision}-${stamp}.log`);
  const relLog = toRel(logPath);
  const r = runCheck(st, ci);
  writeFileSync(logPath, r.out || '');
  const ts = new Date().toISOString();
  const evidenceEntry = { item: ci.id, revision: ci.revision, cmd: ci.check, exit: r.exit, log: relLog, ts };
  st.evidence.push(evidenceEntry);
  if (r.exit !== 0) {
    writeState(st);
    appendAudit(st.flow_id, 'CHECK_FAILED', ci.id, { revision: ci.revision, cmd: ci.check, exit: r.exit, log: relLog });
    die(`gate-open failed: check exited ${r.exit} (see ${relLog})`);
  }
  // 成果物ハッシュ記録・ゲート開放・カード連番
  ci.artifact_hashes = ci.artifacts.map(a => ({ path: a, sha256: fileHash(P(a)) }));
  ci.status = 'gate_open';
  ci.gate_seq += 1;
  // 学習候補の登録（決定論）
  const addedCids = registerLearnCandidates(st, ci, iv.entries);
  // gate card 生成（bookkeeper が書く）
  const bs = boundaryScan(st);
  const card = buildGateCard(st, ci, interpText, iv.entries, evidenceEntry, bs.changed);
  const cardRel = gateCardRelPath(st, ci);
  mkdirSync(dirname(P(cardRel)), { recursive: true });
  writeFileSync(P(cardRel), card);
  writeState(st);
  appendAudit(st.flow_id, 'GATE_OPEN', ci.id, {
    revision: ci.revision, gate_seq: ci.gate_seq,
    artifact_hashes: ci.artifact_hashes, evidence_log: relLog,
    gate_card: cardRel, learn_candidates_added: addedCids,
  });
  const summary = {
    item: ci.id, kind: ci.kind, revision: ci.revision, gate_seq: ci.gate_seq,
    gate_card: cardRel,
    artifacts: ci.artifact_hashes,
    interpretations: [{ path: interpRel, text: interpText }],
    evidence: { cmd: ci.check, exit: 0, log: relLog },
    changed_files: bs.changed,
  };
  process.stdout.write('GATE OPEN\n' + JSON.stringify(summary, null, 2) + '\n');
}

function verbApprove(opts) {
  const payload = requireStdinFlag('approve', opts);
  const st = readState();
  if (!st) die('approve failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci || ci.status !== 'gate_open') die('approve failed: cursor is not at an open gate');
  const input = requireString('approve', payload, 'input');
  // 提示忠実性: 現在の gate card に対応する提示済み attestation が無ければ拒否（§7）
  const att = hasValidAttestation(st, ci);
  if (!att.ok) {
    die(`approve failed: gate card has not been presented to the human yet (${att.reason}). ` +
      'Present the gate card verbatim (all required lines) and end the turn first.');
  }
  st.approvals.push({ item: ci.id, revision: ci.revision, verbatim: input, ts: new Date().toISOString() });
  writeState(st);
  appendAudit(st.flow_id, 'APPROVED', ci.id, { revision: ci.revision, gate_seq: ci.gate_seq, verbatim: input });
  process.stdout.write(`approved: ${ci.id} (r${ci.revision})\n`);
}

function verbReject(opts) {
  const payload = requireStdinFlag('reject', opts);
  const st = readState();
  if (!st) die('reject failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci || ci.status !== 'gate_open') die('reject failed: cursor is not at an open gate');
  const feedback = requireString('reject', payload, 'feedback');
  ci.artifact_hashes = [];
  ci.status = 'in_progress';
  st.rejections = st.rejections || {};
  st.rejections[ci.id] = (st.rejections[ci.id] || 0) + 1;
  const ts = new Date().toISOString();
  st.feedbacks = st.feedbacks || [];
  st.feedbacks.push({ item: ci.id, revision: ci.revision, kind: 'reject', text: feedback, ts });
  writeState(st);
  appendAudit(st.flow_id, 'REJECTED', ci.id, { revision: ci.revision, feedback, count: st.rejections[ci.id] });
  let msg = `rejected: ${ci.id} (back to in_progress, r${ci.revision})\n`;
  if (st.rejections[ci.id] >= 3) {
    msg += `NOTE: "${ci.id}" has been rejected ${st.rejections[ci.id]} times. Consider offering an escape hatch to the human.\n`;
  }
  process.stdout.write(msg);
}

// decompose 再実行を含む unit materialize（§5.1）。
// revision の更新責務は rework に一元化: 既存 id は revision を引き継ぎ、新規 id は 1。
function materializeUnits(st) {
  const rel = `${flowDirRel(st.flow_id)}/artifacts/decompose/plan.json`;
  let plan;
  try { plan = JSON.parse(readFileSync(P(rel), 'utf8')); }
  catch (e) { die(`advance failed: cannot read plan.json: ${e.message}`); }
  const errors = validatePlan(plan, st.work_roots);
  if (errors.length) die('advance failed: plan.json invalid:\n' + errors.map(e => '  - ' + e).join('\n'));

  const newIds = plan.units.map(u => `implement:${u.id}`);
  const existingUnits = st.items.filter(i => i.kind === 'unit');
  for (const ex of existingUnits) {
    if (!newIds.includes(ex.id)) {
      // 実装済み unit の除去は Default-FAIL（未実行 pending のみ除去可）
      if (ex.save_point || auditHasAdvanced(st, ex.id) || ex.status !== 'pending') {
        die(`advance failed: the new plan removes already-implemented unit "${ex.id}". ` +
          'Keep the id (repurpose it, e.g. as an explicit cleanup unit) instead of dropping it.');
      }
    }
  }
  const unitItems = plan.units.map(u => {
    const id = `implement:${u.id}`;
    const ex = existingUnits.find(e => e.id === id);
    if (ex) {
      const ni = makeUnitItem(u, st.flow_id, ex.revision); // revision は引き継ぐ（二重インクリメント禁止）
      ni.status = ex.status;
      ni.gate_seq = ex.gate_seq;
      ni.save_point = ex.save_point;
      return ni;
    }
    return makeUnitItem(u, st.flow_id, 1);
  });
  st.items = st.items.filter(i => i.kind !== 'unit');
  let idx = st.implement_insert_before
    ? st.items.findIndex(i => i.id === st.implement_insert_before)
    : st.items.length;
  if (idx < 0) idx = st.items.length;
  st.items.splice(idx, 0, ...unitItems);
  return unitItems.map(u => u.id);
}

function verbAdvance() {
  const st = readState();
  if (!st) die('advance failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci || ci.status !== 'gate_open') die('advance failed: cursor is not at an open gate');
  // 現在 revision の APPROVED
  const approved = st.approvals.some(a => a.item === ci.id && a.revision === ci.revision);
  if (!approved) die(`advance failed: no APPROVED recorded for "${ci.id}" at revision ${ci.revision}`);
  // 提示済み attestation
  const att = hasValidAttestation(st, ci);
  if (!att.ok) die(`advance failed: gate card has not been presented (${att.reason})`);
  // review: 全 finding resolved かつ action=fix ゼロ（Default-FAIL）
  if (ci.kind === 'review') {
    const fs = (st.findings || []).filter(f => f.item === ci.id && f.revision === ci.revision);
    const unresolved = fs.filter(f => !f.resolution);
    if (unresolved.length) {
      die(`advance failed: unresolved finding(s): ${unresolved.map(f => f.id).join(', ')} ` +
        '(resolve each via `finding-resolve --stdin` first)');
    }
    const fixes = fs.filter(f => f.resolution && f.resolution.action === 'fix');
    if (fixes.length) {
      die(`advance failed: finding(s) resolved as fix remain: ${fixes.map(f => f.id).join(', ')} ` +
        '(route them through `rework --stdin`; review advances only when zero fix findings remain)');
    }
  }

  // Save Point の記録
  let commit;
  if (ci.kind === 'unit') {
    const bs = boundaryScan(st);
    const toStage = bs.changed.filter(p => matchAny(p, ci.write_globs));
    if (toStage.length > 0) {
      const add = git(['add', '--', ...toStage]);
      if (add.code !== 0) die(`advance failed: git add error: ${add.err}`);
      const cm = git(['commit', '-q', '-m', `flow: ${ci.id} approved (${st.flow_id} r${ci.revision})`]);
      if (cm.code !== 0) die(`advance failed: git commit error: ${cm.err}`);
      commit = git(['rev-parse', 'HEAD']).out;
    } else {
      commit = git(['rev-parse', 'HEAD']).out; // 差分なし: コミット省略
    }
  } else {
    commit = git(['rev-parse', 'HEAD']).out; // 非実装工程: 新規コミットを作らない
  }
  ci.save_point = commit;
  ci.status = 'done';

  // decompose を出るとき: plan.json から implement 単位を（再）構成
  let materialized = null;
  if (ci.id === 'decompose') materialized = materializeUnits(st);

  const idx = st.items.findIndex(i => i.id === ci.id);
  const nextItem = st.items[idx + 1];
  let flowDone = false;
  if (nextItem) { st.cursor = nextItem.id; nextItem.status = 'in_progress'; }
  else { st.status = 'done'; flowDone = true; }

  writeState(st);
  appendAudit(st.flow_id, 'ADVANCED', ci.id, { revision: ci.revision, commit });
  if (materialized) appendAudit(st.flow_id, 'UNITS_MATERIALIZED', 'decompose', { units: materialized }, false);
  if (flowDone) {
    appendAudit(st.flow_id, 'FLOW_DONE', ci.id, {}, false);
    // ライフサイクル: done で current をクリア（フロー履歴は flows/ に保持）
    writeFileSync(devflowPaths().current, '');
  }
  process.stdout.write(`advanced: ${ci.id} -> ${flowDone ? '(done)' : st.cursor}\n`);
}

function verbRework(opts) {
  const payload = requireStdinFlag('rework', opts);
  const st = readState();
  if (!st) die('rework failed: no active flow');
  runGuards(st);
  const to = requireString('rework', payload, 'to');
  const feedback = requireString('rework', payload, 'feedback');
  const consent = requireString('rework', payload, 'consent');
  const toIdx = st.items.findIndex(i => i.id === to);
  if (toIdx < 0) die(`rework failed: unknown item "${to}"`);
  const ciIdx = cursorIndex(st);
  if (toIdx > ciIdx) die(`rework failed: "${to}" is ahead of the cursor (rework only goes backward)`);
  const invalidated = [];
  for (let i = toIdx; i < st.items.length; i++) {
    const it = st.items[i];
    if (i === toIdx) {
      it.revision += 1;
      it.status = 'in_progress';
      it.artifact_hashes = [];
      invalidated.push(it.id);
    } else if (it.status !== 'pending') {
      it.revision += 1;
      it.status = 'pending';
      it.artifact_hashes = [];
      invalidated.push(it.id);
    }
  }
  st.cursor = to;
  const target = st.items[toIdx];
  const ts = new Date().toISOString();
  st.feedbacks = st.feedbacks || [];
  st.feedbacks.push({ item: to, revision: target.revision, kind: 'rework', text: feedback, ts });
  writeState(st);
  appendAudit(st.flow_id, 'REWORK', to, { to, invalidated, feedback, consent });
  process.stdout.write(`rework: cursor -> ${to} (r${target.revision}); invalidated: ${invalidated.join(', ')}\n`);
}

function sameDef(a, b) {
  return a.kind === b.kind && a.check === b.check &&
    stableStringify(a.artifacts) === stableStringify(b.artifacts) &&
    stableStringify(a.write_globs) === stableStringify(b.write_globs);
}

function verbAmend(opts) {
  const payload = requireStdinFlag('amend', opts);
  const st = readState();
  if (!st) die('amend failed: no active flow');
  runGuards(st);
  const consent = requireString('amend', payload, 'consent');
  if (!payload.config) die('amend failed: payload field "config" is required');
  const v = validateConfig(payload.config);
  if (!v.ok) die('amend failed: invalid config:\n' + v.errors.map(e => '  - ' + e).join('\n'));
  const cfg = v.normalized;

  const newList = [];
  const existingUnits = st.items.filter(i => i.kind === 'unit');
  for (const s of cfg.stages) {
    if (s.kind === 'implement_placeholder') {
      if (cfg.units) {
        for (const u of cfg.units) {
          const id = `implement:${u.id}`;
          const ex = st.items.find(i => i.id === id);
          const ni = makeUnitItem(u, st.flow_id, ex ? ex.revision : 1);
          if (ex && ex.status !== 'pending') {
            if (!sameDef(ex, ni)) die(`amend failed: cannot modify non-pending item "${id}" (only pending items may change)`);
            newList.push(ex);
          } else if (ex) {
            ni.gate_seq = ex.gate_seq; ni.save_point = ex.save_point;
            newList.push(ni);
          } else {
            newList.push(ni);
          }
        }
      } else {
        newList.push(...existingUnits);
      }
      continue;
    }
    const ex = st.items.find(i => i.id === s.id);
    const ni = makeStageItem(s, st.flow_id);
    if (ex && ex.status !== 'pending') {
      if (!sameDef(ex, ni)) die(`amend failed: cannot modify non-pending item "${s.id}" (only pending items may change)`);
      newList.push(ex);
    } else if (ex) {
      ni.revision = ex.revision; ni.gate_seq = ex.gate_seq; ni.save_point = ex.save_point;
      newList.push(ni);
    } else {
      newList.push(ni);
    }
  }
  for (const ex of st.items) {
    if (!newList.some(n => n.id === ex.id)) {
      if (ex.status !== 'pending' || ex.save_point || auditHasAdvanced(st, ex.id)) {
        die(`amend failed: cannot remove non-pending item "${ex.id}"`);
      }
    }
  }
  if (!newList.some(n => n.id === st.cursor)) die('amend failed: the cursor item cannot be removed');
  // 全 unit の plan_globs ⊆ 新 work_roots を再検証（done 単位も含む）
  for (const u of newList.filter(i => i.kind === 'unit')) {
    const globs = u.plan_globs || u.write_globs.filter(g => !g.startsWith(DEVFLOW + '/'));
    for (const g of globs) {
      if (!isSubsetOfWorkRoots(g, cfg.work_roots)) {
        die(`amend failed: unit "${u.id}" write_glob "${g}" is not a subset of the new work_roots`);
      }
    }
  }
  st.items = newList;
  st.work_roots = cfg.work_roots;
  const phIdx = cfg.stages.findIndex(s => s.kind === 'implement_placeholder');
  st.implement_insert_before = phIdx >= 0 && cfg.stages[phIdx + 1] ? cfg.stages[phIdx + 1].id : null;
  writeFileSync(flowPaths(st.flow_id).config, JSON.stringify(cfg, null, 2) + '\n');
  writeState(st);
  appendAudit(st.flow_id, 'AMENDED', st.cursor, {
    consent, work_roots: cfg.work_roots, items: newList.map(i => i.id),
  });
  process.stdout.write(`amended: ${newList.length} item(s), work_roots=${cfg.work_roots.join(', ')}\n`);
}

function verbReviewPackage() {
  const st = readState();
  if (!st) die('review-package failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci || ci.kind !== 'review' || ci.status !== 'in_progress') {
    die('review-package failed: cursor must be the review item in_progress');
  }
  const rel = `${flowDirRel(st.flow_id)}/review/package-r${ci.revision}`;
  const dir = P(rel);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'interpretations'), { recursive: true });

  // 製品 diff（.devflow/** を除外）
  const diff = git(['diff', st.base_commit, 'HEAD', '--', '.', `:(exclude)${DEVFLOW}`]);
  if (diff.code !== 0) die(`review-package failed: git diff error: ${diff.err}`);
  writeFileSync(join(dir, 'diff.patch'), diff.out + (diff.out ? '\n' : ''));

  // SPEC / intent
  writeFileSync(join(dir, 'intent.txt'), st.intent + '\n');
  if (st.spec_path && existsSync(P(st.spec_path))) copyFileSync(P(st.spec_path), join(dir, 'spec.md'));

  // plan
  const planDir = `${flowDirRel(st.flow_id)}/artifacts/decompose`;
  for (const f of ['plan.md', 'plan.json']) {
    if (existsSync(P(planDir, f))) copyFileSync(P(planDir, f), join(dir, f));
  }

  // 全 interpretations（現 revision のファイル実体）
  for (const it of st.items) {
    if (it.id === ci.id) continue;
    const ip = it.artifacts.find(a => a.endsWith('interpretations.md'));
    if (ip && existsSync(P(ip))) {
      copyFileSync(P(ip), join(dir, 'interpretations', `${itemSlug(it.id)}.md`));
    }
  }

  // evidence 索引（各 item の現 revision のみ）
  const evIndex = st.items.map(it => ({
    item: it.id, revision: it.revision,
    evidence: st.evidence.filter(e => e.item === it.id && e.revision === it.revision)
      .map(e => ({ cmd: e.cmd, exit: e.exit, log: e.log, ts: e.ts })),
  }));
  writeFileSync(join(dir, 'evidence.json'), JSON.stringify(evIndex, null, 2) + '\n');

  const manifest = {
    flow_id: st.flow_id, review_item: ci.id, revision: ci.revision,
    base_commit: st.base_commit, head: git(['rev-parse', 'HEAD']).out,
    generated_at: new Date().toISOString(),
    inputs: ['diff.patch', 'intent.txt']
      .concat(st.spec_path ? ['spec.md'] : [])
      .concat(existsSync(P(planDir, 'plan.md')) ? ['plan.md'] : [])
      .concat(existsSync(P(planDir, 'plan.json')) ? ['plan.json'] : [])
      .concat(['interpretations/', 'evidence.json']),
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`review package: ${rel}\n`);
}

function verbFindingsRecord(opts) {
  const payload = requireStdinFlag('findings-record', opts);
  const st = readState();
  if (!st) die('findings-record failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci || ci.kind !== 'review' || ci.status !== 'in_progress') {
    die('findings-record failed: cursor must be the review item in_progress');
  }
  const findings = payload.findings;
  const findingsMd = payload.findings_md;
  const interpretationsMd = payload.interpretations_md;
  const errors = [];
  errors.push(...validateFindings(findings, st));
  if (typeof findingsMd !== 'string' || findingsMd.trim() === '') errors.push('"findings_md" must be a non-empty string');
  if (typeof interpretationsMd !== 'string' || interpretationsMd.trim() === '') {
    errors.push('"interpretations_md" must be a non-empty string');
  } else {
    const iv = validateInterpretations(interpretationsMd);
    if (!iv.ok) errors.push(...iv.errors.map(e => `interpretations_md: ${e}`));
  }
  if (errors.length) {
    try {
      appendAudit(st.flow_id, 'FINDINGS_LINT_FAILED', ci.id,
        { revision: ci.revision, errors }, false);
    } catch { /* noop */ }
    die('findings-record failed:\n' + errors.map(e => '  - ' + e).join('\n'));
  }
  // bookkeeper 自身が review stage の artifacts を書く
  const dir = P(`${flowDirRel(st.flow_id)}/artifacts/${itemSlug(ci.id)}`);
  mkdirSync(dir, { recursive: true });
  const canonical = findings.map(f => ({
    id: f.id, severity: f.severity, kind: f.kind, claim: f.claim, evidence: f.evidence,
    ...(f.suggested_rework_to !== undefined ? { suggested_rework_to: f.suggested_rework_to } : {}),
  }));
  writeFileSync(join(dir, 'findings.json'), JSON.stringify({ revision: ci.revision, findings: canonical }, null, 2) + '\n');
  writeFileSync(join(dir, 'findings.md'), findingsMd.endsWith('\n') ? findingsMd : findingsMd + '\n');
  writeFileSync(join(dir, 'interpretations.md'), interpretationsMd.endsWith('\n') ? interpretationsMd : interpretationsMd + '\n');
  // state へ記録（現 revision の既存記録は置き換え）
  st.findings = (st.findings || []).filter(f => !(f.item === ci.id && f.revision === ci.revision));
  for (const f of canonical) {
    st.findings.push({ ...f, item: ci.id, revision: ci.revision, resolution: null });
  }
  writeState(st);
  appendAudit(st.flow_id, 'FINDINGS_RECORDED', ci.id, {
    revision: ci.revision, count: canonical.length, ids: canonical.map(f => f.id),
  });
  process.stdout.write(`findings recorded: ${canonical.length} finding(s) for ${ci.id} r${ci.revision}\n`);
}

function verbFindingResolve(opts) {
  const payload = requireStdinFlag('finding-resolve', opts);
  const st = readState();
  if (!st) die('finding-resolve failed: no active flow');
  runGuards(st);
  const ci = cursorItem(st);
  if (!ci || ci.kind !== 'review') die('finding-resolve failed: cursor must be the review item');
  const id = requireString('finding-resolve', payload, 'id');
  const reason = requireString('finding-resolve', payload, 'reason');
  const consent = requireString('finding-resolve', payload, 'consent');
  const action = payload.action;
  if (action !== 'fix' && action !== 'accept') die('finding-resolve failed: "action" must be "fix" or "accept"');
  const f = (st.findings || []).find(x => x.item === ci.id && x.revision === ci.revision && x.id === id);
  if (!f) die(`finding-resolve failed: unknown finding "${id}" for ${ci.id} r${ci.revision}`);
  if (f.resolution) die(`finding-resolve failed: finding "${id}" is already resolved (${f.resolution.action})`);
  f.resolution = { action, reason, consent, ts: new Date().toISOString() };
  writeState(st);
  appendAudit(st.flow_id, 'FINDING_RESOLVED', ci.id, {
    revision: ci.revision, finding: id, action, reason, consent,
  });
  process.stdout.write(`finding ${id}: ${action}\n`);
}

function verbLearn(opts) {
  const payload = requireStdinFlag('learn', opts);
  const st = readState();
  if (!st) die('learn failed: no active flow');
  runGuards(st);
  const consent = requireString('learn', payload, 'consent');
  const hasCandidate = payload.candidate !== undefined;
  const hasFreeText = payload.free_text !== undefined;
  if (hasCandidate === hasFreeText) {
    die('learn failed: pass exactly one of "candidate" (cid) or "free_text"');
  }
  let cid, text;
  if (hasCandidate) {
    const wanted = requireString('learn', payload, 'candidate');
    const c = (st.learn_candidates || []).find(x => x.cid === wanted);
    if (!c) die(`learn failed: unknown candidate cid "${wanted}"`);
    cid = c.cid;
    text = c.text; // 登録済みの逐語をそのまま（flow skill は本文を生成しない）
  } else {
    text = requireString('learn', payload, 'free_text'); // 人間の発言逐語
    cid = `ft-${st.learn_seq++}`;
  }
  if (text.includes('\n')) die('learn failed: learned text must be a single line');
  const marker = `<!-- cid:${st.flow_id}:${cid} -->`;
  const dv = devflowPaths();
  const existing = existsSync(dv.memory) ? readFileSync(dv.memory, 'utf8') : '';
  if (existing.includes(marker)) die(`learn failed: cid "${cid}" is already persisted in memory.md (idempotent append refused)`);
  const date = new Date().toISOString().slice(0, 10);
  const line = `- ${text} (learned ${date}) ${marker}\n`;
  mkdirSync(dv.root, { recursive: true });
  if (!existsSync(dv.gitignore)) writeFileSync(dv.gitignore, GITIGNORE_CONTENT);
  writeFileSync(dv.memory, existing + (existing && !existing.endsWith('\n') ? '\n' : '') + line);
  // memory 専用ローカルコミット（memory.md と .devflow/.gitignore のみをステージ）
  const add = git(['add', '--', `${DEVFLOW}/memory.md`, `${DEVFLOW}/.gitignore`]);
  if (add.code !== 0) die(`learn failed: git add error: ${add.err}`);
  const cm = git(['commit', '-q', '-m', `flow: learn ${cid} (${st.flow_id})`]);
  if (cm.code !== 0) die(`learn failed: git commit error: ${cm.err}`);
  const sha = git(['rev-parse', 'HEAD']).out;
  writeState(st); // learn_seq / candidates の消費を反映
  appendAudit(st.flow_id, 'LEARNED', st.cursor, { cid, text, consent, commit: sha });
  process.stdout.write(`learned: ${cid} -> memory.md (commit ${sha.slice(0, 7)})\n`);
}

function verbDoctor() {
  const results = [];
  const push = (ok, label, detail = '') => results.push({ ok, label, detail });
  const dv = devflowPaths();
  if (!existsSync(dv.root)) {
    process.stdout.write('doctor: no .devflow/ (nothing to diagnose)\n');
    return;
  }
  const curExists = existsSync(dv.current);
  const id = currentFlowId();
  if (!id) {
    push(true, 'current', curExists ? 'no active flow (cleared)' : 'no current file (no active flow)');
  } else {
    const fp = flowPaths(id);
    push(existsSync(fp.dir), `current -> ${flowDirRel(id)}`, existsSync(fp.dir) ? '' : 'flow directory missing');
    let st = null;
    if (existsSync(fp.state)) {
      try { st = JSON.parse(readFileSync(fp.state, 'utf8')); push(true, 'state.json parses'); }
      catch (e) { push(false, 'state.json parses', e.message); }
    } else push(false, 'state.json exists', 'missing');
    if (st) {
      push(st.flow_id === id, 'state.flow_id matches current', `state=${st.flow_id}`);
      push(st.status === 'active', 'flow status is active', `status=${st.status} (done flows must have current cleared)`);
      const chain = verifyAuditChain(id);
      push(chain.ok, 'audit chain integrity (full recompute)', chain.reason || '');
      const ci = cursorItem(st);
      push(Boolean(ci), 'cursor item exists', st.cursor);
      if (ci) {
        const bs = boundaryScan(st);
        push(bs.ok, 'boundary scan (.devflow excluded)', bs.violations.join(', '));
        const ah = verifyArtifactHashes(st);
        push(ah.ok, 'gate artifact hashes', ah.mismatches.join(', '));
        if (ci.status === 'gate_open') {
          const cardRel = gateCardRelPath(st, ci);
          push(existsSync(P(cardRel)), 'current gate card exists', cardRel);
          const att = hasValidAttestation(st, ci);
          push(true, 'presented attestation', att.ok ? 'present' : `not yet presented (${att.reason})`);
        }
      }
      // presented.jsonl の整合（行が壊れていない・カード参照が実在する）
      const pres = readPresented(id);
      const raw = existsSync(fp.presented)
        ? readFileSync(fp.presented, 'utf8').split('\n').filter(Boolean).length : 0;
      push(pres.length === raw, 'presented.jsonl lines parse', `${pres.length}/${raw}`);
    }
  }
  // memory.md の cid 重複
  if (existsSync(dv.memory)) {
    const cids = [...readFileSync(dv.memory, 'utf8').matchAll(/<!-- cid:([^ ]+) -->/g)].map(m => m[1]);
    const dup = cids.filter((c, i) => cids.indexOf(c) !== i);
    push(dup.length === 0, 'memory.md cid uniqueness', dup.join(', '));
  }
  let failed = 0;
  for (const r of results) {
    if (!r.ok) failed++;
    process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'} ${r.label}${r.detail ? ': ' + r.detail : ''}\n`);
  }
  process.stdout.write(failed ? `doctor: FAIL (${failed})\n` : 'doctor: PASS\n');
  if (failed) process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI ディスパッチ
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {}; const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { opts[key] = true; }
      else { opts[key] = next; i++; }
    } else rest.push(a);
  }
  return { opts, rest };
}

function main() {
  const [verb, ...args] = process.argv.slice(2);
  const { opts } = parseArgs(args);
  switch (verb) {
    case 'config-lint': return verbConfigLint(opts);
    case 'init': return verbInit(opts);
    case 'status': return verbStatus(opts);
    case 'plan-lint': return verbPlanLint(opts);
    case 'findings-lint': return verbFindingsLint(opts);
    case 'gate-open': return verbGateOpen();
    case 'approve': return verbApprove(opts);
    case 'reject': return verbReject(opts);
    case 'advance': return verbAdvance();
    case 'rework': return verbRework(opts);
    case 'amend': return verbAmend(opts);
    case 'review-package': return verbReviewPackage();
    case 'findings-record': return verbFindingsRecord(opts);
    case 'finding-resolve': return verbFindingResolve(opts);
    case 'learn': return verbLearn(opts);
    case 'doctor': return verbDoctor();
    default:
      die(`unknown verb: ${verb || '(none)'}\n` +
        'usage: flow.mjs <config-lint|init|status|plan-lint|findings-lint|gate-open|approve|reject|advance|' +
        'rework|amend|review-package|findings-record|finding-resolve|learn|doctor> [--stdin] [--json]');
  }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  // 出力先が早期に閉じても（`flow status | head` 等）クラッシュしない。
  process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });
  main();
}
