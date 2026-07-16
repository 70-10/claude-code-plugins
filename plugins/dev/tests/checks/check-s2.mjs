// S2: 中断・再開が正しく行われたかを機械判定する（revision 対応版）。
// 使い方: node check-s2.mjs --dir <run-worktree> [--flow <id>] [--resume-item <id>]
// - 同一 revision 内で done item の再実装がない（item×revision のゲートサイクルは1回）
// - ゲートは cursor 順で進む（工程飛ばしがない）
// - --resume-item を渡すと「再開後の最初のゲートが次 item」を追加検証する
import { parseDir, detectFlowId, readAudit, readState, report } from './lib.mjs';

const dir = parseDir(process.argv);
const flowId = detectFlowId(dir);
const ri = process.argv.indexOf('--resume-item');
const resumeItem = ri >= 0 ? process.argv[ri + 1] : null;

const audit = readAudit(dir, flowId);
const state = readState(dir, flowId);
const results = [];

const order = state.items.map(i => i.id);

// (1) 各 item×revision の ADVANCED は1回だけ（再実装なし）
{
  let ok = true; const bad = [];
  const advCount = {};
  for (const l of audit.filter(x => x.event === 'ADVANCED')) {
    const key = `${l.item}@r${l.data.revision}`;
    advCount[key] = (advCount[key] || 0) + 1;
  }
  for (const [key, n] of Object.entries(advCount)) if (n !== 1) { ok = false; bad.push(`${key}=${n}`); }
  results.push({ ok, label: '(1) each item+revision advanced exactly once (no re-implementation)', detail: bad.join(',') });
}

// (2) 同一 revision 世代内の ADVANCED の順序が最終 item 順に一致（工程飛ばしなし）
//     REWORK を跨がない区間ごとに検査する。
{
  let ok = true; const bad = [];
  let segment = [];
  const segments = [segment];
  for (const l of audit) {
    if (l.event === 'REWORK') { segment = []; segments.push(segment); continue; }
    if (l.event === 'ADVANCED') segment.push(l.item);
  }
  for (const seg of segments) {
    const inOrder = seg.filter(id => order.includes(id));
    const expected = order.filter(id => inOrder.includes(id));
    if (JSON.stringify(inOrder) !== JSON.stringify(expected)) { ok = false; bad.push(seg.join('>')); }
  }
  results.push({ ok, label: '(2) ADVANCED order matches cursor order within each rework segment', detail: bad.join(' | ') });
}

// (3) done item への操作が、その item×revision の ADVANCED より後に無い（REWORK 以外）
{
  let ok = true; const bad = [];
  for (const it of state.items) {
    for (let rev = 1; rev <= it.revision; rev++) {
      const adv = audit.find(x => x.event === 'ADVANCED' && x.item === it.id && x.data.revision === rev);
      if (!adv) continue;
      const laterOps = audit.filter(x => x.seq > adv.seq && x.item === it.id &&
        ['GATE_OPEN', 'APPROVED', 'ADVANCED'].includes(x.event) && x.data.revision === rev);
      if (laterOps.length) { ok = false; bad.push(`${it.id}@r${rev}`); }
    }
  }
  results.push({ ok, label: '(3) no operation on a done item+revision after its ADVANCED', detail: bad.join(',') });
}

// (4) --resume-item: 再開後（その item の ADVANCED 以降）の最初のゲートが次 item
if (resumeItem) {
  const adv = audit.find(x => x.event === 'ADVANCED' && x.item === resumeItem);
  const idx = order.indexOf(resumeItem);
  const expectedNext = order[idx + 1];
  const firstGateAfter = audit.find(x => adv && x.seq > adv.seq && x.event === 'GATE_OPEN');
  const ok = !!adv && !!firstGateAfter && firstGateAfter.item === expectedNext;
  results.push({ ok, label: `(4) first gate after resume-item(${resumeItem}) is ${expectedNext}`, detail: firstGateAfter ? `got=${firstGateAfter.item}` : 'no gate after resume' });
}

report('S2', results);
