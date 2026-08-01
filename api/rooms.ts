import type { VercelRequest, VercelResponse } from "@vercel/node";
import { neon } from "@neondatabase/serverless";
import { randomBytes } from "node:crypto";
import { ensureTables, isValidRoomId } from "./_lib/db.js";

// ルーム管理API。middleware.tsのベーシック認証で保護される(管理者専用)。

function getSql() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_URL is not configured");
  return neon(url);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Cache-Control", "no-store");
  try {
    const sql = getSql();
    await ensureTables(sql);

    if (req.method === "GET") {
      const rows = await sql`
        SELECT r.id, r.label, r.created_at,
               count(s.name)::int AS members,
               max(s.updated_at) AS last_shared
        FROM rooms r
        LEFT JOIN summaries s ON s.room_id = r.id
        GROUP BY r.id
        ORDER BY r.created_at DESC`;
      res.status(200).json(
        rows.map((r) => ({
          id: r.id,
          label: r.label,
          createdAt: r.created_at,
          members: r.members,
          lastShared: r.last_shared,
        })),
      );
      return;
    }

    if (req.method === "POST") {
      const label =
        typeof (req.body as Record<string, unknown>)?.label === "string"
          ? ((req.body as Record<string, string>).label ?? "").trim().slice(0, 100)
          : "";
      // 推測不能なルームID(128bit乱数、base64url 22文字)
      const id = randomBytes(16).toString("base64url");
      await sql`INSERT INTO rooms (id, label) VALUES (${id}, ${label})`;
      res.status(200).json({ id, label });
      return;
    }

    if (req.method === "DELETE") {
      const id = typeof req.query.id === "string" ? req.query.id : "";
      if (!isValidRoomId(id)) {
        res.status(400).json({ error: "invalid room id" });
        return;
      }
      await sql`DELETE FROM rooms WHERE id = ${id}`;
      res.status(200).json({ ok: true });
      return;
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    res.status(405).json({ error: "method not allowed" });
  } catch (e) {
    // 予期しないエラーは内部情報をクライアントに漏らさず、ログにだけ残す
    console.error("[api/rooms]", e);
    res.status(500).json({ error: "internal server error" });
  }
}
