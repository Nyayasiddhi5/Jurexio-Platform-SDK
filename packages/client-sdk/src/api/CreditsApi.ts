import type { NyvHttpClient } from '../NyvClient.js';
import type {
  NyvCreditWallet,
  NyvCreditTransaction,
} from '../types/index.js';

export class CreditsApi {
  constructor(private http: NyvHttpClient) {}

  async getWallet(): Promise<NyvCreditWallet> {
    return this.http.get('/api/jrx/credits/wallet');
  }

  async getTransactions(options?: {
    page?: number;
    pageSize?: number;
    type?: string;
    from?: string;
    to?: string;
  }): Promise<{ transactions: NyvCreditTransaction[]; total: number; page: number }> {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.pageSize) params.set('pageSize', String(options.pageSize));
    if (options?.type) params.set('type', options.type);
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    return this.http.get(`/api/jrx/credits/transactions?${params.toString()}`);
  }

  async estimateCost(
    pattern: string,
    estimatedTokens?: number
  ): Promise<{ pattern: string; estimatedCredits: number; tier: string }> {
    return this.http.post('/api/jrx/credits/estimate', { pattern, estimatedTokens });
  }

  async getUsageSummary(options?: {
    from?: string;
    to?: string;
    granularity?: 'hourly' | 'daily' | 'weekly' | 'monthly';
  }): Promise<{
    totalCreditsUsed: number;
    totalRequests: number;
    byPattern: Record<string, number>;
    byDay: { date: string; credits: number; requests: number }[];
  }> {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.granularity) params.set('granularity', options.granularity);
    return this.http.get(`/api/jrx/credits/usage?${params.toString()}`);
  }
}
