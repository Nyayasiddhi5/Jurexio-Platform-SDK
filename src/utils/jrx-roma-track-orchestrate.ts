/**
 * Fail-soft ROMA L5 outcome hook for specialist / doc-pipeline / Queen-envelope
 * paths. Queen executeAgent already tracks per-agent; this records the
 * AdaptiveRouter leaf so partner orchestrate (specialist) still populates
 * the performance store.
 */
import { romaL5Engine } from '../packages/protocols/roma/roma-l5-engine.js';
import type { AgentOutcome } from '../packages/protocols/roma/types.js';

export function trackRomaOrchestrateOutcome(
  agentId: string | undefined,
  outcome: AgentOutcome,
): void {
  const id = String(agentId || 'specialist-orchestrate').slice(0, 160);
  try {
    romaL5Engine.trackOutcome(id, outcome);
  } catch {
    /* learning must never fail the request */
  }
}
