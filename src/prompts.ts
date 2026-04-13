import readline from 'readline';
import type { Runtime, ServerConfig } from './types';
import { generateId } from './config';

export const RUNTIMES: Runtime[] = [
  'bun', 'node', 'npm', 'python', 'python3', 'cmd', 'powershell', 'raw',
];

const RUNTIME_HINT: Record<Runtime, string> = {
  bun:        'スクリプト名またはファイル (例: dev, src/server.ts)',
  node:       'JSファイルパス (例: server.js)',
  npm:        'package.jsonのスクリプト名 (例: dev)',
  python:     'Pythonファイルパス (例: main.py)',
  python3:    'Pythonファイルパス (例: main.py)',
  cmd:        'コマンドまたはスクリプト (例: firebase emulators:start)',
  powershell: 'PSコマンドまたはスクリプトパス (例: .\\start.ps1)',
  raw:        'フルコマンド (例: C:\\tools\\server.exe --port 3000)',
};

// ─── readline ヘルパー ───────────────────────────────────────────────────────

function makeRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
}

function ask(rl: readline.Interface, q: string, def?: string): Promise<string> {
  const prompt = def !== undefined ? `${q} [${def}]: ` : `${q}: `;
  return new Promise(res => rl.question(prompt, ans => res(ans.trim() || def || '')));
}

function askOpt(rl: readline.Interface, q: string, def?: string): Promise<string | undefined> {
  const prompt = def ? `${q} [${def}]: ` : `${q} (空でスキップ): `;
  return new Promise(res => rl.question(prompt, ans => {
    const v = ans.trim();
    res(v !== '' ? v : (def ?? undefined));
  }));
}

function askBool(rl: readline.Interface, q: string, def = false): Promise<boolean> {
  return new Promise(res => rl.question(`${q} [${def ? 'Y/n' : 'y/N'}]: `, ans => {
    const v = ans.trim().toLowerCase();
    res(v === '' ? def : v === 'y' || v === 'yes');
  }));
}

function askPorts(rl: readline.Interface, q: string, def?: number[]): Promise<number[]> {
  const defStr = def?.length ? def.join(', ') : undefined;
  const prompt = defStr ? `${q} [${defStr}]: ` : `${q} (空でスキップ): `;
  return new Promise(res => rl.question(prompt, ans => {
    const v = ans.trim();
    if (!v) return res(def ?? []);
    res(
      v.split(/[\s,]+/)
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n) && n > 0 && n < 65536)
    );
  }));
}

// ─── サーバー追加/編集フォーム ───────────────────────────────────────────────

/**
 * インタラクティブにサーバー設定を入力するフォーム。
 * - existing を渡すと編集モード（デフォルト値が埋まる）
 * - キャンセル時は null を返す
 */
export async function promptServerForm(
  existingIds: string[],
  existing?: ServerConfig,
): Promise<ServerConfig | null> {
  const rl = makeRl();

  try {
    const SEP = '─'.repeat(52);
    console.log(`\n${SEP}`);
    console.log(existing ? '  サーバー編集' : '  新規サーバー追加');
    console.log(`${SEP}\n`);

    // ── 基本情報
    const name = await ask(rl, 'サーバー名', existing?.name);
    if (!name) { console.log('キャンセルしました。'); return null; }

    const suggestedId = existing?.id ?? generateId(name, existingIds);
    const id = await ask(rl, 'ID (英数字・ハイフン)', suggestedId);
    if (!id) { console.log('キャンセルしました。'); return null; }

    // ── ランタイム選択
    console.log('\nランタイム:');
    RUNTIMES.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
    const defRtIdx = existing ? String(RUNTIMES.indexOf(existing.runtime) + 1) : undefined;
    const rtStr = await ask(rl, '番号を選択', defRtIdx);
    const rtNum = parseInt(rtStr, 10);
    if (isNaN(rtNum) || rtNum < 1 || rtNum > RUNTIMES.length) {
      console.log('無効な選択です。キャンセルしました。'); return null;
    }
    const runtime = RUNTIMES[rtNum - 1];

    // ── コマンド
    const command = await ask(rl, `\nコマンド (${RUNTIME_HINT[runtime]})`, existing?.command);
    if (!command) { console.log('キャンセルしました。'); return null; }

    // ── 追加引数
    const argsRaw = await askOpt(rl, '追加引数 (スペース区切り)', existing?.args?.join(' '));
    const args = argsRaw ? argsRaw.split(/\s+/).filter(Boolean) : undefined;

    // ── 作業ディレクトリ
    const cwd = await askOpt(rl, '作業ディレクトリ (カレントで良ければ空)', existing?.cwd);

    // ── 環境変数
    const env: Record<string, string> = existing?.env ? { ...existing.env } : {};
    if (Object.keys(env).length > 0) {
      console.log('\n現在の環境変数:');
      for (const [k, v] of Object.entries(env)) console.log(`  ${k}=${v}`);
    }
    console.log('\n環境変数 (NAME=VALUE 形式、空行で完了):');
    while (true) {
      const line = await askOpt(rl, '');
      if (!line) break;
      const eq = line.indexOf('=');
      if (eq < 0) { console.log('  ※ 形式: NAME=VALUE'); continue; }
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1);
      if (k) { env[k] = v; console.log(`  ✓ ${k}=${v}`); }
    }

    // ── ポート・起動設定
    const ports     = await askPorts(rl, '\nポート番号 (複数はカンマ/スペース区切り、例: 4000, 9099, 8080)', existing?.ports);
    const autoStart = await askBool(rl, 'ランチャー起動時に自動スタート?', existing?.autoStart ?? false);
    const stopCommand = await askOpt(rl, 'カスタム停止コマンド (空でプロセスキル)', existing?.stopCommand);

    const server: ServerConfig = {
      id,
      name,
      runtime,
      command,
      ...(args?.length ? { args } : {}),
      ...(cwd ? { cwd } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...(ports.length ? { ports } : {}),
      autoStart,
      ...(stopCommand ? { stopCommand } : {}),
    };

    // ── 確認
    console.log('\n── 確認 ' + '─'.repeat(44));
    console.log(JSON.stringify(server, null, 2));
    const ok = await askBool(rl, 'この内容で保存しますか?', true);
    return ok ? server : null;

  } finally {
    rl.close();
  }
}
