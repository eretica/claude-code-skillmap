// File System Access APIのディレクトリハンドルをIndexedDBに保存し、
// 次回から「再解析」ワンクリックで同じフォルダを読めるようにする。
// (ハンドルはstructured cloneできるためIndexedDBに永続化できる。localStorageは不可)

const DB_NAME = "claude-graph";
const STORE = "handles";
const KEY = "projectsDir";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveDirHandle(handle: unknown): Promise<void> {
  try {
    await tx("readwrite", (s) => s.put(handle, KEY));
  } catch {
    // プライベートブラウジング等で失敗しても機能自体は使えるので無視
  }
}

export async function loadDirHandle(): Promise<unknown | null> {
  try {
    return (await tx("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function clearDirHandle(): Promise<void> {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    // 同上
  }
}
