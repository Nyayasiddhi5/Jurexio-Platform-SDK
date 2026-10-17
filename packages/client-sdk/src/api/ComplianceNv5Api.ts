/**
 * ComplianceNv5Api — Typed wrappers for the Batch F `/api/nv5/compliance/*`
 * EU AI Act + post-quantum crypto + federated-privacy admin surface
 * (Session-11, 2026-05-10). SDK key + `admin` scope; default OFF
 * (`JRX_F_COMPLIANCE_*`). No LLM emission.
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 16
 *
 * NOTE: The pre-existing `ComplianceApi` covers the canonical
 * `/api/jrx/compliance/*` DPDP/GDPR surface; this class is purely the new
 * additive `/api/nv5/compliance/*` admin surface.
 */

import type { NyvHttpClient } from '../NyvClient.js';

/* ─── EU AI Act envelopes (server: src/routes/nv5/compliance/eu-ai-act-routes.ts) ─── */

export interface EuAiActCapabilities {
  success: boolean;
  service: 'nv-eu-ai-act';
  articles: string[];
  documents: string[];
}

export interface EuAiActReportResponse {
  success: boolean;
  /** Raw report payload from `nvEuAiActService.generateFullEuComplianceReport()`. */
  report: Record<string, unknown>;
}

/** Risk-management endpoint wraps the doc as `document`. */
export interface EuAiActRiskManagementResponse {
  success: boolean;
  document: Record<string, unknown>;
}

/** Bias-audit endpoint wraps the doc as `report` (intentional server naming). */
export interface EuAiActBiasAuditResponse {
  success: boolean;
  report: Record<string, unknown>;
}

/* ─── PQC envelopes (server: src/routes/nv5/compliance/pqc-routes.ts) ─── */

export interface PqcCapabilities {
  success: boolean;
  service: 'nv-pqc';
  primitives: string[];
  operations: string[];
  note?: string;
}

/**
 * `GET /pqc/ready` is a liveness probe — server only emits
 * `{ success, ready: true }` when `nvPqcService.ready()` resolves.
 * No `mode` field; it's strictly a yes/no.
 */
export interface PqcReadiness {
  success: boolean;
  ready: boolean;
}

/**
 * `POST /pqc/{kem,dsa}-keygen` returns base64-encoded public + secret keys
 * directly (no opaque "secretKeyHandle" indirection). Lengths are
 * surfaced for sanity-checking the encoded blobs.
 */
export interface PqcKeygenResult {
  success: boolean;
  publicKeyB64: string;
  secretKeyB64: string;
  publicKeyBytes: number;
  secretKeyBytes: number;
}

export interface FederatedPrivacyCapabilities {
  success: boolean;
  service?: string;
  capabilities?: string[];
  states?: string[];
  [k: string]: unknown;
}

export interface FederatedSession {
  sessionId: string;
  clientId: string;
  status: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

/**
 * Server contract (`POST /api/nv5/compliance/federated-privacy/dp-noise`):
 * single numeric query result + sensitivity + epsilon, NOT a vector.
 * Server returns `{ success, original, sensitivity, epsilon, noised }`.
 */
export interface DpNoiseRequest {
  queryResult: number;
  sensitivity: number;
  epsilon: number;
}

export interface DpNoiseResult {
  success: boolean;
  original: number;
  sensitivity: number;
  epsilon: number;
  noised: number;
}

export interface FederatedSessionResponse {
  success: boolean;
  session: FederatedSession;
}

export interface FederatedSessionsListResponse {
  success: boolean;
  sessions: FederatedSession[];
}

class EuAiActSubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<EuAiActCapabilities> {
    return this.http.get('/api/nv5/compliance/eu-ai-act/capabilities');
  }
  report(): Promise<EuAiActReportResponse> {
    return this.http.get('/api/nv5/compliance/eu-ai-act/report');
  }
  riskManagement(agentId: string): Promise<EuAiActRiskManagementResponse> {
    return this.http.get(`/api/nv5/compliance/eu-ai-act/agent/${encodeURIComponent(agentId)}/risk-management`);
  }
  biasAudit(agentId: string): Promise<EuAiActBiasAuditResponse> {
    return this.http.get(`/api/nv5/compliance/eu-ai-act/agent/${encodeURIComponent(agentId)}/bias-audit`);
  }
}

class PqcSubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<PqcCapabilities> {
    return this.http.get('/api/nv5/compliance/pqc/capabilities');
  }
  ready(): Promise<PqcReadiness> {
    return this.http.get('/api/nv5/compliance/pqc/ready');
  }
  /**
   * ML-KEM (Kyber) keypair generation. The server ignores the request body
   * — the algorithm is fixed by service config — so no parameters are
   * accepted. Returns base64-encoded public + secret keys.
   */
  kemKeygen(): Promise<PqcKeygenResult> {
    return this.http.post('/api/nv5/compliance/pqc/kem-keygen', {});
  }
  /**
   * ML-DSA (Dilithium) keypair generation. Like `kemKeygen()`, the server
   * ignores the request body.
   */
  dsaKeygen(): Promise<PqcKeygenResult> {
    return this.http.post('/api/nv5/compliance/pqc/dsa-keygen', {});
  }
}

class FederatedPrivacySubApi {
  constructor(private http: NyvHttpClient) {}
  capabilities(): Promise<FederatedPrivacyCapabilities> {
    return this.http.get('/api/nv5/compliance/federated-privacy/capabilities');
  }
  listSessions(opts?: { clientId?: string; status?: string }): Promise<FederatedSessionsListResponse> {
    const params = new URLSearchParams();
    if (opts?.clientId) params.set('clientId', opts.clientId);
    if (opts?.status) params.set('status', opts.status);
    const q = params.toString() ? `?${params.toString()}` : '';
    return this.http.get(`/api/nv5/compliance/federated-privacy/sessions${q}`);
  }
  getSession(sessionId: string): Promise<FederatedSessionResponse> {
    return this.http.get(`/api/nv5/compliance/federated-privacy/sessions/${encodeURIComponent(sessionId)}`);
  }
  dpNoise(req: DpNoiseRequest): Promise<DpNoiseResult> {
    return this.http.post('/api/nv5/compliance/federated-privacy/dp-noise', req);
  }
}

export class ComplianceNv5Api {
  public readonly euAiAct: EuAiActSubApi;
  public readonly pqc: PqcSubApi;
  public readonly federatedPrivacy: FederatedPrivacySubApi;

  constructor(http: NyvHttpClient) {
    this.euAiAct = new EuAiActSubApi(http);
    this.pqc = new PqcSubApi(http);
    this.federatedPrivacy = new FederatedPrivacySubApi(http);
  }
}
