// セッション詳細(OpenTelemetry風タイムライン)のためのローカル専用パース。
// この結果はサマリーJSONとは完全に別系統で、共有・エクスポートには一切含まれない。
// 表示するのは名前・種類・タイムスタンプ・回数のみ(会話本文・引数・パスは保持しない)。

export interface SessionMeta {
  sessionId: string;
  /** ai-title行にあるClaude Code自動生成のタイトル(ローカル表示のみ) */
  title: string | null;
  repo: string | null;
  start: number | null; // epoch ms
  end: number | null;
  assistantMessages: number;
  prompts: number;
  skills: string[];
  agentSpawns: number;
  file: File;
}

export interface SessionIndex {
  sessions: SessionMeta[];
  /** sessionId -> subagents/ 配下のトランスクリプト */
  subagentFiles: Map<string, File[]>;
}

export interface TimelineEvent {
  kind: "prompt" | "command" | "skill-call";
  name: string;
  ts: number;
}

export interface ToolAgg {
  name: string;
  count: number;
  first: number;
  last: number;
}

export interface TimelineSpan {
  kind: "skill" | "agent";
  name: string;
  /** agent: subagent_type / model 等の補足 */
  detail?: string;
  start: number;
  end: number;
  messages: number;
  tools: ToolAgg[];
  /** agentスパン内で発動したスキルスパン */
  children: TimelineSpan[];
}

export type TimelineItem =
  | { type: "event"; event: TimelineEvent }
  | { type: "span"; span: TimelineSpan };

export interface SessionDetail {
  sessionId: string;
  start: number;
  end: number;
  items: TimelineItem[];
  /** スキル・エージェントに帰属しないメインレーンのツール */
  topTools: ToolAgg[];
  /** attributionSkill付きの新形式か(falseならスキルは呼び出しイベントのみ) */
  hasAttribution: boolean;
}

const COMMAND_RE = /<command-name>([^<]+)<\/command-name>/;

async function eachLine(
  file: File,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cb: (rec: any) => void,
): Promise<void> {
  const reader = file.stream().pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (value !== undefined) buf += value;
    const lines = buf.split("\n");
    buf = done ? "" : (lines.pop() ?? "");
    for (const line of done ? lines : lines) {
      if (!line.trim()) continue;
      try {
        cb(JSON.parse(line));
      } catch {
        // 壊れた行は無視
      }
    }
    if (done) break;
  }
}

function tsOf(rec: { timestamp?: unknown }): number | null {
  if (typeof rec.timestamp !== "string") return null;
  const t = new Date(rec.timestamp).getTime();
  return Number.isNaN(t) ? null : t;
}

// パーサ本体と同じ正規化: mcp__server__tool -> server/tool
function toolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const parts = name.split("__");
    return `${parts[1] ?? "?"}/${parts.slice(2).join("__")}`;
  }
  return name;
}

function isMainTranscript(f: File): boolean {
  return f.name.endsWith(".jsonl") && !f.name.startsWith("agent-");
}

