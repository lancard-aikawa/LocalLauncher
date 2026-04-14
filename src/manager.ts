import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ServerConfig, ServerState, LauncherSettings } from './types';
import { checkPortAvailable } from './portChecker';

const execAsync = promisify(exec);
const IS_WIN = process.platform === 'win32';
const MAX_LOGS = 500;

/** ダブルクォートを考慮してコマンド文字列を引数配列に分割する */
function parseArgs(s: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === ' ' && !inQuote) { if (cur) { parts.push(cur); cur = ''; } }
    else { cur += ch; }
  }
  if (cur) parts.push(cur);
  return parts;
}

// ─── ランタイム別コマンド構築 ────────────────────────────────────────────────

/** terminal モード用: 実行するコマンド文字列を返す */
function buildCmdString(cfg: ServerConfig): string {
  const { runtime, command, args = [] } = cfg;
  const suffix = args.length ? ' ' + args.join(' ') : '';
  switch (runtime) {
    case 'bun':        return `bun run ${command}${suffix}`;
    case 'node':       return `node ${command}${suffix}`;
    case 'npm':        return `npm run ${command}${suffix}`;
    case 'python':     return `python ${command}${suffix}`;
    case 'python3':    return `python3 ${command}${suffix}`;
    case 'cmd':
    case 'powershell':
    case 'raw':        return `${command}${suffix}`;
  }
}

function buildCmd(cfg: ServerConfig): [string, string[]] {
  const { runtime, command, args = [] } = cfg;
  switch (runtime) {
    case 'bun':        return ['bun',        ['run', command, ...args]];
    case 'node':       return ['node',       [command, ...args]];
    case 'npm':        return ['npm',        ['run', command, ...args]];
    case 'python':     return ['python',     [command, ...args]];
    case 'python3':    return ['python3',    [command, ...args]];
    case 'cmd':
      // chcp 65001 でコードページをUTF-8に切り替えてから実行（文字化け防止）
      return ['cmd', ['/c', `chcp 65001 > nul 2>&1 & ${command}`, ...args]];
    case 'powershell': {
      // .cmd/.bat/.ps1 をパス指定なしで渡すと PowerShell がカレントディレクトリを探さない。
      // 拡張子があってパス区切り文字を含まない場合は .\ を自動付与する。
      const needsRelPath = /\.(cmd|bat|ps1)$/i.test(command) && !/[/\\]/.test(command);
      const psCmd = needsRelPath ? `.\\${command}` : command;
      // OutputEncoding を UTF-8 に設定してから実行（文字化け防止）
      const utf8Setup = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$OutputEncoding=[System.Text.Encoding]::UTF8;';
      // -NonInteractive -InputFormat None: stdin がパイプ/NUL のとき powershell.exe が
      // "Input redirection is not supported" を出力するのを抑制する
      return ['powershell', ['-NonInteractive', '-InputFormat', 'None', '-ExecutionPolicy', 'Bypass', '-Command', utf8Setup + psCmd, ...args]];
    }
    case 'raw': {
      const parts = parseArgs(command.trim());
      return [parts[0], [...parts.slice(1), ...args]];
    }
  }
}

// ─── ServerManager ───────────────────────────────────────────────────────────

export class ServerManager {
  /** 状態変化時に呼ばれるコールバック（Dashboard / WebServerから差し替える） */
  onUpdate: () => void;
  /** ログ行追加時に呼ばれるコールバック（WebServerがリアルタイム配信に使用） */
  onLog: (id: string, line: string) => void = () => {};
  /** 設定（terminal モードの優先ターミナル種別に使用） */
  settings?: LauncherSettings;

  private states       = new Map<string, ServerState>();
  private procs        = new Map<string, ReturnType<typeof spawn>>();
  private detachTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(servers: ServerConfig[], onUpdate: () => void) {
    this.onUpdate = onUpdate;
    for (const s of servers) this.initState(s);
  }

  // ── 状態アクセス ────────────────────────────────────────────────────────

