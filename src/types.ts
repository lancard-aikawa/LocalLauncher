export type LaunchMode = 'browser' | 'terminal';

// 対応ランタイム一覧
export type Runtime =
  | 'bun'
  | 'node'
  | 'npm'
  | 'python'
  | 'python3'
  | 'cmd'
  | 'powershell'
  | 'raw'; // コマンドをそのまま実行

export interface ServerConfig {
  id: string;           // 一意のID（英数字・ハイフン）
  name: string;         // 表示名
  runtime: Runtime;
  command: string;      // ランタイムに渡すコマンド/ファイル名
  args?: string[];      // 追加引数
  cwd?: string;         // 作業ディレクトリ（省略時はカレント）
  env?: Record<string, string>; // 追加環境変数
  ports?: number[];     // ポート番号リスト（競合チェック・URLリンク用）
  autoStart?: boolean;  // ランチャー起動時に自動スタート
  stopCommand?: string; // カスタム停止コマンド（省略時はプロセスキル）
  restartDelay?: number; // 再起動時の待機ms（デフォルト: 1000）
  launchMode?: LaunchMode; // 'browser'（デフォルト）= ログ取得付き内部起動 / 'terminal' = 端末ウィンドウで起動
  detached?: boolean;  // 起動コマンドが即終了し実プロセスが独立して動くタイプ（detached状態に遷移）
}

export type PreferredTerminal = 'powershell' | 'cmd' | 'wt';

export interface LauncherSettings {
  preferredTerminal: PreferredTerminal;
}

export interface LauncherConfig {
  version: number;
  servers: ServerConfig[];
  settings: LauncherSettings;
}

export type ServerStatus = 'starting' | 'running' | 'stopping' | 'stopped' | 'error' | 'detached';

export interface ServerState {
  config: ServerConfig;
  status: ServerStatus;
  pid?: number;
  startTime?: Date;
  logs: string[];        // 直近MAX_LOGSライン
  portConflict: boolean; // 起動時にポートが塞がれていた
  exitCode?: number | null;
}
