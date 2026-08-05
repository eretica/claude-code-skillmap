import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sanitizeSummary } from "./_lib/sanitize.js";
import { ensureTables, getSql, isValidRoomId } from "./_lib/db.js";
import { isFeatureCategory, removeItemFromSummary } from "./_lib/mutate.js";

// サマリーの保存・取得API。すべてルーム(推測不能なID)にスコープされ、
// 存在しないルームIDは404を返す。ルームIDを知っていることが実質の認可。

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 個人別の動的データなので、CDN・ブラウザに一切キャッシュさせない
  res.setHeader("Cache-Control", "no-store");
  try {
    const sql = getSql();
    await ensureTables(sql);

    const roomId = typeof req.query.room === "string" ? req.query.room : "";
    if (!isValidRoomId(roomId)) {
      res.status(404).json({ error: "room not found" });
      return;
    }
    const rooms = await sql`SELECT 1 FROM rooms WHERE id = ${roomId}`;
    if (rooms.length === 0) {
      res.status(404).json({ error: "room not found" });
      return;
    }

    if (req.method === "GET") {
      const rows = await sql`
        SELECT name, data, updated_at FROM summaries
        WHERE room_id = ${roomId} ORDER BY name`;
      res.status(200).json(
        rows.map((r) => ({
          name: r.name,
          updatedAt: r.updated_at,
          data: r.data,
        })),
      );
      return;
    }

    if (req.method === "POST") {
      // 検証エラーはクライアント起因なので400でメッセージを返す
      let summary;
      try {
        summary = sanitizeSummary(req.body);
      } catch (e) {
        res
          .status(400)
          .json({ error: e instanceof Error ? e.message : "invalid body" });
        return;
      }
      await sql`
        INSERT INTO summaries (room_id, name, data, updated_at)
        VALUES (${roomId}, ${summary.name}, ${JSON.stringify(summary)}::jsonb, now())
        ON CONFLICT (room_id, name)
        DO UPDATE SET data = EXCLUDED.data, updated_at = now()`;
      res.status(200).json({ ok: true, name: summary.name });
      return;
    }

    if (req.method === "PATCH") {
      // 保存済みサマリーから特定カテゴリの1項目を削除する
      const { name, category, key } = (req.body ?? {}) as Record<
        string,
        unknown
      >;
      if (
        typeof name !== "string" ||
        !name ||
        name.length > 64 || // POST時のsanitize(64文字)と同じ上限
        typeof key !== "string" ||
        !key ||
        key.length > 200 ||
        !isFeatureCategory(category)
      ) {
        res.status(400).json({ error: "name, category, key are required" });
        return;
      }
      const rows = await sql`
        SELECT data FROM summaries
        WHERE room_id = ${roomId} AND name = ${name}`;
      if (rows.length === 0) {
        res.status(404).json({ error: "not found" });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = rows[0].data as any;
      const changed = removeItemFromSummary(data, category, key);
      if (changed) {
        await sql`
          UPDATE summaries
          SET data = ${JSON.stringify(data)}::jsonb, updated_at = now()
          WHERE room_id = ${roomId} AND name = ${name}`;
      }
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const name = typeof req.query.name === "string" ? req.query.name : "";
      if (!name || name.length > 64) {
        res.status(400).json({ error: "name is required" });
        return;
      }
      await sql`
        DELETE FROM summaries WHERE room_id = ${roomId} AND name = ${name}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader("Allow", "GET, POST, PATCH, DELETE");
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    // 予期しないエラーは内部情報をクライアントに漏らさず、ログにだけ残す
    console.error("[api/summaries]", e);
    res.status(500).json({ error: "internal server error" });
  }
}
