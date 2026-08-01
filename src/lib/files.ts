// フォルダ選択 / ドラッグ&ドロップから .jsonl ファイルを収集する。
// すべてブラウザ内で完結し、ファイル内容がネットワークに送られることはない。

// トランスクリプト(.jsonl)に加え、過去履歴バックフィル用のstats-cache.jsonも拾う
// (~/.claude ごとドラッグされたケースに対応)
const isTarget = (name: string) =>
  name.endsWith(".jsonl") || name === "stats-cache.json";

export function supportsDirectoryPicker(): boolean {
  return "showDirectoryPicker" in window;
}

export async function pickDirectoryHandle(): Promise<unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).showDirectoryPicker({ mode: "read" });
}

export async function filesFromHandle(dir: unknown): Promise<File[]> {
  const files: File[] = [];
  await walkHandle(dir, files);
  return files;
}

/** 保存済みハンドルの読み取り権限を確認し、必要なら(ユーザー操作起点で)再要求する */
export async function ensureHandlePermission(handle: unknown): Promise<boolean> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const h = handle as any;
  try {
    if ((await h.queryPermission({ mode: "read" })) === "granted") return true;
    return (await h.requestPermission({ mode: "read" })) === "granted";
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function walkHandle(dir: any, out: File[]): Promise<void> {
  for await (const entry of dir.values()) {
    if (entry.kind === "file") {
      if (isTarget(entry.name)) out.push(await entry.getFile());
    } else if (entry.kind === "directory") {
      await walkHandle(entry, out);
    }
  }
}

export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries = [...dt.items]
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => e != null);
  if (entries.length > 0) {
    await Promise.all(entries.map((e) => walkEntry(e, out)));
    return out;
  }
  return [...dt.files].filter((f) => isTarget(f.name));
}

async function walkEntry(entry: FileSystemEntry, out: File[]): Promise<void> {
  if (entry.isFile) {
    if (!isTarget(entry.name)) return;
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject),
    );
    out.push(file);
  } else if (entry.isDirectory) {
    const dirReader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries は一度に最大100件しか返さないため空になるまで繰り返す
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
        dirReader.readEntries(resolve, reject),
      );
      if (batch.length === 0) break;
      await Promise.all(batch.map((e) => walkEntry(e, out)));
    }
  }
}

export function filesFromInput(list: FileList): File[] {
  return [...list].filter((f) => isTarget(f.name));
}

export function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
