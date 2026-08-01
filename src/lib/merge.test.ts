import { describe, expect, it } from "vitest";
import { mergeSummaries } from "./merge";
import { applyExclusions, exKey } from "./exclude";
import type { UsageSummary } from "./types";

function summaryOf(over: Partial<UsageSummary>): UsageSummary {
  return {
    schemaVersion: 1,
    name: "t",
    exportedAt: "2026-07-30T00:00:00.000Z",
    period: { from: null, to: null },
    totals: {
      sessions: 0,
      assistantMessages: 0,
      userPrompts: 0,
      toolCalls: 0,
      activeDays: 0,
    },
    dailyActivity: [],
    tokensByModel: {},
    skills: {},
    subagents: {},
    mcpTools: {},
    slashCommands: {},
    plugins: {},
    tools: {},
    sessionsWithSkill: 0,
    sessionsWithSubagent: 0,
    ...over,
  };
}

const stored = summaryOf({
  // 6月分(ローカルからは消えている過去の共有分)
  dailyActivity: [
    { date: "2026-06-10", sessions: 3, skillSessions: 2, messages: 30, toolCalls: 10, userPrompts: 5 },
    { date: "2026-07-01", sessions: 1, skillSessions: 0, messages: 10, toolCalls: 5, userPrompts: 2 },
  ],
  dailyFeatures: {
    "2026-06-10": { skills: { "old-skill": 4 } },
    "2026-07-01": { skills: { "old-skill": 1 } },
  },
  dailyTokens: {
    "2026-06-10": { "claude-fable-5": { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 } },
    "2026-07-01": { "claude-fable-5": { input: 10, output: 5, cacheRead: 0, cacheCreation: 0 } },
  },
});

const fresh = summaryOf({
  // 7月分の新しい解析。7/1が重複(値が更新されている)
  dailyActivity: [
    { date: "2026-07-01", sessions: 2, skillSessions: 1, messages: 20, toolCalls: 8, userPrompts: 4 },
    { date: "2026-07-30", sessions: 5, skillSessions: 4, messages: 50, toolCalls: 20, userPrompts: 10 },
  ],
  dailyFeatures: {
    "2026-07-01": { skills: { "new-skill": 2 } },
    "2026-07-30": { skills: { "new-skill": 3 }, subagents: { Explore: 1 } },
  },
  dailyTokens: {
    "2026-07-01": { "claude-fable-5": { input: 20, output: 10, cacheRead: 0, cacheCreation: 0 } },
    "2026-07-30": { "claude-opus-4-8": { input: 200, output: 100, cacheRead: 0, cacheCreation: 0 } },
  },
  tools: { Read: 99 },
});

describe("mergeSummaries", () => {
  it("日付単位で結合し、重複日は新しい解析を採用する", () => {
    const m = mergeSummaries(stored, fresh);
    expect(m.dailyActivity.map((d) => d.date)).toEqual([
      "2026-06-10",
      "2026-07-01",
      "2026-07-30",
    ]);
    // 7/1はfresh側の値
    expect(m.dailyActivity[1].sessions).toBe(2);
    expect(m.dailyFeatures?.["2026-07-01"]).toEqual({
      skills: { "new-skill": 2 },
    });
    // 6/10はstored側が残る
    expect(m.dailyFeatures?.["2026-06-10"]).toEqual({
      skills: { "old-skill": 4 },
    });
    expect(m.period).toEqual({ from: "2026-06-10", to: "2026-07-30" });
  });

  it("合計をマージ済み日別データから再計算する", () => {
    const m = mergeSummaries(stored, fresh);
    expect(m.totals.sessions).toBe(3 + 2 + 5);
    expect(m.totals.assistantMessages).toBe(30 + 20 + 50);
    expect(m.totals.userPrompts).toBe(5 + 4 + 10);
    expect(m.totals.activeDays).toBe(3);
    expect(m.sessionsWithSkill).toBe(2 + 1 + 4);
    expect(m.skills).toEqual({ "new-skill": 5, "old-skill": 4 });
    expect(m.subagents).toEqual({ Explore: 1 });
    // トークンはマージ済みdailyTokensから再集計(7/1はfreshの値で置換)
    expect(m.tokensByModel["claude-fable-5"].input).toBe(100 + 20);
    expect(m.tokensByModel["claude-opus-4-8"].input).toBe(200);
    // 日別を持たない指標は新しい解析の値
    expect(m.tools).toEqual({ Read: 99 });
  });

  it("保存分が旧形式(dailyTokensなし)ならトークンは二重計上せず新しい値を使う", () => {
    const legacy = summaryOf({
      dailyActivity: stored.dailyActivity,
      tokensByModel: {
        "claude-fable-5": { input: 9999, output: 0, cacheRead: 0, cacheCreation: 0 },
      },
    });
    const m = mergeSummaries(legacy, fresh);
    expect(m.tokensByModel).toEqual(fresh.tokensByModel);
  });

  it("マージ後に除外を適用すると過去の共有分からも消える", () => {
    const m = applyExclusions(
      mergeSummaries(stored, fresh),
      new Set([exKey("skills", "old-skill")]),
    );
    expect(m.skills).toEqual({ "new-skill": 5 });
    expect(JSON.stringify(m)).not.toContain("old-skill");
  });
});
