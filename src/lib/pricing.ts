import type { TokenUsage, UsageSummary } from "./types";
import type { DateRange } from "./teamStats";
import { inRange } from "./teamStats";

// 概算コスト計算。Anthropic公式のAPI単価(USD / 100万トークン)をデフォルトとして同梱する。
// 価格を取得できる公開APIは存在しないため、単価はUIから編集できるようにし、
// ブラウザのlocalStorageにのみ保存する(サマリーJSONには含めない=チームには共有されない)。

/** USD / 100万トークン */
export interface ModelRate {
  input: number;
  output: number;
}

// キャッシュ単価は公式の係数から導出する(読み取り 0.1x、書き込み(5分TTL) 1.25x)
export const CACHE_READ_FACTOR = 0.1;
export const CACHE_WRITE_FACTOR = 1.25;

/** 公式単価(2026-08時点)。dated ID(-20251101等)はプレフィックス一致で解決する */
export const DEFAULT_RATES: Record<string, ModelRate> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-opus-4-1": { input: 15, output: 75 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// 未知のモデルIDはファミリー名で近似する(例: 将来のopus系 → 現行opus単価)
const FAMILY_DEFAULTS: [RegExp, ModelRate][] = [
  [/fable|mythos/, { input: 10, output: 50 }],
  [/opus/, { input: 5, output: 25 }],
  [/sonnet/, { input: 3, output: 15 }],
  [/haiku/, { input: 1, output: 5 }],
];

const STORAGE_KEY = "claude-graph:rates";

export function loadRates(): Record<string, ModelRate> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_RATES };
    const stored = JSON.parse(raw) as Record<string, ModelRate>;
    const out = { ...DEFAULT_RATES };
    for (const [model, r] of Object.entries(stored)) {
      if (
        r &&
        typeof r.input === "number" &&
        typeof r.output === "number" &&
        Number.isFinite(r.input) &&
        Number.isFinite(r.output)
      )
        out[model] = { input: r.input, output: r.output };
    }
    return out;
  } catch {
    return { ...DEFAULT_RATES };
  }
}

export function saveRates(rates: Record<string, ModelRate>) {
  // デフォルトと同じ値は保存しない(公式単価の改定に自動追従させるため)
  const diff: Record<string, ModelRate> = {};
  for (const [model, r] of Object.entries(rates)) {
    const d = DEFAULT_RATES[model];
    if (!d || d.input !== r.input || d.output !== r.output) diff[model] = r;
  }
  try {
    if (Object.keys(diff).length === 0) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(diff));
  } catch {
    // localStorageが使えない環境では編集は保持されない
  }
}

export function rateFor(
  model: string,
  rates: Record<string, ModelRate>,
): ModelRate | null {
  if (rates[model]) return rates[model];
  for (const [key, r] of Object.entries(rates)) {
    if (model.startsWith(key)) return r;
  }
  for (const [re, r] of FAMILY_DEFAULTS) {
    if (re.test(model)) return r;
  }
  return null;
}

export function costOfTokens(t: TokenUsage, r: ModelRate): number {
  return (
    (t.input * r.input +
      t.output * r.output +
      t.cacheRead * r.input * CACHE_READ_FACTOR +
      t.cacheCreation * r.input * CACHE_WRITE_FACTOR) /
    1_000_000
  );
}

export interface CostResult {
  usd: number;
  /** 単価を解決できなかったモデル(コストに含まれない) */
  unknownModels: string[];
}

export function costOf(
  tokensByModel: Record<string, TokenUsage>,
  rates: Record<string, ModelRate>,
): CostResult {
  let usd = 0;
  const unknownModels: string[] = [];
  for (const [model, t] of Object.entries(tokensByModel)) {
    const r = rateFor(model, rates);
    if (!r) {
      unknownModels.push(model);
      continue;
    }
    usd += costOfTokens(t, r);
  }
  return { usd, unknownModels };
}

/**
 * 期間内の概算コスト。dailyTokensがあれば日別で絞り、
 * ない旧サマリーは全期間指定のときのみ全期間値で代用する
 */
export function costInRange(
  m: UsageSummary,
  range: DateRange | null,
  rates: Record<string, ModelRate>,
): CostResult {
  if (m.dailyTokens && Object.keys(m.dailyTokens).length > 0) {
    let usd = 0;
    const unknown = new Set<string>();
    for (const [date, models] of Object.entries(m.dailyTokens)) {
      if (!inRange(date, range)) continue;
      const r = costOf(models, rates);
      usd += r.usd;
      for (const u of r.unknownModels) unknown.add(u);
    }
    return { usd, unknownModels: [...unknown] };
  }
  if (range) return { usd: 0, unknownModels: [] };
  return costOf(m.tokensByModel, rates);
}

export function formatUsd(usd: number): string {
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString()}`;
  if (usd >= 10) return `$${usd.toFixed(1)}`;
  return `$${usd.toFixed(2)}`;
}
