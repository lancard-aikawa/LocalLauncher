import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LauncherConfig, ServerConfig } from './types';

function configDir(): string {
  // Windows: %APPDATA%\LocalLauncher  /  他OS: ~/.local-launcher
  const appData = process.env.APPDATA;
  return appData
    ? join(appData, 'LocalLauncher')
    : join(homedir(), '.local-launcher');
}

export function getConfigPath(): string {
  return join(configDir(), 'config.json');
}

const DEFAULTS: LauncherConfig = { version: 1, servers: [] };

export function loadConfig(): LauncherConfig {
  const p = getConfigPath();
  if (!existsSync(p)) return structuredClone(DEFAULTS);
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as LauncherConfig;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export function saveConfig(cfg: LauncherConfig): void {
  const dir = configDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}

/** サーバーを追加または更新して新しいConfigを返す */
export function upsertServer(cfg: LauncherConfig, server: ServerConfig): LauncherConfig {
  const servers = [...cfg.servers];
  const idx = servers.findIndex(s => s.id === server.id);
  if (idx >= 0) servers[idx] = server; else servers.push(server);
  return { ...cfg, servers };
}

/** サーバーを削除して新しいConfigを返す */
export function removeServer(cfg: LauncherConfig, id: string): LauncherConfig {
  return { ...cfg, servers: cfg.servers.filter(s => s.id !== id) };
}

/** 既存IDと被らない一意なIDを生成 */
export function generateId(name: string, existingIds: string[]): string {
  const base =
    name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server';
  if (!existingIds.includes(base)) return base;
  let i = 2;
  while (existingIds.includes(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}
