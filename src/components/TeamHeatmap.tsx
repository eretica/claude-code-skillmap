import { useMemo, useState } from "react";
import type { FeatureCategory, UsageSummary } from "../lib/types";
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

const CATEGORY_INFO: Record<FeatureCategory, string> = {
  skills:
    "スキル=作業手順をパッケージ化した拡張機能。行=スキル、列=メンバー。色が濃いほど利用回数が多い(logスケール)。スキル名クリック=そのスキルの上位ユーザー順に列を並べ替え、メンバー名クリック=その人の利用順に行を並べ替え",
  subagents:
    "調査・レビューなどを委任する子エージェントの種類別利用回数。列名クリックで並べ替え",
  mcpTools:
    "MCP(外部ツール連携)の server/tool 別利用回数。列名クリックで並べ替え",
  slashCommands: "チャット欄で実行したコマンドの回数。列名クリックで並べ替え",
  plugins: "プラグイン経由のスキル/コマンド実行回数。列名クリックで並べ替え",
  repos:
    "誰がどのリポジトリでClaude Codeを使っているか(数値=アシスタントメッセージ数)。リポジトリ名はディレクトリ名のみでフルパスは含まれません",
};

export function TeamHeatmap({
  members,
  category,
  counts,
  highlightName,
  editMode,
  query,
  limit = 10,
  onRemoveItem,
}: {
  members: UsageSummary[];
  category: FeatureCategory;
  /** メンバー名 -> (期間適用済みの)項目カウント */
  counts: Map<string, Record<string, number>>;
  /** 比較対象として選択中のメンバー(列を強調表示) */
  highlightName?: string;
  /** 削除モード(全カテゴリ共通のトグルから受け取る) */
  editMode: boolean;
  /** 機能名の絞り込み(全カテゴリ共通の入力から受け取る) */
  query: string;
  limit?: number;
  onRemoveItem: (memberName: string, feature: string) => void;
}) {
  // 行の並び順: 合計(デフォルト) / 利用人数 / メンバー列クリックでその人の利用回数順
  const [sortBy, setSortBy] = useState<string>("total");
  // 列の並び順: スキル行クリックで「そのスキルの上位ユーザー順」にメンバー列を並べ替え
  const [memberSort, setMemberSort] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const orderedMembers = useMemo(() => {
    if (!memberSort) return members;
    return [...members].sort(
      (a, b) =>
        (counts.get(b.name)![memberSort] ?? 0) -
        (counts.get(a.name)![memberSort] ?? 0),
    );
  }, [members, counts, memberSort]);

  const { totals, maxCell, hasAny } = useMemo(() => {
    const featureNames = [
      ...new Set(members.flatMap((m) => Object.keys(counts.get(m.name)!))),
    ];
    const q = query.trim().toLowerCase();
    const rows = featureNames
      .filter((feature) => !q || feature.toLowerCase().includes(q))
      .map((feature) => ({
        feature,
        total: members.reduce(
          (s, m) => s + (counts.get(m.name)![feature] ?? 0),
          0,
        ),
        users: members.filter((m) => (counts.get(m.name)![feature] ?? 0) > 0)
          .length,
      }));
    const sortCounts =
      sortBy !== "total" && sortBy !== "users" ? counts.get(sortBy) : undefined;
    rows.sort((a, b) => {
      if (sortCounts)
        return (
          (sortCounts[b.feature] ?? 0) - (sortCounts[a.feature] ?? 0) ||
          b.total - a.total
        );
      if (sortBy === "users") return b.users - a.users || b.total - a.total;
      return b.total - a.total;
    });
    return {
      totals: rows,
      maxCell: Math.max(
        1,
        ...members.flatMap((m) => Object.values(counts.get(m.name)!)),
      ),
      hasAny: featureNames.length > 0,
    };
  }, [members, counts, query, sortBy]);

  // カテゴリ自体にデータがなければカードごと出さない(親でも制御するが保険)
  if (!hasAny) return null;

  return (
    <div className="card">
      <h2>
        {CATEGORY_LABEL[category]} × メンバー
        <InfoTip text={CATEGORY_INFO[category]} />
      </h2>
      {totals.length === 0 ? (
        <div className="empty-note">「{query}」に該当する項目なし</div>
      ) : (
        <div className={`heatmap-wrap${editMode ? " edit-mode" : ""}`}>
          <table className="heatmap">
            <thead>
              <tr>
                <th
                  className="sortable"
                  title="クリックで合計利用回数の多い順に並べ替え"
                  onClick={() => setSortBy("total")}
                >
                  {CATEGORY_LABEL[category]}
                  {sortBy === "total" && " ▼"}
                </th>
                {orderedMembers.map((m) => (
                  <th
                    className={`col sortable${m.name === highlightName ? " me-col" : ""}`}
                    key={m.name}
                    title={`クリックで ${m.name} の利用回数順に並べ替え`}
                    onClick={() =>
                      setSortBy((prev) => (prev === m.name ? "total" : m.name))
                    }
                  >
                    {m.name}
                    {sortBy === m.name && " ▼"}
                  </th>
                ))}
                <th
                  className="col sortable"
                  title="クリックで利用人数の多い順に並べ替え"
                  onClick={() => setSortBy("users")}
                >
                  利用人数
                  {sortBy === "users" && " ▼"}
                </th>
              </tr>
            </thead>
            <tbody>
              {(showAll ? totals : totals.slice(0, limit)).map(
                ({ feature, users }) => (
                  <tr key={feature}>
                    <th
                      className="sortable"
                      title={`クリックで「${feature}」をよく使う人の順にメンバー列を並べ替え`}
                      onClick={() =>
                        setMemberSort((prev) =>
                          prev === feature ? null : feature,
                        )
                      }
                    >
                      {feature}
                      {memberSort === feature && " ▶"}
                    </th>
                    {orderedMembers.map((m) => {
                      const count = counts.get(m.name)![feature] ?? 0;
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
                ),
              )}
            </tbody>
          </table>
          {totals.length > limit && !showAll && (
            <button className="bl-more" onClick={() => setShowAll(true)}>
              …ほか {totals.length - limit} 件を表示
            </button>
          )}
          {totals.length > limit && showAll && (
            <button className="bl-more" onClick={() => setShowAll(false)}>
              折りたたむ
            </button>
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
