/**
 * shared/jrx-governance-schema.ts
 *
 * R-SCHEMA-B Phase 2 — Drizzle parity for nv_schema tables that were not
 * already declared in shared/jrx-schema-tables.ts. Mirrors local helium
 * (which mirrors prod RDS) byte-for-byte for Tier-A tables and adds
 * conservative reverse-engineered shapes for tables only referenced via raw
 * SQL in src/.
 *
 * IMPORTANT: PK types match source DB exactly (serial → serial, uuid → uuid).
 * Never change PK types. Use `npm run db:push --force` to sync.
 *
 * Generated 2026-04-29 from local helium nv_schema (95 tables total; 28
 * already declared in jrx-schema-tables.ts + shared/schema.ts; this file
 * declares the remaining 67).
 */
import {
  pgEnum,
  serial,
  integer,
  bigint,
  bigserial,
  smallint,
  boolean,
  text,
  varchar,
  json,
  jsonb,
  uuid,
  date,
  time,
  timestamp,
  numeric,
  real,
  doublePrecision,
  customType,
  vector,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql, desc } from 'drizzle-orm';
import { nvSchema } from './schema';

// ─── ENUMS ──────────────────────────────────────────────────────────────────
export const caseUpdateType = nvSchema.enum('case_update_type', [
  'HEARING',
  'FILING',
  'DOCUMENT',
  'COMMUNICATION',
  'TASK',
  'NOTE',
] as const);

// ─── CUSTOM TYPES ───────────────────────────────────────────────────────────
const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

// ─── TABLES (mirrored from local helium) ────────────────────────────────────
// agent_audit_log — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAgentAuditLog = nvSchema.table('agent_audit_log', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentId: text('agent_id'),
  action: text('action').notNull(),
  performedBy: text('performed_by'),
  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxAgentAuditAgent: index('idx_agent_audit_agent').on(t.agentId, desc(t.createdAt)),
}));
export type NvAgentAuditLog = typeof nvAgentAuditLog.$inferSelect;
export type NewNvAgentAuditLog = typeof nvAgentAuditLog.$inferInsert;

// agent_auto_selections — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAgentAutoSelections = nvSchema.table('agent_auto_selections', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  queryText: text('query_text'),
  classifiedPracticeArea: text('classified_practice_area'),
  classifiedTaskType: text('classified_task_type'),
  selectedAgentKey: text('selected_agent_key'),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  classificationModel: text('classification_model'),
  classificationLatencyMs: integer('classification_latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxAgentAutoSelTenant: index('idx_agent_auto_sel_tenant').on(t.tenantId, desc(t.createdAt)),
}));
export type NvAgentAutoSelections = typeof nvAgentAutoSelections.$inferSelect;
export type NewNvAgentAutoSelections = typeof nvAgentAutoSelections.$inferInsert;

// agent_chain_executions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAgentChainExecutions = nvSchema.table('agent_chain_executions', {
  id: serial('id').notNull().primaryKey(),
  chainId: integer('chain_id'),
  stepResults: jsonb('step_results').default(sql`'[]'::jsonb`),
  initialInput: text('initial_input').default(''),
  finalOutput: text('final_output').default(''),
  totalLatencyMs: integer('total_latency_ms').default(0),
  status: text('status').default('completed'),
  userId: text('user_id').default(''),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvAgentChainExecutions = typeof nvAgentChainExecutions.$inferSelect;
export type NewNvAgentChainExecutions = typeof nvAgentChainExecutions.$inferInsert;

// agent_chains — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAgentChains = nvSchema.table('agent_chains', {
  id: serial('id').notNull().primaryKey(),
  name: text('name').notNull(),
  description: text('description').default(''),
  steps: jsonb('steps').default(sql`'[]'::jsonb`).notNull(),
  userId: text('user_id').default(''),
  tenantId: text('tenant_id').default(''),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvAgentChains = typeof nvAgentChains.$inferSelect;
export type NewNvAgentChains = typeof nvAgentChains.$inferInsert;

// agent_experiments — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAgentExperiments = nvSchema.table('agent_experiments', {
  id: serial('id').notNull().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  variantA: jsonb('variant_a').default(sql`'{}'::jsonb`).notNull(),
  variantB: jsonb('variant_b').default(sql`'{}'::jsonb`).notNull(),
  trafficSplit: numeric('traffic_split', { precision: 5, scale: 2 }).default('50.00'),
  status: text('status').default('draft'),
  sampleSize: integer('sample_size').default(1000),
  confidenceLevel: numeric('confidence_level', { precision: 5, scale: 2 }).default('95.00'),
  winner: text('winner'),
  results: jsonb('results').default(sql`'{}'::jsonb`),
  startedAt: timestamp('started_at', { withTimezone: true, precision: 6 }),
  endedAt: timestamp('ended_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvAgentExperiments = typeof nvAgentExperiments.$inferSelect;
export type NewNvAgentExperiments = typeof nvAgentExperiments.$inferInsert;

// agent_metrics — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAgentMetrics = nvSchema.table('agent_metrics', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentKey: text('agent_key').notNull(),
  tenantId: text('tenant_id'),
  period: text('period').default('hour').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  totalRequests: bigint('total_requests', { mode: 'number' }).default(0).notNull(),
  avgLatencyMs: doublePrecision('avg_latency_ms'),
  avgTokens: doublePrecision('avg_tokens'),
  avgCostUsd: doublePrecision('avg_cost_usd'),
  errorRate: doublePrecision('error_rate'),
  satisfactionScore: doublePrecision('satisfaction_score'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxAgentMetricsAgent: index('idx_agent_metrics_agent').on(t.agentKey),
  idxAgentMetricsPeriod: index('idx_agent_metrics_period').on(desc(t.periodStart)),
  idxAgentMetricsTenant: index('idx_agent_metrics_tenant').on(t.tenantId),
}));
export type NvAgentMetrics = typeof nvAgentMetrics.$inferSelect;
export type NewNvAgentMetrics = typeof nvAgentMetrics.$inferInsert;

// ai_activity — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAiActivity = nvSchema.table('ai_activity', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  traceId: text('trace_id').notNull(),
  userId: text('user_id').notNull(),
  jurisdiction: text('jurisdiction').default('IN').notNull(),
  patternKey: text('pattern_key'),
  route: text('route'),
  templateMode: text('template_mode').default('STRICT').notNull(),
  riskScore: integer('risk_score').default(0).notNull(),
  promptHash: text('prompt_hash').notNull(),
  blocked: boolean('blocked').default(false).notNull(),
  modelProvider: text('model_provider'),
  modelName: text('model_name'),
  tokensUsed: integer('tokens_used').default(0),
  // NV-AUDIT-TOKENS-001 — real per-request LLM cost (USD) accumulated by the
  // activity publisher; surfaced as credits_charged via the public.nv_ai_activity
  // compat view so dashboard cost totals are non-zero.
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).default('0'),
  latencyMs: integer('latency_ms').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  jurisdictionValidated: boolean('jurisdiction_validated').default(false),
}, (t) => ({
  aiActivityTraceIdKey: uniqueIndex('ai_activity_trace_id_key').on(t.traceId),
  idxAiActBlocked: index('idx_ai_act_blocked').on(t.blocked),
  idxAiActCreated: index('idx_ai_act_created').on(desc(t.createdAt)),
  idxAiActPattern: index('idx_ai_act_pattern').on(t.patternKey),
  idxAiActRisk: index('idx_ai_act_risk').on(desc(t.riskScore)),
  idxAiActUser: index('idx_ai_act_user').on(t.userId),
}));
export type NvAiActivity = typeof nvAiActivity.$inferSelect;
export type NewNvAiActivity = typeof nvAiActivity.$inferInsert;

