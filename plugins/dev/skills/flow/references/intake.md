# intake（工程構成の提案と同意）

フロー未開始のとき、init の前に行う。**intake ではファイルを書かない**（構成は stdin JSON
で bookkeeper に渡す）。

## 手順

1. **学習の適用**: `.devflow/memory.md` があれば Read し、過去フローの学習を今回の提案に
   反映する（学習の適用先は次回フロー＝ここだけ。実行中フローへは適用しない）。
2. **状況把握**: タスクの意図・仕様ファイルの有無・リポジトリ状況（テストの仕組み・
   ディレクトリ構成）を確認する。仕様ファイルも意図も特定できなければ質問して停止する。
3. **構成の提案**: 以下を人間が編集・承認しやすい形で提示する（形式は固定しない）。
   スキップ・軽量化にはすべて理由を付ける。
   - **入口契約**: 仕様ファイル必須か、意図記述のみで開始するか
   - **decompose の要否**: 単一単位のタスクは config に `units` をインライン定義して
     decompose を省略できる
   - **work_roots**: フロー全体の書き込み上限（glob 配列）。全 unit の write_globs は
     この部分集合であることが機械検証される
   - **各工程の check**（機械判定コマンド）と**レビュー観点数**
4. **事前検証**: 提案 config を `config-lint --stdin` に通し、エラーがあれば直してから提示する。

## config スキーマ

```json
{
  "schema": 1,
  "work_roots": ["src/**", "test/**", "package.json"],
  "stages": [
    { "id": "decompose", "kind": "stage", "check": "flow:plan-lint" },
    { "id": "__implement__", "kind": "implement_placeholder" },
    { "id": "verify", "kind": "stage", "artifacts": ["report.md"], "check": "<全テスト実行コマンド>" },
    { "id": "review", "kind": "review" }
  ]
}
```

- decompose を省略する場合は `"units": [{"id","title","check","write_globs"}]` を加え、
  decompose stage を外す（implement_placeholder は残す）。
- 各 stage の `interpretations.md` は bookkeeper が自動で宣言 artifacts に加える。
- 禁止 glob（裸の `**`・ワイルドカード開始・`.devflow/` `.claude/` `.git/` に触れるもの）は
  config-lint が拒否する。

## 同意と init

提案への同意（同意発言の逐語）を得てから:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" init --stdin <<'JSON'
{"config": { ... }, "spec_path": "SPEC.md", "intent": "<タスク意図>",
 "flow_id": "<一意な id>", "consent": "<同意発言の逐語>"}
JSON
```

- `flow_id` に使える文字は `^[A-Za-z0-9][A-Za-z0-9._-]*$`（パス安全な識別子）。
- config 内の unit `id` に使える文字は `^[A-Za-z0-9][A-Za-z0-9_-]*$`。

active なフローが存在する間、init は拒否される（前フローの完走または人間の判断が先）。
