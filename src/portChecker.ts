import { createServer } from 'net';
import type { ServerConfig } from './types';

/** ポートが使用可能（空いている）か確認 */
export function checkPortAvailable(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise(resolve => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, host);
  });
}

/** 設定リスト内で同じポートを持つサーバーを列挙 */
export function findDuplicatePorts(servers: ServerConfig[]): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const s of servers) {
    if (!s.port) continue;
    const ids = map.get(s.port) ?? [];
    ids.push(s.id);
    map.set(s.port, ids);
  }
  const dupes = new Map<number, string[]>();
  for (const [port, ids] of map) if (ids.length > 1) dupes.set(port, ids);
  return dupes;
}
