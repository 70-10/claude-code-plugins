# 学習ループ（learn）

gate card の学習候補節には、bookkeeper が gate-open 時に登録した候補が **cid 付き逐語**で
並ぶ（interpretations の新規エントリと直近の reject/rework feedback）。

## 手順

1. **選別は人間**: 承認応答などで人間が候補（cid）を指定したときだけ永続化する。
   flow が独断で選ばない。
2. **競合確認**: learn 実行前に `.devflow/memory.md` の既存項目と矛盾しないか比較する。
   矛盾があれば「修正して残す（人間が修正文を与え、自由記述経路で保存）／破棄」の
   2択のみ提示する（既存項目の上書き経路はない）。
3. **永続化**（本文は bookkeeper が所有する。flow は本文を生成しない）:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" learn --stdin <<'JSON'
{"candidate":"c3","consent":"<人間の発言の逐語>"}
JSON
```

   人間の新規自由記述は別経路（発言の逐語のみ）:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/flow.mjs" learn --stdin <<'JSON'
{"free_text":"<人間の発言の逐語（一行）>","consent":"<人間の発言の逐語>"}
JSON
```

4. 成功すると bookkeeper が memory.md へ冪等 append し、memory.md（と .devflow/.gitignore）
   だけをステージした memory 専用ローカルコミットを作る。同一 cid の再 learn は拒否される。
5. 学習が効くのは**次回フローの intake から**。実行中フローへは適用しない。
