# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright"]
# ///
"""デモ環境 (架空の sakura-shop) を立ち上げて Web UI を撮る。

    uv run demo/shoot.py

- 設定は一時フォルダ (APPDATA を差し替え) に作るので、普段使いの設定と Web UI (7474) には触れない
- ブラウザは Windows の Edge を使う (playwright の Chromium を入れなくてよい)
- 撮った画像は docs/images/ に書く。終わったら LocalLauncher とダミーサーバーをまとめて止める
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DEMO = ROOT / "demo"
OUT = ROOT / "docs" / "images"
UI_PORT = 27474  # 普段使い (7474) と分ける。ダミーのポートも 2 万番台にして他のプロジェクトと重ねない
FAKE = str(DEMO / "fake-server.mjs")


def servers() -> list[dict]:
    return [
        {"id": "shop-web", "name": "sakura-shop Web (Vite)", "runtime": "node", "command": FAKE,
         "args": ["web", "25173"], "ports": [25173], "cwd": str(DEMO), "autoStart": True},
        {"id": "shop-api", "name": "sakura-shop API", "runtime": "bun", "command": FAKE,
         "args": ["api", "23000"], "ports": [23000], "cwd": str(DEMO), "autoStart": True},
        {"id": "firebase", "name": "Firebase Emulator", "runtime": "node", "command": FAKE,
         "args": ["firebase", "24000", "29099", "28080"], "ports": [24000, 29099, 28080], "cwd": str(DEMO),
         "autoStart": True},
        {"id": "docs", "name": "ドキュメント (MkDocs)", "runtime": "python", "command": "-m",
         "args": ["http.server", "28000"], "ports": [28000], "cwd": str(DEMO)},
        # API とポートが重なっている例 (設定の重複として表示される)
        {"id": "admin", "name": "管理画面", "runtime": "node", "command": FAKE,
         "args": ["admin", "23000"], "ports": [23000], "cwd": str(DEMO)},
    ]


def wait_http(url: str, timeout: float = 15) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            urllib.request.urlopen(url, timeout=1)
            return
        except OSError:
            time.sleep(0.3)
    raise TimeoutError(url)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    appdata = Path(tempfile.mkdtemp(prefix="ll-demo-"))
    (appdata / "LocalLauncher").mkdir()
    cfg = {"version": 1, "servers": servers(), "settings": {"preferredTerminal": "powershell"}}
    (appdata / "LocalLauncher" / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")

    env = {**os.environ, "APPDATA": str(appdata)}
    log = open(appdata / "launcher.log", "w", encoding="utf-8")
    proc = subprocess.Popen(["bun", "run", "src/index.ts", "web", f"--port={UI_PORT}"], cwd=ROOT, env=env,
                            stdout=log, stderr=subprocess.STDOUT)
    print(f"ログ: {appdata / 'launcher.log'}")
    try:
        url = f"http://localhost:{UI_PORT}/"
        wait_http(url)
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge")
            page = browser.new_page(viewport={"width": 1280, "height": 760})
            page.goto(url)
            page.wait_for_selector("text=sakura-shop Web (Vite)")
            page.click("text=sakura-shop Web (Vite)")
            # 起動行 (▶ ダミーのパス / cwd) を消す。ダミーは起動メッセージを 3 秒遅らせて出す (fake-server.mjs)
            page.wait_for_selector("text=cwd:")
            page.click("text=ログ消去")
            time.sleep(0.5)
            if page.locator("text=ready in").count():
                raise RuntimeError("ログ消去が起動メッセージに間に合わなかった。BANNER_DELAY_MS を延ばす")
            for p in (25173, 23000, 24000):
                wait_http(f"http://localhost:{p}/")
            time.sleep(9)  # 起動メッセージとログが溜まり、ポートの状態 (5 秒ごと) と稼働時間が入るまで待つ
            page.screenshot(path=str(OUT / "web-ui.png"))
            page.click("text=＋ 追加")
            time.sleep(1)
            page.screenshot(path=str(OUT / "add-server.png"))
            browser.close()
    finally:
        # LocalLauncher とその子 (ダミーサーバー) をまとめて止める
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
    for name in ("web-ui.png", "add-server.png"):
        print(OUT / name)


if __name__ == "__main__":
    main()
