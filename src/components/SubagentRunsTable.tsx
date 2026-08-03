import { useMemo, useState } from "react";
import type { SubagentRun } from "../lib/sessionDetail";
import { loadRates, rateFor } from "../lib/pricing";
import { fmtDuration, fmtTokens } from "./SessionTimeline";

// サブエージェント起動の一覧テーブル。表示は種別・モデル・所要・トークン等の
// メタデータのみで、指示プロンプトは文字数だけ(内容は保持していない)。
export function SubagentRunsTable({
  runs,
  onOpenSession,
}: {
  runs: SubagentRun[];
  onOpenSession: (sessionId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const rates = useMemo(() => loadRates(), []);
  const shown = expanded ? runs : runs.slice(0, 12);
  if (runs.length === 0)
    return (
      <div className="empty-note">
        サブエージェントのトランスクリプトが見つかりませんでした
      </div>
    );

  const costOf = (run: SubagentRun): string => {
    if (!run.model) return "–";
    const r = rateFor(run.model, rates);
    if (!r) return "–";
    const usd =
      (run.tokens.input * r.input +
        run.tokens.output * r.output +
        run.tokens.cacheRead * r.input * 0.1 +
        run.tokens.cacheCreation * r.input * 1.25) /
      1_000_000;
    return `$${usd.toFixed(2)}`;
  };

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="mini-table subagent-table">
        <thead>
          <tr>
            <th>日時</th>
            <th>種別</th>
            <th>モデル</th>
            <th>リポジトリ</th>
            <th>所要</th>
            <th>トークン</th>
            <th>コスト</th>
            <th>prompt長</th>
            <th>セッション</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((run, i) => (
            <tr key={`${run.sessionId}-${run.name}-${i}`}>
              <td className="mono">
                {run.start !== null
                  ? new Date(run.start).toLocaleString("ja-JP", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "–"}
              </td>
              <td className="subagent-kind" title={run.sessionTitle ?? ""}>
                {run.type ? `${run.type} · ` : ""}
                {run.name}
              </td>
              <td>
                {run.model ? (
                  <span className="model-pill">
                    {run.model.replace(/^claude-/, "")}
                  </span>
                ) : (
                  "–"
                )}
              </td>
              <td>{run.repo ?? "–"}</td>
              <td>
                {run.start !== null && run.end !== null && run.end > run.start
                  ? fmtDuration(run.end - run.start)
                  : "–"}
              </td>
              <td>{fmtTokens(run.totalTokens)}</td>
              <td>{costOf(run)}</td>
              <td>
                {run.promptChars !== null
                  ? run.promptChars.toLocaleString()
                  : "–"}
              </td>
              <td>
                <button
                  className="link-btn"
                  onClick={() => onOpenSession(run.sessionId)}
                >
                  見る →
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {runs.length > shown.length && (
        <button className="bl-more" onClick={() => setExpanded(true)}>
          …ほか {runs.length - shown.length} 件を表示
        </button>
      )}
      {expanded && runs.length > 12 && (
        <button className="bl-more" onClick={() => setExpanded(false)}>
          折りたたむ
        </button>
      )}
    </div>
  );
}
