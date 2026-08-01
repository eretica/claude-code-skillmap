import type { UsageSummary } from "./types";

// 共有・エクスポート前に「公開したくない項目」を落とすための仕組み。
// 除外はカテゴリ×項目名の単位で行い、サマリー本体から該当キーを削除する。

export const EXCLUDABLE_CATEGORIES = [
  ["skills", "スキル"],
  ["slashCommands", "スラッシュコマンド"],
  ["subagents", "サブエージェント"],
  ["mcpTools", "MCPツール"],
  ["plugins", "プラグイン"],
  ["repos", "リポジトリ"],
] as const;

export type ExcludableCategory = (typeof EXCLUDABLE_CATEGORIES)[number][0];

export function exKey(category: ExcludableCategory, name: string): string {
  return `${category}${name}`;
}

export function applyExclusions(
  summary: UsageSummary,
  excluded: Set<string>,
): UsageSummary {
  const strip = (category: ExcludableCategory) =>
    Object.fromEntries(
      Object.entries(summary[category] ?? {}).filter(
        ([name]) => !excluded.has(exKey(category, name)),
      ),
    );
  // 日別カウントからも同じ項目を落とす(ここに残ると除外の意味がなくなる)
  const dailyFeatures = summary.dailyFeatures
    ? Object.fromEntries(
        Object.entries(summary.dailyFeatures).map(([date, cats]) => [
          date,
          Object.fromEntries(
            Object.entries(cats).map(([category, rec]) => [
              category,
              Object.fromEntries(
                Object.entries(rec ?? {}).filter(
                  ([name]) =>
                    !excluded.has(exKey(category as ExcludableCategory, name)),
                ),
              ),
            ]),
          ),
        ]),
      )
    : undefined;
  // リポジトリ別の日別データからも、除外リポジトリ丸ごと+除外機能項目を落とす
  const dailyRepos = summary.dailyRepos
    ? Object.fromEntries(
        Object.entries(summary.dailyRepos).map(([date, repoMap]) => [
          date,
          Object.fromEntries(
            Object.entries(repoMap)
              .filter(([repo]) => !excluded.has(exKey("repos", repo)))
              .map(([repo, bucket]) => [
                repo,
                {
                  ...bucket,
                  features: Object.fromEntries(
                    Object.entries(bucket.features ?? {}).map(
                      ([category, rec]) => [
                        category,
                        Object.fromEntries(
                          Object.entries(rec ?? {}).filter(
                            ([name]) =>
                              !excluded.has(
                                exKey(category as ExcludableCategory, name),
                              ),
                          ),
                        ),
                      ],
                    ),
                  ),
                },
              ]),
          ),
        ]),
      )
    : undefined;
  return {
    ...summary,
    skills: strip("skills"),
    slashCommands: strip("slashCommands"),
    subagents: strip("subagents"),
    mcpTools: strip("mcpTools"),
    plugins: strip("plugins"),
    repos: strip("repos"),
    dailyFeatures,
    dailyRepos,
  };
}
