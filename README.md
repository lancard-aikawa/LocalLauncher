# LocalLauncher

ローカル開発用 Web サーバーをまとめて管理するランチャーツール。  
TUI ダッシュボード / ブラウザ Web UI の両方に対応しています。

## 特徴

- **複数ランタイム対応** — bun / node / npm / python / python3 / cmd / PowerShell / raw
- **複数ポート管理** — サーバーごとに複数ポートを登録してリアルタイムに状態確認
- **ポートステータス表示** — LISTENING 確認・競合・未応答を色で区別（Web UI）
- **ポート自動検出** — `firebase.json` / `.env` / `package.json` などからポートを自動取得
- **ブラウザ内インタラクティブターミナル** — xterm.js によるログ表示・stdin 入力転送
- **環境変数・作業ディレクトリ** — サーバーごとに個別設定
- **ポート競合チェック** — 起動時に自動検出・警告
- **自動起動** — ランチャー起動時に指定サーバーを自動スタート
- **カスタム停止コマンド** — Firebase Emulator のような特殊な停止手順にも対応
- **Detached モード** — 起動コマンドが即終了してバックグラウンドで動くプロセスに対応
- **3種類の起動方式** — ブラウザ内・Detached・外部ターミナルを使い分け
- **設定の永続化** — `%APPDATA%\LocalLauncher\config.json` に保存
- **設定の再読み込み / エクスポート / インポート** — Web UI から操作可能
- **シングルインスタンス管理** — `web` 起動時に旧インスタンスを自動停止
- **単体 exe 化** — `bun build --compile` で依存なしの実行ファイルを生成

---

## プロセスタイプ別の使い分け

> **ここを先に読んでください。** プロセスの種類に応じて設定を選ばないと、停止ボタンが効かない・ログが取れないといった問題が発生します。

| プロセスのタイプ | 具体例 | 推奨設定 |
|---|---|---|
| **常駐型**（stdout を出し続ける） | `bun dev`、`node server.js`、`python app.py` | デフォルト（何も変えない） |
| **即終了・バックグラウンド起動型** | `start.bat`、`Start-Process` 系、PID ファイルを書くスクリプト | **Detached モード ⎋** |
| **対話型**（キー入力が必要） | `pause` を含むバッチ、対話型 CLI | デフォルト（ブラウザ内ターミナルで入力可） |
| **外部ターミナルで操作したい** | GUIアプリの起動スクリプト、任意 | **ターミナルモード ⌨** |

### 各モードの詳細

#### デフォルト（ブラウザ内）

- stdout / stderr をキャプチャしてブラウザに表示
- キーボード入力をプロセスの stdin に転送（`pause` 等に対応）
- 停止ボタンでプロセスツリーをキル

#### ⎋ Detached モード

起動コマンドが即終了し、別プロセスがバックグラウンドで動き続けるタイプ向け。

- 起動コマンド終了後も **⎋ Detached**（シアン）で実行中扱い
- 設定したポートが全て閉じたら自動的に停止状態に遷移
- 停止ボタンで `stopCommand` を実行して実プロセスを終了
- **`stopCommand` の設定が必須**（未設定の場合は状態のリセットのみ）

> **推奨:** スクリプトを変更できる場合は、`start /b` や `Start-Process` をやめてサーバーを**フォアグラウンドで直接実行**する形に書き換えることを強く推奨します。フォアグラウンド実行にすることで、ログ取得・停止制御・ポート管理がすべて確実に動作します。Detached モードはスクリプトを変更できない場合の回避策です。
>
> ```bat
> @echo off
> cd /d "%~dp0"
> node server\index.js --port 3210
> ```

#### ⌨ ターミナルモード

- 設定したターミナル（PowerShell / cmd / Windows Terminal）でコマンドを実行
- LocalLauncher はプロセスを管理しない（ログ取得・停止制御なし）
- 停止ボタンは UI の状態リセットのみ（ウィンドウは手動で閉じる）

---

## 必要環境