// ai_consents — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAiConsents = nvSchema.table('ai_consents', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id'),
  consentType: text('consent_type').notNull(),
  granted: boolean('granted').default(false).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  grantedAt: timestamp('granted_at', { withTimezone: true, precision: 6 }),
  revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxAiConsentsCreated: index('idx_ai_consents_created').on(desc(t.createdAt)),
  idxAiConsentsTenant: index('idx_ai_consents_tenant').on(t.tenantId),
  idxAiConsentsUserActive: index('idx_ai_consents_user_active').on(t.userId, t.consentType),
}));
export type NvAiConsents = typeof nvAiConsents.$inferSelect;
export type NewNvAiConsents = typeof nvAiConsents.$inferInsert;

// ai_feedback — mirrored from local helium 2026-04-29 (Tier-A)
export const nvAiFeedback = nvSchema.table('ai_feedback', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  requestId: text('request_id'),
  agentKey: text('agent_key'),
  rating: integer('rating'),
  thumbs: text('thumbs'),
  comment: text('comment'),
  responseSnippet: text('response_snippet'),
  tags: jsonb('tags').default(sql`'[]'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxAiFeedbackAgent: index('idx_ai_feedback_agent').on(t.agentKey, desc(t.createdAt)),
  idxAiFeedbackTenantCreated: index('idx_ai_feedback_tenant_created').on(t.tenantId, desc(t.createdAt)),
}));
export type NvAiFeedback = typeof nvAiFeedback.$inferSelect;
export type NewNvAiFeedback = typeof nvAiFeedback.$inferInsert;

// bias_analysis_log — mirrored from local helium 2026-04-29 (Tier-A)
export const nvBiasAnalysisLog = nvSchema.table('bias_analysis_log', {
  id: serial('id').notNull().primaryKey(),
  agentKey: text('agent_key'),
  sessionId: text('session_id'),
  compositeScore: doublePrecision('composite_score'),
  overallSeverity: text('overall_severity'),
  flagged: boolean('flagged').default(false),
  dimensionScores: jsonb('dimension_scores').default(sql`'[]'::jsonb`),
  signalCount: integer('signal_count').default(0),
  analysedAt: timestamp('analysed_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxBiasLogAgent: index('idx_bias_log_agent').on(t.agentKey, desc(t.analysedAt)),
}));
export type NvBiasAnalysisLog = typeof nvBiasAnalysisLog.$inferSelect;
export type NewNvBiasAnalysisLog = typeof nvBiasAnalysisLog.$inferInsert;

// bias_audits — mirrored from local helium 2026-04-29 (Tier-A)
export const nvBiasAudits = nvSchema.table('bias_audits', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id'),
  agentKey: text('agent_key'),
  biasScore: doublePrecision('bias_score'),
  sampleSize: integer('sample_size'),
  protectedAttrs: jsonb('protected_attrs'),
  findings: jsonb('findings').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxBiasAuditsCreated: index('idx_bias_audits_created').on(desc(t.createdAt)),
  idxBiasAuditsTenant: index('idx_bias_audits_tenant').on(t.tenantId),
}));
export type NvBiasAudits = typeof nvBiasAudits.$inferSelect;
export type NewNvBiasAudits = typeof nvBiasAudits.$inferInsert;

// bulk_analysis_jobs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvBulkAnalysisJobs = nvSchema.table('bulk_analysis_jobs', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id'),
  userId: text('user_id'),
  jobName: text('job_name'),
  documentIds: jsonb('document_ids').default(sql`'[]'::jsonb`),
  documentCount: integer('document_count').default(0),
  processedCount: integer('processed_count').default(0),
  status: text('status').default('pending'),
  results: jsonb('results').default(sql`'{}'::jsonb`),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, precision: 6 }),
}, (t) => ({
  idxBulkJobsTenantStatus: index('idx_bulk_jobs_tenant_status').on(t.tenantId, t.status),
}));
export type NvBulkAnalysisJobs = typeof nvBulkAnalysisJobs.$inferSelect;
export type NewNvBulkAnalysisJobs = typeof nvBulkAnalysisJobs.$inferInsert;

// calendar_events — mirrored from local helium 2026-04-29 (Tier-A)
export const nvCalendarEvents = nvSchema.table('calendar_events', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  title: text('title').notNull(),
  description: text('description'),
  eventDate: timestamp('event_date', { withTimezone: true, precision: 6 }),
  endDate: timestamp('end_date', { withTimezone: true, precision: 6 }),
  location: text('location'),
  attendees: jsonb('attendees').default(sql`'[]'::jsonb`),
  sourceDocId: text('source_doc_id'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxCalEventsUserDate: index('idx_cal_events_user_date').on(t.userId, t.eventDate),
}));
export type NvCalendarEvents = typeof nvCalendarEvents.$inferSelect;
export type NewNvCalendarEvents = typeof nvCalendarEvents.$inferInsert;

// case_updates — mirrored from local helium 2026-04-29 (Tier-A)
export const nvCaseUpdates = nvSchema.table('case_updates', {
  updateId: uuid('update_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  caseId: text('case_id').notNull(),
  userId: text('user_id').notNull(),
  updateType: caseUpdateType('update_type').notNull(),
  title: text('title').notNull(),
  description: text('description').default('').notNull(),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  lockedAt: timestamp('locked_at', { withTimezone: true, precision: 6 }),
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  roleSnapshot: varchar('role_snapshot', { length: 100 }),
  isBillable: boolean('is_billable').default(false),
  billableMinutes: integer('billable_minutes'),
  linkedInvoiceId: uuid('linked_invoice_id'),
  stageBefore: varchar('stage_before', { length: 50 }),
  stageAfter: varchar('stage_after', { length: 50 }),
  isClientVisible: boolean('is_client_visible').default(true),
  confidentialLevel: varchar('confidential_level', { length: 30 }).default('TEAM_VISIBLE'),
  ipAddress: varchar('ip_address', { length: 50 }),
  deviceInfo: varchar('device_info', { length: 300 }),
  hashSignature: varchar('hash_signature', { length: 64 }),
  recordStatus: varchar('record_status', { length: 20 }).default('active'),
}, (t) => ({
  idxCuCase: index('idx_cu_case').on(t.caseId),
  idxCuCreated: index('idx_cu_created').on(desc(t.createdAt)),
  idxCuType: index('idx_cu_type').on(t.updateType),
  idxCuUser: index('idx_cu_user').on(t.userId),
}));
export type NvCaseUpdates = typeof nvCaseUpdates.$inferSelect;
export type NewNvCaseUpdates = typeof nvCaseUpdates.$inferInsert;

// citation_checks — mirrored from local helium 2026-04-29 (Tier-A)
export const nvCitationChecks = nvSchema.table('citation_checks', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  requestId: text('request_id'),
  agentKey: text('agent_key'),
  citationText: text('citation_text'),
  citationType: text('citation_type'),
  isValid: boolean('is_valid'),
  sourceUrl: text('source_url'),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxCitationRequest: index('idx_citation_request').on(t.requestId),
}));
export type NvCitationChecks = typeof nvCitationChecks.$inferSelect;
export type NewNvCitationChecks = typeof nvCitationChecks.$inferInsert;

// compliance_evidence — mirrored from local helium 2026-04-29 (Tier-A)
export const nvComplianceEvidence = nvSchema.table('compliance_evidence', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id').notNull(),
  evidenceType: text('evidence_type').notNull(),
  framework: text('framework').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  evidenceData: jsonb('evidence_data').default(sql`'{}'::jsonb`).notNull(),
  generatedBy: text('generated_by'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxComplEvidCreated: index('idx_compl_evid_created').on(desc(t.createdAt)),
  idxComplEvidFramework: index('idx_compl_evid_framework').on(t.framework),
  idxComplEvidTenant: index('idx_compl_evid_tenant').on(t.tenantId),
}));
export type NvComplianceEvidence = typeof nvComplianceEvidence.$inferSelect;
export type NewNvComplianceEvidence = typeof nvComplianceEvidence.$inferInsert;

// contract_playbooks — mirrored from local helium 2026-04-29 (Tier-A)
export const nvContractPlaybooks = nvSchema.table('contract_playbooks', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id'),
  name: text('name').notNull(),
  description: text('description'),
  contractType: text('contract_type'),
  rules: jsonb('rules').default(sql`'[]'::jsonb`),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxPlaybookTenant: index('idx_playbook_tenant').on(t.tenantId),
}));
export type NvContractPlaybooks = typeof nvContractPlaybooks.$inferSelect;
export type NewNvContractPlaybooks = typeof nvContractPlaybooks.$inferInsert;

// credit_transactions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvCreditTransactions = nvSchema.table('credit_transactions', {
  transactionId: uuid('transaction_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  type: text('type').notNull(),
  credits: integer('credits').notNull(),
  source: text('source').notNull(),
  toolName: text('tool_name').default('unknown').notNull(),
  referenceId: uuid('reference_id'),
  immutableHash: text('immutable_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxCtxCreated: index('idx_ctx_created').on(desc(t.createdAt)),
  idxCtxType: index('idx_ctx_type').on(t.type),
  idxCtxUser: index('idx_ctx_user').on(t.userId),
}));
export type NvCreditTransactions = typeof nvCreditTransactions.$inferSelect;
export type NewNvCreditTransactions = typeof nvCreditTransactions.$inferInsert;

// credit_wallet — mirrored from local helium 2026-04-29 (Tier-A)
export const nvCreditWallet = nvSchema.table('credit_wallet', {
  walletId: uuid('wallet_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  creditsBalance: integer('credits_balance').default(0).notNull(),
  reservedCredits: integer('reserved_credits').default(0).notNull(),
  creditsExpiry: timestamp('credits_expiry', { withTimezone: true, precision: 6 }),
  lastUpdated: timestamp('last_updated', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  creditWalletUserIdKey: uniqueIndex('credit_wallet_user_id_key').on(t.userId),
  idxWalletUser: uniqueIndex('idx_wallet_user').on(t.userId),
}));
export type NvCreditWallet = typeof nvCreditWallet.$inferSelect;
export type NewNvCreditWallet = typeof nvCreditWallet.$inferInsert;

// custom_agents — mirrored from local helium 2026-04-29 (Tier-A)
export const nvCustomAgents = nvSchema.table('custom_agents', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id').notNull(),
  createdBy: text('created_by'),
  agentName: text('agent_name').notNull(),
  agentKey: text('agent_key').notNull(),
  description: text('description'),
  systemPrompt: text('system_prompt').notNull(),
  knowledgeSourceIds: jsonb('knowledge_source_ids').default(sql`'[]'::jsonb`),
  allowedActions: jsonb('allowed_actions').default(sql`'[]'::jsonb`),
  temperature: numeric('temperature', { precision: 3, scale: 2 }).default('0.7'),
  maxTokens: integer('max_tokens').default(2048),
  modelPreference: text('model_preference'),
  isActive: boolean('is_active').default(true),
  usageCount: integer('usage_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  customAgentsAgentKeyKey: uniqueIndex('custom_agents_agent_key_key').on(t.agentKey),
  idxCustomAgentsTenant: index('idx_custom_agents_tenant').on(t.tenantId, t.isActive),
}));
export type NvCustomAgents = typeof nvCustomAgents.$inferSelect;
export type NewNvCustomAgents = typeof nvCustomAgents.$inferInsert;

// documents — mirrored from local helium 2026-04-29 (Tier-A)
export const nvDocuments = nvSchema.table('documents', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id'),
  userId: text('user_id'),
  title: text('title'),
  content: text('content'),
  docType: text('doc_type'),
  filePath: text('file_path'),
  fileSize: bigint('file_size', { mode: 'number' }),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxDocumentsTenant: index('idx_documents_tenant').on(t.tenantId, desc(t.createdAt)),
}));
export type NvDocuments = typeof nvDocuments.$inferSelect;
export type NewNvDocuments = typeof nvDocuments.$inferInsert;

// email_classifications — mirrored from local helium 2026-04-29 (Tier-A)
export const nvEmailClassifications = nvSchema.table('email_classifications', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id').notNull(),
  userId: text('user_id'),
  emailSubject: text('email_subject'),
  emailFrom: text('email_from'),
  emailBodySnippet: text('email_body_snippet'),
  classifiedPriority: text('classified_priority'),
  classifiedAction: text('classified_action'),
  classificationConfidence: numeric('classification_confidence', { precision: 5, scale: 4 }),
  status: text('status').default('classified'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxEmailClassTenant: index('idx_email_class_tenant').on(t.tenantId, desc(t.createdAt)),
}));
export type NvEmailClassifications = typeof nvEmailClassifications.$inferSelect;
export type NewNvEmailClassifications = typeof nvEmailClassifications.$inferInsert;

// experiment_outcomes — mirrored from local helium 2026-04-29 (Tier-A)
export const nvExperimentOutcomes = nvSchema.table('experiment_outcomes', {
  id: serial('id').notNull().primaryKey(),
  experimentId: integer('experiment_id'),
  variant: text('variant').notNull(),
  userId: text('user_id'),
  agentKey: text('agent_key'),
  responseQuality: numeric('response_quality', { precision: 5, scale: 2 }),
  latencyMs: integer('latency_ms'),
  success: boolean('success').default(true),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvExperimentOutcomes = typeof nvExperimentOutcomes.$inferSelect;
export type NewNvExperimentOutcomes = typeof nvExperimentOutcomes.$inferInsert;

// explainability_logs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvExplainabilityLogs = nvSchema.table('explainability_logs', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  requestId: text('request_id'),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  agentKey: text('agent_key'),
  reasoningSteps: jsonb('reasoning_steps').default(sql`'[]'::jsonb`),
  sourcesConsulted: jsonb('sources_consulted').default(sql`'[]'::jsonb`),
  confidence: numeric('confidence', { precision: 5, scale: 4 }),
  tier: text('tier'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxExplainLogsRequest: index('idx_explain_logs_request').on(t.requestId),
}));
export type NvExplainabilityLogs = typeof nvExplainabilityLogs.$inferSelect;
export type NewNvExplainabilityLogs = typeof nvExplainabilityLogs.$inferInsert;

// hallucination_checks — mirrored from local helium 2026-04-29 (Tier-A)
export const nvHallucinationChecks = nvSchema.table('hallucination_checks', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  requestId: text('request_id'),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  agentKey: text('agent_key'),
  inputText: text('input_text'),
  outputText: text('output_text'),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 4 }),
  groundingScore: numeric('grounding_score', { precision: 5, scale: 4 }),
  flaggedClaims: jsonb('flagged_claims').default(sql`'[]'::jsonb`),
  verifiedCitations: jsonb('verified_citations').default(sql`'[]'::jsonb`),
  unverifiedCitations: jsonb('unverified_citations').default(sql`'[]'::jsonb`),
  status: text('status'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxHallucRequest: index('idx_halluc_request').on(t.requestId),
  idxHallucStatus: index('idx_halluc_status').on(t.status, desc(t.createdAt)),
}));
export type NvHallucinationChecks = typeof nvHallucinationChecks.$inferSelect;
export type NewNvHallucinationChecks = typeof nvHallucinationChecks.$inferInsert;

// hitl_reviews — mirrored from local helium 2026-04-29 (Tier-A)
export const nvHitlReviews = nvSchema.table('hitl_reviews', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  requestId: text('request_id').notNull(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  agentKey: text('agent_key'),
  riskLevel: text('risk_level').default('medium').notNull(),
  aiOutput: jsonb('ai_output').default(sql`'{}'::jsonb`).notNull(),
  reviewStatus: text('review_status').default('pending').notNull(),
  slaDeadline: timestamp('sla_deadline', { withTimezone: true, precision: 6 }),
  reviewerId: text('reviewer_id'),
  reviewerDecision: text('reviewer_decision'),
  reviewerNotes: text('reviewer_notes'),
  modifiedOutput: jsonb('modified_output'),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxHitlReviewsCreated: index('idx_hitl_reviews_created').on(desc(t.createdAt)),
  idxHitlReviewsRequest: index('idx_hitl_reviews_request').on(t.requestId),
  idxHitlReviewsStatus: index('idx_hitl_reviews_status').on(t.reviewStatus),
  idxHitlReviewsTenant: index('idx_hitl_reviews_tenant').on(t.tenantId),
}));
export type NvHitlReviews = typeof nvHitlReviews.$inferSelect;
export type NewNvHitlReviews = typeof nvHitlReviews.$inferInsert;

// institutional_leads — mirrored from local helium 2026-04-29 (Tier-A)
export const nvInstitutionalLeads = nvSchema.table('institutional_leads', {
  leadId: uuid('lead_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  orgName: text('org_name').notNull(),
  orgType: text('org_type').notNull(),
  contactName: text('contact_name').notNull(),
  contactEmail: text('contact_email').notNull(),
  contactPhone: text('contact_phone'),
  jurisdiction: text('jurisdiction').default('IN').notNull(),
  teamSize: text('team_size'),
  useCase: text('use_case').notNull(),
  monthlyVolume: text('monthly_volume'),
  integrationsNeeded: text('integrations_needed').array(),
  complianceNeeds: text('compliance_needs').array(),
  stepCompleted: integer('step_completed').default(1).notNull(),
  formData: jsonb('form_data').default(sql`'{}'::jsonb`).notNull(),
  status: text('status').default('new').notNull(),
  assignedTo: text('assigned_to'),
  notes: text('notes'),
  source: text('source').default('institutional_wizard').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxIlCreated: index('idx_il_created').on(desc(t.createdAt)),
  idxIlEmail: index('idx_il_email').on(t.contactEmail),
  idxIlStatus: index('idx_il_status').on(t.status),
}));
export type NvInstitutionalLeads = typeof nvInstitutionalLeads.$inferSelect;
export type NewNvInstitutionalLeads = typeof nvInstitutionalLeads.$inferInsert;

// jurisdiction_profiles — mirrored from local helium 2026-04-29 (Tier-A)
export const nvJurisdictionProfiles = nvSchema.table('jurisdiction_profiles', {
  id: serial('id').notNull().primaryKey(),
  jurisdictionCode: varchar('jurisdiction_code', { length: 10 }).notNull(),
  orgId: varchar('org_id', { length: 36 }),
  name: varchar('name', { length: 100 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('INR'),
  courts: jsonb('courts').default(sql`'[]'::jsonb`),
  statutes: jsonb('statutes').default(sql`'[]'::jsonb`),
  regulatoryBodies: jsonb('regulatory_bodies').default(sql`'[]'::jsonb`),
  languages: jsonb('languages').default(sql`'[]'::jsonb`),
  prohibitedPhrases: jsonb('prohibited_phrases').default(sql`'[]'::jsonb`),
  mandatoryDisclosures: jsonb('mandatory_disclosures').default(sql`'[]'::jsonb`),
  aiFormatRules: jsonb('ai_format_rules').default(sql`'{}'::jsonb`),
  complianceFrameworks: jsonb('compliance_frameworks').default(sql`'[]'::jsonb`),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: false, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: false, precision: 6 }).defaultNow(),
});
export type NvJurisdictionProfiles = typeof nvJurisdictionProfiles.$inferSelect;
export type NewNvJurisdictionProfiles = typeof nvJurisdictionProfiles.$inferInsert;

// memory_entries — mirrored from local helium 2026-04-29 (Tier-A)
export const nvMemoryEntries = nvSchema.table('memory_entries', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  tenantId: text('tenant_id'),
  memoryType: text('memory_type').default('fact').notNull(),
  scope: text('scope').default('longterm').notNull(),
  matterId: text('matter_id'),
  sessionId: text('session_id'),
  key: text('key'),
  value: jsonb('value').default(sql`'{}'::jsonb`).notNull(),
  importance: doublePrecision('importance').default(0.5),
  accessCount: integer('access_count').default(0).notNull(),
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true, precision: 6 }),
  expiresAt: timestamp('expires_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxMemoryExpires: index('idx_memory_expires').on(t.expiresAt),
  idxMemoryMatter: index('idx_memory_matter').on(t.matterId),
  idxMemoryScope: index('idx_memory_scope').on(t.scope),
  idxMemorySession: index('idx_memory_session').on(t.sessionId),
  idxMemoryTenant: index('idx_memory_tenant').on(t.tenantId),
  idxMemoryUser: index('idx_memory_user').on(t.userId),
}));
export type NvMemoryEntries = typeof nvMemoryEntries.$inferSelect;
export type NewNvMemoryEntries = typeof nvMemoryEntries.$inferInsert;

// model_drift_alerts — mirrored from local helium 2026-04-29 (Tier-A)
export const nvModelDriftAlerts = nvSchema.table('model_drift_alerts', {
  id: serial('id').notNull().primaryKey(),
  checkId: integer('check_id'),
  baselineId: integer('baseline_id'),
  metricName: text('metric_name').notNull(),
  baselineValue: numeric('baseline_value', { precision: 10, scale: 4 }),
  currentValue: numeric('current_value', { precision: 10, scale: 4 }),
  driftPercentage: numeric('drift_percentage', { precision: 10, scale: 4 }),
  severity: text('severity').default('warning'),
  acknowledged: boolean('acknowledged').default(false),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvModelDriftAlerts = typeof nvModelDriftAlerts.$inferSelect;
export type NewNvModelDriftAlerts = typeof nvModelDriftAlerts.$inferInsert;

// model_drift_baselines — mirrored from local helium 2026-04-29 (Tier-A)
export const nvModelDriftBaselines = nvSchema.table('model_drift_baselines', {
  id: serial('id').notNull().primaryKey(),
  modelName: text('model_name').notNull(),
  agentKey: text('agent_key'),
  baselineMetrics: jsonb('baseline_metrics').default(sql`'{}'::jsonb`).notNull(),
  sampleCount: integer('sample_count').default(0),
  establishedAt: timestamp('established_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvModelDriftBaselines = typeof nvModelDriftBaselines.$inferSelect;
export type NewNvModelDriftBaselines = typeof nvModelDriftBaselines.$inferInsert;

// model_drift_checks — mirrored from local helium 2026-04-29 (Tier-A)
export const nvModelDriftChecks = nvSchema.table('model_drift_checks', {
  id: serial('id').notNull().primaryKey(),
  baselineId: integer('baseline_id'),
  currentMetrics: jsonb('current_metrics').default(sql`'{}'::jsonb`),
  driftScore: numeric('drift_score', { precision: 5, scale: 4 }).default('0'),
  driftDetected: boolean('drift_detected').default(false),
  checkedAt: timestamp('checked_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvModelDriftChecks = typeof nvModelDriftChecks.$inferSelect;
export type NewNvModelDriftChecks = typeof nvModelDriftChecks.$inferInsert;

// nv_agent_metrics — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvAgentMetrics = nvSchema.table('nv_agent_metrics', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentKey: text('agent_key').notNull(),
  tenantId: text('tenant_id'),
  requestCount: integer('request_count').default(0),
  successCount: integer('success_count').default(0),
  failureCount: integer('failure_count').default(0),
  totalLatencyMs: bigint('total_latency_ms', { mode: 'number' }).default(0),
  totalInputTokens: bigint('total_input_tokens', { mode: 'number' }).default(0),
  totalOutputTokens: bigint('total_output_tokens', { mode: 'number' }).default(0),
  totalCostUsd: numeric('total_cost_usd', { precision: 12, scale: 6 }).default('0'),
  metricsWindow: text('metrics_window').default('hour'),
  windowStart: timestamp('window_start', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxAgentMetricsAgentWindow: index('idx_agent_metrics_agent_window').on(t.agentKey, desc(t.windowStart)),
}));
export type NvNvAgentMetrics = typeof nvNvAgentMetrics.$inferSelect;
export type NewNvNvAgentMetrics = typeof nvNvAgentMetrics.$inferInsert;

// nv_agent_personas — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvAgentPersonas = nvSchema.table('nv_agent_personas', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentKey: text('agent_key').notNull(),
  orgId: text('org_id').notNull(),
  personaOverrides: jsonb('persona_overrides').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvAgentPersonasAgentKey: index('idx_nv_agent_personas_agent_key').on(t.agentKey),
  nvAgentPersonasAgentKeyOrgIdKey: uniqueIndex('nv_agent_personas_agent_key_org_id_key').on(t.agentKey, t.orgId),
}));
export type NvNvAgentPersonas = typeof nvNvAgentPersonas.$inferSelect;
export type NewNvNvAgentPersonas = typeof nvNvAgentPersonas.$inferInsert;

// nv_agent_prune_log — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvAgentPruneLog = nvSchema.table('nv_agent_prune_log', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentId: text('agent_id'),
  action: text('action'),
  reason: text('reason'),
  performedBy: text('performed_by'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvNvAgentPruneLog = typeof nvNvAgentPruneLog.$inferSelect;
export type NewNvNvAgentPruneLog = typeof nvNvAgentPruneLog.$inferInsert;

// nv_consent_records — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvConsentRecords = nvSchema.table('nv_consent_records', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  orgId: text('org_id'),
  purpose: text('purpose').notNull(),
  status: text('status').default('granted').notNull(),
  jurisdiction: text('jurisdiction').default('IN').notNull(),
  grantedAt: timestamp('granted_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  withdrawnAt: timestamp('withdrawn_at', { withTimezone: true, precision: 6 }),
  expiresAt: timestamp('expires_at', { withTimezone: true, precision: 6 }),
  consentVersion: text('consent_version').notNull(),
  legalBasis: text('legal_basis').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvConsentStatus: index('idx_nv_consent_status').on(t.userId, t.status),
  idxNvConsentUser: index('idx_nv_consent_user').on(t.userId),
  nvConsentRecordsUserIdPurposeConsentVersionKey: uniqueIndex('nv_consent_records_user_id_purpose_consent_version_key').on(t.userId, t.purpose, t.consentVersion),
}));
export type NvNvConsentRecords = typeof nvNvConsentRecords.$inferSelect;
export type NewNvNvConsentRecords = typeof nvNvConsentRecords.$inferInsert;

// nv_content_history — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvContentHistory = nvSchema.table('nv_content_history', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentKey: text('agent_key').notNull(),
  orgId: text('org_id').notNull(),
  platform: text('platform').notNull(),
  timeOfDay: text('time_of_day').notNull(),
  content: text('content').notNull(),
  topic: text('topic'),
  matterId: text('matter_id'),
  knowledgeContextUsed: boolean('knowledge_context_used').default(false),
  generatedAt: timestamp('generated_at', { withTimezone: true, precision: 6 }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvContentHistoryAgentOrg: index('idx_nv_content_history_agent_org').on(t.agentKey, t.orgId),
  idxNvContentHistoryGenerated: index('idx_nv_content_history_generated').on(desc(t.generatedAt)),
}));
export type NvNvContentHistory = typeof nvNvContentHistory.$inferSelect;
export type NewNvNvContentHistory = typeof nvNvContentHistory.$inferInsert;

// nv_doc_analysis_stats — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvDocAnalysisStats = nvSchema.table('nv_doc_analysis_stats', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  orgId: text('org_id').notNull(),
  docType: text('doc_type'),
  wordCount: integer('word_count'),
  pageCount: integer('page_count'),
  riskDistribution: jsonb('risk_distribution').default(sql`'{"Low": 0, "High": 0, "Medium": 0}'::jsonb`),
  missingTermsCount: integer('missing_terms_count').default(0),
  clausesFound: integer('clauses_found').default(0),
  obligationsFound: integer('obligations_found').default(0),
  privacyAlertsCount: integer('privacy_alerts_count').default(0),
  confidenceScore: numeric('confidence_score', { precision: 5, scale: 4 }).default('0'),
  processingTimeMs: integer('processing_time_ms').default(0),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvDocStatsOrgId: index('idx_nv_doc_stats_org_id').on(t.orgId),
}));
export type NvNvDocAnalysisStats = typeof nvNvDocAnalysisStats.$inferSelect;
export type NewNvNvDocAnalysisStats = typeof nvNvDocAnalysisStats.$inferInsert;

// nv_filter_configs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvFilterConfigs = nvSchema.table('nv_filter_configs', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  orgId: text('org_id').notNull(),
  agentKey: text('agent_key'),
  rules: jsonb('rules').default(sql`'[]'::jsonb`),
  blockedCategories: jsonb('blocked_categories').default(sql`'["spam_promo", "inappropriate"]'::jsonb`),
  allowAmbiguous: boolean('allow_ambiguous').default(true),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvFilterConfigsOrg: index('idx_nv_filter_configs_org').on(t.orgId),
  nvFilterConfigsOrgIdAgentKeyKey: uniqueIndex('nv_filter_configs_org_id_agent_key_key').on(t.orgId, t.agentKey),
}));
export type NvNvFilterConfigs = typeof nvNvFilterConfigs.$inferSelect;
export type NewNvNvFilterConfigs = typeof nvNvFilterConfigs.$inferInsert;

// nv_grpo_episodes — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvGrpoEpisodes = nvSchema.table('nv_grpo_episodes', {
  episodeId: uuid('episode_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  agentId: text('agent_id'),
  rewardScore: numeric('reward_score', { precision: 8, scale: 4 }),
  groupSize: integer('group_size'),
  taskType: text('task_type'),
  jurisdiction: text('jurisdiction'),
  model: text('model'),
  latencyMs: integer('latency_ms'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxGrpoEpiAgent: index('idx_grpo_epi_agent').on(t.agentId, desc(t.createdAt)),
}));
export type NvNvGrpoEpisodes = typeof nvNvGrpoEpisodes.$inferSelect;
export type NewNvNvGrpoEpisodes = typeof nvNvGrpoEpisodes.$inferInsert;

// nv_grpo_policy_snapshots — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvGrpoPolicySnapshots = nvSchema.table('nv_grpo_policy_snapshots', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  policySnapshot: jsonb('policy_snapshot').notNull(),
  updateCount: integer('update_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvNvGrpoPolicySnapshots = typeof nvNvGrpoPolicySnapshots.$inferSelect;
export type NewNvNvGrpoPolicySnapshots = typeof nvNvGrpoPolicySnapshots.$inferInsert;

// nv_grpo_runs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvGrpoRuns = nvSchema.table('nv_grpo_runs', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  patternKey: text('pattern_key').notNull(),
  route: text('route').notNull(),
  agentId: text('agent_id'),
  jurisdiction: text('jurisdiction'),
  taskHash: text('task_hash'),
  responseSnippet: text('response_snippet'),
  reward: doublePrecision('reward'),
  policyUpdated: boolean('policy_updated').default(false),
  totalEpisodes: integer('total_episodes').default(0),
  avgReward: doublePrecision('avg_reward'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxNvGrpoRunsCreated: index('idx_nv_grpo_runs_created').on(desc(t.createdAt)),
  idxNvGrpoRunsPattern: index('idx_nv_grpo_runs_pattern').on(t.patternKey),
}));
export type NvNvGrpoRuns = typeof nvNvGrpoRuns.$inferSelect;
export type NewNvNvGrpoRuns = typeof nvNvGrpoRuns.$inferInsert;

// nv_km_ingested_content — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvKmIngestedContent = nvSchema.table('nv_km_ingested_content', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  moduleName: text('module_name').notNull(),
  orgId: text('org_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sourceUrl: text('source_url'),
  publishedAt: timestamp('published_at', { withTimezone: true, precision: 6 }).defaultNow(),
  tags: jsonb('tags').default(sql`'[]'::jsonb`),
  jurisdiction: text('jurisdiction').default('india'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvKmContentModuleOrg: index('idx_nv_km_content_module_org').on(t.moduleName, t.orgId),
  idxNvKmContentPublished: index('idx_nv_km_content_published').on(desc(t.publishedAt)),
}));
export type NvNvKmIngestedContent = typeof nvNvKmIngestedContent.$inferSelect;
export type NewNvNvKmIngestedContent = typeof nvNvKmIngestedContent.$inferInsert;

// nv_km_module_settings — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvKmModuleSettings = nvSchema.table('nv_km_module_settings', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  orgId: text('org_id').notNull(),
  moduleName: text('module_name').notNull(),
  moduleSettings: jsonb('module_settings').default(sql`'{}'::jsonb`),
  nextRunAt: timestamp('next_run_at', { withTimezone: true, precision: 6 }).defaultNow(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  nvKmModuleSettingsOrgIdModuleNameKey: uniqueIndex('nv_km_module_settings_org_id_module_name_key').on(t.orgId, t.moduleName),
}));
export type NvNvKmModuleSettings = typeof nvNvKmModuleSettings.$inferSelect;
export type NewNvNvKmModuleSettings = typeof nvNvKmModuleSettings.$inferInsert;

// nv_legal_graph_edges — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvLegalGraphEdges = nvSchema.table('nv_legal_graph_edges', {
  id: text('id').notNull().primaryKey(),
  orgId: text('org_id'),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  edgeType: text('edge_type').notNull(),
  weight: doublePrecision('weight').default(1.0),
  docId: text('doc_id'),
  confidence: doublePrecision('confidence').default(0.8),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxGraphEdgesOrg: index('idx_graph_edges_org').on(t.orgId),
  idxGraphEdgesSource: index('idx_graph_edges_source').on(t.sourceId),
  idxGraphEdgesTarget: index('idx_graph_edges_target').on(t.targetId),
  idxGraphEdgesType: index('idx_graph_edges_type').on(t.edgeType),
}));
export type NvNvLegalGraphEdges = typeof nvNvLegalGraphEdges.$inferSelect;
export type NewNvNvLegalGraphEdges = typeof nvNvLegalGraphEdges.$inferInsert;

// nv_legal_graph_entities — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvLegalGraphEntities = nvSchema.table('nv_legal_graph_entities', {
  id: text('id').notNull().primaryKey(),
  orgId: text('org_id'),
  type: text('type').notNull(),
  value: text('value').notNull(),
  normalizedValue: text('normalized_value').notNull(),
  jurisdiction: text('jurisdiction'),
  statute: text('statute'),
  section: text('section'),
  year: integer('year'),
  aliases: jsonb('aliases').default(sql`'[]'::jsonb`),
  docIds: jsonb('doc_ids').default(sql`'[]'::jsonb`),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxGraphEntitiesJur: index('idx_graph_entities_jur').on(t.jurisdiction),
  idxGraphEntitiesNorm: index('idx_graph_entities_norm').on(t.normalizedValue),
  idxGraphEntitiesOrg: index('idx_graph_entities_org').on(t.orgId),
  idxGraphEntitiesType: index('idx_graph_entities_type').on(t.type),
}));
export type NvNvLegalGraphEntities = typeof nvNvLegalGraphEntities.$inferSelect;
export type NewNvNvLegalGraphEntities = typeof nvNvLegalGraphEntities.$inferInsert;

// nv_sdk_usage_metrics — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvSdkUsageMetrics = nvSchema.table('nv_sdk_usage_metrics', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  appId: text('app_id'),
  apiKeyId: text('api_key_id'),
  endpoint: text('endpoint'),
  method: text('method'),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  bytesSent: bigint('bytes_sent', { mode: 'number' }),
  bytesReceived: bigint('bytes_received', { mode: 'number' }),
  orgId: text('org_id'),
  userId: text('user_id'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxSdkUsageCreated: index('idx_sdk_usage_created').on(desc(t.createdAt)),
}));
export type NvNvSdkUsageMetrics = typeof nvNvSdkUsageMetrics.$inferSelect;
export type NewNvNvSdkUsageMetrics = typeof nvNvSdkUsageMetrics.$inferInsert;

// nv_social_memory — mirrored from local helium 2026-04-29 (Tier-A)
export const nvNvSocialMemory = nvSchema.table('nv_social_memory', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  agentKey: text('agent_key').notNull(),
  orgId: text('org_id').notNull(),
  platform: text('platform').default('portal').notNull(),
  interactionCount: integer('interaction_count').default(0).notNull(),
  lastInteraction: timestamp('last_interaction', { withTimezone: true, precision: 6 }).defaultNow(),
  conversationHistory: jsonb('conversation_history').default(sql`'[]'::jsonb`),
  opinion: text('opinion'),
  lastOpinionUpdatedAt: timestamp('last_opinion_updated_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvSocialMemoryAgent: index('idx_nv_social_memory_agent').on(t.agentKey, t.orgId),
  idxNvSocialMemoryUser: index('idx_nv_social_memory_user').on(t.userId, t.orgId),
  nvSocialMemoryUserIdAgentKeyOrgIdKey: uniqueIndex('nv_social_memory_user_id_agent_key_org_id_key').on(t.userId, t.agentKey, t.orgId),
}));
export type NvNvSocialMemory = typeof nvNvSocialMemory.$inferSelect;
export type NewNvNvSocialMemory = typeof nvNvSocialMemory.$inferInsert;

// nv_statutes — REMOVED 2026-05-05 (B1 consolidation).
// Canonical = public.nv_statutes (305 rows, live writer in
// src/services/jrx-statute-seeding-service.ts). The nv_schema.nv_statutes
// fork (83 rows) was a perfect SUBSET of public and had no writers; it
// was dropped via scripts/consolidate-jrx-statutes.sql.
// Reads use raw SQL in src/routes/jrx-core-routes.ts and the seeder; no
// Drizzle export is needed at the moment. If a Drizzle export is later
// required, define it on the public schema (not nvSchema).

// office_documents — mirrored from local helium 2026-04-29 (Tier-A)
export const nvOfficeDocuments = nvSchema.table('office_documents', {
  id: serial('id').notNull().primaryKey(),
  userId: text('user_id'),
  documentType: text('document_type').notNull(),
  templateName: text('template_name'),
  format: text('format').default('docx'),
  fileSize: integer('file_size').default(0),
  status: text('status').default('completed'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvOfficeDocuments = typeof nvOfficeDocuments.$inferSelect;
export type NewNvOfficeDocuments = typeof nvOfficeDocuments.$inferInsert;

// parlant_sessions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvParlantSessions = nvSchema.table('parlant_sessions', {
  id: serial('id').notNull().primaryKey(),
  userId: text('user_id').notNull(),
  agentKey: text('agent_key').notNull(),
  turns: jsonb('turns').default(sql`'[]'::jsonb`),
  context: jsonb('context').default(sql`'{}'::jsonb`),
  status: text('status').default('active'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true, precision: 6 }),
});
export type NvParlantSessions = typeof nvParlantSessions.$inferSelect;
export type NewNvParlantSessions = typeof nvParlantSessions.$inferInsert;

// playbook_checks — mirrored from local helium 2026-04-29 (Tier-A)
export const nvPlaybookChecks = nvSchema.table('playbook_checks', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  playbookId: text('playbook_id'),
  tenantId: text('tenant_id'),
  overallScore: numeric('overall_score', { precision: 5, scale: 4 }),
  deviations: jsonb('deviations').default(sql`'[]'::jsonb`),
  riskLevel: text('risk_level'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvPlaybookChecks = typeof nvPlaybookChecks.$inferSelect;
export type NewNvPlaybookChecks = typeof nvPlaybookChecks.$inferInsert;

// rag_chunks — mirrored from local helium 2026-04-29 (Tier-A)
export const nvRagChunks = nvSchema.table('rag_chunks', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  documentId: uuid('document_id'),
  chunkIndex: integer('chunk_index'),
  content: text('content'),
  tokenCount: integer('token_count'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  embedding: vector('embedding', { dimensions: 1536 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxRagChunksDoc: index('idx_rag_chunks_doc').on(t.documentId, t.chunkIndex),
}));
export type NvRagChunks = typeof nvRagChunks.$inferSelect;
export type NewNvRagChunks = typeof nvRagChunks.$inferInsert;

// rag_documents — mirrored from local helium 2026-04-29 (Tier-A)
export const nvRagDocuments = nvSchema.table('rag_documents', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id'),
  userId: text('user_id'),
  title: text('title').notNull(),
  fileType: text('file_type').default('text'),
  fileSize: integer('file_size'),
  status: text('status').default('processing'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  chunkCount: integer('chunk_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxRagDocsTenantCreated: index('idx_rag_docs_tenant_created').on(t.tenantId, desc(t.createdAt)),
}));
export type NvRagDocuments = typeof nvRagDocuments.$inferSelect;
export type NewNvRagDocuments = typeof nvRagDocuments.$inferInsert;

// rag_retrievals — mirrored from local helium 2026-04-29 (Tier-A)
export const nvRagRetrievals = nvSchema.table('rag_retrievals', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  requestId: text('request_id'),
  tenantId: text('tenant_id'),
  queryText: text('query_text'),
  chunkIds: jsonb('chunk_ids').default(sql`'[]'::jsonb`),
  retrievalLatencyMs: integer('retrieval_latency_ms').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxRagRetrTenant: index('idx_rag_retr_tenant').on(t.tenantId, desc(t.createdAt)),
}));
export type NvRagRetrievals = typeof nvRagRetrievals.$inferSelect;
export type NewNvRagRetrievals = typeof nvRagRetrievals.$inferInsert;

// sdk_api_request_logs — REMOVED 2026-05-05 (B2 consolidation).
// Canonical = public.sdk_api_request_logs (defined in shared/schema.ts:144
// as `sdkApiRequestLogs`). The nv_schema.sdk_api_request_logs fork
// (71 rows) was pattern-detector synthetic traffic with non-FK app_id
// values like 'pattern:REACT'; it was archived to
// .local/backups/nv_schema_sdk_api_request_logs_pre_drop_2026-05-05.csv
// then dropped via scripts/consolidate-sdk-api-request-logs.sql.
// The writer at src/middleware/jrx-sdk-tracking-middleware.ts:468 was
// re-pointed to public with column-shape translation.

// streaming_sessions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvStreamingSessions = nvSchema.table('streaming_sessions', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id'),
  tenantId: text('tenant_id'),
  agentKey: text('agent_key'),
  model: text('model'),
  status: text('status').default('active'),
  tokensStreamed: integer('tokens_streamed').default(0),
  totalChunks: integer('total_chunks').default(0),
  completedAt: timestamp('completed_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvStreamingSessions = typeof nvStreamingSessions.$inferSelect;
export type NewNvStreamingSessions = typeof nvStreamingSessions.$inferInsert;

// subscription_events — mirrored from local helium 2026-04-29 (Tier-A)
export const nvSubscriptionEvents = nvSchema.table('subscription_events', {
  eventId: uuid('event_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  subscriptionId: uuid('subscription_id'),
  userId: text('user_id').notNull(),
  eventType: text('event_type').notNull(),
  previousStatus: text('previous_status'),
  newStatus: text('new_status'),
  payload: jsonb('payload').default(sql`'{}'::jsonb`).notNull(),
  source: text('source').default('webhook').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxSevtCreated: index('idx_sevt_created').on(desc(t.createdAt)),
  idxSevtType: index('idx_sevt_type').on(t.eventType),
  idxSevtUser: index('idx_sevt_user').on(t.userId),
}));
export type NvSubscriptionEvents = typeof nvSubscriptionEvents.$inferSelect;
export type NewNvSubscriptionEvents = typeof nvSubscriptionEvents.$inferInsert;

// subscription_table — mirrored from local helium 2026-04-29 (Tier-A)
export const nvSubscriptionTable = nvSchema.table('subscription_table', {
  subscriptionId: uuid('subscription_id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  userId: text('user_id').notNull(),
  planId: text('plan_id').default('alpha').notNull(),
  status: text('status').default('active').notNull(),
  billingCycle: text('billing_cycle').default('monthly').notNull(),
  amountInr: numeric('amount_inr', { precision: 12, scale: 2 }).default('0').notNull(),
  currency: text('currency').default('INR').notNull(),
  razorpaySubId: text('razorpay_sub_id'),
  currentPeriodStart: timestamp('current_period_start', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true, precision: 6 }).default(sql`(now() + '30 days'::interval)`).notNull(),
  trialEnd: timestamp('trial_end', { withTimezone: true, precision: 6 }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, precision: 6 }),
  cancelReason: text('cancel_reason'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  idxSubPlan: index('idx_sub_plan').on(t.planId),
  idxSubStatus: index('idx_sub_status').on(t.status),
  idxSubUser: index('idx_sub_user').on(t.userId),
  subscriptionTableUserIdKey: uniqueIndex('subscription_table_user_id_key').on(t.userId),
}));
export type NvSubscriptionTable = typeof nvSubscriptionTable.$inferSelect;
export type NewNvSubscriptionTable = typeof nvSubscriptionTable.$inferInsert;

// tool_executions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvToolExecutions = nvSchema.table('tool_executions', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  requestId: text('request_id'),
  tenantId: text('tenant_id'),
  toolName: text('tool_name'),
  toolCategory: text('tool_category'),
  inputParams: jsonb('input_params').default(sql`'{}'::jsonb`),
  outputResult: jsonb('output_result').default(sql`'{}'::jsonb`),
  executionTimeMs: integer('execution_time_ms'),
  success: boolean('success'),
  errorMessage: text('error_message'),
  sandboxed: boolean('sandboxed').default(false),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxToolExecRequest: index('idx_tool_exec_request').on(t.requestId),
  idxToolExecTenantCreated: index('idx_tool_exec_tenant_created').on(t.tenantId, desc(t.createdAt)),
}));
export type NvToolExecutions = typeof nvToolExecutions.$inferSelect;
export type NewNvToolExecutions = typeof nvToolExecutions.$inferInsert;

// tool_sandbox_executions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvToolSandboxExecutions = nvSchema.table('tool_sandbox_executions', {
  id: serial('id').notNull().primaryKey(),
  toolId: text('tool_id').notNull(),
  userId: text('user_id'),
  parameters: jsonb('parameters').default(sql`'{}'::jsonb`),
  result: jsonb('result').default(sql`'{}'::jsonb`),
  status: text('status').default('pending'),
  executionTimeMs: integer('execution_time_ms').default(0),
  sandboxPolicy: text('sandbox_policy').default('read-only'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvToolSandboxExecutions = typeof nvToolSandboxExecutions.$inferSelect;
export type NewNvToolSandboxExecutions = typeof nvToolSandboxExecutions.$inferInsert;

// usage_logs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvUsageLogs = nvSchema.table('usage_logs', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  tenantId: text('tenant_id'),
  userId: text('user_id'),
  agentKey: text('agent_key'),
  source: text('source'),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  totalTokens: integer('total_tokens').default(0),
  costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).default('0'),
  model: text('model'),
  provider: varchar('provider', { length: 100 }),
  tier: text('tier'),
  latencyMs: integer('latency_ms'),
  success: boolean('success').default(true),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxUsageLogsAgent: index('idx_usage_logs_agent').on(t.agentKey, desc(t.createdAt)),
  idxUsageLogsTenantCreated: index('idx_usage_logs_tenant_created').on(t.tenantId, desc(t.createdAt)),
}));
export type NvUsageLogs = typeof nvUsageLogs.$inferSelect;
export type NewNvUsageLogs = typeof nvUsageLogs.$inferInsert;

// users — mirrored from local helium 2026-04-29 (Tier-A)
export const nvUsers = nvSchema.table('users', {
  id: uuid('id').default(sql`gen_random_uuid()`).notNull().primaryKey(),
  email: text('email'),
  name: text('name'),
  isActive: boolean('is_active').default(true),
  orgId: text('org_id'),
  role: text('role'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  idxNvsUsersActive: index('idx_nvs_users_active').on(t.isActive),
  usersEmailKey: uniqueIndex('users_email_key').on(t.email),
}));
export type NvUsers = typeof nvUsers.$inferSelect;
export type NewNvUsers = typeof nvUsers.$inferInsert;

// vector_collections — mirrored from local helium 2026-04-29 (Tier-A)
export const nvVectorCollections = nvSchema.table('vector_collections', {
  id: serial('id').notNull().primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  metric: text('metric').default('cosine'),
  dimensions: integer('dimensions').default(1536),
  documentCount: integer('document_count').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvVectorCollections = typeof nvVectorCollections.$inferSelect;
export type NewNvVectorCollections = typeof nvVectorCollections.$inferInsert;

// vector_search_logs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvVectorSearchLogs = nvSchema.table('vector_search_logs', {
  id: serial('id').notNull().primaryKey(),
  collectionId: integer('collection_id'),
  query: text('query'),
  resultsCount: integer('results_count').default(0),
  latencyMs: integer('latency_ms').default(0),
  searchType: text('search_type').default('hybrid'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvVectorSearchLogs = typeof nvVectorSearchLogs.$inferSelect;
export type NewNvVectorSearchLogs = typeof nvVectorSearchLogs.$inferInsert;

// vision_analysis_logs — mirrored from local helium 2026-04-29 (Tier-A)
export const nvVisionAnalysisLogs = nvSchema.table('vision_analysis_logs', {
  id: serial('id').notNull().primaryKey(),
  userId: text('user_id'),
  analysisType: text('analysis_type').notNull(),
  model: text('model').default('gpt-4o'),
  inputType: text('input_type').default('image'),
  resultSummary: jsonb('result_summary').default(sql`'{}'::jsonb`),
  tokensUsed: integer('tokens_used').default(0),
  latencyMs: integer('latency_ms').default(0),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvVisionAnalysisLogs = typeof nvVisionAnalysisLogs.$inferSelect;
export type NewNvVisionAnalysisLogs = typeof nvVisionAnalysisLogs.$inferInsert;

// voice_sessions — mirrored from local helium 2026-04-29 (Tier-A)
export const nvVoiceSessions = nvSchema.table('voice_sessions', {
  id: serial('id').notNull().primaryKey(),
  userId: text('user_id'),
  sessionType: text('session_type').notNull(),
  provider: text('provider').default('openai'),
  language: text('language').default('en'),
  durationMs: integer('duration_ms').default(0),
  cost: numeric('cost', { precision: 10, scale: 6 }).default('0'),
  status: text('status').default('completed'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvVoiceSessions = typeof nvVoiceSessions.$inferSelect;
export type NewNvVoiceSessions = typeof nvVoiceSessions.$inferInsert;

// ── R-SCHEMA-B residual (2026-07-31) — tables referenced in src/ but undeclared ──

/** BIPA biometric consent ledger (was runtime CREATE TABLE only). */
export const nvBipaConsentRecords = nvSchema.table('nv_bipa_consent_records', {
  id: uuid('id').defaultRandom().notNull().primaryKey(),
  userId: text('user_id').notNull(),
  orgId: text('org_id'),
  biometricType: text('biometric_type').notNull(),
  status: text('status').notNull().default('granted'),
  disclosureText: text('disclosure_text').notNull(),
  purpose: text('purpose').notNull(),
  retentionTerm: text('retention_term').notNull(),
  signatureName: text('signature_name').notNull(),
  signaturePayload: text('signature_payload'),
  policyVersion: text('policy_version').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  grantedAt: timestamp('granted_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true, precision: 6 }),
  destroyedAt: timestamp('destroyed_at', { withTimezone: true, precision: 6 }),
  expiresAt: timestamp('expires_at', { withTimezone: true, precision: 6 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  userBioIdx: index('idx_nv_bipa_user').on(t.userId, t.biometricType),
  userStatusIdx: index('idx_nv_bipa_status').on(t.userId, t.status),
}));
export type NvBipaConsentRecords = typeof nvBipaConsentRecords.$inferSelect;

/** Biometric artefact refs for BIPA destruction worker. */
export const nvBiometricArtefacts = nvSchema.table('nv_biometric_artefacts', {
  id: uuid('id').defaultRandom().notNull().primaryKey(),
  userId: text('user_id').notNull(),
  biometricType: text('biometric_type').notNull(),
  payloadRef: text('payload_ref'),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow(),
});
export type NvBiometricArtefacts = typeof nvBiometricArtefacts.$inferSelect;

/** Digital twin persistence (migration 2026-07-02; Drizzle parity). */
export const nvDigitalTwins = nvSchema.table('nv_digital_twins', {
  twinId: varchar('twin_id', { length: 128 }).notNull().primaryKey(),
  organizationId: varchar('organization_id', { length: 128 }),
  entityId: varchar('entity_id', { length: 256 }).notNull(),
  twinType: varchar('twin_type', { length: 64 }).notNull(),
  status: varchar('status', { length: 32 }).notNull().default('active'),
  profile: jsonb('profile').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => ({
  orgIdx: index('idx_nv_digital_twins_org').on(t.organizationId),
  entityIdx: index('idx_nv_digital_twins_entity').on(t.entityId),
  statusIdx: index('idx_nv_digital_twins_status').on(t.status),
}));
export type NvDigitalTwins = typeof nvDigitalTwins.$inferSelect;

/**
 * RAG coverage audit cells (run_id + category + jurisdiction uniqueness).
 * Upsert key historically used run_id alone; composite unique matches query GROUP BY.
 */
export const nvRagCoverageAudit = nvSchema.table('nv_rag_coverage_audit', {
  id: uuid('id').defaultRandom().notNull().primaryKey(),
  runId: text('run_id').notNull(),
  category: text('category').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  fixtureQuery: text('fixture_query'),
  pipelineUsed: text('pipeline_used'),
  sourcesCount: integer('sources_count').default(0),
  avgSimilarity: real('avg_similarity').default(0),
  grounded: boolean('grounded').default(false),
  latencyMs: integer('latency_ms').default(0),
  status: text('status').default('yellow'),
  notes: text('notes'),
  ranAt: timestamp('ran_at', { withTimezone: true, precision: 6 }).defaultNow(),
}, (t) => ({
  cellUniq: uniqueIndex('idx_nv_rag_coverage_audit_cell').on(t.runId, t.category, t.jurisdiction),
  runIdx: index('idx_nv_rag_coverage_audit_run').on(t.runId),
}));
export type NvRagCoverageAudit = typeof nvRagCoverageAudit.$inferSelect;

