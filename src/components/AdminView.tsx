import { useCallback, useEffect, useState } from "react";
import type { Room } from "../lib/api";
import { createRoom, deleteRoom, fetchRooms } from "../lib/api";
import { roomUrl } from "../lib/room";

// 管理画面(/admin)。middleware.tsのベーシック認証で保護される。
// ルームの発行・一覧・削除と、各ルームの利用状況(メンバー数・最終共有)を見る。

export function AdminView() {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRooms(await fetchRooms());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onCreate = async () => {
    setError(null);
    try {
      await createRoom(label.trim());
      setLabel("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onDelete = async (room: Room) => {
    if (
      !window.confirm(
        `ルーム「${room.label || room.id}」を削除しますか?\nメンバー ${room.members} 名の共有データも消えます。`,
      )
    )
      return;
    setError(null);
    try {
      await deleteRoom(room.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const copy = async (id: string) => {
    await navigator.clipboard.writeText(roomUrl(id));
    setCopied(id);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div>
      <header className="app-header">
        <h1>claude-code-skillmap 管理</h1>
        <span className="subtitle">ルームの発行と利用状況</span>
      </header>

      <div className="card">
        <h2>ルームを作成</h2>
        <p className="card-desc">
          推測不能なURLが発行されます。URLを知っている人だけがルームを閲覧・共有できます。
        </p>
        <div className="controls-row" style={{ margin: 0 }}>
          <input
            type="text"
            placeholder="ラベル (例: backend-team)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <button className="primary" onClick={() => void onCreate()}>
            作成
          </button>
        </div>
      </div>

      {error && (
        <div className="progress" style={{ color: "var(--series-2)" }}>
          {error}
        </div>
      )}

      <div className="card">
        <div className="controls-row" style={{ margin: "0 0 8px" }}>
          <h2 style={{ margin: 0 }}>ルーム一覧</h2>
          <button className="ghost" onClick={() => void load()} disabled={loading}>
            {loading ? "読み込み中…" : "↻ 再読み込み"}
          </button>
        </div>
        {rooms.length === 0 ? (
          <div className="empty-note">ルームはまだありません</div>
        ) : (
          <div className="heatmap-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>ラベル</th>
                  <th>URL</th>
                  <th>メンバー</th>
                  <th>最終共有</th>
                  <th>作成日</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rooms.map((r) => (
                  <tr key={r.id}>
                    <td>{r.label || <span className="empty-note">(なし)</span>}</td>
                    <td>
                      <a href={`/r/${r.id}`} className="room-link">
                        /r/{r.id.slice(0, 8)}…
                      </a>{" "}
                      <button className="ghost btn-sm" onClick={() => void copy(r.id)}>
                        {copied === r.id ? "コピーしました" : "URLをコピー"}
                      </button>
                    </td>
                    <td>{r.members}</td>
                    <td>
                      {r.lastShared
                        ? new Date(r.lastShared).toLocaleDateString()
                        : "–"}
                    </td>
                    <td>{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td>
                      <button
                        className="ghost btn-sm"
                        onClick={() => void onDelete(r)}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
