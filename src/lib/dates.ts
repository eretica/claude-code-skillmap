// 日付は一貫して「閲覧者のローカルタイムゾーンの日付文字列 (YYYY-MM-DD)」で扱う。
// UTC基準にすると日本時間の朝9時前に「今日」が1日ずれるため。

export function localDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function daysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localDate(d);
}

/** その日付が属する週の月曜日(YYYY-MM-DD)。週次トレンドのバケットキーに使う */
export function weekStartOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return localDate(dt);
}
