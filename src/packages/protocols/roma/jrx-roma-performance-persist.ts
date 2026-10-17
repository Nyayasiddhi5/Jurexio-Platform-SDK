/**
 * ROMA L5 performance-store persistence (Redis).
 * In-process Map is the hot cache; Redis survives gateway recreate.
 * Fail-soft: missing Redis keeps in-memory learning for this process only.
 */
import { resolveRedisTcpUrl, logRedisDisabledOnce } from '../../../utils/redis-tcp-url.js';
import type { PerformanceMetrics } from './types.js';
import { deserializeRomaStore, serializeRomaStore } from './jrx-roma-performance-codec.js';

export const ROMA_PERF_REDIS_KEY = 'nyv:roma:l5:performance';
export { deserializeRomaStore, mergeRomaStoreIfMissing, serializeRomaStore } from './jrx-roma-performance-codec.js';

interface MinimalRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<unknown>;
  on(event: 'error', handler: (e: Error) => void): void;
}

let _client: MinimalRedis | null = null;
let _disabled = false;

async function getClient(): Promise<MinimalRedis | null> {
  if (_disabled) return null;
  if (_client) return _client;
  const r = resolveRedisTcpUrl();
  if (!r.enabled || !r.url) {
    _disabled = true;
    logRedisDisabledOnce('roma-l5-persist', r.reason ?? 'no TCP url');
    return null;
  }
  try {
    const ioredisMod = await import('ioredis');
    const IORedis = (ioredisMod as { default?: unknown }).default ?? ioredisMod;
    const Ctor = IORedis as unknown as new (url: string, opts: Record<string, unknown>) => MinimalRedis;
    const client = new Ctor(r.url, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableOfflineQueue: true,
      connectTimeout: 5000,
    });
    client.on('error', () => { /* non-fatal */ });
    _client = client;
    return _client;
  } catch {
    _disabled = true;
    return null;
  }
}

export async function loadRomaPerformanceStore(): Promise<PerformanceMetrics | null> {
  const client = await getClient();
  if (!client) return null;
  try {
    const raw = await client.get(ROMA_PERF_REDIS_KEY);
    if (!raw) return {};
    return deserializeRomaStore(raw);
  } catch {
    return null;
  }
}

export async function saveRomaPerformanceStore(store: PerformanceMetrics): Promise<boolean> {
  const client = await getClient();
  if (!client) return false;
  try {
    await client.set(ROMA_PERF_REDIS_KEY, serializeRomaStore(store));
    return true;
  } catch {
    return false;
  }
}
