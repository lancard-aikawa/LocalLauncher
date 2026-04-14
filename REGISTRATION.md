# サーバー登録ガイド

サーバーを追加・編集する際の各設定項目の説明です。

登録方法:
- TUI: `a` キー（追加）/ `e` キー（編集）
- CLI: `bun run src/index.ts add`
- Web UI: 「＋ サーバーを追加」ボタン

---

## 設定項目一覧

### サーバー名 / ID

| 項目 | 説明 |
|------|------|
| **サーバー名** | UI 上に表示される任意の名前 |
| **ID** | 内部識別子。英数字・ハイフンのみ。名前から自動生成されるが変更可能 |

---

### ランタイム

**ランタイムの選択は実行に直接影響します。** 単なるラベルではなく、実際に起動するプロセスが変わります。

| ランタイム | 実際に実行されるコマンド | `command` に指定するもの |
|---|---|---|
| `bun` | `bun run <command>` | スクリプト名またはファイル（例: `dev`, `src/server.ts`） |
| `node` | `node <command>` | JS ファイルパス（例: `server.js`） |
| `npm` | `npm run <command>` | `package.json` のスクリプト名（例: `dev`） |
| `python` | `python <command>` | Python ファイルパス（例: `main.py`） |
| `python3` | `python3 <command>` | Python ファイルパス（例: `main.py`） |
| `cmd` | `cmd /c "chcp 65001 & <command>"` | コマンドまたはバッチスクリプト（例: `firebase emulators:start`） |
| `powershell` | `powershell -Command <command>` | PS コマンドまたはスクリプトパス（例: `start.ps1`） |
| `raw` | `<command>` をそのまま分割して実行 | フルコマンドライン（例: `C:\tools\server.exe --port 3000`） |

#### `cmd` / `powershell` の補足

- **`cmd`** — 文字化けを防ぐため起動時に `chcp 65001`（UTF-8）を自動適用します。
- **`powershell`** — `.ps1` / `.cmd` / `.bat` をパスなしで指定した場合、`.\` を自動補完します（PowerShell はカレントディレクトリを暗黙に探しません）。また `OutputEncoding` を UTF-8 に設定してから実行します。
- **`raw`** — `command` をそのままスペース分割してプロセスに渡します。他のランタイムでは不可能なフルパス指定・引数一体型コマンドに使います。

---

### コマンド・追加引数

| 項目 | 説明 |
|------|------|
| **コマンド** (`command`) | ランタイムに渡す主コマンド。ランタイムによって意味が異なります（上表参照） |
| **追加引数** (`args`) | コマンドの後ろに追加するオプション（スペース区切り）。例: `--host 0.0.0.0 --port 8000` |

---

### 実行環境

| 項目 | 説明 |
|------|------|
| **作業ディレクトリ** (`cwd`) | プロセスの起動ディレクトリ。省略時は LocalLauncher のカレントディレクトリ |
| **環境変数** (`env`) | `NAME=VALUE` 形式で追加する環境変数。システム環境変数を上書き可能 |

---

### ポート・起動制御

| 項目 | 説明 |
|------|------|
| **ポート番号** (`ports`) | 複数指定可（カンマ / スペース区切り）。ポート競合チェックおよびブラウザリンク用 |
| **自動起動** (`autoStart`) | ランチャー起動時にこのサーバーを自動スタートする |
| **カスタム停止コマンド** (`stopCommand`) | 停止ボタンを押したときに実行するコマンド。省略時はプロセスツリーをキル |

---

### 起動モード

プロセスの性質に合わせて選択します。詳細は [README の「プロセスタイプ別の使い分け」](README.md#プロセスタイプ別の使い分け) を参照してください。

| フィールド | 値 | 説明 |
|---|---|---|
| `launchMode` | `browser`（デフォルト） | ログ取得付きで内部起動。ブラウザ上でログ確認・stdin 入力が可能 |
| `launchMode` | `terminal` | 設定済みの外部ターミナル（PowerShell / cmd / WT）で起動。ログ管理は行わない |
| `detached` | `true` | 起動コマンドが即終了し、別プロセスがバックグラウンドで動くタイプ向け。`stopCommand` の設定が実質必須 |

---

## 設定例

### bun / npm アプリ

```jsonc
{
  "runtime": "bun",
  "command": "dev",
  "cwd": "C:\\projects\\myapp",
  "ports": [3000]
}
```

### Firebase Emulator

```jsonc
{
  "runtime": "cmd",
  "command": "firebase emulators:start",
  "cwd": "C:\\projects\\myapp",
  "ports": [4000, 8080, 9099],
  "stopCommand": "firebase emulators:stop",
  "autoStart": true
}
```

### Python サーバー

```jsonc
{
  "runtime": "python",
  "command": "server.py",
  "args": ["--host", "0.0.0.0", "--port", "8000"],
  "ports": [8000]
}
```

### フルパス実行（raw）

```jsonc
{
  "runtime": "raw",
  "command": "C:\\tools\\myserver.exe --port 3000 --mode prod",
  "ports": [3000]
}
```

### PowerShell スクリプト

```jsonc
{
  "runtime": "powershell",
  "command": "start.ps1",
  "cwd": "C:\\projects\\myapp"
}
```

> `.ps1` / `.cmd` / `.bat` はパスなしで指定しても `.\` が自動補完されます。
