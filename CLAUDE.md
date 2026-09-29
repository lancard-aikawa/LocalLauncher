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
- **空き確認の listen ソケットが開いている間に子プロセスを起動しない。** Windows では子に引き継がれ、
  親が閉じても子が生きている間ポートが塞がる (autoStart の同時起動で、後のサーバーが EADDRINUSE で落ちた。1.0.1 で修正)。
  生き続ける子プロセス (サーバー・停止コマンド・ターミナル・VS Code・エクスプローラー・ブラウザ) を起動する直前に
  `await portChecksIdle()` を置き、そのあと await を挟まずに spawn / exec する。新しく子プロセスを起動する箇所を足すときも同じ
- 確かめ方: `uv run demo/shoot.py` (自動起動 3 本) の `launcher.log` に `exit code=1` が無いこと。
  塞がったときは `Get-NetTCPConnection -LocalPort <port>` の持ち主が LocalLauncher 自身の PID に見える
  (ソケットを作ったプロセスの PID が出るため。実際に持っているのは子)

### デモ環境（demo/）

- `uv run demo/shoot.py` で、架空の sakura-shop のサーバー 5 本を一時フォルダの設定で立ち上げ、
  Edge で Web UI を撮って `docs/images/` に書く。普段使いの設定と 7474 には触れない (APPDATA を差し替え、UI は 27474)
- ダミーは `demo/fake-server.mjs` (node / bun どちらでも動く)。ポートは 2 万番台にして他のプロジェクトと重ねない
- 起動行に出るダミーのパスは、撮影前に「ログ消去」で消す。そのためダミーは起動メッセージを 3 秒遅らせている

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
- クライアント → サーバー: `start`, `stop`, `restart`, `addServer`, `editServer`, `removeServer`, `reorderServers`, `checkPortStatus`, `reloadConfig`, `openExplorer`, `openVSCode`, `openTerminal`, `openConfigFolder`, `exportConfig`, `importConfig`, `stdinInput`, `detectPorts`, `updateSettings`, `clearLogs`
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
bun run build                   # local-launcher.exe を生成 (アイコン・版情報付き)
bun run icon                    # assets/icon.svg と icon-small.svg から assets/icon.ico を作り直す (uv が必要)
```

- アイコンの元は `assets/icon.svg` (48px 以上) と `assets/icon-small.svg` (32px 以下の簡略版)。
  SVG を直したら `bun run icon` で ICO を作り直してコミットする。Web UI の favicon は icon.svg をそのまま配信する
- 版を上げるときは `package.json` の `version` と、`build` の `--windows-version` の両方を直す

## 注意事項

- `bun build --compile` ターゲットは Bun のみ（Node.exe では動かない）
- **exe の中では `import.meta.url` / `import.meta.dir` が仮想パス (`B:\~BUN\root`) になる。**
  実行時に読むファイル (ui.html、node_modules の xterm) は `import x from '...' with { type: 'file' }` で
  読んで exe に同梱する。相対パスで `Bun.file` すると exe だけ 500 になる (1.0.0 の前に踏んだ)。
  exe 自身を起動し直すときは `process.execPath` を使う (`isCompiled` / `SELF` を参照)
- exe の確認は、`bun run build` のあと `APPDATA` を一時フォルダに向け、空いているポートで
  `local-launcher.exe web --port=<空き>` を起動して `/`・`/xterm.js`・`/xterm.css`・`/addon-fit.js` が 200 か見る。
  普段使いの Web UI (7474) は `web` の二重起動停止で落とされるので、`APPDATA` を分けずに試さない
- Windows前提の機能: `explorer.exe`, `taskkill`, `wscript.exe`, レジストリ Run キー登録
- `code`コマンド（VSCodeで開く）はVSCodeのPATH登録が必要（PATH.md参照）
- `shell: true` で spawn するため、コマンドインジェクションに注意。ユーザー入力をコマンドに直接埋め込まない
- `detached` は例外扱いしない。
- 停止・削除・再読込・終了は同じライフサイクル経路を通し、表示順と実行順は分けて管理する
