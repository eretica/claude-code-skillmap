import type { Period } from "../lib/teamStats";
import { PERIOD_LABEL } from "../lib/teamStats";

// 期間フィルタ: プリセット(全期間/30日/7日)+任意のfrom〜to指定。
// 個人ビューとチームビューで共用する。
export function PeriodFilter({
  period,
  onPeriodChange,
  from,
  to,
  onFromChange,
  onToChange,
}: {
  period: Period;
  onPeriodChange: (p: Period) => void;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
}) {
  return (
    <>
      <div className="tabs" style={{ margin: 0, borderBottom: "none" }}>
        {PERIOD_LABEL.map(([p, label]) => (
          <button
            key={String(p)}
            className={p === period ? "active" : ""}
            onClick={() => onPeriodChange(p)}
          >
            {label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <span className="period-range">
          <input
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => onFromChange(e.target.value)}
            aria-label="開始日"
          />
          〜
          <input
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => onToChange(e.target.value)}
            aria-label="終了日"
          />
        </span>
      )}
    </>
  );
}
