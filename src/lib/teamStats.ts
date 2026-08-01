import type { FeatureCategory, TokenUsage, UsageSummary } from "./types";
import { daysAgo } from "./dates";

// チーム集計タブで使う期間フィルタと集計ヘルパー

export type Period = "all" | 30 | 7 | "custom";

/** 期間フィルタの日付範囲(両端含む)。nullは全期間 */
export interface DateRange {
  from: string | null;
  to: string | null;
}

export function inRange(date: string, range: DateRange | null): boolean {
  if (!range) return true;
  if (range.from && date < range.from) return false;
  if (range.to && date > range.to) return false;
  return true;
}

export const CATEGORY_LABEL: Record<FeatureCategory, string> = {
  skills: "スキル",
  subagents: "サブエージェント",
  mcpTools: "MCPツール",
  slashCommands: "スラッシュコマンド",
  plugins: "プラグイン",
  repos: "リポジトリ",
};

export const PERIOD_LABEL: [Period, string][] = [
  ["all", "全期間"],
  [30, "直近30日"],
  [7, "直近7日"],
  ["custom", "期間指定"],
];

/** プリセット期間を範囲に変換する。customは呼び出し側がfrom/toを組み立てる */
export function periodRange(period: Period): DateRange | null {
  if (period === "all" || period === "custom") return null;
  return { from: daysAgo(period - 1), to: null };
}

// 期間内の機能利用カウント。dailyFeaturesがない旧形式サマリーは全期間値で代用する。
// repoを指定すると、そのリポジトリ内での利用だけを dailyRepos から集計する
export function featureCounts(
  m: UsageSummary,
  category: FeatureCategory,
  range: DateRange | null,
  repo?: string | null,
): Record<string, number> {
  if (repo) {
    if (category === "repos") return {};
    const out: Record<string, number> = {};
    for (const [date, repoMap] of Object.entries(m.dailyRepos ?? {})) {
      if (!inRange(date, range)) continue;
      for (const [key, v] of Object.entries(
        repoMap[repo]?.features?.[category] ?? {},
      ))
        out[key] = (out[key] ?? 0) + v;
    }
    return out;
  }
  if (!range || !m.dailyFeatures) return m[category] ?? {};
  const out: Record<string, number> = {};
  for (const [date, cats] of Object.entries(m.dailyFeatures)) {
    if (!inRange(date, range)) continue;
    for (const [key, v] of Object.entries(cats[category] ?? {}))
      out[key] = (out[key] ?? 0) + v;
  }
  return out;
}

export function activityIn(
  m: UsageSummary,
  range: DateRange | null,
  repo?: string | null,
): { sessions: number; messages: number } {
  if (repo) {
    let sessions = 0;
    let messages = 0;
    for (const [date, repoMap] of Object.entries(m.dailyRepos ?? {})) {
      if (!inRange(date, range)) continue;
      const b = repoMap[repo];
      if (!b) continue;
      sessions += b.sessions;
      messages += b.messages;
    }
    return { sessions, messages };
  }
  if (!range)
    return {
      sessions: m.totals.sessions,
      messages: m.totals.assistantMessages,
    };
  return m.dailyActivity
    .filter((d) => inRange(d.date, range))
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
export function skillRateParts(
  m: UsageSummary,
  repo?: string | null,
): { num: number; den: number } {
  if (repo) {
    let num = 0;
    let den = 0;
    for (const repoMap of Object.values(m.dailyRepos ?? {})) {
      const b = repoMap[repo];
      if (!b) continue;
      num += b.skillSessions;
      den += b.sessions;
    }
    return { num, den };
  }
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
export function skillRate(m: UsageSummary, repo?: string | null): number {
  const { num, den } = skillRateParts(m, repo);
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

/** 期間内に使った機能の種類数(スキル+サブエージェント+MCP) */
export function diversity(
  m: UsageSummary,
  range: DateRange | null,
  repo?: string | null,
): number {
  return (
    Object.keys(featureCounts(m, "skills", range, repo)).length +
    Object.keys(featureCounts(m, "subagents", range, repo)).length +
    Object.keys(featureCounts(m, "mcpTools", range, repo)).length
  );
}

/** リポジトリフィルタ用: メンバー全員から登場するリポジトリ名の一覧(利用量順) */
export function repoNames(members: UsageSummary[]): string[] {
  const totals = new Map<string, number>();
  for (const m of members)
    for (const [repo, n] of Object.entries(m.repos ?? {}))
      totals.set(repo, (totals.get(repo) ?? 0) + n);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([r]) => r);
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
