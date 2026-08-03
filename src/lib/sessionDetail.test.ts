import { describe, expect, it } from "vitest";
import {
  buildSessionIndex,
  buildTimeScale,
  parseSessionDetail,
} from "./sessionDetail";

const T = (min: number, sec = 0) =>
  new Date(Date.UTC(2026, 6, 1, 10, min, sec)).toISOString();

function jsonl(name: string, rows: object[]): File {
  return new File([rows.map((r) => JSON.stringify(r)).join("\n")], name);
}

const SID = "0a0a0a0a-1111-2222-3333-444444444444";

function mainFile(): File {
  return jsonl(`${SID}.jsonl`, [
    { type: "ai-title", aiTitle: "テストセッション", sessionId: SID },
    {
      type: "user",
      timestamp: T(0),
      sessionId: SID,
      message: { content: "SECRET_PROMPT お願いします" },
    },
    {
      type: "assistant",
      timestamp: T(1),
      sessionId: SID,
      cwd: "/Users/secret/demo-repo",
      message: {
        model: "claude-fable-5",
        content: [
          { type: "tool_use", id: "tu1", name: "Skill", input: { skill: "demo-skill" } },
        ],
      },
    },
    {
      type: "assistant",
      timestamp: T(2),
      sessionId: SID,
      attributionSkill: "demo-skill",
      message: {
        model: "claude-fable-5",
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 100,
          cache_creation_input_tokens: 50,
        },
        content: [
          { type: "tool_use", id: "tu2", name: "Write", input: { file_path: "/Users/secret/x" } },
        ],
      },
    },
    {
      type: "assistant",
      timestamp: T(3),
      sessionId: SID,
      attributionSkill: "demo-skill",
      message: {
        model: "claude-fable-5",
        content: [{ type: "tool_use", id: "tu3", name: "Write", input: {} }],
      },
    },
    {
      type: "assistant",
      timestamp: T(4),
      sessionId: SID,
      message: {
        model: "claude-fable-5",
        content: [
          {
            type: "tool_use",
            id: "tu4",
            name: "Task",
            input: {
              name: "researcher",
              subagent_type: "Explore",
              prompt: "SECRET_TASK_PROMPT",
            },
          },
        ],
      },
    },
    {
      type: "user",
      timestamp: T(5),
      sessionId: SID,
      message: { content: "<command-name>/clear</command-name>" },
    },
  ]);
}

function subagentFile(): File {
  return jsonl("agent-aresearcher-0123456789abcdef.jsonl", [
    {
      type: "assistant",
      timestamp: T(4, 30),
      sessionId: SID,
      agentId: "aresearcher-0123456789abcdef",
      isSidechain: true,
      message: {
        model: "claude-haiku-4-5",
        content: [{ type: "tool_use", id: "s1", name: "Bash", input: {} }],
      },
    },
    {
      type: "assistant",
      timestamp: T(6),
      sessionId: SID,
      agentId: "aresearcher-0123456789abcdef",
      isSidechain: true,
      message: {
        model: "claude-haiku-4-5",
        usage: { input_tokens: 3, output_tokens: 2 },
        content: [{ type: "tool_use", id: "s2", name: "Bash", input: {} }],
      },
    },
  ]);
}

describe("sessionDetail", () => {
  it("セッション一覧とサブエージェントの紐付けを作る", async () => {
    const index = await buildSessionIndex([mainFile(), subagentFile()]);
    expect(index.sessions).toHaveLength(1);
    const s = index.sessions[0];
    expect(s.sessionId).toBe(SID);
    expect(s.title).toBe("テストセッション");
    expect(s.repo).toBe("demo-repo");
    expect(s.prompts).toBe(1);
    expect(s.skills).toEqual(["demo-skill"]);
    expect(s.agentSpawns).toBe(1);
    expect(index.subagentFiles.get(SID)).toHaveLength(1);
  });

  it("タイムライン: スキルスパン・エージェントスパン・イベントを組み立て、本文を含めない", async () => {
    const index = await buildSessionIndex([mainFile(), subagentFile()]);
    const detail = await parseSessionDetail(
      index.sessions[0],
      index.subagentFiles.get(SID) ?? [],
    );

    expect(detail.hasAttribution).toBe(true);
    const kinds = detail.items.map((i) =>
      i.type === "event" ? `${i.event.kind}` : `${i.span.kind}:${i.span.name}`,
    );
    expect(kinds).toEqual([
      "prompt",
      "skill:demo-skill",
      "agent:researcher",
      "command",
    ]);

    const skill = detail.items.find(
      (i) => i.type === "span" && i.span.kind === "skill",
    );
    if (skill?.type !== "span") throw new Error("skill span missing");
    expect(skill.span.messages).toBe(2);
    expect(skill.span.tools).toEqual([
      expect.objectContaining({ name: "Write", count: 2 }),
    ]);

    const agent = detail.items.find(
      (i) => i.type === "span" && i.span.kind === "agent",
    );
    if (agent?.type !== "span") throw new Error("agent span missing");
    expect(agent.span.name).toBe("researcher");
    expect(agent.span.detail).toContain("Explore");
    expect(agent.span.messages).toBe(2);
    expect(agent.span.tools).toEqual([
      expect.objectContaining({ name: "Bash", count: 2 }),
    ]);
    // スパンの実時間はサブエージェント自身のトランスクリプトから取る
    expect(agent.span.end - agent.span.start).toBe(90_000);

    // 累積消費用の使用量: 本体+サブエージェント分が時系列で入る
    expect(detail.usagePoints).toEqual([
      expect.objectContaining({
        model: "claude-fable-5",
        input: 10,
        output: 5,
        cacheRead: 100,
        cacheCreation: 50,
      }),
      expect.objectContaining({ model: "claude-haiku-4-5", input: 3 }),
    ]);
    expect(detail.usagePoints[0].ts).toBeLessThan(detail.usagePoints[1].ts);

    // 本文・引数・パスは一切含まれない
    const json = JSON.stringify(detail);
    expect(json).not.toContain("SECRET_PROMPT");
    expect(json).not.toContain("SECRET_TASK_PROMPT");
    expect(json).not.toContain("/Users/secret");
  });

  it("5分超のアイドルギャップを圧縮した仮想時間軸を作る", () => {
    const base = Date.UTC(2026, 6, 1);
    const scale = buildTimeScale([
      base,
      base + 60_000, // 1分後
      base + 61 * 60_000, // 60分のギャップ
      base + 62 * 60_000,
    ]);
    expect(scale.gaps).toHaveLength(1);
    // ギャップが圧縮されるので、後半2点は近い位置に来る
    expect(scale.pos(base)).toBe(0);
    expect(scale.pos(base + 62 * 60_000)).toBe(1);
    expect(scale.pos(base + 61 * 60_000)).toBeGreaterThan(0.6);
    // 単調増加
    expect(scale.pos(base + 60_000)).toBeLessThan(
      scale.pos(base + 61 * 60_000),
    );
  });
});
