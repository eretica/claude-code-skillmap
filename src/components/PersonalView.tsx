import { useEffect, useMemo, useRef, useState } from "react";
import type { UsageSummary } from "../lib/types";
import type { ParseProgress } from "../lib/parser";
import { parseTranscripts } from "../lib/parser";
import {
  downloadJson,
  ensureHandlePermission,
  filesFromHandle,
} from "../lib/files";
import {
  clearDirHandle,
  loadDirHandle,
  saveDirHandle,
} from "../lib/handleStore";
import { CAN_SHARE } from "../lib/config";
import { fetchTeamSummaries, shareSummary } from "../lib/api";
import { mergeSummaries } from "../lib/merge";
import { isStatsCacheFile, parseStatsCacheFile } from "../lib/statsCache";
import { EXCLUDABLE_CATEGORIES, applyExclusions, exKey } from "../lib/exclude";
import type { Period } from "../lib/teamStats";
import {
  PERIOD_LABEL,
  activityIn,
  cutoffOf,
  featureCounts,
  skillRateParts,
  sumOf,
} from "../lib/teamStats";
import { weeklyTrend } from "../lib/trend";
import { Dropzone } from "./Dropzone";
import { InfoTip } from "./InfoTip";
import { StatTile } from "./StatTile";
import { BarList } from "./BarList";
import { DailyCharts, GrowthChart, TokenChart } from "./ChartsLazy";

const NAME_KEY = "claude-graph:name";
const EXCLUDED_KEY = "claude-graph:excluded";

