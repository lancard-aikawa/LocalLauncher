# LocalLauncher

ローカル開発用 Web サーバーをまとめて管理するランチャーツール。  
TUI ダッシュボード / ブラウザ Web UI の両方に対応しています。

## 特徴

- **複数ランタイム対応** — bun / node / npm / python / python3 / cmd / PowerShell / raw
- **環境変数・作業ディレクトリ** — サーバーごとに個別設定
- **ポート競合チェック** — 起動時に自動検出・警告
- **自動起動** — ランチャー起動時に指定サーバーを自動スタート
- **カスタム停止コマンド** — Firebase Emulator のような特殊な停止手順にも対応
- **2種類のUI** — TUI（ターミナル）とブラウザ Web UI を状況に応じて使い分け
- **設定の永続化** — `%APPDATA%\LocalLauncher\config.json` に保存
- **単体 exe 化** — `bun build --compile` で依存なしの実行ファイルを生成

## 必要環境

- [Bun](https://bun.sh/) v1.0 以上
- Windows 10 / 11（macOS・Linux でも動作しますが主に Windows 向け）

## インストール

```bash
git clone <repo-url>
cd LocalLauncher
```

外部パッケージへの依存はないため `bun install` は不要です。

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

ブラウザで http://localhost:7474 を開くとダッシュボードが表示されます。  
WebSocket でリアルタイムにログ・ステータスが更新されます。

### その他のコマンド

```bash
# サーバーを対話形式で追加
bun run src/index.ts add

# 登録済みサーバーの一覧表示
bun run src/index.ts list

# ポートの空き状況を確認
bun run src/index.ts port-check

# 設定ファイルのパスを確認
bun run src/index.ts config-path

# Windows ログイン時に自動起動を設定
bun run src/index.ts setup-autostart
```

## サーバー設定例

### Firebase Emulator

| 項目 | 値 |
|------|----|
| ランタイム | `cmd` |
| コマンド | `firebase emulators:start` |
| 作業ディレクトリ | `C:\projects\myapp` |
| ポート | `4000` |
| 環境変数 | `FIREBASE_TOKEN=xxxx` |
| 自動起動 | ✓ |

### npm / bun アプリ

| 項目 | 値 |
|------|----|
| ランタイム | `bun` または `npm` |
| コマンド | `dev` |
| 作業ディレクトリ | `C:\projects\myapp` |
| ポート | `3000` |

### Python サーバー

| 項目 | 値 |
|------|----|
| ランタイム | `python` |
| コマンド | `server.py` |
| 追加引数 | `--host 0.0.0.0 --port 8000` |
| ポート | `8000` |

### PowerShell スクリプト

| 項目 | 値 |
|------|----|
| ランタイム | `powershell` |
| コマンド | `.\start.ps1` |
| 作業ディレクトリ | `C:\projects\myapp` |

## Windows 自動起動の設定

ログイン時に LocalLauncher を自動起動するには:

```bash
bun run src/index.ts setup-autostart
```

`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\LocalLauncher.vbs` が作成され、  
次回ログイン時からバックグラウンドで起動します。

解除するには上記の `.vbs` ファイルを削除してください。

## 単体実行ファイルのビルド

Bun がインストールされていない環境でも動作する単体 exe を生成できます:

```bash
bun run build
# → local-launcher.exe (約110MB)
```

## ファイル構成

```
LocalLauncher/
├── src/
│   ├── types.ts        型定義
│   ├── config.ts       設定ファイル管理
│   ├── portChecker.ts  ポート確認
│   ├── manager.ts      プロセスライフサイクル管理
│   ├── prompts.ts      対話式フォーム（TUI用）
│   ├── dashboard.ts    TUI ダッシュボード
│   ├── index.ts        CLI エントリポイント
│   └── web/
│       ├── server.ts   HTTP + WebSocket サーバー
│       └── ui.html     ブラウザ UI
├── .gitignore
├── package.json
└── tsconfig.json
```

## 設定ファイル

設定は `%APPDATA%\LocalLauncher\config.json` に保存されます。  
直接編集することも可能です。

```jsonc
{
  "version": 1,
  "servers": [
    {
      "id": "firebase",
      "name": "Firebase Emulator",
      "runtime": "cmd",
      "command": "firebase emulators:start",
      "cwd": "C:\\projects\\myapp",
      "env": {
        "FIREBASE_TOKEN": "xxxx"
      },
      "port": 4000,
      "autoStart": true,
      "stopCommand": ""        // 省略時はプロセスツリーをキル
    }
  ]
}
```
