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
import { buildOutgoing, buildSharePayload } from "../lib/share";
import { mergeSummaries } from "../lib/merge";
import { isStatsCacheFile, parseStatsCacheFile } from "../lib/statsCache";
import type { ExcludableCategory } from "../lib/exclude";
import { exKey } from "../lib/exclude";
import type { DateRange, Period } from "../lib/teamStats";
import {
  activityIn,
  delegationRate,
  featureCounts,
  inRange,
  periodRange,
  skillRateParts,
  sumOf,
} from "../lib/teamStats";
import { costInRange, formatUsd, loadRates, saveRates } from "../lib/pricing";
import type { ModelRate } from "../lib/pricing";
import type {
  SessionDetail,
  SessionIndex,
  SessionMeta,
} from "../lib/sessionDetail";
import { buildSessionIndex, parseSessionDetail } from "../lib/sessionDetail";
import { PeriodFilter } from "./PeriodFilter";
import { weeklyTrend } from "../lib/trend";
import { Dropzone } from "./Dropzone";
import { ShareModal } from "./ShareModal";
import { InfoTip } from "./InfoTip";
import { StatTile } from "./StatTile";
import { BarList } from "./BarList";
import { RatesEditor } from "./RatesEditor";
import { ToolErrorTable } from "./ToolErrorTable";
import { Modal } from "./Modal";
import { SessionList } from "./SessionList";
import { SessionTimeline } from "./SessionTimeline";
import {
  DailyCharts,
  GrowthChart,
  TokenChart,
  TokenTrendChart,
} from "./ChartsLazy";

