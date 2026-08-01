import { useMemo, useState } from "react";
import type { FeatureCategory, UsageSummary } from "../lib/types";
import { CATEGORY_LABEL } from "../lib/teamStats";
import { BarList } from "./BarList";

// ヒートマップの転置版: 機能を選ぶと「誰がどれだけ使っているか」が出る。
// 「このスキル使ってみたいけど誰に聞けばいい?」への答え(全期間)。
export function AskWhoCard({ members }: { members: UsageSummary[] }) {
  const [category, setCategory] = useState<FeatureCategory>("skills");
  const [feature, setFeature] = useState("");

  const features = useMemo(() => {
    const totals = new Map<string, number>();
    for (const m of members)
      for (const [f, c] of Object.entries(m[category] ?? {}))
        totals.set(f, (totals.get(f) ?? 0) + c);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f);
  }, [members, category]);

  const selected = features.includes(feature) ? feature : features[0];
  const usage = useMemo(() => {
    if (!selected) return {};
    return Object.fromEntries(
      members
        .map((m) => [m.name, m[category]?.[selected] ?? 0] as const)
        .filter(([, c]) => c > 0),
    );
  }, [members, category, selected]);

  const topUser = Object.entries(usage).sort((a, b) => b[1] - a[1])[0]?.[0];

  return (
    <div className="card">
      <h2>この人に聞こう</h2>
      <p className="card-desc">
        機能を選ぶと、よく使っている人が分かります(全期間)
      </p>
      <div className="controls-row" style={{ margin: "0 0 12px" }}>
        <select
          className="member-select"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as FeatureCategory);
            setFeature("");
          }}
        >
          {(Object.keys(CATEGORY_LABEL) as FeatureCategory[]).map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          className="member-select"
          value={selected ?? ""}
          onChange={(e) => setFeature(e.target.value)}
          disabled={features.length === 0}
        >
          {features.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </div>
      {selected ? (
        <>
          {topUser && (
            <p className="ask-answer">
              まず聞くなら <strong>{topUser}</strong>
            </p>
          )}
          <BarList data={usage} />
        </>
      ) : (
        <div className="empty-note">このカテゴリの利用データなし</div>
      )}
    </div>
  );
}
