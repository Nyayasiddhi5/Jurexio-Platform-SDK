/**
 * OrchApi — Typed wrappers for the Batch A `/api/nv5/orch/*` orchestration
 * primitives (Session-10, 2026-05-10). All routes are SDK-authenticated and
 * default to OFF on the gateway — flip the matching `JRX_F_AI_ORCH_*` flag
 * to enable. None of these endpoints emit an LLM call (NV-LLM-001).
 *
 * Reference: docs/canonical/04-sdk-and-api-canonical-2026-05-07.md § 11
 */

import type { NyvHttpClient } from '../NyvClient.js';

/**
 * Generic per-router health envelope. Server emits `{ success, service }`
 * (and sometimes additional fields like `instantiated`); we keep the type
 * open-ended so additive server changes don't break consumers.
 */
export interface OrchHealth {
  success: boolean;
  service: string;
  [k: string]: unknown;
}

/* ─── KB (server: src/routes/nv5-orch-kb.ts) ─── */

export interface KbCreateRequest {
  /** Required by route handler (`name and ownerId required`). */
  name: string;
  /** Required by route handler. */
  ownerId: string;
  description?: string;
  organizationId?: string;
  type?: string;
  settings?: Record<string, unknown>;
  permissions?: Record<string, unknown>;
}

export interface KbCreateResponse {
  success: boolean;
  /** Raw payload from `KnowledgeBaseSystem.createKnowledgeBase()`. */
  knowledgeBase: Record<string, unknown>;
}

/* ─── ROMA L5 (server: src/routes/nv5-orch-roma.ts) ─── */

export interface RomaOutcomeTrackRequest {
  /** Server requires `agentId` (NOT `patternId`). */
  agentId: string;
  /** Free-form outcome payload forwarded to `romaL5Engine.trackOutcome()`. */
  outcome: Record<string, unknown>;
}

export interface RomaAuditTrailResponse {
  success: boolean;
  auditTrail: Array<Record<string, unknown>>;
  count: number;
}

export interface RomaPerformanceStoreResponse {
  success: boolean;
  /** Shape is engine-internal — surfaced as opaque to consumers. */
  performanceStore: Record<string, unknown>;
}

/* ─── BM25 agent selector (server: src/routes/nv5-orch-agent-select.ts) ─── */

/**
 * Mirrors `AgentDescriptor` from `services/bm25-agent-selector.ts`. Kept
 * structurally open so server-side additions don't break consumers.
 */
export interface AgentDescriptor {
  id: string;
  [k: string]: unknown;
}

export interface AgentSelectLoadRequest {
  /** Server expects an `agents` array of AgentDescriptor. No jurisdiction field. */
  agents: AgentDescriptor[];
}

export interface AgentSelectLoadResponse {
  success: boolean;
  loaded: number;
}

export interface AgentSelectRequest {
  query: string;
  /** Default 5 server-side. */
  topK?: number;
}

export interface AgentSelectResponse {
  success: boolean;
  selected: Array<Record<string, unknown>>;
  count: number;
}

class OrchKbSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/kb/health'); }
  create(req: KbCreateRequest): Promise<KbCreateResponse> {
    return this.http.post('/api/nv5/orch/kb/create', req);
  }
}

class OrchContextSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/context/health'); }
}

class OrchMultimodalRagSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/multimodal-rag/health'); }
}

class OrchPluginsSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/plugins/health'); }
}

class OrchRomaSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/roma/health'); }
  trackOutcome(req: RomaOutcomeTrackRequest): Promise<{ success: boolean }> {
    return this.http.post('/api/nv5/orch/roma/outcome/track', req);
  }
  auditTrail(): Promise<RomaAuditTrailResponse> {
    return this.http.get('/api/nv5/orch/roma/audit-trail');
  }
  performanceStore(): Promise<RomaPerformanceStoreResponse> {
    return this.http.get('/api/nv5/orch/roma/performance-store');
  }
}

class OrchAgentSelectSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/agent-select/health'); }
  load(req: AgentSelectLoadRequest): Promise<AgentSelectLoadResponse> {
    return this.http.post('/api/nv5/orch/agent-select/load', req);
  }
  select(req: AgentSelectRequest): Promise<AgentSelectResponse> {
    return this.http.post('/api/nv5/orch/agent-select/select', req);
  }
}

class OrchProtocolsSubApi {
  constructor(private http: NyvHttpClient) {}
  health(): Promise<OrchHealth> { return this.http.get('/api/nv5/orch/protocols/health'); }
}

export class OrchApi {
  public readonly kb: OrchKbSubApi;
  public readonly context: OrchContextSubApi;
  public readonly multimodalRag: OrchMultimodalRagSubApi;
  public readonly plugins: OrchPluginsSubApi;
  public readonly roma: OrchRomaSubApi;
  public readonly agentSelect: OrchAgentSelectSubApi;
  public readonly protocols: OrchProtocolsSubApi;

  constructor(http: NyvHttpClient) {
    this.kb = new OrchKbSubApi(http);
    this.context = new OrchContextSubApi(http);
    this.multimodalRag = new OrchMultimodalRagSubApi(http);
    this.plugins = new OrchPluginsSubApi(http);
    this.roma = new OrchRomaSubApi(http);
    this.agentSelect = new OrchAgentSelectSubApi(http);
    this.protocols = new OrchProtocolsSubApi(http);
  }
}
