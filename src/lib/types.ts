// サマリーJSONのスキーマ。
// ここに定義されたフィールド以外は絶対にエクスポートしない(ホワイトリスト方式)。
// 会話本文・ファイルパス・コード・sessionId等の識別子は含めない。

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD (ローカルタイムゾーン)
  sessions: number;
  messages: number;
  toolCalls: number;
  /** その日スキルを1回以上使ったセッション数。旧サマリーには存在しない */
  skillSessions?: number;
  /** その日のユーザープロンプト数。旧サマリーには存在しない */
  userPrompts?: number;
  /** その日のサイドチェーン(サブエージェント側)アシスタントメッセージ数。旧サマリーには存在しない */
  sidechainMessages?: number;
}

/**
 * 機能カテゴリの唯一の定義(reposはcwd末尾のリポジトリ名)。
 * パーサ・除外・マージ・サニタイズ・PATCH・UIはすべてここから派生させること。
 * 個別にリストを書くと「サーバー保存時にreposの日別が落ちる」型のズレバグを生む(実績あり)。
 */
export const FEATURE_CATEGORIES = [
  "skills",
  "subagents",
  "mcpTools",
  "slashCommands",
  "plugins",
  "repos",
] as const;

/** 期間フィルタの対象になる機能カテゴリ */
export type FeatureCategory = (typeof FEATURE_CATEGORIES)[number];

/** リポジトリ×日別の活動と機能利用(チーム集計のリポジトリフィルタに使う) */
export interface RepoDaily {
  sessions: number;
  skillSessions: number;
  messages: number;
  toolCalls: number;
  userPrompts: number;
  features: Partial<
    Record<Exclude<FeatureCategory, "repos">, Record<string, number>>
  >;
}

export interface UsageSummary {
  schemaVersion: 1;
  name: string;
  exportedAt: string;
  period: { from: string | null; to: string | null };
  totals: {
    sessions: number;
    assistantMessages: number;
    userPrompts: number;
    toolCalls: number;
    activeDays: number;
  };
  dailyActivity: DailyActivity[];
  tokensByModel: Record<string, TokenUsage>;
  /** スキル名 -> 呼び出し回数 (Skillツールの input.skill のみ。argsは含めない) */
  skills: Record<string, number>;
  /** サブエージェント型 -> 起動回数 (input.subagent_type のみ。promptは含めない) */
  subagents: Record<string, number>;
  /** "server/tool" -> 呼び出し回数 (mcp__server__tool のツール名のみ) */
  mcpTools: Record<string, number>;
  /** スラッシュコマンド名 -> 実行回数 */
  slashCommands: Record<string, number>;
  /** プラグイン名 -> 利用回数 (スキル名/コマンド名の "plugin:" プレフィックスから集計)。旧サマリーには存在しない */
  plugins?: Record<string, number>;
  /** リポジトリ名(cwd末尾のみ、フルパスは含めない) -> アシスタントメッセージ数。旧サマリーには存在しない */
  repos?: Record<string, number>;
  /** 日付 -> リポジトリ -> 活動+機能利用。チーム集計のリポジトリフィルタ用。旧サマリーには存在しない */
  dailyRepos?: Record<string, Record<string, RepoDaily>>;
  /** 日付 -> カテゴリ -> 項目名 -> 回数。チーム集計の期間フィルタに使う。旧サマリーには存在しない */
  dailyFeatures?: Record<
    string,
    Partial<Record<FeatureCategory, Record<string, number>>>
  >;
  /** 日付 -> モデル -> トークン。再共有時の日付マージでトークンを二重計上せず蓄積するために使う。旧サマリーには存在しない */
  dailyTokens?: Record<string, Record<string, TokenUsage>>;
  /** エントリポイント(cli/vscode等) -> セッション数。旧サマリーには存在しない */
  entrypoints?: Record<string, number>;
  /** モード(normal/plan等) -> セッション数。旧サマリーには存在しない */
  modes?: Record<string, number>;
  /** 権限モード(default/bypassPermissions等) -> セッション数。旧サマリーには存在しない */
  permissionModes?: Record<string, number>;
  /** セッション長(アシスタントメッセージ数)の分布バケット。旧サマリーには存在しない */
  sessionLengthBuckets?: Record<string, number>;
  /** サイドチェーン(サブエージェントに委任した側)のアシスタントメッセージ総数。旧サマリーには存在しない */
  sidechainMessages?: number;
  /** ツール名 -> 失敗(tool_resultのis_error)回数。エラー本文は含めない。旧サマリーには存在しない */
  toolErrors?: Record<string, number>;
  /** 推論エフォート(high等) -> アシスタントメッセージ数。旧サマリーには存在しない */
  efforts?: Record<string, number>;
  /** セッション実時間(最初と最後の記録の差)の分布バケット。旧サマリーには存在しない */
  sessionDurationBuckets?: Record<string, number>;
  /** サーバーサイドWeb検索の実行回数。旧サマリーには存在しない */
  webSearchRequests?: number;
  /** サーバーサイドWebフェッチの実行回数。旧サマリーには存在しない */
  webFetchRequests?: number;
  /** 組み込みツール名 -> 呼び出し回数 (Read/Edit/Bash等の名前のみ) */
  tools: Record<string, number>;
  /** スキルを1回以上使ったセッション数 */
  sessionsWithSkill: number;
  /** サブエージェントを1回以上使ったセッション数 */
  sessionsWithSubagent: number;
}

// 破壊的変更(フィールドの意味変更・削除)をする場合はversionを上げ、
// 読み込み直後の1箇所(サーバーGET後/ファイル読込後)でmigrate関数を通すこと。
// 追加のみの変更はoptionalフィールド+旧サマリー注記で吸収する(現行方針)。
export const SUMMARY_SCHEMA_VERSION = 1 as const;
