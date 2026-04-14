import readline from 'readline';
import type { ServerManager } from './manager';
import type { LauncherConfig } from './types';
import { upsertServer, removeServer, saveConfig } from './config';
import { promptServerForm } from './prompts';
import { findDuplicatePorts } from './portChecker';

// ─── ANSIヘルパー ────────────────────────────────────────────────────────────

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  red:     '\x1b[31m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  cyan:    '\x1b[36m',
  bgSel:   '\x1b[48;5;238m',    // 選択行のダークグレー背景
  cls:     '\x1b[2J\x1b[H',
  hideCur: '\x1b[?25l',
  showCur: '\x1b[?25h',
};

/** ANSIエスケープ除去 */
function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/** 表示幅を保ちながら右パディング（ANSI対応） */
function padR(s: string, n: number): string {
  const len = strip(s).length;
  return s + (len < n ? ' '.repeat(n - len) : '');
}

/** 表示幅でトランケート（ANSIなし文字列を想定） */
function trunc(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}

// ─── ボックス描画 ────────────────────────────────────────────────────────────

const H = (n: number) => '─'.repeat(n);

function titled(l: string, r: string, title: string, w: number): string {
  const tlen = strip(title).length;
  const inner = w - 2 - tlen;
  const left = Math.floor(inner / 2);
  const right = inner - left;
  return l + H(left) + title + H(right) + r;
}

const box = {
  top: (w: number, title = '') =>
    title ? titled('┌', '┐', title, w) : `┌${H(w - 2)}┐`,
  div: (w: number, title = '') =>
    title ? titled('├', '┤', title, w) : `├${H(w - 2)}┤`,
  bot: (w: number) => `└${H(w - 2)}┘`,
  row: (w: number, content: string) => {
    const vis = strip(content).length;
    const pad = Math.max(0, w - 4 - vis);
    return `│ ${content}${' '.repeat(pad)} │`;
  },
};

// ─── ステータス表示 ──────────────────────────────────────────────────────────

function fmtStatus(status: string, conflict: boolean): string {
  const base: Record<string, string> = {
    running:  `${C.green}● Running${C.reset}`,
    starting: `${C.cyan}◌ Starting…${C.reset}`,
    stopping: `${C.yellow}◌ Stopping…${C.reset}`,
    stopped:  `${C.dim}○ Stopped${C.reset}`,
    error:    `${C.red}✗ Error${C.reset}`,
    detached: `${C.cyan}⎋ Detached${C.reset}`,
  };
  const s = base[status] ?? status;
  return conflict && status === 'running' ? s + ` ${C.yellow}⚡port!${C.reset}` : s;
}

