import { describe, expect, it } from "vitest";
import { DEFAULT_RATES, costInRange, costOf, rateFor } from "./pricing";
import type { UsageSummary } from "./types";

const zero = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };

describe("pricing", () => {
  it("モデル名を完全一致→プレフィックス→ファミリーの順で解決する", () => {
    expect(rateFor("claude-fable-5", DEFAULT_RATES)).toEqual({
      input: 10,
      output: 50,
    });
    // dated ID はプレフィックス一致
    expect(rateFor("claude-opus-4-5-20251101", DEFAULT_RATES)).toEqual({
      input: 5,
      output: 25,
    });
    // 未知の将来モデルはファミリーで近似
    expect(rateFor("claude-sonnet-6", DEFAULT_RATES)).toEqual({
      input: 3,
      output: 15,
    });
    expect(rateFor("gpt-nantoka", DEFAULT_RATES)).toBeNull();
  });

  it("キャッシュ係数込みでコストを計算し、未知モデルは除外して報告する", () => {
    const r = costOf(
      {
        // 100万トークンずつ: 10 + 50 + 10*0.1 + 10*1.25 = 73.5
        "claude-fable-5": {
          input: 1_000_000,
          output: 1_000_000,
          cacheRead: 1_000_000,
          cacheCreation: 1_000_000,
        },
        "unknown-model": { ...zero, input: 1_000_000 },
      },
      DEFAULT_RATES,
    );
    expect(r.usd).toBeCloseTo(73.5);
    expect(r.unknownModels).toEqual(["unknown-model"]);
  });

  it("期間指定はdailyTokensで絞り、旧形式は全期間のみ計算する", () => {
    const base = {
      dailyTokens: {
        "2026-07-01": { "claude-opus-4-8": { ...zero, output: 1_000_000 } },
        "2026-07-10": { "claude-opus-4-8": { ...zero, output: 1_000_000 } },
      },
      tokensByModel: { "claude-opus-4-8": { ...zero, output: 2_000_000 } },
    } as unknown as UsageSummary;
    expect(
      costInRange(base, { from: "2026-07-05", to: null }, DEFAULT_RATES).usd,
    ).toBeCloseTo(25);
    expect(costInRange(base, null, DEFAULT_RATES).usd).toBeCloseTo(50);

    const legacy = {
      tokensByModel: { "claude-opus-4-8": { ...zero, output: 1_000_000 } },
    } as unknown as UsageSummary;
    expect(costInRange(legacy, null, DEFAULT_RATES).usd).toBeCloseTo(25);
    expect(
      costInRange(legacy, { from: "2026-07-05", to: null }, DEFAULT_RATES).usd,
    ).toBe(0);
  });
});