export function PersonalView() {
  // 表示名は次回訪問時のために記憶しておく
  const [name, setName] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "",
  );
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [parsing, setParsing] = useState(false);
  // 除外設定は永続化する。セッション限りだと、次回の再共有(日付マージ)で
  // 除外したはずの項目が直近日付分から復活してしまうため。
  const [excluded, setExcluded] = useState<Set<string>>(() => {
    try {
      return new Set<string>(
        JSON.parse(localStorage.getItem(EXCLUDED_KEY) ?? "[]"),
      );
    } catch {
      return new Set();
    }
  });
  const [period, setPeriod] = useState<Period>("all");
  const [showPreview, setShowPreview] = useState(false);
  const [savedHandle, setSavedHandle] = useState<unknown | null>(null);
  const [notice, setNotice] = useState<{
    kind: "info" | "error";
    text: string;
  } | null>(null);
  const [shareState, setShareState] = useState<
    "idle" | "sending" | "done" | "error"
  >("idle");
  const [shareError, setShareError] = useState("");
  const statsInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name.trim());
  }, [name]);

  useEffect(() => {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]));
  }, [excluded]);

  // 前回選んだフォルダのハンドルを復元(ワンクリック再解析用)
  useEffect(() => {
    void loadDirHandle().then(setSavedHandle);
  }, []);

  const rememberHandle = (handle: unknown) => {
    setSavedHandle(handle);
    void saveDirHandle(handle);
  };

  const rescan = async () => {
    if (!savedHandle) return;
    setNotice(null);
    try {
      if (!(await ensureHandlePermission(savedHandle))) {
        setNotice({
          kind: "error",
          text: "フォルダへのアクセスが許可されませんでした。もう一度お試しください。",
        });
        return;
      }
      const picked = await filesFromHandle(savedHandle);
      if (picked.length === 0) {
        setNotice({
          kind: "error",
          text: "対象ファイルが見つかりませんでした。フォルダを選び直してください。",
        });
        return;
      }
      setFiles(picked);
      void run(picked);
    } catch {
      // フォルダが移動・削除された場合など。壊れた記憶は破棄する
      setNotice({
        kind: "error",
        text: "前回のフォルダを読み込めませんでした(移動または削除された可能性があります)。フォルダを選び直してください。",
      });
      forgetHandle();
    }
  };

  const forgetHandle = () => {
    setSavedHandle(null);
    void clearDirHandle();
  };

  const run = async (targets: File[]) => {
    const statsFile = targets.find(isStatsCacheFile);
    const jsonl = targets.filter((f) => !isStatsCacheFile(f));
    if (jsonl.length === 0) return;
    setParsing(true);
    setSummary(null);
    setShareState("idle");
    try {
      let result = await parseTranscripts(
        jsonl,
        name.trim() || "no-name",
        setProgress,
      );
      // ~/.claude ごと選ばれた場合はstats-cacheから過去履歴をバックフィル
      if (statsFile) {
        try {
          result = withBackfill(result, await parseStatsCacheFile(statsFile));
        } catch {
          // stats-cacheが読めなくてもトランスクリプト解析は成立するので続行
        }
      }
      setSummary(result);
    } finally {
      setParsing(false);
    }
  };

  // stats-cacheの日別アクティビティを結合(トランスクリプト由来の日付が優先)
  const withBackfill = (
    current: UsageSummary,
    backfill: UsageSummary,
  ): UsageSummary => {
    const covered = new Set(current.dailyActivity.map((d) => d.date));
    const added = backfill.dailyActivity.filter(
      (d) => !covered.has(d.date),
    ).length;
    if (added === 0) {
      setNotice({
        kind: "info",
        text: "stats-cache.json に追加できる過去履歴はありませんでした。",
      });
      return current;
    }
    setNotice({
      kind: "info",
      text: `stats-cache.json から過去 ${added} 日分のアクティビティをバックフィルしました(スキル等の内訳は含まれません)。`,
    });
    return mergeSummaries(backfill, current);
  };

  const onStatsFile = async (file: File) => {
    if (!summary) return;
    setNotice(null);
    try {
      const backfill = await parseStatsCacheFile(file);
      setSummary((prev) => (prev ? withBackfill(prev, backfill) : prev));
      setShareState("idle");
    } catch (e) {
      setNotice({
        kind: "error",
        text: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const onFiles = (picked: File[]) => {
    setFiles(picked);
    void run(picked);
  };

  const toggleExcluded = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setShareState("idle");
  };

  // 共有・エクスポートには除外設定を適用したサマリーを使う
  const outgoing = summary
    ? applyExclusions({ ...summary, name: name.trim() || "no-name" }, excluded)
    : null;

  const share = async () => {
    if (!outgoing || !summary || !name.trim()) return;
    setShareState("sending");
    try {
      // 蓄積: サーバーの保存分と日付マージしてから送る。
      // 除外設定はマージ後の全体に適用する(過去の共有分からも消える)。
      // 取得に失敗した場合は、上書きで履歴を失わないよう中断する。
      const rows = await fetchTeamSummaries();
      const mine = rows.find((r) => r.name === outgoing.name);
      const payload = mine
        ? applyExclusions(
            mergeSummaries(mine.data, {
              ...summary,
              name: outgoing.name,
              exportedAt: outgoing.exportedAt,
            }),
            excluded,
          )
        : outgoing;
      await shareSummary(payload);
      setShareState("done");
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
      setShareState("error");
    }
  };

  // 期間フィルタは「表示のみ」に適用する(共有・エクスポートは常に全期間)
  const cutoff = cutoffOf(period);
  const view = useMemo(() => {
    if (!summary) return null;
    const skills = featureCounts(summary, "skills", cutoff);
    const subagents = featureCounts(summary, "subagents", cutoff);
    const mcpTools = featureCounts(summary, "mcpTools", cutoff);
    const activity = activityIn(summary, cutoff);
    const daily = cutoff
      ? summary.dailyActivity.filter((d) => d.date >= cutoff)
      : summary.dailyActivity;
    // スキル利用セッション率(スキル情報を持つ日だけで計算。バックフィル日で希釈させない)
    let { num: skillRateNum, den: skillRateDen } = skillRateParts(summary);
    if (cutoff) {
      const days = daily.filter((d) => typeof d.skillSessions === "number");
      skillRateDen = days.reduce((s, d) => s + d.sessions, 0);
      skillRateNum = days.reduce((s, d) => s + (d.skillSessions ?? 0), 0);
    }
    return {
      skills,
      subagents,
      mcpTools,
      slashCommands: featureCounts(summary, "slashCommands", cutoff),
      plugins: featureCounts(summary, "plugins", cutoff),
      activity,
      daily,
      skillRate:
        skillRateDen > 0
          ? Math.round((skillRateNum / skillRateDen) * 100)
          : 0,
      skillRateNum,
      skillRateDen,
      distinctFeatures:
        Object.keys(skills).length +
        Object.keys(subagents).length +
        Object.keys(mcpTools).length,
    };
  }, [summary, cutoff]);

  const trend = useMemo(
    () => (summary ? weeklyTrend(summary) : []),
    [summary],
  );

  const allTime = cutoff ? " (全期間)" : "";

  return (
    <div>
      <Dropzone onFiles={onFiles} onHandle={rememberHandle} directory>
        <div>
          <strong>~/.claude/projects/</strong> フォルダを選択、またはドラッグ&ドロップ
        </div>
        <div className="hint">
          .jsonl ファイルをブラウザ内でパースします。データが外部に送信されることはありません。
        </div>
      </Dropzone>

      {savedHandle != null && (
        <div className="controls-row">
          <button
            className="primary"
            onClick={() => void rescan()}
            disabled={parsing}
          >
            ↻ 前回のフォルダ
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            {(savedHandle as any).name
              ? ` (${(savedHandle as any).name})`
              : ""}
            を再解析
          </button>
          <button className="ghost" onClick={forgetHandle}>
            フォルダを忘れる
          </button>
        </div>
      )}

      {parsing && progress && (
        <div className="progress">
          解析中… {progress.filesDone}/{progress.filesTotal} ファイル (
          {progress.linesParsed.toLocaleString()} 行)
        </div>
      )}
      {!parsing && files.length > 0 && progress && (
        <div className="progress">
          {progress.filesTotal} ファイル / {progress.linesParsed.toLocaleString()}{" "}
          行を解析しました
          {progress.errors > 0 && ` (${progress.errors} 行スキップ)`}
        </div>
      )}

      {notice && (
        <div
          className="progress"
          style={{
            color:
              notice.kind === "error" ? "var(--series-2)" : "var(--good-text)",
          }}
        >
          {notice.text}
        </div>
      )}

      {summary && outgoing && view && (
        <>
          <details className="card exclude-panel">
            <summary>
              共有・エクスポートから除外する項目を選ぶ
              {excluded.size > 0 && (
                <span className="exclude-count">{excluded.size} 項目を除外中</span>
              )}
            </summary>
            <p className="card-desc">
              チェックを外した項目は共有・エクスポートに含まれません(下のダッシュボード表示には影響しません)。
              設定はこのブラウザに記憶され、再解析・再共有後も維持されます。
            </p>
            {EXCLUDABLE_CATEGORIES.map(([category, label]) => {
              const items = Object.keys(summary[category] ?? {});
              if (items.length === 0) return null;
              return (
                <div key={category} className="exclude-group">
                  <div className="exclude-group-label">{label}</div>
                  <div className="exclude-items">
                    {items.map((item) => {
                      const key = exKey(category, item);
                      return (
                        <label key={item} className="exclude-item">
                          <input
                            type="checkbox"
                            checked={!excluded.has(key)}
                            onChange={() => toggleExcluded(key)}
                          />
                          {item}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </details>

          <div className="controls-row">
            <input
              type="text"
              placeholder="表示名 (例: username)"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setShareState("idle");
              }}
            />
            <button
              className={CAN_SHARE ? "ghost" : "primary"}
              onClick={() =>
                downloadJson(
                  outgoing,
                  `claude-usage-${name.trim() || "no-name"}.json`,
                )
              }
            >
              サマリーJSONをエクスポート
            </button>
            {CAN_SHARE && (
              <button
                className="primary"
                disabled={!name.trim() || shareState === "sending"}
                onClick={share}
                title={!name.trim() ? "表示名を入力してください" : undefined}
              >
                {shareState === "sending" ? "送信中…" : "チームに共有"}
              </button>
            )}
            <button
              className="ghost"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview
                ? "内容を閉じる"
                : CAN_SHARE
                  ? "送信内容を確認"
                  : "出力内容を確認"}
            </button>
            <span className="empty-note">
              {excluded.size > 0 && `${excluded.size} 項目を除外して`}
              集計値のみが{CAN_SHARE ? "共有" : "出力"}されます(会話・パス・コードは含まれません)
            </span>
          </div>

          <div className="controls-row">
            <button
              className="ghost"
              onClick={() => statsInputRef.current?.click()}
            >
              過去履歴を追加 (stats-cache.json)
            </button>
            <input
              ref={statsInputRef}
              className="backfill-input"
              type="file"
              hidden
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onStatsFile(f);
                e.target.value = "";
              }}
            />
            <span className="empty-note">
              ~/.claude/stats-cache.json
              を選ぶと、トランスクリプト削除済み期間の日別アクティビティを取り込めます
            </span>
          </div>

          {showPreview && (
            <div className="card">
              <h2>{CAN_SHARE ? "送信" : "出力"}されるJSON(これがすべてです)</h2>
              <p className="card-desc">
                {CAN_SHARE ? "「チームに共有」で送信" : "エクスポートで出力"}
                されるのはこの内容だけです。会話本文・ファイルパス・コード・
                セッションIDが含まれていないことを確認できます(
                {(JSON.stringify(outgoing).length / 1024).toFixed(1)} KB)。
                {CAN_SHARE &&
                  " サーバー保存時には、過去に共有済みの内容(既にサーバーにあるデータ)と日付単位でマージされます。"}
              </p>
              <pre className="preview-json">
                {JSON.stringify(outgoing, null, 2)}
              </pre>
            </div>
          )}
          {shareState === "done" && (
            <div className="progress" style={{ color: "var(--good-text)" }}>
              共有しました。「チーム集計」タブに反映されます(過去の共有分とは日付単位でマージされ、履歴は蓄積されます)。
            </div>
          )}
          {shareState === "error" && (
            <div className="progress" style={{ color: "var(--series-2)" }}>
              共有に失敗しました: {shareError}
            </div>
          )}

          <div className="controls-row">
            <div className="tabs" style={{ margin: 0, borderBottom: "none" }}>
              {PERIOD_LABEL.map(([p, label]) => (
                <button
                  key={String(p)}
                  className={p === period ? "active" : ""}
                  onClick={() => setPeriod(p)}
                >
                  {label}
                </button>
              ))}
            </div>
            {cutoff && (
              <span className="empty-note">
                表示のみに適用されます(共有・エクスポートは常に全期間)
              </span>
            )}
          </div>

          <div className="tile-row">
            <StatTile
              label="セッション数"
              info="Claude Codeの起動から終了までを1セッションと数えます"
              value={view.activity.sessions}
              sub={
                cutoff
                  ? `${cutoff} 以降`
                  : `${summary.period.from ?? "?"} 〜 ${summary.period.to ?? "?"}`
              }
            />
            <StatTile
              label="スキル利用回数"
              info="スキル(手順書をパッケージ化した拡張機能)を呼び出した回数。/コマンドやSkillツール経由の実行が数えられます"
              value={sumOf(view.skills)}
              sub={`${Object.keys(view.skills).length} 種類`}
            />
            <StatTile
              label="スキル利用セッション率"
              info="スキルを1回以上使ったセッションの割合。素のチャットだけでなく機能を活用できているかの「質」の指標です"
              value={`${view.skillRate}%`}
              sub={`${view.skillRateNum} / ${view.skillRateDen} セッション`}
            />
            <StatTile
              label="サブエージェント起動"
              info="調査・レビューなどを子エージェントに委任した回数。使いこなすと作業を並列化できます"
              value={sumOf(view.subagents)}
              sub={
                cutoff ? undefined : `${summary.sessionsWithSubagent} セッションで利用`
              }
            />
            <StatTile
              label="活用機能の種類"
              info="一度でも使ったことのあるスキル+サブエージェント+MCPツールの種類数。活用の幅を表します"
              value={view.distinctFeatures}
              sub="スキル+サブエージェント+MCP"
            />
            <StatTile
              label={`Web検索 / フェッチ${allTime}`}
              info="WebSearch(検索)/WebFetch(ページ取得)ツールの呼び出し回数"
              value={`${(summary.tools.WebSearch ?? 0).toLocaleString()} / ${(summary.tools.WebFetch ?? 0).toLocaleString()}`}
              sub="ツール呼び出し回数"
            />
          </div>

          <div className="card">
            <h2>自分の成長トレンド<InfoTip text="週(月曜始まり)ごとの推移。上=スキルを使ったセッションの割合、下=その週に使った機能の種類数。右肩上がりなら使い方が広がっています" /></h2>
            <p className="card-desc">
              週ごとの「使い方の質」の推移。他人ではなく先週の自分と比べましょう(期間フィルタの影響を受けません)
            </p>
            <GrowthChart points={trend} />
          </div>

          <div className="card-grid">
            <div className="card">
              <h2>スキル利用<InfoTip text="スキル=作業手順をパッケージ化した拡張機能(例: コードレビュー用チェックリスト)。チーム独自に作って共有できます" /></h2>
              <p className="card-desc">Skillツール呼び出しの内訳</p>
              <BarList data={view.skills} />
            </div>
            <div className="card">
              <h2>スラッシュコマンド<InfoTip text="チャット欄で実行する /clear や /model などのコマンド。プラグインのコマンドも含みます" /></h2>
              <p className="card-desc">実行したコマンドの内訳</p>
              <BarList data={view.slashCommands} color="var(--series-2)" />
            </div>
            <div className="card">
              <h2>サブエージェント<InfoTip text="メインの会話とは別に起動される子エージェント。調査・レビューなどを委任でき、種類(subagent_type)別に集計しています" /></h2>
              <p className="card-desc">subagent_type別の起動回数</p>
              <BarList data={view.subagents} color="var(--series-3)" />
            </div>
            <div className="card">
              <h2>MCPツール<InfoTip text="MCP(Model Context Protocol)サーバー経由で使う外部ツール(ブラウザ操作・Figma連携など)。server/tool形式で表示" /></h2>
              <p className="card-desc">server/tool別の呼び出し回数</p>
              <BarList data={view.mcpTools} color="var(--series-4)" />
            </div>
            <div className="card">
              <h2>プラグイン<InfoTip text="配布パッケージ(プラグイン)経由のスキル/コマンド実行回数。名前のプレフィックス(figma: など)から集計しています" /></h2>
              <p className="card-desc">
                プラグイン由来のスキル/コマンド実行回数
              </p>
              <BarList data={view.plugins} />
            </div>
            <div className="card">
              <h2>モード利用{allTime}<InfoTip text="plan=実装前に計画を立てるモード。権限モードはツール実行の許可方式で、auto=自動許可、bypassPermissions=確認なし、など" /></h2>
              <p className="card-desc">モードを使ったセッション数</p>
              <BarList data={summary.modes ?? {}} color="var(--series-2)" />
              <p className="card-desc" style={{ margin: "12px 0 8px" }}>
                権限モード別セッション数
              </p>
              <BarList
                data={summary.permissionModes ?? {}}
                color="var(--series-3)"
              />
            </div>
            <div className="card">
              <h2>セッション長の分布{allTime}<InfoTip text="1セッションでアシスタントが返したメッセージ数の分布。長いセッションほど大きなタスクを任せている傾向です" /></h2>
              <p className="card-desc">
                1セッションあたりのアシスタントメッセージ数
              </p>
              <BarList
                data={summary.sessionLengthBuckets ?? {}}
                keepOrder
                color="var(--series-4)"
              />
            </div>
            <div className="card">
              <h2>利用環境{allTime}<InfoTip text="起動元の内訳。cli=ターミナル、vscode=エディタ拡張、sdk-cli=SDK経由など" /></h2>
              <p className="card-desc">エントリポイント別セッション数</p>
              <BarList data={summary.entrypoints ?? {}} />
            </div>
          </div>

          <div className="card">
            <h2>日別アクティビティ</h2>
            <DailyCharts data={view.daily} />
          </div>

          <div className="card">
            <h2>モデル別トークン{allTime}</h2>
            <TokenChart
              rows={Object.entries(summary.tokensByModel).map(
                ([label, tokens]) => ({ label, tokens }),
              )}
            />
          </div>

          <div className="card">
            <h2>組み込みツールの使い分け{allTime}<InfoTip text="Read(ファイル閲覧)・Edit(編集)・Bash(コマンド実行)などClaude Code標準ツールの呼び出し回数" /></h2>
            <p className="card-desc">Read/Edit/Bash などツール名別の呼び出し回数</p>
            <BarList data={summary.tools} limit={15} />
          </div>
        </>
      )}
    </div>
  );
}
