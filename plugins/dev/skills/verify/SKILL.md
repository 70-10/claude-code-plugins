---
name: verify
description: 全テストを実行し、仕様項目とテストの対応（カバレッジ）を突合して report.md を生成する。dev:flow オーケストレーターの工程として起動される。
user-invocable: false
---

# verify

全テストを実行し、仕様（または意図）が満たされているかを突合する。**実装は直さない**
（欠落を見つけたら報告して止まる。修正は rework 経路のみ）。active なフローと所定の入力
（`node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" status --json` で確認）が無ければ停止する。

## 入力

`status --json` の出力が正: `spec_path` / `intent`・cursor item（verify）の `check` /
`artifacts` / `write_globs`。plan があれば decompose の成果物も Read する。

## 成果物

cursor item の `artifacts` に列挙されたパス（report.md と interpretations.md）。
書いてよいのは cursor item の `write_globs` 内のみ。

report.md には:

- 仕様・意図の各項目を列挙する
- 各項目に対応するテストを対応づける
- 全テストを実行した結果（証拠ログへの参照付き）
- カバレッジの欠落（テストのない項目）があれば明記する

### interpretations.md（未指定事項の解釈記録）

仕様に明記されていない事項について解釈・仮定・選択を行ったら、その場で記録する。
**エントリは次の機械可読形式を必須とする**（gate-open が形式検証する）:

```interpretations
## I-1: <未指定点の一行> [ADR候補]
- 未指定: <一行>
- 解釈: <一行>
- 理由: <一行>
```

- 番号 `I-<n>` は一意にする。4行目以降に補足の自由記述を続けてよい。
- `[ADR候補]` タグは「可逆困難・文脈なしでは驚く・実質的トレードオフ」の3条件を満たすと
  判断した場合のみ付ける（任意）。
- **解釈が1つもない場合は本文に「暗黙の解釈なし」とだけ書く**。

## 停止条件

- カバレッジ欠落を発見したら、report.md に記録して報告し停止する。自分で実装を直さない。
- 仕様外の判断・不可逆操作が必要になったら停止する。技術的に行き詰まったら停止する。
