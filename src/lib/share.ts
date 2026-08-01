import type { UsageSummary } from "./types";
import { applyExclusions, exKey } from "./exclude";
import { mergeSummaries } from "./merge";

// 共有・エクスポートのペイロード構築。
// 順序が重要: (1) サーバー保存分と日付マージ → (2) 除外+リポジトリopt-inを
// マージ後の全体に適用。この順序により「除外した項目名・選ばなかったリポジトリ名が
// 一度もサーバーに渡らない」ことを保証する(過去の共有分からも消える)。

/** 除外設定 + リポジトリopt-in(選ばれていないものは除外扱い)を合成する */
export function buildExcluded(
  summary: UsageSummary,
  excluded: Set<string>,
  includedRepos: Set<string>,
): Set<string> {
  const eff = new Set(excluded);
  for (const repo of Object.keys(summary.repos ?? {})) {
    if (!includedRepos.has(repo)) eff.add(exKey("repos", repo));
  }
  return eff;
}

/** プレビュー・エクスポート用(サーバー保存分とはマージしない) */
export function buildOutgoing(
  summary: UsageSummary,
  name: string,
  excluded: Set<string>,
  includedRepos: Set<string>,
): UsageSummary {
  const named = { ...summary, name };
  return applyExclusions(named, buildExcluded(named, excluded, includedRepos));
}

/** 共有用: サーバー保存分(あれば)と日付マージしてから除外を適用する */
export function buildSharePayload(
  summary: UsageSummary,
  stored: UsageSummary | null,
  name: string,
  excluded: Set<string>,
  includedRepos: Set<string>,
): UsageSummary {
  if (!stored) return buildOutgoing(summary, name, excluded, includedRepos);
  const merged = mergeSummaries(stored, { ...summary, name });
  // マージで復活した古いリポジトリも取りこぼさないよう、マージ結果から除外集合を作る
  return applyExclusions(
    merged,
    buildExcluded(merged, excluded, includedRepos),
  );
}
