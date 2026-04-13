import { spawn } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import type { ServerConfig, ServerState } from './types';
import { checkPortAvailable } from './portChecker';

const execAsync = promisify(exec);
const IS_WIN = process.platform === 'win32';
const MAX_LOGS = 500;

// ─── ランタイム別コマンド構築 ────────────────────────────────────────────────

function buildCmd(cfg: ServerConfig): [string, string[]] {
  const { runtime, command, args = [] } = cfg;
  switch (runtime) {
    case 'bun':        return ['bun',        ['run', command, ...args]];
    case 'node':       return ['node',       [command, ...args]];
    case 'npm':        return ['npm',        ['run', command, ...args]];
    case 'python':     return ['python',     [command, ...args]];
    case 'python3':    return ['python3',    [command, ...args]];
    case 'cmd':        return ['cmd',        ['/c', command, ...args]];
    case 'powershell': return ['powershell', ['-ExecutionPolicy', 'Bypass', '-Command', command, ...args]];
    case 'raw': {
      const parts = command.trim().split(/\s+/);
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

  private states = new Map<string, ServerState>();
  private procs  = new Map<string, ReturnType<typeof spawn>>();

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
    for (const id of this.states.keys()) if (!newIds.has(id)) this.states.delete(id);
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
    if (state.status === 'running' || state.status === 'starting') return;

    const { config } = state;

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

    this.patch(id, { status: 'stopping' });
    this.log(id, '⏹ Stopping…');

    // カスタム停止コマンドがあれば実行
    if (state.config.stopCommand) {
      try {
        await execAsync(state.config.stopCommand, { cwd: state.config.cwd });
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
        .filter(([, s]) => s.status === 'running' || s.status === 'starting')
        .map(([id]) => this.stop(id))
    );
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
