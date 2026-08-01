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
  repos: { "secret-repo": 5, "public-repo": 3 },
  dailyRepos: {
    "2026-07-01": {
      "secret-repo": {
        sessions: 1, skillSessions: 1, messages: 5, toolCalls: 2, userPrompts: 1,
        features: { skills: { "public-skill": 1 } },
      },
      "public-repo": {
        sessions: 1, skillSessions: 0, messages: 3, toolCalls: 1, userPrompts: 1,
        features: { skills: { "secret-skill": 2, "public-skill": 1 } },
      },
    },
  },
  sessionsWithSkill: 1,
  sessionsWithSubagent: 0,
};

describe("applyExclusions", () => {
  it("除外項目をカテゴリ本体とdailyFeaturesの両方から取り除く", () => {
    const excluded = new Set([
      exKey("skills", "secret-skill"),
      exKey("slashCommands", "/secret-cmd"),
      exKey("repos", "secret-repo"),
    ]);
    const out = applyExclusions(base, excluded);

    expect(out.skills).toEqual({ "public-skill": 1 });
    expect(out.slashCommands).toEqual({});
    expect(out.dailyFeatures?.["2026-07-01"]?.skills).toEqual({
      "public-skill": 1,
    });
    expect(out.dailyFeatures?.["2026-07-01"]?.slashCommands).toEqual({});
    expect(out.dailyFeatures?.["2026-07-02"]?.skills).toEqual({});
    // リポジトリ除外: dailyReposからも丸ごと消え、残るリポジトリ内の除外機能も消える
    expect(out.repos).toEqual({ "public-repo": 3 });
    expect(out.dailyRepos?.["2026-07-01"]?.["secret-repo"]).toBeUndefined();
    expect(
      out.dailyRepos?.["2026-07-01"]?.["public-repo"]?.features.skills,
    ).toEqual({ "public-skill": 1 });
    // 除外語がJSON全体から消えていること
    expect(JSON.stringify(out)).not.toContain("secret-skill");
    expect(JSON.stringify(out)).not.toContain("secret-repo");
    expect(JSON.stringify(out)).not.toContain("/secret-cmd");
  });

  it("除外なしなら元の内容を保つ", () => {
    const out = applyExclusions(base, new Set());
    expect(out.skills).toEqual(base.skills);
    expect(out.dailyFeatures).toEqual(base.dailyFeatures);
  });
});
