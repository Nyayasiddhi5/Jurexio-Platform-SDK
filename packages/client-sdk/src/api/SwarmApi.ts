/**
 * Swarm topologies — /api/jrx/swarm/* (read paths accept X-API-Key).
 */

import type { NyvHttpClient } from '../NyvClient.js';

export class SwarmApi {
  constructor(private readonly http: NyvHttpClient) {}

  listTopologies(query?: { limit?: number }): Promise<unknown> {
    const qs = query?.limit != null ? `?limit=${encodeURIComponent(String(query.limit))}` : '';
    return this.http.get(`/api/jrx/swarm/topologies${qs}`);
  }

  getTopology(id: string): Promise<unknown> {
    return this.http.get(`/api/jrx/swarm/topologies/${encodeURIComponent(id)}`);
  }

  getStats(): Promise<unknown> {
    return this.http.get('/api/jrx/swarm/stats');
  }
}
