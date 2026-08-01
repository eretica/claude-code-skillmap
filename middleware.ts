// Vercel Edge Middleware: 管理画面(/admin)とルーム管理API(/api/rooms)にのみ
// ベーシック認証をかける。ルーム閲覧・共有は推測不能なルームIDが実質の認可。
// 環境変数 BASIC_AUTH_USER / BASIC_AUTH_PASSWORD で設定する(リポジトリには置かない)。
// noindex等のヘッダーは vercel.json の headers で全レスポンスに付与している。

export const config = {
  matcher: ["/admin", "/admin/:path*", "/api/rooms"],
};

// タイミング攻撃対策の定数時間比較(edge runtimeにはtimingSafeEqualが無いため自前)
function safeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++)
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export default function middleware(request: Request): Response | undefined {
  const user = process.env.BASIC_AUTH_USER;
  const password = process.env.BASIC_AUTH_PASSWORD;

  const unauthorized = (message: string) =>
    new Response(message, {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="claude-code-skillmap admin"' },
    });

  if (!user || !password) {
    return new Response(
      "BASIC_AUTH_USER / BASIC_AUTH_PASSWORD が未設定です。Vercelの環境変数に設定してください。",
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return unauthorized("認証が必要です");

  try {
    const [reqUser, ...rest] = atob(header.slice(6)).split(":");
    const reqPass = rest.join(":");
    if (safeEqual(reqUser, user) && safeEqual(reqPass, password))
      return undefined; // 通過
  } catch {
    // base64が不正な場合は401へ
  }
  return unauthorized("認証に失敗しました");
}
