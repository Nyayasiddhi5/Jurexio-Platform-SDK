/**
 * NV-MCP-LEGAL-DELEGATE-001 — Delegated MCP handlers for legaltech tools.
 * Routes catalog research/drafting/intelligence tools to real platform services
 * (auto-RAG, statute DB, safety-ring LLM, connectors) before the switch default.
 */
import { createLogger } from '../../utils/logger.js';
import { nvMcpConnectorService } from './jrx-mcp-connector-service.js';
import { fetchJudgmentFullText } from '../jrx-nys-judgment-fulltext.js';

const logger = createLogger('./jrx-mcp-legal-delegate');

export type McpDelegateHandler = (input: Record<string, unknown>, ctx?: { orgId?: string; userId?: string }) => Promise<Record<string, unknown>>;

/** Tool IDs with live delegated handlers (mirror in EXECUTABLE_MCP_TOOL_IDS). */
export const DELEGATED_MCP_TOOL_IDS: readonly string[] = [
  // Research / intelligence (existing catalog IDs)
  'legal_news_search', 'academic_legal_search', 'legislative_history', 'regulatory_gazette_search',
  'bill_tracker', 'legal_dictionary', 'landmark_cases', 'overruled_case_check',
  'case_brief_generator', 'legal_ratio_extractor', 'judicial_trend_analysis',
  'comparative_case_law', 'precedent_chain', 'uk_legislation_search', 'eu_eur_lex_search',
  'us_federal_register', 'sg_legislation_search', 'supreme_court_india_search',
  'high_court_search', 'nclat_order_search', 'itat_order_search',
  // Drafting / HR / marketing
  'contract_draft_assist', 'petition_draft_assist', 'legal_memo_draft', 'client_alert_draft',
  'hr_policy_review', 'employment_contract_review', 'marketing_compliance_check',
  'privacy_notice_draft', 'terms_of_service_draft',
  // Integration MCP tools (connector catalog)
  'google_drive_list', 'google_drive_download', 'microsoft_onedrive_list', 'microsoft_onedrive_download',
  'sharepoint_list', 'sharepoint_download', 'aws_s3_list', 'aws_s3_download',
  'box_storage_list', 'dropbox_list_files', 'slack_post_message', 'microsoft_teams_post_message',
  'notion_fetch_page', 'gmail_create_draft', 'outlook_create_draft',
  'google_calendar_create_event', 'outlook_calendar_create_event',
  'docusign_envelope_status', 'adobe_sign_status', 'salesforce_matter_sync', 'hubspot_contact_lookup',
  'razorpay_payment_status', 'stripe_invoice_fetch', 'zoom_meeting_create',
  'asana_task_create', 'jira_issue_create', 'trello_card_create',
  // NV-JRX-KNOWLEDGE-001 — federated NYS Knowledgesearch tools
  'nys_search_caselaw', 'nys_search_statutes', 'nys_get_statute', 'nys_compare_ipc_bns',
  'nys_retrieve', 'nys_check_citations', 'nys_perform_legal_work', 'nys_chat_action',
  'nys_athena_search', 'nys_judgment_full_text',
] as const;

const DELEGATE_SET = new Set<string>(DELEGATED_MCP_TOOL_IDS);

export function isDelegatedMcpTool(toolId: string): boolean {
  return DELEGATE_SET.has(toolId);
}

async function ragSearch(query: string, jurisdiction?: string, limit = 8) {
  const { autoRagRetrieve } = await import('../jrx-auto-rag-router.js');
  return autoRagRetrieve({
    query,
    jurisdiction: jurisdiction || 'IN',
    tier: 'pro',
    topK: limit,
    taskType: 'research',
  });
}

async function statuteSearch(query: string, jurisdiction?: string, limit = 10) {
  const { searchStatutes } = await import('../jrx-statute-seeding-service.js').catch(() => ({
    searchStatutes: async () => [] as unknown[],
  }));
  return searchStatutes(query, jurisdiction, undefined, limit);
}

