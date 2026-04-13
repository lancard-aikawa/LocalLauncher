import type { ServerWebSocket } from 'bun';
import { exec } from 'child_process';
import type { ServerManager } from '../manager';
import type { LauncherConfig, LauncherSettings, ServerConfig } from '../types';
import { upsertServer, removeServer, saveConfig } from '../config';
import { detectPorts } from '../portDetector';

type WS = ServerWebSocket<unknown>;

// ─── WebServer ───────────────────────────────────────────────────────────────

export class WebServer {
  private clients = new Set<WS>();
  private stateTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private manager: ServerManager,
    private cfg: LauncherConfig,
    readonly port: number = 7474,
  ) {
    // マネージャーのコールバックを差し替えてリアルタイム配信
    manager.onLog    = (id, line) => this.broadcast({ type: 'log', id, line });
    manager.onUpdate = () => this.scheduleState();
  }

  start(): void {
    const self = this;

    Bun.serve({
      port: this.port,

      fetch(req, server) {
        const { pathname } = new URL(req.url);

        // WebSocket アップグレード
        if (pathname === '/ws') {
          return server.upgrade(req)
            ? undefined
            : new Response('WS upgrade failed', { status: 400 });
        }

        // REST: サーバー操作（フォーム送信など）
        if (pathname.startsWith('/api/')) return self.handleApi(req);

        // HTML UI を配信
        if (pathname === '/' || pathname === '/index.html') {
          return new Response(
            Bun.file(new URL('./ui.html', import.meta.url)),
            { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }

        return new Response('Not Found', { status: 404 });
      },

      websocket: {
        open(ws)          { self.clients.add(ws); self.sendState(ws); },
        close(ws)         { self.clients.delete(ws); },
        message(ws, msg)  { self.handleWsMessage(ws, typeof msg === 'string' ? msg : msg.toString()); },
      },
    });

    console.log(`\n✓  LocalLauncher Web UI → http://localhost:${this.port}\n`);
  }

  // ── REST API（将来拡張用。現在は WS で全操作） ──────────────────────────

  private async handleApi(req: Request): Promise<Response> {
    return new Response('Use WebSocket', { status: 400 });
  }

  // ── WebSocket メッセージ処理 ──────────────────────────────────────────────

  private handleWsMessage(ws: WS, raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }

    const id = msg.id as string | undefined;

    switch (msg.type) {
      case 'start':     if (id) this.manager.start(id).catch(() => {}); break;
      case 'stop':      if (id) this.manager.stop(id).catch(() => {}); break;
      case 'restart':   if (id) this.manager.restart(id).catch(() => {}); break;
      case 'clearLogs': if (id) this.manager.clearLogs(id); break;

      case 'addServer':
      case 'editServer': {
        const server = msg.server as ServerConfig;
        this.cfg = upsertServer(this.cfg, server);
        saveConfig(this.cfg);
        this.manager.syncServers(this.cfg.servers);
        this.broadcastState();
        break;
      }

      case 'removeServer': {
        if (!id) break;
        const state = this.manager.getState(id);
        const stop = (state?.status === 'running' || state?.status === 'starting')
          ? this.manager.stop(id)
          : Promise.resolve();
        stop.then(() => {
          this.cfg = removeServer(this.cfg, id);
          saveConfig(this.cfg);
          this.manager.syncServers(this.cfg.servers);
          this.broadcastState();
        });
        break;
      }

      case 'openExplorer': {
        const dir = this.resolveDir(id);
        this.openExplorer(dir);
        break;
      }

      case 'openTerminal': {
        const dir = this.resolveDir(id);
        this.openTerminal(dir);
        break;
      }

      case 'updateSettings': {
        const settings = msg.settings as LauncherSettings;
        this.cfg = { ...this.cfg, settings };
        saveConfig(this.cfg);
        this.broadcastState();
        break;
      }

      case 'detectPorts': {
        const cwd = (msg.cwd as string | undefined) || process.cwd();
        const ports = detectPorts(cwd);
        ws.send(JSON.stringify({ type: 'detectedPorts', ports }));
        break;
      }
    }
  }

  /** cwd が設定されていればそれを、なければランチャー自身の cwd を返す */
  private resolveDir(id: string | undefined): string {
    const cwd = id ? this.manager.getState(id)?.config.cwd : undefined;
    return cwd || process.cwd();
  }

  private openExplorer(dir: string): void {
    const d = dir.replace(/\//g, '\\');
    // exec は Windows では cmd.exe /c で実行されるため explorer.exe をそのまま渡せる
    exec(`explorer.exe "${d}"`, (err) => {
      if (err) console.error('[LocalLauncher] explorer error:', err.message);
    });
  }

  private openTerminal(dir: string): void {
    const d = dir.replace(/\//g, '\\');
    // パス中の単引用符をエスケープ（PowerShell 用）
    const dPs = d.replace(/'/g, "''");
    const term = this.cfg.settings?.preferredTerminal ?? 'powershell';

    switch (term) {
      case 'powershell':
        // start "" でタイトルを空に指定して新しいウィンドウを開く
        exec(`start "" powershell.exe -NoExit -Command "Set-Location '${dPs}'"`, (err) => {
          if (err) console.error('[LocalLauncher] powershell error:', err.message);
        });
        break;

      case 'cmd':
        // /k でコマンド実行後もウィンドウを保持
        exec(`start "" cmd.exe /k cd /d "${d}"`, (err) => {
          if (err) console.error('[LocalLauncher] cmd error:', err.message);
        });
        break;

      case 'wt':
        exec(`wt.exe -d "${d}"`, (err) => {
          if (err) {
            // Windows Terminal が見つからない場合は PowerShell にフォールバック
            console.warn('[LocalLauncher] wt not found, falling back to PowerShell');
            exec(`start "" powershell.exe -NoExit -Command "Set-Location '${dPs}'"`, (err2) => {
              if (err2) console.error('[LocalLauncher] powershell fallback error:', err2.message);
            });
          }
        });
        break;
    }
  }

  // ── 状態配信 ─────────────────────────────────────────────────────────────

  private sendState(ws: WS): void {
    ws.send(JSON.stringify({ type: 'state', servers: this.buildPayload(), settings: this.cfg.settings }));
  }

  private broadcastState(): void {
    this.broadcast({ type: 'state', servers: this.buildPayload(), settings: this.cfg.settings });
  }

  /** 頻繁に呼ばれる onUpdate をデバウンス（50ms）して過剰配信を防ぐ */
  private scheduleState(): void {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    this.stateTimer = setTimeout(() => this.broadcastState(), 50);
  }

  private broadcast(obj: unknown): void {
    if (this.clients.size === 0) return;
    const msg = JSON.stringify(obj);
    for (const ws of this.clients) {
      try { ws.send(msg); } catch { this.clients.delete(ws); }
    }
  }

  private buildPayload() {
    return this.manager.getAllStates().map(s => ({
      config:       s.config,
      status:       s.status,
      pid:          s.pid,
      portConflict: s.portConflict,
      startTime:    s.startTime?.toISOString(),
      exitCode:     s.exitCode,
      logs:         s.logs.slice(-300),
    }));
  }
}
