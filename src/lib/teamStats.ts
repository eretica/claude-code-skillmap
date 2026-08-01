import type { FeatureCategory, TokenUsage, UsageSummary } from "./types";
import { daysAgo } from "./dates";

// チーム集計タブで使う期間フィルタと集計ヘルパー

export type Period = "all" | 30 | 7;

export const CATEGORY_LABEL: Record<FeatureCategory, string> = {
  skills: "スキル",
  subagents: "サブエージェント",
  mcpTools: "MCPツール",
  slashCommands: "スラッシュコマンド",
  plugins: "プラグイン",
};

export const PERIOD_LABEL: [Period, string][] = [
  ["all", "全期間"],
  [30, "直近30日"],
  [7, "直近7日"],
];

export function cutoffOf(period: Period): string | null {
  return period === "all" ? null : daysAgo(period - 1);
}

// 期間内の機能利用カウント。dailyFeaturesがない旧形式サマリーは全期間値で代用する
export function featureCounts(
  m: UsageSummary,
  category: FeatureCategory,
  cutoff: string | null,
): Record<string, number> {
  if (!cutoff || !m.dailyFeatures) return m[category] ?? {};
  const out: Record<string, number> = {};
  for (const [date, cats] of Object.entries(m.dailyFeatures)) {
    if (date < cutoff) continue;
    for (const [key, v] of Object.entries(cats[category] ?? {}))
      out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

export function activityIn(
  m: UsageSummary,
  cutoff: string | null,
): { sessions: number; messages: number } {
  if (!cutoff)
    return {
      sessions: m.totals.sessions,
      messages: m.totals.assistantMessages,
    };
  return m.dailyActivity
    .filter((d) => d.date >= cutoff)
    .reduce(
      (acc, d) => ({
        sessions: acc.sessions + d.sessions,
        messages: acc.messages + d.messages,
      }),
      { sessions: 0, messages: 0 },
    );
}

export function sumOf(rec: Record<string, number>): number {
  return Object.values(rec).reduce((a, b) => a + b, 0);
}

export function totalTokens(m: UsageSummary): TokenUsage {
  return Object.values(m.tokensByModel).reduce(
    (acc, t) => ({
      input: acc.input + t.input,
      output: acc.output + t.output,
      cacheRead: acc.cacheRead + t.cacheRead,
      cacheCreation: acc.cacheCreation + t.cacheCreation,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  );
}

/**
 * スキル利用セッション率の分子・分母。
 * バックフィル日(skillSessions情報なし)を分母に入れると率が不当に希釈されるため、
 * スキル情報を持つ日だけで計算する。旧形式は従来の全期間値にフォールバック
 */
export function skillRateParts(m: UsageSummary): { num: number; den: number } {
  const days = (m.dailyActivity ?? []).filter(
    (d) => typeof d.skillSessions === "number",
  );
  if (days.length > 0) {
    return {
      num: days.reduce((s, d) => s + (d.skillSessions ?? 0), 0),
      den: days.reduce((s, d) => s + d.sessions, 0),
    };
  }
  return { num: m.sessionsWithSkill, den: m.totals.sessions };
}

/** スキルを1回以上使ったセッションの割合(%) */
export function skillRate(m: UsageSummary): number {
  const { num, den } = skillRateParts(m);
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

/** 期間内に使った機能の種類数(スキル+サブエージェント+MCP) */
export function diversity(m: UsageSummary, cutoff: string | null): number {
  return (
    Object.keys(featureCounts(m, "skills", cutoff)).length +
    Object.keys(featureCounts(m, "subagents", cutoff)).length +
    Object.keys(featureCounts(m, "mcpTools", cutoff)).length
  );
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
