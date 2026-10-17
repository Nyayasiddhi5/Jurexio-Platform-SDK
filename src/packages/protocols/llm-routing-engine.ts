/**
 * Stub for the legacy `llm-routing-engine` module.
 *
 * Background: Task #104's V9 dead-stubs cleanup archived the original
 * `src/packages/protocols/llm-routing-engine.ts` (1-30 LOC placeholder
 * returning empty data — see `replit.md` § NV-WIRING-BUDGET-001).
 * `src/orchestration/jrx-internal-wire-chain.ts` still imports
 * `llmRoutingEngine` purely to keep the BFS-auditor edge alive
 * (`void llmRoutingEngine` at line 100). After the rebase that brought
 * Task #104 onto the Task #114 branch, the dangling import broke
 * gateway boot.
 *
 * This stub restores the missing export with the minimum surface the
 * wire-chain reference needs. It is NOT used for any real routing
 * decision — the canonical path is `intelligent-router/orchestrateLLM`
 * (NV-LLM-001 whitelist).
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'sarvam';

export class LLMRoutingEngine {
  static readonly __isStub = true;
}

export const llmRoutingEngine = new LLMRoutingEngine();
export default llmRoutingEngine;
