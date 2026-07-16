---
name: decompose
description: 仕様・意図を実装単位に分解し、plan.md / plan.json / interpretations.md を生成する。dev:flow オーケストレーターの工程として起動される。
user-invocable: false
---

# decompose

仕様（または意図記述）を実装単位に分解する。active なフローと所定の入力
（`node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" status --json` で確認）が無ければ停止する。

## 入力

`status --json` の出力が正: `spec_path`（あれば Read する）・`intent`・`work_roots`・
cursor item（decompose）の `artifacts` と `write_globs`（成果物の保存先）。

## 成果物

cursor item の `artifacts` に列挙されたパス（plan.md / plan.json / interpretations.md）。
書いてよいのは cursor item の `write_globs` 内のみ。

### plan.md（人間向けの分解理由）

- 各単位に分けた理由と、**採らなかった分割案**とその理由
- 単位間の依存順（どれを先に実装すべきか）
- 仕様に曖昧さがある場合は、どう解釈したか、または未解決として何を質問すべきか

### plan.json（機械可読な単位定義）

```json
{
  "units": [
    {"id": "U1", "title": "<短い名前>", "check": "<完了を機械判定するコマンド>",
     "write_globs": ["src/**", "test/**"]}
  ]
}
```

- `id`: 一意な識別子（重複禁止。使える文字は `^[A-Za-z0-9][A-Za-z0-9_-]*$`）／
  `check`: テスト実行などの機械判定コマンド
- `write_globs`: この単位が書いてよい製品コードのパス。**必ず work_roots の部分集合にする**
  （範囲外・裸の `**`・ワイルドカード開始・保護パスは bookkeeper が拒否する）

`plan.json` は `plan-lint` で決定論的に検証され、違反があると gate-open が失敗する。

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

- 仕様の曖昧さが分解を妨げるとき、推測で埋めず、質問を列挙して停止する。
- 不可逆・高リスクの判断が必要になったら停止する。技術的に行き詰まったら停止する。
