import { describe, expect, it } from "vitest";
import { weekStartOf } from "./dates";
import { weeklyTrend } from "./trend";
import type { UsageSummary } from "./types";

describe("weekStartOf", () => {
  it("その週の月曜日を返す", () => {
    expect(weekStartOf("2026-07-29")).toBe("2026-07-27"); // 水→月
    expect(weekStartOf("2026-07-27")).toBe("2026-07-27"); // 月→月
    expect(weekStartOf("2026-07-26")).toBe("2026-07-20"); // 日→前週月
    expect(weekStartOf("2026-08-01")).toBe("2026-07-27"); // 月またぎ
  });
});

describe("weeklyTrend", () => {
  const base = {
    schemaVersion: 1,
    name: "t",
    exportedAt: "",
    period: { from: null, to: null },
    totals: {
      sessions: 0,
      assistantMessages: 0,
      userPrompts: 0,
      toolCalls: 0,
      activeDays: 0,
    },
    tokensByModel: {},
    skills: {},
    subagents: {},
    mcpTools: {},
    slashCommands: {},
    tools: {},
    sessionsWithSkill: 0,
    sessionsWithSubagent: 0,
  } satisfies Omit<UsageSummary, "dailyActivity">;

  it("週次のスキル利用セッション率と機能種類数を集計する", () => {
    const s: UsageSummary = {
      ...base,
      dailyActivity: [
        { date: "2026-07-21", sessions: 4, skillSessions: 1, messages: 0, toolCalls: 0 },
        { date: "2026-07-22", sessions: 6, skillSessions: 4, messages: 0, toolCalls: 0 },
        { date: "2026-07-28", sessions: 10, skillSessions: 8, messages: 0, toolCalls: 0 },
      ],
      dailyFeatures: {
        "2026-07-21": { skills: { a: 1 }, subagents: { x: 2 } },
        "2026-07-22": { skills: { a: 3, b: 1 } },
        "2026-07-28": { skills: { a: 1 }, slashCommands: { "/c": 1 } },
      },
    };
    const trend = weeklyTrend(s);
    expect(trend).toEqual([
      { week: "2026-07-20", skillRate: 50, diversity: 3 }, // 5/10, {a,b,x}
      { week: "2026-07-27", skillRate: 80, diversity: 1 }, // 8/10, {a} (コマンドは種類数に含めない)
    ]);
  });

  it("旧形式(skillSessionsなし)は率をnullにする", () => {
    const s: UsageSummary = {
      ...base,
      dailyActivity: [
        { date: "2026-07-21", sessions: 4, messages: 0, toolCalls: 0 },
        { date: "2026-07-28", sessions: 2, messages: 0, toolCalls: 0 },
      ],
    };
    expect(weeklyTrend(s).map((p) => p.skillRate)).toEqual([null, null]);
  });
});
