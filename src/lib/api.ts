import type { UsageSummary } from "./types";
import { currentRoomId } from "./room";

// クラウド版のみで使うAPIクライアント。すべて現在のルームにスコープされる。
// 送信するのはサマリーJSON(集計値のみ)であり、トランスクリプト本体は送らない。

export interface StoredSummary {
  name: string;
  updatedAt: string;
  data: UsageSummary;
}

export interface Room {
  id: string;
  label: string;
  createdAt: string;
  members: number;
  lastShared: string | null;
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function roomQuery(): string {
  const room = currentRoomId();
  if (!room) throw new Error("ルームURL(/r/…)からアクセスしてください");
  return `room=${encodeURIComponent(room)}`;
}

export async function fetchTeamSummaries(): Promise<StoredSummary[]> {
  const res = await fetch(`/api/summaries?${roomQuery()}`);
  return handle<StoredSummary[]>(res);
}

export async function shareSummary(summary: UsageSummary): Promise<void> {
  const res = await fetch(`/api/summaries?${roomQuery()}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(summary),
  });
  await handle<unknown>(res);
}

export async function removeSummaryItem(
  name: string,
  category: string,
  key: string,
): Promise<void> {
  const res = await fetch(`/api/summaries?${roomQuery()}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, category, key }),
  });
  await handle<unknown>(res);
}

export async function deleteSummary(name: string): Promise<void> {
  const res = await fetch(
    `/api/summaries?${roomQuery()}&name=${encodeURIComponent(name)}`,
    { method: "DELETE" },
  );
  await handle<unknown>(res);
}

// --- 管理画面用(ベーシック認証配下) ---

export async function fetchRooms(): Promise<Room[]> {
  const res = await fetch("/api/rooms");
  return handle<Room[]>(res);
}

export async function createRoom(label: string): Promise<{ id: string }> {
  const res = await fetch("/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ label }),
  });
  return handle<{ id: string }>(res);
}

export async function deleteRoom(id: string): Promise<void> {
  const res = await fetch(`/api/rooms?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  await handle<unknown>(res);
}
