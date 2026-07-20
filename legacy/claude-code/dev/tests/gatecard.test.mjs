// gate card 生成と正規化行（§7）・interpretations 形式検証（§6）の pass/fail 両側 +
// 各 SKILL.md 記載テンプレの fixture が形式検証を pass すること。
import { test } from 'node:test';
import assert from 'node:assert';
import { rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  setupRepo, run, initFlow, readState, item,
  writeDecomposeArtifacts, writeInterp, flowDir, PLUGIN_ROOT,
} from './helpers.mjs';
import { validateInterpretations, normalizedLines, gateCardRequiredLines } from '../scripts/flow.mjs';

function cleanup(tmp) { rmSync(tmp, { recursive: true, force: true }); }

const INTERP = [
  '## I-1: 保存形式が未指定 [ADR候補]',
  '- 未指定: 保存形式',
  '- 解釈: JSON を採る',
  '- 理由: 依存なしで扱えるため',
  '',
  '補足: 将来 sqlite へ移行しうる。',
  '',
  '## I-2: 空入力の扱い',
  '- 未指定: 空入力',
  '- 解釈: エラーにする',
  '- 理由: 仕様の安全側',
  '',
].join('\n');

test('gate card: generated with markers, normalized lines, hashes, evidence, ADR section', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  writeInterp(tmp, 'decompose', INTERP);
  const r = run(tmp, ['gate-open']);
  assert.equal(r.status, 0, r.stderr);
  const cardPath = join(flowDir(tmp), 'gate-cards', 'decompose-r1-1.md');
  const card = readFileSync(cardPath, 'utf8');
  assert.ok(card.includes('<!-- GATE-CARD BEGIN flow=run1 item=decompose revision=1 seq=1 -->'));
  assert.ok(card.includes('<!-- GATE-CARD END flow=run1 item=decompose revision=1 seq=1 -->'));
  for (const line of [
    '[I-1] 未指定: 保存形式', '[I-1] 解釈: JSON を採る', '[I-1] 理由: 依存なしで扱えるため',
    '[I-2] 未指定: 空入力', '[I-2] 解釈: エラーにする', '[I-2] 理由: 仕様の安全側',
  ]) assert.ok(card.includes(line), line);
  assert.ok(card.includes(INTERP.trim()), 'full verbatim interpretations text');
  assert.match(card, /- \.devflow\/flows\/run1\/artifacts\/decompose\/plan\.json sha256=[0-9a-f]{64}/);
  assert.match(card, /- check: flow:plan-lint/);
  assert.match(card, /- exit: 0/);
  assert.ok(card.includes('- I-1 [ADR候補] 保存形式が未指定'), 'ADR candidate section');
  // 検査集合の決定論抽出: マーカー2 + 正規化 6 行
  const req = gateCardRequiredLines(card);
  assert.equal(req.length, 8);
  cleanup(tmp);
});

test('gate card: re-gate-open produces a new seq card', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  run(tmp, ['gate-open']);
  run(tmp, ['reject', '--stdin'], JSON.stringify({ feedback: 'x' }));
  run(tmp, ['gate-open']);
  assert.equal(item(tmp, 'decompose').gate_seq, 2);
  const card = readFileSync(join(flowDir(tmp), 'gate-cards', 'decompose-r1-2.md'), 'utf8');
  assert.ok(card.includes('seq=2'));
  cleanup(tmp);
});

test('validateInterpretations: pass sides', () => {
  // 通常エントリ + ADR タグ + 補足自由記述
  let v = validateInterpretations(INTERP);
  assert.ok(v.ok, JSON.stringify(v.errors));
  assert.equal(v.entries.length, 2);
  assert.equal(v.entries[0].adr, true);
  assert.equal(v.entries[1].adr, false);
  assert.deepEqual(normalizedLines(v.entries).length, 6);
  // ゼロ件
  v = validateInterpretations('暗黙の解釈なし\n');
  assert.ok(v.ok);
  assert.equal(v.entries.length, 0);
  // 任意セクション（自由記述）は許容
  v = validateInterpretations('暗黙の解釈なし\n\n## 未解決事項\n- なし\n');
  assert.ok(v.ok, JSON.stringify(v.errors));
});

