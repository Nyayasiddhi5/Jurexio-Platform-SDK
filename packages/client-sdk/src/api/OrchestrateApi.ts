/**
 * Queen orchestration — POST /api/jrx/orchestrate (NSP primary AI path).
 * Uses extended timeout (default 600s) — separate from the 30s default client.
 *
 * Streaming: POST /api/jrx/orchestrate/stream (AG-UI SSE from live Queen lifecycle).
 */

import type { NyvJurisdiction, NyvStreamHandlers, NyvPatternResponse } from '../types/index.js';
import { NyvStreamReader, type NyvStreamOptions } from '../NyvStreamReader.js';

export interface OrchestrateRequest {
  prompt: string;
  agentKey?: string;
  systemPrompt?: string;
  tier?: string;
  jurisdiction?: NyvJurisdiction;
  taskType?: string;
  language?: string;
  sessionId?: string;
  matterId?: string;
  maxTokens?: number;
  enableHITL?: boolean;
  enableHallucinationCheck?: boolean;
  enableExplainability?: boolean;
  enableCitationVerification?: boolean;
  enableRAG?: boolean;
  enableMemory?: boolean;
  enableCoT?: boolean;
  cotStrategy?: string;
  ragDocumentIds?: string[];
  orchestrationMode?: string;
  agents?: string[];
  priority?: string;
  preferences?: Record<string, unknown>;
  previousMessages?: { role: string; content: string }[];
  [key: string]: unknown;
}

export interface OrchestrateResult {
  answer?: string;
  content?: string;
  model?: string;
  requestId?: string;
  autoOrchestrated?: boolean;
  risk_badge?: string;
  audit_hash?: string;
  safety?: Record<string, unknown>;
  safetyVerdict?: Record<string, unknown>;
  grounding?: Record<string, unknown>;
  citations?: unknown[];
  hallucinationCheck?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface OrchestrateHttp {
  post<T>(path: string, body: unknown): Promise<T>;
}

export class OrchestrateApi {
  private readonly streamReader: NyvStreamReader;

  constructor(
    private readonly http: OrchestrateHttp,
    apiKey: string,
    baseUrl: string,
  ) {
    this.streamReader = new NyvStreamReader(apiKey, baseUrl);
  }

  /** Queen-backed orchestration — primary NSP drafting / analysis path. */
  run(req: OrchestrateRequest): Promise<OrchestrateResult> {
    return this.http.post<OrchestrateResult>('/api/jrx/orchestrate', req);
  }

  /**
   * Stream Queen orchestration via AG-UI SSE (`POST /api/jrx/orchestrate/stream`).
   * Emits live lifecycle: agent_selected / thinking / text_delta / run_completed.
   */
  stream(
    req: OrchestrateRequest,
    handlers: NyvStreamHandlers = {},
    options: NyvStreamOptions = {},
  ): Promise<NyvPatternResponse> {
    return this.streamReader.streamOrchestrate(req as Record<string, unknown>, handlers, options);
  }
}
