import { currentRoomId } from "./room";

// ビルドモードによる出し分け。
// ローカル版(デフォルト): 通信ゼロ。エクスポート/ファイル読み込みのみ。
// クラウド版(--mode cloud): サマリーの共有APIとDB読み込みが有効になる。
export const IS_CLOUD = import.meta.env.VITE_APP_MODE === "cloud";

// 共有はルームURL(/r/…)にいるときだけ可能。
// クラウド版でもルート(/)は「個人解析のみ・アップロード不可」のモードになる。
export const CAN_SHARE =
  IS_CLOUD && typeof window !== "undefined" && currentRoomId() !== null;
