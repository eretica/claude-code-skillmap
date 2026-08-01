import type { NeonQueryFunction } from "@neondatabase/serverless";

export type Sql = NeonQueryFunction<false, false>;

// スキーマ:
//   rooms(id PK, label, created_at)      — 管理画面から発行するルーム
//   summaries(room_id, name, data, ...)  — ルームにスコープされたメンバーサマリー
// テーブル作成は初回リクエスト時に1度だけ実行(小規模ゆえの簡易マイグレーション。
// スキーマ変更が増えたらデプロイ時マイグレーションに移行する)

let ensured: Promise<unknown> | null = null;

export function ensureTables(sql: Sql) {
  ensured ??= (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS rooms (
        id text PRIMARY KEY,
        label text NOT NULL DEFAULT '',
        created_at timestamptz NOT NULL DEFAULT now()
      )`;
    await sql`
      CREATE TABLE IF NOT EXISTS summaries (
        room_id text NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        name text NOT NULL,
        data jsonb NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (room_id, name)
      )`;
  })();
  return ensured;
}

export function isValidRoomId(id: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(id);
}