function isSubagentTranscript(f: File): boolean {
  return f.name.endsWith(".jsonl") && f.name.startsWith("agent-");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function userTexts(rec: any): string[] {
  const content = rec?.message?.content;
  const out: string[] = [];
  if (typeof content === "string") out.push(content);
  else if (Array.isArray(content)) {
    for (const it of content) {
      if (it && it.type === "text" && typeof it.text === "string")
        out.push(it.text);
    }
  }
  return out;
}

/** 解析済みファイル群からセッション一覧を作る(内容は保持せずメタデータのみ) */
export async function buildSessionIndex(files: File[]): Promise<SessionIndex> {
  const sessions: SessionMeta[] = [];
  const subagentFiles = new Map<string, File[]>();

  for (const file of files) {
    if (isSubagentTranscript(file)) {
      // 先頭だけ読んで親セッションIDを取り出す(全文は詳細表示時に読む)
      const head = await file.slice(0, 16384).text();
      const m = head.match(/"sessionId"\s*:\s*"([^"]+)"/);
      if (m) {
        const list = subagentFiles.get(m[1]) ?? [];
        list.push(file);
        subagentFiles.set(m[1], list);
      }
      continue;
    }
    if (!isMainTranscript(file)) continue;

    const meta: SessionMeta = {
      sessionId: file.name.replace(/\.jsonl$/, ""),
      title: null,
      repo: null,
      start: null,
      end: null,
      assistantMessages: 0,
      prompts: 0,
      skills: [],
      agentSpawns: 0,
      file,
    };
    const skills = new Set<string>();
    let sidFromRows: string | null = null;
    await eachLine(file, (rec) => {
      if (rec.type === "ai-title" && typeof rec.aiTitle === "string")
        meta.title = rec.aiTitle;
      if (sidFromRows === null && typeof rec.sessionId === "string")
        sidFromRows = rec.sessionId;
      if (rec.type !== "assistant" && rec.type !== "user") return;
      const ts = tsOf(rec);
      if (ts !== null) {
        if (meta.start === null || ts < meta.start) meta.start = ts;
        if (meta.end === null || ts > meta.end) meta.end = ts;
      }
      if (rec.type === "assistant") {
        meta.assistantMessages++;
        if (meta.repo === null && typeof rec.cwd === "string")
          meta.repo = rec.cwd.split("/").filter(Boolean).pop() ?? null;
        const content = rec.message?.content;
        if (Array.isArray(content)) {
          for (const it of content) {
            if (!it || it.type !== "tool_use") continue;
            if (it.name === "Skill" && typeof it.input?.skill === "string")
              skills.add(it.input.skill);
            else if (it.name === "Agent" || it.name === "Task")
              meta.agentSpawns++;
          }
        }
      } else {
        const texts = userTexts(rec);
        if (texts.length > 0 && !texts.some((t) => COMMAND_RE.test(t)))
          meta.prompts++;
      }
    });
    meta.skills = [...skills];
    // サブエージェントとの紐付けは行内のsessionIdで行う(ファイル名は当てにしない)
    if (sidFromRows) meta.sessionId = sidFromRows;
    if (meta.assistantMessages > 0) sessions.push(meta);
  }

  sessions.sort((a, b) => (b.end ?? 0) - (a.end ?? 0));
  return { sessions, subagentFiles };
}

interface RawSpan {
  name: string;
  start: number;
  end: number;
  messages: number;
  tools: Map<string, ToolAgg>;
}

function bumpTool(map: Map<string, ToolAgg>, name: string, ts: number) {
  const cur = map.get(name);
  if (!cur) map.set(name, { name, count: 1, first: ts, last: ts });
  else {
    cur.count++;
    if (ts < cur.first) cur.first = ts;
    if (ts > cur.last) cur.last = ts;
  }
}

function sortedTools(map: Map<string, ToolAgg>): ToolAgg[] {
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// 同名スキルスパンが小さな空白(帰属なし行)で分断された場合は結合する
const SPAN_MERGE_GAP_MS = 5 * 60_000;

function mergeSpans(raw: RawSpan[]): RawSpan[] {
  const out: RawSpan[] = [];
  for (const s of raw) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.name === s.name &&
      s.start - prev.end <= SPAN_MERGE_GAP_MS
    ) {
      prev.end = Math.max(prev.end, s.end);
      prev.messages += s.messages;
      for (const t of s.tools.values()) {
        const cur = prev.tools.get(t.name);
        if (!cur) prev.tools.set(t.name, { ...t });
        else {
          cur.count += t.count;
          cur.first = Math.min(cur.first, t.first);
          cur.last = Math.max(cur.last, t.last);
        }
      }
      continue;
    }
    out.push(s);
  }
  return out;
}

