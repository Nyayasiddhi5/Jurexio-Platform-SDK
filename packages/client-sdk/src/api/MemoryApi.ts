import type { JrxHttpClient } from '../JrxClient.js';
import type {
  JrxJurisdiction,
  JrxLegalDomain,
  JrxMatterMemory,
  JrxClientMemory,
} from '../types/index.js';

export class MemoryApi {
  constructor(private http: JrxHttpClient) {}

  async saveMatter(matter: {
    matterId: string;
    title: string;
    jurisdiction: JrxJurisdiction;
    domain: JrxLegalDomain;
    facts: Record<string, unknown>;
    documents?: string[];
  }): Promise<JrxMatterMemory> {
    return this.http.post('/api/jrx/memory/matter', matter);
  }

  async getMatter(matterId: string): Promise<JrxMatterMemory> {
    return this.http.get(`/api/jrx/memory/matter/${matterId}`);
  }

  async saveClient(client: {
    clientId: string;
    name: string;
    preferences?: Record<string, unknown>;
  }): Promise<JrxClientMemory> {
    return this.http.post('/api/jrx/memory/client', client);
  }

  async getClient(clientId: string): Promise<JrxClientMemory> {
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
