/**
 * ModelsApi — LLM model catalog + provider readiness for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/models/*
 *
 * NV-PROVIDER-READINESS-001: `getProviders()` returns, for every allowed +
 * inactive provider, whether it is live (env-key present / enable flag set),
 * the env-var NAME(s) it needs (NV-SECRETS-001: names only, never values), and
 * how many catalog models it carries.
 */

import type { JrxHttpClient } from '../JrxClient.js';

export interface ProviderReadiness {
  id: string;
  status: 'allowed' | 'inactive';
  /** True when the provider can actually serve traffic right now. */
  available: boolean;
  /** True when the required env keys are present (or none are required). */
  configured: boolean;
  /** Env-var NAMES this provider needs (never values). */
  requiresEnv: string[];
  modelCount: number;
}

export interface ProvidersResponse {
  providers: ProviderReadiness[];
  summary: {
    allowed: number;
    inactive: number;
    total: number;
    [k: string]: unknown;
  };
}

export class ModelsApi {
  constructor(private readonly http: JrxHttpClient) {}

  /**
   * Per-provider readiness matrix (allowed + inactive), env-key requirements
   * (names only), and catalog model counts. `GET /api/jrx/models/providers`.
   */
  getProviders(): Promise<ProvidersResponse> {
    return this.http.get('/api/jrx/models/providers');
  }

  /** Model registry stats. `GET /api/jrx/models/stats`. */
  getStats(): Promise<Record<string, unknown>> {
    return this.http.get('/api/jrx/models/stats');
  }
}
