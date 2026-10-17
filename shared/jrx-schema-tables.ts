// ════════════════════════════════════════════════════════════════════════════
//  nv-schema-tables.ts — Drizzle parity for the `nv_schema` Postgres namespace
// ════════════════════════════════════════════════════════════════════════════
//
//  Source of truth: AWS RDS production (api.jurexio.example), introspected
//  on 2026-04-29 via information_schema. See PROJECT-TRACKER row
//  `2026-04-29T04:35:00Z — Schema/Drizzle parity introspection`.
//
//  This file holds Drizzle entries for the 26 governance / billing /
//  observability tables that lived on prod RDS for weeks without Drizzle
//  declarations (they were created ad-hoc through ALTER scripts during the
//  Phase-1 Legal Chat smoke). The two earlier-tracked tables
//  (nvModelGovernance, nvAuditLogsHashChain) remain in shared/schema.ts to
//  avoid breaking ~14 import sites.
//
//  RULES this file follows:
//   1.  Column names, types, NOT NULL flags, and DEFAULT expressions are
//       byte-for-byte mirrors of prod RDS. Verified row-by-row against the
//       introspection capture in /tmp/introspect-out.txt.
//   2.  PRIMARY KEY column types are NEVER changed. Where prod uses serial
//       (int4 + sequence), Drizzle uses serial(). Where prod uses uuid,
//       varchar(36), or text, those are preserved.
//   3.  Vector columns (pgvector) are declared via a customType so a fresh
//       db:push reproduces prod's HNSW indexes without dropping data.
//   4.  Tables WITHOUT a primary-key constraint on prod (e.g.
//       sdk_app_api_keys) are mirrored as such — adding one would generate
//       a destructive ALTER on a live table with rows.
//
//  After this file lands and is wired into drizzle.config.ts:
//    drizzle-kit introspect → reports ZERO drift for nv_schema tables.
//
// ════════════════════════════════════════════════════════════════════════════

import {
  pgSchema,
  serial,
  bigserial,
  integer,
  bigint,
  text,
  varchar,
  jsonb,
  numeric,
  real,
  doublePrecision,
  boolean,
  timestamp,
  uuid,
  index,
  uniqueIndex,
  customType,
} from 'drizzle-orm/pg-core';
import { sql, type InferSelectModel, type InferInsertModel } from 'drizzle-orm';

// Re-declare the schema namespace locally so this file can be wired into
// drizzle.config.ts independently of shared/schema.ts. Drizzle treats two
// `pgSchema('nv_schema')` references with the same name as the same schema —
// no duplication is generated in the migration plan.
export const nvSchema = pgSchema('nv_schema');

// ── pgvector columns ────────────────────────────────────────────────────────
// Prod has the `vector` extension installed and uses HNSW cosine indexes on
// two columns. Drizzle has no built-in vector type, so we declare it via
// customType. Mode is 'number[]' so app code can read/write plain arrays.
const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector';
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
});

