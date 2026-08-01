---
name: add-metric
description: 新しい計測指標・機能カテゴリ・表示カードをclaude-code-skillmapに追加する手順書。トランスクリプトのどのフィールドから何が取れるか、変更が必要なファイルのチェックリスト、期間/リポジトリフィルタ対応の判断基準。
---

# 指標・カテゴリの追加手順

## まず判断すること

1. **単純な集計値か、機能カテゴリか**
   - 集計値(例: Web検索回数) → UsageSummaryにoptionalフィールドを1つ足すだけ
   - 機能カテゴリ(項目名×回数のRecord。ヒートマップ・除外・期間フィルタに乗せたい) → `FEATURE_CATEGORIES` への追加(影響大、下記フルチェックリスト)
2. **期間フィルタ対応が必要か** → 日別(`dailyFeatures` / 専用daily)に積む必要がある
3. **リポジトリフィルタ対応が必要か** → `dailyRepos[].features` にも積む
4. **機密性** → 項目名に案件名等が入りうるなら除外UI(または repos型のopt-in)必須

## トランスクリプト(~/.claude/projects/*.jsonl)から取れるもの

行の `type` で分岐。既知の構造:

- `assistant` 行: `message.model` / `message.usage`(input/output/cache_read/cache_creation_input_tokens, server_tool_use) / `message.content[]`(type=tool_useの `name` と `input`) / `cwd` / `entrypoint` / `sessionId` / `timestamp`
  - スキル: `name=="Skill"` の `input.skill`(argsは機密なので取らない)
  - サブエージェント: `name=="Agent"|"Task"` の `input.subagent_type`
  - MCP: ツール名 `mcp__<server>__<tool>`
  - プラグイン: スキル/コマンド名の `plugin:` プレフィックス
- `user` 行: `<command-name>` タグ(スラッシュコマンド)。本文は読まない
  - `content[]` の `tool_result`: `is_error` と `tool_use_id` のみ使う(ツール失敗率)。名前は同一ファイル内で先行するassistant行の `tool_use.id` → 名前マップで解決する
- `mode` / `permission-mode` 行: セッション数ベースで集計(行が繰り返し記録されるため回数を数えてはいけない)
- `<synthetic>` モデルは除外する
- サブエージェントの会話は `<session-id>/subagents/agent-*.jsonl` に分かれており、行に `isSidechain: true` が付く(sessionIdは親と同じ)。ディレクトリwalkは再帰なので自動的に取り込まれる。委任度はこのフラグから算出
- assistant行の `effort`(トップレベル、"high"等)= 推論エフォート。古いCCバージョンの行には無い
- セッション実時間は assistant/user 行の `timestamp` のセッション内min/max差から算出
- 概算コストの単価は `lib/pricing.ts` の `DEFAULT_RATES`(公式単価を手動同梱。価格取得APIは非公開)。ユーザー編集分は localStorage `claude-graph:rates` にのみ保存し、サマリーには含めない
- 補助: `~/.claude/stats-cache.json`(日別アクティビティのバックフィル用、`lib/statsCache.ts`)

未知の構造を使う前に、実データでフィールドをgrepして構造を確認すること(例: `grep -h '"type":"mode"' ~/.claude/projects/*/*.jsonl | head`)。**確認結果の実値をコードやテストに貼らない**(合成値に置き換える)。

## フルチェックリスト(機能カテゴリ追加時)

順番どおりにやる。**3〜7の漏れはプライバシー実害になる**:

1. `src/lib/types.ts` — `FEATURE_CATEGORIES` に追加(型は自動派生)+optionalフィールド
2. `src/lib/parser.ts` — bump + bumpDaily(+repo対応なら第5引数)
3. `api/_lib/sanitize.ts` — 対応サニタイズ(共有定数を使っていれば自動のことも。dailyRepos側の扱い確認)
4. `src/lib/exclude.ts` — 共有定数派生なら自動。特殊な波及があるなら追記
5. `api/_lib/mutate.ts` — 削除の3層波及(共有定数なら自動)
6. `src/lib/merge.ts` — 蓄積時の扱い(catTotalsは共有定数なら自動)
7. `src/lib/teamStats.ts` — `CATEGORY_LABEL` にラベル追加
8. UI — TeamViewのヒートマップ順序 / PersonalViewのカード / InfoTipの説明文。RecommendCard・AskWhoに出すべきでないカテゴリなら明示的にfilter(reposの例あり)
9. テスト — `parser.test.ts`(値検証+SECRET_*リーク検査)、`sanitize.test.ts`(通過確認)、必要ならE2E
10. `e2e/mock-api.ts` のフィクスチャに合成データを追加(チーム表示の確認用)
11. README「見られる指標」「データソース」表を更新

## 表示カードの追加

- 棒リスト → `BarList`(unit/keepOrder/limitあり)。チャート → `charts.tsx` に追加し `ChartsLazy.tsx` 経由でexport(Recharts遅延読込を守る)
- dataviz原則: 単系列は1色、凡例はインク色、表ビュー(ChartTable)併設、二軸禁止
- タイトルに `InfoTip` で用語説明を付ける(「キャッシュとは」レベルまで噛み砕く)

## 過去の実装例(参考コミット)

- 集計値追加: webSearchRequests / sessionLengthBuckets(セッション数ベース集計の例)
- カテゴリ追加: plugins(プレフィックス派生)、repos(opt-in+dailyRepos+フィルタまでのフル実装)
- 日別追加: dailyTokens(マージの二重計上防止)、dailyActivity.skillSessions(率の期間対応)
