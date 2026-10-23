import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import { PAYMENT_CONFIG } from '../config/platform-config.js';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('razorpay-payment-service');

// ─── Interfaces ───────────────────────────────────────────────────────────────

export type SupportedCurrency = 'INR' | 'USD' | 'AED' | 'SAR' | 'SGD' | 'EUR';

export interface RazorpayOrder {
  id: string;
  entity: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: SupportedCurrency;
  receipt: string;
  status: string;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayPayment {
  id: string;
  entity: string;
  amount: number;
  currency: SupportedCurrency;
  status: string;
  method: string;
  description: string;
  order_id: string;
  email: string;
  contact: string;
  notes: Record<string, string>;
  created_at: number;
  captured: boolean;
}

export interface RazorpayRefund {
  id: string;
  entity: string;
  amount: number;
  currency: SupportedCurrency;
  payment_id: string;
  notes: Record<string, string>;
  status: string;
  created_at: number;
}

export interface RazorpayCustomer {
  id: string;
  entity: string;
  name: string;
  email: string;
  contact: string;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayPlan {
  id: string;
  entity: string;
  interval: number;
  period: string;
  item: {
    id: string;
    active: boolean;
    amount: number;
    unit_amount: number;
    currency: SupportedCurrency;
    name: string;
    description: string;
  };
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpaySubscription {
  id: string;
  entity: string;
  plan_id: string;
  customer_id: string;
  status: string;
  current_start: number;
  current_end: number;
  total_count: number;
  paid_count: number;
  remaining_count: number;
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayInvoice {
  id: string;
  entity: string;
  type: string;
  status: string;
  amount: number;
  amount_paid: number;
  amount_due: number;
  currency: SupportedCurrency;
  description: string;
  customer_id: string;
  customer_details: {
    name: string;
    email: string;
    contact: string;
  };
  line_items: RazorpayLineItem[];
  notes: Record<string, string>;
  created_at: number;
}

export interface RazorpayLineItem {
  id: string;
  name: string;
  amount: number;
  currency: SupportedCurrency;
  quantity: number;
}

export interface RazorpayPaymentLink {
  id: string;
  entity: string;
  amount: number;
  currency: SupportedCurrency;
  status: string;
  description: string;
  short_url: string;
  callback_url: string;
  customer: {
    name?: string;
    email?: string;
    contact?: string;
  };
  created_at: number;
}

export interface ListOptions {
  from?: number;
  to?: number;
  count?: number;
  skip?: number;
}

export interface InvoiceParams {
  type?: string;
  description?: string;
  customer_id?: string;
  customer?: {
    name: string;
    email: string;
    contact: string;
  };
  line_items: {
    name: string;
    amount: number;
    currency?: SupportedCurrency;
    quantity?: number;
  }[];
  currency?: SupportedCurrency;
  notes?: Record<string, string>;
}

export interface PaymentLinkCustomer {
  name?: string;
  email?: string;
  contact?: string;
}

export interface ServiceStatistics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalRetries: number;
  ordersCreated: number;
  paymentsCaptured: number;
  refundsProcessed: number;
  subscriptionsCreated: number;
  customersCreated: number;
  invoicesCreated: number;
  paymentLinksCreated: number;
  webhooksVerified: number;
  webhooksFailed: number;
  lastRequestAt: string | null;
  averageResponseTime: number;
  responseTimes: number[];
}

export interface PlatformTier {
  name: string;
  period: string;
  interval: number;
  amount: number;
  currency: SupportedCurrency;
  description: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RAZORPAY_BASE_URL = PAYMENT_CONFIG.razorpay.baseUrl;
const MAX_RETRIES = PAYMENT_CONFIG.razorpay.maxRetries;
const INITIAL_RETRY_DELAY_MS = PAYMENT_CONFIG.razorpay.retryDelayMs;
const SUPPORTED_CURRENCIES: SupportedCurrency[] = ['INR', 'USD', 'AED', 'SAR', 'SGD', 'EUR'];

const PLATFORM_TIERS: Record<string, PlatformTier> = {
  starter: {
    name: 'Starter Plan',
    period: 'monthly',
    interval: 1,
    amount: 99900,
    currency: 'INR',
    description: 'Legal platform Starter tier - basic document review, up to 50 queries/month',
  },
  professional: {
    name: 'Professional Plan',
    period: 'monthly',
    interval: 1,
    amount: 299900,
    currency: 'INR',
    description: 'Legal platform Professional tier - advanced analysis, unlimited queries, priority support',
  },
  enterprise: {
    name: 'Enterprise Plan',
    period: 'monthly',
    interval: 1,
    amount: 999900,
    currency: 'INR',
    description: 'Legal platform Enterprise tier - full suite, custom integrations, dedicated support, SLA',
  },
  government: {
    name: 'Government Plan',
    period: 'yearly',
    interval: 1,
    amount: 4999900,
    currency: 'INR',
    description: 'Legal platform Government tier - sovereign deployment, compliance frameworks, audit trails',
  },
};

// ─── Service ──────────────────────────────────────────────────────────────────

export class RazorpayPaymentService extends EventEmitter {
  private keyId: string;
  private keySecret: string;
  private webhookSecret: string;
  private authHeader: string;
  private isConfigured: boolean;
  private stats: ServiceStatistics;

  constructor() {
    super();
    this.keyId = PAYMENT_CONFIG.razorpay.keyId;
    this.keySecret = PAYMENT_CONFIG.razorpay.keySecret;
    this.webhookSecret = PAYMENT_CONFIG.razorpay.webhookSecret;
    this.isConfigured = !!(this.keyId && this.keySecret);
    this.authHeader = this.isConfigured
      ? 'Basic ' + Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64')
      : '';

    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalRetries: 0,
      ordersCreated: 0,
      paymentsCaptured: 0,
      refundsProcessed: 0,
      subscriptionsCreated: 0,
      customersCreated: 0,
      invoicesCreated: 0,
      paymentLinksCreated: 0,
      webhooksVerified: 0,
      webhooksFailed: 0,
      lastRequestAt: null,
      averageResponseTime: 0,
      responseTimes: [],
    };

    if (this.isConfigured) {
      logger.info('[Razorpay] Payment service initialized with API credentials');
    } else {
      logger.info('[Razorpay] Payment service running in mock mode - API keys not configured');
    }
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private validateCurrency(currency: string): SupportedCurrency {
    const upper = currency.toUpperCase() as SupportedCurrency;
    if (!SUPPORTED_CURRENCIES.includes(upper)) {
      throw new Error(`[Razorpay] Unsupported currency: ${currency}. Supported: ${SUPPORTED_CURRENCIES.join(', ')}`);
    }
    return upper;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    if (!this.isConfigured) {
      return this.getMockResponse<T>(method, path, body);
    }

    const url = `${RAZORPAY_BASE_URL}${path}`;
    let lastError: Error | null = null;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = INITIAL_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        logger.info(`[Razorpay] Retry attempt ${attempt}/${MAX_RETRIES} after ${delay}ms`);
        this.stats.totalRetries++;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      this.stats.totalRequests++;
      this.stats.lastRequestAt = new Date().toISOString();

      try {
        const options: RequestInit = {
          method,
          headers: {
            'Authorization': this.authHeader,
            'Content-Type': 'application/json',
          },
        };

        if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
          options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        const elapsed = Date.now() - startTime;
        this.trackResponseTime(elapsed);

        if (response.ok) {
          const data = (await response.json()) as T;
          this.stats.successfulRequests++;
          this.emit('request:success', { method, path, elapsed });
          return data;
        }

        const errorBody = await response.text();

        if (response.status === 429 || response.status >= 500) {
          lastError = new Error(`[Razorpay] HTTP ${response.status}: ${errorBody}`);
          logger.info(`[Razorpay] Retryable error ${response.status} on ${method} ${path}`);
          continue;
        }

        this.stats.failedRequests++;
        this.emit('request:error', { method, path, status: response.status, error: errorBody });
        throw new Error(`[Razorpay] HTTP ${response.status}: ${errorBody}`);
      } catch (err: unknown) {
        const error = err instanceof Error ? err : new Error(String(err));
        if (error.message.startsWith('[Razorpay] HTTP 4')) {
          throw error;
        }
        lastError = error;
        logger.info(`[Razorpay] Network error on ${method} ${path}: ${error.message}`);
      }
    }

    this.stats.failedRequests++;
    this.emit('request:failed', { method, path, error: lastError?.message });
    throw lastError || new Error(`[Razorpay] Request failed after ${MAX_RETRIES} retries`);
  }

  private trackResponseTime(ms: number): void {
    this.stats.responseTimes.push(ms);
    if (this.stats.responseTimes.length > 100) {
      this.stats.responseTimes = this.stats.responseTimes.slice(-100);
    }
    const sum = this.stats.responseTimes.reduce((a, b) => a + b, 0);
    this.stats.averageResponseTime = Math.round(sum / this.stats.responseTimes.length);
  }

  private getMockResponse<T>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): T {
    logger.info(`[Razorpay] Mock response for ${method} ${path}`);
    this.stats.totalRequests++;
    this.stats.successfulRequests++;
    this.stats.lastRequestAt = new Date().toISOString();
    this.trackResponseTime(5);
    const now = Math.floor(Date.now() / 1000);
    const mockId = `mock_${crypto.randomBytes(8).toString('hex')}`;

    if (path.startsWith('/orders') && method === 'POST') {
      return {
        id: `order_${mockId}`,
        entity: 'order',
        amount: (body?.amount as number) || 0,
        amount_paid: 0,
        amount_due: (body?.amount as number) || 0,
        currency: (body?.currency as string) || 'INR',
        receipt: (body?.receipt as string) || '',
        status: 'created',
        notes: (body?.notes as Record<string, string>) || {},
        created_at: now,
      } as T;
    }

    if (path.startsWith('/orders/') && method === 'GET') {
      return {
        id: path.split('/').pop(),
        entity: 'order',
        amount: 50000,
        amount_paid: 0,
        amount_due: 50000,
        currency: 'INR',
        receipt: 'mock_receipt',
        status: 'created',
        notes: {},
        created_at: now,
      } as T;
    }

    if (path === '/orders' && method === 'GET') {
      return { entity: 'collection', count: 0, items: [] } as T;
    }

    if (path.match(/\/payments\/[^/]+\/capture/) && method === 'POST') {
      return {
        id: path.split('/')[2],
        entity: 'payment',
        amount: (body?.amount as number) || 0,
        currency: (body?.currency as string) || 'INR',
        status: 'captured',
        method: 'card',
        description: '',
        order_id: '',
        email: '',
        contact: '',
        notes: {},
        created_at: now,
        captured: true,
      } as T;
    }

    if (path.match(/\/payments\/[^/]+\/refund/) && method === 'POST') {
      return {
        id: `rfnd_${mockId}`,
        entity: 'refund',
        amount: (body?.amount as number) || 0,
        currency: 'INR',
        payment_id: path.split('/')[2],
        notes: (body?.notes as Record<string, string>) || {},
        status: 'processed',
        created_at: now,
      } as T;
    }

    if (path.startsWith('/payments/') && method === 'GET') {
      return {
        id: path.split('/').pop(),
        entity: 'payment',
        amount: 50000,
        currency: 'INR',
        status: 'captured',
        method: 'card',
        description: '',
        order_id: '',
        email: '',
        contact: '',
        notes: {},
        created_at: now,
        captured: true,
      } as T;
    }

    if (path === '/payments' && method === 'GET') {
      return { entity: 'collection', count: 0, items: [] } as T;
    }

    if (path === '/customers' && method === 'POST') {
      return {
        id: `cust_${mockId}`,
        entity: 'customer',
        name: (body?.name as string) || '',
        email: (body?.email as string) || '',
        contact: (body?.contact as string) || '',
        notes: (body?.notes as Record<string, string>) || {},
        created_at: now,
      } as T;
    }

    if (path.startsWith('/customers/') && method === 'GET') {
      return {
        id: path.split('/').pop(),
        entity: 'customer',
        name: 'Mock Customer',
        email: 'mock@example.com',
        contact: '+919999999999',
        notes: {},
        created_at: now,
      } as T;
    }

    if (path === '/plans' && method === 'POST') {
      return {
        id: `plan_${mockId}`,
        entity: 'plan',
        interval: (body?.interval as number) || 1,
        period: (body?.period as string) || 'monthly',
        item: {
          id: `item_${mockId}`,
          active: true,
          amount: ((body?.item as Record<string, unknown>)?.amount as number) || 0,
          unit_amount: ((body?.item as Record<string, unknown>)?.amount as number) || 0,
          currency: ((body?.item as Record<string, unknown>)?.currency as string) || 'INR',
          name: ((body?.item as Record<string, unknown>)?.name as string) || '',
          description: ((body?.item as Record<string, unknown>)?.description as string) || '',
        },
        notes: {},
        created_at: now,
      } as T;
    }

    if (path === '/subscriptions' && method === 'POST') {
      return {
        id: `sub_${mockId}`,
        entity: 'subscription',
        plan_id: (body?.plan_id as string) || '',
        customer_id: (body?.customer_id as string) || '',
        status: 'created',
        current_start: now,
        current_end: now + 2592000,
        total_count: (body?.total_count as number) || 12,
        paid_count: 0,
        remaining_count: (body?.total_count as number) || 12,
        notes: (body?.notes as Record<string, string>) || {},
        created_at: now,
      } as T;
    }

    if (path.startsWith('/subscriptions/') && method === 'GET') {
      return {
        id: path.split('/').pop(),
        entity: 'subscription',
        plan_id: 'plan_mock',
        customer_id: 'cust_mock',
        status: 'active',
        current_start: now - 2592000,
        current_end: now,
        total_count: 12,
        paid_count: 1,
        remaining_count: 11,
        notes: {},
        created_at: now - 2592000,
      } as T;
    }

    if (path.match(/\/subscriptions\/[^/]+\/cancel/) && method === 'POST') {
      return {
        id: path.split('/')[2],
        entity: 'subscription',
        plan_id: 'plan_mock',
        customer_id: 'cust_mock',
        status: 'cancelled',
        current_start: now - 2592000,
        current_end: now,
        total_count: 12,
        paid_count: 1,
        remaining_count: 0,
        notes: {},
        created_at: now - 2592000,
      } as T;
    }

    if (path === '/invoices' && method === 'POST') {
      return {
        id: `inv_${mockId}`,
        entity: 'invoice',
        type: (body?.type as string) || 'invoice',
        status: 'issued',
        amount: 0,
        amount_paid: 0,
        amount_due: 0,
        currency: (body?.currency as string) || 'INR',
        description: (body?.description as string) || '',
        customer_id: (body?.customer_id as string) || '',
        customer_details: (body?.customer as object) || { name: '', email: '', contact: '' },
        line_items: (body?.line_items as RazorpayLineItem[]) || [],
        notes: (body?.notes as Record<string, string>) || {},
        created_at: now,
      } as T;
    }

    if (path.startsWith('/invoices/') && method === 'GET') {
      return {
        id: path.split('/').pop(),
        entity: 'invoice',
        type: 'invoice',
        status: 'issued',
        amount: 50000,
        amount_paid: 0,
        amount_due: 50000,
        currency: 'INR',
        description: 'Mock invoice',
        customer_id: 'cust_mock',
        customer_details: { name: 'Mock', email: 'mock@example.com', contact: '+919999999999' },
        line_items: [],
        notes: {},
        created_at: now,
      } as T;
    }

    if (path === '/payment_links' && method === 'POST') {
      return {
        id: `plink_${mockId}`,
        entity: 'payment_link',
        amount: (body?.amount as number) || 0,
        currency: (body?.currency as string) || 'INR',
        status: 'created',
        description: (body?.description as string) || '',
        short_url: `https://rzp.io/i/${mockId}`,
        callback_url: (body?.callback_url as string) || '',
        customer: (body?.customer as object) || {},
        created_at: now,
      } as T;
    }

    return { id: mockId, entity: 'unknown', created_at: now } as T;
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  async createOrder(
    amount: number,
    currency: SupportedCurrency = 'INR',
    receipt?: string,
    notes?: Record<string, string>,
  ): Promise<RazorpayOrder> {
    this.validateCurrency(currency);
    logger.info(`[Razorpay] Creating order: amount=${amount} currency=${currency}`);
    const order = await this.request<RazorpayOrder>('POST', '/orders', {
      amount,
      currency,
      receipt: receipt || `rcpt_${Date.now()}`,
      notes: notes || {},
    });
    this.stats.ordersCreated++;
    this.emit('order:created', order);
    return order;
  }

  async getOrder(orderId: string): Promise<RazorpayOrder> {
    logger.info(`[Razorpay] Fetching order: ${orderId}`);
    return this.request<RazorpayOrder>('GET', `/orders/${orderId}`);
  }

  async listOrders(options?: ListOptions): Promise<{ entity: string; count: number; items: RazorpayOrder[] }> {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', String(options.from));
    if (options?.to) params.set('to', String(options.to));
    if (options?.count) params.set('count', String(options.count));
    if (options?.skip) params.set('skip', String(options.skip));
    const qs = params.toString();
    const path = qs ? `/orders?${qs}` : '/orders';
    logger.info(`[Razorpay] Listing orders`);
    return this.request('GET', path);
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  async capturePayment(
    paymentId: string,
    amount: number,
    currency: SupportedCurrency = 'INR',
  ): Promise<RazorpayPayment> {
    this.validateCurrency(currency);
    logger.info(`[Razorpay] Capturing payment: ${paymentId} amount=${amount}`);
    const payment = await this.request<RazorpayPayment>('POST', `/payments/${paymentId}/capture`, {
      amount,
      currency,
    });
    this.stats.paymentsCaptured++;
    this.emit('payment:captured', payment);
    return payment;
  }

  async getPayment(paymentId: string): Promise<RazorpayPayment> {
    logger.info(`[Razorpay] Fetching payment: ${paymentId}`);
    return this.request<RazorpayPayment>('GET', `/payments/${paymentId}`);
  }

  async listPayments(options?: ListOptions): Promise<{ entity: string; count: number; items: RazorpayPayment[] }> {
    const params = new URLSearchParams();
    if (options?.from) params.set('from', String(options.from));
    if (options?.to) params.set('to', String(options.to));
    if (options?.count) params.set('count', String(options.count));
    if (options?.skip) params.set('skip', String(options.skip));
    const qs = params.toString();
    const path = qs ? `/payments?${qs}` : '/payments';
    logger.info(`[Razorpay] Listing payments`);
    return this.request('GET', path);
  }

  async refundPayment(
    paymentId: string,
    amount?: number,
    notes?: Record<string, string>,
  ): Promise<RazorpayRefund> {
    logger.info(`[Razorpay] Refunding payment: ${paymentId} amount=${amount || 'full'}`);
    const body: Record<string, unknown> = {};
    if (amount !== undefined) body.amount = amount;
    if (notes) body.notes = notes;
    const refund = await this.request<RazorpayRefund>('POST', `/payments/${paymentId}/refund`, body);
    this.stats.refundsProcessed++;
    this.emit('refund:processed', refund);
    return refund;
  }

  // ─── Subscriptions ────────────────────────────────────────────────────────

  async createPlan(
    name: string,
    period: string,
    interval: number,
    amount: number,
    currency: SupportedCurrency = 'INR',
    description?: string,
  ): Promise<RazorpayPlan> {
    this.validateCurrency(currency);
    logger.info(`[Razorpay] Creating plan: ${name} period=${period} interval=${interval}`);
    const plan = await this.request<RazorpayPlan>('POST', '/plans', {
      period,
      interval,
      item: {
        name,
        amount,
        currency,
        description: description || '',
      },
    });
    this.emit('plan:created', plan);
    return plan;
  }

  async createSubscription(
    planId: string,
    customerId: string,
    totalCount: number = 12,
    notes?: Record<string, string>,
  ): Promise<RazorpaySubscription> {
    logger.info(`[Razorpay] Creating subscription: plan=${planId} customer=${customerId}`);
    const subscription = await this.request<RazorpaySubscription>('POST', '/subscriptions', {
      plan_id: planId,
      customer_id: customerId,
      total_count: totalCount,
      notes: notes || {},
    });
    this.stats.subscriptionsCreated++;
    this.emit('subscription:created', subscription);
    return subscription;
  }

  async getSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
    logger.info(`[Razorpay] Fetching subscription: ${subscriptionId}`);
    return this.request<RazorpaySubscription>('GET', `/subscriptions/${subscriptionId}`);
  }

  async cancelSubscription(
    subscriptionId: string,
    cancelAtEnd: boolean = false,
  ): Promise<RazorpaySubscription> {
    logger.info(`[Razorpay] Cancelling subscription: ${subscriptionId} cancelAtEnd=${cancelAtEnd}`);
    const result = await this.request<RazorpaySubscription>('POST', `/subscriptions/${subscriptionId}/cancel`, {
      cancel_at_cycle_end: cancelAtEnd ? 1 : 0,
    });
    this.emit('subscription:cancelled', result);
    return result;
  }

  async createPlatformTierPlan(tier: 'starter' | 'professional' | 'enterprise' | 'government'): Promise<RazorpayPlan> {
    const config = PLATFORM_TIERS[tier];
    if (!config) {
      throw new Error(`[Razorpay] Unknown platform tier: ${tier}. Valid tiers: ${Object.keys(PLATFORM_TIERS).join(', ')}`);
    }
    logger.info(`[Razorpay] Creating platform tier plan: ${tier}`);
    return this.createPlan(
      config.name,
      config.period,
      config.interval,
      config.amount,
      config.currency,
      config.description,
    );
  }

  getPlatformTiers(): Record<string, PlatformTier> {
    return { ...PLATFORM_TIERS };
  }

  // ─── Customers ────────────────────────────────────────────────────────────

  async createCustomer(
    name: string,
    email: string,
    contact: string,
    notes?: Record<string, string>,
  ): Promise<RazorpayCustomer> {
    logger.info(`[Razorpay] Creating customer: ${name} email=${email}`);
    const customer = await this.request<RazorpayCustomer>('POST', '/customers', {
      name,
      email,
      contact,
      notes: notes || {},
    });
    this.stats.customersCreated++;
    this.emit('customer:created', customer);
    return customer;
  }

  async getCustomer(customerId: string): Promise<RazorpayCustomer> {
    logger.info(`[Razorpay] Fetching customer: ${customerId}`);
    return this.request<RazorpayCustomer>('GET', `/customers/${customerId}`);
  }

  // ─── Invoices ─────────────────────────────────────────────────────────────

  async createInvoice(params: InvoiceParams): Promise<RazorpayInvoice> {
    logger.info(`[Razorpay] Creating invoice`);
    const invoice = await this.request<RazorpayInvoice>('POST', '/invoices', params as unknown as Record<string, unknown>);
    this.stats.invoicesCreated++;
    this.emit('invoice:created', invoice);
    return invoice;
  }

  async getInvoice(invoiceId: string): Promise<RazorpayInvoice> {
    logger.info(`[Razorpay] Fetching invoice: ${invoiceId}`);
    return this.request<RazorpayInvoice>('GET', `/invoices/${invoiceId}`);
  }

  // ─── Webhook Verification ─────────────────────────────────────────────────

  verifyWebhookSignature(
    body: string,
    signature: string,
    secret?: string,
  ): boolean {
    const webhookKey = secret || this.webhookSecret;
    if (!webhookKey) {
      logger.info('[Razorpay] Webhook secret not configured, skipping verification');
      this.stats.webhooksFailed++;
      return false;
    }

    try {
      const expectedSignature = crypto
        .createHmac('sha256', webhookKey)
        .update(body)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(expectedSignature, 'hex'),
        Buffer.from(signature, 'hex'),
      );

      if (isValid) {
        this.stats.webhooksVerified++;
        this.emit('webhook:verified', { signature });
        logger.info('[Razorpay] Webhook signature verified successfully');
      } else {
        this.stats.webhooksFailed++;
        this.emit('webhook:failed', { signature });
        logger.info('[Razorpay] Webhook signature verification failed');
      }

      return isValid;
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      logger.info(`[Razorpay] Webhook verification error: ${error.message}`);
      this.stats.webhooksFailed++;
      this.emit('webhook:error', { error: error.message });
      return false;
    }
  }

  // ─── Payment Links ────────────────────────────────────────────────────────

  async createPaymentLink(
    amount: number,
    currency: SupportedCurrency = 'INR',
    description?: string,
    customer?: PaymentLinkCustomer,
    callbackUrl?: string,
  ): Promise<RazorpayPaymentLink> {
    this.validateCurrency(currency);
    logger.info(`[Razorpay] Creating payment link: amount=${amount} currency=${currency}`);
    const link = await this.request<RazorpayPaymentLink>('POST', '/payment_links', {
      amount,
      currency,
      description: description || '',
      customer: customer || {},
      callback_url: callbackUrl || '',
      callback_method: callbackUrl ? 'get' : undefined,
    });
    this.stats.paymentLinksCreated++;
    this.emit('paymentLink:created', link);
    return link;
  }

  // ─── Statistics & Monitoring ──────────────────────────────────────────────

  getStatistics(): ServiceStatistics {
    const { responseTimes, ...publicStats } = this.stats;
    return { ...publicStats, responseTimes: [...responseTimes] };
  }

  getHealthStatus(): {
    service: string;
    configured: boolean;
    mode: string;
    stats: ServiceStatistics;
    platformTiers: string[];
  } {
    return {
      service: 'razorpay-payment-service',
      configured: this.isConfigured,
      mode: this.isConfigured ? 'live' : 'mock',
      stats: this.getStatistics(),
      platformTiers: Object.keys(PLATFORM_TIERS),
    };
  }

  resetStatistics(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalRetries: 0,
      ordersCreated: 0,
      paymentsCaptured: 0,
      refundsProcessed: 0,
      subscriptionsCreated: 0,
      customersCreated: 0,
      invoicesCreated: 0,
      paymentLinksCreated: 0,
      webhooksVerified: 0,
      webhooksFailed: 0,
      lastRequestAt: null,
      averageResponseTime: 0,
      responseTimes: [],
    };
    logger.info('[Razorpay] Statistics reset');
    this.emit('stats:reset');
  }
}

export const razorpayPaymentService = new RazorpayPaymentService();
