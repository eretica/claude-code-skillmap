import type {
  DailyActivity,
  FeatureCategory,
  TokenUsage,
  UsageSummary,
} from "./types";

// 再共有時の蓄積: サーバーに保存済みのサマリーと今回の解析結果を「日付キー」で結合する。
// ローカルのトランスクリプトは cleanupPeriodDays(既定30日)で消えるため、
// 上書きだと古い実績がDBからも消えてしまう。マージはクライアント側で行い、
// サーバーへは結合済みサマリーを送る(除外設定は結合後に適用するので、
// 除外したい項目名がサーバーに渡ることはない)。

const FEATURE_CATEGORIES: FeatureCategory[] = [
  "skills",
  "subagents",
  "mcpTools",
  "slashCommands",
  "plugins",
];

function sortDesc(rec: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(rec).sort((a, b) => b[1] - a[1]));
}

export function mergeSummaries(
  stored: UsageSummary,
  fresh: UsageSummary,
): UsageSummary {
  // 日付が両方にある場合は今回の解析(fresh)を採用する。
  // 再パースの方が正確で、途中日に共有した場合もその日全体が入り直るため。
  const dailyMap = new Map<string, DailyActivity>();
  for (const d of stored.dailyActivity ?? []) dailyMap.set(d.date, d);
  for (const d of fresh.dailyActivity ?? []) dailyMap.set(d.date, d);
  const dailyActivity = [...dailyMap.values()].sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );

  const dailyFeatures = {
    ...(stored.dailyFeatures ?? {}),
    ...(fresh.dailyFeatures ?? {}),
  };
  const dailyTokens = {
    ...(stored.dailyTokens ?? {}),
    ...(fresh.dailyTokens ?? {}),
  };

  // カテゴリ合計はマージ済みの日別カウントから再計算する
  // (旧形式でdailyFeaturesを持たない保存分は、その期間のカテゴリ実績を引き継げない)
  const catTotals = Object.fromEntries(
    FEATURE_CATEGORIES.map((c) => [c, {} as Record<string, number>]),
  ) as Record<FeatureCategory, Record<string, number>>;
  for (const cats of Object.values(dailyFeatures)) {
    for (const category of FEATURE_CATEGORIES) {
      for (const [key, v] of Object.entries(cats[category] ?? {}))
        catTotals[category][key] = (catTotals[category][key] ?? 0) + v;
    }
  }

  // トークン: 両方が日別データを持つ場合のみ再集計。
  // 片方が旧形式の場合は二重計上を避けて今回の値をそのまま使う。
  let tokensByModel = fresh.tokensByModel;
  if (stored.dailyTokens && fresh.dailyTokens) {
    tokensByModel = {};
    for (const models of Object.values(dailyTokens)) {
      for (const [model, t] of Object.entries(models)) {
        const e = (tokensByModel[model] ??= {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
        } satisfies TokenUsage);
        e.input += t.input;
        e.output += t.output;
        e.cacheRead += t.cacheRead;
        e.cacheCreation += t.cacheCreation;
      }
    }
  }

  const sum = (f: (d: DailyActivity) => number | undefined) =>
    dailyActivity.reduce((s, d) => s + (f(d) ?? 0), 0);
  const dates = dailyActivity.map((d) => d.date);

  return {
    // モード・利用環境・セッション長・組み込みツール等の日別を持たない指標は
    // 今回の解析(直近のローカルウィンドウ)の値をそのまま使う
    ...fresh,
    period: {
      from: dates[0] ?? fresh.period.from,
      to: dates[dates.length - 1] ?? fresh.period.to,
    },
    totals: {
      // セッション数は日別ユニーク数の合計(日をまたぐセッションは重複する近似)
      sessions: sum((d) => d.sessions),
      assistantMessages: sum((d) => d.messages),
      userPrompts: sum((d) => d.userPrompts) || fresh.totals.userPrompts,
      toolCalls: sum((d) => d.toolCalls),
      activeDays: dailyActivity.length,
    },
    dailyActivity,
    dailyFeatures,
    dailyTokens,
    tokensByModel,
    skills: sortDesc(catTotals.skills),
    subagents: sortDesc(catTotals.subagents),
    mcpTools: sortDesc(catTotals.mcpTools),
    slashCommands: sortDesc(catTotals.slashCommands),
    plugins: sortDesc(catTotals.plugins),
    sessionsWithSkill:
      sum((d) => d.skillSessions) || fresh.sessionsWithSkill,
  };
}