- [Bun](https://bun.sh/) v1.0 以上
- Windows 10 / 11（macOS・Linux でも動作しますが主に Windows 向け）

## インストール

```bash
git clone <repo-url>
cd LocalLauncher
bun install
```

## 使い方

### TUI ダッシュボード

```bash
bun run src/index.ts
```

```
┌─ LOCAL LAUNCHER ───────────────────────────────────────────────────┐
│   ID               NAME                    PORT   STATUS           │
├────────────────────────────────────────────────────────────────────┤
│▶  firebase         Firebase Emulator       4000   ● Running 5m 3s  │
│   myapp            My App                  3000   ○ Stopped         │
│   api              Python API              8000   ✗ Error           │
├─ Logs: Firebase Emulator ──────────────────────────────────────────┤
│ [14:23:01] ✔ All emulators ready                                   │
│ [14:23:01] Auth      → localhost:9099                              │
│ [14:23:01] Firestore → localhost:8080                              │
├────────────────────────────────────────────────────────────────────┤
│ ↑↓:選択  s:起動  k:停止  r:再起動  a:追加  e:編集  d:削除  q:終了  │
└────────────────────────────────────────────────────────────────────┘
```

| キー | 操作 |
|------|------|
| `↑` / `↓` | サーバーを選択 |
| `s` | 起動 |
| `k` | 停止 |
| `r` | 再起動 |
| `a` | サーバーを追加（対話フォーム） |
| `e` | 選択サーバーを編集 |
| `d` | 選択サーバーを削除 |
| `l` | ログ消去 |
| `q` / `Ctrl+C` | 終了（実行中サーバーをすべて停止） |

### Web UI

```bash
bun run src/index.ts web            # http://localhost:7474 で起動
bun run src/index.ts web --open     # 起動後にブラウザを自動で開く
bun run src/index.ts web --port=8080
```

ブラウザで `http://localhost:7474` を開くとダッシュボードが表示されます。  
WebSocket でリアルタイムにログ・ステータスが更新されます。

#### ブラウザ内ターミナル

xterm.js による本格的なターミナルをブラウザ内に内蔵しています。

- ANSI カラーコードをネイティブに描画
- キーボード入力をプロセスの stdin にリアルタイム転送
- `pause` 待ちや対話型プロンプトにも対応

#### ポートステータス表示

サーバーカード内のポートバッジは実際のポート状態に応じて色が変わります（5秒ごとに更新）。

| 色 | 意味 |
|----|------|
| 緑 | ポートが LISTENING 中（正常稼働） |
| 黄 | サーバー実行中だがポートが未応答（起動途中・設定ミスの可能性） |
| 赤 | サーバー停止中なのにポートが占有されている（他プロセスが使用中） |

#### 設定メニュー（⚙ 設定）

| メニュー | 動作 |
|----------|------|
| 🔄 設定を再読み込み | `config.json` をディスクから再読み込みして UI に反映 |
| 📁 設定フォルダを開く | `%APPDATA%\LocalLauncher` を Explorer で開く |
| 📤 エクスポート | 現在の設定を `locallauncher-YYYY-MM-DD.json` としてダウンロード |
| 📥 インポート | JSON ファイルを選択して設定を全置き換え |

### CLIコマンド一覧

```bash
bun run src/index.ts add            # サーバーを対話形式で追加
bun run src/index.ts list           # 登録済みサーバーの一覧表示
bun run src/index.ts port-check     # ポートの空き状況を確認
bun run src/index.ts stop-web       # Web UI プロセスを停止（デフォルト: 7474）
bun run src/index.ts stop-web 8080  # ポート指定
bun run src/index.ts config-path    # 設定ファイルのパスを確認
bun run src/index.ts setup-autostart  # Windows ログイン時に自動起動を設定
```

#### stop-web について

`web` コマンドで起動したインスタンスを停止します。  
起動時に `%APPDATA%\LocalLauncher\web.pid` へ PID を記録し、`stop-web` でそれを参照して `taskkill` します。  
また `web` コマンドは起動時に既存インスタンスを自動停止するため、通常は明示的に `stop-web` を呼ぶ必要はありません。

---

## サーバー登録

サーバーの追加・編集時の各設定項目（ランタイムの違い・コマンドの書き方・起動モードの選択など）については [REGISTRATION.md](REGISTRATION.md) を参照してください。

---

## サーバー設定例

### bun / npm アプリ（デフォルト）

| 項目 | 値 |
|------|----|
| ランタイム | `bun` または `npm` |
| コマンド | `dev` |
| 作業ディレクトリ | `C:\projects\myapp` |
| ポート | `3000` |

### Firebase Emulator（デフォルト）

| 項目 | 値 |
|------|----|
| ランタイム | `cmd` |
| コマンド | `firebase emulators:start` |
| 作業ディレクトリ | `C:\projects\myapp` |
| ポート | `4000, 8080, 9099`（複数可） |
| stopCommand | `firebase emulators:stop` |
| 自動起動 | ✓ |

### バックグラウンド起動スクリプト（Detached モード）

`Start-Process` や別プロセス起動で即終了するバッチ・スクリプト向け。

| 項目 | 値 |
|------|----|
| ランタイム | `cmd` |
| コマンド | `start.bat` |
| 作業ディレクトリ | `C:\projects\myapp` |
| ポート | `13847` |
| **Detached モード** | **✓** |
| **stopCommand** | `powershell -Command "Stop-Process -Id (Get-Content .server.pid) -Force"` |

> **stopCommand は必ず設定してください。** 未設定の場合、停止ボタンは UI の状態をリセットするだけで実プロセスは停止しません。

### Python サーバー

| 項目 | 値 |
|------|----|
| ランタイム | `python` |
| コマンド | `server.py` |
| 追加引数 | `--host 0.0.0.0 --port 8000` |
| ポート | `8000` |

### PowerShell / バッチスクリプト

| 項目 | 値 |
|------|----|
| ランタイム | `powershell` |
| コマンド | `start.ps1` または `start.cmd` |
| 作業ディレクトリ | `C:\projects\myapp` |

> `.ps1` / `.cmd` / `.bat` ファイルはパスなしで指定しても自動的に `.\` が補完されます。

---

## Windows 自動起動の設定

ログイン時に LocalLauncher を自動起動するには:

```bash
bun run src/index.ts setup-autostart
```

以下のファイルが作成され、レジストリ `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` に登録されます。

| ファイル | 内容 |
|----------|------|
| `%APPDATA%\LocalLauncher\autostart.vbs` | 非表示ウィンドウで起動するスクリプト |
| `%APPDATA%\LocalLauncher\autostart.bat` | 実際の起動処理（手動実行で動作確認も可能） |
| `%APPDATA%\LocalLauncher\autostart.log` | 起動ログ（エラー確認に使用） |

解除するには:

```bash
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "LocalLauncher" /f
```

## 単体実行ファイルのビルド

Bun がインストールされていない環境でも動作する単体 exe を生成できます:

```bash
bun run build
# → local-launcher.exe
```

---

## ファイル構成

```
LocalLauncher/
├── src/
│   ├── types.ts          型定義
│   ├── config.ts         設定ファイル管理（読み書き・マイグレーション）
│   ├── portChecker.ts    ポート空き確認・重複検出
│   ├── portDetector.ts   設定ファイルからのポート自動検出
│   ├── manager.ts        プロセスライフサイクル管理
│   ├── prompts.ts        対話式フォーム（TUI用）
│   ├── dashboard.ts      TUI ダッシュボード
│   ├── index.ts          CLI エントリポイント
│   └── web/
│       ├── server.ts     HTTP + WebSocket サーバー
│       └── ui.html       ブラウザ UI（xterm.js 内蔵）
├── .gitignore
├── package.json
└── tsconfig.json
```

## 設定ファイル

設定は `%APPDATA%\LocalLauncher\config.json` に保存されます。  
直接編集後は Web UI の「⚙ 設定 → 🔄 設定を再読み込み」で反映できます。

```jsonc
{
  "version": 1,
  "servers": [
    {
      "id": "myapp",
      "name": "My App",
      "runtime": "bun",           // bun | node | npm | python | python3 | cmd | powershell | raw
      "command": "dev",
      "args": [],                 // 追加引数（省略可）
      "cwd": "C:\\projects\\myapp",
      "env": { "NODE_ENV": "development" },
      "ports": [3000],            // 複数指定可: [3000, 9000]
      "autoStart": false,
      "stopCommand": "",          // 省略時はプロセスツリーをキル
      "restartDelay": 1000,       // 再起動待機ms（省略時: 1000）
      "detached": false,          // true: 起動コマンド即終了タイプ（⎋ Detached モード）
      "launchMode": "browser"     // "browser"（デフォルト）| "terminal"（外部ターミナル）
    }
  ],
  "settings": {
    "preferredTerminal": "powershell"  // "powershell" | "cmd" | "wt"
  }
}
```

### ポート自動検出に対応するファイル

「🔍 検出」ボタンを押すと作業ディレクトリから以下のファイルを走査してポートを自動取得します。

| ファイル | 取得元 |
|----------|--------|
| `firebase.json` | `emulators.*.port` |
| `.env` / `.env.*` | `PORT`, `VITE_PORT` などの環境変数 |
| `package.json` | scripts 内のポート指定 |
| `vite.config.*` | `server.port` |
| `nuxt.config.*` | `devServer.port` |
