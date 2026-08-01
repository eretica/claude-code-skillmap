import { useState } from "react";

// カテゴリ別件数の横棒リスト。単一系列なのでシリーズ色は1色(series-1)。
export function BarList({
  data,
  limit = 12,
  color = "var(--series-1)",
  keepOrder = false,
  unit = "",
  format,
}: {
  data: Record<string, number>;
  limit?: number;
  color?: string;
  /** 分布バケットなど、キーの順序をそのまま保ちたい場合にtrue */
  keepOrder?: boolean;
  /** 値に付ける単位(例: "%")。単位なしの生数値と誤読させないため */
  unit?: string;
  /** 値の表示フォーマット(例: 金額)。指定時はunitより優先 */
  format?: (n: number) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const all = keepOrder
    ? Object.entries(data)
    : Object.entries(data).sort((a, b) => b[1] - a[1]);
  const entries = expanded ? all : all.slice(0, limit);
  if (entries.length === 0)
    return <div className="empty-note">データなし</div>;
  const max = Math.max(...all.map(([, v]) => v), 1);
  const rest = all.length - entries.length;
  return (
    <div>
      <div className="barlist">
        {entries.map(([label, count]) => (
          <div key={label} style={{ display: "contents" }}>
            <div className="bl-label" title={label}>
              {label}
            </div>
            <div className="bl-track">
              <div
                className="bl-bar"
                style={{
                  width: `${(count / max) * 100}%`,
                  background: color,
                }}
              />
            </div>
            <div className="bl-value">
              {format ? format(count) : `${count.toLocaleString()}${unit}`}
            </div>
          </div>
        ))}
      </div>
      {rest > 0 && (
        <button className="bl-more" onClick={() => setExpanded(true)}>
          …ほか {rest} 件を表示
        </button>
      )}
      {expanded && all.length > limit && (
        <button className="bl-more" onClick={() => setExpanded(false)}>
          折りたたむ
        </button>
      )}
    </div>
  );
}