// スキル帰属スパンとツール集約を1ファイル分抽出する(メイン・サブエージェント共通)
async function extractLane(file: File): Promise<{
  spans: RawSpan[];
  events: TimelineEvent[];
  agentSpawns: { name: string; type: string; ts: number }[];
  topTools: Map<string, ToolAgg>;
  start: number | null;
  end: number | null;
  messages: number;
  model: string | null;
  agentId: string | null;
  hasAttribution: boolean;
}> {
  const spans: RawSpan[] = [];
  const events: TimelineEvent[] = [];
  const agentSpawns: { name: string; type: string; ts: number }[] = [];
  const topTools = new Map<string, ToolAgg>();
  let current: RawSpan | null = null;
  let start: number | null = null;
  let end: number | null = null;
  let messages = 0;
  let model: string | null = null;
  let agentId: string | null = null;
  let hasAttribution = false;

  await eachLine(file, (rec) => {
    if (rec.type !== "assistant" && rec.type !== "user") return;
    const ts = tsOf(rec);
    if (ts === null) return;
    if (start === null || ts < start) start = ts;
    if (end === null || ts > end) end = ts;

    if (rec.type === "user") {
      const texts = userTexts(rec);
      if (texts.length === 0) return;
      let isCommand = false;
      for (const t of texts) {
        const m = t.match(COMMAND_RE);
        if (m) {
          isCommand = true;
          events.push({ kind: "command", name: m[1].trim(), ts });
        }
      }
      if (!isCommand) events.push({ kind: "prompt", name: "プロンプト", ts });
      return;
    }

    messages++;
    if (agentId === null && typeof rec.agentId === "string")
      agentId = rec.agentId;
    if (model === null && typeof rec.message?.model === "string" &&
        !rec.message.model.startsWith("<"))
      model = rec.message.model;

    // attributionSkill = このメッセージがどのスキルの指示下で生成されたか
    const attr =
      typeof rec.attributionSkill === "string" ? rec.attributionSkill : null;
    if (attr) hasAttribution = true;
    if (current && current.name !== (attr ?? "")) {
      current = null;
    }
    if (attr) {
      if (!current) {
        current = { name: attr, start: ts, end: ts, messages: 0, tools: new Map() };
        spans.push(current);
      }
      current.end = Math.max(current.end, ts);
      current.messages++;
    }

    const content = rec.message?.content;
    if (!Array.isArray(content)) return;
    for (const it of content) {
      if (!it || it.type !== "tool_use" || typeof it.name !== "string") continue;
      if (it.name === "Skill") {
        if (typeof it.input?.skill === "string")
          events.push({ kind: "skill-call", name: it.input.skill, ts });
        continue;
      }
      if (it.name === "Agent" || it.name === "Task") {
        const type =
          typeof it.input?.subagent_type === "string"
            ? it.input.subagent_type
            : "general-purpose";
        const name =
          typeof it.input?.name === "string" && it.input.name.length > 0
            ? it.input.name
            : type;
        agentSpawns.push({ name, type, ts });
        continue;
      }
      const n = toolName(it.name);
      if (current) bumpTool(current.tools, n, ts);
      else bumpTool(topTools, n, ts);
    }
  });

  return {
    spans: mergeSpans(spans),
    events,
    agentSpawns,
    topTools,
    start,
    end,
    messages,
    model,
    agentId,
    hasAttribution,
  };
}

// subagentsファイルのagentId "a<name>-<hash>" から表示名を取り出す
function agentNameFromId(agentId: string | null, fileName: string): string {
  const src = agentId ?? fileName.replace(/^agent-/, "").replace(/\.jsonl$/, "");
  const m = src.match(/^a?(.+)-[0-9a-f]{8,}$/);
  return m ? m[1] : src;
}

