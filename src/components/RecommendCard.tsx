import { useMemo } from "react";
import type { FeatureCategory, UsageSummary } from "../lib/types";
import { CATEGORY_LABEL } from "../lib/teamStats";

// リポジトリは「おすすめ」する対象ではないので除く
const CATEGORIES = (Object.keys(CATEGORY_LABEL) as FeatureCategory[]).filter(
  (c) => c !== "repos",
);

interface Recommendation {
  category: FeatureCategory;
  feature: string;
  users: string[];
  total: number;
}

// 「チームでは使われているのに、選択中のメンバーがまだ使っていない機能」を提案する。
// 期間で消えたり出たりすると紛らわしいため、常に全期間の利用実績で判定する。
export function RecommendCard({
  members,
  target,
}: {
  members: UsageSummary[];
  target: UsageSummary;
}) {
  const recs = useMemo(() => {
    const out: Recommendation[] = [];
    for (const category of CATEGORIES) {
      const mine = target[category] ?? {};
      const byFeature = new Map<string, { users: string[]; total: number }>();
      for (const m of members) {
        if (m.name === target.name) continue;
        for (const [feature, count] of Object.entries(m[category] ?? {})) {
          if (count <= 0) continue;
          let e = byFeature.get(feature);
          if (!e) {
            e = { users: [], total: 0 };
            byFeature.set(feature, e);
          }
          e.users.push(m.name);
          e.total += count;
        }
      }
      for (const [feature, e] of byFeature) {
        if (!(feature in mine)) out.push({ category, feature, ...e });
      }
    }
    return out
      .sort((a, b) => b.users.length - a.users.length || b.total - a.total)
      .slice(0, 6);
  }, [members, target]);

  if (members.length < 2) return null;

  return (
    <div className="card">
      <h2>{target.name} へのおすすめ</h2>
      <p className="card-desc">
        チームで使われているのに {target.name}{" "}
        がまだ使っていない機能(利用人数順・全期間)。使っている人に聞いてみましょう。
      </p>
      {recs.length === 0 ? (
        <div className="empty-note">
          チームで使われている機能はすべて利用済みです 🎉
        </div>
      ) : (
        <div className="rec-list">
          {recs.map((r) => (
            <div className="rec-row" key={`${r.category}:${r.feature}`}>
              <span className="cat-chip">{CATEGORY_LABEL[r.category]}</span>
              <span className="rec-feature" title={r.feature}>
                {r.feature}
              </span>
              <span className="rec-users">
                使っている人: {r.users.join(", ")}(計{" "}
                {r.total.toLocaleString()} 回)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
