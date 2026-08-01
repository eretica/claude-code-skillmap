import { describe, expect, it } from "vitest";
import { parseTranscripts } from "./parser";
import { localDate } from "./dates";

const TS = "2026-07-01T10:00:00.000Z";
const DAY = localDate(new Date(TS));

function fileOf(lines: object[]): File {
  return new File(
    [lines.map((l) => JSON.stringify(l)).join("\n")],
    "session.jsonl",
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function assistantRow(content: any[], extra: object = {}) {
  return {
    type: "assistant",
    timestamp: TS,
    sessionId: "s1",
    entrypoint: "cli",
    cwd: "/Users/secret/project",
    message: {
      model: "claude-fable-5",
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 100,
        cache_creation_input_tokens: 50,
      },
      content,
    },
    ...extra,
  };
}

const SECRETS = [
  "SECRET_BODY",
  "SECRET_ARG",
  "SECRET_PROMPT",
  "SECRET_USER",
  "SECRET_PLAIN",
  "SECRET_THINKING",
  "/Users/secret",
];

describe("parseTranscripts", () => {
  it("機能利用・トークンを集計し、会話本文やパスを一切含めない", async () => {
    const file = fileOf([
      assistantRow([
        { type: "text", text: "SECRET_BODY" },
        { type: "thinking", thinking: "SECRET_THINKING" },
        {
          type: "tool_use",
          name: "Skill",
          input: { skill: "figma:figma-use", args: "SECRET_ARG" },
        },
      ]),
      assistantRow([
        {
          type: "tool_use",
          name: "Agent",
          input: { subagent_type: "Explore", prompt: "SECRET_PROMPT" },
        },
      ]),
      assistantRow([
        { type: "tool_use", name: "mcp__memory__read_graph", input: {} },
      ]),
      assistantRow([
        {
          type: "tool_use",
          name: "Read",
          input: { file_path: "/Users/secret/file.ts" },
        },
      ]),
      {
        type: "user",
        timestamp: TS,
        sessionId: "s1",
        message: {
          content:
            "<command-name>/review-dms:branch</command-name> SECRET_USER",
        },
      },
      {
        type: "user",
        timestamp: TS,
        sessionId: "s1",
        message: { content: "SECRET_PLAIN 普通のプロンプト" },
      },
      { type: "mode", mode: "plan", sessionId: "s1" },
      {
        type: "permission-mode",
        permissionMode: "bypassPermissions",
        sessionId: "s1",
      },
    ]);

    const s = await parseTranscripts([file], "tester");

    expect(s.skills).toEqual({ "figma:figma-use": 1 });
    expect(s.plugins).toEqual({ figma: 1, "review-dms": 1 });
    expect(s.subagents).toEqual({ Explore: 1 });
    expect(s.mcpTools).toEqual({ "memory/read_graph": 1 });
    expect(s.slashCommands).toEqual({ "/review-dms:branch": 1 });
    expect(s.tools.Read).toBe(1);
    expect(s.modes).toEqual({ plan: 1 });
    expect(s.permissionModes).toEqual({ bypassPermissions: 1 });
    expect(s.entrypoints).toEqual({ cli: 1 });
    expect(s.totals.sessions).toBe(1);
    // スラッシュコマンド実行行はプロンプト数に含めない(通常プロンプトの1件のみ)
    expect(s.totals.userPrompts).toBe(1);
    expect(s.dailyActivity[0].userPrompts).toBe(1);
    expect(s.sessionsWithSkill).toBe(1);
    expect(s.sessionsWithSubagent).toBe(1);
    expect(s.sessionLengthBuckets).toEqual({
      "1-10": 1,
      "11-50": 0,
      "51-200": 0,
      "201+": 0,
    });
    expect(s.tokensByModel["claude-fable-5"]).toEqual({
      input: 40,
      output: 20,
      cacheRead: 400,
      cacheCreation: 200,
    });
    expect(s.dailyActivity).toHaveLength(1);
    expect(s.dailyActivity[0].skillSessions).toBe(1);
    expect(s.dailyFeatures?.[DAY]?.skills).toEqual({ "figma:figma-use": 1 });
    expect(s.dailyFeatures?.[DAY]?.slashCommands).toEqual({
      "/review-dms:branch": 1,
    });

    // 機密リーク検査: サマリーのどこにも本文・引数・パスが含まれないこと
    const json = JSON.stringify(s);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it("<synthetic>モデルと壊れた行をスキップする", async () => {
    const file = fileOf([
      assistantRow([], { message: { model: "<synthetic>", usage: { input_tokens: 999 }, content: [] } }),
    ]);
    const broken = new File(["{not json}\n", ""], "broken.jsonl");
    const s = await parseTranscripts([file, broken], "tester");
    expect(Object.keys(s.tokensByModel)).toEqual([]);
  });
});
