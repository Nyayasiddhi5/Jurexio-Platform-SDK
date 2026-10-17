/**
 * InternalApi — Typed wrappers for the Batches G+H+I+J consolidated
 * `/api/nv5/internal/*` admin namespace (Session-11, 2026-05-10). One barrel
 * gated by `JRX_F_INTERNAL_SURFACE` (default OFF → entire namespace 404).
 * SDK key + `admin` scope. Pure read-only metadata; no LLM emission.
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 17
 */

import type { JrxHttpClient } from '../JrxClient.js';

/**
 * Per the server (`src/routes/nv5/internal/index.ts`), each catalogue entry is
 * `{ id, category, hasHttp, hasLlm, note? }`. The barrel response wraps the
 * list in `{ success, namespace, services }`.
 */
export interface InternalCapabilitiesEntry {
  id: string;
  category: string;
  hasHttp: boolean;
  hasLlm: boolean;
  note?: string;
}

export interface InternalCapabilities {
  success: boolean;
  namespace: 'nv5-internal';
  services: InternalCapabilitiesEntry[];
}

export interface CapabilitiesEnvelope {
  capabilities: Record<string, unknown>;
  [k: string]: unknown;
}

export interface SlmAvailabilityResult {
  jurisdiction: string;
  slms: Array<{ slmId: string; available: boolean; metadata?: Record<string, unknown> }>;
}

/** Server returns `{ success, session }` — `session` shape is adapter-defined. */
export interface ESignSessionDetail {
  success: boolean;
  session: Record<string, unknown>;
}

class CapabilitiesGetter {
  constructor(protected http: JrxHttpClient, private path: string) {}
  capabilities<T = CapabilitiesEnvelope>(): Promise<T> {
    return this.http.get(this.path);
  }
}

class SlmRouterSubApi {
  constructor(private http: JrxHttpClient) {}
  availability(jurisdiction: string): Promise<SlmAvailabilityResult> {
    return this.http.get(
      `/api/nv5/internal/slm-router/availability/${encodeURIComponent(jurisdiction)}`,
    );
  }
}

class ESignSubApi extends CapabilitiesGetter {
  constructor(http: JrxHttpClient) { super(http, '/api/nv5/internal/esign/capabilities'); }
  session(sessionId: string): Promise<ESignSessionDetail> {
    return this.http.get(
      `/api/nv5/internal/esign/session/${encodeURIComponent(sessionId)}`,
    );
  }
}

class AzentzeroSubApi {
  constructor(private http: JrxHttpClient) {}
  health(): Promise<{ status: 'ok' | 'degraded' | 'down'; [k: string]: unknown }> {
    return this.http.get('/api/nv5/internal/azentzero/health');
  }
}

export class InternalApi {
  public readonly modelCascade: CapabilitiesGetter;
  public readonly slmRouter: SlmRouterSubApi;
  public readonly costAwareRouter: CapabilitiesGetter;
  public readonly esign: ESignSubApi;
  public readonly ocr: CapabilitiesGetter;
  public readonly pdfa: CapabilitiesGetter;
  public readonly watermark: CapabilitiesGetter;
  public readonly hallucination: CapabilitiesGetter;
  public readonly escalation: CapabilitiesGetter;
  public readonly eventSourcing: CapabilitiesGetter;
  public readonly jurisdictionOverlay: CapabilitiesGetter;
  public readonly auditChain: CapabilitiesGetter;
  public readonly caseUpdate: CapabilitiesGetter;
  public readonly azentzero: AzentzeroSubApi;
  public readonly agentzero: CapabilitiesGetter;
  public readonly featureFlags: CapabilitiesGetter;
  public readonly orchestrationFacade: CapabilitiesGetter;

  constructor(private http: JrxHttpClient) {
    this.modelCascade = new CapabilitiesGetter(http, '/api/nv5/internal/model-cascade/capabilities');
    this.slmRouter = new SlmRouterSubApi(http);
    this.costAwareRouter = new CapabilitiesGetter(http, '/api/nv5/internal/cost-aware-router/capabilities');
    this.esign = new ESignSubApi(http);
    this.ocr = new CapabilitiesGetter(http, '/api/nv5/internal/ocr/capabilities');
    this.pdfa = new CapabilitiesGetter(http, '/api/nv5/internal/pdfa/capabilities');
    this.watermark = new CapabilitiesGetter(http, '/api/nv5/internal/watermark/capabilities');
    this.hallucination = new CapabilitiesGetter(http, '/api/nv5/internal/hallucination/capabilities');
    this.escalation = new CapabilitiesGetter(http, '/api/nv5/internal/escalation/capabilities');
    this.eventSourcing = new CapabilitiesGetter(http, '/api/nv5/internal/event-sourcing/capabilities');
    this.jurisdictionOverlay = new CapabilitiesGetter(http, '/api/nv5/internal/jurisdiction-overlay/capabilities');
    this.auditChain = new CapabilitiesGetter(http, '/api/nv5/internal/audit-chain/capabilities');
    this.caseUpdate = new CapabilitiesGetter(http, '/api/nv5/internal/case-update/capabilities');
    this.azentzero = new AzentzeroSubApi(http);
    this.agentzero = new CapabilitiesGetter(http, '/api/nv5/internal/agentzero/capabilities');
    this.featureFlags = new CapabilitiesGetter(http, '/api/nv5/internal/feature-flags/capabilities');
    this.orchestrationFacade = new CapabilitiesGetter(http, '/api/nv5/internal/orchestration-facade/capabilities');
  }

  /** Top-level barrel listing of every wired internal service. */
  capabilities(): Promise<InternalCapabilities> {
    return this.http.get('/api/nv5/internal/capabilities');
  }
}
