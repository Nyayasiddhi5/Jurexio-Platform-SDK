/**
 * NV-AGENT-TOOL-BRIDGE-001 — Map registry agent tools / mcpToolsAllowed →
 * capability-manifest leaves and optionally invoke them before LLM synthesis.
 *
 * Does NOT invent new tools. Reuses existing capabilityManifest factories.
 * Cost-capped: at most MAX_PRE_INVOKES per agent turn.
 */

import { capabilityManifest } from './capability-manifest.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('agent-tool-bridge');

const MAX_PRE_INVOKES = 2;

/** Map common MCP / registry tool tokens → live capability ids. */
const TOOL_TOKEN_TO_CAPABILITY: Record<string, string> = {
  web_search: 'enterprise.web-search',
  websearch: 'enterprise.web-search',
  'enterprise.web-search': 'enterprise.web-search',
  compare: 'sdk.document-pipeline',
  document_compare: 'sdk.document-pipeline',
  'nyaya-tools.compare': 'nyaya-tools.compare',
  ocr: 'docs.ocr',
  'docs.ocr': 'docs.ocr',
  parse: 'docs.parse',
  summarize: 'intelligence.summarize',
  'intelligence.summarize': 'intelligence.summarize',
  doc_analyze: 'intelligence.doc-analyze',
  'intelligence.doc-analyze': 'intelligence.doc-analyze',
  ner: 'intelligence.ner',
  rag: 'rag.search',
  'rag.search': 'rag.search',
  embed: 'docs.embed',
  mcp: 'protocol.mcp.invoke',
  'protocol.mcp.invoke': 'protocol.mcp.invoke',
  bmad: 'agent.bmad.orchestrate',
  'agent.bmad.orchestrate': 'agent.bmad.orchestrate',
  a2a: 'protocol.a2a.handoff',
  'protocol.a2a.handoff': 'protocol.a2a.handoff',
  handoff: 'protocol.a2a.handoff',
  twin: 'digital_twin.simulate',
  'digital_twin.simulate': 'digital_twin.simulate',
  twindesk: 'twindesk.simulate',
  automateai: 'automateai.workflow',
  'automateai.workflow': 'automateai.workflow',
  openbot: 'openbot.receive',
  clawdbot: 'clawdbot.crawl',
  'clawdbot.crawl': 'clawdbot.crawl',
  forensic: 'nyaya-tools.forensic',
  'nyaya-tools.forensic': 'nyaya-tools.forensic',
  timeline: 'nyaya-tools.timeline',
  amend: 'nyaya-tools.amend',
  watch: 'nyaya-tools.watch',
  trail: 'nyaya-tools.trail',
  template: 'templates.generate',
  notebook: 'enterprise.notebook-studio',
  financial: 'enterprise.financial-data',
  multimedia: 'enterprise.multimedia',
  domain_research: 'enterprise.domain-research',
  grpo: 'simulation.grpo',
  'simulation.grpo': 'simulation.grpo',
  // Registry agent tool tokens (IN registry — already built; map → live leaves)
  'legal-research': 'rag.search',
  'statute-verification': 'intelligence.statute-verify',
  'citation-formatter': 'safety.citation-verify',
  'compliance-monitor': 'intelligence.regulatory-watch',
  'risk-analysis': 'intelligence.doc-analyze',
  'document-generation': 'templates.generate',
  'matter-manager': 'workflow.matter-vault',
  nys_search_caselaw: 'intelligence.precedent',
  nys_search_statutes: 'rag.search',
  nys_get_statute: 'rag.search',
  nys_compare_ipc_bns: 'nyaya-tools.compare',
  nys_retrieve: 'rag.search',
  nys_check_citations: 'safety.citation-verify',
  nys_athena_search: 'rag.search',
  nys_judgment_full_text: 'intelligence.precedent',
};

