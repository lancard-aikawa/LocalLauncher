# PATH の設定

LocalLauncher の「VSCodeで開く」ボタンを使うには、各ツールのコマンドが PATH に登録されている必要があります。

---

## VSCode（`code` コマンド）

### 方法1: VSCode のコマンドパレットから登録（推奨）

1. VSCode を開く
2. `Ctrl+Shift+P` でコマンドパレットを開く
3. `Shell Command: Install 'code' command in PATH` を検索・実行

### 方法2: 手動で PATH に追加

VSCode のインストール先（通常 `%LOCALAPPDATA%\Programs\Microsoft VS Code\bin`）を環境変数 PATH に追加します。

1. `Win + R` → `sysdm.cpl` → Enter
2. 「詳細設定」タブ → 「環境変数」
3. ユーザー環境変数の `Path` を選択して「編集」
4. 「新規」で以下を追加：
   ```
   %LOCALAPPDATA%\Programs\Microsoft VS Code\bin
   ```
5. OK → ターミナルを再起動

### 確認方法

```powershell
code --version
```

---

## Bun（`bun` コマンド）

Bun のインストーラは自動で PATH を設定します。認識されない場合は以下を確認してください。

```powershell
# インストール済みか確認
bun --version

# 未インストールの場合
powershell -c "irm bun.sh/install.ps1 | iex"
```

インストール後にターミナルを再起動してください。
