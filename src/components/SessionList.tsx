import { useState } from "react";
import type { SessionMeta } from "../lib/sessionDetail";
import { fmtDuration } from "./SessionTimeline";

// セッション詳細のエントリ一覧。クリックでタイムラインモーダルを開く。
export function SessionList({
  sessions,
  onOpen,
}: {
  sessions: SessionMeta[];
  onOpen: (meta: SessionMeta) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? sessions : sessions.slice(0, 12);
  if (sessions.length === 0)
    return <div className="empty-note">表示できるセッションがありません</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="mini-table session-table">
        <thead>
          <tr>
            <th>セッション</th>
            <th>リポジトリ</th>
            <th>開始</th>
            <th>実時間</th>
            <th>msg</th>
            <th>スキル</th>
            <th>エージェント</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
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
              <td>
                {s.start !== null && s.end !== null
                  ? fmtDuration(s.end - s.start)
                  : "–"}
              </td>
              <td>{s.assistantMessages.toLocaleString()}</td>
              <td>{s.skills.length}</td>
              <td>{s.agentSpawns}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sessions.length > shown.length && (
        <button className="bl-more" onClick={() => setExpanded(true)}>
          …ほか {sessions.length - shown.length} セッションを表示
        </button>
      )}
      {expanded && sessions.length > 12 && (
        <button className="bl-more" onClick={() => setExpanded(false)}>
          折りたたむ
        </button>
      )}
    </div>
  );
}
