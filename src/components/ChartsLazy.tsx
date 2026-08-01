import { Suspense, lazy } from "react";
import type { ComponentProps } from "react";

// Recharts(重い)を含むcharts.tsxを遅延読み込みし、初期バンドルから外す。
// BarListやヒートマップは純CSSなのでメインバンドルのまま。

const Charts = {
  DailyCharts: lazy(() =>
    import("./charts").then((m) => ({ default: m.DailyCharts })),
  ),
  TokenChart: lazy(() =>
    import("./charts").then((m) => ({ default: m.TokenChart })),
  ),
  TeamDailyChart: lazy(() =>
    import("./charts").then((m) => ({ default: m.TeamDailyChart })),
  ),
  GrowthChart: lazy(() =>
    import("./charts").then((m) => ({ default: m.GrowthChart })),
  ),
};

const fallback = <div className="empty-note">チャートを読み込み中…</div>;

export function DailyCharts(
  props: ComponentProps<typeof Charts.DailyCharts>,
) {
  return (
    <Suspense fallback={fallback}>
      <Charts.DailyCharts {...props} />
    </Suspense>
  );
}

export function TokenChart(props: ComponentProps<typeof Charts.TokenChart>) {
  return (
    <Suspense fallback={fallback}>
      <Charts.TokenChart {...props} />
    </Suspense>
  );
}

export function TeamDailyChart(
  props: ComponentProps<typeof Charts.TeamDailyChart>,
) {
  return (
    <Suspense fallback={fallback}>
      <Charts.TeamDailyChart {...props} />
    </Suspense>
  );
}

export function GrowthChart(props: ComponentProps<typeof Charts.GrowthChart>) {
  return (
    <Suspense fallback={fallback}>
      <Charts.GrowthChart {...props} />
    </Suspense>
  );
}
