import { useMemo, useState } from "react";
import type {
  SessionDetail,
  TimelineSpan,
  TimeScale,
} from "../lib/sessionDetail";
import { buildTimeScale } from "../lib/sessionDetail";
import { InfoTip } from "./InfoTip";

// OpenTelemetryのトレースビュー風ウォーターフォール。
// 左=名前(階層インデント)、右=時間軸上のスパン(帯)とイベント(点)。
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
    second: "2-digit",
  });
  // セッション開始と日付が違う行には日付を付ける(何日もまたぐセッションがあるため)
  if (base !== undefined && new Date(base).toDateString() !== d.toDateString())
    return `${d.getMonth() + 1}/${d.getDate()} ${time.slice(0, 5)}`;
  return time;
}

const EVENT_STYLE: Record<string, { color: string; label: string }> = {
  prompt: { color: "var(--series-2)", label: "プロンプト" },
  command: { color: "var(--series-5)", label: "" },
  "skill-call": { color: "var(--series-1)", label: "" },
};

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

function Dot({
  scale,
  ts,
  color,
}: {
  scale: TimeScale;
  ts: number;
  color: string;
}) {
  return (
    <div className="tl-track">
      <span className="tl-dot" style={{ left: `${scale.pos(ts) * 100}%`, background: color }} />
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
  const childCount =
    span.tools.length + span.children.length;
  const durText =
    span.end > span.start ? fmtDuration(span.end - span.start) : "";
  return (
    <>
      <div
        className={`tl-row${childCount > 0 ? " expandable" : ""}`}
        onClick={childCount > 0 ? () => setOpen((v) => !v) : undefined}
        title={`${kindLabel}: ${span.name}${span.detail ? ` (${span.detail})` : ""}`}
      >
        <div className="tl-time">{fmtClock(span.start, base)}</div>
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
            <div className="tl-time" />
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
          <div className="tl-time" />
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

const MAX_ITEMS = 400;

export function SessionTimeline({ detail }: { detail: SessionDetail }) {
  const scale = useMemo(
    () => buildTimeScale(collectTimestamps(detail)),
    [detail],
  );
  const items = detail.items.slice(0, MAX_ITEMS);
  const [showTopTools, setShowTopTools] = useState(false);

  return (
    <div className="timeline">
      <p className="card-desc">
        {fmtClock(detail.start)} 〜 {fmtClock(detail.end)}(実時間{" "}
        {fmtDuration(detail.end - detail.start)})
        {scale.gaps.length > 0 &&
          ` · ${scale.gaps.length}箇所のアイドルを圧縮表示`}
        <InfoTip text="OpenTelemetryのトレースビュー風の表示です。帯=スキル/エージェントが動いていた区間、点=プロンプト・コマンド。5分以上のアイドルは破線位置で圧縮しています。行クリックで内訳(ツール呼び出し)を展開。この画面はローカル表示専用で、共有・エクスポートには含まれません" />
      </p>
      {!detail.hasAttribution && (
        <p className="empty-note">
          このセッションはスキル帰属情報のない形式のため、スキルは呼び出し時点(点)のみ表示します
        </p>
      )}
      <div className="tl-body">
        {/* 圧縮ギャップの破線マーカー */}
        {scale.gaps.map((g, i) => (
          <div
            key={i}
            className="tl-gap"
            style={{ left: `calc(324px + (100% - 324px) * ${g.pos})` }}
            title={`${fmtDuration(g.skippedMs)} のアイドルを圧縮`}
          />
        ))}
        {items.map((item, i) => {
          if (item.type === "span")
            return (
              <SpanRows
                key={i}
                span={item.span}
                scale={scale}
                depth={0}
                base={detail.start}
              />
            );
          const e = item.event;
          const style = EVENT_STYLE[e.kind];
          const label =
            e.kind === "prompt"
              ? "プロンプト"
              : e.kind === "command"
                ? e.name
                : `⚡ ${e.name}`;
          return (
            <div className="tl-row" key={i}>
              <div className="tl-time">{fmtClock(e.ts, detail.start)}</div>
              <div className="tl-label">
                <span
                  className="tl-event-swatch"
                  style={{ background: style.color }}
                />
                <span className={e.kind === "prompt" ? "tl-muted" : ""}>
                  {label}
                </span>
              </div>
              <Dot scale={scale} ts={e.ts} color={style.color} />
            </div>
          );
        })}
      </div>
      {detail.items.length > MAX_ITEMS && (
        <p className="empty-note">
          行数が多いため先頭 {MAX_ITEMS} 件のみ表示しています
        </p>
      )}
      {detail.topTools.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <button className="bl-more" onClick={() => setShowTopTools((v) => !v)}>
            {showTopTools ? "スキル外のツールを隠す" : `スキル外のツール ${detail.topTools.length} 種を表示`}
          </button>
          {showTopTools &&
            detail.topTools.map((t) => (
              <div className="tl-row" key={t.name}>
                <div className="tl-time" />
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
      <div className="legend" style={{ marginTop: 12 }}>
        <span>
          <span className="swatch" style={{ background: "var(--series-1)" }} />
          スキル
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--series-3)" }} />
          エージェント
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--series-2)" }} />
          プロンプト
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--series-5)" }} />
          コマンド
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--axis)" }} />
          ツール
        </span>
      </div>
    </div>
  );
}
