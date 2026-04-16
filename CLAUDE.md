# LocalLauncher — CLAUDE.md

ローカル開発用Webサーバーをまとめて管理するランチャーツール。  
Bun製。TUIダッシュボードとブラウザWeb UIの両方に対応。

---

## 技術スタック

- ランタイム: **Bun**（Node.js互換）
- 言語: TypeScript
- フロントエンド: バニラJS + xterm.js（ブラウザ内ターミナル）
- WebSocket: Bun.serve の websocket オプション
- ビルド: `bun build --compile` で依存なし単体exe化

## ファイル構成

```
src/
  types.ts          型定義（ServerConfig, ServerState, LauncherConfig等）
  config.ts         設定ファイル管理（%APPDATA%\LocalLauncher\config.json）
  portChecker.ts    ポート空き確認（checkPortAvailable）
  portDetector.ts   設定ファイルからのポート自動検出
  manager.ts        ServerManager — プロセスライフサイクル管理の中心
  prompts.ts        readline対話フォーム（TUI用）
  dashboard.ts      TUIダッシュボード（ANSIボックス描画）
  index.ts          CLIエントリポイント・コマンド分岐
  web/
    server.ts       HTTP + WebSocketサーバー（WebServerクラス）
    ui.html         ブラウザUI（xterm.js内蔵、全JS/CSSをインライン記述）
```

## アーキテクチャ上の重要事項

### ServerManager（src/manager.ts）

- プロセスの起動・停止・再起動を一元管理
- `onUpdate: () => void` コールバックで外部（Dashboard/WebServer）に状態変化を通知
- `onLog: (id, line) => void` コールバックでリアルタイムログ配信
- `spawn` は `shell: true`（Windows）/ `stdio: ['pipe','pipe','pipe']`
- **stdout/stderr/stdin には必ず `.on('error', () => {})` を付ける**  
  → 付けないと、プロセス終了時のパイプエラーが uncaughtException になりプロセスが落ちる

### 起動モード（launchMode）

| モード | 説明 |
|---|---|
| `browser`（デフォルト） | stdout/stderrをキャプチャしてブラウザに表示。stdinも転送可 |
| `terminal` | 外部ターミナル（powershell/cmd/wt）で起動。プロセス管理なし |
| `detached` フラグ | 起動コマンドが即終了し実プロセスがバックグラウンドで動くタイプ |

### ポートチェック（src/portChecker.ts）

- `checkPortAvailable(port, host, timeoutMs=2000)` — タイムアウトあり
- Windows の TCP ソケット状態によって `srv.listen` がハングすることがある → タイムアウト必須
- `start()` 内のポートチェックは `Promise.all` で並列実行すること（直列だと遅延が掛け算になる）

### 設定ファイル

- パス: `%APPDATA%\LocalLauncher\config.json`（Windows）/ `~/.local-launcher/config.json`（他OS）
- PIDファイル: `%APPDATA%\LocalLauncher\web.pid`（`web` コマンド起動時に書き込み）
- 旧フォーマット `port: number` → 新フォーマット `ports: number[]` を自動マイグレーション済み

### reloadConfig（設定再読み込み）

- `loadConfig()` → `syncServers()` → `broadcastState()` のみ
- **autoStartは走らない**（syncServers は状態同期のみ。新規IDには initState するだけ）

### 自動スタート（autoStart）

- `index.ts` の `web` コマンド起動後 300ms で `manager.start(id)` を呼ぶ
- `manager.start(id).catch(() => {})` でエラーをキャッチ（LocalLauncher自体は落ちない）
- 既にポートが使用中でも起動を試みる（portConflict フラグを立てるだけ）

## WebサーバーとUIの通信

- 全操作は WebSocket の JSON メッセージで行う（REST APIは未使用）
- サーバー → クライアント: `state`（全サーバー状態）, `log`, `portStatus`, `toast`, `configExport`, `detectedPorts`
- クライアント → サーバー: `start`, `stop`, `restart`, `addServer`, `editServer`, `removeServer`, `checkPortStatus`, `reloadConfig`, `openExplorer`, `openVSCode`, `openTerminal`, `openConfigFolder`, `exportConfig`, `importConfig`, `stdinInput`, `detectPorts`, `updateSettings`, `clearLogs`
- 状態配信は `scheduleState()` で50msデバウンス（onUpdateが頻繁に呼ばれるため）

## ブラウザUI（src/web/ui.html）

- 全CSS/JSをHTMLにインライン記述（単一ファイル）
- カラーパレット: `--bg`, `--sur`, `--sur2`, `--sur3`, `--bdr`, `--text`, `--dim`, `--green`, `--red`, `--yellow`, `--blue`, `--purple`, `--cyan`, `--accent`
- **`.hidden` クラスはコンポーネントごとに個別定義**（グローバルな `.hidden { display: none }` はない）  
  例: `#loading-overlay.hidden { display: none; }`
- ローディングオーバーレイ: WS接続前「接続中…」→ state受信後「autoStartサーバー一覧＋状態」→ 全サーバー最終状態で自動クローズ（15秒タイムアウトあり）
- ポートドット: `portStatus` 未受信中はパルスアニメーション表示

## グローバルエラーハンドリング（src/index.ts）

```typescript
process.on('uncaughtException',  err    => { console.error(...) });
process.on('unhandledRejection', reason => { console.error(...) });
```

→ サーバー起動失敗・パイプエラーでLocalLauncherが巻き添えで落ちないための安全網

## 開発・ビルドコマンド

```bash
bun run src/index.ts            # TUIダッシュボード
bun run src/index.ts web        # Web UI（http://localhost:7474）
bun run src/index.ts web --open # 起動後ブラウザを自動オープン
bun run build                   # local-launcher.exe を生成
```

## 注意事項

- `bun build --compile` ターゲットは Bun のみ（Node.exe では動かない）
- Windows前提の機能: `explorer.exe`, `taskkill`, `wscript.exe`, レジストリ Run キー登録
- `code`コマンド（VSCodeで開く）はVSCodeのPATH登録が必要（PATH.md参照）
- `shell: true` で spawn するため、コマンドインジェクションに注意。ユーザー入力をコマンドに直接埋め込まない
