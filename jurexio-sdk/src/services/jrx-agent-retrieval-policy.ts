/**
 * NV-AGENT-RETRIEVAL-POLICY-001 — Ordered grounding for ecosystem agents.
 *
 * Every Queen / orchestrate / legal-work / pattern path should follow:
 *   1. NYS (global public law SoT) — statutes, caselaw, retrieve, Athena
 *   2. Tenant RAG / knowledge base — org & matter corpora
 *   3. Matter memory — session / L1–L5 recall (JRX-backed, not NYS)
 *   4. LLM (safety ring only) — reason/synthesize; never invent citations
 *
 * This module is the canonical directive text + helper used by Queen Step-0
 * and Auto-RAG context formatting so agents "know when to use what".
 */

export type RetrievalLayer =
  | 'nys_global'
  | 'tenant_rag'
  | 'memory'
  | 'llm';

export const RETRIEVAL_LAYER_ORDER: RetrievalLayer[] = [
  'nys_global',
  'tenant_rag',
  'memory',
  'llm',
];

/** Short system directive injected into grounded prompts (India-first default). */
export function agentRetrievalPolicyDirective(opts?: {
  jurisdiction?: string;
  nysPlaneOn?: boolean;
}): string {
  const j = (opts?.jurisdiction || 'IN').toUpperCase();
  const nys = opts?.nysPlaneOn !== false;
  return [
    '§ RETRIEVAL POLICY (MANDATORY — do not skip layers)',
    `Jurisdiction focus: ${j} (India-first when IN).`,
    nys
      ? '1) NYS Knowledge Plane FIRST — statutes, caselaw, retrieve plan, Athena archive for global Indian public law. Prefer nys_global / grounded context over model memory.'
      : '1) NYS Knowledge Plane unavailable — use tenant RAG then memory; do not invent Indian statutes/cases.',
    '2) Tenant RAG / org knowledge base SECOND — matter documents, shared docs, private corpora.',
    '3) Matter memory THIRD — prior turns, L1–L5 recall (tenant JRX memory; not JRX-backed).',
    '4) LLM LAST — synthesize only from retrieved context; cite only authorities present in context; if ungrounded, say so and ask for sources.',
    'Never claim SCC Online / eCourts live scrape unless those tools returned hits in this turn.',
  ].join('\n');
}

/** One-line telemetry label for layersUsed responses. */
export function describeRetrievalStack(layersUsed: string[]): string {
  const hasNys = layersUsed.some((l) => l.includes('nys') || l === 'nys_global');
  const hasTenant = layersUsed.some((l) =>
    ['knowledge_chunks', 'rag_documents', 'adaptive', 'corrective', 'lightrag', 'graphrag', 'sme_approved', 'tenant_rag'].includes(l),
  );
  const parts = [
    hasNys ? 'NYS' : null,
    hasTenant ? 'tenant_RAG' : null,
    layersUsed.includes('memory') ? 'memory' : null,
    'LLM',
  ].filter(Boolean);
  return parts.join(' → ');
}
