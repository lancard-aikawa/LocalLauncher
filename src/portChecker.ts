import { createServer } from 'net';
import type { ServerConfig } from './types';

// 空き確認のために開いている listen ソケットの数。
// Windows では listen 中のソケットが、その間に spawn した子プロセスへ引き継がれる。親が閉じても
// 子が生きている間ポートは塞がったままになり、そのポートで起動するサーバーが EADDRINUSE で落ちる
// (autoStart で複数を同時に起動すると、先に起動したサーバーが後のサーバーの確認用ソケットを持っていた)。
// 生き続ける子プロセスを起動する前に portChecksIdle() を待つこと。
let openChecks = 0;
let idleWaiters: Array<() => void> = [];

/** 空き確認のソケットが 1 つも開いていない状態まで待つ。戻ったら await を挟まずに子プロセスを起動する */
export async function portChecksIdle(): Promise<void> {
  while (openChecks > 0) await new Promise<void>(r => idleWaiters.push(r));
}

/** ポートが使用可能（空いている）か確認。タイムアウト時は使用中とみなす */
export function checkPortAvailable(port: number, host = '127.0.0.1', timeoutMs = 2000): Promise<boolean> {
  openChecks++;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (--openChecks === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach(w => w());
    }
  };
  return new Promise(resolve => {
    const srv = createServer();
    const timer = setTimeout(() => { try { srv.close(); } catch {} finish(); resolve(false); }, timeoutMs);
    srv.once('error', () => { clearTimeout(timer); finish(); resolve(false); });
    srv.once('listening', () => { clearTimeout(timer); srv.close(() => { finish(); resolve(true); }); });
    srv.listen(port, host);
  });
}

/** 設定リスト内で同じポートを持つサーバーを列挙 */
export function findDuplicatePorts(servers: ServerConfig[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const s of servers) {
    for (const port of s.ports ?? []) {
      const ids = map.get(port) ?? [];
      ids.push(s.id);
      map.set(port, ids);
    }
  }
  const dupes = new Map<number, string[]>();
  for (const [port, ids] of map) if (ids.length > 1) dupes.set(port, ids);
  return dupes;
}
