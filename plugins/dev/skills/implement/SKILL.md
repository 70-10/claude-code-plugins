---
name: implement
description: 現在の実装単位のみを実装し、単位のテストを書いて check をローカルで通す。dev:flow オーケストレーターの工程として起動される。
user-invocable: false
---

# implement

cursor が指す実装単位（`implement:<id>`）**だけ**を実装する。他の単位や工程の仕事には
手を出さない。active なフローと所定の入力
（`node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" status --json` で確認）が無ければ停止する。

## 入力

`status --json` の出力が正: cursor item の `title` / `check` / `write_globs` / `artifacts`、
`spec_path` / `intent`。plan の詳細が必要なら decompose の成果物（plan.md）を Read する。

## 成果物

製品コードとテスト。**書いてよいのは cursor item の `write_globs` 内のみ**
（範囲外への書き込みは hook と bookkeeper が拒否する）。加えて cursor item の `artifacts`
に列挙された interpretations.md を書く（保存先 glob は write_globs に自動追加済み）。

## 進め方

1. `status --json` から当該単位の定義を読む。
2. 仕様・意図の該当部分を、単位の glob 内に実装する。
3. 単位のテストを書く（一時ディレクトリを使い実ファイルを汚さない）。
4. 単位の `check` コマンドをローカルで実行し、exit 0 になるまで直す。

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

- check が通ったら停止する（ゲートを開くのはオーケストレーターの責務）。
- 仕様外の判断が必要になったら、推測せず質問して停止する。
- 不可逆・高リスクの操作が必要になったら停止する。技術的に行き詰まったら停止する。
