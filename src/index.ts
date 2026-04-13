import { loadConfig, saveConfig, upsertServer, removeServer, getConfigPath } from './config';
import { ServerManager } from './manager';
import { Dashboard } from './dashboard';
import { promptServerForm } from './prompts';
import { checkPortAvailable, findDuplicatePorts } from './portChecker';
import { execSync } from 'child_process';
import { writeFileSync } from 'fs';
import { join } from 'path';

const [,, cmd, ...rest] = process.argv;

async function main() {
  const cfg = loadConfig();

  switch (cmd) {

    // ─────────────────────────────────────────────── list ──────────────────
    case 'list': {
      if (!cfg.servers.length) { console.log('サーバーが登録されていません。'); break; }
      const W = 72;
      console.log(`\n${'─'.repeat(W)}`);
      console.log(
        ' ' + 'ID'.padEnd(18) + 'NAME'.padEnd(20) + 'PORT'.padEnd(7)
        + 'RUNTIME'.padEnd(13) + 'AUTO'
      );
      console.log('─'.repeat(W));
      for (const s of cfg.servers) {
        const auto = s.autoStart ? ' ★' : '  ';
        console.log(
          ' ' + s.id.padEnd(18) + s.name.padEnd(20)
          + (s.ports?.join(',') ?? '-').padEnd(14)
          + s.runtime.padEnd(13) + auto
        );
      }
      console.log('─'.repeat(W));
      console.log(`\n設定ファイル: ${getConfigPath()}\n`);
      break;
    }

    // ─────────────────────────────────────────────── add ───────────────────
    case 'add': {
      const ids = cfg.servers.map(s => s.id);
      const server = await promptServerForm(ids);
      if (server) {
        saveConfig(upsertServer(cfg, server));
        console.log(`\n✓ '${server.name}' を追加しました。`);
      }
      break;
    }

    // ─────────────────────────────────────────────── remove ────────────────
    case 'remove': {
      const id = rest[0];
      if (!id) { console.error('使用法: bun run src/index.ts remove <id>'); process.exit(1); }
      if (!cfg.servers.find(s => s.id === id)) {
        console.error(`'${id}' が見つかりません。`); process.exit(1);
      }
      saveConfig(removeServer(cfg, id));
      console.log(`✓ '${id}' を削除しました。`);
      break;
    }

    // ─────────────────────────────────────────────── port-check ────────────
    case 'port-check': {
      const targets = cfg.servers.filter(s => s.ports?.length);
      if (!targets.length) { console.log('ポートが設定されたサーバーはありません。'); break; }

      const dupes = findDuplicatePorts(cfg.servers);
      console.log('\nポート空き確認:');
      for (const s of targets) {
        for (const port of s.ports!) {
          const free = await checkPortAvailable(port);
          const dupe = dupes.has(port) ? ' ⚠ 設定が重複' : '';
          const mark = free ? '✓ 空き  ' : '✗ 使用中';
          console.log(`  ${s.name.padEnd(26)} :${String(port).padEnd(6)} ${mark}${dupe}`);
        }
      }
      console.log('');
      break;
    }

    // ─────────────────────────────────────────────── setup-autostart ───────
    case 'setup-autostart': {
      if (process.platform !== 'win32') {
        console.error('setup-autostart は Windows 専用です。');
        process.exit(1);
      }

      const startupDir = join(
        process.env.APPDATA!,
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'
      );

      // bun の絶対パスを取得
      let bunPath: string;
      try {
        bunPath = execSync('where bun', { encoding: 'utf-8' }).trim().split(/\r?\n/)[0].trim();
      } catch {
        console.error('bun が PATH に見つかりません。先に bun をインストールしてください。');
        process.exit(1);
      }

      const scriptPath = join(import.meta.dir, 'index.ts');

      // ウィンドウを表示せずに起動する VBScript
      const vbs = [
        'Set WshShell = CreateObject("WScript.Shell")',
        `WshShell.Run """${bunPath}"" run ""${scriptPath}""", 0, False`,
      ].join('\r\n');

      const vbsPath = join(startupDir, 'LocalLauncher.vbs');
      writeFileSync(vbsPath, vbs, 'utf-8');

      console.log(`✓ スタートアップに登録しました:`);
      console.log(`  ${vbsPath}`);
      console.log('\n次回 Windows ログイン時に LocalLauncher が自動起動します。');
      console.log('削除するには上記ファイルを削除してください。\n');
      break;
    }

    // ─────────────────────────────────────────────── web ──────────────────
    case 'web': {
      const portEq  = rest.find(a => a.startsWith('--port=') || a.startsWith('-p='))?.split('=')[1];
      const portIdx = rest.findIndex(a => a === '--port' || a === '-p');
      const portArg = portEq ?? (portIdx >= 0 ? rest[portIdx + 1] : undefined);
      const webPort = parseInt(portArg ?? '7474', 10);
      const doOpen   = rest.includes('--open') || rest.includes('-o');

      const manager = new ServerManager(cfg.servers, () => {});
      const { WebServer } = await import('./web/server');
      const webServer = new WebServer(manager, cfg, webPort);
      webServer.start();

      if (doOpen) {
        try {
          if (process.platform === 'win32') execSync(`start http://localhost:${webPort}`);
          else if (process.platform === 'darwin') execSync(`open http://localhost:${webPort}`);
          else execSync(`xdg-open http://localhost:${webPort}`);
        } catch { /* ignore */ }
      }

      const autoIds = cfg.servers.filter(s => s.autoStart).map(s => s.id);
      if (autoIds.length) {
        setTimeout(() => {
          for (const id of autoIds) manager.start(id).catch(() => {});
        }, 300);
      }

      // main() が完了するとプロセスが終了するため、明示的にシグナルまで待機する
      await new Promise<void>(resolve => {
        const shutdown = async () => {
          console.log('\nサーバーを停止中…');
          await manager.stopAll();
          resolve();
        };
        process.once('SIGINT',  shutdown);
        process.once('SIGTERM', shutdown);
      });
      process.exit(0);
      break;
    }

    // ─────────────────────────────────────────────── config-path ───────────
    case 'config-path': {
      console.log(getConfigPath());
      break;
    }

    // ─────────────────────────────────────────────── help ──────────────────
    case 'help':
    case '--help':
    case '-h': {
      printHelp();
      break;
    }

    // ─────────────────────────────────────────────── dashboard (default) ───
    default: {
      if (cmd && cmd !== 'dashboard') {
        console.error(`不明なコマンド: '${cmd}'`);
        printHelp();
        process.exit(1);
      }

      const manager = new ServerManager(cfg.servers, () => {});
      const dashboard = new Dashboard(manager, cfg);

      // 終了シグナルを捕捉して全停止
      process.on('SIGINT',  () => gracefulExit(dashboard, manager));
      process.on('SIGTERM', () => gracefulExit(dashboard, manager));

      dashboard.start();

      // autoStart サーバーを起動（dashboard描画後に開始）
      const autoIds = cfg.servers.filter(s => s.autoStart).map(s => s.id);
      if (autoIds.length) {
        setTimeout(() => {
          for (const id of autoIds) manager.start(id).catch(() => {});
        }, 150);
      }
      break;
    }
  }
}

function gracefulExit(dashboard: Dashboard, manager: ServerManager): void {
  dashboard.shutdown();
  manager.stopAll().then(() => process.exit(0));
}

function printHelp(): void {
  console.log(`
LocalLauncher — ローカル Web サーバーランチャー

使用法:
  bun run src/index.ts [コマンド]

コマンド:
  (なし)              TUI ダッシュボードを起動
  web [--port=7474]   ブラウザ向け Web UI サーバーを起動
        [--open|-o]     起動時にブラウザを自動で開く
  add                 サーバーを対話形式で追加
  remove <id>         サーバーを削除
  list                登録済みサーバー一覧を表示
  port-check          全ポートの空き状況を確認
  setup-autostart     Windows ログイン時に自動起動を設定 (Windows のみ)
  config-path         設定ファイルのパスを表示
  help                このヘルプを表示

ダッシュボード操作:
  ↑↓   サーバーを選択
  s     起動
  k     停止 (Kill)
  r     再起動
  a     追加
  e     編集
  d     削除
  l     ログ消去
  q     終了 (実行中サーバーをすべて停止)
`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
