import { useMemo, useState } from "react";
import type { SubagentRun } from "../lib/sessionDetail";
import { costOfTokens, loadRates, rateFor } from "../lib/pricing";
import { fmtDuration, fmtTokens } from "./SessionTimeline";

// サブエージェント起動の一覧テーブル。表示は種別・モデル・所要・トークン等の
// メタデータのみで、指示プロンプトは文字数だけ(内容は保持していない)。
// 「詳細」=そのエージェント単体のミニタイムライン、「セッション」=親セッションのタイムライン。

type SortKey = "start" | "duration" | "tokens" | "cost" | "prompt";

const SORT_LABEL: [SortKey, string][] = [
  ["start", "日時"],
  ["duration", "所要"],
  ["tokens", "トークン"],
  ["cost", "コスト"],
  ["prompt", "prompt長"],
];

export function SubagentRunsTable({
  runs,
  onOpenSession,
  onOpenDetail,
}: {
  runs: SubagentRun[];
  onOpenSession: (sessionId: string) => void;
  onOpenDetail: (run: SubagentRun) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDesc, setSortDesc] = useState(true);
  const [repoFilter, setRepoFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const rates = useMemo(() => loadRates(), []);

  const withCost = useMemo(
    () =>
      runs.map((run) => {
        const r = run.model ? rateFor(run.model, rates) : null;
        return {
          run,
          usd: r ? costOfTokens(run.tokens, r) : null,
          duration:
            run.start !== null && run.end !== null && run.end > run.start
              ? run.end - run.start
              : null,
        };
      }),
    [runs, rates],
  );

  const repos = useMemo(
    () => [...new Set(runs.map((r) => r.repo).filter((r): r is string => !!r))],
    [runs],
  );
  const types = useMemo(
    () => [...new Set(runs.map((r) => r.type).filter((t): t is string => !!t))],
    [runs],
  );

  const rows = useMemo(() => {
    const filtered = withCost.filter(
      ({ run }) =>
        (!repoFilter || run.repo === repoFilter) &&
        (!typeFilter || run.type === typeFilter),
    );
    const val = (x: (typeof withCost)[number]): number => {
      switch (sortKey) {
        case "start":
          return x.run.start ?? 0;
        case "duration":
          return x.duration ?? -1;
        case "tokens":
          return x.run.totalTokens;
        case "cost":
          return x.usd ?? -1;
        case "prompt":
          return x.run.promptChars ?? -1;
      }
    };
    return filtered.sort((a, b) =>
      sortDesc ? val(b) - val(a) : val(a) - val(b),
    );
  }, [withCost, repoFilter, typeFilter, sortKey, sortDesc]);

  if (runs.length === 0)
    return (
      <div className="empty-note">
        サブエージェントのトランスクリプトが見つかりませんでした
      </div>
    );

  const shown = expanded ? rows : rows.slice(0, 12);
  const sortMark = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ▼" : " ▲") : "";
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };
  const headerOf = (key: SortKey) =>
    SORT_LABEL.find(([k]) => k === key)?.[1] ?? key;

  return (
    <div>
      {(repos.length > 1 || types.length > 1) && (
        <div className="controls-row" style={{ marginTop: 0 }}>
          {repos.length > 1 && (
            <select
              className="member-select"
              value={repoFilter}
              onChange={(e) => setRepoFilter(e.target.value)}
              aria-label="リポジトリで絞り込み"
            >
              <option value="">全リポジトリ</option>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          )}
          {types.length > 1 && (
            <select
              className="member-select"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              aria-label="種別で絞り込み"
            >
              <option value="">全種別</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          )}
          <span className="empty-note">{rows.length} 件</span>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table subagent-table">
          <thead>
            <tr>
              {(["start"] as const).map((k) => (
                <th key={k} className="sortable" onClick={() => onSort(k)}>
                  {headerOf(k)}
                  {sortMark(k)}
                </th>
              ))}
              <th>種別</th>
              <th>モデル</th>
              <th>リポジトリ</th>
              {(["duration", "tokens", "cost", "prompt"] as const).map((k) => (
                <th key={k} className="sortable" onClick={() => onSort(k)}>
                  {headerOf(k)}
                  {sortMark(k)}
                </th>
              ))}
              <th>詳細</th>
              <th>セッション</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ run, usd, duration }, i) => (
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
                <td>{duration !== null ? fmtDuration(duration) : "–"}</td>
                <td>{fmtTokens(run.totalTokens)}</td>
                <td>{usd !== null ? `$${usd.toFixed(2)}` : "–"}</td>
                <td>
                  {run.promptChars !== null
                    ? run.promptChars.toLocaleString()
                    : "–"}
                </td>
                <td>
                  <button className="link-btn" onClick={() => onOpenDetail(run)}>
                    見る →
                  </button>
                </td>
                <td>
                  <button
                    className="link-btn"
                    onClick={() => onOpenSession(run.sessionId)}
                  >
                    開く →
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length && (
        <button className="bl-more" onClick={() => setExpanded(true)}>
          …ほか {rows.length - shown.length} 件を表示
        </button>
      )}
      {expanded && rows.length > 12 && (
        <button className="bl-more" onClick={() => setExpanded(false)}>
          折りたたむ
        </button>
      )}
    </div>
  );
}