  getState(id: string): ServerState | undefined { return this.states.get(id); }

  getAllStates(): ServerState[] { return [...this.states.values()]; }

  /** 設定変更時にサーバーリストを同期（実行中プロセスはそのまま維持） */
  syncServers(servers: ServerConfig[]): void {
    const newIds = new Set(servers.map(s => s.id));
    for (const id of this.states.keys()) {
      if (!newIds.has(id)) {
        this.stopDetachedWatch(id);
        this.states.delete(id);
      }
    }
    for (const s of servers) {
      const existing = this.states.get(s.id);
      if (existing) existing.config = s;
      else this.initState(s);
    }
  }

  // ── ライフサイクル ──────────────────────────────────────────────────────

  async start(id: string): Promise<void> {
    const state = this.states.get(id);
    if (!state) return;
    if (state.status === 'running' || state.status === 'starting' || state.status === 'detached') return;

    const { config } = state;

    // ── terminal モード ──────────────────────────────────────────────────────
    if (config.launchMode === 'terminal') {
      this.patch(id, { status: 'running', startTime: new Date(), exitCode: undefined, pid: undefined });
      const cmdStr = buildCmdString(config);
      this.log(id, `▶ [terminal] ${cmdStr}`);
      if (config.cwd) this.log(id, `  cwd: ${config.cwd}`);
      this.log(id, 'ℹ 出力はターミナルウィンドウに表示されます');
      this.launchInTerminal(config);
      return;
    }

    // 全ポートの空き確認
    let anyConflict = false;
    for (const port of config.ports ?? []) {
      const free = await checkPortAvailable(port);
      if (!free) { anyConflict = true; this.log(id, `⚠ Port ${port} is already in use`); }
    }
    this.patch(id, { portConflict: anyConflict });

    this.patch(id, { status: 'starting', exitCode: undefined, pid: undefined });
    this.log(id, `▶ [${config.runtime}] ${config.command}${config.args?.length ? ' ' + config.args.join(' ') : ''}`);
    if (config.cwd) this.log(id, `  cwd: ${config.cwd}`);

    const [cmd, args] = buildCmd(config);

    const proc = spawn(cmd, args, {
      cwd:          config.cwd || undefined,
      env:          { ...process.env, ...config.env },
      shell:        IS_WIN,   // Windowsでは.cmdファイルを解決するためshell:true
      windowsHide:  true,
      // stdin を pipe にすることで Web UI からのキー入力をプロセスに転送できる。
      stdio:        ['pipe', 'pipe', 'pipe'],
    });

    this.procs.set(id, proc);
    this.patch(id, { status: 'running', pid: proc.pid, startTime: new Date() });

    proc.stdout?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').map(l => l.trimEnd()).filter(Boolean))
        this.log(id, line);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      for (const line of d.toString().split('\n').map(l => l.trimEnd()).filter(Boolean))
        this.log(id, `[ERR] ${line}`);
    });

    proc.on('exit', code => {
      this.procs.delete(id);
      const cur = this.states.get(id);

      // detached モード: 起動コマンドが終了（exit code 不問）→ バックグラウンドで実行中とみなす
      // スクリプト内の起動確認タイムアウト不足などで非ゼロ終了することがあるが、
      // 実プロセスは起動済みのケースがあるため exit code は無視する。
      // 実際の起動成否はポート監視で判定する。
      if (config.detached && cur?.status !== 'stopping') {
        this.patch(id, { status: 'detached', exitCode: undefined, pid: undefined });
        this.log(id, `⎋ Detached — バックグラウンドで実行中${code !== 0 ? ` (launcher exited ${code})` : ''}`);
        this.startDetachedWatch(id);
        return;
      }

      const graceful = cur?.status === 'stopping' || code === 0;
      this.patch(id, { status: graceful ? 'stopped' : 'error', exitCode: code, pid: undefined });
      this.log(id, `${graceful ? '⏹' : '✗'} Exited (code ${code})`);
    });

    proc.on('error', err => {
      this.procs.delete(id);
      this.patch(id, { status: 'error', pid: undefined });
      this.log(id, `✗ ${err.message}`);
    });
  }

  async stop(id: string): Promise<void> {
    const state = this.states.get(id);
    if (!state || state.status === 'stopped' || state.status === 'stopping') return;

    // terminal モードはプロセス管理不可のため状態をリセットするのみ
    if (state.config.launchMode === 'terminal') {
      this.patch(id, { status: 'stopped', pid: undefined });
      this.log(id, '⏹ Stopped (ターミナルウィンドウを手動で閉じてください)');
      return;
    }

    // detached モード: stopCommand で実プロセスを終了
    if (state.status === 'detached') {
      this.stopDetachedWatch(id);
      this.patch(id, { status: 'stopping' });
      this.log(id, '⏹ Stopping detached process…');

      if (state.config.stopCommand) {
        // pause 等でハングする可能性があるため await せず起動し、
        // ポート解放 or タイムアウトを停止確定の主判定とする
        const stopDone = execAsync(state.config.stopCommand, {
          cwd: state.config.cwd,
          timeout: 15000,
          env: { ...process.env, LOCAL_LAUNCHER: '1' },
        }).catch(e => { this.log(id, `⚠ Stop command: ${(e as Error).message}`); });

        const ports = state.config.ports ?? [];
        if (ports.length > 0) {
          // ポートが解放される or stopCommand 完了、いずれか早い方で確定
          await Promise.race([stopDone, this.pollUntilPortsFree(ports, 30000)]);
        } else {
          // ポート未設定: stopCommand のタイムアウト(15s)まで待つ
          await stopDone;
        }
      } else {
        this.log(id, '⚠ stopCommand が未設定のため状態のみリセットしました');
      }

      this.patch(id, { status: 'stopped', pid: undefined });
      this.log(id, '⏹ Stopped');
      return;
    }

    this.patch(id, { status: 'stopping' });
    this.log(id, '⏹ Stopping…');

    // カスタム停止コマンドがあれば実行
    if (state.config.stopCommand) {
      try {
        await execAsync(state.config.stopCommand, {
          cwd: state.config.cwd,
          timeout: 15000,
          env: { ...process.env, LOCAL_LAUNCHER: '1' },
        });
      } catch (e) {
        this.log(id, `⚠ Stop command failed: ${(e as Error).message}`);
      }
    }

    const proc = this.procs.get(id);
    if (proc?.pid) await this.killTree(proc.pid);
  }

  async restart(id: string): Promise<void> {
    const delay = this.states.get(id)?.config.restartDelay ?? 1000;
    await this.stop(id);
    await new Promise(r => setTimeout(r, delay));
    await this.start(id);
  }

  async stopAll(): Promise<void> {
    await Promise.all(
      [...this.states.entries()]
        .filter(([, s]) => s.status === 'running' || s.status === 'starting' || s.status === 'detached')
        .map(([id]) => this.stop(id))
    );
  }

  /** Web UI からのキー入力をプロセスの stdin に書き込む */
  writeStdin(id: string, data: string): void {
    const proc = this.procs.get(id);
    proc?.stdin?.write(data);
  }

  clearLogs(id: string): void {
    const s = this.states.get(id);
    if (!s) return;
    s.logs = [];
    this.onUpdate();
  }

  // ── 内部ユーティリティ ──────────────────────────────────────────────────

  private initState(config: ServerConfig): void {
    this.states.set(config.id, { config, status: 'stopped', logs: [], portConflict: false });
  }

  private log(id: string, line: string): void {
    const state = this.states.get(id);
    if (!state) return;
    const ts = new Date().toLocaleTimeString('ja-JP', { hour12: false });
    const formatted = `[${ts}] ${line}`;
    state.logs.push(formatted);
    if (state.logs.length > MAX_LOGS) state.logs.splice(0, state.logs.length - MAX_LOGS);
    this.onLog(id, formatted);
    this.onUpdate();
  }

  private patch(id: string, partial: Partial<ServerState>): void {
    const s = this.states.get(id);
    if (!s) return;
    Object.assign(s, partial);
    this.onUpdate();
  }

  /** terminal モード: 指定ターミナルでコマンドを実行する */
  private launchInTerminal(config: ServerConfig): void {
    const term = this.settings?.preferredTerminal ?? 'powershell';
    const cwd  = (config.cwd || process.cwd()).replace(/\//g, '\\');
    const cmd  = buildCmdString(config);

    // PowerShell では .cmd/.bat/.ps1 をパス指定なしで渡すと現在ディレクトリを検索しない。
    // 拡張子があってパス区切り文字を含まない先頭トークンには .\ を付与する。
    const firstToken = cmd.split(' ')[0];
    const needsRelPath = /\.(cmd|bat|ps1)$/i.test(firstToken) && !/[/\\]/.test(firstToken);
    const cmdForPs = needsRelPath ? `.\\${cmd}` : cmd;

    const cwdPs = cwd.replace(/'/g, "''");
    const cmdPs = cmdForPs.replace(/'/g, "''");

    switch (term) {
      case 'powershell':
        exec(`start "" powershell.exe -NoExit -Command "Set-Location '${cwdPs}'; ${cmdPs}"`, (err) => {
          if (err) this.log(config.id, `✗ ターミナル起動失敗: ${err.message}`);
        });
        break;
      case 'cmd':
        exec(`start "" cmd.exe /k "cd /d "${cwd}" && ${cmd}"`, (err) => {
          if (err) this.log(config.id, `✗ ターミナル起動失敗: ${err.message}`);
        });
        break;
      case 'wt':
        exec(`wt.exe -d "${cwd}" -- powershell.exe -NoExit -Command "${cmdPs}"`, (err) => {
          if (err) {
            exec(`start "" powershell.exe -NoExit -Command "Set-Location '${cwdPs}'; ${cmdPs}"`, (err2) => {
              if (err2) this.log(config.id, `✗ ターミナル起動失敗: ${err2.message}`);
            });
          }
        });
        break;
    }
  }

  /** detached サーバーのポート監視を開始（全ポートが空きになったら stopped に遷移） */
  private startDetachedWatch(id: string): void {
    this.stopDetachedWatch(id);
    const timer = setInterval(async () => {
      const state = this.states.get(id);
      if (!state || state.status !== 'detached') { this.stopDetachedWatch(id); return; }
      const ports = state.config.ports ?? [];
      if (ports.length === 0) return; // ポート未設定は監視不可
      const results = await Promise.all(ports.map(p => checkPortAvailable(p)));
      if (results.every(Boolean)) {
        this.stopDetachedWatch(id);
        this.patch(id, { status: 'stopped' });
        this.log(id, '⏹ バックグラウンドプロセスの終了を検出しました');
      }
    }, 5000);
    this.detachTimers.set(id, timer);
  }

  /** 全ポートが解放されるまで最大 maxMs ミリ秒ポーリングする */
  private pollUntilPortsFree(ports: number[], maxMs: number): Promise<void> {
    return new Promise(resolve => {
      const deadline = Date.now() + maxMs;
      const check = async () => {
        const results = await Promise.all(ports.map(p => checkPortAvailable(p)));
        if (results.every(Boolean) || Date.now() >= deadline) {
          resolve();
        } else {
          setTimeout(check, 1000);
        }
      };
      check();
    });
  }

  private stopDetachedWatch(id: string): void {
    const timer = this.detachTimers.get(id);
    if (timer) { clearInterval(timer); this.detachTimers.delete(id); }
  }

  /** Windowsではプロセスツリーごと強制終了、UNIX系ではSIGTERM→SIGKILL */
  private async killTree(pid: number): Promise<void> {
    if (IS_WIN) {
      try { await execAsync(`taskkill /T /F /PID ${pid}`); } catch { /* already dead */ }
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch { }
      await new Promise(r => setTimeout(r, 2000));
      try { process.kill(-pid, 'SIGKILL'); } catch { }
    }
  }
}
