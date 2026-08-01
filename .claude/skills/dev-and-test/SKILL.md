---
name: dev-and-test
description: claude-code-skillmapの開発・テスト・動作確認の手順。開発サーバーの起動(ローカル版/クラウド版+モックAPI)、vitest/Playwrightの実行、型チェックの罠、デモデータの投入方法。コードを変更したら必ずこのスキルの検証手順を通すこと。
---

# 開発とテスト

## コマンド一覧

```sh
npm run dev          # ローカル版(通信ゼロ)の開発サーバー
npm run dev:cloud    # クラウド版。/api は localhost:8788 へプロキシされる
npx tsx e2e/mock-api.ts  # モックAPI(:8788)。dev:cloudとセットで使う
npm run build        # ローカル版ビルド(tsc -b + tsc -p tsconfig.api.json + vite)
npm run build:cloud  # クラウド版ビルド(同上 + --mode cloud)
npm test             # vitest(src/**, api/** の *.test.ts)
npm run test:e2e     # Playwright(モックとdevサーバーはwebServerで自動起動)
npx oxlint src api e2e middleware.ts  # lint
```

## 変更後の必須検証

1. `npm run build && npm run build:cloud` — **api/とmiddleware.tsの型チェックはここでしか走らない**(Vercelはesbuildバンドルのみで型エラーでもデプロイされる)。`tsconfig.api.json` はNodeNext解決なので、api内の相対importは `./_lib/db.js` のように**.js拡張子必須**(忘れると本番ランタイムでERR_MODULE_NOT_FOUNDクラッシュ。実績あり)
2. `npm test` — 特にparser/sanitize/exclude/share/mergeのテストは**プライバシー保証の回帰テスト**を含む
3. `npm run test:e2e` — 実行前に手動起動したモック/devサーバーが残っているとポート衝突するので `pkill -f mock-api; pkill -f "vite.*5199"` してから

## ブラウザでの動作確認

```sh
npx tsx e2e/mock-api.ts &
npm run dev:cloud -- --port 5199 --strictPort &
```

- ルーム(デモ3名入り): http://localhost:5199/r/e2eroom0123456789abcdef
- ルート(個人解析のみ): http://localhost:5199/
- 管理画面: http://localhost:5199/admin (ローカルはBasic認証なし。本番はmiddlewareが掛ける)

ルームIDは `e2e/mock-api.ts` の `E2E_ROOM` と一致させること。

### 多人数・任意データの投入

モックのPOSTは無認可なので、合成メンバーを流し込める(実データは使わないこと):

```sh
curl -X POST "localhost:8788/api/summaries?room=e2eroom0123456789abcdef" \
  -H 'Content-Type: application/json' -d '{...UsageSummary形式...}'
```

11人での表示検証などはこの方法で行った実績がある。

## スクリーンショット検証

UI変更時はヘッドレスChromeで実際に見ること(dataviz原則)。PlaywrightのシステムChromeを使う:

```js
const b = await chromium.launch({ channel: "chrome", headless: true });
// ライト/ダーク両方: newPage({ colorScheme: "dark" })
```

個人解析のファイル読み込みは `input[type=file]` に `setInputFiles("e2e/fixtures/projects")`(ディレクトリ指定可)。実データで確認したい場合は `~/.claude/projects` のサブセットをscratchpadへコピーして使い、**検証後は必ず削除**(機密を含むため)。

## テストの構造

- ユニット: 純粋ロジック(parser/merge/exclude/share/sanitize/trend/statsCache)。フィクスチャは合成データのみで、`SECRET_*` 文字列が出力JSONに漏れないリーク検査を含む
- E2E: `e2e/cloud.spec.ts` 3本(ルート個人モード / 管理画面 / ルーム内一連フロー)。フィクスチャ(`e2e/fixtures/`)も合成のみ。**実トランスクリプトをリポジトリやfixtureに入れない**
- モックAPI(`e2e/mock-api.ts`)は本番と同じ `sanitizeSummary` / `removeItemFromSummary` をimportしている。**API挙動を変えたらモックの該当分岐も確認**(HTTPルーティング部分だけは手書きなので)
