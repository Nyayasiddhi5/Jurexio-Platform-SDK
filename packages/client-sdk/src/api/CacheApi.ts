import type { JrxHttpClient } from '../JrxClient.js';
import type { JrxCacheEntry, JrxCacheStats } from '../types/index.js';

export class CacheApi {
  constructor(private http: JrxHttpClient) {}

  async lookup(query: string, jurisdiction?: string): Promise<JrxCacheEntry> {
    return this.http.post('/api/jrx/cache/lookup', { query, jurisdiction });
  }

  async invalidate(key: string): Promise<{ success: boolean; invalidatedAt: string }> {
    return this.http.post('/api/jrx/cache/invalidate', { key });
  }

  async invalidateByJurisdiction(jurisdiction: string): Promise<{ success: boolean; entriesCleared: number }> {
    return this.http.post('/api/jrx/cache/invalidate-jurisdiction', { jurisdiction });
  }

  async getStats(): Promise<JrxCacheStats> {
    return this.http.get('/api/jrx/cache/stats');
  }

  async warmup(queries: { query: string; jurisdiction: string }[]): Promise<{ warmedUp: number; failedCount: number }> {
    return this.http.post('/api/jrx/cache/warmup', { queries });
  }
}
