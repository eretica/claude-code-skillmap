import { useMemo, useState } from "react";
import type { SessionMeta, SubagentRun } from "../lib/sessionDetail";
import { costOfTokens, loadRates, rateFor } from "../lib/pricing";
import { fmtDuration, fmtTokens } from "./SessionTimeline";

// セッション詳細のエントリ一覧。クリックでタイムラインモーダルを開く。
// トークン・概算コストはサブエージェント分も合算する(タイムラインの累積消費と一致させる)。

type SortKey = "start" | "duration" | "messages" | "tokens" | "cost";

export function SessionList({
  sessions,
  subagentRuns,
  onOpen,
}: {
  sessions: SessionMeta[];
  /** 読み込み中はnull。セッションごとの合算に使う */
  subagentRuns: SubagentRun[] | null;
  onOpen: (meta: SessionMeta) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("start");
  const [sortDesc, setSortDesc] = useState(true);
  const [repoFilter, setRepoFilter] = useState("");
  const rates = useMemo(() => loadRates(), []);

  const rows = useMemo(() => {
    // サブエージェント消費を親セッションに帰属させる
    const subBySession = new Map<string, SubagentRun[]>();
    for (const run of subagentRuns ?? []) {
      const list = subBySession.get(run.sessionId) ?? [];
      list.push(run);
      subBySession.set(run.sessionId, list);
    }
    return sessions.map((s) => {
      let tokens = 0;
      let usd = 0;
      let costKnown = false;
      for (const [model, t] of Object.entries(s.tokensByModel)) {
        tokens += t.input + t.output + t.cacheRead + t.cacheCreation;
        const rate = rateFor(model, rates);
        if (rate) {
          usd += costOfTokens(t, rate);
          costKnown = true;
        }
      }
      for (const run of subBySession.get(s.sessionId) ?? []) {
        tokens += run.totalTokens;
        const rate = run.model ? rateFor(run.model, rates) : null;
        if (rate) {
          usd += costOfTokens(run.tokens, rate);
          costKnown = true;
        }
      }
      return {
        meta: s,
        tokens,
        usd: costKnown ? usd : null,
        duration:
          s.start !== null && s.end !== null && s.end > s.start
            ? s.end - s.start
            : null,
      };
    });
  }, [sessions, subagentRuns, rates]);

  const repos = useMemo(
    () => [
      ...new Set(
        sessions.map((s) => s.repo).filter((r): r is string => !!r),
      ),
    ],
    [sessions],
  );

  const sorted = useMemo(() => {
    const filtered = repoFilter
      ? rows.filter((r) => r.meta.repo === repoFilter)
      : rows;
    const val = (r: (typeof rows)[number]): number => {
      switch (sortKey) {
        case "start":
          return r.meta.start ?? 0;
        case "duration":
          return r.duration ?? -1;
        case "messages":
          return r.meta.assistantMessages;
        case "tokens":
          return r.tokens;
        case "cost":
          return r.usd ?? -1;
      }
    };
    return [...filtered].sort((a, b) =>
      sortDesc ? val(b) - val(a) : val(a) - val(b),
    );
  }, [rows, repoFilter, sortKey, sortDesc]);

  if (sessions.length === 0)
    return <div className="empty-note">表示できるセッションがありません</div>;

  const shown = expanded ? sorted : sorted.slice(0, 12);
  const mark = (key: SortKey) =>
    sortKey === key ? (sortDesc ? " ▼" : " ▲") : "";
  const onSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc((v) => !v);
    else {
      setSortKey(key);
      setSortDesc(true);
    }
  };

  return (
    <div>
      {repos.length > 1 && (
        <div className="controls-row" style={{ marginTop: 0 }}>
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
          <span className="empty-note">{sorted.length} セッション</span>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table className="mini-table session-table">
          <thead>
            <tr>
              <th>セッション</th>
              <th>リポジトリ</th>
              <th className="sortable" onClick={() => onSort("start")}>
                開始{mark("start")}
              </th>
              <th className="sortable" onClick={() => onSort("duration")}>
                実時間{mark("duration")}
              </th>
              <th className="sortable" onClick={() => onSort("messages")}>
                msg{mark("messages")}
              </th>
              <th className="sortable" onClick={() => onSort("tokens")}>
                トークン{mark("tokens")}
              </th>
              <th className="sortable" onClick={() => onSort("cost")}>
                コスト{mark("cost")}
              </th>
              <th>スキル</th>
              <th>Ag</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ meta: s, tokens, usd, duration }) => (
              <tr key={s.sessionId} onClick={() => onOpen(s)}>
                <td className="session-title" title={s.title ?? s.sessionId}>
                  {s.title ?? `${s.sessionId.slice(0, 8)}…`}
                </td>
                <td>{s.repo ?? "–"}</td>
                <td>
                  {s.start !== null
                    ? new Date(s.start).toLocaleString("ja-JP", {
                        month: "numeric",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "–"}
                </td>
                <td>{duration !== null ? fmtDuration(duration) : "–"}</td>
                <td>{s.assistantMessages.toLocaleString()}</td>
                <td>{tokens > 0 ? fmtTokens(tokens) : "–"}</td>
                <td>{usd !== null ? `$${usd.toFixed(2)}` : "–"}</td>
                <td>{s.skills.length}</td>
                <td>{s.agentSpawns}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sorted.length > shown.length && (
        <button className="bl-more" onClick={() => setExpanded(true)}>
          …ほか {sorted.length - shown.length} セッションを表示
        </button>
      )}
      {expanded && sorted.length > 12 && (
        <button className="bl-more" onClick={() => setExpanded(false)}>
          折りたたむ
        </button>
      )}
    </div>
  );
}
