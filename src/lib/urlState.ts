// タブ・期間・比較対象などの表示状態をURLハッシュに載せ、
// 「今週のチームビュー」をリンクとして共有できるようにする。
// 例: #tab=team&period=7&category=skills&target=username

export function getHashParam(key: string): string | null {
  return new URLSearchParams(window.location.hash.slice(1)).get(key);
}

export function setHashParams(params: Record<string, string | null>): void {
  const p = new URLSearchParams(window.location.hash.slice(1));
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === "") p.delete(key);
    else p.set(key, value);
  }
  const hash = p.toString();
  window.history.replaceState(
    null,
    "",
    hash ? `#${hash}` : window.location.pathname + window.location.search,
  );
}
