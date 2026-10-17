/**
 * NV-PATTERN-DISPATCH-001 — make the auto-selected agentic pattern (P01–P22)
 * actually shape Queen execution instead of being telemetry-only.
 *
 * Two effects, both real and bounded:
 *   1. patternToOrchestrationPattern() — maps a pattern to a structural
 *      orchestration shape (swarm / hierarchical / dag / sequential) so the
 *      Queen's executor topology follows the selected pattern. Returns null
 *      for patterns with no structural implication (the keyword heuristic
 *      then stands).
 *   2. patternSystemDirective() — a concise BEHAVIOURAL directive injected
 *      into every agent prompt so agents genuinely execute per the pattern
 *      (CoT reasoning, reflection/self-critique, ToT branching, maker-checker
 *      verification, RAG grounding, …). This routes through the existing
 *      buildAgentPrompt → callAgent → safety ring (NV-LLM-001); it adds no new
 *      LLM entrypoint and fabricates nothing.
 *
 * This is the single source of truth for pattern→execution binding; it does
 * NOT duplicate the catalog (jrx-patterns-routes) or the selector
 * (jrx-pattern-auto-selector) — those classify; this dispatches.
 */
import type { TaskDecomposition } from './jrx-queen-orchestrator.js';
import { TOP_10_TOPOLOGY_IDS } from '../services/jrx-topology-algorithms.js';

type OrchestrationPattern = TaskDecomposition['orchestrationPattern'];

/**
 * Structural shape implied by a pattern. Only patterns with a clear topology
 * implication return a value; the rest return null so the existing algorithm
 * heuristic remains authoritative.
 */
const PATTERN_ORCHESTRATION: Record<string, OrchestrationPattern> = {
  P01: 'sequential',   // ReAct — iterative single-threaded reasoning
  P02: 'sequential',   // Chain-of-Thought — linear reasoning before answer
  P03: 'parallel',     // Tree-of-Thought — explore branches concurrently
  P05: 'dag',          // Plan-and-Execute — staged dependency graph
  P07: 'sequential',   // Maker-Checker — maker then independent checker
  P11: 'hierarchical', // NyayaRAG — structured legal retrieval hierarchy
  P15: 'hierarchical', // HTA — hierarchical decomposition
  P16: 'swarm',        // Swarm — multi-agent consensus
  P18: 'swarm',        // MOAt — multi-layer orchestration
  P22: 'swarm',        // Digital Twin — multi-persona simulation
};

export const PATTERN_CAPABILITY_HINTS: Record<string, string> = {
  P08: 'tools.execute',
  P09: 'tools.execute',
  P10: 'tools.execute',
  P11: 'rag.search',
  P12: 'rag.graph',
  P20: 'e-filing.submit',
  P21: 'simulation.grpo',
  P22: 'digital-twin.simulate',
};

const PATTERN_PREFERRED_TOPOLOGY_IDS: Record<string, string> = {
  P03: 'fanout-001',
  P05: 'comp-001',
  P15: 'hier-001',
  P16: 'hyb-001',
  P18: 'cons-001',
  P22: 'hier-001',
};

const PATTERN_DIRECTIVE: Record<string, string> = {
  P01: 'Use a ReAct loop: alternate Thought → Action (retrieve/cite) → Observation until you can answer; keep the trace concise.',
  P02: 'Reason step-by-step, exposing each inference, before stating the final answer (Chain-of-Thought).',
  P03: 'Explore 2–3 distinct solution branches, evaluate each, then select and justify the best (Tree-of-Thought).',
  P04: 'Produce a draft, then self-critique it for errors/omissions, and deliver the corrected version (Reflection).',
  P05: 'First produce an explicit numbered plan, then execute each step and report results per step (Plan-and-Execute).',
  P06: 'Iteratively refine the output at least once for precision and completeness before finalizing.',
  P07: 'Act as the maker to produce the output, then as an INDEPENDENT checker verify every claim and citation; flag anything unverifiable.',
  P08: 'When retrieval/tooling is needed, attempt it and retry on transient failure before degrading gracefully.',
  P09: 'Select the most specialized capability for the task and route accordingly.',
  P10: 'Chain the required tools in sequence, passing each output forward to the next step.',
  P11: 'Ground EVERY legal proposition in retrieved statutes/precedents; cite only retrieved authorities (NyayaRAG).',
  P12: 'Trace multi-hop relationships across authorities; connect related provisions and precedents explicitly (GraphRAG).',
  P13: 'Incorporate relevant recalled context/history; never contradict prior established facts (Mem0).',
  P14: 'Answer concisely with the most direct authoritative response.',
  P15: 'Decompose hierarchically into sub-goals and address each in order (HTA).',
  P16: 'Consider multiple expert perspectives, then reconcile them into a single consensus answer (Swarm).',
  P17: 'Frame the answer around continuous compliance/monitoring obligations and their triggers (ACONIC).',
  P18: 'Apply layered governance/audit checks at each step and keep a clear audit trail (MOAt).',
  P19: 'Plan adaptively; decompose further only where the complexity genuinely demands it (ADaPT).',
  P20: 'Describe the precise procedural / e-filing steps required, in order (Computer-Use).',
  P21: 'Evaluate candidate outputs against explicit quality criteria and return the highest-scoring one (GRPO).',
  P22: 'Model the scenario/persona and simulate likely outcomes, stating assumptions explicitly (Digital Twin).',
};

export function patternToOrchestrationPattern(patternId?: string | null): OrchestrationPattern | null {
  if (!patternId) return null;
  return PATTERN_ORCHESTRATION[patternId] ?? null;
}

export function patternSystemDirective(patternId?: string | null): string | null {
  if (!patternId) return null;
  return PATTERN_DIRECTIVE[patternId] ?? null;
}

export function patternCapabilityHint(patternId?: string | null): string | null {
  if (!patternId) return null;
  return PATTERN_CAPABILITY_HINTS[patternId] ?? null;
}

export function patternPreferredTopologyId(patternId?: string | null): string | null {
  if (!patternId) return null;
  const topologyId = PATTERN_PREFERRED_TOPOLOGY_IDS[patternId];
  return topologyId && TOP_10_TOPOLOGY_IDS.includes(topologyId as (typeof TOP_10_TOPOLOGY_IDS)[number])
    ? topologyId
    : null;
}

/**
 * Wave B Queen OS: determines if a pattern should force the maker-checker loop.
 * Currently only P07 (Maker-Checker pattern) requires forced maker-checker.
 */
export function patternShouldForceMakerChecker(patternId?: string | null): boolean {
  return patternId === 'P07';
}

/**
 * Wave B Queen OS: determines if a pattern should apply Chain-of-Thought reasoning.
 * P02 (Chain-of-Thought pattern) always applies CoT.
 */
export function patternShouldApplyCot(patternId?: string | null): boolean {
  return patternId === 'P02';
}
