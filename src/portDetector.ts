import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export interface DetectedPort {
  port: number;
  source: string; // 例: "firebase.json (auth)"
}

// ─── 公開 API ─────────────────────────────────────────────────────────────────

export function detectPorts(cwd: string): DetectedPort[] {
  const results: DetectedPort[] = [];

  detectFirebase(cwd, results);
  detectEnv(cwd, results);
  detectPackageJson(cwd, results);
  detectViteConfig(cwd, results);
  detectNuxtConfig(cwd, results);
  detectAngularJson(cwd, results);
  detectDockerCompose(cwd, results);

  // ポート番号で重複除去（最初の検出ソースを優先）
  const seen = new Set<number>();
  return results.filter(r => {
    if (seen.has(r.port)) return false;
    seen.add(r.port);
    return true;
  });
}

// ─── firebase.json ────────────────────────────────────────────────────────────

function detectFirebase(cwd: string, out: DetectedPort[]): void {
  const p = join(cwd, 'firebase.json');
  if (!existsSync(p)) return;

  try {
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    const emulators = cfg?.emulators;
    if (!emulators || typeof emulators !== 'object') return;

    for (const [name, val] of Object.entries(emulators)) {
      if (typeof val !== 'object' || val === null) continue;
      const port = (val as Record<string, unknown>).port;
      if (typeof port === 'number' && isValidPort(port)) {
        out.push({ port, source: `firebase.json (${name})` });
      }
    }
  } catch { /* ignore */ }
}

// ─── .env 系 ─────────────────────────────────────────────────────────────────

const ENV_PORT_KEYS = [
  'PORT', 'VITE_PORT', 'NUXT_PORT', 'NEXT_PORT',
  'APP_PORT', 'SERVER_PORT', 'DEV_PORT', 'API_PORT',
  'BACKEND_PORT', 'FRONTEND_PORT',
];

function detectEnv(cwd: string, out: DetectedPort[]): void {
  const files = ['.env', '.env.local', '.env.development', '.env.development.local'];

  for (const file of files) {
    const p = join(cwd, file);
    if (!existsSync(p)) continue;

    try {
      const lines = readFileSync(p, 'utf-8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;

        const [rawKey, ...rest] = trimmed.split('=');
        const key = rawKey.trim();
        const val = rest.join('=').trim().replace(/^["']|["']$/g, '');

        if (ENV_PORT_KEYS.includes(key)) {
          const port = parseInt(val, 10);
          if (isValidPort(port)) out.push({ port, source: `${file} (${key})` });
        }
      }
    } catch { /* ignore */ }
  }
}

// ─── package.json ─────────────────────────────────────────────────────────────

function detectPackageJson(cwd: string, out: DetectedPort[]): void {
  const p = join(cwd, 'package.json');
  if (!existsSync(p)) return;

  try {
    const pkg = JSON.parse(readFileSync(p, 'utf-8'));

    // scripts 内の --port NNN / -p NNN
    for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) {
      const matches = String(cmd).matchAll(/(?:--port|-p)\s+(\d+)/g);
      for (const m of matches) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) out.push({ port, source: `package.json (scripts.${name})` });
      }
    }

    // トップレベル "port" フィールド
    if (typeof pkg.port === 'number' && isValidPort(pkg.port)) {
      out.push({ port: pkg.port, source: 'package.json (port)' });
    }
  } catch { /* ignore */ }
}

// ─── vite.config.{ts,js,mts,mjs} ────────────────────────────────────────────

function detectViteConfig(cwd: string, out: DetectedPort[]): void {
  const files = [
    'vite.config.ts', 'vite.config.mts',
    'vite.config.js', 'vite.config.mjs',
  ];

  for (const file of files) {
    const p = join(cwd, file);
    if (!existsSync(p)) continue;

    try {
      const content = readFileSync(p, 'utf-8');
      // server: { port: 3000 } / preview: { port: 4173 }
      const matches = content.matchAll(/\bport\s*:\s*(\d+)/g);
      for (const m of matches) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) out.push({ port, source: file });
      }
    } catch { /* ignore */ }
    return; // 最初に見つかったファイルだけ処理
  }
}

// ─── nuxt.config.{ts,js} ─────────────────────────────────────────────────────

function detectNuxtConfig(cwd: string, out: DetectedPort[]): void {
  const files = ['nuxt.config.ts', 'nuxt.config.js', 'nuxt.config.mjs'];

  for (const file of files) {
    const p = join(cwd, file);
    if (!existsSync(p)) continue;

    try {
      const content = readFileSync(p, 'utf-8');
      const m = content.match(/\bport\s*:\s*(\d+)/);
      if (m) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) out.push({ port, source: file });
      }
    } catch { /* ignore */ }
    return;
  }
}

// ─── angular.json ─────────────────────────────────────────────────────────────

function detectAngularJson(cwd: string, out: DetectedPort[]): void {
  const p = join(cwd, 'angular.json');
  if (!existsSync(p)) return;

  try {
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    for (const proj of Object.values(cfg?.projects ?? {})) {
      const port = (proj as any)?.architect?.serve?.options?.port;
      if (typeof port === 'number' && isValidPort(port)) {
        out.push({ port, source: 'angular.json (serve.options.port)' });
      }
    }
  } catch { /* ignore */ }
}

// ─── docker-compose.{yml,yaml} ───────────────────────────────────────────────

function detectDockerCompose(cwd: string, out: DetectedPort[]): void {
  const files = [
    'docker-compose.yml', 'docker-compose.yaml',
    'compose.yml', 'compose.yaml',
  ];

  for (const file of files) {
    const p = join(cwd, file);
    if (!existsSync(p)) continue;

    try {
      const content = readFileSync(p, 'utf-8');
      // "3000:3000" や '8080:80' 形式のホストポートを取得
      const matches = content.matchAll(/["']?(\d{2,5}):(\d{2,5})["']?/g);
      for (const m of matches) {
        const port = parseInt(m[1], 10);
        if (isValidPort(port)) out.push({ port, source: `${file} (host :${port})` });
      }
    } catch { /* ignore */ }
    return;
  }
}

// ─── ユーティリティ ───────────────────────────────────────────────────────────

function isValidPort(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 65535;
}
