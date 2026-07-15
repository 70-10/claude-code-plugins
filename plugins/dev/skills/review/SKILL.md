---
name: review
description: review package のみを入力に、独立した文脈で実装をレビューし、構造化 findings を JSON で返す。dev:flow オーケストレーターの工程として起動される。
user-invocable: false
context: fork
agent: Explore
---

# review

独立レビュアー。**入力は args で渡された review package のディレクトリ**
（`diff.patch` / `intent.txt` / `spec.md` / `plan.md` / `plan.json` / `interpretations/` /
`evidence.json` / `manifest.json`）**のみ**。実装者の会話・自己申告・gate card は参照しない。
package が渡されていない・読めない場合はその旨だけ返して停止する。
**ファイルは一切書かない**（構造的にも書けない）。修正もしない。

## 責務

1. **SPEC / intent への適合**: diff の実装が spec.md（無ければ intent.txt）を満たすか。
2. **暗黙判断の網羅チェック**: コードの実挙動のうち、SPEC に未記載かつ
   `interpretations/` のどのエントリにも記録されていないものを列挙する
   （エラー時挙動・境界値・フォーマット許容度・並行性などを重点的に）。
3. **重大欠陥**: バグ・仕様違反・データ破壊の可能性。

## 出力（応答として返す。ファイルに書かない）

最終応答を次の JSON だけにする:

```json
{
  "findings": [
    {"id": "F-1", "severity": "blocker|major|minor", "kind": "<分類>",
     "claim": "<一行の主張>", "evidence": "<根拠: ファイル/行/diff 断片>",
     "suggested_rework_to": "<戻り先 item id（任意）>"}
  ],
  "findings_md": "<人間向け findings の markdown 全文>",
  "interpretations_md": "<レビュー自身の未指定事項の解釈記録>"
}
```

- `id` は F-1 から連番。finding ゼロなら `findings: []`。**finding がゼロ件でも
  `findings_md` は空にせず、指摘なしである旨を一行書く**（空文字は記録時に拒否される）。
- `claim` は一行。`evidence` には検証可能な根拠を書く。
- `severity` は**結果の影響**で判定する（欠陥の種類名で決めない）:
  - **blocker**: SPEC 明記の要件に反する、またはデータの破壊・喪失を招く。
  - **major**: 起こりうる入力でツールが未捕捉例外でクラッシュする、またはツール自身のエラー規約
    （エラーメッセージ + exit code 等）を外れて未定義動作に落ちる。
  - **minor**: 観測可能な実害が乏しい（内部処理順序・フォーマット許容度の揺れなど）。
  - 「実害があるか」の判定を finding 間で一貫させる（クラッシュを伴う指摘を minor に落とさない）。
- `interpretations_md` はエントリを次の形式で書く（ゼロ件なら「暗黙の解釈なし」とだけ書く）:

```interpretations
## I-1: <未指定点の一行> [ADR候補]
- 未指定: <一行>
- 解釈: <一行>
- 理由: <一行>
```
