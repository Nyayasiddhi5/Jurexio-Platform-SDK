import type { NyvHttpClient } from '../NyvClient.js';
import type {
  NyvJurisdiction,
  NyvLegalDomain,
  NyvMatterMemory,
  NyvClientMemory,
} from '../types/index.js';

export class MemoryApi {
  constructor(private http: NyvHttpClient) {}

  async saveMatter(matter: {
    matterId: string;
    title: string;
    jurisdiction: NyvJurisdiction;
    domain: NyvLegalDomain;
    facts: Record<string, unknown>;
    documents?: string[];
  }): Promise<NyvMatterMemory> {
    return this.http.post('/api/jrx/memory/matter', matter);
  }

  async getMatter(matterId: string): Promise<NyvMatterMemory> {
    return this.http.get(`/api/jrx/memory/matter/${matterId}`);
  }

  async saveClient(client: {
    clientId: string;
    name: string;
    preferences?: Record<string, unknown>;
  }): Promise<NyvClientMemory> {
    return this.http.post('/api/jrx/memory/client', client);
  }

  async getClient(clientId: string): Promise<NyvClientMemory> {
    return this.http.get(`/api/jrx/memory/client/${clientId}`);
  }

  async eraseUser(userId: string): Promise<{ success: boolean; erasedAt: string }> {
    return this.http.delete(`/api/jrx/memory/user/${userId}`);
  }

  async getStats(): Promise<{
    totalMatters: number;
    totalClients: number;
    memoryTiers: { hot: number; warm: number; cold: number };
    lastUpdated: string;
  }> {
    return this.http.get('/api/jrx/memory/stats');
  }
}
