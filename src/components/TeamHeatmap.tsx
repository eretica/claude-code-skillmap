import { useMemo, useState } from "react";
import type { FeatureCategory, UsageSummary } from "../lib/types";
import { IS_CLOUD } from "../lib/config";
import { CATEGORY_LABEL } from "../lib/teamStats";
import { InfoTip } from "./InfoTip";

// 連続量(利用回数)を表すsequentialランプ(blue)。
const SEQ_STEPS = [
  "var(--seq-100)",
  "var(--seq-200)",
  "var(--seq-300)",
  "var(--seq-400)",
  "var(--seq-500)",
  "var(--seq-600)",
  "var(--seq-700)",
];

function cellStyle(count: number, max: number) {
  if (count === 0)
    return { background: "transparent", color: "var(--text-muted)" };
  // 利用回数は裾が長いためlogスケールでステップに割り当てる
  const ratio = Math.log(count + 1) / Math.log(max + 1);
  const idx = Math.min(
    SEQ_STEPS.length - 1,
    Math.floor(ratio * SEQ_STEPS.length),
  );
  return {
    background: SEQ_STEPS[idx],
    color: idx >= 3 ? "#ffffff" : "#0b0b0b",
  };
}

export function TeamHeatmap({
  members,
  category,
  onCategoryChange,
  countsOf,
  highlightName,
  onRemoveItem,
}: {
  members: UsageSummary[];
  category: FeatureCategory;
  onCategoryChange: (c: FeatureCategory) => void;
  /** メンバー名 -> (期間適用済みの)項目カウント */
  countsOf: Map<string, Record<string, number>>;
  /** 比較対象として選択中のメンバー(列を強調表示) */
  highlightName?: string;
  onRemoveItem: (memberName: string, feature: string) => void;
}) {
  // 削除は明示的な編集モードでのみ許可し、閲覧中の誤クリックを防ぐ
  const [editMode, setEditMode] = useState(false);
  // 並び順: 合計(デフォルト) or メンバー列クリックでその人の利用回数順
  const [sortBy, setSortBy] = useState<string>("total");
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);

  const { totals, maxCell, filteredOut } = useMemo(() => {
    const featureNames = [
      ...new Set(members.flatMap((m) => Object.keys(countsOf.get(m.name)!))),
    ];
    const q = query.trim().toLowerCase();
    const rows = featureNames
      .filter((feature) => !q || feature.toLowerCase().includes(q))
      .map((feature) => ({
        feature,
        total: members.reduce(
          (s, m) => s + (countsOf.get(m.name)![feature] ?? 0),
          0,
        ),
        users: members.filter((m) => (countsOf.get(m.name)![feature] ?? 0) > 0)
          .length,
      }));
    const sortCounts =
      sortBy !== "total" ? countsOf.get(sortBy) : undefined;
    rows.sort((a, b) =>
      sortCounts
        ? (sortCounts[b.feature] ?? 0) - (sortCounts[a.feature] ?? 0) ||
          b.total - a.total
        : b.total - a.total,
    );
    return {
      totals: rows,
      maxCell: Math.max(
        1,
        ...members.flatMap((m) => Object.values(countsOf.get(m.name)!)),
      ),
      filteredOut: featureNames.length - rows.length,
    };
  }, [members, countsOf, query, sortBy]);

  return (
    <div className="card">
      <div className="controls-row" style={{ margin: "0 0 4px" }}>
        <h2 style={{ margin: 0 }}>{CATEGORY_LABEL[category]} × メンバー<InfoTip text="行=機能、列=メンバー。色が濃いほど利用回数が多い(裾が長いためlogスケール)。列名クリックでその人の利用順に並べ替えできます" /></h2>
        {IS_CLOUD && (
          <button
            className={editMode ? "primary" : "ghost"}
            onClick={() => setEditMode((v) => !v)}
          >
            {editMode ? "削除モードを終了" : "項目を削除する…"}
          </button>
        )}
      </div>
      <p className="card-desc">
        「誰がどの機能を使っているか」のマトリクス。空欄は未利用 =
        その人に布教するチャンス。
        {editMode &&
          " 削除モード中: 数値セルをクリックすると、その人のその項目をサーバーから削除します。"}
      </p>
      <div className="controls-row" style={{ margin: "0 0 12px" }}>
        <div className="tabs" style={{ margin: 0, borderBottom: "none" }}>
          {(Object.keys(CATEGORY_LABEL) as FeatureCategory[]).map((c) => (
            <button
              key={c}
              className={c === category ? "active" : ""}
              onClick={() => {
                onCategoryChange(c);
                setSortBy("total");
              }}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
        <input
          type="text"
          className="hm-filter"
          placeholder="機能名で絞り込み"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {sortBy !== "total" && (
          <span className="empty-note">
            {sortBy} の利用順に表示中(列名クリックで解除)
          </span>
        )}
      </div>
      {totals.length === 0 ? (
        <div className="empty-note">このカテゴリの利用データなし</div>
      ) : (
        <div className={`heatmap-wrap${editMode ? " edit-mode" : ""}`}>
          <table className="heatmap">
            <thead>
              <tr>
                <th>{CATEGORY_LABEL[category]}</th>
                {members.map((m) => (
                  <th
                    className={`col sortable${m.name === highlightName ? " me-col" : ""}`}
                    key={m.name}
                    title={`クリックで ${m.name} の利用回数順に並べ替え`}
                    onClick={() =>
                      setSortBy((prev) =>
                        prev === m.name ? "total" : m.name,
                      )
                    }
                  >
                    {m.name}
                    {sortBy === m.name && " ▼"}
                  </th>
                ))}
                <th className="col">利用人数</th>
              </tr>
            </thead>
            <tbody>
              {(showAll ? totals : totals.slice(0, 20)).map(({ feature, users }) => (
                <tr key={feature}>
                  <th title={feature}>{feature}</th>
                  {members.map((m) => {
                    const count = countsOf.get(m.name)![feature] ?? 0;
                    const deletable = editMode && count > 0;
                    return (
                      <td
                        key={m.name}
                        className={
                          m.name === highlightName ? "me-col" : undefined
                        }
                        style={{
                          ...cellStyle(count, maxCell),
                          cursor: deletable ? "pointer" : undefined,
                        }}
                        title={
                          deletable
                            ? `クリックで ${m.name} の「${feature}」を削除`
                            : undefined
                        }
                        onClick={
                          deletable
                            ? () => onRemoveItem(m.name, feature)
                            : undefined
                        }
                      >
                        {count > 0 ? count.toLocaleString() : "–"}
                      </td>
                    );
                  })}
                  <td style={{ color: "var(--text-secondary)" }}>
                    {users}/{members.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {totals.length > 20 && !showAll && (
            <button className="bl-more" onClick={() => setShowAll(true)}>
              …ほか {totals.length - 20} 件を表示
            </button>
          )}
          {totals.length > 20 && showAll && (
            <button className="bl-more" onClick={() => setShowAll(false)}>
              折りたたむ
            </button>
          )}
          {filteredOut > 0 && (
            <div className="empty-note">
              {filteredOut} 件が絞り込みで非表示
            </div>
          )}
        </div>
      )}
      <div className="legend">
        <span>
          <span className="swatch" style={{ background: "var(--seq-100)" }} />
          少
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--seq-400)" }} />
          中
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--seq-700)" }} />
          多
        </span>
      </div>
    </div>
  );
}
