import type { FeatureCategory } from "../../src/lib/types.js";
import { FEATURE_CATEGORIES } from "../../src/lib/types.js";

// 保存済みサマリーから1項目を削除する純粋ロジック。
// 3層(トップレベル / dailyFeatures / dailyRepos)すべてから消す必要があり、
// 消し忘れはプライバシー実害になるため、本番API(summaries.ts)と
// E2EモックAPI(e2e/mock-api.ts)の両方が必ずこの関数を使うこと(写経禁止)。

export function isFeatureCategory(v: unknown): v is FeatureCategory {
  return (
    typeof v === "string" && (FEATURE_CATEGORIES as readonly string[]).includes(v)
  );
}

export function removeItemFromSummary(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  category: FeatureCategory,
  key: string,
): boolean {
  let changed = false;
  if (data?.[category] && key in data[category]) {
    delete data[category][key];
    changed = true;
  }
  if (data?.dailyFeatures && typeof data.dailyFeatures === "object") {
    for (const cats of Object.values(data.dailyFeatures)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec = (cats as any)?.[category];
      if (rec && key in rec) {
        delete rec[key];
        changed = true;
      }
    }
  }
  // repos削除=そのリポジトリの日別バケット丸ごと、機能削除=各リポジトリ内の該当項目
  if (data?.dailyRepos && typeof data.dailyRepos === "object") {
    for (const repoMap of Object.values(data.dailyRepos)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rm = repoMap as any;
      if (category === "repos") {
        if (rm && key in rm) {
          delete rm[key];
          changed = true;
        }
      } else {
        for (const bucket of Object.values(rm ?? {})) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const rec = (bucket as any)?.features?.[category];
          if (rec && key in rec) {
            delete rec[key];
            changed = true;
          }
        }
      }
    }
  }
  return changed;
}
