import type { UsageSummary } from "./types";
import { weekStartOf } from "./dates";

// 個人の週次成長トレンド。
// スキル利用セッション率は dailyActivity.skillSessions(新形式のみ)から算出する。

export interface WeeklyTrendPoint {
  week: string; // 週の月曜日 (YYYY-MM-DD)
  skillRate: number | null; // その週のスキル利用セッション率(%)。算出不能ならnull
  diversity: number; // その週に使った機能の種類数(スキル+サブエージェント+MCP)
}

const DIVERSITY_CATEGORIES = ["skills", "subagents", "mcpTools"] as const;

export function weeklyTrend(summary: UsageSummary): WeeklyTrendPoint[] {
  const weeks = new Map<
    string,
    {
      sessions: number;
      skillSessions: number;
      hasSkillData: boolean;
      features: Set<string>;
    }
  >();
  const entry = (week: string) => {
    let e = weeks.get(week);
    if (!e) {
      e = {
        sessions: 0,
        skillSessions: 0,
        hasSkillData: false,
        features: new Set(),
      };
      weeks.set(week, e);
    }
    return e;
  };

  for (const d of summary.dailyActivity) {
    const e = entry(weekStartOf(d.date));
    e.sessions += d.sessions;
    if (typeof d.skillSessions === "number") {
      e.skillSessions += d.skillSessions;
      e.hasSkillData = true;
    }
  }
  for (const [date, cats] of Object.entries(summary.dailyFeatures ?? {})) {
    const e = entry(weekStartOf(date));
    for (const category of DIVERSITY_CATEGORIES) {
      for (const key of Object.keys(cats[category] ?? {}))
        e.features.add(`${category}:${key}`);
    }
  }

  return [...weeks.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, e]) => ({
      week,
      skillRate:
        e.hasSkillData && e.sessions > 0
          ? Math.round((e.skillSessions / e.sessions) * 100)
          : null,
      diversity: e.features.size,
    }));
}
