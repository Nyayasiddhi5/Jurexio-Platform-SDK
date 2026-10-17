import type { EnterpriseHttpClient } from '../client.js';
import type { GstInvoiceRequest, GstInvoiceResult, CreditWallet } from './types.js';

export class BillingClient {
  constructor(private http: EnterpriseHttpClient) {}

  async getWallet(): Promise<CreditWallet> {
    return this.http.get('/api/jrx/credits/wallet');
  }

  async deduct(amount: number, reason: string, referenceId?: string): Promise<{ success: boolean; newBalance: number }> {
    return this.http.post('/api/jrx/credits/deduct', { amount, reason, referenceId });
  }

  async addCredits(amount: number, source: string, referenceId?: string): Promise<{ success: boolean; newBalance: number }> {
    return this.http.post('/api/jrx/credits/add', { amount, source, referenceId });
  }

  async createSubscription(planId: string, billingCycle: 'monthly' | 'quarterly' | 'annual'): Promise<{
    subscriptionId: string;
    status: string;
    razorpaySubId?: string;
  }> {
    return this.http.post('/api/jrx/billing/subscription', { planId, billingCycle });
  }

  async getUsage(options?: { from?: string; to?: string; granularity?: string }): Promise<{
    totalCreditsUsed: number;
    totalRequests: number;
    byDay: { date: string; credits: number; requests: number }[];
  }> {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', options.from);
    if (options?.to) params.set('to', options.to);
    if (options?.granularity) params.set('granularity', options.granularity);
    return this.http.get(`/api/jrx/credits/usage?${params.toString()}`);
  }

  async computeGst(baseAmount: number, supplierStateCode?: string, customerStateCode?: string): Promise<GstInvoiceResult> {
    return this.http.post('/api/jrx/gst/compute', {
      base_amount: baseAmount,
      supplier_state_code: supplierStateCode,
      customer_state_code: customerStateCode,
    });
  }

  async generateInvoice(data: GstInvoiceRequest): Promise<GstInvoiceResult> {
    return this.http.post('/api/jrx/gst/invoice', data);
  }

  async downloadInvoicePdf(data: GstInvoiceRequest): Promise<Record<string, unknown>> {
    return this.http.post('/api/jrx/gst/invoice/pdf', data);
  }
}
