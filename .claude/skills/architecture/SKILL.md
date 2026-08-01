---
name: architecture
description: claude-code-skillmapの全体アーキテクチャ。ローカル版/クラウド版の出し分け、ルーム方式の認可モデル、データフロー(パース→共有→蓄積→表示)、主要モジュールの責務と依存方向。新機能の置き場所に迷ったら読む。
---

# アーキテクチャ

## 3つの動作モード

| モード | 判定 | できること |
|---|---|---|
| ローカル版 | ビルド時 `IS_CLOUD=false`(`npm run build`) | 解析+JSONエクスポートのみ。通信ゼロ |
| クラウド版ルート `/` | `IS_CLOUD && !currentRoomId()` | 個人解析のみ(アップロード不可) |
| クラウド版ルーム `/r/<id>` | `CAN_SHARE`(=IS_CLOUD かつルームURL上) | 共有+チーム集計 |

判定は `src/lib/config.ts` の2定数に集約。共有可否の分岐は必ず `CAN_SHARE` を使う(IS_CLOUDで分岐すると/rootでも共有UIが出るバグになる)。ルーティングは `src/lib/room.ts`(パス正規表現)+`App.tsx`(Landing/Admin/本体の分岐)。SPAフォールバックは `vercel.json` の rewrites。

## 認可モデル

- **ルームID = capability**: 128bit乱数(base64url 22文字)を知っていることが認可。存在しないIDはAPIが404。`/admin` と `/api/rooms` のみBasic認証(`middleware.ts`、環境変数 BASIC_AUTH_USER/PASSWORD、定数時間比較)
- noindex/Referrer-Policyヘッダーは `vercel.json` のheadersで全レスポンスに付与

## データフロー

```
~/.claude/projects/*.jsonl ──(ブラウザ内)──▶ parser.ts ──▶ UsageSummary
                                                              │
        表示(PersonalView: teamStats.tsの集計関数で期間/リポジトリ適用)
                                                              │
  共有時: share.ts buildSharePayload = サーバー保存分とmerge → 除外/opt-in適用
                                                              ▼
                POST /api/summaries?room=… ──▶ sanitize.ts(再構築) ──▶ Neon jsonb
                                                              │
        チーム表示(TeamView: GET → teamStats.tsで期間/リポジトリ集計)
```

## 主要モジュールの責務

- `src/lib/parser.ts` — JSONLストリームパース。ホワイトリスト抽出の一次防衛線
- `src/lib/teamStats.ts` — 集計の純関数群(featureCounts/activityIn/skillRate/diversity)。**期間cutoffとrepoフィルタは全部ここの引数**。UIに集計ロジックを書かない
- `src/lib/share.ts` — 共有ペイロード構築(マージ→除外の順序保証)
- `src/lib/merge.ts` — 日付キーの蓄積マージ(cleanupPeriodDays対策)
- `src/lib/exclude.ts` — 除外(3層波及)
- `src/lib/statsCache.ts` / `trend.ts` / `dates.ts` — バックフィル / 週次トレンド / ローカルTZ日付
- `api/_lib/` — sanitize(再構築)・mutate(削除の共通実装)・db(getSql/ensureTables/isValidRoomId)。**src/lib/types.ts をimportしてよい**(逆方向は禁止)
- `api/summaries.ts` / `api/rooms.ts` — 薄いHTTPハンドラ。ロジックは_libへ
- `src/components/` — PersonalView(個人)、TeamView(チーム)、ShareModal(共有確認)、TeamHeatmap/CompareCard/RecommendCard/AskWhoCard(チームの子カード)、charts.tsx(Recharts、ChartsLazy経由で遅延読込)

## UI設計の約束

- チャートはdatavizスキルの参照パレット(index.cssの--series-*/--seq-*)。二軸チャート禁止、凡例テキストはインク色、値は表ビュー(ChartTable)併設
- 期間フィルタは「表示のみ」。共有・エクスポートは常に全期間
- チーム集計のヒートマップは全カテゴリ縦積み(タブ禁止=一覧性優先)。行クリック=そのスキルの上位ユーザー順に列ソート、列クリック=その人の利用順に行ソート
- 用語説明はInfoTip(?アイコン)。「…ほかN件」はクリック展開

## デプロイ

- GitHub → Vercel自動デプロイ。`vercel.json` がbuild:cloudを固定
- DB: Neon Postgres。`rooms` + `summaries(room_id, name, data jsonb)` の2テーブル、初回リクエストでCREATE IF NOT EXISTS(スキーマ変更が増えたらデプロイ時マイグレーションへ移行する方針)
- 環境変数: `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD`(手動)、`DATABASE_URL`(Neon接続で自動)。`VITE_APP_MODE` は設定不要
- 本番URL: https://claude-code-skillmap.vercel.app
