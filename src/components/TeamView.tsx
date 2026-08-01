import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureCategory, UsageSummary } from "../lib/types";
import { IS_CLOUD } from "../lib/config";
import {
  deleteSummary,
  fetchTeamSummaries,
  removeSummaryItem,
} from "../lib/api";
import type { DateRange, Period } from "../lib/teamStats";
import {
  activityIn,
  delegationRate,
  diversity,
  featureCounts,
  periodRange,
  repoNames,
  skillRate,
  sumOf,
  totalTokens,
} from "../lib/teamStats";
import { costInRange, formatUsd, loadRates, saveRates } from "../lib/pricing";
import type { ModelRate } from "../lib/pricing";
import { PeriodFilter } from "./PeriodFilter";
import { getHashParam, setHashParams } from "../lib/urlState";
import { Dropzone } from "./Dropzone";
import { StatTile } from "./StatTile";
import { InfoTip } from "./InfoTip";
import { BarList } from "./BarList";
import { CompareCard } from "./CompareCard";
import { RecommendCard } from "./RecommendCard";
import { AskWhoCard } from "./AskWhoCard";
import { TeamHeatmap } from "./TeamHeatmap";
import { RatesEditor } from "./RatesEditor";
import { TeamDailyChart, TeamModelChart, TokenChart } from "./ChartsLazy";

// 集計はtypes.tsの共有定数を使う(表示順が異なるだけの別リストを作らない)
import { FEATURE_CATEGORIES } from "../lib/types";

function readSummaries(files: File[]): Promise<UsageSummary[]> {
  return Promise.all(
    files.map(async (f) => {
      const data = JSON.parse(await f.text());
      if (data?.schemaVersion !== 1 || typeof data?.name !== "string") {
        throw new Error(`${f.name} はサマリーJSONではありません`);
      }
      return data as UsageSummary;
    }),
  );
}

