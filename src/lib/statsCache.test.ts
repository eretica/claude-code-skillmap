import { describe, expect, it } from "vitest";
import { parseStatsCacheFile } from "./statsCache";
import { mergeSummaries } from "./merge";
import type { UsageSummary } from "./types";

function fileOf(data: unknown): File {
  return new File([JSON.stringify(data)], "stats-cache.json");
}

describe("parseStatsCacheFile", () => {
  it("dailyActivityを取り込み、不正な行は捨てる", async () => {
    const s = await parseStatsCacheFile(
      fileOf({
        version: 1,
        dailyActivity: [
          { date: "2025-12-25", messageCount: 131, sessionCount: 4, toolCallCount: 36 },
          { date: "bad-date", messageCount: 1, sessionCount: 1, toolCallCount: 1 },
          { date: "2026-01-10", messageCount: 50, sessionCount: 2, toolCallCount: 10 },
        ],
      }),
    );
    expect(s.dailyActivity).toEqual([
      { date: "2025-12-25", sessions: 4, messages: 131, toolCalls: 36 },
      { date: "2026-01-10", sessions: 2, messages: 50, toolCalls: 10 },
    ]);
    expect(s.totals.sessions).toBe(6);
    expect(s.period).toEqual({ from: "2025-12-25", to: "2026-01-10" });
  });

  it("形式が違うファイルは拒否する", async () => {
    await expect(parseStatsCacheFile(fileOf({ foo: 1 }))).rejects.toThrow();
  });

  it("mergeSummariesでトランスクリプト解析分と結合できる(解析分が優先)", async () => {
    const backfill = await parseStatsCacheFile(
      fileOf({
        dailyActivity: [
          { date: "2026-01-10", messageCount: 50, sessionCount: 2, toolCallCount: 10 },
          { date: "2026-07-01", messageCount: 999, sessionCount: 99, toolCallCount: 99 },
        ],
      }),
    );
    const parsed: UsageSummary = {
      ...backfill,
      name: "me",
      dailyActivity: [
        { date: "2026-07-01", sessions: 3, skillSessions: 1, messages: 30, toolCalls: 12, userPrompts: 5 },
      ],
      skills: { a: 1 },
      dailyFeatures: { "2026-07-01": { skills: { a: 1 } } },
      tokensByModel: {
        "claude-fable-5": { input: 1, output: 1, cacheRead: 1, cacheCreation: 1 },
      },
    };
    const m = mergeSummaries(backfill, parsed);
    // 重複日(7/1)は解析分が勝ち、バックフィル日(1/10)は残る
    expect(m.dailyActivity.map((d) => [d.date, d.sessions])).toEqual([
      ["2026-01-10", 2],
      ["2026-07-01", 3],
    ]);
    // トークンはバックフィルに日別が無いので解析分のまま
    expect(m.tokensByModel).toEqual(parsed.tokensByModel);
    expect(m.skills).toEqual({ a: 1 });
  });

  it("スキル利用率はバックフィル日(スキル情報なし)で希釈されない", async () => {
    const { skillRate } = await import("./teamStats");
    const backfill = await parseStatsCacheFile(
      fileOf({
        dailyActivity: [
          { date: "2026-01-10", messageCount: 500, sessionCount: 97, toolCallCount: 100 },
        ],
      }),
    );
    const parsed: UsageSummary = {
      ...backfill,
      name: "me",
      dailyActivity: [
        { date: "2026-07-01", sessions: 4, skillSessions: 2, messages: 30, toolCalls: 12, userPrompts: 5 },
      ],
      sessionsWithSkill: 2,
    };
    const m = mergeSummaries(backfill, parsed);
    // 97セッションの旧データが分母に入ると2%になるが、スキル情報のある日だけなら50%
    expect(skillRate(m)).toBe(50);
  });
});
