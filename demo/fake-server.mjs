// デモ用のダミーサーバー (画面の撮影用)。node でも bun でも動く。
//   node demo/fake-server.mjs <web|api|firebase|admin> <port> [port...]
// 指定したポートで待ち受け、それらしいログを出し続ける。中身は何もしない。
import http from 'node:http';

const [kind = 'web', ...rest] = process.argv.slice(2);
const ports = rest.map(Number).filter(Boolean);
const c = { dim: '\x1b[2m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m', yellow: '\x1b[33m', reset: '\x1b[0m' };
const now = () => new Date().toTimeString().slice(0, 8);
const log = (s) => console.log(s);

for (const port of ports) {
  http.createServer((_, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>sakura-shop ${kind}</h1><p>LocalLauncher のデモ用ダミーサーバー (:${port})</p>`);
  }).listen(port, '127.0.0.1');
}

const banner = {
  web: () => {
    log(`\n  ${c.green}${c.bold}VITE${c.reset}  ${c.dim}ready in${c.reset} ${c.bold}412${c.reset} ms\n`);
    log(`  ${c.green}➜${c.reset}  ${c.bold}Local${c.reset}:   ${c.cyan}http://localhost:${ports[0]}/${c.reset}`);
    log(`  ${c.green}➜${c.reset}  ${c.dim}Network: use --host to expose${c.reset}\n`);
  },
  api: () => {
    log(`${c.dim}[${now()}]${c.reset} loading .env.development`);
    log(`${c.dim}[${now()}]${c.reset} connected to firestore emulator (localhost:28080)`);
    log(`${c.dim}[${now()}]${c.reset} ${c.green}API server listening on http://localhost:${ports[0]}${c.reset}`);
  },
  firebase: () => {
    log(`i  emulators: Starting emulators: auth, firestore`);
    log(`i  ui: Emulator UI logging to ui-debug.log`);
    log(`\n┌─────────────────────────────────────────────────────────────┐`);
    log(`│ ${c.green}✔  All emulators ready! It is now safe to connect your app.${c.reset} │`);
    log(`│ i  View Emulator UI at http://127.0.0.1:${ports[0]}/               │`);
    log(`└─────────────────────────────────────────────────────────────┘\n`);
    log(`  Authentication  127.0.0.1:${ports[1]}`);
    log(`  Firestore       127.0.0.1:${ports[2]}\n`);
  },
  admin: () => log(`${c.dim}[${now()}]${c.reset} admin console listening on http://localhost:${ports[0]}`),
};
// 開発中らしい動きを出す
const ticks = {
  web: [
    () => `${c.dim}${now()}${c.reset} ${c.cyan}${c.bold}[vite]${c.reset} ${c.green}hmr update${c.reset} ${c.dim}/src/pages/ProductList.tsx${c.reset}`,
    () => `${c.dim}${now()}${c.reset} ${c.cyan}${c.bold}[vite]${c.reset} ${c.green}hmr update${c.reset} ${c.dim}/src/components/CartButton.tsx${c.reset}`,
    () => `${c.dim}${now()}${c.reset} ${c.cyan}${c.bold}[vite]${c.reset} ${c.green}page reload${c.reset} ${c.dim}src/main.tsx${c.reset}`,
  ],
  api: [
    () => `${c.dim}[${now()}]${c.reset} GET /api/products ${c.green}200${c.reset} 12ms`,
    () => `${c.dim}[${now()}]${c.reset} GET /api/cart ${c.green}200${c.reset} 4ms`,
    () => `${c.dim}[${now()}]${c.reset} POST /api/cart/items ${c.green}201${c.reset} 18ms`,
    () => `${c.dim}[${now()}]${c.reset} GET /api/products/42 ${c.yellow}404${c.reset} 3ms`,
  ],
};
// 起動メッセージは少し遅らせる。撮影では、その前に LocalLauncher の起動行 (このファイルのパス) を
// 「ログ消去」で消してから撮る (demo/shoot.py)
const BANNER_DELAY_MS = 3000;
setTimeout(() => {
  (banner[kind] ?? banner.admin)();
  let i = 0;
  if (ticks[kind]) setInterval(() => log(ticks[kind][i++ % ticks[kind].length]()), 700);
}, BANNER_DELAY_MS);
