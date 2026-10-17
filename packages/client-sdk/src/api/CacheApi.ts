import type { NyvHttpClient } from '../NyvClient.js';
import type { NyvCacheEntry, NyvCacheStats } from '../types/index.js';

export class CacheApi {
  constructor(private http: NyvHttpClient) {}

  async lookup(query: string, jurisdiction?: string): Promise<NyvCacheEntry> {
    return this.http.post('/api/jrx/cache/lookup', { query, jurisdiction });
  }

  async invalidate(key: string): Promise<{ success: boolean; invalidatedAt: string }> {
    return this.http.post('/api/jrx/cache/invalidate', { key });
  }

  async invalidateByJurisdiction(jurisdiction: string): Promise<{ success: boolean; entriesCleared: number }> {
    return this.http.post('/api/jrx/cache/invalidate-jurisdiction', { jurisdiction });
  }

  async getStats(): Promise<NyvCacheStats> {
    return this.http.get('/api/jrx/cache/stats');
  }

  async warmup(queries: { query: string; jurisdiction: string }[]): Promise<{ warmedUp: number; failedCount: number }> {
    return this.http.post('/api/jrx/cache/warmup', { queries });
  }
}
