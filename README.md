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
- **並び替え** — Web UI で登録順 / 名前順 / 状態順に表示切替、上下ボタンで登録順を手動変更
- **設定の永続化** — `%APPDATA%\LocalLauncher\config.json` に保存
- **設定の再読み込み / エクスポート / インポート** — Web UI から操作可能
- **シングルインスタンス管理** — `web` 起動時に旧インスタンスを自動停止
- **単体 exe 化** — `bun build --compile` で依存なしの実行ファイルを生成

---

## ダウンロード（exe 版）

[Releases](https://github.com/lancard-aikawa/LocalLauncher/releases) の `LocalLauncher-<版>-win-x64.zip` を展開し、
`local-launcher.exe` を使います（Windows 10 / 11、Bun は不要）。

```bash
local-launcher.exe web --open     # Web UI を開く (http://localhost:7474)
local-launcher.exe                # TUI ダッシュボード
local-launcher.exe setup-autostart  # Windows ログイン時に Web UI を自動起動
```

- 以下の `bun run src/index.ts` は、exe 版では `local-launcher.exe` に読み替えてください
- 設定は `%APPDATA%\LocalLauncher\config.json` に保存されます（exe の場所には書き込みません）
- `setup-autostart` は、実行した exe の場所を登録します。exe を移動したら再実行してください
- 署名の無い exe なので、初回に SmartScreen の警告が出ることがあります（「詳細情報」→「実行」）

## ソースから動かす

### 必要環境

- [Bun](https://bun.sh/) v1.0 以上
- Windows 10 / 11（macOS・Linux でも動作しますが主に Windows 向け）

> `bun` / `code` コマンドが認識されない場合は [PATH.md](PATH.md) を参照してください。

### インストール

```bash
git clone https://github.com/lancard-aikawa/LocalLauncher.git
cd LocalLauncher
bun install
```

---

## 起動方法

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

> ブラウザ内ターミナル・ポートステータス・並び替え・設定メニューなどの操作詳細は [MANUAL.md](MANUAL.md#web-ui-の機能) を参照してください。

### CLI コマンド一覧

```bash
bun run src/index.ts add            # サーバーを対話形式で追加
bun run src/index.ts list           # 登録済みサーバーの一覧表示
bun run src/index.ts port-check     # ポートの空き状況を確認
bun run src/index.ts stop-web       # Web UI プロセスを停止（デフォルト: 7474）
bun run src/index.ts stop-web 8080  # ポート指定
bun run src/index.ts config-path    # 設定ファイルのパスを確認
bun run src/index.ts setup-autostart  # Windows ログイン時に自動起動を設定
```

> `web` コマンドは起動時に既存インスタンスを自動停止するため、通常 `stop-web` を明示的に呼ぶ必要はありません。Windows 自動起動の詳細は [MANUAL.md](MANUAL.md#windows-自動起動の設定) を参照してください。

---

## 単体実行ファイルのビルド

Bun がインストールされていない環境でも動作する単体 exe を生成できます:

```bash
bun run build
# → local-launcher.exe
```

---

## ドキュメント

| ドキュメント | 内容 |
|--------------|------|
| [MANUAL.md](MANUAL.md) | プロセスタイプ別の使い分け・各モードの詳細・Web UI 機能・サーバー設定例・設定ファイル（config.json）・ポート自動検出・自動起動・ファイル構成 |
| [REGISTRATION.md](REGISTRATION.md) | サーバー追加・編集時の各設定項目（ランタイム・コマンド・起動モード） |
| [PATH.md](PATH.md) | `bun` / `code` コマンドの PATH 設定 |

## ライセンス

MIT
