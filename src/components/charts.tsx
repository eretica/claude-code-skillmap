import { useState } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Bar,
  BarChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { DailyActivity, TokenUsage } from "../lib/types";
import type { WeeklyTrendPoint } from "../lib/trend";
import type { DateRange } from "../lib/teamStats";
import { inRange } from "../lib/teamStats";
import { InfoTip } from "./InfoTip";

// カテゴリカル色は固定順で割り当てる(参照パレットの検証済み順序)
const SERIES_COLORS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
  "var(--series-6)",
  "var(--series-7)",
  "var(--series-8)",
];

const axisTick = { fontSize: 11, fill: "var(--text-muted)" } as const;

// 凡例テキストはインク色で(系列色の文字はアクセシビリティ違反)
const legendText = (value: string) => (
  <span style={{ color: "var(--text-secondary)" }}>{value}</span>
);

// 表ビュー: 値をツールチップだけに閉じ込めないための併設テーブル
export function ChartTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="chart-table">
      <summary>表で見る</summary>
      <div style={{ overflowX: "auto" }}>
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>
                    {typeof cell === "number" ? cell.toLocaleString() : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function VizTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="viz-tooltip">
      <div className="tt-title">{label}</div>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      {payload.map((p: any) => (
        <div className="tt-row" key={p.dataKey}>
          <span>
            <span className="swatch" style={{ background: p.color }} />{" "}
            {p.name}
          </span>
          <span className="tt-val">{Number(p.value).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}

// データのない日を0で埋め、時間軸が詰まって見えないようにする
function fillDates(data: DailyActivity[]): DailyActivity[] {
  if (data.length < 2) return data;
  const out: DailyActivity[] = [];
  const cursor = new Date(`${data[0].date}T00:00:00Z`);
  const end = data[data.length - 1].date;
  const byDate = new Map(data.map((d) => [d.date, d]));
  for (;;) {
    const date = cursor.toISOString().slice(0, 10);
    out.push(byDate.get(date) ?? { date, sessions: 0, messages: 0, toolCalls: 0 });
    if (date >= end || out.length > 5000) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

// 日別アクティビティ: メッセージ数(面)とセッション数(棒)はスケールが大きく
// 異なるため、二軸にせず縦に並べた2つの単系列チャートにする。
export function DailyCharts({ data: raw }: { data: DailyActivity[] }) {
  if (raw.length === 0) return <div className="empty-note">データなし</div>;
  const data = fillDates(raw);
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        アシスタントメッセージ数 / 日
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            tickFormatter={fmt}
            width={44}
          />
          <Tooltip content={<VizTooltip />} cursor={{ stroke: "var(--axis)" }} />
          <Area
            type="monotone"
            dataKey="messages"
            name="メッセージ"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="var(--series-1)"
            fillOpacity={0.12}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        セッション数 / 日
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            allowDecimals={false}
            width={44}
          />
          <Tooltip
            content={<VizTooltip />}
            cursor={{ fill: "var(--grid)", opacity: 0.4 }}
          />
          <Bar
            dataKey="sessions"
            name="セッション"
            fill="var(--series-2)"
            radius={[4, 4, 0, 0]}
            maxBarSize={14}
          />
        </BarChart>
      </ResponsiveContainer>
      <ChartTable
        headers={["日付", "メッセージ", "セッション", "ツール呼び出し"]}
        rows={data.map((d) => [d.date, d.messages, d.sessions, d.toolCalls])}
      />
    </div>
  );
}

const TOKEN_KEYS = [
  { key: "input", name: "入力", color: "var(--series-1)" },
  { key: "output", name: "出力", color: "var(--series-2)" },
  { key: "cacheRead", name: "キャッシュ読取", color: "var(--series-3)" },
  { key: "cacheCreation", name: "キャッシュ作成", color: "var(--series-4)" },
] as const;

// トークン積み上げ横棒(モデル別/メンバー別で共用)。系列は固定順のカテゴリカル色。
// キャッシュ読取が支配的で入出力が潰れて見えないことが多いため、
// 「入出力のみ」への切替を用意する(合計の正直さと読み取りやすさの両立)
export function TokenChart({
  rows,
}: {
  rows: { label: string; tokens: TokenUsage }[];
}) {
  const [ioOnly, setIoOnly] = useState(false);
  const keys: { key: keyof TokenUsage; name: string; color: string }[] = ioOnly
    ? [...TOKEN_KEYS.slice(0, 2)]
    : [...TOKEN_KEYS];
  const data = rows
    .map(({ label, tokens: t }) => ({
      model: label,
      ...t,
      total: keys.reduce((s, k) => s + t[k.key], 0),
    }))
    .sort((a, b) => b.total - a.total);
  if (data.length === 0) return <div className="empty-note">データなし</div>;
  return (
    <div>
      <div className="tl-toggle" style={{ marginBottom: 4 }}>
        <button
          className={ioOnly ? "" : "active"}
          onClick={() => setIoOnly(false)}
        >
          すべて
        </button>
        <button
          className={ioOnly ? "active" : ""}
          onClick={() => setIoOnly(true)}
          title="キャッシュ読取・作成を除いた、実際に読み書きした分だけを表示"
        >
          入出力のみ
        </button>
      </div>
      <ResponsiveContainer width="100%" height={60 + data.length * 44}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis
            type="number"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            tickFormatter={fmt}
            minTickGap={32}
          />
          <YAxis
            type="category"
            dataKey="model"
            tick={{ ...axisTick, fill: "var(--text-secondary)" }}
            stroke="transparent"
            tickLine={false}
            width={150}
          />
          <Tooltip
            content={<VizTooltip />}
            cursor={{ fill: "var(--grid)", opacity: 0.4 }}
          />
          {/* 既定の凡例は積み上げと逆順+系列色文字になるため自前で描画する */}
          <Legend
            content={() => (
              <div
                className="legend"
                style={{ justifyContent: "center", marginTop: 4 }}
              >
                {keys.map((s) => (
                  <span key={s.key}>
                    <span className="swatch" style={{ background: s.color }} />
                    {s.name}
                  </span>
                ))}
                <InfoTip text="入力=モデルに渡した文章量、出力=モデルが書いた量。キャッシュはプロンプトキャッシュ(会話の文脈を再利用して高速・低コスト化する仕組み)のことで、「読取」は再利用できた分(安価)、「作成」は再利用のために保存した分です。キャッシュ読取が桁違いに大きく入出力が見えない場合は「入出力のみ」に切り替えてください" />
              </div>
            )}
          />
          {keys.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="t"
              fill={s.color}
              // セグメント間の区切りは枠線ではなくサーフェス色の細い隙間で
              stroke="var(--surface-1)"
              strokeWidth={1}
              maxBarSize={18}
              // 積み上げ末尾のみ角丸(データ終端の4px丸め)
              radius={i === keys.length - 1 ? [0, 4, 4, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ChartTable
        headers={["", ...TOKEN_KEYS.map((s) => s.name)]}
        rows={data.map((d) => [
          d.model,
          d.input,
          d.output,
          d.cacheRead,
          d.cacheCreation,
        ])}
      />
    </div>
  );
}

// トークンの日別推移: 合計と出力を縦に並べた2つの単系列チャートにする
// (キャッシュ読取が支配的で積み上げでは入出力が見えなくなるため、二軸も積み上げも使わない)
export function TokenTrendChart({
  dailyTokens,
  range,
}: {
  dailyTokens: Record<string, Record<string, TokenUsage>>;
  range: DateRange | null;
}) {
  const days = Object.entries(dailyTokens)
    .filter(([date]) => inRange(date, range))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, models]) => {
      const t = Object.values(models).reduce(
        (acc, u) => ({
          input: acc.input + u.input,
          output: acc.output + u.output,
          cacheRead: acc.cacheRead + u.cacheRead,
          cacheCreation: acc.cacheCreation + u.cacheCreation,
        }),
        { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
      );
      return {
        date,
        ...t,
        total: t.input + t.output + t.cacheRead + t.cacheCreation,
      };
    });
  if (days.length === 0) return <div className="empty-note">データなし</div>;
  // データのない日を0で埋める
  const byDate = new Map(days.map((d) => [d.date, d]));
  const filled: typeof days = [];
  const cursor = new Date(`${days[0].date}T00:00:00Z`);
  const end = days[days.length - 1].date;
  for (;;) {
    const date = cursor.toISOString().slice(0, 10);
    filled.push(
      byDate.get(date) ?? {
        date,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
        total: 0,
      },
    );
    if (date >= end || filled.length > 5000) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        合計トークン / 日(キャッシュ含む)
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart
          data={filled}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            tickFormatter={fmt}
            width={44}
          />
          <Tooltip content={<VizTooltip />} cursor={{ stroke: "var(--axis)" }} />
          <Area
            type="monotone"
            dataKey="total"
            name="合計トークン"
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="var(--series-1)"
            fillOpacity={0.12}
          />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        出力トークン / 日
        <InfoTip text="モデルが実際に生成した文章量。キャッシュを含む合計に比べてコストへの寄与が大きく、作業量の実感に近い指標です" />
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart
          data={filled}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            tickFormatter={fmt}
            width={44}
          />
          <Tooltip content={<VizTooltip />} cursor={{ stroke: "var(--axis)" }} />
          <Line
            type="monotone"
            dataKey="output"
            name="出力トークン"
            stroke="var(--series-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <ChartTable
        headers={["日付", "入力", "出力", "キャッシュ読取", "キャッシュ作成"]}
        rows={days.map((d) => [
          d.date,
          d.input,
          d.output,
          d.cacheRead,
          d.cacheCreation,
        ])}
      />
    </div>
  );
}

// モデル×メンバー: メンバーごとの合計トークンをモデル別セグメントで積み上げる。
// モデル数が多い場合は上位7+「その他」に畳む(9色目を生成しない)
const MAX_MODEL_SERIES = 7;

export function TeamModelChart({
  rows,
}: {
  rows: { name: string; tokensByModel: Record<string, TokenUsage> }[];
}) {
  const sum = (t: TokenUsage) =>
    t.input + t.output + t.cacheRead + t.cacheCreation;
  const modelTotals = new Map<string, number>();
  for (const r of rows)
    for (const [model, t] of Object.entries(r.tokensByModel))
      modelTotals.set(model, (modelTotals.get(model) ?? 0) + sum(t));
  const ranked = [...modelTotals.entries()].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return <div className="empty-note">データなし</div>;
  const shown = ranked.slice(0, MAX_MODEL_SERIES).map(([m]) => m);
  const hasOther = ranked.length > MAX_MODEL_SERIES;
  const series = hasOther ? [...shown, "その他"] : shown;

  const data = rows
    .map((r) => {
      const row: Record<string, string | number> = { member: r.name };
      for (const s of series) row[s] = 0;
      let total = 0;
      for (const [model, t] of Object.entries(r.tokensByModel)) {
        const key = shown.includes(model) ? model : "その他";
        row[key] = ((row[key] as number) ?? 0) + sum(t);
        total += sum(t);
      }
      return { row, total };
    })
    .sort((a, b) => b.total - a.total)
    .map((r) => r.row);

  return (
    <div>
      <ResponsiveContainer width="100%" height={60 + data.length * 44}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 16, left: 8, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" horizontal={false} />
          <XAxis
            type="number"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            tickFormatter={fmt}
            minTickGap={32}
          />
          <YAxis
            type="category"
            dataKey="member"
            tick={{ ...axisTick, fill: "var(--text-secondary)" }}
            stroke="transparent"
            tickLine={false}
            width={110}
          />
          <Tooltip
            content={<VizTooltip />}
            cursor={{ fill: "var(--grid)", opacity: 0.4 }}
          />
          <Legend
            content={() => (
              <div
                className="legend"
                style={{ justifyContent: "center", marginTop: 4 }}
              >
                {series.map((s, i) => (
                  <span key={s}>
                    <span
                      className="swatch"
                      style={{
                        background: SERIES_COLORS[i % SERIES_COLORS.length],
                      }}
                    />
                    {s}
                  </span>
                ))}
                <InfoTip text="メンバーごとの合計トークン(キャッシュ含む)をモデル別に積み上げた図。誰がどのモデルをどれだけ使っているかが分かります" />
              </div>
            )}
          />
          {series.map((s, i) => (
            <Bar
              key={s}
              dataKey={s}
              name={s}
              stackId="m"
              fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              stroke="var(--surface-1)"
              strokeWidth={1}
              maxBarSize={18}
              radius={i === series.length - 1 ? [0, 4, 4, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <ChartTable
        headers={["メンバー", ...series]}
        rows={data.map((r) => [
          r.member as string,
          ...series.map((s) => r[s] as number),
        ])}
      />
    </div>
  );
}

// 自分の成長トレンド: 週次のスキル利用セッション率と活用機能の種類数。
// 指標のスケールが異なるため二軸にせず、縦に並べた2つの単系列チャートにする。
export function GrowthChart({ points }: { points: WeeklyTrendPoint[] }) {
  if (points.length < 2)
    return (
      <div className="empty-note">
        週をまたぐデータが貯まると成長トレンドが表示されます
      </div>
    );
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        スキル利用セッション率 (%) / 週
        <InfoTip text="その週のセッションのうち、スキルを1回以上使った割合" />
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart
          data={points}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="week"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            domain={[0, 100]}
            width={40}
          />
          <Tooltip content={<VizTooltip />} cursor={{ stroke: "var(--axis)" }} />
          <Line
            type="monotone"
            dataKey="skillRate"
            name="スキル利用セッション率"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: "var(--text-secondary)" }}>
        活用機能の種類数 / 週
        <InfoTip text="その週に使ったスキル+サブエージェント+MCPツールの種類数" />
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart
          data={points}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="week"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            allowDecimals={false}
            width={40}
          />
          <Tooltip content={<VizTooltip />} cursor={{ stroke: "var(--axis)" }} />
          <Line
            type="monotone"
            dataKey="diversity"
            name="機能の種類数"
            stroke="var(--series-3)"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
      <ChartTable
        headers={["週(月曜)", "スキル利用セッション率", "機能の種類数"]}
        rows={points.map((p) => [
          p.week,
          p.skillRate === null ? "–" : `${p.skillRate}%`,
          p.diversity,
        ])}
      />
    </div>
  );
}

// チーム比較: メンバーごとの日別メッセージ数を重ねた折れ線。
// 系列が多いと読めなくなるため上位8名に制限する。
const MAX_LINE_MEMBERS = 8;

export function TeamDailyChart({
  members,
  range,
}: {
  members: { name: string; dailyActivity: DailyActivity[] }[];
  range: DateRange | null;
}) {
  const filtered = members.map((m) => ({
    name: m.name,
    daily: range
      ? m.dailyActivity.filter((d) => inRange(d.date, range))
      : m.dailyActivity,
  }));
  // 色はメンバーの並び順(名前順)に固定で割り当て、期間切替で塗り替えない
  const colorOf = new Map(members.map((m, i) => [m.name, SERIES_COLORS[i % SERIES_COLORS.length]]));
  const shown = [...filtered]
    .sort(
      (a, b) =>
        b.daily.reduce((s, d) => s + d.messages, 0) -
        a.daily.reduce((s, d) => s + d.messages, 0),
    )
    .slice(0, MAX_LINE_MEMBERS)
    .sort((a, b) => a.name.localeCompare(b.name));

  const present = [
    ...new Set(shown.flatMap((m) => m.daily.map((d) => d.date))),
  ].sort();
  if (present.length === 0)
    return <div className="empty-note">データなし</div>;
  // データのない日も0として並べ、時間軸が詰まって見えないようにする
  const dates: string[] = [];
  const cursor = new Date(`${present[0]}T00:00:00Z`);
  const end = present[present.length - 1];
  for (;;) {
    const date = cursor.toISOString().slice(0, 10);
    dates.push(date);
    if (date >= end || dates.length > 5000) break;
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  const byMember = new Map(
    shown.map((m) => [m.name, new Map(m.daily.map((d) => [d.date, d.messages]))]),
  );
  const rows = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const m of shown) row[m.name] = byMember.get(m.name)!.get(date) ?? 0;
    return row;
  });

  return (
    <div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            stroke="var(--axis)"
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={axisTick}
            stroke="transparent"
            tickLine={false}
            tickFormatter={fmt}
            width={44}
          />
          <Tooltip content={<VizTooltip />} cursor={{ stroke: "var(--axis)" }} />
          <Legend
            wrapperStyle={{ fontSize: 12 }}
            iconSize={10}
            formatter={legendText}
          />
          {shown.map((m) => (
            <Line
              key={m.name}
              type="monotone"
              dataKey={m.name}
              name={m.name}
              stroke={colorOf.get(m.name)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {filtered.length > MAX_LINE_MEMBERS && (
        <div className="empty-note">
          メッセージ数上位{MAX_LINE_MEMBERS}名を表示中(全{filtered.length}名)
        </div>
      )}
      <ChartTable
        headers={["日付", ...shown.map((m) => m.name)]}
        rows={rows.map((r) => [
          r.date as string,
          ...shown.map((m) => r[m.name] as number),
        ])}
      />
    </div>
  );
}
