import { useState } from "react";
import type { UsageSummary } from "../lib/types";
import { InfoTip } from "./InfoTip";
import {
  activityIn,
  diversity,
  featureCounts,
  median,
  skillRate,
  sumOf,
} from "../lib/teamStats";

// 比較の1行: 自分と基準(チーム平均 or 特定メンバー)を同一スケールのバーで並べ、
// 中央値の位置に目盛りを打つ(平均は少人数だとヘビーユーザーに引っ張られるため)
function CompareRow({
  label,
  mine,
  base,
  baseLabel,
  values,
  unit,
}: {
  label: string;
  mine: number;
  base: number;
  baseLabel: string;
  values: number[];
  unit?: string;
}) {
  const med = median(values);
  const max = Math.max(...values, 1);
  const rank = values.filter((v) => v > mine).length + 1;
  const fmtVal = (v: number) =>
    `${(Math.round(v * 10) / 10).toLocaleString()}${unit ?? ""}`;
  return (
    <div style={{ display: "contents" }}>
      <div className="bl-label" title={label}>
        {label}
      </div>
      <div className="cmp-bars">
        <div className="cmp-track">
          <div
            className="cmp-bar cmp-me"
            style={{ width: `${(mine / max) * 100}%` }}
          />
        </div>
        <div className="cmp-track">
          <div
            className="cmp-bar cmp-avg"
            style={{ width: `${(base / max) * 100}%` }}
          />
        </div>
        <div
          className="cmp-median"
          style={{ left: `${(med / max) * 100}%` }}
          title={`中央値 ${fmtVal(med)}`}
        />
      </div>
      <div className="cmp-meta">
        <span className="cmp-value">{fmtVal(mine)}</span>
        <span className="cmp-sub">
          {baseLabel} {fmtVal(base)} ・ 中央値 {fmtVal(med)} ・ {rank}位/
          {values.length}人
        </span>
      </div>
    </div>
  );
}

export function CompareCard({
  members,
  target,
  onTargetChange,
  cutoff,
}: {
  members: UsageSummary[];
  target: UsageSummary;
  onTargetChange: (name: string) => void;
  cutoff: string | null;
}) {
  // 比較の基準: チーム平均、またはお手本にしたい特定メンバー(1対1比較)
  const [baseline, setBaseline] = useState<string>("avg");
  const baseMember =
    baseline === "avg"
      ? null
      : (members.find((m) => m.name === baseline && m.name !== target.name) ??
        null);
  const baseLabel = baseMember ? baseMember.name : "チーム平均";

  const metrics: {
    label: string;
    value: (m: UsageSummary) => number;
    unit?: string;
  }[] = [
    { label: "セッション数", value: (m) => activityIn(m, cutoff).sessions },
    { label: "メッセージ数", value: (m) => activityIn(m, cutoff).messages },
    {
      label: "スキル利用回数",
      value: (m) => sumOf(featureCounts(m, "skills", cutoff)),
    },
    {
      label: "サブエージェント起動",
      value: (m) => sumOf(featureCounts(m, "subagents", cutoff)),
    },
    { label: "スキル利用セッション率", value: skillRate, unit: "%" },
    { label: "活用機能の種類", value: (m) => diversity(m, cutoff) },
  ];

  return (
    <div className="card">
      <div className="controls-row" style={{ margin: "0 0 4px" }}>
        <h2 style={{ margin: 0 }}>個人 vs チーム<InfoTip text="青=選んだメンバー、グレー=比較の基準(チーム平均または特定メンバー)。縦線はチーム中央値=メンバーを値の順に並べたとき真ん中に来る値で、平均と違い極端に多い人に引っ張られません" /></h2>
        <select
          className="member-select"
          value={target.name}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          {members.map((m) => (
            <option key={m.name} value={m.name}>
              {m.name}
            </option>
          ))}
        </select>
        <span className="empty-note">と比べる:</span>
        <select
          className="member-select"
          value={baseMember ? baseline : "avg"}
          onChange={(e) => setBaseline(e.target.value)}
        >
          <option value="avg">チーム平均</option>
          {members
            .filter((m) => m.name !== target.name)
            .map((m) => (
              <option key={m.name} value={m.name}>
                {m.name}
              </option>
            ))}
        </select>
      </div>
      <p className="card-desc">
        選んだメンバーと{baseLabel}の比較。縦線はチーム中央値。
        {cutoff ? "件数系は期間内の値です。" : ""}
        スキル利用セッション率のみ全期間の値です。
      </p>
      <div className="compare-grid">
        {metrics.map(({ label, value, unit }) => {
          const values = members.map(value);
          return (
            <CompareRow
              key={label}
              label={label}
              mine={value(target)}
              base={
                baseMember
                  ? value(baseMember)
                  : values.length
                    ? values.reduce((a, b) => a + b, 0) / values.length
                    : 0
              }
              baseLabel={baseMember ? baseLabel : "平均"}
              values={values}
              unit={unit}
            />
          );
        })}
      </div>
      <div className="legend">
        <span>
          <span className="swatch" style={{ background: "var(--series-1)" }} />
          {target.name}
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--axis)" }} />
          {baseLabel}
        </span>
        <span>
          <span className="swatch cmp-median-swatch" />
          中央値
        </span>
      </div>
    </div>
  );
}