export function TeamView() {
  const [members, setMembers] = useState<UsageSummary[]>([]);
  // ヒートマップ群の共通コントロール(全カテゴリに効く)
  const [editMode, setEditMode] = useState(false);
  const [query, setQuery] = useState("");
  // 表示状態はURLハッシュから復元し、変更時に書き戻す(リンクで共有できるように)
  const [period, setPeriod] = useState<Period>(() => {
    const p = getHashParam("period");
    if (p === "30") return 30;
    if (p === "7") return 7;
    if (p === "custom") return "custom";
    return "all";
  });
  const [customFrom, setCustomFrom] = useState(
    () => getHashParam("from") ?? "",
  );
  const [customTo, setCustomTo] = useState(() => getHashParam("to") ?? "");
  const [compareTarget, setCompareTarget] = useState<string>(
    () => getHashParam("target") ?? "",
  );
  // リポジトリフィルタ: 基本は横断表示、選ぶと全指標がそのリポジトリ内に絞られる
  const [repoFilter, setRepoFilter] = useState<string>(
    () => getHashParam("repo") ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHashParams({
      category: null, // 旧バージョンのURL互換のため掃除だけする
      period: period === "all" ? null : String(period),
      from: period === "custom" && customFrom ? customFrom : null,
      to: period === "custom" && customTo ? customTo : null,
      target: compareTarget || null,
      repo: repoFilter || null,
    });
  }, [period, customFrom, customTo, compareTarget, repoFilter]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Map<string, string>>(new Map());
  // 概算コストの単価(このブラウザにのみ保存。共有されない)
  const [rates, setRates] = useState<Record<string, ModelRate>>(loadRates);
  const updateRates = (r: Record<string, ModelRate>) => {
    setRates(r);
    saveRates(r);
  };

  const loadFromServer = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchTeamSummaries();
      setMembers(rows.map((r) => ({ ...r.data, name: r.name })));
      setUpdatedAt(new Map(rows.map((r) => [r.name, r.updatedAt])));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (IS_CLOUD) void loadFromServer();
  }, [loadFromServer]);

  // アップロード後の個別項目削除(クラウド版): サーバーのdataから該当キーを消す
  const removeItem = useCallback(
    async (category: FeatureCategory, memberName: string, feature: string) => {
      if (
        !window.confirm(
          `${memberName} の「${feature}」をサーバーから削除しますか?`,
        )
      )
        return;
      try {
        await removeSummaryItem(memberName, category, feature);
        // dailyRepos等のネスト構造も含めた整合はサーバー側で取れているので再読込する
        await loadFromServer();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadFromServer],
  );

  const removeMember = async (name: string) => {
    if (IS_CLOUD) {
      if (!window.confirm(`${name} のデータをサーバーから削除しますか?`))
        return;
      try {
        await deleteSummary(name);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    setMembers((prev) => prev.filter((x) => x.name !== name));
  };

  const onFiles = async (files: File[]) => {
    setError(null);
    try {
      const parsed = await readSummaries(
        files.filter((f) => f.name.endsWith(".json")),
      );
      setMembers((prev) => {
        // 同名メンバーは新しい方で置き換える
        const byName = new Map(prev.map((m) => [m.name, m]));
        for (const m of parsed) byName.set(m.name, m);
        return [...byName.values()];
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const range: DateRange | null =
    period === "custom"
      ? customFrom || customTo
        ? { from: customFrom || null, to: customTo || null }
        : null
      : periodRange(period);
  const repos = useMemo(() => repoNames(members), [members]);
  const repo = repoFilter && repos.includes(repoFilter) ? repoFilter : null;
  const legacyNames = range
    ? members.filter((m) => !m.dailyFeatures).map((m) => m.name)
    : [];
  const noRepoNames = repo
    ? members.filter((m) => !m.dailyRepos).map((m) => m.name)
    : [];

  // 期間を適用した全カテゴリの集計はレンダーごとに再計算しない
  const countsByCat = useMemo(() => {
    const map = new Map<
      FeatureCategory,
      Map<string, Record<string, number>>
    >();
    for (const cat of FEATURE_CATEGORIES) {
      map.set(
        cat,
        new Map(
          members.map(
            (m) => [m.name, featureCounts(m, cat, range, repo)] as const,
          ),
        ),
      );
    }
    return map;
  }, [members, range, repo]);
  const skillCountsOf = countsByCat.get("skills")!;
  const activityOf = useMemo(
    () =>
      new Map(
        members.map((m) => [m.name, activityIn(m, range, repo)] as const),
      ),
    [members, range, repo],
  );
  // 日別比較チャート用: リポジトリフィルタ時はdailyReposから日別系列を組み立てる
  const membersForDaily = useMemo(() => {
    if (!repo) return members;
    return members.map((m) => ({
      name: m.name,
      dailyActivity: Object.entries(m.dailyRepos ?? {})
        .filter(([, repoMap]) => repoMap[repo])
        .map(([date, repoMap]) => ({
          date,
          sessions: repoMap[repo].sessions,
          messages: repoMap[repo].messages,
          toolCalls: repoMap[repo].toolCalls,
        }))
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    }));
  }, [members, repo]);

  const target =
    members.find((m) => m.name === compareTarget) ?? members[0] ?? null;

  return (
    <div>
      {IS_CLOUD ? (
        <div className="controls-row">
          <button className="ghost" onClick={loadFromServer} disabled={loading}>
            {loading ? "読み込み中…" : "↻ サーバーから再読み込み"}
          </button>
          <span className="empty-note">
            「個人解析」タブで共有されたメンバーのサマリーを表示しています
          </span>
        </div>
      ) : (
        <Dropzone onFiles={onFiles} accept=".json">
          <div>
            メンバーのサマリーJSONを選択、またはドラッグ&ドロップ(複数可)
          </div>
          <div className="hint">
            「個人解析」タブでエクスポートしたJSONを集めて読み込みます
          </div>
        </Dropzone>
      )}

      {IS_CLOUD && !loading && members.length === 0 && !error && (
        <div className="progress">
          まだ誰も共有していません。「個人解析」タブから共有してください。
        </div>
      )}

      {error && (
        <div className="progress" style={{ color: "var(--series-2)" }}>
          {error}
        </div>
      )}

      {members.length > 0 && (
        <>
          <div className="controls-row">
            <PeriodFilter
              period={period}
              onPeriodChange={setPeriod}
              from={customFrom}
              to={customTo}
              onFromChange={setCustomFrom}
              onToChange={setCustomTo}
            />
            {repos.length > 0 && (
              <select
                className="member-select"
                value={repo ?? ""}
                onChange={(e) => setRepoFilter(e.target.value)}
                title="リポジトリで絞り込み(全指標に適用)"
              >
                <option value="">全リポジトリ</option>
                {repos.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            )}
            <div className="member-list">
              {members.map((m) => (
                <span
                  className="member-chip"
                  key={m.name}
                  title={
                    updatedAt.get(m.name)
                      ? `最終共有: ${new Date(
                          updatedAt.get(m.name)!,
                        ).toLocaleString()}`
                      : undefined
                  }
                >
                  {m.name}
                  <button
                    aria-label={`${m.name} を除外`}
                    onClick={() => void removeMember(m.name)}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>

          {noRepoNames.length > 0 && (
            <div className="progress">
              ※ {noRepoNames.join(", ")}{" "}
              はリポジトリ情報のない旧形式のため、このフィルタでは0件になります(再共有で対応)
            </div>
          )}

          {legacyNames.length > 0 && (
            <div className="progress">
              ※ {legacyNames.join(", ")}{" "}
              は旧形式のサマリーのため、機能利用は全期間の値で表示しています(再共有すると期間対応になります)
            </div>
          )}

          <div className="tile-row">
            <StatTile label="メンバー" value={members.length} />
            <StatTile
              label="合計セッション"
              info="メンバー全員のセッション数合計。蓄積データは日別合計のため、日をまたぐセッションが重複計上されることがあります"
              value={members.reduce(
                (s, m) => s + activityOf.get(m.name)!.sessions,
                0,
              )}
            />
            <StatTile
              label="チームのスキル利用回数"
              value={members.reduce(
                (s, m) => s + sumOf(skillCountsOf.get(m.name)!),
                0,
              )}
            />
            <StatTile
              label="登場したスキル種類"
              value={
                new Set(
                  members.flatMap((m) =>
                    Object.keys(skillCountsOf.get(m.name)!),
                  ),
                ).size
              }
            />
          </div>

          {target && (
            <CompareCard
              members={members}
              target={target}
              onTargetChange={setCompareTarget}
              range={range}
              repo={repo}
            />
          )}

          {target && <RecommendCard members={members} target={target} />}

          <div className="controls-row" style={{ marginTop: 8 }}>
            <input
              type="text"
              className="hm-filter"
              placeholder="機能名で絞り込み(全カテゴリ)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {IS_CLOUD && (
              <button
                className={editMode ? "primary" : "ghost"}
                onClick={() => setEditMode((v) => !v)}
              >
                {editMode ? "削除モードを終了" : "項目を削除する…"}
              </button>
            )}
            <span className="empty-note">
              空欄は未利用 = その人に布教するチャンス。
              {editMode && " 削除モード中: 数値セルのクリックでサーバーから削除します。"}
            </span>
          </div>

          <TeamHeatmap
            members={members}
            category="skills"
            counts={countsByCat.get("skills")!}
            highlightName={target?.name}
            editMode={editMode}
            query={query}
            limit={15}
            onRemoveItem={(name, feature) =>
              void removeItem("skills", name, feature)
            }
          />
          {/* メンバー列の一覧性を優先し、カテゴリ別も常に全幅の縦積みで表示する */}
          <div>
            {(
              ["repos", "subagents", "mcpTools", "slashCommands", "plugins"] as const
            ).map((cat) => (
              <TeamHeatmap
                key={cat}
                members={members}
                category={cat}
                counts={countsByCat.get(cat)!}
                highlightName={target?.name}
                editMode={editMode}
                query={query}
                onRemoveItem={(name, feature) =>
                  void removeItem(cat, name, feature)
                }
              />
            ))}
          </div>

          <AskWhoCard members={members} />

          <div className="card">
            <h2>日別アクティビティ比較<InfoTip text="メンバーごとの1日あたりアシスタントメッセージ数。線の色はメンバーに固定です" /></h2>
            <p className="card-desc">
              メンバーごとのアシスタントメッセージ数/日
            </p>
            <TeamDailyChart members={membersForDaily} range={range} />
          </div>

          <div className="card-grid cols-2">
            <div className="card">
              <h2>スキル利用回数<InfoTip text="スキル(手順書をパッケージ化した拡張機能)の呼び出し合計" /></h2>
              <p className="card-desc">
                {range ? "期間内の" : ""}スキル呼び出し合計
              </p>
              <BarList
                data={Object.fromEntries(
                  members.map((m) => [
                    m.name,
                    sumOf(skillCountsOf.get(m.name)!),
                  ]),
                )}
                color="var(--series-2)"
              />
            </div>
            <div className="card">
              <h2>スキル利用セッション率{range ? " (全期間)" : ""}<InfoTip text="スキルを1回以上使ったセッションの割合。素のチャットだけでなく機能を活用できているかの「質」の指標" /></h2>
              <p className="card-desc">
                スキルを1回以上使ったセッションの割合(%)。「質」の指標
              </p>
              <BarList
                data={Object.fromEntries(
                  members.map((m) => [m.name, skillRate(m, repo)]),
                )}
                unit="%"
              />
            </div>
            <div className="card">
              <h2>活用機能の種類数<InfoTip text="使ったことのあるスキル+サブエージェント+MCPツールの種類数。活用の幅を表します" /></h2>
              <p className="card-desc">
                {range ? "期間内に" : ""}
                使ったスキル+サブエージェント+MCPの種類数
              </p>
              <BarList
                data={Object.fromEntries(
                  members.map((m) => [m.name, diversity(m, range, repo)]),
                )}
                color="var(--series-3)"
              />
            </div>
            <div className="card">
              <h2>メンバー別トークン{range ? " (全期間)" : ""}<InfoTip text="トークン=モデルが読み書きした文章量の単位。おおまかな利用量・コストの目安になります" /></h2>
              <p className="card-desc">トークン量の比較(モデル横断の合計)</p>
              <TokenChart
                rows={members.map((m) => ({
                  label: m.name,
                  tokens: totalTokens(m),
                }))}
              />
            </div>
            <div className="card">
              <h2>委任度<InfoTip text="全アシスタントメッセージのうち、サブエージェント(サイドチェーン)側で処理された割合。高いほど作業を子エージェントに任せて並列化できています。古い共有分にはデータがない場合があります" /></h2>
              <p className="card-desc">
                サブエージェント側で処理されたメッセージの割合(%)
              </p>
              <BarList
                data={Object.fromEntries(
                  members
                    .map((m) => [m.name, delegationRate(m, range)] as const)
                    .filter((e): e is [string, number] => e[1] !== null),
                )}
                unit="%"
                color="var(--series-4)"
              />
            </div>
            <div className="card">
              <h2>メンバー別 概算コスト{range ? "" : " (全期間)"}<InfoTip text="トークン使用量に公式API単価を掛けたAPI従量課金換算の概算。サブスクリプション利用時の実際の支払額ではありません。単価は編集でき、このブラウザにのみ保存されます。旧形式の共有分は期間指定では0になります" /></h2>
              <p className="card-desc">
                API従量課金に換算した金額(実際の請求額ではありません)
              </p>
              <BarList
                data={Object.fromEntries(
                  members.map((m) => [
                    m.name,
                    costInRange(m, range, rates).usd,
                  ]),
                )}
                color="var(--series-2)"
                format={formatUsd}
              />
              <RatesEditor
                rates={rates}
                usedModels={[
                  ...new Set(
                    members.flatMap((m) => Object.keys(m.tokensByModel)),
                  ),
                ]}
                onChange={updateRates}
              />
            </div>
          </div>

          <div className="card">
            <h2>モデル × メンバー{range ? " (全期間)" : ""}<InfoTip text="誰がどのモデルをどれだけ使っているかの比較。値は入出力+キャッシュを含む合計トークンです" /></h2>
            <p className="card-desc">メンバーごとの利用モデル内訳(トークン)</p>
            <TeamModelChart
              rows={members.map((m) => ({
                name: m.name,
                tokensByModel: m.tokensByModel,
              }))}
            />
          </div>
        </>
      )}
    </div>
  );
}
