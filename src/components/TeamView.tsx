import { useCallback, useEffect, useMemo, useState } from "react";
import type { FeatureCategory, UsageSummary } from "../lib/types";
import { IS_CLOUD } from "../lib/config";
import {
  deleteSummary,
  fetchTeamSummaries,
  removeSummaryItem,
} from "../lib/api";
import type { Period } from "../lib/teamStats";
import {
  PERIOD_LABEL,
  activityIn,
  cutoffOf,
  diversity,
  featureCounts,
  skillRate,
  sumOf,
  totalTokens,
} from "../lib/teamStats";
import { getHashParam, setHashParams } from "../lib/urlState";
import { Dropzone } from "./Dropzone";
import { StatTile } from "./StatTile";
import { InfoTip } from "./InfoTip";
import { BarList } from "./BarList";
import { CompareCard } from "./CompareCard";
import { RecommendCard } from "./RecommendCard";
import { AskWhoCard } from "./AskWhoCard";
import { TeamHeatmap } from "./TeamHeatmap";
import { TeamDailyChart, TokenChart } from "./ChartsLazy";

const FEATURE_CATEGORIES: FeatureCategory[] = [
  "skills",
  "subagents",
  "mcpTools",
  "slashCommands",
  "plugins",
];

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
    return p === "30" ? 30 : p === "7" ? 7 : "all";
  });
  const [compareTarget, setCompareTarget] = useState<string>(
    () => getHashParam("target") ?? "",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setHashParams({
      category: null, // 旧バージョンのURL互換のため掃除だけする
      period: period === "all" ? null : String(period),
      target: compareTarget || null,
    });
  }, [period, compareTarget]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Map<string, string>>(new Map());

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
        setMembers((prev) =>
          prev.map((m) => {
            if (m.name !== memberName) return m;
            const rec = { ...(m[category] ?? {}) };
            delete rec[feature];
            const dailyFeatures = m.dailyFeatures
              ? Object.fromEntries(
                  Object.entries(m.dailyFeatures).map(([date, cats]) => {
                    const catRec = { ...(cats[category] ?? {}) };
                    delete catRec[feature];
                    return [date, { ...cats, [category]: catRec }];
                  }),
                )
              : undefined;
            return { ...m, [category]: rec, dailyFeatures };
          }),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
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

  const cutoff = cutoffOf(period);
  const legacyNames = cutoff
    ? members.filter((m) => !m.dailyFeatures).map((m) => m.name)
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
          members.map((m) => [m.name, featureCounts(m, cat, cutoff)] as const),
        ),
      );
    }
    return map;
  }, [members, cutoff]);
  const skillCountsOf = countsByCat.get("skills")!;
  const activityOf = useMemo(
    () =>
      new Map(members.map((m) => [m.name, activityIn(m, cutoff)] as const)),
    [members, cutoff],
  );

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
              cutoff={cutoff}
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
          {/* 半幅カードはメンバー列が5人程度で横スクロールになるため、
              人数が多いときは全幅の縦積みに切り替える */}
          <div className={members.length <= 4 ? "card-grid" : undefined}>
            {(
              ["subagents", "mcpTools", "slashCommands", "plugins"] as const
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
            <TeamDailyChart members={members} cutoff={cutoff} />
          </div>

          <div className="card-grid">
            <div className="card">
              <h2>スキル利用回数<InfoTip text="スキル(手順書をパッケージ化した拡張機能)の呼び出し合計" /></h2>
              <p className="card-desc">
                {cutoff ? "期間内の" : ""}スキル呼び出し合計
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
              <h2>スキル利用セッション率{cutoff ? " (全期間)" : ""}<InfoTip text="スキルを1回以上使ったセッションの割合。素のチャットだけでなく機能を活用できているかの「質」の指標" /></h2>
              <p className="card-desc">
                スキルを1回以上使ったセッションの割合(%)。「質」の指標
              </p>
              <BarList
                data={Object.fromEntries(
                  members.map((m) => [m.name, skillRate(m)]),
                )}
                unit="%"
              />
            </div>
            <div className="card">
              <h2>活用機能の種類数<InfoTip text="使ったことのあるスキル+サブエージェント+MCPツールの種類数。活用の幅を表します" /></h2>
              <p className="card-desc">
                {cutoff ? "期間内に" : ""}
                使ったスキル+サブエージェント+MCPの種類数
              </p>
              <BarList
                data={Object.fromEntries(
                  members.map((m) => [m.name, diversity(m, cutoff)]),
                )}
                color="var(--series-3)"
              />
            </div>
            <div className="card">
              <h2>メンバー別トークン{cutoff ? " (全期間)" : ""}<InfoTip text="トークン=モデルが読み書きした文章量の単位。おおまかな利用量・コストの目安になります" /></h2>
              <p className="card-desc">トークン量の比較(モデル横断の合計)</p>
              <TokenChart
                rows={members.map((m) => ({
                  label: m.name,
                  tokens: totalTokens(m),
                }))}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
