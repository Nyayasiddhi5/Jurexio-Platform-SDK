/**
 * TwinApi — Legal Digital Twin (TwinDesk™) API for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/digital-twin/* and P22 pattern
 */

import type {
  JrxDigitalTwin,
  JrxTwinSimulationResult,
  JrxJurisdiction,
  JrxListResponse,
  JrxPaginationOptions,
} from '../types/index.js';
import type { JrxHttpClient } from '../JrxClient.js';

export interface CreateTwinRequest {
  name: string;
  persona: 'managing-partner' | 'senior-litigator' | 'compliance-head' | 'corporate-counsel' | 'custom';
  expertise: string;
  jurisdiction: JrxJurisdiction;
  yearsExperience?: number;
  customPersonaPrompt?: string;
  configuration?: {
    preferredCourts?: string[];
    preferredArbitration?: string;
    riskTolerance?: 'conservative' | 'moderate' | 'aggressive';
    specialisations?: string[];
  };
}

export interface SimulateRequest {
  twinId: string;
  scenario: string;
  task: string;
  context?: Record<string, unknown>;
  numOutcomes?: number;
}

export interface TwinChatRequest {
  twinId: string;
  message: string;
  sessionId?: string;
  context?: Record<string, unknown>;
}

export class TwinApi {
  constructor(private readonly http: JrxHttpClient) {}

  /** Create a new legal digital twin */
  create(req: CreateTwinRequest): Promise<JrxDigitalTwin> {
    return this.http.post('/api/jrx/digital-twin/create', req);
  }

  /** Get a twin by ID */
  get(twinId: string): Promise<JrxDigitalTwin> {
    return this.http.get(`/api/jrx/digital-twin/${twinId}`);
  }

  /** List all twins for the current org */
  list(pagination: JrxPaginationOptions = {}): Promise<JrxListResponse<JrxDigitalTwin>> {
    const params = new URLSearchParams();
    if (pagination.page) params.set('page', String(pagination.page));
    if (pagination.pageSize) params.set('pageSize', String(pagination.pageSize));
    return this.http.get(`/api/jrx/digital-twin?${params}`);
  }

  /** Update a twin's state or configuration */
  update(
    twinId: string,
    updates: Partial<CreateTwinRequest> & { state?: Record<string, unknown> }
  ): Promise<JrxDigitalTwin> {
    return this.http.patch(`/api/jrx/digital-twin/${twinId}`, updates);
  }

  /** Delete a twin */
  delete(twinId: string): Promise<{ success: boolean }> {
    return this.http.delete(`/api/jrx/digital-twin/${twinId}`);
  }

  /**
   * Run a scenario simulation with a digital twin (calls P22 pattern).
   * Returns probabilistic outcome analysis across 3+ scenarios.
   */
  simulate(req: SimulateRequest): Promise<JrxTwinSimulationResult> {
    return this.http.post('/api/jrx/digital-twin/simulate', req);
  }

  /**
   * Chat with a digital twin — returns a contextual response
   * from the twin's persona and expertise.
   */
  chat(req: TwinChatRequest): Promise<{
    sessionId: string;
    response: string;
    reasoning?: string;
    recommendations?: string[];
    confidence: number;
  }> {
    return this.http.post('/api/jrx/digital-twin/chat', req);
  }

  /** Get simulation history for a twin */
  getSimulations(
    twinId: string,
    pagination: JrxPaginationOptions = {}
  ): Promise<JrxListResponse<JrxTwinSimulationResult>> {
    const params = new URLSearchParams();
    if (pagination.page) params.set('page', String(pagination.page));
    if (pagination.pageSize) params.set('pageSize', String(pagination.pageSize));
    return this.http.get(`/api/jrx/digital-twin/${twinId}/simulations?${params}`);
  }

  /**
   * Benchmark a twin against a standard legal scenario set.
   * Returns accuracy and calibration scores.
   */
  benchmark(twinId: string): Promise<{
    twinId: string;
    overallScore: number;
    dimensions: Array<{ name: string; score: number; benchmark: number }>;
    completedAt: string;
  }> {
    return this.http.post(`/api/jrx/digital-twin/${twinId}/benchmark`, {});
  }
}