async function llmLegalTask(task: string, jurisdiction = 'IN', taskType = 'analysis') {
  const { executeWithFullSafetyRingSimple } = await import('../../orchestration/jrx-sdk-orchestration-wrapper.js');
  const content = await executeWithFullSafetyRingSimple(
    `You are a senior legal analyst. Jurisdiction: ${jurisdiction}. Provide structured, citation-aware output.`,
    task,
    { jurisdiction, taskType, tier: 'pro', enableRAG: true, sdkPlatform: 'mcp-delegate' },
    2048,
  );
  return { content, source: 'safety-ring-llm', jurisdiction };
}

async function webIntel(query: string, jurisdiction?: string) {
  if (process.env.PERPLEXITY_API_KEY) {
    try {
      const { orchestrateLLM } = await import('../intelligent-router/llm-orchestrator.js');
      const resp = await orchestrateLLM({
        id: `mcp-web-${Date.now()}`,
        userId: 'mcp-delegate',
        prompt: `Legal web research (${jurisdiction || 'global'}): ${query}`,
        maxTokens: 1024,
        model: 'sonar-pro',
        provider: 'perplexity',
      } as any);
      if (resp?.content) {
        return { status: 'ok', provider: 'perplexity', answer: resp.content, query };
      }
    } catch (err: any) {
      logger.warn('[MCP-Delegate] Perplexity failed', { err: err?.message });
    }
  }
  return {
    status: 'degraded',
    query,
    sources: [
      `https://indiankanoon.org/search/?formInput=${encodeURIComponent(query)}`,
      `https://www.sebi.gov.in/searchresult.html?query=${encodeURIComponent(query)}`,
    ],
    note: 'Set PERPLEXITY_API_KEY for live web intelligence.',
  };
}

