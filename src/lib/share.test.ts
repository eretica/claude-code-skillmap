import { describe, expect, it } from "vitest";
import { buildOutgoing, buildSharePayload } from "./share";
import { exKey } from "./exclude";
import type { UsageSummary } from "./types";

function summaryOf(over: Partial<UsageSummary>): UsageSummary {
  return {
    schemaVersion: 1,
    name: "t",
    exportedAt: "2026-08-01T00:00:00.000Z",
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

const fresh = summaryOf({
  dailyActivity: [
    { date: "2026-08-01", sessions: 2, skillSessions: 1, messages: 20, toolCalls: 5, userPrompts: 3 },
  ],
  skills: { "skill-a": 3, "secret-skill": 1 },
  repos: { "work-repo": 15, "private-repo": 5 },
  dailyFeatures: {
    "2026-08-01": {
      skills: { "skill-a": 3, "secret-skill": 1 },
      repos: { "work-repo": 15, "private-repo": 5 },
    },
  },
  dailyRepos: {
    "2026-08-01": {
      "work-repo": {
        sessions: 1, skillSessions: 1, messages: 15, toolCalls: 3, userPrompts: 2,
        features: { skills: { "skill-a": 2, "secret-skill": 1 } },
      },
      "private-repo": {
        sessions: 1, skillSessions: 0, messages: 5, toolCalls: 2, userPrompts: 1,
        features: { skills: { "skill-a": 1 } },
      },
    },
  },
});

describe("buildOutgoing", () => {
  it("選ばれていないリポジトリと除外項目がJSONのどこにも残らない", () => {
    const out = buildOutgoing(
      fresh,
      "me",
      new Set([exKey("skills", "secret-skill")]),
      new Set(["work-repo"]), // private-repoは未選択
    );
    expect(out.name).toBe("me");
    expect(out.repos).toEqual({ "work-repo": 15 });
    expect(out.skills).toEqual({ "skill-a": 3 });
    const json = JSON.stringify(out);
    expect(json).not.toContain("private-repo");
    expect(json).not.toContain("secret-skill");
  });
});

describe("buildSharePayload", () => {
  it("保存分なしならbuildOutgoingと同じ", () => {
    const a = buildSharePayload(fresh, null, "me", new Set(), new Set(["work-repo"]));
    const b = buildOutgoing(fresh, "me", new Set(), new Set(["work-repo"]));
    expect(a).toEqual(b);
  });

  it("保存分とマージし、マージで復活した古いリポジトリも未選択なら落とす", () => {
    const stored = summaryOf({
      name: "me",
      dailyActivity: [
        { date: "2026-06-01", sessions: 3, skillSessions: 2, messages: 30, toolCalls: 9, userPrompts: 4 },
      ],
      repos: { "old-repo": 30 },
      dailyFeatures: { "2026-06-01": { repos: { "old-repo": 30 }, skills: { "old-skill": 2 } } },
      dailyRepos: {
        "2026-06-01": {
          "old-repo": {
            sessions: 3, skillSessions: 2, messages: 30, toolCalls: 9, userPrompts: 4,
            features: { skills: { "old-skill": 2 } },
          },
        },
      },
      skills: { "old-skill": 2 },
    });
    // includedReposはwork-repoのみ → 古いold-repoもprivate-repoも落ちる
    const out = buildSharePayload(fresh, stored, "me", new Set(), new Set(["work-repo"]));
    expect(out.dailyActivity.map((d) => d.date)).toEqual(["2026-06-01", "2026-08-01"]);
    expect(out.repos).toEqual({ "work-repo": 15 });
    // 古い日付のスキル実績は残る(リポジトリ除外はスキルには波及しない)
    expect(out.skills["old-skill"]).toBe(2);
    const json = JSON.stringify(out);
    expect(json).not.toContain("old-repo");
    expect(json).not.toContain("private-repo");
  });
});
