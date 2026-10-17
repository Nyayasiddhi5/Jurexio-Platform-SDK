/**
 * v5.1.0 registry agent IDs for SDK docs-pipeline task routing.
 * Canonical IDs from config/agent-registries/Jurexio-Legal-registry-Default.json.
 */
export const DOC_PIPELINE_AGENT_IDS = {
  document_parse: 'A-027',       // Clause Extraction Agent
  document_intelligence: 'A-025', // Contract Risk Review Agent
  document_summarize: 'A-129',    // Document Assembly Agent
  document_compare: 'A-036',      // Contract Comparison Agent
  clause_recommend: 'A-001',      // Contract Drafting Agent
  compliance_check: 'A-028',      // Compliance Gap Agent
} as const;

export type DocPipelineTaskType = keyof typeof DOC_PIPELINE_AGENT_IDS;

export function agentKeyForDocTask(taskType: string): string {
  return DOC_PIPELINE_AGENT_IDS[taskType as DocPipelineTaskType] ?? 'auto';
}
