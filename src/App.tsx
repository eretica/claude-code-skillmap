import { useEffect, useState } from "react";
import { IS_CLOUD } from "./lib/config";
import { getHashParam, setHashParams } from "./lib/urlState";
import { currentRoomId, isAdminPath } from "./lib/room";
import { PersonalView } from "./components/PersonalView";
import { TeamView } from "./components/TeamView";
import { AdminView } from "./components/AdminView";

type Tab = "personal" | "team";

// クラウド版: ルームURL(/r/…)以外ではデータページを一切表示しない
function Landing() {
  return (
    <div>
      <header className="app-header">
        <h1>claude-code-skillmap</h1>
      </header>
      <div className="card" style={{ marginTop: 24 }}>
        <h2>ルームURLが必要です</h2>
        <p className="card-desc" style={{ marginBottom: 0 }}>
          このアプリはルーム単位で利用します。チームの管理者から共有された
          ルームURL(<code>/r/…</code>)からアクセスしてください。
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>(() =>
    getHashParam("tab") === "team" ? "team" : "personal",
  );

  useEffect(() => {
    setHashParams({ tab: tab === "team" ? "team" : null });
  }, [tab]);

  if (IS_CLOUD) {
    if (isAdminPath()) return <AdminView />;
    if (!currentRoomId()) return <Landing />;
  }

  return (
    <div>
      <header className="app-header">
        <h1>claude-code-skillmap</h1>
        <span className="subtitle">
          Claude Code のスキル・サブエージェント活用を可視化する
          {IS_CLOUD && " (チーム版)"}
        </span>
      </header>

      <div className="privacy-note">
        {IS_CLOUD ? (
          <>
            🔒 トランスクリプトの解析はすべてこのブラウザ内で完結します。
            「チームに共有」で保存されるのは機能名(スキル名・ツール名等)と
            集計値のサマリーのみで、会話本文・ファイルパス・コード・
            セッションIDは送信されません。
          </>
        ) : (
          <>
            🔒 解析はすべてこのブラウザ内で完結します。トランスクリプトの内容が
            ネットワークに送信されることはありません。エクスポートされるサマリーJSONに
            含まれるのは機能名(スキル名・ツール名等)と集計値のみで、会話本文・
            ファイルパス・コード・セッションIDは含まれません。
          </>
        )}
      </div>

      <div className="tabs">
        <button
          className={tab === "personal" ? "active" : ""}
          onClick={() => setTab("personal")}
        >
          個人解析
        </button>
        <button
          className={tab === "team" ? "active" : ""}
          onClick={() => setTab("team")}
        >
          チーム集計
        </button>
      </div>

      <div style={{ display: tab === "personal" ? "block" : "none" }}>
        <PersonalView />
      </div>
      <div style={{ display: tab === "team" ? "block" : "none" }}>
        <TeamView />
      </div>
    </div>
  );
}
