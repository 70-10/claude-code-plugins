// E2E ドライラン本体: verb 直接呼び出しで decompose→U1→verify→review のミニフローを
// 機械的に完走させ、指定ディレクトリに .devflow / git 履歴を残す。
// checks.test.mjs（S1/S2/S4 の両側確認）と e2e.test.mjs から共用する。
import {
  setupRepo, run, initFlow, approve, reviewConfig,
  writeDecomposeArtifacts, writeVerifyArtifacts, writeU1Code, recordFindings,
} from './helpers.mjs';

// 承認文言: U1 のゲートで「包括委任」を使い、以降のゲートも個別承認されることを
// S4b が検証できるようにする。
const DELEGATION = '全部まとめて進めて';
export const FLOW_ID = 'e2e-dryrun';

export function buildE2E(dir) {
  setupRepo(dir);
  initFlow(dir, { flowId: FLOW_ID, config: reviewConfig() });

  // decompose（単位は U1 のみ。ミニフロー）
  writeDecomposeArtifacts(dir, {
    units: [{ id: 'U1', title: 'add', check: 'node --test test/add.test.mjs', write_globs: ['src/**', 'test/**', 'package.json'] }],
  }, FLOW_ID);
  run(dir, ['gate-open']);
  approve(dir, '承認します', FLOW_ID);
  run(dir, ['advance']); // -> implement:U1

  // implement U1（包括委任で承認）
  writeU1Code(dir, FLOW_ID);
  run(dir, ['gate-open']);
  approve(dir, DELEGATION, FLOW_ID);
  run(dir, ['advance']); // commit -> verify

  // verify
  writeVerifyArtifacts(dir, FLOW_ID);
  run(dir, ['gate-open']);
  approve(dir, '承認します', FLOW_ID);
  run(dir, ['advance']); // -> review

  // review（finding 1件を accept で triage）
  run(dir, ['review-package']);
  recordFindings(dir, [{
    id: 'F-1', severity: 'minor', kind: 'implicit-behavior',
    claim: '空入力はエラーになるが SPEC 未記載', evidence: 'src/add.mjs add()',
    suggested_rework_to: 'implement:U1',
  }]);
  run(dir, ['gate-open']);
  approve(dir, '承認します', FLOW_ID);
  run(dir, ['finding-resolve', '--stdin'], JSON.stringify({
    id: 'F-1', action: 'accept', reason: '意図的な安全側の挙動', consent: 'F-1 は許容で',
  }));
  run(dir, ['advance']); // -> done

  return { dir, delegation: DELEGATION, flowId: FLOW_ID };
}
