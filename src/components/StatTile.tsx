import { InfoTip } from "./InfoTip";

export function StatTile({
  label,
  value,
  sub,
  info,
}: {
  label: string;
  value: string | number;
  sub?: string;
  /** 指標の意味のホバー説明 */
  info?: string;
}) {
  return (
    <div className="stat-tile">
      <div className="label">
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div className="value">
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
