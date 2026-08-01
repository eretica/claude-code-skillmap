import { useState } from "react";
import type { UsageSummary } from "../lib/types";
import type { ExcludableCategory } from "../lib/exclude";
import { EXCLUDABLE_CATEGORIES, exKey } from "../lib/exclude";
import { Modal } from "./Modal";

// 共有/エクスポートの確認モーダル。
// 表示名・リポジトリopt-in・スキル等の除外・送信JSONプレビュー・実行を1画面で完結させる。
// 状態(name/excluded/includedRepos)は永続化の都合で親(PersonalView)が持つ。

export function ShareModal({
  canShare,
  summary,
  outgoing,
  name,
  onNameChange,
  excluded,
  onToggleExcluded,
  onSetCategoryExcluded,
  includedRepos,
  onToggleRepo,
  onSetRepos,
  repoGateBlocked,
  shareState,
  shareError,
  onShare,
  onExport,
  onClose,
}: {
  canShare: boolean;
  summary: UsageSummary;
  /** 除外・opt-in適用済みの出力内容(プレビュー/エクスポート対象) */
  outgoing: UsageSummary;
  name: string;
  onNameChange: (name: string) => void;
  excluded: Set<string>;
  onToggleExcluded: (key: string) => void;
  onSetCategoryExcluded: (category: ExcludableCategory, exclude: boolean) => void;
  includedRepos: Set<string>;
  onToggleRepo: (repo: string) => void;
  onSetRepos: (repos: Set<string>) => void;
  repoGateBlocked: boolean;
  shareState: "idle" | "sending" | "done" | "error";
  shareError: string;
  onShare: () => void;
  onExport: () => void;
  onClose: () => void;
}) {
  const [showJson, setShowJson] = useState(false);
  const allRepos = Object.keys(summary.repos ?? {});
  const verb = canShare ? "共有" : "出力";

  return (
    <Modal
      title={canShare ? "チームに共有" : "サマリーJSONをエクスポート"}
      onClose={onClose}
      footer={
        <>
          <button className="ghost" onClick={onClose}>
            キャンセル
          </button>
          <button
            className={canShare ? "ghost" : "primary"}
            disabled={repoGateBlocked}
            onClick={onExport}
          >
            JSONをエクスポート
          </button>
          {canShare && (
            <button
              className="primary"
              disabled={
                !name.trim() || shareState === "sending" || repoGateBlocked
              }
              onClick={onShare}
            >
              {shareState === "sending"
                ? "送信中…"
                : repoGateBlocked
                  ? "リポジトリを選んでください"
                  : !name.trim()
                    ? "表示名を入力してください"
                    : `${name.trim()} として共有する`}
            </button>
          )}
        </>
      }
    >
      <label className="modal-field">
        <span>表示名</span>
        <input
          type="text"
          placeholder="例: username"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
        />
      </label>
      <p className="card-desc">
        {canShare
          ? "下の内容がチームに共有されます。"
          : "下の内容がJSONに出力されます。"}
        会話本文・ファイルパス・コードは含まれません。
        {canShare &&
          " サーバー保存時は過去の共有分と日付単位でマージされ、履歴は蓄積されます。"}
      </p>

      {allRepos.length > 0 && (
        <div className="exclude-group repo-select">
          <div className="exclude-group-label">
            含めるリポジトリ(既定: なし)
            <button
              className="bl-more"
              style={{ marginLeft: 10 }}
              onClick={() => onSetRepos(new Set(allRepos))}
            >
              すべて選択
            </button>
            <button
              className="bl-more"
              style={{ marginLeft: 8 }}
              onClick={() => onSetRepos(new Set())}
            >
              すべて解除
            </button>
          </div>
          <p className="card-desc" style={{ margin: "2px 0 6px" }}>
            リポジトリは<strong>選んだものだけ</strong>
            {verb}
            されます(機密リポジトリの誤爆防止)。名前はディレクトリ名のみです。
          </p>
          <div className="exclude-items">
            {allRepos.map((repo) => (
              <label key={repo} className="exclude-item">
                <input
                  type="checkbox"
                  checked={includedRepos.has(repo)}
                  onChange={() => onToggleRepo(repo)}
                />
                {repo}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="modal-summary">
        {verb}に含まれる項目(チェックを外すと除外)
        {excluded.size > 0 && ` ・ ${excluded.size} 項目を除外中`}
      </div>
      {EXCLUDABLE_CATEGORIES.filter(([c]) => c !== "repos").map(
        ([category, label]) => {
          const items = Object.keys(summary[category] ?? {});
          if (items.length === 0) return null;
          return (
            <div key={category} className="exclude-group">
              <div className="exclude-group-label">
                {label}
                <button
                  className="bl-more"
                  style={{ marginLeft: 10 }}
                  onClick={() => onSetCategoryExcluded(category, false)}
                >
                  すべて選択
                </button>
                <button
                  className="bl-more"
                  style={{ marginLeft: 8 }}
                  onClick={() => onSetCategoryExcluded(category, true)}
                >
                  すべて解除
                </button>
              </div>
              <div className="exclude-items">
                {items.map((item) => {
                  const key = exKey(category, item);
                  return (
                    <label key={item} className="exclude-item">
                      <input
                        type="checkbox"
                        checked={!excluded.has(key)}
                        onChange={() => onToggleExcluded(key)}
                      />
                      {item}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        },
      )}

      <button
        className="bl-more"
        onClick={() => setShowJson((v) => !v)}
        style={{ marginTop: 10 }}
      >
        {showJson ? "JSONを隠す" : "出力されるJSONを見る"}(
        {(JSON.stringify(outgoing).length / 1024).toFixed(1)} KB)
      </button>
      {showJson && (
        <pre className="preview-json" style={{ marginTop: 8 }}>
          {JSON.stringify(outgoing, null, 2)}
        </pre>
      )}
      {shareState === "error" && (
        <div className="progress" style={{ color: "var(--series-2)" }}>
          共有に失敗しました: {shareError}
        </div>
      )}
    </Modal>
  );
}
