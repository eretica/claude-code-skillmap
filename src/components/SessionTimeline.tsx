import { useMemo, useState } from "react";
import type {
  SessionDetail,
  TimelineSpan,
  TimeScale,
} from "../lib/sessionDetail";
import { buildTimeScale } from "../lib/sessionDetail";
import { loadRates, rateFor, formatUsd } from "../lib/pricing";
import { InfoTip } from "./InfoTip";

// OpenTelemetryのトレースビュー風タイムライン。
// 上段: マーカーレーン(▲スキル/コマンド・●プロンプト)+セッション本体+スパン行(1行1レーン)。
// 下段: 累積消費(コスト/総トークン)のステップチャート。
// 長いアイドルはlib側の仮想時間軸で圧縮される(破線マーカーで表示)。

export function fmtDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}秒`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}分`;
  const h = Math.floor(min / 60);
  return `${h}時間${min % 60 > 0 ? `${min % 60}分` : ""}`;
}

function fmtClock(ts: number, base?: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  // セッション開始と日付が違う場合は日付を付ける(何日もまたぐセッションがあるため)
  if (base !== undefined && new Date(base).toDateString() !== d.toDateString())
    return `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  return time;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function collectTimestamps(detail: SessionDetail): number[] {
  const out: number[] = [detail.start, detail.end];
  const addSpan = (s: TimelineSpan) => {
    out.push(s.start, s.end);
    for (const t of s.tools) out.push(t.first, t.last);
    for (const c of s.children) addSpan(c);
  };
  for (const item of detail.items) {
    if (item.type === "event") out.push(item.event.ts);
    else addSpan(item.span);
  }
  for (const p of detail.usagePoints) out.push(p.ts);
  return out;
}

function Bar({
  scale,
  start,
  end,
  color,
  thin,
  label,
}: {
  scale: TimeScale;
  start: number;
  end: number;
  color: string;
  thin?: boolean;
  label?: string;
}) {
  const left = scale.pos(start) * 100;
  const width = Math.max(scale.pos(end) * 100 - left, 0.6);
  return (
    <div className="tl-track">
      <div
        className={`tl-bar${thin ? " thin" : ""}`}
        style={{ left: `${left}%`, width: `${width}%`, background: color }}
      />
      {label && (
        <span
          className="tl-bar-label"
          style={
            left + width < 70
              ? { left: `calc(${left + width}% + 6px)` }
              : { right: `calc(${100 - left}% + 6px)` }
          }
        >
          {label}
        </span>
      )}
    </div>
  );
}

const MAX_TOOL_ROWS = 10;

function SpanRows({
  span,
  scale,
  depth,
  base,
}: {
  span: TimelineSpan;
  scale: TimeScale;
  depth: number;
  base: number;
}) {
  const [open, setOpen] = useState(false);
  const color = span.kind === "skill" ? "var(--series-1)" : "var(--series-3)";
  const icon = span.kind === "skill" ? "⚡" : "🤖";
  const kindLabel = span.kind === "skill" ? "スキル" : "エージェント";
  const childCount = span.tools.length + span.children.length;
  const durText =
    span.end > span.start ? fmtDuration(span.end - span.start) : "";
  return (
    <>
      <div
        className={`tl-row${childCount > 0 ? " expandable" : ""}`}
        onClick={childCount > 0 ? () => setOpen((v) => !v) : undefined}
        title={`${kindLabel}: ${span.name}${span.detail ? ` (${span.detail})` : ""} · ${fmtClock(span.start, base)}〜`}
      >
        <div className="tl-label" style={{ paddingLeft: depth * 18 }}>
          {childCount > 0 && (
            <span className="tl-caret">{open ? "▼" : "▶"}</span>
          )}
          <span>
            {icon} {span.name}
          </span>
          {span.detail && <span className="tl-detail">{span.detail}</span>}
        </div>
        <Bar
          scale={scale}
          start={span.start}
          end={span.end}
          color={color}
          label={[durText, span.messages > 0 ? `${span.messages} msg` : ""]
            .filter(Boolean)
            .join(" · ")}
        />
      </div>
      {open &&
        span.children.map((c, i) => (
          <SpanRows
            key={`c${i}`}
            span={c}
            scale={scale}
            depth={depth + 1}
            base={base}
          />
        ))}
      {open &&
        span.tools.slice(0, MAX_TOOL_ROWS).map((t) => (
          <div className="tl-row" key={t.name}>
            <div className="tl-label" style={{ paddingLeft: (depth + 1) * 18 }}>
              <span className="tl-tool">{t.name}</span>
            </div>
            <Bar
              scale={scale}
              start={t.first}
              end={t.last}
              color="var(--axis)"
              thin
              label={`×${t.count}`}
            />
          </div>
        ))}
      {open && span.tools.length > MAX_TOOL_ROWS && (
        <div className="tl-row">
          <div
            className="tl-label"
            style={{ paddingLeft: (depth + 1) * 18, color: "var(--text-muted)" }}
          >
            …ほか {span.tools.length - MAX_TOOL_ROWS} 種のツール
          </div>
          <div className="tl-track" />
        </div>
      )}
    </>
  );
}

interface Marker {
  ts: number;
  kind: "skill" | "command" | "prompt";
  name: string;
}

function collectMarkers(detail: SessionDetail): Marker[] {
  const out: Marker[] = [];
  for (const item of detail.items) {
    if (item.type === "event") {
      if (item.event.kind === "command")
        out.push({ ts: item.event.ts, kind: "command", name: item.event.name });
      else if (item.event.kind === "prompt")
        out.push({ ts: item.event.ts, kind: "prompt", name: "プロンプト" });
      else out.push({ ts: item.event.ts, kind: "skill", name: item.event.name });
    } else if (item.span.kind === "skill") {
      out.push({ ts: item.span.start, kind: "skill", name: item.span.name });
    }
  }
  return out;
}

const MARKER_STYLE: Record<Marker["kind"], { color: string; glyph: string }> = {
  skill: { color: "var(--series-1)", glyph: "▲" },
  command: { color: "var(--series-5)", glyph: "▲" },
  prompt: { color: "var(--series-2)", glyph: "●" },
};

// 累積消費チャート: コスト/総トークンのステップ折れ線(SVG)。
// x座標はタイムラインと同じ仮想時間軸を使い、縦破線=スキル/エージェントの呼び出し位置。
function CumulativeChart({
  detail,
  scale,
  callMarks,
}: {
  detail: SessionDetail;
  scale: TimeScale;
  callMarks: number[];
}) {
  const [mode, setMode] = useState<"cost" | "tokens">("cost");
  const rates = useMemo(() => loadRates(), []);

  const { path, max } = useMemo(() => {
    const W = 1000;
    const H = 100;
    let cum = 0;
    const pts: [number, number][] = [[0, 0]];
    for (const p of detail.usagePoints) {
      if (mode === "cost") {
        const r = rateFor(p.model, rates);
        if (r)
          cum +=
            (p.input * r.input +
              p.output * r.output +
              p.cacheRead * r.input * 0.1 +
              p.cacheCreation * r.input * 1.25) /
            1_000_000;
      } else {
        cum += p.input + p.output + p.cacheRead + p.cacheCreation;
      }
      pts.push([scale.pos(p.ts), cum]);
    }
    const max = cum || 1;
    // ステップ(直前の値を保ってから上げる)で描く
    let d = `M 0 ${H}`;
    let prevY = H;
    for (const [x, v] of pts) {
      const px = x * W;
      const py = H - (v / max) * (H - 6);
      d += ` L ${px.toFixed(1)} ${prevY.toFixed(1)} L ${px.toFixed(1)} ${py.toFixed(1)}`;
      prevY = py;
    }
    d += ` L ${W} ${prevY.toFixed(1)}`;
    return { path: d, max: cum };
  }, [detail, scale, mode, rates]);

  if (detail.usagePoints.length === 0) return null;

  return (
    <div className="tl-panel">
      <div className="tl-panel-head">
        <h3>累積消費</h3>
        <div className="tl-toggle">
          <button
            className={mode === "cost" ? "active" : ""}
            onClick={() => setMode("cost")}
          >
            コスト
          </button>
          <button
            className={mode === "tokens" ? "active" : ""}
            onClick={() => setMode("tokens")}
          >
            総トークン
          </button>
        </div>
        <InfoTip text="セッション中の消費の増え方。コストはAPI従量課金換算の概算(実際の請求額ではありません)。総トークンはキャッシュ読み込み・書き込みを含みます。縦の破線はスキル・サブエージェントの呼び出し位置です" />
      </div>
      <svg
        className="tl-cum"
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="累積消費チャート"
      >
        {callMarks.map((ts, i) => (
          <line
            key={i}
            x1={scale.pos(ts) * 1000}
            x2={scale.pos(ts) * 1000}
            y1={0}
            y2={100}
            stroke="var(--series-3)"
            strokeDasharray="3 4"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            opacity={0.7}
          />
        ))}
        <path
          d={path}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={1.6}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="tl-axis">
        <span>{fmtClock(detail.start)}</span>
        <span className="tl-axis-mid">
          累積{mode === "cost" ? "コスト" : "トークン"}(最大{" "}
          {mode === "cost" ? formatUsd(max) : fmtTokens(max)})
        </span>
        <span>{fmtClock(detail.end, detail.start)}</span>
      </div>
    </div>
  );
}

const MAX_SPAN_ROWS = 200;

export function SessionTimeline({ detail }: { detail: SessionDetail }) {
  const scale = useMemo(
    () => buildTimeScale(collectTimestamps(detail)),
    [detail],
  );
  const spans = detail.items
    .filter((i): i is { type: "span"; span: TimelineSpan } => i.type === "span")
    .slice(0, MAX_SPAN_ROWS);
  const markers = useMemo(() => collectMarkers(detail), [detail]);
  const callMarks = useMemo(
    () =>
      markers
        .filter((m) => m.kind === "skill")
        .map((m) => m.ts)
        .concat(
          spans.filter((s) => s.span.kind === "agent").map((s) => s.span.start),
        ),
    [markers, spans],
  );
  const [showTopTools, setShowTopTools] = useState(false);

  return (
    <div className="timeline">
      <p className="card-desc">
        {fmtClock(detail.start)} 〜 {fmtClock(detail.end, detail.start)}
        (実時間 {fmtDuration(detail.end - detail.start)})
        {scale.gaps.length > 0 &&
          ` · ${scale.gaps.length}箇所のアイドルを圧縮表示`}
        <InfoTip text="OpenTelemetryのトレースビュー風の表示です。上のマーカー=スキル/コマンド(▲)とプロンプト(●)、帯=スキル/エージェントが動いていた区間。5分以上のアイドルは破線位置で圧縮しています。行クリックで内訳(ツール呼び出し)を展開。この画面はローカル表示専用で、共有・エクスポートには含まれません" />
      </p>
      {!detail.hasAttribution && (
        <p className="empty-note">
          このセッションはスキル帰属情報のない形式のため、スキルは呼び出し時点(▲)のみ表示します
        </p>
      )}

      <div className="tl-panel">
        <div className="tl-panel-head">
          <h3>実行タイムライン</h3>
        </div>
        <div className="tl-body">
          {scale.gaps.map((g, i) => (
            <div
              key={i}
              className="tl-gap"
              style={{ left: `calc(240px + (100% - 240px) * ${g.pos})` }}
              title={`${fmtDuration(g.skippedMs)} のアイドルを圧縮`}
            />
          ))}
          {/* マーカーレーン: ▲スキル/コマンド・●プロンプト */}
          <div className="tl-row marker-lane">
            <div className="tl-label" />
            <div className="tl-track">
              {markers.map((m, i) => {
                const st = MARKER_STYLE[m.kind];
                return (
                  <span
                    key={i}
                    className="tl-marker"
                    style={{
                      left: `${scale.pos(m.ts) * 100}%`,
                      color: st.color,
                      fontSize: m.kind === "prompt" ? 7 : 9,
                    }}
                    title={`${m.name} · ${fmtClock(m.ts, detail.start)}`}
                  >
                    {st.glyph}
                  </span>
                );
              })}
            </div>
          </div>
          {/* セッション本体 */}
          <div className="tl-row">
            <div className="tl-label">セッション本体</div>
            <Bar
              scale={scale}
              start={detail.start}
              end={detail.end}
              color="var(--seq-300)"
            />
          </div>
          {spans.map((item, i) => (
            <SpanRows
              key={i}
              span={item.span}
              scale={scale}
              depth={0}
              base={detail.start}
            />
          ))}
        </div>
        <div className="tl-axis" style={{ paddingLeft: 240 }}>
          <span>{fmtClock(detail.start)}</span>
          <span>{fmtClock(detail.end, detail.start)}</span>
        </div>
        {detail.items.filter((i) => i.type === "span").length >
          MAX_SPAN_ROWS && (
          <p className="empty-note">
            行数が多いため先頭 {MAX_SPAN_ROWS} 件のみ表示しています
          </p>
        )}
        {detail.topTools.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button
              className="bl-more"
              onClick={() => setShowTopTools((v) => !v)}
            >
              {showTopTools
                ? "スキル外のツールを隠す"
                : `スキル外のツール ${detail.topTools.length} 種を表示`}
            </button>
            {showTopTools &&
              detail.topTools.map((t) => (
                <div className="tl-row" key={t.name}>
                  <div className="tl-label">
                    <span className="tl-tool">{t.name}</span>
                  </div>
                  <Bar
                    scale={scale}
                    start={t.first}
                    end={t.last}
                    color="var(--axis)"
                    thin
                    label={`×${t.count}`}
                  />
                </div>
              ))}
          </div>
        )}
        <div className="legend" style={{ marginTop: 10 }}>
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--series-1)" }}>▲</span> スキル
          </span>
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--series-5)" }}>▲</span> コマンド
          </span>
          <span style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--series-2)" }}>●</span> プロンプト
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--series-1)" }} />
            スキル区間
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--series-3)" }} />
            エージェント
          </span>
          <span>
            <span className="swatch" style={{ background: "var(--axis)" }} />
            ツール
          </span>
        </div>
      </div>

      <CumulativeChart detail={detail} scale={scale} callMarks={callMarks} />
    </div>
  );
}
