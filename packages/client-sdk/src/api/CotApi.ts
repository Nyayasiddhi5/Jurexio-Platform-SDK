/**
 * CotApi — Chain-of-Thought reasoning for SDK legal/agentic tasks.
 * Wraps POST /api/jrx/v1/sdk/sampling/chain-of-thought and strategy catalog.
 */
import type { NyvHttpClient } from '../NyvClient.js';

export type CotStrategy =
  | 'zero_shot_cot' | 'few_shot_cot' | 'self_consistency' | 'tree_of_thought'
  | 'step_back' | 'decomposition' | 'least_to_most' | 'chain_of_verification';

export interface CotExecuteRequest {
  prompt: string;
  strategy?: CotStrategy;
  context?: { domain?: string; maxSteps?: number };
}

export interface CotExecuteResponse {
  strategy: CotStrategy;
  strategiesAvailable: CotStrategy[];
  steps: Array<{ thought?: string; action?: string; observation?: string }>;
  stepCount: number;
  confidence: number;
  conclusion?: string;
  latencyMs: number;
}

export class CotApi {
  constructor(private readonly http: NyvHttpClient) {}

  /** List available CoT strategies. */
  listStrategies(): Promise<{ count: number; strategies: Array<{ id: string; label: string; legalUse: string }> }> {
    return this.http.get('/api/jrx/v1/sdk/sampling/cot/strategies').then((r: any) => r.data ?? r);
  }

  /** Execute chain-of-thought reasoning. */
  execute(req: CotExecuteRequest): Promise<CotExecuteResponse> {
    return this.http.post('/api/jrx/v1/sdk/sampling/chain-of-thought', req).then((r: any) => r.data ?? r);
  }
}
