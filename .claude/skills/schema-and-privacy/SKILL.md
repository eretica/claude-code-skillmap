---
name: schema-and-privacy
description: サマリースキーマ(UsageSummary)とプライバシー設計の不変条件。スキーマ変更・除外/opt-in・マージ・PATCH削除に触れる前に必ず読むこと。カウントの3層構造と波及先、除外がサーバーに漏れない理由、schemaVersionの運用方針。
---

# スキーマとプライバシーの不変条件

## 絶対に守ること(プライバシーの核)

1. **ホワイトリスト方式**: サマリーに入れてよいのは「機能名(スキル/ツール/コマンド/モデル/リポジトリ末尾名)と集計値」だけ。会話本文・thinking・ツール引数/結果・フルパス(cwd/gitBranch)・sessionIdは**パーサのMapに入れた時点で負け**。`src/lib/parser.ts` は該当フィールドを読み捨てる構造になっている
2. **二重防御**: サーバー側 `api/_lib/sanitize.ts` は受信JSONを「既知フィールドだけで再構築」する。新フィールドを足すときは**types.ts と sanitize.ts を必ずセットで更新**(sanitizeに書き忘れるとサーバー保存時に静かに落ちる。dailyFeaturesのreposで実際に起きた)
3. **除外項目名はサーバーに送らない**: 除外・リポジトリopt-inは**クライアントでマージ後に適用**する(`lib/share.ts` の buildSharePayload)。この順序(マージ→除外)を崩すと「隠したい名前」がサーバーに渡る。サーバー側マージに変える場合はこの保証の代替設計が必要
4. **リポジトリはopt-in**(既定OFF・選んだものだけ)。他カテゴリはopt-out(既定ON・除外可)。この非対称は機密度の違いによる意図的なもの

## カウントは3層に冗長保持されている(最重要の構造知識)

同じ機能利用カウントが以下の3箇所にある:

| 層 | 用途 |
|---|---|
| トップレベル(`skills` 等) | 全期間表示・除外パネルの項目列挙 |
| `dailyFeatures[date][cat]` | 期間フィルタ |
| `dailyRepos[date][repo].features[cat]` | リポジトリフィルタ |

**この構造ゆえに、項目を「消す」処理は3層すべてに波及させる必要がある**。波及漏れ=非公開にしたはずの名前が残る=プライバシー実害。現在の実装箇所:

- 除外: `src/lib/exclude.ts` applyExclusions(3層対応済み)
- マージ: `src/lib/merge.ts`(日付キー結合+トップレベルはdailyFeaturesから再計算)
- PATCH削除: `api/_lib/mutate.ts` removeItemFromSummary — **本番APIとE2Eモックの両方がこれをimportする。別実装を書かない**

カテゴリ一覧は `src/lib/types.ts` の `FEATURE_CATEGORIES` が唯一の定義。**新カテゴリ追加時にローカルでリストを書き写さない**(派生: exclude.ts EXCLUDABLE_CATEGORIES、teamStats.ts CATEGORY_LABEL、sanitize、mutate、TeamView)。

## スキーマ変更の手順(新しい指標・カテゴリを足すとき)

1. `src/lib/types.ts` — フィールド追加は**optional**にし「旧サマリーには存在しない」コメント(後方互換。schemaVersionは1のまま)
2. `src/lib/parser.ts` — Accumに蓄積+サマリー出力。日別が要るなら bumpDaily / repoBucket 経由
3. `api/_lib/sanitize.ts` — 対応するサニタイズを追加(忘れるとサーバーで消える)
4. `src/lib/merge.ts` — 蓄積時の扱いを決める(日付キーで結合できるか / freshの値で上書きか)
5. 消せる必要があるなら exclude.ts / mutate.ts の波及
6. UI(teamStats/PersonalView/TeamView)
7. テスト: parser.test にフィールド検証+リーク検査、sanitize.test に通過確認

**破壊的変更**(意味変更・削除)のときは schemaVersion を2に上げ、読み込み直後の1箇所(サーバーGET後/ファイル読込後)にmigrate関数を置く方針(types.ts末尾コメント参照)。

## 既知の割り切り(直すなら大改修時)

- **3層冗長の解消**: dailyRepos/dailyFeaturesを単一の真実にしてトップレベルを導出にする案がある(レビュー指摘#1)。DB消去を許容できるタイミングで
- **競合**: 共有(GET→クライアントマージ→POST全置換)とPATCH(read-modify-write)は後勝ち。同名を複数端末で同時共有すると履歴が飛びうる。対策候補: updated_atの楽観ロック(409+リトライ)
- **タイムゾーン**: 日付は閲覧者ローカルTZ。時差混在チームでは日境界がずれる(README明文化済み)
- **セッション数の近似**: 蓄積データでは日別ユニークの合計になり、日跨ぎセッションが重複計上(タイルのInfoTipに注記済み)
- トークンはリポジトリ別に分解していない(三重ネストのサイズ増を回避)
