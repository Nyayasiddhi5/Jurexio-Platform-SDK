/**
 * NyayavignyaEnterpriseClient — Root enterprise SDK client.
 * Wraps all sub-clients with shared auth, base URL config, and error handling.
 */
import { ComplianceClient } from './compliance/client.js';
import { BillingClient } from './billing/client.js';
import { OrgManagementClient } from './org/client.js';

export interface EnterpriseClientConfig {
  baseUrl: string;
  apiKey: string;
  orgId: string;
  timeout?: number;
}

export interface EnterpriseHttpClient {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
  patch<T = unknown>(path: string, body: unknown): Promise<T>;
  delete<T = unknown>(path: string): Promise<T>;
}

export class EnterpriseHttpClientImpl implements EnterpriseHttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeout: number;

  constructor(config: EnterpriseClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-NYV-Org-ID': config.orgId,
      'X-NYV-SDK-Version': '5.0.0',
      'X-NYV-SDK': 'enterprise',
    };
    this.timeout = config.timeout ?? 30_000;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const res = await fetch(url, {
        method,
        headers: this.headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        let errBody: Record<string, unknown> = {};
        try { errBody = await res.json() as Record<string, unknown>; } catch { /* ignore */ }
        throw new Error(
          `NYV Enterprise API error: ${res.status} ${res.statusText} — ${errBody.message ?? errBody.error ?? 'Unknown error'}`
        );
      }

      const json = await res.json();
      if (json && typeof json === 'object' && 'data' in json && (json as any).data !== undefined) {
        return (json as any).data as T;
      }
      return json as T;
    } finally {
      clearTimeout(timer);
    }
  }
}

export class NyayavignyaEnterpriseClient {
  public static readonly VERSION = '5.0.0';

  public readonly compliance: ComplianceClient;
  public readonly billing: BillingClient;
  public readonly org: OrgManagementClient;

  private config: EnterpriseClientConfig;
  private http: EnterpriseHttpClient;

  constructor(config: EnterpriseClientConfig) {
    this.config = config;
    this.http = new EnterpriseHttpClientImpl(config);
    this.compliance = new ComplianceClient(this.http);
    this.billing = new BillingClient(this.http);
    this.org = new OrgManagementClient(this.http, config.orgId);
  }

  async healthCheck(): Promise<{ status: string; version: string; org: string }> {
    const result = await this.http.get<{ status: string; version: string }>('/api/jrx/health');
    return { ...result, org: this.config.orgId };
  }
}
