// クラウド版のルーティング: パスからルームIDを取り出す。
// /r/<roomId> がチーム用ルーム、/admin が管理画面、それ以外はランディング。

export function currentRoomId(): string | null {
  const m = window.location.pathname.match(/^\/r\/([A-Za-z0-9_-]{16,64})\/?$/);
  return m ? m[1] : null;
}

export function isAdminPath(): boolean {
  return /^\/admin(\/|$)/.test(window.location.pathname);
}

export function roomUrl(roomId: string): string {
  return `${window.location.origin}/r/${roomId}`;
}
