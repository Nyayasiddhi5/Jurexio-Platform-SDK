/**
 * SKU allowlists and env override for curated MCP tools.
 * Wave A: SKU `full` = entire partner curated surface (~125 tools).
 * OAuth stubs (DocuSign/Drive/etc.) stay out of curated claims.
 */

import type { McpSku } from './config.js';
import { ALL_CURATED_TOOL_IDS } from './curated-tools.js';

/** Per-SKU curated tool ids (subset of executable gateway + API tools). */
export const SKU_TOOL_SETS: Record<McpSku, readonly string[]> = {
  full: ALL_CURATED_TOOL_IDS,
  nsp: [
    'nyv_orchestrate',
    'nyv_knowledge_search', 'nyv_knowledge_retrieve',
    'nys_search_caselaw', 'nys_search_statutes', 'nys_get_statute',
    'nys_retrieve', 'nys_athena_search',
    'nyv_legal_work_create_run', 'nyv_legal_work_get_run',
    'nys_perform_legal_work',
    'nyv_rag_query', 'rag_namespace_search',
    'citation_verify', 'nys_check_citations',
    'nyv_verify_citations', 'nyv_hallucination_check',
    'nyv_memory_get_matter',
    'nyv_edj_create_job', 'nyv_edj_get_job',
    'nyv_templates_catalog', 'nyv_templates_fill',
    'statute_lookup', 'statute_search', 'document_parse',
    'pii_scan', 'clause_extractor',
    'contract_draft_assist', 'legal_memo_draft',
    'aws_s3_list', 'aws_s3_download',
  ],
  nym: [
    'nyv_orchestrate',
    'nyv_knowledge_search', 'nys_search_statutes', 'nys_get_statute',
    'nys_retrieve', 'nys_chat_action',
    'nyv_rag_query',
    'citation_verify', 'nys_check_citations',
    'nyv_hallucination_check',
    'nyv_memory_get_matter',
    'nyv_templates_catalog',
    'statute_lookup', 'pii_redact',
  ],
  jrx: [
    'nyv_knowledge_search', 'nyv_knowledge_retrieve',
    'nys_search_caselaw', 'nys_search_statutes', 'nys_get_statute',
    'nys_compare_ipc_bns', 'nys_retrieve', 'nys_athena_search',
    'nyv_rag_query', 'rag_namespace_search',
    'citation_verify', 'nys_check_citations', 'nyv_verify_citations',
    'statute_lookup', 'statute_search', 'landmark_cases', 'overruled_case_check',
    'academic_legal_search', 'precedent_chain',
    'supreme_court_india_search', 'high_court_search',
  ],
};

export function resolveAllowedToolIds(
  sku: McpSku,
  envAllowlist: string[] | null,
  enableHitl: boolean,
): Set<string> {
  const base = new Set(envAllowlist ?? SKU_TOOL_SETS[sku]);
  if (!enableHitl) {
    base.delete('nyv_hitl_create_request');
    base.delete('nyv_hitl_decide');
  }
  return base;
}