/** 選んだセッション1件の詳細タイムラインを組み立てる */
export async function parseSessionDetail(
  meta: SessionMeta,
  subFiles: File[],
): Promise<SessionDetail> {
  const main = await extractLane(meta.file);

  const items: TimelineItem[] = [];
  for (const e of main.events) items.push({ type: "event", event: e });
  for (const s of main.spans)
    items.push({
      type: "span",
      span: {
        kind: "skill",
        name: s.name,
        start: s.start,
        end: s.end,
        messages: s.messages,
        tools: sortedTools(s.tools),
        children: [],
      },
    });
  // 新形式(帰属あり)ではスキル呼び出しイベントはスパンと重複するので出さない
  const filteredItems = main.hasAttribution
    ? items.filter(
        (i) => i.type !== "event" || i.event.kind !== "skill-call",
      )
    : items;

  // サブエージェント: 各ファイルを読み、spawnイベントと名前で突き合わせる
  const spawnsLeft = [...main.agentSpawns];
  for (const file of subFiles) {
    const lane = await extractLane(file);
    const name = agentNameFromId(lane.agentId, file.name);
    const lower = name.toLowerCase();
    const matchIdx = spawnsLeft.findIndex(
      (s) =>
        s.name.toLowerCase() === lower || s.type.toLowerCase() === lower,
    );
    const spawn = matchIdx >= 0 ? spawnsLeft.splice(matchIdx, 1)[0] : null;
    const start = lane.start ?? spawn?.ts ?? meta.start ?? 0;
    const end = lane.end ?? start;
    filteredItems.push({
      type: "span",
      span: {
        kind: "agent",
        name,
        detail: [spawn?.type, lane.model].filter(Boolean).join(" · "),
        start,
        end,
        messages: lane.messages,
        tools: sortedTools(lane.topTools),
        children: lane.spans.map((s) => ({
          kind: "skill" as const,
          name: s.name,
          start: s.start,
          end: s.end,
          messages: s.messages,
          tools: sortedTools(s.tools),
          children: [],
        })),
      },
    });
  }
  // トランスクリプトが残っていないspawn(削除済み等)はゼロ長スパンとして出す
  for (const s of spawnsLeft) {
    filteredItems.push({
      type: "span",
      span: {
        kind: "agent",
        name: s.name,
        detail: s.type,
        start: s.ts,
        end: s.ts,
        messages: 0,
        tools: [],
        children: [],
      },
    });
  }

  filteredItems.sort((a, b) => {
    const ta = a.type === "event" ? a.event.ts : a.span.start;
    const tb = b.type === "event" ? b.event.ts : b.span.start;
    return ta - tb;
  });

  const start = meta.start ?? main.start ?? 0;
  const end = meta.end ?? main.end ?? start;
  return {
    sessionId: meta.sessionId,
    start,
    end,
    items: filteredItems,
    topTools: sortedTools(main.topTools),
    hasAttribution: main.hasAttribution,
  };
}

// ---- 仮想時間軸(アイドルギャップ圧縮) ----
// セッションは何時間も放置されることがあり、実時間スケールだと活動が潰れて見えない。
// 一定以上のギャップを固定幅に圧縮した「仮想時間」で座標を計算する。

const GAP_THRESHOLD_MS = 5 * 60_000; // これ以上のギャップは圧縮する
const GAP_RENDER_MS = 60_000; // 圧縮後の見かけの長さ

export interface TimeScale {
  /** epoch ms -> 0..1 の位置 */
  pos: (ts: number) => number;
  /** 圧縮されたギャップ(0..1位置のリスト。破線マーカー表示用) */
  gaps: { pos: number; skippedMs: number }[];
  totalMs: number;
}

export function buildTimeScale(timestamps: number[]): TimeScale {
  const ts = [...new Set(timestamps)].sort((a, b) => a - b);
  if (ts.length === 0)
    return { pos: () => 0, gaps: [], totalMs: 0 };
  // 各実時刻 -> 仮想時刻 の区分線形マップを作る
  const anchors: { real: number; virt: number }[] = [
    { real: ts[0], virt: 0 },
  ];
  const gapsRaw: { virt: number; skippedMs: number }[] = [];
  let virt = 0;
  for (let i = 1; i < ts.length; i++) {
    const delta = ts[i] - ts[i - 1];
    if (delta > GAP_THRESHOLD_MS) {
      virt += GAP_RENDER_MS;
      gapsRaw.push({ virt: virt - GAP_RENDER_MS / 2, skippedMs: delta });
    } else {
      virt += delta;
    }
    anchors.push({ real: ts[i], virt });
  }
  const total = Math.max(virt, 1);
  const pos = (t: number): number => {
    if (t <= anchors[0].real) return 0;
    // 二分探索で区間を見つけて線形補間
    let lo = 0;
    let hi = anchors.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (anchors[mid].real <= t) lo = mid;
      else hi = mid - 1;
    }
    const a = anchors[lo];
    const b = anchors[lo + 1];
    if (!b) return a.virt / total;
    const frac = (t - a.real) / (b.real - a.real);
    return (a.virt + (b.virt - a.virt) * Math.min(frac, 1)) / total;
  };
  return {
    pos,
    gaps: gapsRaw.map((g) => ({ pos: g.virt / total, skippedMs: g.skippedMs })),
    totalMs: total,
  };
}
