import type { UsageSummary } from "../../src/lib/types";

// サーバー側の二重防御: クライアントが何を送ってきても、
// 既知のフィールドだけを型検証しながら再構築する。
// 想定外のフィールド(会話本文など)は構造上ここで必ず落ちる。

const MAX_KEYS = 500;
const MAX_KEY_LEN = 200;
const MAX_DAYS = 5000;

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function countRecord(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object") return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(v).slice(0, MAX_KEYS)) {
    if (key.length > MAX_KEY_LEN) continue;
    out[key] = num(value);
  }
  return out;
}

function dateStr(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

const FEATURE_CATEGORIES = [
  "skills",
  "subagents",
  "mcpTools",
  "slashCommands",
  "plugins",
] as const;

function sanitizeDailyTokens(v: unknown): UsageSummary["dailyTokens"] {
  if (!v || typeof v !== "object") return undefined;
  const out: NonNullable<UsageSummary["dailyTokens"]> = {};
  for (const [date, models] of Object.entries(v).slice(0, MAX_DAYS)) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !models ||
      typeof models !== "object"
    )
      continue;
    const entry: Record<string, UsageSummary["tokensByModel"][string]> = {};
    for (const [model, t] of Object.entries(models).slice(0, 100)) {
      if (model.length > MAX_KEY_LEN || !t || typeof t !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tt = t as any;
      entry[model] = {
        input: num(tt.input),
        output: num(tt.output),
        cacheRead: num(tt.cacheRead),
        cacheCreation: num(tt.cacheCreation),
      };
    }
    out[date] = entry;
  }
  return out;
}

function sanitizeDailyFeatures(v: unknown): UsageSummary["dailyFeatures"] {
  if (!v || typeof v !== "object") return undefined;
  const out: NonNullable<UsageSummary["dailyFeatures"]> = {};
  for (const [date, cats] of Object.entries(v).slice(0, MAX_DAYS)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !cats || typeof cats !== "object")
      continue;
    const entry: NonNullable<UsageSummary["dailyFeatures"]>[string] = {};
    for (const category of FEATURE_CATEGORIES) {
      const rec = (cats as Record<string, unknown>)[category];
      if (rec && typeof rec === "object") entry[category] = countRecord(rec);
    }
    out[date] = entry;
  }
  return out;
}

export function sanitizeSummary(body: unknown): UsageSummary {
  if (!body || typeof body !== "object") throw new Error("invalid body");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = body as any;
  if (b.schemaVersion !== 1) throw new Error("unsupported schemaVersion");
  const name = typeof b.name === "string" ? b.name.trim().slice(0, 64) : "";
  if (!name) throw new Error("name is required");

  const daily = Array.isArray(b.dailyActivity) ? b.dailyActivity : [];
  const tokensByModel: UsageSummary["tokensByModel"] = {};
  if (b.tokensByModel && typeof b.tokensByModel === "object") {
    for (const [model, t] of Object.entries(b.tokensByModel).slice(0, 100)) {
      if (model.length > MAX_KEY_LEN || !t || typeof t !== "object") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tt = t as any;
      tokensByModel[model] = {
        input: num(tt.input),
        output: num(tt.output),
        cacheRead: num(tt.cacheRead),
        cacheCreation: num(tt.cacheCreation),
      };
    }
  }

  return {
    schemaVersion: 1,
    name,
    exportedAt:
      typeof b.exportedAt === "string" ? b.exportedAt.slice(0, 40) : "",
    period: {
      from: dateStr(b.period?.from),
      to: dateStr(b.period?.to),
    },
    totals: {
      sessions: num(b.totals?.sessions),
      assistantMessages: num(b.totals?.assistantMessages),
      userPrompts: num(b.totals?.userPrompts),
      toolCalls: num(b.totals?.toolCalls),
      activeDays: num(b.totals?.activeDays),
    },
    dailyActivity: daily
      .slice(0, MAX_DAYS)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => ({
        date: dateStr(d?.date),
        sessions: num(d?.sessions),
        skillSessions: num(d?.skillSessions),
        messages: num(d?.messages),
        toolCalls: num(d?.toolCalls),
        userPrompts: num(d?.userPrompts),
      }))
      .filter((d: { date: string | null }) => d.date !== null) as
      UsageSummary["dailyActivity"],
    tokensByModel,
    skills: countRecord(b.skills),
    subagents: countRecord(b.subagents),
    mcpTools: countRecord(b.mcpTools),
    slashCommands: countRecord(b.slashCommands),
    plugins: countRecord(b.plugins),
    tools: countRecord(b.tools),
    dailyFeatures: sanitizeDailyFeatures(b.dailyFeatures),
    dailyTokens: sanitizeDailyTokens(b.dailyTokens),
    entrypoints: countRecord(b.entrypoints),
    modes: countRecord(b.modes),
    permissionModes: countRecord(b.permissionModes),
    sessionLengthBuckets: countRecord(b.sessionLengthBuckets),
    webSearchRequests: num(b.webSearchRequests),
    webFetchRequests: num(b.webFetchRequests),
    sessionsWithSkill: num(b.sessionsWithSkill),
    sessionsWithSubagent: num(b.sessionsWithSubagent),
  };
}
