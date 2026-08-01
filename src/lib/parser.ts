import type { FeatureCategory, RepoDaily, UsageSummary, TokenUsage } from "./types";
import { SUMMARY_SCHEMA_VERSION } from "./types";
import { localDate } from "./dates";

// ~/.claude/projects/ 配下のJSONLトランスクリプトをブラウザ内でパースし、
// ホワイトリストに含まれるメタデータだけを集計する。
// message.content の本文 / tool_use の引数 / toolUseResult は一切保持しない。

interface Accum {
  sessionIds: Set<string>;
  sessionsWithSkill: Set<string>;
  sessionsWithSubagent: Set<string>;
  daily: Map<
    string,
    {
      sessions: Set<string>;
      skillSessions: Set<string>;
      messages: number;
      toolCalls: number;
      userPrompts: number;
    }
  >;
  dailyTokens: Map<string, Map<string, TokenUsage>>;
  tokensByModel: Map<string, TokenUsage>;
  skills: Map<string, number>;
  subagents: Map<string, number>;
  mcpTools: Map<string, number>;
  slashCommands: Map<string, number>;
  plugins: Map<string, number>;
  tools: Map<string, number>;
  dailyFeatures: Map<string, Map<FeatureCategory, Map<string, number>>>;
  repos: Map<string, number>;
  dailyRepos: Map<string, Map<string, RepoBucket>>;
  entrypointSessions: Map<string, Set<string>>;
  modeSessions: Map<string, Set<string>>;
  permissionModeSessions: Map<string, Set<string>>;
  sessionMessages: Map<string, number>;
  webSearchRequests: number;
  webFetchRequests: number;
  assistantMessages: number;
  userPrompts: number;
  toolCalls: number;
  minDate: string | null;
  maxDate: string | null;
}

export interface ParseProgress {
  filesDone: number;
  filesTotal: number;
  linesParsed: number;
  errors: number;
}

const COMMAND_RE = /<command-name>([^<]+)<\/command-name>/g;

// "figma:figma-use" / "review-dms:branch" 形式のプレフィックス = プラグイン名
function pluginOf(name: string): string | null {
  const i = name.indexOf(":");
  return i > 0 ? name.slice(0, i) : null;
}

function bump(map: Map<string, number>, key: string) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

interface RepoBucket {
  sessions: Set<string>;
  skillSessions: Set<string>;
  messages: number;
  toolCalls: number;
  userPrompts: number;
  features: Map<Exclude<FeatureCategory, "repos">, Map<string, number>>;
}

// cwdの末尾ディレクトリ名だけをリポジトリ名として使う(フルパスは保持しない)
function repoOf(record: { cwd?: unknown }): string | null {
  if (typeof record.cwd !== "string") return null;
  const name = record.cwd.split("/").filter(Boolean).pop();
  return name && name.length > 0 ? name : null;
}

function repoBucket(acc: Accum, date: string, repo: string): RepoBucket {
  let day = acc.dailyRepos.get(date);
  if (!day) {
    day = new Map();
    acc.dailyRepos.set(date, day);
  }
  let bucket = day.get(repo);
  if (!bucket) {
    bucket = {
      sessions: new Set(),
      skillSessions: new Set(),
      messages: 0,
      toolCalls: 0,
      userPrompts: 0,
      features: new Map(),
    };
    day.set(repo, bucket);
  }
  return bucket;
}

// 期間フィルタ用に、機能利用を日別にも積み上げる。
// repoが分かる場合はリポジトリ別の日別バケットにも同じカウントを積む
function bumpDaily(
  acc: Accum,
  date: string | null,
  category: FeatureCategory,
  key: string,
  repo?: string | null,
) {
  if (!date) return;
  let day = acc.dailyFeatures.get(date);
  if (!day) {
    day = new Map();
    acc.dailyFeatures.set(date, day);
  }
  let rec = day.get(category);
  if (!rec) {
    rec = new Map();
    day.set(category, rec);
  }
  bump(rec, key);
  if (repo && category !== "repos") {
    const bucket = repoBucket(acc, date, repo);
    let brec = bucket.features.get(category);
    if (!brec) {
      brec = new Map();
      bucket.features.set(category, brec);
    }
    bump(brec, key);
  }
}