const HANDLERS: Record<string, McpDelegateHandler> = {
  legal_news_search: async (inp) => webIntel(String(inp.query ?? ''), String(inp.jurisdiction ?? 'IN')),
  academic_legal_search: async (inp) => {
    const rag = await ragSearch(String(inp.query ?? ''), String(inp.jurisdiction ?? 'IN'), 10);
    return { query: inp.query, results: rag.chunks?.slice(0, 10) ?? [], intent: rag.intent, source: 'auto-rag' };
  },
  legislative_history: async (inp) => {
    const statutes = await statuteSearch(`${inp.actTitle ?? ''} ${inp.section ?? ''}`, String(inp.jurisdiction ?? 'IN'));
    return { actTitle: inp.actTitle, section: inp.section, results: statutes, source: 'statute_db' };
  },
  regulatory_gazette_search: async (inp) => webIntel(`official gazette ${inp.query ?? ''} ${inp.ministryDept ?? ''}`, String(inp.jurisdiction ?? 'IN')),
  bill_tracker: async (inp) => webIntel(`pending bill status ${inp.billName ?? inp.query ?? ''} ${inp.jurisdiction ?? 'IN'}`),
  legal_dictionary: async (inp) => {
    const rag = await ragSearch(`legal definition ${inp.term ?? inp.query}`, String(inp.jurisdiction ?? 'IN'), 5);
    return { term: inp.term, language: inp.language ?? 'en', definitions: rag.chunks?.slice(0, 5) ?? [], source: 'auto-rag' };
  },
  landmark_cases: async (inp) => {
    const rag = await ragSearch(`landmark case ${inp.query ?? ''} ${inp.practiceArea ?? ''}`, String(inp.jurisdiction ?? 'IN'), Number(inp.limit ?? 8));
    return { query: inp.query, cases: rag.chunks ?? [], confidence: rag.confidence, source: 'auto-rag' };
  },
  overruled_case_check: async (inp) => {
    const rag = await ragSearch(`overruled distinguished ${inp.caseName ?? inp.citation ?? ''}`, String(inp.jurisdiction ?? 'IN'), 6);
    return { caseName: inp.caseName, citation: inp.citation, precedents: rag.chunks ?? [], note: 'Verify citator against official law reports.', source: 'auto-rag' };
  },
  case_brief_generator: async (inp) => llmLegalTask(
    `Generate a FIRAC case brief for: ${inp.caseId ?? ''}\n${inp.judgmentText ? String(inp.judgmentText).slice(0, 6000) : inp.query ?? ''}`,
    String(inp.jurisdiction ?? 'IN'),
    'case-brief',
  ),
  legal_ratio_extractor: async (inp) => llmLegalTask(
    `Extract ratio decidendi and obiter dicta:\n${String(inp.judgmentText ?? inp.query ?? '').slice(0, 8000)}`,
    String(inp.jurisdiction ?? 'IN'),
    'analysis',
  ),
  judicial_trend_analysis: async (inp) => {
    const rag = await ragSearch(`${inp.query ?? ''} judicial trend ${inp.court ?? ''}`, String(inp.jurisdiction ?? 'IN'), 12);
    return { query: inp.query, trends: rag.chunks ?? [], intent: rag.intent, source: 'auto-rag' };
  },
  comparative_case_law: async (inp) => {
    const primary = String(inp.primaryJurisdiction ?? 'IN');
    const compare = Array.isArray(inp.compareWith) ? inp.compareWith : ['UK', 'US'];
    const results = await Promise.all(
      [primary, ...compare.slice(0, 3)].map(j => ragSearch(String(inp.query ?? ''), j, 5)),
    );
    return { query: inp.query, byJurisdiction: results.map((r, i) => ({ jurisdiction: [primary, ...compare][i], chunks: r.chunks ?? [] })) };
  },
  precedent_chain: async (inp) => {
    const rag = await ragSearch(`citing cited-by ${inp.caseName ?? inp.caseId ?? ''}`, String(inp.jurisdiction ?? 'IN'), 15);
    return { caseId: inp.caseId, depth: inp.depth ?? 3, chain: rag.chunks ?? [], source: 'auto-rag' };
  },
  uk_legislation_search: async (inp) => {
    const statutes = await statuteSearch(String(inp.query ?? ''), 'UK', Number(inp.limit ?? 10));
    return { query: inp.query, results: statutes, legislationGovUk: `https://www.legislation.gov.uk/search?q=${encodeURIComponent(String(inp.query ?? ''))}` };
  },
  eu_eur_lex_search: async (inp) => webIntel(`EUR-Lex ${inp.query ?? ''} ${inp.type ?? 'regulation'}`, 'EU'),
  us_federal_register: async (inp) => webIntel(`Federal Register ${inp.query ?? ''} ${inp.agency ?? ''}`, 'US'),
  sg_legislation_search: async (inp) => {
    const statutes = await statuteSearch(String(inp.query ?? ''), 'SG', 10);
    return { query: inp.query, results: statutes };
  },
  supreme_court_india_search: async (inp) => {
    const rag = await ragSearch(String(inp.query ?? ''), 'IN', 10);
    return { query: inp.query, results: rag.chunks ?? [], confidence: rag.confidence, source: 'auto-rag' };
  },
  high_court_search: async (inp) => {
    const rag = await ragSearch(`${inp.highCourt ?? ''} ${inp.query ?? ''}`, 'IN', 10);
    return { query: inp.query, highCourt: inp.highCourt, results: rag.chunks ?? [], source: 'auto-rag' };
  },
  nclat_order_search: async (inp) => {
    const rag = await ragSearch(`NCLAT ${inp.query ?? ''} ${inp.party ?? ''}`, 'IN', 10);
    return { query: inp.query, results: rag.chunks ?? [], source: 'auto-rag' };
  },
  itat_order_search: async (inp) => {
    const rag = await ragSearch(`ITAT ${inp.query ?? ''} ${inp.bench ?? ''}`, 'IN', 10);
    return { query: inp.query, results: rag.chunks ?? [], source: 'auto-rag' };
  },

  // ── NYS Knowledge Plane (NV-JRX-KNOWLEDGE-001) ───────────────────────────
  nys_search_caselaw: async (inp) => {
    const { nysKnowledgeRequest } = await import('../jrx-nys-knowledge-client.js');
    const r = await nysKnowledgeRequest({
      method: 'GET',
      path: '/caselaw/search',
      query: {
        q: String(inp.query ?? ''),
        jurisdiction: String(inp.jurisdiction ?? 'IN'),
        limit: Number(inp.limit ?? 10),
      },
    });
    return r.ok ? { ...((r.data as object) || {}), source: 'nys' } : { status: 'degraded', error: r.error, source: 'nys' };
  },
  nys_search_statutes: async (inp) => {
    const { nysKnowledgeRequest } = await import('../jrx-nys-knowledge-client.js');
    const r = await nysKnowledgeRequest({
      method: 'GET',
      path: '/statutes/search',
      query: {
        q: String(inp.query ?? ''),
        code: inp.code ? String(inp.code) : undefined,
        jurisdiction: inp.jurisdiction ? String(inp.jurisdiction) : undefined,
        limit: Number(inp.limit ?? 10),
      },
    });
    return r.ok ? { ...((r.data as object) || {}), source: 'nys' } : { status: 'degraded', error: r.error, source: 'nys' };
  },
  nys_get_statute: async (inp) => {
    const { nysKnowledgeRequest } = await import('../jrx-nys-knowledge-client.js');
    const code = String(inp.code ?? '');
    const section = String(inp.section ?? '');
    // Live OpenAPI has no /statutes/retrieve — use hybrid search with code+section filters
    const q = [code, section].filter(Boolean).join(' ').trim() || String(inp.query ?? '');
    const r = await nysKnowledgeRequest({
      method: 'GET',
      path: '/statutes/search',
      query: {
        q,
        code: code || undefined,
        section: section || undefined,
        jurisdiction: inp.jurisdiction ? String(inp.jurisdiction) : 'IN',
        limit: Number(inp.limit ?? 5),
      },
    });
    return r.ok ? { ...((r.data as object) || {}), source: 'nys' } : { status: 'degraded', error: r.error, source: 'nys' };
  },
  nys_compare_ipc_bns: async (inp) => {
    const { nysCompareOldNew } = await import('../jrx-nys-knowledge-retriever.js');
    const data = await nysCompareOldNew({ fromCode: 'IPC', section: String(inp.ipcSection ?? inp.section ?? '') });
    return data ? { comparison: data, source: 'nys' } : { status: 'degraded', source: 'nys' };
  },
  nys_retrieve: async (inp) => {
    const { retrieveNysGlobalKnowledge } = await import('../jrx-nys-knowledge-retriever.js');
    const r = await retrieveNysGlobalKnowledge({
      query: String(inp.query ?? ''),
      jurisdiction: String(inp.jurisdiction ?? 'IN'),
      topK: Number(inp.limit ?? 8),
    });
    return { ...r, source: 'nys' };
  },
  nys_check_citations: async (inp) => {
    const { nysExtractCitations, nysVerifyCitation } = await import('../jrx-nys-knowledge-retriever.js');
    const text = String(inp.text ?? inp.citation ?? '');
    const extracted = await nysExtractCitations(text, true);
    const verified = inp.citation
      ? await nysVerifyCitation(String(inp.citation), String(inp.jurisdiction ?? 'IN'))
      : null;
    return { extracted, verified, source: 'nys' };
  },
  nys_perform_legal_work: async (inp) => {
    const { createLegalWorkRun, getLegalWorkRun } = await import('../jrx-legal-work-service.js');
    const run = await createLegalWorkRun({
      instruction: String(inp.instruction ?? inp.query ?? ''),
      context: inp.context ? String(inp.context) : undefined,
      jurisdiction: String(inp.jurisdiction ?? 'IN'),
    });
    // Brief poll for quick answers (agents can also poll legal-work API)
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const cur = getLegalWorkRun(run.runId);
      if (cur && (cur.status === 'completed' || cur.status === 'failed')) {
        return { run: cur, source: 'nys+jrx-legal-work' };
      }
    }
    return { run, status: 'queued', note: 'Poll GET /api/jrx/legal-work/runs/:id', source: 'nys+jrx-legal-work' };
  },
  nys_chat_action: async (inp) => {
    const { nysKnowledgeRequest } = await import('../jrx-nys-knowledge-client.js');
    // Ensure conversation then message — simplified single-shot via retrieve + safety ring draft
    const { retrieveNysGlobalKnowledge } = await import('../jrx-nys-knowledge-retriever.js');
    const grounded = await retrieveNysGlobalKnowledge({
      query: String(inp.prompt ?? inp.query ?? ''),
      jurisdiction: String(inp.jurisdiction ?? 'IN'),
    });
    if (String(inp.action ?? 'chat') === 'extract' || String(inp.action ?? '') === 'case_details') {
      return { action: inp.action, grounded, source: 'nys-retrieve' };
    }
    const content = await llmLegalTask(
      `${inp.action ?? 'chat'}: ${inp.prompt ?? ''}\n\nDocument:\n${String(inp.documentText ?? '').slice(0, 8000)}\n\nGrounding:\n${grounded.chunks.map((c) => c.content).join('\n').slice(0, 6000)}`,
      String(inp.jurisdiction ?? 'IN'),
      'legal-chat',
    );
    return { ...content, grounded: grounded.chunks, source: 'nys+safety-ring' };
  },
  nys_athena_search: async (inp) => {
    const { nysKnowledgeRequest } = await import('../jrx-nys-knowledge-client.js');
    const { normalizeNysAthenaSearchBody } = await import('../jrx-nys-athena-normalize.js');
    const r = await nysKnowledgeRequest({
      method: 'POST',
      path: '/athena/search',
      body: normalizeNysAthenaSearchBody({
        query: inp.query ?? inp.q,
        archive: inp.archive,
        limit: inp.limit ?? 20,
        year: inp.year,
        court: inp.court,
      }),
    });
    return r.ok ? { ...((r.data as object) || {}), source: 'nys-athena' } : { status: 'degraded', error: r.error, source: 'nys-athena' };
  },

  /**
   * NV-JRX-FULLTEXT-001 — the tool an agent needs when the ask is "read me
   * the actual judgment". `nys_athena_search` only returns metadata + an
   * `s3_path`, which left agents able to LOCATE a judgment but not READ it.
   *
   * Truncated to 120k chars by default: a full SC body can reach 500k chars and
   * would blow the model's context window if handed back whole. Callers that
   * need the untruncated body use POST /api/jrx/knowledge/judgments/full-text.
   */
  nys_judgment_full_text: async (inp) => {
    const archive = String(inp.archive ?? '').toLowerCase();
    const yearNum = Number(inp.year);
    const maxCharsNum = Number(inp.maxChars);
    const maxChars =
      Number.isFinite(maxCharsNum) && maxCharsNum > 0 ? Math.min(maxCharsNum, 500_000) : 120_000;
    const result = await fetchJudgmentFullText({
      s3Path: typeof inp.s3Path === 'string' ? inp.s3Path : undefined,
      query: typeof inp.query === 'string' ? inp.query : typeof inp.q === 'string' ? inp.q : undefined,
      archive: archive === 'hc' ? 'hc' : archive === 'sc' ? 'sc' : undefined,
      year: Number.isFinite(yearNum) ? yearNum : undefined,
      court: typeof inp.court === 'string' ? inp.court : undefined,
      title: typeof inp.title === 'string' ? inp.title : undefined,
    });
    if (!result.ok) {
      return {
        status: 'degraded',
        code: result.code,
        error: result.error,
        ...(result.candidates?.length ? { candidates: result.candidates } : {}),
        source: 'nys-athena-fulltext',
      };
    }
    const truncated = result.text.length > maxChars;
    return {
      s3Path: result.s3Path,
      title: result.title,
      citation: result.citation,
      resolvedVia: result.resolvedVia,
      byteSize: result.byteSize,
      textLength: truncated ? maxChars : result.textLength,
      fullTextLength: result.textLength,
      truncated,
      text: truncated ? result.text.slice(0, maxChars) : result.text,
      ocrUsed: result.ocrUsed,
      cached: result.cached,
      bytesScanned: result.bytesScanned,
      estimatedCostUsd: result.estimatedCostUsd,
      alternates: result.alternates,
      latencyMs: result.latencyMs,
      source: 'nys-athena-fulltext',
    };
  },

  contract_draft_assist: async (inp) => llmLegalTask(
    `Draft contract clauses: type=${inp.contractType ?? 'commercial'}, parties=${JSON.stringify(inp.parties ?? [])}, jurisdiction=${inp.jurisdiction ?? 'IN'}. Include governing law, indemnity, dispute resolution.`,
    String(inp.jurisdiction ?? 'IN'),
    'contract-draft',
  ),
  petition_draft_assist: async (inp) => llmLegalTask(
    `Draft legal petition: type=${inp.petitionType ?? 'writ'}, facts=${inp.facts ?? ''}, relief=${inp.reliefSought ?? ''}`,
    String(inp.jurisdiction ?? 'IN'),
    'drafting',
  ),
  legal_memo_draft: async (inp) => llmLegalTask(`Draft internal legal memo: ${inp.topic ?? inp.query ?? ''}`, String(inp.jurisdiction ?? 'IN'), 'memo'),
  client_alert_draft: async (inp) => llmLegalTask(`Draft client alert on regulatory change: ${inp.topic ?? ''}`, String(inp.jurisdiction ?? 'IN'), 'client-alert'),
  hr_policy_review: async (inp) => llmLegalTask(`Review HR policy for compliance: ${String(inp.policyText ?? '').slice(0, 6000)}`, String(inp.jurisdiction ?? 'IN'), 'hr-compliance'),
  employment_contract_review: async (inp) => llmLegalTask(`Review employment agreement: ${String(inp.document ?? '').slice(0, 6000)}`, String(inp.jurisdiction ?? 'IN'), 'employment'),
  marketing_compliance_check: async (inp) => llmLegalTask(`Marketing compliance review (${inp.channel ?? 'digital'}): ${String(inp.copy ?? inp.query ?? '')}`, String(inp.jurisdiction ?? 'IN'), 'marketing-compliance'),
  privacy_notice_draft: async (inp) => llmLegalTask(`Draft privacy notice under ${inp.framework ?? 'DPDP'} for ${inp.businessType ?? 'SaaS'}`, String(inp.jurisdiction ?? 'IN'), 'privacy-draft'),
  terms_of_service_draft: async (inp) => llmLegalTask(`Draft Terms of Service for ${inp.productType ?? 'legaltech platform'}`, String(inp.jurisdiction ?? 'IN'), 'tos-draft'),
};

