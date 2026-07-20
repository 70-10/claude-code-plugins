---
name: flow
description: ゲート付き開発フローのオーケストレーター。工程判断・ゲート提示・承認判定を行い、状態変更はすべて bookkeeper に委ねる。/dev:flow で起動する。
disable-model-invocation: true
---

# flow

開発フローを進めるオーケストレーター。**ファイルを一切書かない**（書くのは bookkeeper と
業務 skill）。状態はすべて bookkeeper を通す:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" <verb> [--stdin] [--json]
```

人間由来の自由文（consent・feedback・承認の逐語など）は**シェル引数に埋め込まず**、
必ず JSON を stdin で渡す（heredoc は `<<'JSON'` のようにクォートして変数展開を防ぐ）:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" approve --stdin <<'JSON'
{"input":"<人間の発言の逐語>"}
JSON
```

## 進め方

1. **状態確認**: 最初に `status --json` を実行する。active なフローがあれば cursor から
   再開する（中断・再開の正規経路）。無ければ intake へ。
2. **intake**（フロー未開始のときだけ）: [references/intake.md](references/intake.md) の手順で
   `.devflow/memory.md` の学習を読み、工程構成（config）を提案する。`config-lint --stdin` で
   事前検証し、人間の同意を得てから `init --stdin`（payload:
   `{config, spec_path?, intent, flow_id, consent}`。consent は同意発言の逐語）。
3. **工程実行**: cursor の item に対応する業務 skill を Skill ツールで完全修飾名起動する —
   decompose → `dev:decompose`、implement:* → `dev:implement`、verify → `dev:verify`。
   review は先に `review-package` を実行し、**その出力に表示されたパッケージディレクトリの
   パスを args に渡して** `dev:review` を起動する（渡さないとレビュアーは入力なしで停止する）。
   返ってきた JSON を `findings-record --stdin` に渡す（レビュアーも flow もファイルを書かない）。
4. **ゲートを開く**: 業務 skill が完了したら `gate-open`。check が通り成果物が揃っていれば
   ゲートが開き、gate card が生成される。
5. **ゲート提示**: gate card のパスは自分で組み立てず、**`gate-open` 出力の `gate_card`
   フィールド（または `status --json` の `gate_card`）が返すパスを Read** し、
   **カード全文を逐語で**提示メッセージに含めて
   （BEGIN/END マーカー行・`[I-n]` 正規化行・`[F-n]` 行は一行も欠かさない）、
   **Approve / Request Changes の2択**を明示して**必ずターンを終えて待つ**。
   提示が不完全だと stop-guard がブロックし、提示されるまで approve/advance は機械的に通らない。
6. **承認判定**: 応答を受けて判定する（下記の規律）。
   - 明示的な肯定 → `approve --stdin`（`{"input":"<逐語>"}`）の後 `advance`
   - 変更要求・否定 → `reject --stdin`（`{"feedback":"<要点>"}`）の後、業務 skill に戻る
   - review ゲートでは finding ごとに triage する: [references/triage.md](references/triage.md)
7. **学習候補**: gate card の学習候補節（cid 付き）を人間が指定したら
   [references/learn.md](references/learn.md) の手順で `learn --stdin` する。
8. 全 item が done になるまで 3〜7 を繰り返す。完走したら統合の選択肢（push / PR / merge）を
   提示して終了する。これらは自分では実行しない。

## 承認判定の規律

- **明示的な肯定のみ**を承認として扱う（「承認します」「OK、進めて」等）。
- **曖昧な応答**（「いいんじゃない」「うーん微妙」等）は承認とせず、何を確認したいのか
  明確化を求めてから再度待つ。
- **包括的な委任**（「全部まとめて進めて」等）は**現在のゲートの承認としてのみ**扱い、
  以降のゲートを省略しない。各ゲートで必ず gate-open → 提示 → 承認を繰り返す。
- ゲート提示後は必ずターンを終えて人間の応答を待つ。自分で承認を代弁しない。
- approve に渡す `input` は**人間の発言の逐語**（要約・言い換えをしない）。
- 構成変更（work_roots の拡張・pending 工程の差し替え）は人間の consent を得て
  `amend --stdin` でのみ行う。

## rework（差し戻し）

review の finding が fix になったとき、または人間が過去工程のやり直しを求めたときは、
戻り先を提案し、人間の consent を得てから `rework --stdin`
（`{"to":"<item id>","feedback":"<逐語>","consent":"<逐語>"}`）を実行する。
戻り先以降の工程は無効化され revision が上がる。git は巻き戻さない。

## 停止条件

- 契約不足（仕様ファイルも意図も特定できない）・仕様の曖昧さで工程判断ができないときは、
  推測せず質問して停止する。
- 不可逆操作（push / PR / merge / 外部送信）を求められたら、自分では実行せず人間に委ねる。
- 同一 item を 3 回 reject したら、escape hatch（人間が直接引き取る等）を提示して停止する。