function bumpSession(
  map: Map<string, Set<string>>,
  key: string,
  sessionId: string,
) {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(sessionId);
}

function newAccum(): Accum {
  return {
    sessionIds: new Set(),
    sessionsWithSkill: new Set(),
    sessionsWithSubagent: new Set(),
    daily: new Map(),
    tokensByModel: new Map(),
    skills: new Map(),
    subagents: new Map(),
    mcpTools: new Map(),
    slashCommands: new Map(),
    plugins: new Map(),
    tools: new Map(),
    dailyFeatures: new Map(),
    repos: new Map(),
    dailyRepos: new Map(),
    dailyTokens: new Map(),
    entrypointSessions: new Map(),
    modeSessions: new Map(),
    permissionModeSessions: new Map(),
    sessionMessages: new Map(),
    webSearchRequests: 0,
    webFetchRequests: 0,
    assistantMessages: 0,
    userPrompts: 0,
    toolCalls: 0,
    minDate: null,
    maxDate: null,
  };
}

// タイムスタンプ(UTC)を閲覧者のローカル日付に変換して日別バケットにする
function dayOf(record: { timestamp?: unknown }): string | null {
  if (typeof record.timestamp !== "string") return null;
  const d = new Date(record.timestamp);
  if (Number.isNaN(d.getTime())) return null;
  return localDate(d);
}

