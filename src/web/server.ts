import type { ServerWebSocket } from 'bun';
import type { ServerManager } from '../manager';
import type { LauncherConfig, ServerConfig } from '../types';
import { upsertServer, removeServer, saveConfig } from '../config';

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

  private handleWsMessage(_ws: WS, raw: string): void {
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
    }
  }

  // ── 状態配信 ─────────────────────────────────────────────────────────────

  private sendState(ws: WS): void {
    ws.send(JSON.stringify({ type: 'state', servers: this.buildPayload() }));
  }

  private broadcastState(): void {
    this.broadcast({ type: 'state', servers: this.buildPayload() });
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
