# review ゲートの triage

review の gate card には finding が `[F-n] <severity>: <claim>` で列挙される。
人間が finding ごとに対応/許容を判定し、flow が記録する。

## 手順

1. gate card 提示後、finding ごとに **対応（fix）/ 許容（accept）** を人間に確認する。
   レビュアーの `suggested_rework_to` は提案であり、戻り先の確定は人間の consent。
2. 判定ごとに記録する:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" finding-resolve --stdin <<'JSON'
{"id":"F-1","action":"fix","reason":"<判定理由>","consent":"<人間の発言の逐語>"}
JSON
```

3. **`action: fix` が1件でもあれば** review は advance できない。戻り先
   （suggested_rework_to を起点に人間と確定）への `rework --stdin` を提案する。
   rework 後は下流工程を再実行し、review は新しい revision で再実行される。
4. 全 finding が accept（fix ゼロ）になったら、通常どおり承認を得て
   `approve --stdin` → `advance`。
5. review の advance は「現在 revision の全 finding が resolved かつ fix ゼロ」を
   bookkeeper が Default-FAIL で強制する。skill 側で先回りしない。