const NAME_KEY = "claude-graph:name";
const EXCLUDED_KEY = "claude-graph:excluded";
const INCLUDED_REPOS_KEY = "claude-graph:includedRepos";

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
  // リポジトリはopt-in(誤って機密リポジトリを含めないよう、明示的に選んだものだけ共有)。
  // 選択は記憶するが、新しく現れたリポジトリは安全側でOFFのまま。
  const [includedRepos, setIncludedRepos] = useState<Set<string>>(() => {
    try {
      return new Set<string>(
        JSON.parse(localStorage.getItem(INCLUDED_REPOS_KEY) ?? "[]"),
      );
    } catch {
      return new Set();
    }
  });
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
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
  // 概算コストの単価(このブラウザにのみ保存。共有されない)
  const [rates, setRates] = useState<Record<string, ModelRate>>(loadRates);
  const updateRates = (r: Record<string, ModelRate>) => {
    setRates(r);
    saveRates(r);
  };
  // セッション詳細(ローカル閲覧のみ。共有・エクスポートとは別系統)
  const [sessionIndex, setSessionIndex] = useState<SessionIndex | null>(null);
  const [openedSession, setOpenedSession] = useState<{
    meta: SessionMeta;
    detail: SessionDetail;
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const openSession = async (meta: SessionMeta) => {
    setDetailLoading(true);
    try {
      const detail = await parseSessionDetail(
        meta,
        sessionIndex?.subagentFiles.get(meta.sessionId) ?? [],
      );
      setOpenedSession({ meta, detail });
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    localStorage.setItem(NAME_KEY, name.trim());
  }, [name]);

  useEffect(() => {
    localStorage.setItem(EXCLUDED_KEY, JSON.stringify([...excluded]));
  }, [excluded]);

  useEffect(() => {
    localStorage.setItem(
      INCLUDED_REPOS_KEY,
      JSON.stringify([...includedRepos]),
    );
  }, [includedRepos]);

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
    // stats-cache.json 単体のドロップ: 解析済みならバックフィル、未解析なら案内
    if (jsonl.length === 0) {
      if (!statsFile) return;
      if (summary) {
        await onStatsFile(statsFile);
      } else {
        setNotice({
          kind: "error",
          text: "stats-cache.json を受け取りましたが、先にトランスクリプト(~/.claude/projects)を読み込んでください。~/.claude フォルダごとドラッグすれば両方を一度に取り込めます。",
        });
      }
      return;
    }
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
      // セッション詳細用のインデックスは裏で作る(失敗しても解析自体は成立)
      setSessionIndex(null);
      buildSessionIndex(jsonl).then(setSessionIndex, () => {});
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

  const allRepos = summary ? Object.keys(summary.repos ?? {}) : [];

  // 出力内容(除外+リポジトリopt-in適用済み)。ロジックはlib/share.tsに集約
  const outgoing = summary
    ? buildOutgoing(summary, name.trim() || "no-name", excluded, includedRepos)
    : null;

  const toggleRepo = (repo: string) => {
    setIncludedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(repo)) next.delete(repo);
      else next.add(repo);
      return next;
    });
    setShareState("idle");
  };

  const selectedRepoCount = allRepos.filter((r) =>
    includedRepos.has(r),
  ).length;
  // リポジトリがあるのに1つも選んでいない = 共有・出力を止める(誤爆防止)
  const repoGateBlocked = allRepos.length > 0 && selectedRepoCount === 0;

  const share = async () => {
    if (!outgoing || !summary || !name.trim()) return;
    // 誤爆防止: リポジトリがあるのに1つも選んでいなければ共有しない(ボタンも無効)
    if (allRepos.length > 0 && selectedRepoCount === 0) return;
    setShareState("sending");
    try {
      // 蓄積: サーバーの保存分と日付マージしてから送る。
      // 除外設定はマージ後の全体に適用する(過去の共有分からも消える)。
      // 取得に失敗した場合は、上書きで履歴を失わないよう中断する。
      const rows = await fetchTeamSummaries();
      const mine = rows.find((r) => r.name === outgoing.name);
      const payload = buildSharePayload(
        summary,
        mine?.data ?? null,
        outgoing.name,
        excluded,
        includedRepos,
      );
      await shareSummary(payload);
      setShareState("done");
      setShareModalOpen(false);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : String(e));
      setShareState("error");
    }
  };

  // 期間フィルタは「表示のみ」に適用する(共有・エクスポートは常に全期間)
  const range: DateRange | null =
    period === "custom"
      ? customFrom || customTo
        ? { from: customFrom || null, to: customTo || null }
        : null
      : periodRange(period);
  const view = useMemo(() => {
    if (!summary) return null;
    const skills = featureCounts(summary, "skills", range);
    const subagents = featureCounts(summary, "subagents", range);
    const mcpTools = featureCounts(summary, "mcpTools", range);
    const activity = activityIn(summary, range);
    const daily = range
      ? summary.dailyActivity.filter((d) => inRange(d.date, range))
      : summary.dailyActivity;
    // スキル利用セッション率(スキル情報を持つ日だけで計算。バックフィル日で希釈させない)
    let { num: skillRateNum, den: skillRateDen } = skillRateParts(summary);
    if (range) {
      const days = daily.filter((d) => typeof d.skillSessions === "number");
      skillRateDen = days.reduce((s, d) => s + d.sessions, 0);
      skillRateNum = days.reduce((s, d) => s + (d.skillSessions ?? 0), 0);
    }
    return {
      skills,
      subagents,
      mcpTools,
      slashCommands: featureCounts(summary, "slashCommands", range),
      plugins: featureCounts(summary, "plugins", range),
      repos: featureCounts(summary, "repos", range),
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
  }, [summary, range]);

  const trend = useMemo(
    () => (summary ? weeklyTrend(summary) : []),
    [summary],
  );

  const delegation = summary ? delegationRate(summary, range) : null;
  const cost = useMemo(
    () => (summary ? costInRange(summary, range, rates) : null),
    [summary, range, rates],
  );

  const allTime = range ? " (全期間)" : "";

  // カテゴリ内の全項目を一括で含める/除外する
  const setCategoryExcluded = (
    category: ExcludableCategory,
    exclude: boolean,
  ) => {
    const items = Object.keys(summary?.[category] ?? {});
    setExcluded((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        const key = exKey(category, item);
        if (exclude) next.add(key);
        else next.delete(key);
      }
      return next;
    });
    setShareState("idle");
  };

  return (
    <div>
      <Dropzone onFiles={onFiles} onHandle={rememberHandle} directory>
        <div>
          <strong>~/.claude/projects/</strong> フォルダを選択、またはドラッグ&ドロップ
        </div>
        <div className="hint">
          .jsonl ファイルをブラウザ内でパースします。データが外部に送信されることはありません。
          <br />
          隠しフォルダ(.claude)が選択ダイアログに表示されない場合は、Macでは{" "}
          <kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd>{" "}
          で表示できます。Finderから直接ドラッグ&ドロップでもOKです。
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
          <div className="controls-row">
            <button
              className="primary"
              onClick={() => {
                setShareState("idle");
                setShareModalOpen(true);
              }}
            >
              {CAN_SHARE ? "チームに共有…" : "サマリーJSONをエクスポート…"}
            </button>
            <span className="empty-note">
              {allRepos.length > 0 &&
                `リポジトリ ${selectedRepoCount}/${allRepos.length} 選択・`}
              {excluded.size > 0 && `${excluded.size} 項目を除外・`}
              対象は次の画面で選べます(集計値のみ・会話やパスは含まれません)
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
              で、トランスクリプト削除済み期間の日別アクティビティを取り込めます。上のドロップゾーンへの
              ドラッグ&ドロップでもOK(隠しフォルダは Cmd+Shift+. で表示)
            </span>
          </div>

          {shareState === "done" && (
            <div className="progress" style={{ color: "var(--good-text)" }}>
              共有しました。「チーム集計」タブに反映されます(過去の共有分とは日付単位でマージされ、履歴は蓄積されます)。
            </div>
          )}

          <div className="controls-row">
            <PeriodFilter
              period={period}
              onPeriodChange={setPeriod}
              from={customFrom}
              to={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
            />
            {range && (
              <span className="empty-note">
                表示のみに適用されます(共有・エクスポートは常に全期間)
              </span>
            )}
          </div>

          <div className="tile-row">
            <StatTile
              label="セッション数"
              info="Claude Codeの起動から終了までを1セッションと数えます。バックフィルや再共有で蓄積したデータでは日別合計になるため、日をまたぐセッションが重複計上されることがあります"
              value={view.activity.sessions}
              sub={
                range
                  ? `${range.from ?? "…"} 〜 ${range.to ?? "…"}`
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
                range ? undefined : `${summary.sessionsWithSubagent} セッションで利用`
              }
            />
            <StatTile
              label="委任度"
              info="全アシスタントメッセージのうち、サブエージェント(サイドチェーン)側で処理された割合。高いほど作業を子エージェントに任せて並列化できています"
              value={delegation === null ? "–" : `${delegation}%`}
              sub="サブエージェント側の処理比率"
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
              <h2>リポジトリ<InfoTip text="どのリポジトリでどれだけ使ったか(数値=アシスタントメッセージ数)。名前はディレクトリ名のみで、フルパスは含まれません。共有したくないリポジトリは除外パネルでチェックを外せます" /></h2>
              <p className="card-desc">リポジトリ別のアクティビティ</p>
              <BarList data={view.repos} color="var(--series-2)" />
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
            <div className="card">
              <h2>セッション実時間の分布{allTime}<InfoTip text="セッションの最初の記録から最後の記録までの経過時間の分布。放置していた時間も含むため、正確な作業時間ではなく「セッションを開きっぱなしにする長さ」の傾向です" /></h2>
              <p className="card-desc">最初〜最後の記録の経過時間</p>
              <BarList
                data={summary.sessionDurationBuckets ?? {}}
                keepOrder
                color="var(--series-3)"
              />
            </div>
            <div className="card">
              <h2>推論エフォート{allTime}<InfoTip text="モデルの思考の深さ設定(low/medium/high/xhigh/max)別のアシスタントメッセージ数。/model コマンド等で切り替えられます。記録のない古いバージョンの分は含まれません" /></h2>
              <p className="card-desc">エフォート別メッセージ数</p>
              <BarList data={summary.efforts ?? {}} color="var(--series-4)" />
            </div>
            <div className="card">
              <h2>ツール失敗率{allTime}<InfoTip text="ツール実行がエラー(is_error)になった回数と割合。Bashのコマンド失敗なども含むため、0にするものではなく「異常に高いツールがないか」を見る指標です。エラー内容は収集していません" /></h2>
              <p className="card-desc">失敗回数の多いツール</p>
              <ToolErrorTable
                toolErrors={summary.toolErrors ?? {}}
                toolCalls={{ ...summary.tools, ...summary.mcpTools }}
              />
            </div>
          </div>

          <div className="card">
            <h2>日別アクティビティ</h2>
            <DailyCharts data={view.daily} />
          </div>

          <div className="card">
            <h2>トークンの日別推移</h2>
            <TokenTrendChart dailyTokens={summary.dailyTokens ?? {}} range={range} />
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
            <h2>概算コスト<InfoTip text="トークン使用量に公式API単価を掛けたAPI従量課金換算の概算です。サブスクリプション(Pro/Max)利用時の実際の支払額ではありません。単価は下の「単価を編集」から変更でき、このブラウザにのみ保存されます" /></h2>
            <p className="card-desc">
              API従量課金に換算した場合の金額(実際の請求額ではありません)
            </p>
            {cost && (
              <>
                <div
                  style={{
                    fontSize: 32,
                    fontWeight: 600,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {formatUsd(cost.usd)}
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 400,
                      color: "var(--text-secondary)",
                      marginLeft: 8,
                    }}
                  >
                    {range ? "選択期間" : "全期間"}
                  </span>
                </div>
                {cost.unknownModels.length > 0 && (
                  <p className="empty-note">
                    単価未設定のモデルを除く: {cost.unknownModels.join(", ")}
                  </p>
                )}
                <RatesEditor
                  rates={rates}
                  usedModels={Object.keys(summary.tokensByModel)}
                  onChange={updateRates}
                />
              </>
            )}
          </div>

          <div className="card">
            <h2>組み込みツールの使い分け{allTime}<InfoTip text="Read(ファイル閲覧)・Edit(編集)・Bash(コマンド実行)などClaude Code標準ツールの呼び出し回数" /></h2>
            <p className="card-desc">Read/Edit/Bash などツール名別の呼び出し回数</p>
            <BarList data={summary.tools} limit={15} />
          </div>

          <div className="card">
            <h2>セッション詳細<InfoTip text="セッションを選ぶと、プロンプト→スキル読込→エージェント起動→ツール実行の流れをOpenTelemetryのトレースビュー風に表示します。この画面はこのブラウザでの閲覧専用で、チーム共有・エクスポートには一切含まれません" /></h2>
            <p className="card-desc">
              クリックでそのセッションのタイムラインを表示(ローカル閲覧のみ・共有されません)
            </p>
            {sessionIndex ? (
              <SessionList
                sessions={sessionIndex.sessions}
                onOpen={(m) => void openSession(m)}
              />
            ) : (
              <div className="empty-note">セッション一覧を作成中…</div>
            )}
            {detailLoading && (
              <div className="progress">タイムラインを読み込み中…</div>
            )}
          </div>
        </>
      )}

      {openedSession && (
        <Modal
          title={
            openedSession.meta.title ??
            `セッション ${openedSession.meta.sessionId.slice(0, 8)}…`
          }
          onClose={() => setOpenedSession(null)}
        >
          <SessionTimeline detail={openedSession.detail} />
        </Modal>
      )}

      {shareModalOpen && summary && outgoing && (
        <ShareModal
          canShare={CAN_SHARE}
          summary={summary}
          outgoing={outgoing}
          name={name}
          onNameChange={(v) => {
            setName(v);
            setShareState("idle");
          }}
          excluded={excluded}
          onToggleExcluded={toggleExcluded}
          onSetCategoryExcluded={setCategoryExcluded}
          includedRepos={includedRepos}
          onToggleRepo={toggleRepo}
          onSetRepos={(repos) => {
            setIncludedRepos(repos);
            setShareState("idle");
          }}
          repoGateBlocked={repoGateBlocked}
          shareState={shareState}
          shareError={shareError}
          onShare={() => void share()}
          onExport={() => {
            downloadJson(
              outgoing,
              `claude-usage-${name.trim() || "no-name"}.json`,
            );
            if (!CAN_SHARE) setShareModalOpen(false);
          }}
          onClose={() => setShareModalOpen(false)}
        />
      )}
    </div>
  );
}
