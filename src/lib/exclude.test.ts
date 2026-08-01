import { describe, expect, it } from "vitest";
import { applyExclusions, exKey } from "./exclude";
import type { UsageSummary } from "./types";

const base: UsageSummary = {
  schemaVersion: 1,
  name: "tester",
  exportedAt: "",
  period: { from: "2026-07-01", to: "2026-07-02" },
  totals: {
    sessions: 1,
    assistantMessages: 1,
    userPrompts: 1,
    toolCalls: 1,
    activeDays: 1,
  },
  dailyActivity: [],
  tokensByModel: {},
  skills: { "secret-skill": 3, "public-skill": 1 },
  subagents: {},
  mcpTools: {},
  slashCommands: { "/secret-cmd": 2 },
  plugins: {},
  tools: {},
  dailyFeatures: {
    "2026-07-01": {
      skills: { "secret-skill": 2, "public-skill": 1 },
      slashCommands: { "/secret-cmd": 2 },
    },
    "2026-07-02": { skills: { "secret-skill": 1 } },
  },
  sessionsWithSkill: 1,
  sessionsWithSubagent: 0,
};

describe("applyExclusions", () => {
  it("除外項目をカテゴリ本体とdailyFeaturesの両方から取り除く", () => {
    const excluded = new Set([
      exKey("skills", "secret-skill"),
      exKey("slashCommands", "/secret-cmd"),
    ]);
    const out = applyExclusions(base, excluded);

    expect(out.skills).toEqual({ "public-skill": 1 });
    expect(out.slashCommands).toEqual({});
    expect(out.dailyFeatures?.["2026-07-01"]?.skills).toEqual({
      "public-skill": 1,
    });
    expect(out.dailyFeatures?.["2026-07-01"]?.slashCommands).toEqual({});
    expect(out.dailyFeatures?.["2026-07-02"]?.skills).toEqual({});
    // 除外語がJSON全体から消えていること
    expect(JSON.stringify(out)).not.toContain("secret-skill");
    expect(JSON.stringify(out)).not.toContain("/secret-cmd");
  });

  it("除外なしなら元の内容を保つ", () => {
    const out = applyExclusions(base, new Set());
    expect(out.skills).toEqual(base.skills);
    expect(out.dailyFeatures).toEqual(base.dailyFeatures);
  });
});
