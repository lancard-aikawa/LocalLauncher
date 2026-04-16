import { createServer } from 'net';
import type { ServerConfig } from './types';

/** ポートが使用可能（空いている）か確認。タイムアウト時は使用中とみなす */
export function checkPortAvailable(port: number, host = '127.0.0.1', timeoutMs = 2000): Promise<boolean> {
  return new Promise(resolve => {
    const srv = createServer();
    const timer = setTimeout(() => { try { srv.close(); } catch {} resolve(false); }, timeoutMs);
    srv.once('error', () => { clearTimeout(timer); resolve(false); });
    srv.once('listening', () => { clearTimeout(timer); srv.close(() => resolve(true)); });
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