export function resolveCapabilityIdsFromAgentTools(opts: {
  tools?: string[];
  mcpToolsAllowed?: string[];
  preferredTools?: string[];
  boundCapabilities?: string[];
}): string[] {
  const raw = [
    ...(opts.tools || []),
    ...(opts.mcpToolsAllowed || []),
    ...(opts.preferredTools || []),
    ...(opts.boundCapabilities || []),
  ];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of raw) {
    const key = String(token || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) continue;
    const mapped = TOOL_TOKEN_TO_CAPABILITY[key]
      || (capabilityManifest.get(token) ? token : null)
      || (capabilityManifest.get(key) ? key : null);
    if (mapped && capabilityManifest.get(mapped) && !seen.has(mapped)) {
      seen.add(mapped);
      out.push(mapped);
    }
  }
  return out;
}

export function formatAgentToolDirective(capabilityIds: string[]): string {
  if (!capabilityIds.length) return '';
  return `

PLATFORM TOOLS AVAILABLE TO YOU (use when relevant; cite tool results):
${capabilityIds.map((id) => `- ${id}`).join('\n')}
Prefer calling the bound capability path when the subtask is tool-shaped; do not invent tool APIs.`;
}

export async function preInvokeAgentCapabilities(opts: {
  capabilityIds: string[];
  prompt: string;
  subtaskType?: string;
  ctx: {
    tier?: string;
    jurisdiction?: string;
    userId?: string;
    tenantId?: string;
    requestId?: string;
    agentKey?: string;
  };
}): Promise<{ used: string[]; snippets: string[] }> {
  const used: string[] = [];
  const snippets: string[] = [];
  const ids = opts.capabilityIds.slice(0, MAX_PRE_INVOKES);
  for (const id of ids) {
    try {
      const input: Record<string, unknown> = {
        prompt: opts.prompt,
        query: opts.prompt,
        text: opts.prompt,
        content: opts.prompt,
        subtaskType: opts.subtaskType,
        op: id === 'sdk.document-pipeline'
          ? (/\bcompar/i.test(opts.prompt) ? 'compare' : /\bclassif/i.test(opts.prompt) ? 'classify' : 'pipeline')
          : undefined,
      };
      const out = await capabilityManifest.invoke(id, input, opts.ctx as any);
      const text = typeof out === 'string' ? out : JSON.stringify(out);
      if (text && text !== '{}' && text !== 'null') {
        used.push(id);
        snippets.push(`[tool:${id}]\n${text.slice(0, 2500)}`);
        logger.info('[agent-tool-bridge] pre-invoked', { id, len: text.length });
      }
    } catch (err: any) {
      logger.warn('[agent-tool-bridge] pre-invoke failed', { id, err: err?.message });
    }
  }
  return { used, snippets };
}

/** High-value leaves that MUST have at least one INTENT_CAPABILITY_MAP entry (guardrail). */
export const REQUIRED_INTENT_MESH_LEAF_IDS = [
  'docs.ocr',
  'docs.parse',
  'docs.embed',
  'intelligence.summarize',
  'intelligence.doc-analyze',
  'sdk.document-pipeline',
  'nyaya-tools.compare',
  'nyaya-tools.amend',
  'nyaya-tools.forensic',
  'nyaya-tools.timeline',
  'nyaya-tools.trail',
  'nyaya-tools.watch',
  'nyaya-tools.graph',
  'nyaya-tools.template',
  'automateai.workflow',
  'openbot.receive',
  'clawdbot.crawl',
  'agent.bmad.orchestrate',
  'protocol.a2a.handoff',
  'digital_twin.simulate',
  'enterprise.web-search',
  'enterprise.notebook-studio',
  'enterprise.financial-data',
  'enterprise.multimedia',
  'enterprise.domain-research',
  'simulation.grpo',
  'protocol.mcp.invoke',
  'templates.generate',
  'clm.lifecycle',
  'efiling.steps',
  // A1 Wave 2026-07-30 — top inventory leaves
  'rag.graph',
  'rag.reranker',
  'rag.corrective',
  'rag.adaptive',
  'rag.self',
  'rag.lightrag',
  'memory.mem0.recall',
  'memory.social.context',
  'docs.intelligence',
  'intelligence.compliance-calendar',
  'workflow.bulk-analysis',
  'workflow.calendar-extract',
  'sdk.workflow-protocol',
  'sdk.usage-metering',
  'nyaya-tools.agent-lifecycle',
  'openbot.send',
] as const;
