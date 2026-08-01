import type { UsageSummary } from "./types";

// ~/.claude/stats-cache.json からの過去履歴バックフィル。
// トランスクリプト(cleanupPeriodDaysで消える)より古い期間の
// 日別アクティビティが残っていることがあるため、これを取り込んで
// mergeSummaries で結合する(トランスクリプト由来の日付が優先される)。
// トークンはモデル別合計1値しか無く入出力に分解できないため取り込まない。

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function isStatsCacheFile(file: File): boolean {
  return file.name === "stats-cache.json";
}

/** バックフィル用の擬似サマリーを作る。日別アクティビティのみを持つ */
export async function parseStatsCacheFile(file: File): Promise<UsageSummary> {
  const data = JSON.parse(await file.text());
  if (!Array.isArray(data?.dailyActivity)) {
    throw new Error(`${file.name} は stats-cache.json の形式ではありません`);
  }
  const dailyActivity = (data.dailyActivity as unknown[])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d?.date ?? ""))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((d: any) => ({
      date: d.date as string,
      sessions: num(d.sessionCount),
      messages: num(d.messageCount),
      toolCalls: num(d.toolCallCount),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const dates = dailyActivity.map((d) => d.date);
  return {
    schemaVersion: 1,
    name: "stats-cache",
    exportedAt: "",
    period: { from: dates[0] ?? null, to: dates[dates.length - 1] ?? null },
    totals: {
      sessions: dailyActivity.reduce((s, d) => s + d.sessions, 0),
      assistantMessages: dailyActivity.reduce((s, d) => s + d.messages, 0),
      userPrompts: 0,
      toolCalls: dailyActivity.reduce((s, d) => s + d.toolCalls, 0),
      activeDays: dailyActivity.length,
    },
    dailyActivity,
    tokensByModel: {},
    skills: {},
    subagents: {},
    mcpTools: {},
    slashCommands: {},
    plugins: {},
    tools: {},
    sessionsWithSkill: 0,
    sessionsWithSubagent: 0,
  };
}