// Connector tools — dynamic registration
for (const toolId of DELEGATED_MCP_TOOL_IDS) {
  if (HANDLERS[toolId]) continue;
  if (toolId.includes('_') && (
    toolId.startsWith('google_') || toolId.startsWith('microsoft_') || toolId.startsWith('sharepoint_') ||
    toolId.startsWith('aws_s3_') || toolId.startsWith('box_') || toolId.startsWith('dropbox_') ||
    toolId.startsWith('slack_') || toolId.startsWith('notion_') || toolId.startsWith('gmail_') ||
    toolId.startsWith('outlook_') || toolId.startsWith('docusign_') || toolId.startsWith('adobe_') ||
    toolId.startsWith('salesforce_') || toolId.startsWith('hubspot_') || toolId.startsWith('razorpay_') ||
    toolId.startsWith('stripe_') || toolId.startsWith('zoom_') || toolId.startsWith('asana_') ||
    toolId.startsWith('jira_') || toolId.startsWith('trello_')
  )) {
    HANDLERS[toolId] = async (inp, ctx) => {
      const invoked = await nvMcpConnectorService.invokeForTool(toolId, inp, ctx?.orgId ?? 'platform');
      if (!invoked) return { status: 'error', error: 'connector_route_missing' };
      return { ...invoked, toolId };
    };
  }
}

export async function tryMcpLegalDelegate(
  toolId: string,
  input: Record<string, unknown>,
  ctx?: { orgId?: string; userId?: string },
): Promise<Record<string, unknown> | null> {
  const handler = HANDLERS[toolId];
  if (!handler) return null;
  try {
    const result = await handler(input, ctx);
    return { ...result, toolId, status: result.status ?? 'ok', delegated: true };
  } catch (err: any) {
    logger.error('[MCP-Delegate] handler failed', { toolId, err: err?.message });
    return { toolId, status: 'failed', error: err?.message || 'delegate_error', delegated: true };
  }
}
