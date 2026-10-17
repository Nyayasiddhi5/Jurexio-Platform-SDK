interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  lastAccessed: number;
}

export class CacheManager {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private maxEntries: number;
  private defaultTtlMs: number;
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(options?: { maxEntries?: number; defaultTtlMs?: number }) {
    this.maxEntries = options?.maxEntries ?? 10000;
    this.defaultTtlMs = options?.defaultTtlMs ?? 5 * 60 * 1000;
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    if (this.sweepInterval.unref) {
      this.sweepInterval.unref();
    }
  }

  get<T = any>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    entry.lastAccessed = Date.now();
    this.hits++;
    return entry.value as T;
  }

  set<T = any>(key: string, value: T, ttlMs?: number): void {
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      this.evictLRU();
    }
    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + (ttlMs ?? this.defaultTtlMs),
      lastAccessed: now,
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
  }

  stats(): {
    size: number;
    maxEntries: number;
    hits: number;
    misses: number;
    evictions: number;
    hitRate: number;
  } {
    return {
      size: this.cache.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: this.hits + this.misses > 0
        ? this.hits / (this.hits + this.misses)
        : 0,
    };
  }

  destroy(): void {
    if (this.sweepInterval) {
      clearInterval(this.sweepInterval);
      this.sweepInterval = null;
    }
    this.cache.clear();
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.cache) {
      if (Date.now() > entry.expiresAt) {
        this.cache.delete(key);
        this.evictions++;
        return;
      }
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey) {
      this.cache.delete(oldestKey);
      this.evictions++;
    }
  }

  private sweep(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.evictions++;
      }
    }
  }
}

export const cacheManager = new CacheManager();

export const aiResponseCache = new CacheManager({
  defaultTtlMs: 10 * 60 * 1000,
  maxEntries: 5000,
});

export const userSessionCache = new CacheManager({
  defaultTtlMs: 30 * 60 * 1000,
  maxEntries: 50000,
});

export const configCache = new CacheManager({
  defaultTtlMs: 60 * 60 * 1000,
  maxEntries: 1000,
});