function fmtUptime(start?: Date): string {
  if (!start) return '';
  const sec = Math.floor((Date.now() - start.getTime()) / 1000);
  if (sec < 60)   return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h${Math.floor((sec % 3600) / 60)}m`;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export class Dashboard {
  private sel   = 0;
  private dirty = false;
  private paused = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private keyHandler: ((d: Buffer) => void) | null = null;

  constructor(
    private manager: ServerManager,
    private cfg: LauncherConfig,
  ) {}

  start(): void {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write(C.hideCur);

    this.keyHandler = (d: Buffer) => this.onKey(d.toString());
    process.stdin.on('data', this.keyHandler);

    // マネージャーの更新をdirtyフラグで受け取る（頻繁な再描画を抑制）
    this.manager.onUpdate = () => { this.dirty = true; };

    this.render();
    this.timer = setInterval(() => {
      if (!this.paused && this.dirty) { this.render(); this.dirty = false; }
    }, 200);
  }

  shutdown(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.keyHandler) { process.stdin.off('data', this.keyHandler); this.keyHandler = null; }
    process.stdout.write(C.showCur + C.cls);
    try { process.stdin.setRawMode(false); } catch { /* ignore */ }
    process.stdin.pause();
  }

  // ── プロンプト用一時停止 ───────────────────────────────────────────────

  private async pause(): Promise<void> {
    this.paused = true;
    process.stdout.write(C.showCur + C.cls);
    try { process.stdin.setRawMode(false); } catch { /* ignore */ }
  }

  private resume(): void {
    try { process.stdin.setRawMode(true); } catch { /* ignore */ }
    process.stdout.write(C.hideCur);
    this.paused = false;
    this.dirty  = true;
    this.render();
    this.dirty = false;
  }

  // ── キー入力処理 ───────────────────────────────────────────────────────

  private onKey(key: string): void {
    if (this.paused) return;
    const states = this.manager.getAllStates();

    // 終了
    if (key === '\u0003' || key === 'q' || key === 'Q') { this.quit(); return; }

    // 上下移動
    if (key === '\x1b[A') {
      this.sel = Math.max(0, this.sel - 1);
      this.render(); return;
    }
    if (key === '\x1b[B') {
      this.sel = Math.min(states.length - 1, this.sel + 1);
      this.render(); return;
    }

    // 追加（選択不要）
    if (key === 'a' || key === 'A') { this.doAdd(); return; }

    // 選択サーバーへの操作
    const sel = states[this.sel];
    if (!sel) return;
    const id = sel.config.id;

    if (key === 's' || key === 'S') { this.manager.start(id).catch(() => {}); return; }
    if (key === 'k' || key === 'K') { this.manager.stop(id).catch(() => {}); return; }
    if (key === 'r' || key === 'R') { this.manager.restart(id).catch(() => {}); return; }
    if (key === 'e' || key === 'E') { this.doEdit(id); return; }
    if (key === 'd' || key === 'D') { this.doDelete(id); return; }
    if (key === 'l' || key === 'L') { this.manager.clearLogs(id); return; }
  }

  // ── インタラクティブ操作 ───────────────────────────────────────────────

  private async doAdd(): Promise<void> {
    await this.pause();
    const ids = this.cfg.servers.map(s => s.id);
    const server = await promptServerForm(ids);
    if (server) {
      this.cfg = upsertServer(this.cfg, server);
      saveConfig(this.cfg);
      this.manager.syncServers(this.cfg.servers);
      console.log(`\n✓ '${server.name}' を追加しました。`);
      await new Promise(r => setTimeout(r, 800));
    }
    this.resume();
  }

  private async doEdit(id: string): Promise<void> {
    await this.pause();
    const existing = this.cfg.servers.find(s => s.id === id);
    if (!existing) { this.resume(); return; }
    const ids = this.cfg.servers.map(s => s.id).filter(i => i !== id);
    const server = await promptServerForm(ids, existing);
    if (server) {
      this.cfg = upsertServer(this.cfg, server);
      saveConfig(this.cfg);
      this.manager.syncServers(this.cfg.servers);
      console.log(`\n✓ '${server.name}' を更新しました。`);
      await new Promise(r => setTimeout(r, 800));
    }
    this.resume();
  }

  private async doDelete(id: string): Promise<void> {
    await this.pause();

    const state = this.manager.getState(id);
    if (state?.status === 'running' || state?.status === 'starting') {
      console.log(`\n'${id}' は実行中です。先に停止します…`);
      await this.manager.stop(id);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans: string = await new Promise(res =>
      rl.question(`\n'${id}' を削除しますか? [y/N]: `, res)
    );
    rl.close();

    if (ans.trim().toLowerCase() === 'y') {
      this.cfg = removeServer(this.cfg, id);
      saveConfig(this.cfg);
      this.manager.syncServers(this.cfg.servers);
      this.sel = Math.min(this.sel, Math.max(0, this.cfg.servers.length - 1));
    }
    this.resume();
  }

  private quit(): void {
    this.shutdown();
    const running = this.manager.getAllStates().filter(
      s => s.status === 'running' || s.status === 'starting'
    );
    if (running.length === 0) { console.log('Bye!'); process.exit(0); }
    console.log('サーバーを停止中…');
    this.manager.stopAll().then(() => { console.log('すべて停止しました。'); process.exit(0); });
  }

  // ── 描画 ──────────────────────────────────────────────────────────────

  private render(): void {
    const w = Math.max(process.stdout.columns ?? 80, 64);
    const h = Math.max(process.stdout.rows    ?? 24, 14);

    const states = this.manager.getAllStates();
    if (this.sel >= states.length) this.sel = Math.max(0, states.length - 1);

    const dupePorts = findDuplicatePorts(this.cfg.servers);
    const lines: string[] = [];

    // ── ヘッダー
    lines.push(box.top(w, ` ${C.bold}LOCAL LAUNCHER${C.reset} `));
    lines.push(box.row(w,
      C.dim + padR('  ID', 20) + padR('NAME', 22) + padR('PORT', 7) + 'STATUS' + C.reset
    ));
    lines.push(box.div(w));

    // ── サーバーリスト（最大8行表示・スクロール対応）
    const visCount = Math.min(states.length, 8);
    const listStart = Math.max(0, this.sel - visCount + 1);

    if (states.length === 0) {
      lines.push(box.row(w, C.dim + '  サーバーがありません。[a] で追加してください。' + C.reset));
    }

    for (let i = listStart; i < listStart + visCount; i++) {
      if (i >= states.length) break;
      const { config, status, startTime, portConflict } = states[i];
      const isSel = i === this.sel;
      const arrow = isSel ? `${C.cyan}▶${C.reset} ` : '  ';

      const ps = config.ports ?? [];
      const portStr = ps.length === 0 ? '-'
        : ps.length === 1
          ? (dupePorts.has(ps[0]) ? `${C.red}${ps[0]}${C.reset}` : String(ps[0]))
          : (dupePorts.has(ps[0]) ? `${C.red}${ps[0]}${C.reset}` : String(ps[0])) + `${C.dim}+${ps.length - 1}${C.reset}`;
      const uptime = status === 'running' ? ` ${C.dim}${fmtUptime(startTime)}${C.reset}` : '';
      const autoMark = config.autoStart ? `${C.dim}★${C.reset}` : ' ';

      let row = arrow + autoMark + padR(config.id, 16) + padR(config.name, 22)
               + padR(portStr, 7) + fmtStatus(status, portConflict) + uptime;
      if (isSel) row = C.bgSel + row + C.reset;
      lines.push(box.row(w, row));
    }

    // スクロールインジケータ
    if (states.length > visCount) {
      const info = `  (${listStart + 1}–${Math.min(listStart + visCount, states.length)} / ${states.length})`;
      lines.push(box.row(w, C.dim + info + C.reset));
    }

    // ── ログパネル
    const selState = states[this.sel];
    const logTitle = selState
      ? ` Logs: ${selState.config.name}${selState.config.ports?.[0] ? ` :${selState.config.ports[0]}` : ''} `
      : ' Logs ';
    lines.push(box.div(w, logTitle));

    const fixedRows = lines.length + 3; // キーバー(div+row+bot)
    const logH = Math.max(2, h - fixedRows);
    const rawLogs = selState?.logs ?? [];
    const visLogs = rawLogs.slice(-logH);

    for (let i = 0; i < logH; i++) {
      const raw = visLogs[i] ?? '';
      const plain = trunc(strip(raw), w - 4);
      lines.push(box.row(w, C.dim + plain + C.reset));
    }

    // ── キーバー
    lines.push(box.div(w));
    const keys = '↑↓:選択  s:起動  k:停止  r:再起動  a:追加  e:編集  d:削除  l:ログ消去  q:終了';
    lines.push(box.row(w, C.dim + trunc(keys, w - 4) + C.reset));
    lines.push(box.bot(w));

    process.stdout.write(C.cls + lines.join('\n'));
  }
}
