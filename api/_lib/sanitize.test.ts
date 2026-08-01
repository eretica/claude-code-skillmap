import { describe, expect, it } from "vitest";
import { sanitizeSummary } from "./sanitize.js";

const valid = {
  schemaVersion: 1,
  name: "tester",
  exportedAt: "2026-07-29T00:00:00.000Z",
  period: { from: "2026-07-01", to: "2026-07-29" },
  totals: { sessions: 5, assistantMessages: 10, userPrompts: 3, toolCalls: 7, activeDays: 2 },
  dailyActivity: [{ date: "2026-07-01", sessions: 1, messages: 5, toolCalls: 2 }],
  tokensByModel: { "claude-fable-5": { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 } },
  skills: { dataviz: 1 },
  subagents: {},
  mcpTools: {},
  slashCommands: {},
  plugins: {},
  tools: { Read: 3 },
  dailyFeatures: { "2026-07-01": { skills: { dataviz: 1 } } },
  dailyTokens: {
    "2026-07-01": {
      "claude-fable-5": { input: 1, output: 2, cacheRead: 3, cacheCreation: 4 },
    },
  },
  sessionsWithSkill: 1,
  sessionsWithSubagent: 0,
};

describe("sanitizeSummary", () => {
  it("正しいサマリーはそのまま通す", () => {
    const out = sanitizeSummary(valid);
    expect(out.name).toBe("tester");
    expect(out.skills).toEqual({ dataviz: 1 });
    expect(out.dailyFeatures).toEqual({ "2026-07-01": { skills: { dataviz: 1 } } });
    expect(out.dailyTokens).toEqual(valid.dailyTokens);
    expect(out.tokensByModel["claude-fable-5"].cacheRead).toBe(3);
  });

  it("dailyFeaturesのreposカテゴリが保存後も残る(期間フィルタのリポジトリ集計に必須)", () => {
    // 過去にサニタイズのカテゴリリストが独自定義でreposを落とし、
    // クラウド版の期間フィルタでのみリポジトリ×メンバーが空になるバグがあった
    const out = sanitizeSummary({
      ...valid,
      dailyFeatures: {
        "2026-07-01": { skills: { dataviz: 1 }, repos: { "my-repo": 5 } },
      },
    });
    expect(out.dailyFeatures?.["2026-07-01"]?.repos).toEqual({ "my-repo": 5 });
  });

  it("未知のフィールドは出力に含めない(会話本文などの混入防止)", () => {
    const out = sanitizeSummary({
      ...valid,
      conversation: "SECRET",
      history: ["SECRET"],
      nested: { evil: "SECRET" },
    });
    expect(JSON.stringify(out)).not.toContain("SECRET");
  });

  it("schemaVersion不一致・name欠落は拒否する", () => {
    expect(() => sanitizeSummary({ ...valid, schemaVersion: 2 })).toThrow();
    expect(() => sanitizeSummary({ ...valid, name: "" })).toThrow();
    expect(() => sanitizeSummary(null)).toThrow();
  });

  it("不正な値を無害化する(数値以外→0、不正日付は除外、長すぎるキーは捨てる)", () => {
    const out = sanitizeSummary({
      ...valid,
      totals: { sessions: "999", assistantMessages: null },
      dailyActivity: [
        { date: "not-a-date", sessions: 1, messages: 1, toolCalls: 1 },
        { date: "2026-07-02", sessions: "x", messages: 2, toolCalls: 2 },
      ],
      skills: { ["x".repeat(300)]: 5, ok: 1 },
      dailyFeatures: {
        "bad-date": { skills: { a: 1 } },
        "2026-07-03": { skills: { b: "not-number" }, unknownCat: { c: 1 } },
      },
    });
    expect(out.totals.sessions).toBe(0);
    expect(out.dailyActivity).toEqual([
      {
        date: "2026-07-02",
        sessions: 0,
        skillSessions: 0,
        messages: 2,
        toolCalls: 2,
        userPrompts: 0,
        sidechainMessages: 0,
      },
    ]);
    expect(out.skills).toEqual({ ok: 1 });
    expect(Object.keys(out.dailyFeatures ?? {})).toEqual(["2026-07-03"]);
    expect(out.dailyFeatures?.["2026-07-03"]).toEqual({ skills: { b: 0 } });
  });
});
