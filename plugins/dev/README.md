# dev

ゲート付き開発フロー Plugin。intake（適応的な工程構成の提案・同意）→ decompose →
implement 単位ループ → verify → review（独立レビュー）→ 終端提示を、全工程・全単位の
人間ゲートと決定論ガード（監査チェーン・書き込み境界・提示忠実性の機械検査）付きで回す。

## 使い方

```
/dev:flow
```

- フロー未開始なら intake が始まる。仕様ファイル（あれば）とタスク意図を伝えると、
  工程構成（decompose の要否・work_roots・各工程の check）が提案される。同意すると開始。
- 各ゲートで gate card（成果物ハッシュ・interpretations 全文・evidence・変更ファイル・
  学習候補・findings）が逐語提示される。**Approve / Request Changes** で応答する。
  提示が不完全なままの承認・前進は bookkeeper が機械的に拒否する。
- 中断しても `/dev:flow` で cursor から再開できる（SessionStart hook が active フローを通知する）。
- 完走すると統合の選択肢（push / PR / merge）が提示される。実行は人間の領分。

状態は利用者プロジェクトの `.devflow/` に置かれる。git 追跡されるのは
`.devflow/memory.md`（フロー横断の学習）と `.devflow/.gitignore` のみで、
書き込みはすべて bookkeeper（`scripts/flow.mjs`）経由。hook は active なフローが
存在するときだけ判定し、フロー外の作業には干渉しない。

## 上流成果物の契約

このフローは「何を作るか」が決まってからの実行系。入口で受け取るもの:

- **仕様ファイル**（推奨）: 要件・完了条件が書かれた markdown 等。`spec_path` として記録され、
  verify のカバレッジ突合と review の適合判定の基準になる。
- **意図記述のみ**でも開始できる（intake で「入口契約」として明示的に選ぶ）。基準が弱くなる分、
  interpretations（未指定事項の解釈記録）に判断が集まる。

## thinking plugin との接続例

上流の知識労働は [thinking plugin](../thinking/) が担う。典型的な接続:

1. `/thinking:elaborate` で要件・概念設計を対話で固める → 仕様ファイルに保存
2. `/dev:flow` にその仕様ファイルを渡して実行系を回す

`/thinking:brief` の成果物（要求・完了条件・実装方針）を仕様ファイルとして渡す形でもよい。

## ADR について

gate card の「未解決事項・ADR 候補」節に、`[ADR候補]` タグ付きの解釈
（可逆困難・文脈なしでは驚く・実質的トレードオフの3条件を満たすもの）が列挙される。
本 plugin は**候補の提案まで**を担い、ADR 本文は作成しない。採用する場合は手元の ADR 手段
（例: リポジトリの `docs/adr/` テンプレート、[dr plugin](../dr/) による Decision Record 生成、
`adr-tools` など）で人間が起票する。

## 構成

```
skills/flow          オーケストレーター（/dev:flow。ファイルを書かない）
skills/decompose     分解（plan.md / plan.json / interpretations.md）
skills/implement     単位実装（write_globs 内のみ）
skills/verify        全テスト・カバレッジ突合（実装は直さない）
skills/review        独立レビュー（context: fork + agent: Explore。読み取り専用）
scripts/flow.mjs     bookkeeper（状態機械・ガード・verb。依存パッケージなし）
scripts/hooks/       guard-write / guard-bash / boundary-scan / stop-guard / session-start
tests/               node:test スイート（`node --test plugins/dev/tests/`）
```