function dailyEntry(acc: Accum, date: string) {
  let e = acc.daily.get(date);
  if (!e) {
    e = {
      sessions: new Set(),
      skillSessions: new Set(),
      messages: 0,
      toolCalls: 0,
      userPrompts: 0,
    };
    acc.daily.set(date, e);
  }
  if (acc.minDate === null || date < acc.minDate) acc.minDate = date;
  if (acc.maxDate === null || date > acc.maxDate) acc.maxDate = date;
  return e;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleAssistant(acc: Accum, rec: any) {
  const date = dayOf(rec);
  const repo = repoOf(rec);
  if (repo && date) {
    bump(acc.repos, repo);
    bumpDaily(acc, date, "repos", repo);
    const bucket = repoBucket(acc, date, repo);
    bucket.messages++;
  }
  const sessionId: string | undefined =
    typeof rec.sessionId === "string" ? rec.sessionId : undefined;
  if (sessionId) {
    acc.sessionIds.add(sessionId);
    if (repo && date) repoBucket(acc, date, repo).sessions.add(sessionId);
    acc.sessionMessages.set(
      sessionId,
      (acc.sessionMessages.get(sessionId) ?? 0) + 1,
    );
    if (typeof rec.entrypoint === "string")
      bumpSession(acc.entrypointSessions, rec.entrypoint, sessionId);
  }
  acc.assistantMessages++;
  if (date) {
    const e = dailyEntry(acc, date);
    e.messages++;
    if (sessionId) e.sessions.add(sessionId);
  }

  const msg = rec.message;
  if (!msg || typeof msg !== "object") return;

  const usage = msg.usage;
  // "<synthetic>" はエラー行等に入る内部プレースホルダなので集計から除外
  if (
    usage &&
    typeof usage === "object" &&
    typeof msg.model === "string" &&
    !msg.model.startsWith("<")
  ) {
    let t = acc.tokensByModel.get(msg.model);
    if (!t) {
      t = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
      acc.tokensByModel.set(msg.model, t);
    }
    t.input += usage.input_tokens ?? 0;
    t.output += usage.output_tokens ?? 0;
    t.cacheRead += usage.cache_read_input_tokens ?? 0;
    t.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    // 日付マージによる蓄積のため日別にも積む
    if (date) {
      let day = acc.dailyTokens.get(date);
      if (!day) {
        day = new Map();
        acc.dailyTokens.set(date, day);
      }
      let dt = day.get(msg.model);
      if (!dt) {
        dt = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
        day.set(msg.model, dt);
      }
      dt.input += usage.input_tokens ?? 0;
      dt.output += usage.output_tokens ?? 0;
      dt.cacheRead += usage.cache_read_input_tokens ?? 0;
      dt.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }
    const stu = usage.server_tool_use;
    if (stu && typeof stu === "object") {
      acc.webSearchRequests += stu.web_search_requests ?? 0;
      acc.webFetchRequests += stu.web_fetch_requests ?? 0;
    }
  }

  if (!Array.isArray(msg.content)) return;
  for (const item of msg.content) {
    if (!item || item.type !== "tool_use" || typeof item.name !== "string")
      continue;
    acc.toolCalls++;
    if (date) {
      dailyEntry(acc, date).toolCalls++;
      if (repo) repoBucket(acc, date, repo).toolCalls++;
    }
    const name: string = item.name;

    if (name.startsWith("mcp__")) {
      const parts = name.split("__");
      const mcpKey = `${parts[1] ?? "?"}/${parts.slice(2).join("__")}`;
      bump(acc.mcpTools, mcpKey);
      bumpDaily(acc, date, "mcpTools", mcpKey, repo);
      continue;
    }
    bump(acc.tools, name);

    if (name === "Skill") {
      const skill = item.input?.skill;
      if (typeof skill === "string" && skill.length > 0) {
        bump(acc.skills, skill);
        bumpDaily(acc, date, "skills", skill, repo);
        const plugin = pluginOf(skill);
        if (plugin) {
          bump(acc.plugins, plugin);
          bumpDaily(acc, date, "plugins", plugin, repo);
        }
        if (sessionId) {
          acc.sessionsWithSkill.add(sessionId);
          if (date) {
            dailyEntry(acc, date).skillSessions.add(sessionId);
            if (repo) repoBucket(acc, date, repo).skillSessions.add(sessionId);
          }
        }
      }
    } else if (name === "Agent" || name === "Task") {
      const sub = item.input?.subagent_type;
      const subKey =
        typeof sub === "string" && sub.length > 0 ? sub : "general-purpose";
      bump(acc.subagents, subKey);
      bumpDaily(acc, date, "subagents", subKey, repo);
      if (sessionId) acc.sessionsWithSubagent.add(sessionId);
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function handleUser(acc: Accum, rec: any) {
  const date = dayOf(rec);
  const repo = repoOf(rec);
  const msg = rec.message;
  if (!msg || typeof msg !== "object") return;
  const content = msg.content;

  // 文字列content = 生のユーザー入力。tool_result のみの配列はプロンプトではない。
  const texts: string[] = [];
  if (typeof content === "string") {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const item of content) {
      if (item && item.type === "text" && typeof item.text === "string")
        texts.push(item.text);
    }
  }
  if (texts.length === 0) return;

  // コマンド名タグだけを抽出する。本文自体は保持しない。
  let isCommand = false;
  for (const text of texts) {
    for (const m of text.matchAll(COMMAND_RE)) {
      const cmd = m[1].trim();
      if (!cmd) continue;
      isCommand = true;
      bump(acc.slashCommands, cmd);
      bumpDaily(acc, date, "slashCommands", cmd, repo);
      const plugin = pluginOf(cmd.replace(/^\//, ""));
      if (plugin) {
        bump(acc.plugins, plugin);
        bumpDaily(acc, date, "plugins", plugin, repo);
      }
    }
  }

  // スラッシュコマンドの実行行はコマンドとして数え、プロンプト数には含めない
  if (!isCommand) {
    acc.userPrompts++;
    if (date) {
      dailyEntry(acc, date).userPrompts++;
      if (repo) repoBucket(acc, date, repo).userPrompts++;
    }
  }
}

async function parseFile(
  file: File,
  acc: Accum,
  progress: ParseProgress,
): Promise<void> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value !== undefined) buf += value;
    const lines = buf.split("\n");
    buf = done ? "" : (lines.pop() ?? "");
    for (const line of done ? lines.filter((l) => l.trim()) : lines) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line);
        progress.linesParsed++;
        if (rec.type === "assistant") handleAssistant(acc, rec);
        else if (rec.type === "user") handleUser(acc, rec);
        else if (
          rec.type === "mode" &&
          typeof rec.mode === "string" &&
          typeof rec.sessionId === "string"
        )
          bumpSession(acc.modeSessions, rec.mode, rec.sessionId);
        else if (
          rec.type === "permission-mode" &&
          typeof rec.permissionMode === "string" &&
          typeof rec.sessionId === "string"
        )
          bumpSession(acc.permissionModeSessions, rec.permissionMode, rec.sessionId);
      } catch {
        progress.errors++;
      }
    }
    if (done) break;
  }
}

