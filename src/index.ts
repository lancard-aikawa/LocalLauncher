import { loadConfig, saveConfig, upsertServer, removeServer, getConfigPath, getWebPidPath } from './config';
import { ServerManager } from './manager';
import { Dashboard } from './dashboard';
import { promptServerForm } from './prompts';
import { checkPortAvailable, findDuplicatePorts } from './portChecker';
import { execSync } from 'child_process';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
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

      // bun.exe の実パスを解決する
      // where bun で見つかるのが .cmd シムの場合、その中から実際の exe パスを取得する
      let bunExePath: string;
      try {
        const whereBun = execSync('where bun', { encoding: 'utf-8' }).trim().split(/\r?\n/)[0].trim();
        if (whereBun.toLowerCase().endsWith('.exe')) {
          bunExePath = whereBun;
        } else {
          // .cmd / シムスクリプトの場合: 同ディレクトリの node_modules\bun\bin\bun.exe を探す
          const dir = join(whereBun, '..');
          const candidate = join(dir, 'node_modules', 'bun', 'bin', 'bun.exe');
          if (existsSync(candidate)) {
            bunExePath = candidate;
          } else {
            // フォールバック: bun.cmd を呼ぶ
            bunExePath = whereBun.replace(/\.[^.]+$/, '.cmd');
          }
        }
      } catch {
        console.error('bun が PATH に見つかりません。先に bun をインストールしてください。');
        process.exit(1);
      }

      const scriptPath = join(import.meta.dir, 'index.ts');
      const configDir = join(process.env.APPDATA!, 'LocalLauncher');
      const batPath   = join(configDir, 'autostart.bat');
      const logPath   = join(configDir, 'autostart.log');

      // 起動ログを記録するバッチファイル（手動実行でも動作確認できる）
      const bat = [
        '@echo off',
        `echo [%DATE% %TIME%] LocalLauncher autostart starting... >> "${logPath}"`,
        `"${bunExePath}" run "${scriptPath}" web >> "${logPath}" 2>&1`,
        `echo [%DATE% %TIME%] LocalLauncher process exited with code %ERRORLEVEL% >> "${logPath}"`,
      ].join('\r\n');
      writeFileSync(batPath, bat, 'utf-8');

      // VBScript: バッチを非表示で実行（%APPDATA%\LocalLauncher\ に配置）
      const vbs = [
        'Set WshShell = CreateObject("WScript.Shell")',
        `WshShell.Run "cmd /c """"${batPath}""""", 0, False`,
      ].join('\r\n');
      const vbsPath = join(configDir, 'autostart.vbs');
      writeFileSync(vbsPath, vbs, 'utf-8');

      // 旧スタートアップフォルダの VBS を削除
      const oldVbsPath = join(
        process.env.APPDATA!,
        'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
        'LocalLauncher.vbs'
      );
      if (existsSync(oldVbsPath)) {
        try { unlinkSync(oldVbsPath); } catch {}
      }

      // HKCU\Run レジストリキーに登録（スタートアップフォルダより早く実行される）
      try {
        execSync(
          `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "LocalLauncher" /t REG_SZ /d "\\"wscript.exe\\" \\"${vbsPath}\\"" /f`,
          { encoding: 'utf-8', stdio: 'pipe' }
        );
      } catch (e) {
        console.error('レジストリへの登録に失敗しました:');
        console.error((e as Error).message);
        process.exit(1);
      }

      console.log(`✓ 自動起動を登録しました（レジストリ Run キー）`);
      console.log(`\n起動ログ: ${logPath}`);
      console.log(`手動テスト: "${batPath}" を直接実行するとログに出力されます`);
      console.log('\n次回 Windows ログイン時に LocalLauncher が自動起動します。');
      console.log('削除するには: reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "LocalLauncher" /f\n');
      break;
    }

    // ─────────────────────────────────────────────── web ──────────────────
    case 'web': {
      const portEq  = rest.find(a => a.startsWith('--port=') || a.startsWith('-p='))?.split('=')[1];
      const portIdx = rest.findIndex(a => a === '--port' || a === '-p');
      const portArg = portEq ?? (portIdx >= 0 ? rest[portIdx + 1] : undefined);
      const requestedPort = parseInt(portArg ?? '7474', 10);
      const doOpen   = rest.includes('--open') || rest.includes('-o');

      // ── 既存インスタンスを自動停止（二重起動 / config競合を防ぐ） ────────
      const pidPath = getWebPidPath();
      if (existsSync(pidPath)) {
        const oldPid = parseInt(readFileSync(pidPath, 'utf-8').trim(), 10);
        if (!isNaN(oldPid) && oldPid > 0 && oldPid !== process.pid) {
          let alive = false;
          try { process.kill(oldPid, 0); alive = true; } catch {}
          if (alive) {
            console.log(`既存の Web UI（PID ${oldPid}）を停止しています…`);
            try {
              if (process.platform === 'win32') {
                execSync(`taskkill /F /T /PID ${oldPid}`, { stdio: 'ignore' });
              } else {
                process.kill(oldPid, 'SIGTERM');
              }
              // プロセスとポート解放を待つ
              await new Promise<void>(r => setTimeout(r, 500));
            } catch {}
          }
        }
        try { unlinkSync(pidPath); } catch {}
      }

      // 旧インスタンス停止後に config.json を再読み込み（最新状態を使う）
      const webCfg = loadConfig();

      // 指定ポートが塞がっていたら空きポートを自動で探す
      let webPort: number | undefined;
      for (let p = requestedPort; p < requestedPort + 10; p++) {
        if (await checkPortAvailable(p)) { webPort = p; break; }
      }
      if (webPort === undefined) {
        console.error(`✗ ポート ${requestedPort}〜${requestedPort + 9} がすべて使用中です。別のポートを --port で指定してください。`);
        process.exit(1);
      }
      if (webPort !== requestedPort) {
        console.log(`⚠ ポート ${requestedPort} は使用中のため、${webPort} を使用します。`);
      }

      const manager = new ServerManager(webCfg.servers, () => {});
      const { WebServer } = await import('./web/server');
      const webServer = new WebServer(manager, webCfg, webPort);
      webServer.start();

      // PID ファイルを書き込む（stop-web で参照する）
      try { writeFileSync(pidPath, String(process.pid), 'utf-8'); } catch {}

      if (doOpen) {
        try {
          if (process.platform === 'win32') execSync(`start http://localhost:${webPort}`);
          else if (process.platform === 'darwin') execSync(`open http://localhost:${webPort}`);
          else execSync(`xdg-open http://localhost:${webPort}`);
        } catch { /* ignore */ }
      }

      const autoIds = webCfg.servers.filter(s => s.autoStart).map(s => s.id);
      if (autoIds.length) {
        console.log(`[LocalLauncher] autoStart: [${autoIds.join(', ')}] を300ms後に起動します`);
        setTimeout(() => {
          console.log(`[LocalLauncher] autoStart: 起動開始`);
          for (const id of autoIds) manager.start(id).catch(() => {});
        }, 300);
      }

      // main() が完了するとプロセスが終了するため、明示的にシグナルまで待機する
      await new Promise<void>(resolve => {
        const shutdown = async () => {
          console.log('\nサーバーを停止中…');
          await manager.stopAll();
          try { unlinkSync(pidPath); } catch {}
          resolve();
        };
        process.once('SIGINT',  shutdown);
        process.once('SIGTERM', shutdown);
      });
      process.exit(0);
    }

    // ─────────────────────────────────────────────── stop-web ─────────────
    case 'stop-web': {
      const portArg2 = rest.find(a => /^\d+$/.test(a));
      const targetPort = parseInt(portArg2 ?? '7474', 10);

      const pidPath = getWebPidPath();

      // PID ファイルから取得（最も確実）
      let pidFromFile: string | null = null;
      if (existsSync(pidPath)) {
        pidFromFile = readFileSync(pidPath, 'utf-8').trim();
      }

      if (!pidFromFile) {
        console.log('Web UI の PID ファイルが見つかりません。すでに停止しているか、古いバージョンで起動した可能性があります。');
        console.log(`（手動で停止する場合: ポート ${targetPort} を使用しているプロセスを終了してください）`);
        break;
      }

      const pid = pidFromFile;
      if (process.platform === 'win32') {
        try {
          execSync(`taskkill /F /T /PID ${pid}`, { encoding: 'utf-8' });
          console.log(`✓ PID ${pid} を停止しました。`);
        } catch (e) {
          // プロセスが既に存在しない場合も PID ファイルは削除する
          const msg = (e as Error).message;
          if (msg.includes('not found') || msg.includes('見つかりません')) {
            console.log(`PID ${pid} はすでに停止しています。`);
          } else {
            console.error(`✗ 停止に失敗: ${msg}`);
          }
        }
      } else {
        try {
          process.kill(parseInt(pid, 10), 'SIGTERM');
          console.log(`✓ PID ${pid} を停止しました。`);
        } catch {
          console.log(`PID ${pid} はすでに停止しています。`);
        }
      }
      try { unlinkSync(pidPath); } catch { /* ignore */ }
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
  stop-web [port]     Web UI プロセスを停止（デフォルト: 7474）
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

// ストリームのエラーイベントなど、握り損ねた例外でプロセスが落ちないようにする
process.on('uncaughtException',    err    => { console.error('[LocalLauncher] uncaughtException:',    err.message); });
process.on('unhandledRejection',   reason => { console.error('[LocalLauncher] unhandledRejection:',   reason); });

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