test('validateInterpretations: fail sides (Default-FAIL at gate-open)', () => {
  for (const [text, re] of [
    ['メモだけ書いた\n', /暗黙の解釈なし/],
    ['## I-1: x\n- 未指定: a\n- 解釈: b\n', /- 理由/],
    ['## I-1: x\n- 解釈: b\n- 未指定: a\n- 理由: c\n', /- 未指定/],
    ['## I-1: x\n- 未指定: a\n- 解釈: b\n- 理由: \n', /- 理由/],
    ['## I-1: x\n- 未指定: a\n- 解釈: b\n- 理由: c\n\n## I-1: y\n- 未指定: a\n- 解釈: b\n- 理由: c\n', /duplicate/],
    ['## I-abc: x\n- 未指定: a\n- 解釈: b\n- 理由: c\n', /heading/],
  ]) {
    const v = validateInterpretations(text);
    assert.equal(v.ok, false, text);
    assert.ok(v.errors.some(e => re.test(e)), `${text} -> ${v.errors.join(' | ')}`);
  }
});

test('gate-open FAILs on malformed interpretations', () => {
  const tmp = setupRepo();
  initFlow(tmp);
  writeDecomposeArtifacts(tmp);
  writeInterp(tmp, 'decompose', '## I-1: x\n- 未指定: a\n- 解釈: b\n'); // 理由欠落
  const r = run(tmp, ['gate-open']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /interpretations format invalid/);
  assert.notEqual(item(tmp, 'decompose').status, 'gate_open');
  cleanup(tmp);
});

// 各 SKILL.md 記載のテンプレどおりの入力が形式検証を pass する（記載間の差異による事故防止）。
test('SKILL.md interpretations templates: every fenced template passes validation and is identical', () => {
  const blocks = {};
  for (const skill of ['decompose', 'implement', 'verify', 'review']) {
    const md = readFileSync(join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    const m = [...md.matchAll(/```interpretations\n([\s\S]*?)```/g)];
    assert.ok(m.length >= 1, `${skill}/SKILL.md must contain an \`\`\`interpretations template`);
    for (const [, body] of m) {
      const v = validateInterpretations(body);
      assert.ok(v.ok, `${skill} template must pass: ${JSON.stringify(v.errors)}`);
      assert.equal(v.entries.length, 1);
    }
    blocks[skill] = m[0][1];
  }
  const texts = Object.values(blocks);
  for (const t of texts) assert.equal(t, texts[0], 'templates must be identical across SKILL.md files');
  // ゼロ件時の文言も全 SKILL.md に記載されている
  for (const skill of ['decompose', 'implement', 'verify', 'review']) {
    const md = readFileSync(join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    assert.ok(md.includes('暗黙の解釈なし'), `${skill}/SKILL.md must mention the zero-entry phrase`);
  }
});

// review/SKILL.md のテキスト契約: severity 判定基準ブロックと finding ゼロ件時の
// findings_md 規定が存在する（seeded eval で判明した「severity 基準の欠落 → 較正不能」
// と「空 findings_md の Default-FAIL」の再発防止）。
test('review/SKILL.md text contract: severity criteria block and zero-finding findings_md rule', () => {
  const md = readFileSync(join(PLUGIN_ROOT, 'skills', 'review', 'SKILL.md'), 'utf8');
  // severity は「結果の影響」で判定し、blocker / major / minor の基準が個別に定義されている
  assert.ok(md.includes('`severity` は**結果の影響**で判定する'),
    'severity must be judged by impact, not by defect category name');
  for (const level of ['**blocker**:', '**major**:', '**minor**:']) {
    assert.ok(md.includes(level), `severity criteria for ${level} must be defined`);
  }
  assert.ok(md.includes('一貫させる'), 'cross-finding consistency instruction must be present');
  // finding ゼロ件でも findings_md を空にしない規定（空文字は findings-record が拒否する）
  assert.ok(md.includes('`findings_md` は空にせず'),
    'zero-finding case must still require a non-empty findings_md');
});