function sortDesc(map: Map<string, number>): Record<string, number> {
  return Object.fromEntries([...map.entries()].sort((a, b) => b[1] - a[1]));
}

function sessionCounts(map: Map<string, Set<string>>): Record<string, number> {
  return Object.fromEntries(
    [...map.entries()]
      .map(([k, v]) => [k, v.size] as const)
      .sort((a, b) => b[1] - a[1]),
  );
}

const LENGTH_BUCKETS = ["1-10", "11-50", "51-200", "201+"] as const;

function lengthBuckets(map: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(
    LENGTH_BUCKETS.map((b) => [b, 0]),
  );
  for (const n of map.values()) {
    if (n <= 10) out["1-10"]++;
    else if (n <= 50) out["11-50"]++;
    else if (n <= 200) out["51-200"]++;
    else out["201+"]++;
  }
  return out;
}

export async function parseTranscripts(
  files: File[],
  name: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<UsageSummary> {
  const acc = newAccum();
  const progress: ParseProgress = {
    filesDone: 0,
    filesTotal: files.length,
    linesParsed: 0,
    errors: 0,
  };
  for (const file of files) {
    await parseFile(file, acc, progress);
    progress.filesDone++;
    onProgress?.({ ...progress });
    // UIを固まらせないため1ファイルごとにイベントループへ譲る
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    name,
    exportedAt: new Date().toISOString(),
    period: { from: acc.minDate, to: acc.maxDate },
    totals: {
      sessions: acc.sessionIds.size,
      assistantMessages: acc.assistantMessages,
      userPrompts: acc.userPrompts,
      toolCalls: acc.toolCalls,
      activeDays: acc.daily.size,
    },
    dailyActivity: [...acc.daily.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, e]) => ({
        date,
        sessions: e.sessions.size,
        skillSessions: e.skillSessions.size,
        messages: e.messages,
        toolCalls: e.toolCalls,
        userPrompts: e.userPrompts,
      })),
    tokensByModel: Object.fromEntries(acc.tokensByModel),
    skills: sortDesc(acc.skills),
    subagents: sortDesc(acc.subagents),
    mcpTools: sortDesc(acc.mcpTools),
    slashCommands: sortDesc(acc.slashCommands),
    plugins: sortDesc(acc.plugins),
    repos: sortDesc(acc.repos),
    tools: sortDesc(acc.tools),
    dailyRepos: Object.fromEntries(
      [...acc.dailyRepos.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, repoMap]) => [
          date,
          Object.fromEntries(
            [...repoMap.entries()].map(([repo, b]) => [
              repo,
              {
                sessions: b.sessions.size,
                skillSessions: b.skillSessions.size,
                messages: b.messages,
                toolCalls: b.toolCalls,
                userPrompts: b.userPrompts,
                features: Object.fromEntries(
                  [...b.features.entries()].map(([cat, rec]) => [
                    cat,
                    sortDesc(rec),
                  ]),
                ),
              } satisfies RepoDaily,
            ]),
          ),
        ]),
    ),
    dailyTokens: Object.fromEntries(
      [...acc.dailyTokens.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, models]) => [date, Object.fromEntries(models)]),
    ),
    dailyFeatures: Object.fromEntries(
      [...acc.dailyFeatures.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, cats]) => [
          date,
          Object.fromEntries(
            [...cats.entries()].map(([cat, rec]) => [cat, sortDesc(rec)]),
          ),
        ]),
    ),
    entrypoints: sessionCounts(acc.entrypointSessions),
    modes: sessionCounts(acc.modeSessions),
    permissionModes: sessionCounts(acc.permissionModeSessions),
    sessionLengthBuckets: lengthBuckets(acc.sessionMessages),
    webSearchRequests: acc.webSearchRequests,
    webFetchRequests: acc.webFetchRequests,
    sessionsWithSkill: acc.sessionsWithSkill.size,
    sessionsWithSubagent: acc.sessionsWithSubagent.size,
  };
}