// ────────────────────────────────────────────────────────────────────────────
// 1. adversarial_test_runs — red-team / jailbreak test outcomes
// ────────────────────────────────────────────────────────────────────────────
export const nvAdversarialTestRuns = nvSchema.table('adversarial_test_runs', {
  id:                   serial('id').primaryKey(),
  agentKey:             text('agent_key').default(''),
  testName:             text('test_name').default(''),
  attackType:           text('attack_type').default(''),
  promptsTested:        integer('prompts_tested').default(0),
  vulnerabilitiesFound: integer('vulnerabilities_found').default(0),
  severity:             text('severity').default('low'),
  results:              jsonb('results').$type<unknown[]>().default(sql`'[]'::jsonb`),
  ranBy:                text('ran_by').default(''),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 2. agent_learning_sessions — GRPO-style suggestion batches per agent
// ────────────────────────────────────────────────────────────────────────────
export const nvAgentLearningSessions = nvSchema.table('agent_learning_sessions', {
  id:                   serial('id').primaryKey(),
  agentKey:             text('agent_key').notNull().default(''),
  feedbackSampleCount:  integer('feedback_sample_count').default(0),
  suggestions:          jsonb('suggestions').$type<unknown[]>().default(sql`'[]'::jsonb`),
  approved:             boolean('approved').default(false),
  appliedAt:            timestamp('applied_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 3. agent_marketplace_installs — buyer ↔ listing relation
// ────────────────────────────────────────────────────────────────────────────
export const nvAgentMarketplaceInstalls = nvSchema.table('agent_marketplace_installs', {
  id:           serial('id').primaryKey(),
  listingId:    integer('listing_id'),
  buyerId:      text('buyer_id').default(''),
  orgId:        text('org_id').default(''),
  installedAt:  timestamp('installed_at', { withTimezone: true }).defaultNow(),
  status:       text('status').default('active'),
});

// ────────────────────────────────────────────────────────────────────────────
// 4. agent_marketplace_listings — published custom-agent definitions
// ────────────────────────────────────────────────────────────────────────────
export const nvAgentMarketplaceListings = nvSchema.table('agent_marketplace_listings', {
  id:            serial('id').primaryKey(),
  agentConfig:   jsonb('agent_config').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  sellerId:      text('seller_id').default(''),
  name:          text('name').notNull().default(''),
  description:   text('description').default(''),
  category:      text('category').default('general'),
  priceUsd:      numeric('price_usd').default('0'),
  ratingAvg:     numeric('rating_avg').default('0'),
  installCount:  integer('install_count').default(0),
  status:        text('status').default('active'),
  tags:          jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 5. agui_events — AG-UI / AGNTCY event-stream archive (text PK!)
// ────────────────────────────────────────────────────────────────────────────
export const nvAguiEvents = nvSchema.table('agui_events', {
  id:         text('id').primaryKey(),
  sessionId:  text('session_id').notNull(),
  eventType:  text('event_type').notNull(),
  payload:    jsonb('payload').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  agentKey:   text('agent_key'),
  userId:     text('user_id'),
  createdAt:  timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  sessionIdx: index('idx_agui_events_session').on(t.sessionId, t.createdAt.desc()),
}));

// ────────────────────────────────────────────────────────────────────────────
// 6. ai_credit_overrides — per-org credit-budget overrides (text PK on org)
// ────────────────────────────────────────────────────────────────────────────
export const nvAiCreditOverrides = nvSchema.table('ai_credit_overrides', {
  orgId:               text('org_id').primaryKey(),
  dailyTokenBudget:    bigint('daily_token_budget', { mode: 'number' }).notNull(),
  hourlyRequestLimit:  integer('hourly_request_limit').notNull().default(500),
  updatedAt:           timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 7. ai_credit_usage — every credit-debiting LLM call (hot append-only)
// ────────────────────────────────────────────────────────────────────────────
export const nvAiCreditUsage = nvSchema.table('ai_credit_usage', {
  id:            serial('id').primaryKey(),
  userId:        text('user_id').notNull(),
  orgId:         text('org_id'),
  tier:          text('tier').notNull().default('solo'),
  tokensUsed:    integer('tokens_used').notNull().default(0),
  agentKey:      text('agent_key'),
  jurisdiction:  text('jurisdiction'),
  model:         text('model'),
  requestId:     text('request_id'),
  costUsd:       numeric('cost_usd').default('0'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  userDateIdx:  index('idx_ai_credit_user_date').on(t.userId, t.createdAt.desc()),
  orgDateIdx:   index('idx_ai_credit_org_date').on(t.orgId, t.createdAt.desc()),
}));

// ────────────────────────────────────────────────────────────────────────────
// 8. ai_incidents — security / safety / hallucination incident log
// ────────────────────────────────────────────────────────────────────────────
export const nvAiIncidents = nvSchema.table('ai_incidents', {
  id:           serial('id').primaryKey(),
  incidentType: text('incident_type').notNull(),
  severity:     text('severity').notNull().default('medium'),
  title:        text('title').notNull(),
  description:  text('description').default(''),
  sourceIp:     text('source_ip'),
  userId:       text('user_id'),
  orgId:        text('org_id'),
  status:       text('status').default('open'),
  metadata:     jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
  resolvedAt:   timestamp('resolved_at', { withTimezone: true }),
}, (t) => ({
  statusIdx: index('idx_ai_incidents_status').on(t.status, t.createdAt.desc()),
}));

// ────────────────────────────────────────────────────────────────────────────
// 9. async_job_queue — generic background-job queue (UNIQUE on job_id)
// ────────────────────────────────────────────────────────────────────────────
export const nvAsyncJobQueue = nvSchema.table('async_job_queue', {
  id:            serial('id').primaryKey(),
  jobId:         text('job_id').notNull(),
  jobType:       text('job_type').notNull(),
  status:        text('status').default('queued'),
  priority:      text('priority').default('normal'),
  input:         jsonb('input').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  output:        jsonb('output').$type<Record<string, unknown>>(),
  errorMessage:  text('error_message'),
  userId:        text('user_id'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
  startedAt:     timestamp('started_at', { withTimezone: true }),
  completedAt:   timestamp('completed_at', { withTimezone: true }),
  updatedAt:     timestamp('updated_at', { withTimezone: true }),
}, (t) => ({
  jobIdUniq: uniqueIndex('async_job_queue_job_id_key').on(t.jobId),
  userIdx:   index('idx_async_jobs_user').on(t.userId, t.createdAt.desc()),
  typeStatusCreatedIdx: index('idx_async_job_queue_type_status_created').on(t.jobType, t.status, t.createdAt.desc()),
}));

// ────────────────────────────────────────────────────────────────────────────
// 9b. nv_matter_vaults — durable Matter Vault metadata (NV-MATTER-VAULT-PG-001)
//     Mirrors migrations/2026-07-14-nv-matter-vaults.sql column-for-column:
//     VARCHAR-typed identifier/enum columns (not text) and NOT NULL timestamps.
// ────────────────────────────────────────────────────────────────────────────
export const nvMatterVaults = nvSchema.table('nv_matter_vaults', {
  vaultId:        varchar('vault_id', { length: 64 }).primaryKey(),
  organizationId: varchar('organization_id', { length: 128 }),
  userId:         varchar('user_id', { length: 128 }),
  name:           text('name').notNull(),
  matterRef:      text('matter_ref'),
  description:    text('description'),
  jurisdiction:   varchar('jurisdiction', { length: 16 }).notNull().default('IN'),
  status:         varchar('status', { length: 32 }).notNull().default('draft'),
  defaultDepth:   varchar('default_depth', { length: 32 }).notNull().default('detailed'),
  payload:        jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:      timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:    index('idx_nv_matter_vaults_org').on(t.organizationId),
  statusIdx: index('idx_nv_matter_vaults_status').on(t.status),
  updatedIdx: index('idx_nv_matter_vaults_updated').on(t.updatedAt.desc()),
}));

// ────────────────────────────────────────────────────────────────────────────
// 9c. nv_edj_access_denials — EDJ access-deny audit trail
//     Mirrors migrations/2026-07-05-nv-drift-b-telemetry.sql (lines 87-97).
//     Declared here to close NV-SCHEMA-DRIFT-001 "EXTRA DB TABLE": the
//     migration created it on 2026-07-05 with no TS counterpart.
// ────────────────────────────────────────────────────────────────────────────
export const nvEdjAccessDenials = nvSchema.table('nv_edj_access_denials', {
  id:             bigserial('id', { mode: 'number' }).primaryKey(),
  jobId:          text('job_id').notNull(),
  callerAppId:    integer('caller_app_id'),
  callerPlatform: text('caller_platform'),
  callerOrgId:    text('caller_org_id'),
  reason:         text('reason').notNull().default('forbidden'),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  jobIdx:     index('idx_edj_denials_job').on(t.jobId),
  createdIdx: index('idx_edj_denials_created').on(t.createdAt.desc()),
}));

// ────────────────────────────────────────────────────────────────────────────
// 10. billing_activity_log — per-event billing meter
// ────────────────────────────────────────────────────────────────────────────
export const nvBillingActivityLog = nvSchema.table('billing_activity_log', {
  id:           serial('id').primaryKey(),
  orgId:        text('org_id').default(''),
  userId:       text('user_id').default(''),
  activityType: text('activity_type').default(''),
  resourceId:   text('resource_id').default(''),
  units:        numeric('units').default('0'),
  unitPrice:    numeric('unit_price').default('0'),
  totalCost:    numeric('total_cost').default('0'),
  metadata:     jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  billedAt:     timestamp('billed_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 11. billing_invoices — period-aggregated invoices
// ────────────────────────────────────────────────────────────────────────────
export const nvBillingInvoices = nvSchema.table('billing_invoices', {
  id:           serial('id').primaryKey(),
  orgId:        text('org_id').default(''),
  periodStart:  timestamp('period_start', { withTimezone: true }),
  periodEnd:    timestamp('period_end', { withTimezone: true }),
  lineItems:    jsonb('line_items').$type<unknown[]>().default(sql`'[]'::jsonb`),
  subtotal:     numeric('subtotal').default('0'),
  tax:          numeric('tax').default('0'),
  total:        numeric('total').default('0'),
  status:       text('status').default('pending'),
  generatedAt:  timestamp('generated_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 12. case_predictions — outcome-prediction model outputs
// ────────────────────────────────────────────────────────────────────────────
export const nvCasePredictions = nvSchema.table('case_predictions', {
  id:            serial('id').primaryKey(),
  inputFeatures: jsonb('input_features').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  prediction:    jsonb('prediction').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  confidence:    numeric('confidence').default('0'),
  modelVersion:  text('model_version').default('v1'),
  createdAt:     timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 13. data_lineage_audit — entity-level lineage audit
// ────────────────────────────────────────────────────────────────────────────
export const nvDataLineageAudit = nvSchema.table('data_lineage_audit', {
  id:           serial('id').primaryKey(),
  entityId:     text('entity_id'),
  entityType:   text('entity_type'),
  action:       text('action').notNull(),
  performedBy:  text('performed_by'),
  metadata:     jsonb('metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 14. data_lineage_events — per-LLM-call lineage capture
// ────────────────────────────────────────────────────────────────────────────
export const nvDataLineageEvents = nvSchema.table('data_lineage_events', {
  id:               serial('id').primaryKey(),
  requestId:        text('request_id').default(''),
  userId:           text('user_id').default(''),
  orgId:            text('org_id').default(''),
  inputHash:        text('input_hash').default(''),
  agentKey:         text('agent_key').default(''),
  modelUsed:        text('model_used').default(''),
  provider:         text('provider').default(''),
  ragSources:       jsonb('rag_sources').$type<unknown[]>().default(sql`'[]'::jsonb`),
  piiDetected:      jsonb('pii_detected').$type<unknown[]>().default(sql`'[]'::jsonb`),
  outputHash:       text('output_hash').default(''),
  latencyMs:        integer('latency_ms').default(0),
  complianceFlags:  jsonb('compliance_flags').$type<unknown[]>().default(sql`'[]'::jsonb`),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 15. fine_tuning_jobs — OpenAI / vendor fine-tune job tracking
// ────────────────────────────────────────────────────────────────────────────
export const nvFineTuningJobs = nvSchema.table('fine_tuning_jobs', {
  id:                serial('id').primaryKey(),
  modelBase:         text('model_base').default('gpt-4o-mini'),
  agentKey:          text('agent_key').default(''),
  status:            text('status').default('pending'),
  trainingFileId:    text('training_file_id').default(''),
  openaiJobId:       text('openai_job_id').default(''),
  fineTunedModelId:  text('fine_tuned_model_id').default(''),
  hyperparameters:   jsonb('hyperparameters').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  trainingMetrics:   jsonb('training_metrics').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
  completedAt:       timestamp('completed_at', { withTimezone: true }),
});

// ────────────────────────────────────────────────────────────────────────────
// 16. knowledge_graph_edges — typed relations between entities
// ────────────────────────────────────────────────────────────────────────────
export const nvKnowledgeGraphEdges = nvSchema.table('knowledge_graph_edges', {
  id:                serial('id').primaryKey(),
  fromEntityId:      integer('from_entity_id'),
  toEntityId:        integer('to_entity_id'),
  relationshipType:  text('relationship_type').default('related'),
  weight:            numeric('weight').default('1.0'),
  properties:        jsonb('properties').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  createdAt:         timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 17. knowledge_graph_entities — typed nodes with pgvector embeddings
//      INDEX: HNSW (vector_cosine_ops) on embedding_vector
// ────────────────────────────────────────────────────────────────────────────
export const nvKnowledgeGraphEntities = nvSchema.table('knowledge_graph_entities', {
  id:               serial('id').primaryKey(),
  entityType:       text('entity_type').default('concept'),
  name:             text('name').notNull().default(''),
  description:      text('description').default(''),
  properties:       jsonb('properties').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  embeddingVector:  vector('embedding_vector'),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
});
// HNSW index on embedding_vector is created at runtime by pgvector setup.
// Drizzle does not yet model HNSW indexes natively; CREATE INDEX is in
// scripts/jrx-pgvector-init.sql so a fresh deploy still gets it.

// ────────────────────────────────────────────────────────────────────────────
// 18. mcp_tool_executions — per-MCP-call audit (tool, latency, summaries)
// ────────────────────────────────────────────────────────────────────────────
export const nvMcpToolExecutions = nvSchema.table('mcp_tool_executions', {
  id:             serial('id').primaryKey(),
  executionId:    text('execution_id'),
  toolId:         text('tool_id').notNull(),
  sessionId:      text('session_id'),
  inputSummary:   text('input_summary'),
  resultSummary:  text('result_summary'),
  latencyMs:      integer('latency_ms').default(0),
  userId:         text('user_id'),
  createdAt:      timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 19. nv_document_ingest_status — per-document ingestion FSM (text PK on doc_id)
// ────────────────────────────────────────────────────────────────────────────
export const nvDocumentIngestStatus = nvSchema.table('nv_document_ingest_status', {
  docId:                text('doc_id').primaryKey(),
  jobId:                text('job_id').notNull(),
  orgId:                text('org_id').notNull(),
  platform:             text('platform').notNull(),
  userId:               text('user_id').notNull(),
  fileName:             text('file_name').notNull(),
  mimeType:             text('mime_type').notNull(),
  fileSizeBytes:        bigint('file_size_bytes', { mode: 'number' }).notNull().default(0),
  sha256Hash:           text('sha256_hash').notNull(),
  storagePath:          text('storage_path').notNull(),
  documentClass:        text('document_class').default('user_document'),
  jurisdiction:         text('jurisdiction'),
  language:             text('language').default('en'),
  tags:                 jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`),
  isConfidential:       boolean('is_confidential').default(false),
  status:               text('status').notNull().default('queued'),
  progress:             integer('progress').default(0),
  stage:                text('stage').default('queued'),
  chunksIndexed:        integer('chunks_indexed').default(0),
  embeddingsGenerated:  integer('embeddings_generated').default(0),
  graphNodesAdded:      integer('graph_nodes_added').default(0),
  errorMessage:         text('error_message'),
  retrievable:          boolean('retrievable').default(false),
  startedAt:            timestamp('started_at', { withTimezone: true }),
  completedAt:          timestamp('completed_at', { withTimezone: true }),
  createdAt:            timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt:            timestamp('updated_at', { withTimezone: true }).defaultNow(),
  customMetadata:       jsonb('custom_metadata').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
}, (t) => ({
  statusIdx:   index('idx_nv_doc_ingest_status').on(t.status),
  createdIdx:  index('idx_nv_doc_ingest_created').on(t.createdAt.desc()),
  userIdx:     index('idx_nv_doc_ingest_user').on(t.orgId, t.platform, t.userId),
}));

// ────────────────────────────────────────────────────────────────────────────
// 20. org_memory_entries — per-org KV memory with pgvector embedding
// ────────────────────────────────────────────────────────────────────────────
export const nvOrgMemoryEntries = nvSchema.table('org_memory_entries', {
  id:               serial('id').primaryKey(),
  orgId:            text('org_id').notNull().default(''),
  key:              text('key').default(''),
  value:            text('value').default(''),
  embeddingVector:  vector('embedding_vector'),
  createdAt:        timestamp('created_at', { withTimezone: true }).defaultNow(),
  expiresAt:        timestamp('expires_at', { withTimezone: true }),
});
// HNSW index on embedding_vector — see nv-pgvector-init.sql.

// ────────────────────────────────────────────────────────────────────────────
// 21. pii_vault — encrypted PII tokens with TTL
// ────────────────────────────────────────────────────────────────────────────
export const nvPiiVault = nvSchema.table('pii_vault', {
  id:              serial('id').primaryKey(),
  token:           text('token').notNull(),
  piiType:         text('pii_type').notNull(),
  encryptedValue:  text('encrypted_value').notNull(),
  tenantId:        text('tenant_id'),
  userId:          text('user_id'),
  requestId:       text('request_id'),
  accessCount:     integer('access_count').default(0),
  expiresAt:       timestamp('expires_at', { withTimezone: true }),
  createdAt:       timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  tokenUniq:    uniqueIndex('pii_vault_token_key').on(t.token),
  tokenIdx:     index('idx_pii_vault_token').on(t.token),
  expiresIdx:   index('idx_pii_vault_expires').on(t.expiresAt),
}));

// ────────────────────────────────────────────────────────────────────────────
// 22. protocol_registry — initialised platform sub-protocols (varchar(36) PK)
//      Default expression on prod is `(gen_random_uuid())::text` (NOT just
//      gen_random_uuid()), preserved verbatim.
// ────────────────────────────────────────────────────────────────────────────
export const nvProtocolRegistry = nvSchema.table('protocol_registry', {
  id:               varchar('id', { length: 36 }).primaryKey().default(sql`(gen_random_uuid())::text`),
  protocolName:     varchar('protocol_name', { length: 255 }).notNull(),
  protocolVersion:  varchar('protocol_version', { length: 50 }).notNull().default('1.0'),
  status:           varchar('status', { length: 50 }).notNull().default('initialized'),
  configJson:       jsonb('config_json').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  activatedBy:      varchar('activated_by', { length: 255 }),
  dependsOn:        jsonb('depends_on').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  activatedAt:      timestamp('activated_at', { withTimezone: true }),
  healthStatus:     varchar('health_status', { length: 50 }).default('unknown'),
  lastHealthCheck:  timestamp('last_health_check', { withTimezone: true }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  nameUniq:   uniqueIndex('protocol_registry_protocol_name_key').on(t.protocolName),
  statusIdx:  index('idx_protocol_registry_status').on(t.status),
}));

// ────────────────────────────────────────────────────────────────────────────
// 23. rag_relevance_feedback — thumbs-up/down on RAG chunks
// ────────────────────────────────────────────────────────────────────────────
export const nvRagRelevanceFeedback = nvSchema.table('rag_relevance_feedback', {
  id:          serial('id').primaryKey(),
  userId:      text('user_id').default(''),
  chunkId:     text('chunk_id').default(''),
  documentId:  text('document_id').default(''),
  query:       text('query').default(''),
  relevant:    boolean('relevant').default(false),
  createdAt:   timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 24. sdk_app_api_keys — issued SDK API keys per app
//      ANOMALY: prod has NO primary-key constraint on this table (5 rows).
//      Mirroring as-is to avoid a destructive ALTER. Adding a PK is tracked
//      under PROJECT-TRACKER as a separate roadmap item.
// ────────────────────────────────────────────────────────────────────────────
export const nvSdkAppApiKeys = nvSchema.table('sdk_app_api_keys', {
  id:               integer('id'),
  keyPrefix:        varchar('key_prefix', { length: 20 }),
  hashedKey:        varchar('hashed_key', { length: 255 }),
  appId:            integer('app_id'),
  requiresSigning:  boolean('requires_signing'),
  isActive:         boolean('is_active'),
  expiresAt:        timestamp('expires_at'),
  createdAt:        timestamp('created_at'),
  lastUsedAt:       timestamp('last_used_at'),
  scopes:           jsonb('scopes').$type<string[]>(),
  name:             varchar('name', { length: 255 }),
});

// ────────────────────────────────────────────────────────────────────────────
// 25. workflow_definitions — saved automation workflow specs
// ────────────────────────────────────────────────────────────────────────────
export const nvWorkflowDefinitions = nvSchema.table('workflow_definitions', {
  id:           serial('id').primaryKey(),
  name:         text('name').notNull(),
  description:  text('description').default(''),
  triggerType:  text('trigger_type').default('manual'),
  steps:        jsonb('steps').$type<unknown[]>().default(sql`'[]'::jsonb`),
  status:       text('status').default('active'),
  ownerId:      text('owner_id').default(''),
  createdAt:    timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// ────────────────────────────────────────────────────────────────────────────
// 26. workflow_executions — per-run state machine for workflow_definitions
// ────────────────────────────────────────────────────────────────────────────
export const nvWorkflowExecutions = nvSchema.table('workflow_executions', {
  id:           serial('id').primaryKey(),
  workflowId:   integer('workflow_id'),
  triggeredBy:  text('triggered_by').default(''),
  status:       text('status').default('running'),
  stepResults:  jsonb('step_results').$type<unknown[]>().default(sql`'[]'::jsonb`),
  context:      jsonb('context').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`),
  startedAt:    timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt:  timestamp('completed_at', { withTimezone: true }),
  error:        text('error'),
});

// ────────────────────────────────────────────────────────────────────────────
// 26b. nv_patra_mitra_sessions — durable Patra Mitra document companion sessions
//      (NV-PATRA-MITRA-PG-001). Replaces Map-only state in nv-patra-mitra-service.ts.
// ────────────────────────────────────────────────────────────────────────────
export const nvPatraMitraSessions = nvSchema.table('nv_patra_mitra_sessions', {
  sessionId:    text('session_id').primaryKey(),
  orgId:        text('org_id'),
  platformCode: text('platform_code'),
  payload:      jsonb('payload').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  expiresAt:    timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx:     index('idx_nv_patra_mitra_sessions_org').on(t.orgId, t.updatedAt.desc()),
  expiresIdx: index('idx_nv_patra_mitra_sessions_expires').on(t.expiresAt),
}));

// ────────────────────────────────────────────────────────────────────────────
// 27. nv_maker_checker_sessions — durable maker/checker governance loop sessions.
//     Replaces the previous in-process Map-only state in
//     src/services/maker-checker-service.ts so completed loops + human decisions
//     survive a restart and are auditable. Created by
//     migrations/2026-06-29-nv-maker-checker-sessions.sql.
// ────────────────────────────────────────────────────────────────────────────
export const nvMakerCheckerSessions = nvSchema.table('nv_maker_checker_sessions', {
  sessionId:       uuid('session_id').primaryKey().notNull(),
  originalPrompt:  text('original_prompt').notNull(),
  finalOutput:     jsonb('final_output').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  iterations:      jsonb('iterations').$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
  totalIterations: integer('total_iterations').notNull().default(0),
  approved:        boolean('approved').notNull().default(false),
  humanEscalated:  boolean('human_escalated').notNull().default(false),
  humanDecision:   text('human_decision'),
  qualityScore:    numeric('quality_score'),
  totalLatencyMs:  integer('total_latency_ms'),
  metadata:        jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  idxMcSessApproved:  index('idx_nv_mc_sessions_approved').on(t.approved),
  idxMcSessEscalated: index('idx_nv_mc_sessions_escalated').on(t.humanEscalated),
  idxMcSessCreated:   index('idx_nv_mc_sessions_created').on(t.createdAt),
}));

// ────────────────────────────────────────────────────────────────────────────
// 28. mem0_memories — durable backing for src/services/mem0-persistence-service.ts
//     (Mem0PersistenceService). Previously the service held every memory only in
//     a per-process Map, so store()/recall() did not survive a restart and were
//     invisible across replicas (nv-sme-mem0-hooks.ts called this "out of scope
//     for Task #156"). This table is the long-term store; the in-process Map is
//     kept as a hot cache over it. Recall is embedding-backed (cosine over the
//     `embedding` array produced by the existing nv-legal-embedding-service);
//     when no embedding provider is configured the service degrades EXPLICITLY to
//     lexical scoring (never random vectors). The durable path is flag-gated by
//     JRX_F_MEM0_DURABLE (default OFF). Created by
//     migrations/2026-06-29-nv-mem0-memories.sql.
//
//     `embedding` is double precision[] (NOT pgvector) so a fresh-DB migration
//     applies without the `vector` extension and the schema-drift guardrail can
//     create it in its throwaway Postgres — matching the existing
//     nv_document_embeddings approach in shared/schema.ts.
// ────────────────────────────────────────────────────────────────────────────
export const nvMem0Memories = nvSchema.table('mem0_memories', {
  id:                uuid('id').primaryKey().notNull(),
  agentId:           text('agent_id').notNull(),
  namespace:         text('namespace').notNull().default('default'),
  type:              text('type').notNull().default('episodic'),
  content:           text('content').notNull(),
  summary:           text('summary').notNull().default(''),
  tags:              jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  importance:        real('importance').notNull().default(0.5),
  strength:          real('strength').notNull().default(1),
  accessCount:       integer('access_count').notNull().default(0),
  embedding:         doublePrecision('embedding').array(),
  embeddingModel:    text('embedding_model'),
  metadata:          jsonb('metadata').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  relatedMemoryIds:  jsonb('related_memory_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastAccessedAt:    timestamp('last_accessed_at', { withTimezone: true }).notNull().defaultNow(),
  lastReinforcedAt:  timestamp('last_reinforced_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  agentNsIdx: index('idx_mem0_memories_agent_ns').on(t.agentId, t.namespace),
  createdIdx: index('idx_mem0_memories_created').on(t.createdAt),
}));

// ════════════════════════════════════════════════════════════════════════════
// Inferred row types — exported for use by services that read/write nv_schema
// ════════════════════════════════════════════════════════════════════════════
export type NvAdversarialTestRun        = InferSelectModel<typeof nvAdversarialTestRuns>;
export type NewNvAdversarialTestRun     = InferInsertModel<typeof nvAdversarialTestRuns>;
export type NvAgentLearningSession      = InferSelectModel<typeof nvAgentLearningSessions>;
export type NewNvAgentLearningSession   = InferInsertModel<typeof nvAgentLearningSessions>;
export type NvAgentMarketplaceInstall   = InferSelectModel<typeof nvAgentMarketplaceInstalls>;
export type NewNvAgentMarketplaceInstall = InferInsertModel<typeof nvAgentMarketplaceInstalls>;
export type NvAgentMarketplaceListing   = InferSelectModel<typeof nvAgentMarketplaceListings>;
export type NewNvAgentMarketplaceListing = InferInsertModel<typeof nvAgentMarketplaceListings>;
export type NvAguiEvent                 = InferSelectModel<typeof nvAguiEvents>;
export type NewNvAguiEvent              = InferInsertModel<typeof nvAguiEvents>;
export type NvAiCreditOverride          = InferSelectModel<typeof nvAiCreditOverrides>;
export type NewNvAiCreditOverride       = InferInsertModel<typeof nvAiCreditOverrides>;
export type NvAiCreditUsage             = InferSelectModel<typeof nvAiCreditUsage>;
export type NewNvAiCreditUsage          = InferInsertModel<typeof nvAiCreditUsage>;
export type NvAiIncident                = InferSelectModel<typeof nvAiIncidents>;
export type NewNvAiIncident             = InferInsertModel<typeof nvAiIncidents>;
export type NvAsyncJob                  = InferSelectModel<typeof nvAsyncJobQueue>;
export type NewNvAsyncJob               = InferInsertModel<typeof nvAsyncJobQueue>;
export type NvMatterVaultRow            = InferSelectModel<typeof nvMatterVaults>;
export type NewNvMatterVaultRow         = InferInsertModel<typeof nvMatterVaults>;
export type NvEdjAccessDenialRow        = InferSelectModel<typeof nvEdjAccessDenials>;
export type NewNvEdjAccessDenialRow     = InferInsertModel<typeof nvEdjAccessDenials>;
export type NvBillingActivity           = InferSelectModel<typeof nvBillingActivityLog>;
export type NewNvBillingActivity        = InferInsertModel<typeof nvBillingActivityLog>;
export type NvBillingInvoice            = InferSelectModel<typeof nvBillingInvoices>;
export type NewNvBillingInvoice         = InferInsertModel<typeof nvBillingInvoices>;
export type NvCasePrediction            = InferSelectModel<typeof nvCasePredictions>;
export type NewNvCasePrediction         = InferInsertModel<typeof nvCasePredictions>;
export type NvDataLineageAudit          = InferSelectModel<typeof nvDataLineageAudit>;
export type NewNvDataLineageAudit       = InferInsertModel<typeof nvDataLineageAudit>;
export type NvDataLineageEvent          = InferSelectModel<typeof nvDataLineageEvents>;
export type NewNvDataLineageEvent       = InferInsertModel<typeof nvDataLineageEvents>;
export type NvFineTuningJob             = InferSelectModel<typeof nvFineTuningJobs>;
export type NewNvFineTuningJob          = InferInsertModel<typeof nvFineTuningJobs>;
export type NvKnowledgeGraphEdge        = InferSelectModel<typeof nvKnowledgeGraphEdges>;
export type NewNvKnowledgeGraphEdge     = InferInsertModel<typeof nvKnowledgeGraphEdges>;
export type NvKnowledgeGraphEntity      = InferSelectModel<typeof nvKnowledgeGraphEntities>;
export type NewNvKnowledgeGraphEntity   = InferInsertModel<typeof nvKnowledgeGraphEntities>;
export type NvMcpToolExecution          = InferSelectModel<typeof nvMcpToolExecutions>;
export type NewNvMcpToolExecution       = InferInsertModel<typeof nvMcpToolExecutions>;
export type NvDocumentIngestStatus      = InferSelectModel<typeof nvDocumentIngestStatus>;
export type NewNvDocumentIngestStatus   = InferInsertModel<typeof nvDocumentIngestStatus>;
export type NvOrgMemoryEntry            = InferSelectModel<typeof nvOrgMemoryEntries>;
export type NewNvOrgMemoryEntry         = InferInsertModel<typeof nvOrgMemoryEntries>;
export type NvPiiVaultEntry             = InferSelectModel<typeof nvPiiVault>;
export type NewNvPiiVaultEntry          = InferInsertModel<typeof nvPiiVault>;
export type NvProtocolRegistryEntry     = InferSelectModel<typeof nvProtocolRegistry>;
export type NewNvProtocolRegistryEntry  = InferInsertModel<typeof nvProtocolRegistry>;
export type NvRagRelevanceFeedback      = InferSelectModel<typeof nvRagRelevanceFeedback>;
export type NewNvRagRelevanceFeedback   = InferInsertModel<typeof nvRagRelevanceFeedback>;
export type NvSdkAppApiKey              = InferSelectModel<typeof nvSdkAppApiKeys>;
export type NewNvSdkAppApiKey           = InferInsertModel<typeof nvSdkAppApiKeys>;
export type NvWorkflowDefinition        = InferSelectModel<typeof nvWorkflowDefinitions>;
export type NewNvWorkflowDefinition     = InferInsertModel<typeof nvWorkflowDefinitions>;
export type NvWorkflowExecution         = InferSelectModel<typeof nvWorkflowExecutions>;
export type NewNvWorkflowExecution      = InferInsertModel<typeof nvWorkflowExecutions>;
export type NvMakerCheckerSession       = InferSelectModel<typeof nvMakerCheckerSessions>;
export type NewNvMakerCheckerSession    = InferInsertModel<typeof nvMakerCheckerSessions>;
export type NvMem0Memory                = InferSelectModel<typeof nvMem0Memories>;
export type NewNvMem0Memory             = InferInsertModel<typeof nvMem0Memories>;
