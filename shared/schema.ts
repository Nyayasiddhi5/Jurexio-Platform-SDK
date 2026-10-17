/**
 * Jurexio Platform 3.1.2 — Shared Schema
 * Drizzle ORM table definitions for all SDK and platform tables
 */

import { pgTable, pgSchema, serial, text, varchar, integer, boolean, timestamp, date, jsonb, real, doublePrecision, uuid, index, uniqueIndex, bigserial, bigint, primaryKey } from 'drizzle-orm/pg-core';
import { sql, InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ── nv_schema namespace ───────────────────────────────────────────────────────
// The platform uses a dedicated `nv_schema` Postgres schema for governance,
// audit, and PII-vault tables that are written to by middleware on the hot path.
// Tables in this namespace MUST NOT collide with public-schema tables of the
// same name (e.g. public.nv_audit_logs already exists with a different shape).
export const nvSchema = pgSchema('nv_schema');

// ── Core Infrastructure Tables ──────────────────────────────────────────────

export const nvUsers = pgTable('nv_users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).unique().notNull(),
  passwordHash: varchar('password_hash', { length: 255 }),
  fullName: varchar('full_name', { length: 255 }),
  role: varchar('role', { length: 50 }).notNull().default('user'),
  tier: varchar('tier', { length: 50 }).notNull().default('solo'),
  orgId: integer('org_id'),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  emailIdx: uniqueIndex('nv_users_email_idx').on(table.email),
  roleIdx: index('nv_users_role_idx').on(table.role),
  orgIdIdx: index('nv_users_org_id_idx').on(table.orgId),
}));

export const nvOrganizations = pgTable('nv_organizations', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).unique().notNull(),
  tier: varchar('tier', { length: 50 }).notNull().default('pro'),
  isActive: boolean('is_active').notNull().default(true),
  settings: jsonb('settings').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  slugIdx: uniqueIndex('nv_organizations_slug_idx').on(table.slug),
  tierIdx: index('nv_organizations_tier_idx').on(table.tier),
}));

export const nvSessions = pgTable('nv_sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: integer('user_id').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at').notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('nv_sessions_user_id_idx').on(table.userId),
  expiresAtIdx: index('nv_sessions_expires_at_idx').on(table.expiresAt),
}));

export const nvAuthTokens = pgTable('nv_auth_tokens', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  tokenHash: varchar('token_hash', { length: 255 }).unique().notNull(),
  tokenType: varchar('token_type', { length: 50 }).notNull().default('access'),
  isRevoked: boolean('is_revoked').notNull().default(false),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('nv_auth_tokens_user_id_idx').on(table.userId),
  tokenTypeIdx: index('nv_auth_tokens_token_type_idx').on(table.tokenType),
}));

export const nvVoiceSessions = pgTable('nv_voice_sessions', {
  id: serial('id').primaryKey(),
  sessionId: varchar('session_id', { length: 36 }).unique().notNull(),
  userId: integer('user_id'),
  language: varchar('language', { length: 20 }).default('en-IN'),
  provider: varchar('provider', { length: 50 }),
  durationMs: integer('duration_ms'),
  transcriptText: text('transcript_text'),
  wordCount: integer('word_count'),
  confidence: real('confidence'),
  status: varchar('status', { length: 50 }).default('active'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  userIdIdx: index('nv_voice_sessions_user_id_idx').on(table.userId),
  statusIdx: index('nv_voice_sessions_status_idx').on(table.status),
}));

// ── Customer Sub-Org Tables ─────────────────────────────────────────────────
// Task #343: two-tier tenancy. `sdk_applications` is the PLATFORM
// (NSP/NSPM/NSI/NSA/NSM/NYM/JRX); `nv_customer_organizations` is the
// downstream tenant of that platform (e.g. "Sharma & Co Law Firm").
// Asserted on every SDK call via the `X-Customer-Org-Id` header and
// auto-provisioned on first sighting.
export const nvCustomerOrganizations = pgTable('nv_customer_organizations', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  // Task #385 (2026-05-14): FK + NOT NULL enforced at the DB level by
  // migration 0015_customer_org_platform_fk.sql. The DB now structurally
  // rejects both NULL and orphan platform bindings; without this, a
  // future bad insert could land a customer org pointing at a
  // non-existent SDK application and bypass the (platform_id,
  // customer_org_id) RLS partitioning installed by 0013.
  platformId: integer('platform_id').notNull().references(() => sdkApplications.id, {
    onDelete: 'restrict',
    onUpdate: 'cascade',
  }),
  externalRef: varchar('external_ref', { length: 128 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  jurisdiction: varchar('jurisdiction', { length: 10 }).default('IN'),
  tier: varchar('tier', { length: 50 }).default('standard'),
  dataResidency: varchar('data_residency', { length: 20 }).default('IN'),
  status: varchar('status', { length: 20 }).default('active'),
  // Tier-2 per-row overrides (drizzle/0016_billing_tiers.sql). NULL = inherit
  // from CUSTOMER_ORG_TIERS[tier] in src/config/jrx-billing-tiers.ts.
  rateLimitPerMinute: integer('rate_limit_per_minute'),
  dailyTokenBudget: integer('daily_token_budget'),
  monthlyTokenBudget: integer('monthly_token_budget'),
  allowedAgents: jsonb('allowed_agents').$type<string[]>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  // Task #384: nullable convenience back-pointer to nv_super_orgs.id when
  // this customer org belongs to an enterprise super-org grouping. The
  // membership table (nv_super_org_platform_memberships) is the source of
  // truth; this column is a denormalisation maintained best-effort by the
  // super-org admin route layer. See drizzle/0017_super_orgs.sql.
  superOrgId: bigint('super_org_id', { mode: 'number' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  platformRefUniq: uniqueIndex('nv_customer_organizations_platform_ref_uniq')
    .on(table.platformId, table.externalRef),
  platformIdx: index('idx_nv_customer_orgs_platform').on(table.platformId),
  statusIdx: index('idx_nv_customer_orgs_status').on(table.status),
  tierIdx: index('nv_customer_organizations_tier_idx').on(table.tier),
  superOrgIdx: index('idx_nv_customer_orgs_super_org').on(table.superOrgId),
}));

export type NvCustomerOrganization = InferSelectModel<typeof nvCustomerOrganizations>;
export type InsertNvCustomerOrganization = InferInsertModel<typeof nvCustomerOrganizations>;

// ── Super-Org (Enterprise multi-product grouping) ───────────────────────────
// Task #384: lets ONE enterprise customer (e.g. "ACME Enterprise") buy
// multiple platforms (NSP + NSI + NSM) under ONE login / ONE bill / ONE
// admin console while keeping per-platform RLS isolation intact. The
// existing customer_org_isolation policy in
// drizzle/0013_customer_org_rls.sql is INTENTIONALLY UNCHANGED — super-org
// is a grouping/UI/billing layer, NOT a security boundary. Per-platform
// rate limits and access scopes continue to be enforced at
// (platform_id, customer_org_id). Backed by drizzle/0017_super_orgs.sql.
export const nvSuperOrgs = pgTable('nv_super_orgs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 128 }).notNull(),
  billingEmail: varchar('billing_email', { length: 320 }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  metadata: jsonb('metadata').$type<Record<string, any>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  slugUniq: uniqueIndex('nv_super_orgs_slug_uniq').on(table.slug),
  statusIdx: index('idx_nv_super_orgs_status').on(table.status),
}));

export type NvSuperOrg = InferSelectModel<typeof nvSuperOrgs>;
export type InsertNvSuperOrg = InferInsertModel<typeof nvSuperOrgs>;

// (super_org_id, platform_id, customer_org_id) — composite PK as called for
// in task #384. The (platform_id, customer_org_id) uniqueness across all
// super-orgs is enforced by a separate unique index in the migration.
export const nvSuperOrgPlatformMemberships = pgTable('nv_super_org_platform_memberships', {
  superOrgId: bigint('super_org_id', { mode: 'number' }).notNull()
    .references(() => nvSuperOrgs.id, { onDelete: 'cascade' }),
  platformId: integer('platform_id').notNull(),
  customerOrgId: bigint('customer_org_id', { mode: 'number' }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, any>>().notNull().default({}),
}, (table) => ({
  pk: primaryKey({ columns: [table.superOrgId, table.platformId, table.customerOrgId] }),
  tenantUniq: uniqueIndex('nv_super_org_memberships_tenant_uniq')
    .on(table.platformId, table.customerOrgId),
  superOrgIdx: index('idx_nv_super_org_memberships_super_org').on(table.superOrgId),
}));

export type NvSuperOrgMembership = InferSelectModel<typeof nvSuperOrgPlatformMemberships>;
export type InsertNvSuperOrgMembership = InferInsertModel<typeof nvSuperOrgPlatformMemberships>;

// ── SDK Application Tables ──────────────────────────────────────────────────

export const sdkApplications = pgTable('sdk_applications', {
  id: serial('id').primaryKey(),
  // Task #378 (2026-05-14): FK + NOT NULL enforced at the DB level by
  // migration 0014_sdk_applications_org_fk.sql. The DB now structurally
  // rejects both invalid AND missing org bindings; the runtime fail-closed
  // guard `sdk_application_missing_org_binding` in src/middleware/jrx-sdk-gateway.ts
  // remains as defence-in-depth.
  organizationId: integer('organization_id').notNull().references(() => nvOrganizations.id, {
    onDelete: 'restrict',
    onUpdate: 'cascade',
  }),
  appName: varchar('app_name', { length: 255 }).notNull(),
  appType: varchar('app_type', { length: 100 }).notNull(),
  description: text('description'),
  clientId: varchar('client_id', { length: 100 }).unique().notNull(),
  clientSecretHash: varchar('client_secret_hash', { length: 255 }).notNull(),
  clientSecretPrefix: varchar('client_secret_prefix', { length: 20 }),
  allowedAgents: jsonb('allowed_agents').$type<string[]>().default([]),
  llmConfig: jsonb('llm_config').$type<Record<string, any>>().default({}),
  rateLimitPerMinute: integer('rate_limit_per_minute').default(60),
  dailyTokenBudget: integer('daily_token_budget').default(100000),
  monthlyTokenBudget: integer('monthly_token_budget').default(1000000),
  // Tier-0: this platform's billing contract with Jurexio. Resolves to
  // PLATFORM_TIERS[platformTier] in src/config/jrx-billing-tiers.ts.
  // Added by drizzle/0016_billing_tiers.sql.
  platformTier: varchar('platform_tier', { length: 50 }).notNull().default('standard'),
  allowedOrigins: jsonb('allowed_origins').$type<string[]>().default([]),
  jurisdiction: varchar('jurisdiction', { length: 10 }).default('IN'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  status: varchar('status', { length: 50 }).default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sdkAppApiKeys = pgTable('sdk_app_api_keys', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id'),
  keyHash: varchar('key_hash', { length: 255 }).unique().notNull(),
  keyPrefix: varchar('key_prefix', { length: 20 }).notNull(),
  name: varchar('name', { length: 255 }),
  scopes: jsonb('scopes').$type<string[]>().default([]),
  isActive: boolean('is_active').default(true),
  lastUsedAt: timestamp('last_used_at'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sdkAppAgentAllocations = pgTable('sdk_app_agent_allocations', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id'),
  agentId: varchar('agent_id', { length: 100 }).notNull(),
  agentName: varchar('agent_name', { length: 255 }),
  practiceArea: varchar('practice_area', { length: 100 }),
  priority: integer('priority').default(5),
  dailyTokenLimit: integer('daily_token_limit'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sdkApiRequestLogs = pgTable('sdk_api_request_logs', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id'),
  apiKeyId: integer('api_key_id'),
  customerOrgId: bigint('customer_org_id', { mode: 'number' }),
  endpoint: varchar('endpoint', { length: 500 }),
  method: varchar('method', { length: 10 }),
  statusCode: integer('status_code'),
  latencyMs: integer('latency_ms'),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  agentId: varchar('agent_id', { length: 100 }),
  requestId: varchar('request_id', { length: 36 }),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sdkClauseLibrary = pgTable('sdk_clause_library', {
  id: serial('id').primaryKey(),
  clauseId: varchar('clause_id', { length: 100 }).unique().notNull(),
  title: varchar('title', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  description: text('description'),
  defaultText: text('default_text'),
  jurisdictionVariants: jsonb('jurisdiction_variants').$type<Record<string, any>>().default({}),
  tags: jsonb('tags').$type<string[]>().default([]),
  risk: varchar('risk', { length: 50 }),
  popularity: integer('popularity').default(0),
  version: varchar('version', { length: 20 }).default('1.0'),
  isSystem: boolean('is_system').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sdkComplianceControls = pgTable('sdk_compliance_controls', {
  id: serial('id').primaryKey(),
  controlId: varchar('control_id', { length: 100 }).unique().notNull(),
  framework: varchar('framework', { length: 100 }),
  jurisdiction: varchar('jurisdiction', { length: 50 }),
  title: varchar('title', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  severity: varchar('severity', { length: 50 }),
  requirements: jsonb('requirements').$type<string[]>().default([]),
  automationLevel: varchar('automation_level', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sdkDocumentTemplates = pgTable('sdk_document_templates', {
  id: serial('id').primaryKey(),
  templateId: varchar('template_id', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  category: varchar('category', { length: 100 }),
  jurisdiction: varchar('jurisdiction', { length: 50 }),
  languages: jsonb('languages').$type<string[]>().default([]),
  version: varchar('version', { length: 20 }).default('1.0'),
  isSystem: boolean('is_system').default(false),
  content: text('content'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sdkUsageMetering = pgTable('sdk_usage_metering', {
  id: serial('id').primaryKey(),
  applicationId: integer('application_id'),
  customerOrgId: bigint('customer_org_id', { mode: 'number' }),
  agentId: varchar('agent_id', { length: 100 }),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  tokensCacheRead: integer('tokens_cache_read').notNull().default(0),
  tokensCacheWrite: integer('tokens_cache_write').notNull().default(0),
  costUsd: real('cost_usd').default(0),
  period: varchar('period', { length: 20 }),
  requestCount: integer('request_count').default(0),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const sdkWorkflows = pgTable('sdk_workflows', {
  id: serial('id').primaryKey(),
  workflowId: varchar('workflow_id', { length: 100 }).notNull(),
  applicationId: integer('application_id'),
  customerOrgId: bigint('customer_org_id', { mode: 'number' }),
  organizationId: integer('organization_id'),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  workflowType: varchar('workflow_type', { length: 100 }),
  definition: jsonb('definition').$type<Record<string, any>>().default({}),
  steps: jsonb('steps').$type<Array<{ index: number; action: string; params?: Record<string, any> }>>().default([]),
  triggers: jsonb('triggers').$type<any[]>().default([]),
  jurisdiction: varchar('jurisdiction', { length: 20 }).default('IN'),
  status: varchar('status', { length: 50 }).default('created'),
  version: integer('version').default(1),
  createdBy: varchar('created_by', { length: 100 }),
  scheduleConfig: jsonb('schedule_config').$type<Record<string, any>>(),
  isActive: boolean('is_active').default(true),
  deletedAt: timestamp('deleted_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const sdkWorkflowExecutions = pgTable('sdk_workflow_executions', {
  id: serial('id').primaryKey(),
  executionId: varchar('execution_id', { length: 100 }).notNull(),
  workflowId: varchar('workflow_id', { length: 100 }),
  applicationId: integer('application_id'),
  customerOrgId: bigint('customer_org_id', { mode: 'number' }),
  organizationId: integer('organization_id'),
  executionMode: varchar('execution_mode', { length: 20 }).default('async'),
  status: varchar('status', { length: 50 }).default('pending'),
  input: jsonb('input').$type<Record<string, any>>().default({}),
  output: jsonb('output').$type<Record<string, any>>().default({}),
  error: text('error'),
  stepsCompleted: integer('steps_completed').default(0),
  totalSteps: integer('total_steps').default(0),
  duration: integer('duration_ms'),
  tokensUsed: integer('tokens_used').default(0),
  estimatedCost: varchar('estimated_cost', { length: 32 }),
  executedBy: varchar('executed_by', { length: 100 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Document Pipeline Tables ──────────────────────────────────────────────

export const documentParsing = pgTable('document_parsing', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  filename: varchar('filename', { length: 500 }),
  originalFilename: varchar('original_filename', { length: 500 }),
  mimeType: varchar('mime_type', { length: 100 }),
  fileSize: integer('file_size'),
  pageCount: integer('page_count'),
  language: varchar('language', { length: 10 }),
  status: varchar('status', { length: 50 }).default('pending'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const documentPages = pgTable('document_pages', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id'),
  pageNumber: integer('page_number'),
  text: text('text'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const documentExtractedContent = pgTable('document_extracted_content', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id'),
  contentType: varchar('content_type', { length: 100 }),
  content: text('content'),
  confidence: real('confidence'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const documentProcessingJobs = pgTable('document_processing_jobs', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id'),
  jobType: varchar('job_type', { length: 100 }),
  status: varchar('status', { length: 50 }).default('pending'),
  priority: integer('priority').default(5),
  result: jsonb('result').$type<Record<string, any>>().default({}),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── HITL Workflow Tables ───────────────────────────────────────────────────

export const hitlWorkflows = pgTable('hitl_workflows', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  ownerId: varchar('owner_id', { length: 100 }),
  workflowType: varchar('workflow_type', { length: 100 }),
  steps: jsonb('steps').$type<any[]>().default([]),
  triggerConditions: jsonb('trigger_conditions').$type<any[]>().default([]),
  requiredApprovers: jsonb('required_approvers').$type<string[]>().default([]),
  escalationTimeoutMinutes: integer('escalation_timeout_minutes').default(60),
  autoApproveThreshold: real('auto_approve_threshold'),
  requireReviewThreshold: real('require_review_threshold'),
  isActive: boolean('is_active').default(true),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const hitlWorkflowExecutions = pgTable('hitl_workflow_executions', {
  id: serial('id').primaryKey(),
  workflowId: integer('workflow_id'),
  triggeredBy: varchar('triggered_by', { length: 100 }),
  triggerType: varchar('trigger_type', { length: 100 }),
  triggerContext: jsonb('trigger_context').$type<Record<string, any>>().default({}),
  agentConfidence: real('agent_confidence'),
  status: varchar('status', { length: 50 }).default('pending'),
  currentStepId: varchar('current_step_id', { length: 100 }),
  approvals: jsonb('approvals').$type<any[]>().default([]),
  result: jsonb('result').$type<Record<string, any>>().default({}),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Email Automation Tables ────────────────────────────────────────────────

export const waiEmailAccounts = pgTable('wai_email_accounts', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }),
  organizationId: integer('organization_id'),
  provider: varchar('provider', { length: 50 }),
  email: varchar('email', { length: 255 }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  tokenExpiresAt: timestamp('token_expires_at'),
  imapHost: varchar('imap_host', { length: 255 }),
  isActive: boolean('is_active').default(true),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const waiEmails = pgTable('wai_emails', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id'),
  messageId: varchar('message_id', { length: 255 }),
  subject: text('subject'),
  fromAddress: varchar('from_address', { length: 255 }),
  toAddresses: jsonb('to_addresses').$type<string[]>().default([]),
  body: text('body'),
  isRead: boolean('is_read').default(false),
  isProcessed: boolean('is_processed').default(false),
  receivedAt: timestamp('received_at'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const waiEmailProcessing = pgTable('wai_email_processing', {
  id: serial('id').primaryKey(),
  emailId: integer('email_id'),
  processingType: varchar('processing_type', { length: 100 }),
  status: varchar('status', { length: 50 }).default('pending'),
  result: jsonb('result').$type<Record<string, any>>().default({}),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const waiEmailAutomationRules = pgTable('wai_email_automation_rules', {
  id: serial('id').primaryKey(),
  accountId: integer('account_id'),
  name: varchar('name', { length: 255 }),
  conditions: jsonb('conditions').$type<any[]>().default([]),
  actions: jsonb('actions').$type<any[]>().default([]),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const waiEmailResponses = pgTable('wai_email_responses', {
  id: serial('id').primaryKey(),
  emailId: integer('email_id'),
  responseText: text('response_text'),
  agentId: varchar('agent_id', { length: 100 }),
  status: varchar('status', { length: 50 }).default('draft'),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Context Engineering Tables ─────────────────────────────────────────────

export const jurexioFounderContextProfiles = pgTable('jurexio_founder_context_profiles', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }),
  profileData: jsonb('profile_data').$type<Record<string, any>>().default({}),
  contextVersion: integer('context_version').default(1),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const jurexioContextLearningHistory = pgTable('jurexio_context_learning_history', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }),
  sessionId: varchar('session_id', { length: 100 }),
  contextData: jsonb('context_data').$type<Record<string, any>>().default({}),
  outcome: varchar('outcome', { length: 100 }),
  feedback: jsonb('feedback').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Orchestration Tables ───────────────────────────────────────────────────

export const jurexioOrchestrationJobs = pgTable('jurexio_orchestration_jobs', {
  id: serial('id').primaryKey(),
  jobType: varchar('job_type', { length: 100 }),
  status: varchar('status', { length: 50 }).default('pending'),
  input: jsonb('input').$type<Record<string, any>>().default({}),
  output: jsonb('output').$type<Record<string, any>>().default({}),
  agentId: varchar('agent_id', { length: 100 }),
  userId: integer('user_id'),
  error: text('error'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Inferred Types ─────────────────────────────────────────────────────────

export type HitlWorkflow = InferSelectModel<typeof hitlWorkflows>;
export type HitlWorkflowExecution = InferSelectModel<typeof hitlWorkflowExecutions>;

export type InsertDocumentParsing = InferInsertModel<typeof documentParsing>;
export type InsertDocumentPage = InferInsertModel<typeof documentPages>;
export type InsertDocumentExtractedContent = InferInsertModel<typeof documentExtractedContent>;
export type InsertDocumentProcessingJob = InferInsertModel<typeof documentProcessingJobs>;

export type InsertJurexioFounderContextProfile = InferInsertModel<typeof jurexioFounderContextProfiles>;
export type InsertJurexioContextLearningHistory = InferInsertModel<typeof jurexioContextLearningHistory>;

export type OrchestrationJobType = typeof jurexioOrchestrationJobs.$inferInsert;

// ── Legal Agents Table ────────────────────────────────────────────────────

export const legalAgents = pgTable('legal_agents', {
  id: serial('id').primaryKey(),
  agentId: varchar('agent_id', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  version: varchar('version', { length: 50 }).default('2.0.0'),
  tier: varchar('tier', { length: 50 }).default('solo'),
  romaLevel: varchar('roma_level', { length: 10 }).default('L2'),
  category: varchar('category', { length: 100 }).notNull(),
  practiceArea: varchar('practice_area', { length: 100 }),
  description: text('description'),
  systemPrompt: text('system_prompt').default(''),
  capabilities: text('capabilities').array().default([]),
  tools: text('tools').array().default([]),
  protocols: text('protocols').array().default([]),
  preferredModels: text('preferred_models').array().default([]),
  fallbackModels: text('fallback_models').array().default([]),
  operationModes: jsonb('operation_modes').$type<Record<string, any>>().default({}),
  securityLevel: varchar('security_level', { length: 50 }).default('standard'),
  reportsTo: text('reports_to').array().default([]),
  manages: text('manages').array().default([]),
  collaboratesWith: text('collaborates_with').array().default([]),
  supportedLanguages: text('supported_languages').array().default([]),
  guardrails: jsonb('guardrails').$type<Record<string, any>>().default({}),
  costOptimization: jsonb('cost_optimization').$type<Record<string, any>>().default({}),
  jurisdictions: text('jurisdictions').array().default([]),
  indianLawSupport: jsonb('indian_law_support').$type<Record<string, any>>().default({}),
  saudiLawSupport: jsonb('saudi_law_support').$type<Record<string, any>>().default({}),
  singaporeLawSupport: jsonb('singapore_law_support').$type<Record<string, any>>().default({}),
  uaeLawSupport: jsonb('uae_law_support').$type<Record<string, any>>().default({}),
  usaLawSupport: jsonb('usa_law_support').$type<Record<string, any>>().default({}),
  europeLawSupport: jsonb('europe_law_support').$type<Record<string, any>>().default({}),
  status: varchar('status', { length: 50 }).default('active'),
  isEnabled: boolean('is_enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Feature Flags Table (scoped) ──────────────────────────────────────────

export const featureFlags = pgTable('scoped_feature_flags', {
  id: serial('id').primaryKey(),
  flagKey: varchar('flag_key', { length: 200 }).notNull(),
  scope: varchar('scope', { length: 50 }).default('global'),
  scopeId: varchar('scope_id', { length: 100 }).default('_global'),
  isEnabled: boolean('is_enabled').default(false),
  description: text('description'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export type FeatureFlag = InferSelectModel<typeof featureFlags>;
export type InsertFeatureFlag = InferInsertModel<typeof featureFlags>;

// ── Case Management Tables ────────────────────────────────────────────────

export const cases = pgTable('nv_cases', {
  id: serial('id').primaryKey(),
  caseNumber: varchar('case_number', { length: 100 }),
  title: varchar('title', { length: 500 }).notNull(),
  description: text('description'),
  caseType: varchar('case_type', { length: 100 }),
  jurisdiction: varchar('jurisdiction', { length: 200 }),
  courtName: varchar('court_name', { length: 255 }),
  status: varchar('status', { length: 50 }).default('open'),
  priority: varchar('priority', { length: 50 }).default('normal'),
  userId: integer('user_id'),
  organizationId: integer('organization_id'),
  lawyerId: integer('lawyer_id'),
  applicableSections: jsonb('applicable_sections').$type<string[]>().default([]),
  parties: jsonb('parties').$type<Record<string, any>[]>().default([]),
  clientDetails: jsonb('client_details').$type<Record<string, any>>().default({}),
  tags: text('tags').array().default([]),
  insightsGeneratedAt: timestamp('insights_generated_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const caseDocuments = pgTable('nv_case_documents', {
  id: serial('id').primaryKey(),
  caseId: integer('case_id').notNull(),
  documentId: integer('document_id'),
  addedBy: integer('added_by'),
  documentRole: varchar('document_role', { length: 100 }).default('supporting'),
  summary: text('summary'),
  extractedEntities: jsonb('extracted_entities').$type<Record<string, any>>().default({}),
  source: varchar('source', { length: 100 }).default('upload'),
  notes: text('notes'),
  version: integer('version').default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const caseInsights = pgTable('nv_case_insights', {
  id: serial('id').primaryKey(),
  caseId: integer('case_id').notNull(),
  insightType: varchar('insight_type', { length: 100 }),
  title: varchar('title', { length: 500 }),
  content: text('content'),
  confidence: real('confidence').default(0.8),
  sources: jsonb('sources').$type<number[]>().default([]),
  agentId: varchar('agent_id', { length: 100 }),
  orchestrationMetadata: jsonb('orchestration_metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Identity Extractions Table ────────────────────────────────────────────

export const identityExtractions = pgTable('nv_identity_extractions', {
  id: serial('id').primaryKey(),
  userId: integer('user_id'),
  organizationId: integer('organization_id'),
  documentId: integer('document_id'),
  documentType: varchar('document_type', { length: 100 }),
  extractedFields: jsonb('extracted_fields').$type<Record<string, any>>().default({}),
  confidence: real('confidence').default(0.8),
  status: varchar('status', { length: 50 }).default('extracted'),
  agentId: varchar('agent_id', { length: 100 }),
  orchestrationMetadata: jsonb('orchestration_metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Document Embeddings Table (RAG) ───────────────────────────────────────

export const documentEmbeddings = pgTable('nv_document_embeddings', {
  id: serial('id').primaryKey(),
  documentId: integer('document_id'),
  chunkId: varchar('chunk_id', { length: 100 }),
  userId: varchar('user_id', { length: 100 }),
  assistantId: integer('assistant_id'),
  text: text('text'),
  textHash: varchar('text_hash', { length: 64 }),
  embedding: doublePrecision('embedding').array(),
  model: varchar('model', { length: 100 }),
  provider: varchar('provider', { length: 100 }),
  dimensions: integer('dimensions'),
  chunkIndex: integer('chunk_index'),
  startPosition: integer('start_position'),
  endPosition: integer('end_position'),
  wordCount: integer('word_count'),
  characterCount: integer('character_count'),
  documentType: varchar('document_type', { length: 100 }),
  sourceFileName: varchar('source_file_name', { length: 500 }),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  tags: text('tags').array().default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ═════════════════════════════════════════════════════════════════════════════
// SPRINT 3 — BILLING, CREDITS, SUBSCRIPTIONS, AI ACTIVITY, COMPLIANCE TABLES
// Added per Audit Finding DB001: 12 production tables missing from Drizzle schema
// ═════════════════════════════════════════════════════════════════════════════

import { pgEnum } from 'drizzle-orm/pg-core';

// ── Enums ─────────────────────────────────────────────────────────────────────
export const subscriptionStatusEnum = pgEnum('subscription_status', ['TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'PAUSED']);
export const subscriptionPlanEnum = pgEnum('subscription_plan', ['SOLO', 'PLUS', 'PRO', 'INSTITUTIONAL', 'ENTERPRISE']);
export const creditTransactionTypeEnum = pgEnum('credit_transaction_type', ['CREDIT_TOPUP', 'CREDIT_USAGE', 'CREDIT_REFUND', 'CREDIT_EXPIRY', 'CREDIT_BONUS', 'CREDIT_TRANSFER']);
export const paymentStatusEnum = pgEnum('payment_status', ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'REFUNDED', 'CANCELLED']);
export const aiActivityTypeEnum = pgEnum('ai_activity_type', ['PATTERN_CALL', 'RAG_QUERY', 'AGENT_DISPATCH', 'DOCUMENT_ANALYSIS', 'VOICE_CALL', 'KNOWLEDGE_QUERY', 'GRPO_EVAL']);
export const caseUpdateTypeEnum = pgEnum('case_update_type', ['STATUS_CHANGE', 'HEARING_SCHEDULED', 'ORDER_PASSED', 'FILING_DONE', 'JUDGMENT', 'NOTICE_RECEIVED']);
export const filingStatusEnum = pgEnum('filing_status', ['DRAFT', 'SUBMITTED', 'ACKNOWLEDGED', 'PROCESSED', 'REJECTED', 'APPEAL_PENDING']);

// ── Subscriptions ─────────────────────────────────────────────────────────────
export const subscriptions = pgTable('nv_subscriptions', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  orgId: varchar('org_id', { length: 100 }),
  plan: subscriptionPlanEnum('plan').notNull().default('SOLO'),
  status: subscriptionStatusEnum('status').notNull().default('TRIAL'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false),
  razorpaySubscriptionId: varchar('razorpay_subscription_id', { length: 200 }),
  razorpayCustomerId: varchar('razorpay_customer_id', { length: 200 }),
  monthlyTokenLimit: integer('monthly_token_limit').default(50000),
  tokensUsedThisPeriod: integer('tokens_used_this_period').default(0),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Credit Wallet ─────────────────────────────────────────────────────────────
export const creditWallet = pgTable('nv_credit_wallet', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  orgId: varchar('org_id', { length: 100 }),
  balanceCredits: integer('balance_credits').notNull().default(0),
  lifetimeEarnedCredits: integer('lifetime_earned_credits').notNull().default(0),
  lifetimeSpentCredits: integer('lifetime_spent_credits').notNull().default(0),
  reservedCredits: integer('reserved_credits').notNull().default(0),
  currency: varchar('currency', { length: 3 }).default('INR'),
  expiresAt: timestamp('expires_at'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Credit Transactions ───────────────────────────────────────────────────────
export const creditTransactions = pgTable('nv_credit_transactions', {
  id: serial('id').primaryKey(),
  walletId: integer('wallet_id').notNull(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  type: creditTransactionTypeEnum('type').notNull(),
  amount: integer('amount').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  description: text('description'),
  referenceId: varchar('reference_id', { length: 200 }),
  referenceType: varchar('reference_type', { length: 50 }),
  patternKey: varchar('pattern_key', { length: 10 }),
  tokensConsumed: integer('tokens_consumed').default(0),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Subscription Events (audit trail) ─────────────────────────────────────────
export const subscriptionEvents = pgTable('nv_subscription_events', {
  id: serial('id').primaryKey(),
  subscriptionId: integer('subscription_id').notNull(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  previousPlan: subscriptionPlanEnum('previous_plan'),
  newPlan: subscriptionPlanEnum('new_plan'),
  previousStatus: subscriptionStatusEnum('previous_status'),
  newStatus: subscriptionStatusEnum('new_status'),
  triggeredBy: varchar('triggered_by', { length: 100 }),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── AI Activity Log ───────────────────────────────────────────────────────────
export const aiActivity = pgTable('nv_ai_activity', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  orgId: varchar('org_id', { length: 100 }),
  sessionId: varchar('session_id', { length: 200 }),
  activityType: aiActivityTypeEnum('activity_type').notNull(),
  patternKey: varchar('pattern_key', { length: 10 }),
  agentId: varchar('agent_id', { length: 100 }),
  jurisdiction: varchar('jurisdiction', { length: 10 }).default('IN'),
  modelProvider: varchar('model_provider', { length: 50 }),
  modelName: varchar('model_name', { length: 100 }),
  inputTokens: integer('input_tokens').default(0),
  outputTokens: integer('output_tokens').default(0),
  latencyMs: integer('latency_ms').default(0),
  creditsCharged: integer('credits_charged').default(0),
  blocked: boolean('blocked').default(false),
  blockReason: text('block_reason'),
  traceId: varchar('trace_id', { length: 100 }),
  // §14.5 MANDATORY fields — SHA-256 audit integrity
  promptHash: varchar('prompt_hash', { length: 64 }),            // SHA-256 of prompt (MANDATORY §14.5)
  riskScore: integer('risk_score').default(0),                   // 0–100 composite risk score
  jurisdictionValidated: boolean('jurisdiction_validated').default(false), // bound to profile
  templateMode: varchar('template_mode', { length: 10 }),        // STRICT | GUIDED | MENTOR
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Case Updates (eCourt + Case Management timeline) ─────────────────────────
export const caseUpdates = pgTable('nv_case_updates', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  caseNumber: varchar('case_number', { length: 200 }).notNull(),
  courtCode: varchar('court_code', { length: 50 }),
  jurisdiction: varchar('jurisdiction', { length: 10 }).default('IN'),
  updateType: caseUpdateTypeEnum('update_type').notNull(),
  summary: text('summary'),
  hearingDate: timestamp('hearing_date'),
  orderDate: timestamp('order_date'),
  judges: text('judges').array().default([]),
  nextHearingDate: timestamp('next_hearing_date'),
  rawData: jsonb('raw_data').$type<Record<string, any>>().default({}),
  notifiedAt: timestamp('notified_at'),
  createdAt: timestamp('created_at').defaultNow(),
  // §4.2 + §14 MANDATORY case management fields
  roleSnapshot: varchar('role_snapshot', { length: 100 }),        // immutable role at time of update
  isBillable: boolean('is_billable').default(false),
  billableMinutes: integer('billable_minutes'),
  linkedInvoiceId: integer('linked_invoice_id'),
  stageBefore: varchar('stage_before', { length: 50 }),
  stageAfter: varchar('stage_after', { length: 50 }),
  isClientVisible: boolean('is_client_visible').default(true),
  confidentialLevel: varchar('confidential_level', { length: 30 }).default('TEAM_VISIBLE'), // TEAM_VISIBLE | ADMIN_ONLY
  ipAddress: varchar('ip_address', { length: 50 }),
  deviceInfo: varchar('device_info', { length: 300 }),
  hashSignature: varchar('hash_signature', { length: 64 }),        // SHA-256 integrity hash (MANDATORY)
  recordStatus: varchar('record_status', { length: 20 }).default('active'), // active | locked | archived
});

// ── Institutional Leads ───────────────────────────────────────────────────────
export const institutionalLeads = pgTable('nv_institutional_leads', {
  id: serial('id').primaryKey(),
  orgName: varchar('org_name', { length: 300 }).notNull(),
  contactName: varchar('contact_name', { length: 200 }),
  contactEmail: varchar('contact_email', { length: 300 }),
  contactPhone: varchar('contact_phone', { length: 20 }),
  orgType: varchar('org_type', { length: 50 }),
  jurisdiction: varchar('jurisdiction', { length: 10 }).default('IN'),
  userCount: integer('user_count'),
  useCases: text('use_cases').array().default([]),
  stage: varchar('stage', { length: 50 }).default('INQUIRY'),
  assignedTo: varchar('assigned_to', { length: 100 }),
  notes: text('notes'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ── Invoices ──────────────────────────────────────────────────────────────────
export const invoices = pgTable('nv_invoices', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  orgId: varchar('org_id', { length: 100 }),
  invoiceNumber: varchar('invoice_number', { length: 100 }).notNull(),
  subscriptionId: integer('subscription_id'),
  amountInPaise: integer('amount_in_paise').notNull(),
  currency: varchar('currency', { length: 3 }).default('INR'),
  status: paymentStatusEnum('status').notNull().default('PENDING'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  lineItems: jsonb('line_items').$type<any[]>().default([]),
  taxBreakdown: jsonb('tax_breakdown').$type<Record<string, any>>().default({}),
  pdfUrl: text('pdf_url'),
  gstNumber: varchar('gst_number', { length: 20 }),
  billingAddress: jsonb('billing_address').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  paidAt: timestamp('paid_at'),
});

// ── Payments ──────────────────────────────────────────────────────────────────
export const payments = pgTable('nv_payments', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  invoiceId: integer('invoice_id'),
  amountInPaise: integer('amount_in_paise').notNull(),
  currency: varchar('currency', { length: 3 }).default('INR'),
  status: paymentStatusEnum('status').notNull().default('PENDING'),
  gateway: varchar('gateway', { length: 50 }).default('razorpay'),
  gatewayPaymentId: varchar('gateway_payment_id', { length: 200 }),
  gatewayOrderId: varchar('gateway_order_id', { length: 200 }),
  gatewaySignature: varchar('gateway_signature', { length: 500 }),
  failureReason: text('failure_reason'),
  refundId: varchar('refund_id', { length: 200 }),
  refundedAt: timestamp('refunded_at'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  completedAt: timestamp('completed_at'),
});

// ── GRPO Policy Snapshots ─────────────────────────────────────────────────────
export const grpoPolicySnapshots = pgTable('nv_grpo_policy_snapshots', {
  id: serial('id').primaryKey(),
  policySnapshot: jsonb('policy_snapshot').$type<Record<string, any>>().notNull(),
  updateCount: integer('update_count').notNull().default(0),
  averageReward: real('average_reward'),
  groupSize: integer('group_size'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Hearing Metadata ──────────────────────────────────────────────────────────
export const hearingMetadata = pgTable('nv_hearing_metadata', {
  id: serial('id').primaryKey(),
  caseUpdateId: integer('case_update_id'),
  caseNumber: varchar('case_number', { length: 200 }).notNull(),
  courtName: varchar('court_name', { length: 300 }),
  hearingDate: timestamp('hearing_date').notNull(),
  hearingType: varchar('hearing_type', { length: 100 }),
  judges: text('judges').array().default([]),
  advocates: text('advocates').array().default([]),
  hearingNotes: text('hearing_notes'),
  orderPassed: boolean('order_passed').default(false),
  orderSummary: text('order_summary'),
  nextDate: timestamp('next_date'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

// ── Filing Metadata ───────────────────────────────────────────────────────────
export const filingMetadata = pgTable('nv_filing_metadata', {
  id: serial('id').primaryKey(),
  userId: varchar('user_id', { length: 100 }).notNull(),
  caseNumber: varchar('case_number', { length: 200 }),
  courtCode: varchar('court_code', { length: 50 }),
  jurisdiction: varchar('jurisdiction', { length: 10 }).default('IN'),
  filingType: varchar('filing_type', { length: 100 }).notNull(),
  status: filingStatusEnum('status').notNull().default('DRAFT'),
  documentIds: integer('document_ids').array().default([]),
  filedAt: timestamp('filed_at'),
  acknowledgedAt: timestamp('acknowledged_at'),
  cnrNumber: varchar('cnr_number', { length: 50 }),
  stampDutyPaid: boolean('stamp_duty_paid').default(false),
  stampDutyAmount: integer('stamp_duty_amount_paise').default(0),
  rejectionReason: text('rejection_reason'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ══════════════════════════════════════════════════════════════════════════════
// SPRINT 3 TABLES — Customer Products & Platform Governance
// ══════════════════════════════════════════════════════════════════════════════

// ── T06 ClaWdBot ────────────────────────────────────────────────────────────
export const claWdBots = pgTable('nv_clawd_bots', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }).notNull(),
  name:           varchar('name', { length: 120 }).notNull(),
  description:    text('description'),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('IN'),
  channels:       jsonb('channels').$type<string[]>().default([]),
  systemPrompt:   text('system_prompt'),
  persona:        varchar('persona', { length: 60 }).default('professional'),
  status:         varchar('status', { length: 20 }).default('draft'),
  totalChats:     integer('total_chats').default(0),
  config:         jsonb('config').$type<Record<string, any>>().default({}),
  createdBy:      varchar('created_by', { length: 36 }),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

export const claWdConversations = pgTable('nv_clawd_conversations', {
  id:              varchar('id', { length: 36 }).primaryKey(),
  botId:           varchar('bot_id', { length: 36 }).notNull(),
  userId:          varchar('user_id', { length: 36 }),
  channel:         varchar('channel', { length: 30 }).default('web'),
  status:          varchar('status', { length: 20 }).default('open'),
  messages:        jsonb('messages').$type<Array<{ role: string; content: string; ts: string }>>().default([]),
  riskScore:       real('risk_score').default(0),
  escalated:       boolean('escalated').default(false),
  closedAt:        timestamp('closed_at'),
  metadata:        jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:       timestamp('created_at').defaultNow(),
  updatedAt:       timestamp('updated_at').defaultNow(),
});

// ── T09 OpenBot ──────────────────────────────────────────────────────────────
export const openBotAgents = pgTable('nv_openbot_agents', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }).notNull(),
  name:           varchar('name', { length: 120 }).notNull(),
  description:    text('description'),
  agentType:      varchar('agent_type', { length: 40 }).default('research'),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('IN'),
  mcpTools:       jsonb('mcp_tools').$type<string[]>().default([]),
  pattern:        varchar('pattern', { length: 20 }).default('react'),
  systemPrompt:   text('system_prompt'),
  status:         varchar('status', { length: 20 }).default('draft'),
  deployedUrl:    varchar('deployed_url', { length: 255 }),
  config:         jsonb('config').$type<Record<string, any>>().default({}),
  createdBy:      varchar('created_by', { length: 36 }),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

export const openBotTasks = pgTable('nv_openbot_tasks', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  agentId:        varchar('agent_id', { length: 36 }).notNull(),
  prompt:         text('prompt').notNull(),
  status:         varchar('status', { length: 20 }).default('pending'),
  result:         jsonb('result').$type<Record<string, any>>(),
  tokensUsed:     integer('tokens_used').default(0),
  latencyMs:      integer('latency_ms').default(0),
  errorMsg:       text('error_msg'),
  createdAt:      timestamp('created_at').defaultNow(),
  completedAt:    timestamp('completed_at'),
});

// ── T10 AutomateAI ───────────────────────────────────────────────────────────
export const automateWorkflows = pgTable('nv_automate_workflows', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }).notNull(),
  name:           varchar('name', { length: 120 }).notNull(),
  description:    text('description'),
  trigger:        varchar('trigger', { length: 30 }).default('manual'),
  steps:          jsonb('steps').$type<Array<Record<string, any>>>().default([]),
  status:         varchar('status', { length: 20 }).default('draft'),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('IN'),
  runCount:       integer('run_count').default(0),
  lastRunAt:      timestamp('last_run_at'),
  config:         jsonb('config').$type<Record<string, any>>().default({}),
  createdBy:      varchar('created_by', { length: 36 }),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

export const automateExecutions = pgTable('nv_automate_executions', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  workflowId:     varchar('workflow_id', { length: 36 }).notNull(),
  status:         varchar('status', { length: 20 }).default('running'),
  stepsCompleted: integer('steps_completed').default(0),
  stepsTotal:     integer('steps_total').default(0),
  result:         jsonb('result').$type<Record<string, any>>(),
  errorMsg:       text('error_msg'),
  triggeredBy:    varchar('triggered_by', { length: 36 }),
  startedAt:      timestamp('started_at').defaultNow(),
  finishedAt:     timestamp('finished_at'),
});

// ── T12 TwinDesk ─────────────────────────────────────────────────────────────
export const twinDeskAgents = pgTable('nv_twindesk_agents', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }).notNull(),
  name:           varchar('name', { length: 120 }).notNull(),
  role:           varchar('role', { length: 60 }).default('advocate'),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('IN'),
  practiceAreas:  jsonb('practice_areas').$type<string[]>().default([]),
  persona:        jsonb('persona').$type<Record<string, any>>().default({}),
  knowledgeBase:  jsonb('knowledge_base').$type<string[]>().default([]),
  status:         varchar('status', { length: 20 }).default('draft'),
  config:         jsonb('config').$type<Record<string, any>>().default({}),
  createdBy:      varchar('created_by', { length: 36 }),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

export const twinDeskSessions = pgTable('nv_twindesk_sessions', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  agentId:        varchar('agent_id', { length: 36 }).notNull(),
  userId:         varchar('user_id', { length: 36 }),
  mode:           varchar('mode', { length: 30 }).default('collaborative'),
  transcript:     jsonb('transcript').$type<Array<{ speaker: string; content: string; ts: string }>>().default([]),
  insights:       jsonb('insights').$type<Record<string, any>>().default({}),
  status:         varchar('status', { length: 20 }).default('active'),
  startedAt:      timestamp('started_at').defaultNow(),
  endedAt:        timestamp('ended_at'),
});

// ── T13 SkillShop ────────────────────────────────────────────────────────────
export const skillShopListings = pgTable('nv_skillshop_listings', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  authorId:       varchar('author_id', { length: 36 }).notNull(),
  title:          varchar('title', { length: 200 }).notNull(),
  description:    text('description'),
  category:       varchar('category', { length: 60 }).default('legal-research'),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('ALL'),
  pattern:        varchar('pattern', { length: 20 }),
  skillCode:      text('skill_code'),
  pricePaise:     integer('price_paise').default(0),
  currency:       varchar('currency', { length: 5 }).default('INR'),
  downloads:      integer('downloads').default(0),
  rating:         real('rating').default(0),
  status:         varchar('status', { length: 20 }).default('draft'),
  tags:           jsonb('tags').$type<string[]>().default([]),
  metadata:       jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

// ── Pattern Audit Log (hash chain entries) ────────────────────────────────────
export const patternAuditLog = pgTable('nv_pattern_audit_log', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  traceId:        varchar('trace_id', { length: 36 }).notNull(),
  pattern:        varchar('pattern', { length: 20 }).notNull(),
  agentId:        varchar('agent_id', { length: 60 }),
  orgId:          varchar('org_id', { length: 36 }),
  jurisdiction:   varchar('jurisdiction', { length: 10 }),
  inputHash:      varchar('input_hash', { length: 64 }).notNull(),
  outputHash:     varchar('output_hash', { length: 64 }),
  chainHash:      varchar('chain_hash', { length: 64 }),
  riskScore:      real('risk_score').default(0),
  riskBadge:      varchar('risk_badge', { length: 10 }).default('GREEN'),
  blocked:        boolean('blocked').default(false),
  tokensUsed:     integer('tokens_used').default(0),
  latencyMs:      integer('latency_ms').default(0),
  metadata:       jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:      timestamp('created_at').defaultNow(),
});

// ── AG-UI Stream Sessions ─────────────────────────────────────────────────────
export const aguiSessions = pgTable('nv_agui_sessions', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  runId:          varchar('run_id', { length: 36 }).notNull(),
  pattern:        varchar('pattern', { length: 20 }),
  agentId:        varchar('agent_id', { length: 60 }),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('IN'),
  eventCount:     integer('event_count').default(0),
  tokensStreamed:  integer('tokens_streamed').default(0),
  durationMs:     integer('duration_ms').default(0),
  status:         varchar('status', { length: 20 }).default('running'),
  metadata:       jsonb('metadata').$type<Record<string, any>>().default({}),
  startedAt:      timestamp('started_at').defaultNow(),
  completedAt:    timestamp('completed_at'),
});

// ── Hallucination Detection Records ──────────────────────────────────────────
export const hallucinationDetections = pgTable('nv_hallucination_detections', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  traceId:        varchar('trace_id', { length: 36 }),
  pattern:        varchar('pattern', { length: 20 }),
  agentId:        varchar('agent_id', { length: 60 }),
  inputSnippet:   text('input_snippet'),
  outputSnippet:  text('output_snippet'),
  score:          real('score').notNull(),
  flagged:        boolean('flagged').default(false),
  citations:      jsonb('citations').$type<string[]>().default([]),
  groundingScore: real('grounding_score').default(0),
  metadata:       jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:      timestamp('created_at').defaultNow(),
});

// ── GRPO Run History ─────────────────────────────────────────────────────────
// Per-pattern execution log for full GRPO observability (BATCH 2 Sprint 3)
export const grpoRuns = pgTable('nv_grpo_runs', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  patternKey:     varchar('pattern_key', { length: 20 }).notNull(),
  route:          varchar('route', { length: 255 }),
  agentId:        varchar('agent_id', { length: 60 }),
  jurisdiction:   varchar('jurisdiction', { length: 10 }),
  taskHash:       varchar('task_hash', { length: 64 }),
  responseSnippet: text('response_snippet'),
  reward:         real('reward'),
  policyUpdated:  boolean('policy_updated').default(false),
  totalEpisodes:  integer('total_episodes').default(0),
  avgReward:      real('avg_reward'),
  createdAt:      timestamp('created_at').defaultNow(),
});

// ── PII Vault ─────────────────────────────────────────────────────────────────
// Temporary encrypted PII storage with TTL for data-minimisation compliance (BATCH 2 Sprint 3)
export const piiVault = pgTable('pii_vault', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }),
  userId:         varchar('user_id', { length: 36 }),
  category:       varchar('category', { length: 60 }).notNull(),
  encryptedData:  text('encrypted_data').notNull(),
  dataHash:       varchar('data_hash', { length: 64 }),
  ttlSeconds:     integer('ttl_seconds').default(1800),
  expiresAt:      timestamp('expires_at').notNull(),
  purpose:        varchar('purpose', { length: 255 }),
  createdAt:      timestamp('created_at').defaultNow(),
  deletedAt:      timestamp('deleted_at'),
});

// ── RAG Namespaces ────────────────────────────────────────────────────────────
// Tenant-scoped pgvector namespaces for document isolation (BATCH 2 Sprint 3)
export const ragNamespaces = pgTable('rag_namespaces', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }).notNull(),
  name:           varchar('name', { length: 100 }).notNull(),
  description:    text('description'),
  embeddingModel: varchar('embedding_model', { length: 100 }).default('text-embedding-3-small'),
  dimensions:     integer('dimensions').default(1536),
  documentCount:  integer('document_count').default(0),
  vectorCount:    integer('vector_count').default(0),
  totalTokens:    integer('total_tokens').default(0),
  isDefault:      boolean('is_default').default(false),
  isActive:       boolean('is_active').default(true),
  metadata:       jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

// ── Template Library ──────────────────────────────────────────────────────────
// Legal document template library with jurisdictional variants (BATCH 2 Sprint 3)
export const templateLibrary = pgTable('template_library', {
  id:             varchar('id', { length: 36 }).primaryKey(),
  orgId:          varchar('org_id', { length: 36 }),
  name:           varchar('name', { length: 255 }).notNull(),
  slug:           varchar('slug', { length: 100 }).notNull(),
  category:       varchar('category', { length: 60 }).notNull(),
  jurisdiction:   varchar('jurisdiction', { length: 10 }).default('IN'),
  language:       varchar('language', { length: 10 }).default('en'),
  templateBody:   text('template_body').notNull(),
  variables:      jsonb('variables').$type<string[]>().default([]),
  tags:           jsonb('tags').$type<string[]>().default([]),
  version:        varchar('version', { length: 20 }).default('1.0.0'),
  isPublic:       boolean('is_public').default(false),
  isActive:       boolean('is_active').default(true),
  usageCount:     integer('usage_count').default(0),
  metadata:       jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:      timestamp('created_at').defaultNow(),
  updatedAt:      timestamp('updated_at').defaultNow(),
});

// ── Immutable Audit Log — Hash Chain (§11.3 / §3.3.4) ───────────────────────
// The hash chain table referenced by jrx-sdk-tracking-middleware.ts (writeAuditLog).
// Every row's record_hash incorporates the previous row's hash, making any
// tampering immediately detectable on chain verification.
export const auditLogs = pgTable('nv_audit_logs', {
  id:            varchar('id', { length: 36 }).primaryKey(),
  traceId:       varchar('trace_id', { length: 36 }).notNull(),
  appId:         varchar('app_id', { length: 50 }),
  orgId:         varchar('org_id', { length: 36 }),
  userId:        varchar('user_id', { length: 100 }),
  route:         varchar('route', { length: 300 }).notNull(),
  method:        varchar('method', { length: 10 }).notNull(),
  statusCode:    integer('status_code'),
  latencyMs:     integer('latency_ms'),
  tokensUsed:    integer('tokens_used'),
  errorMessage:  text('error_message'),
  eventType:     varchar('event_type', { length: 60 }),
  recordHash:    varchar('record_hash', { length: 64 }),   // SHA-256 of this row
  previousHash:  varchar('previous_hash', { length: 64 }), // previous row's hash (chain link)
  metadata:      jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:     timestamp('created_at').defaultNow(),
});

// ── Jurisdiction Profiles (persisted per-tenant config) ────────────────────
// Mirrors the in-memory JURISDICTION_PROFILES in jrx-jurisdiction-binding-middleware.ts
// but provides a DB-backed persistence layer for per-org overrides.
export const jurisdictionProfiles = pgTable('nv_jurisdiction_profiles', {
  id:                  serial('id').primaryKey(),
  jurisdictionCode:    varchar('jurisdiction_code', { length: 10 }).notNull(),
  orgId:               varchar('org_id', { length: 36 }),
  name:                varchar('name', { length: 100 }).notNull(),
  currency:            varchar('currency', { length: 3 }).default('INR'),
  courts:              jsonb('courts').$type<string[]>().default([]),
  statutes:            jsonb('statutes').$type<string[]>().default([]),
  regulatoryBodies:    jsonb('regulatory_bodies').$type<string[]>().default([]),
  languages:           jsonb('languages').$type<string[]>().default([]),
  prohibitedPhrases:   jsonb('prohibited_phrases').$type<string[]>().default([]),
  mandatoryDisclosures: jsonb('mandatory_disclosures').$type<string[]>().default([]),
  aiFormatRules:       jsonb('ai_format_rules').$type<Record<string, any>>().default({}),
  complianceFrameworks: jsonb('compliance_frameworks').$type<string[]>().default([]),
  isDefault:           boolean('is_default').default(false),
  isActive:            boolean('is_active').default(true),
  metadata:            jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt:           timestamp('created_at').defaultNow(),
  updatedAt:           timestamp('updated_at').defaultNow(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// SPRINT WEEK TABLES (Day 1 — April 14, 2026)
// ═══════════════════════════════════════════════════════════════════════════════

export const nvLegalOracleQa = pgTable('nv_legal_oracle_qa', {
  id: serial('id').primaryKey(),
  jurisdiction: text('jurisdiction').notNull(),
  domain: text('domain').notNull(),
  question: text('question').notNull(),
  expectedAnswer: text('expected_answer').notNull(),
  citedStatutes: jsonb('cited_statutes').$type<string[]>().default([]),
  difficulty: text('difficulty').default('medium'),
  curatedBy: text('curated_by'),
  validFrom: timestamp('valid_from'),
  validTo: timestamp('valid_to'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  jurisdictionDomainIdx: index('nv_legal_oracle_qa_jurisdiction_domain_idx').on(table.jurisdiction, table.domain),
  createdAtIdx: index('nv_legal_oracle_qa_created_at_idx').on(table.createdAt),
}));

export const nvStatuteVersions = pgTable('nv_statute_versions', {
  id: serial('id').primaryKey(),
  statuteId: text('statute_id').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  sectionNumber: text('section_number').notNull(),
  sectionTitle: text('section_title').notNull(),
  sectionText: text('section_text').notNull(),
  amendmentReference: text('amendment_reference'),
  validFrom: timestamp('valid_from').notNull(),
  validTo: timestamp('valid_to'),
  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
  supersededBy: integer('superseded_by'),
  sourceUrl: text('source_url'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  statuteIdValidFromIdx: index('nv_statute_versions_statute_valid_idx').on(table.statuteId, table.validFrom),
  jurisdictionSectionIdx: index('nv_statute_versions_jurisdiction_section_idx').on(table.jurisdiction, table.sectionNumber),
  validFromIdx: index('nv_statute_versions_valid_from_idx').on(table.validFrom),
  validToIdx: index('nv_statute_versions_valid_to_idx').on(table.validTo),
}));

export const nvAmendmentEvents = pgTable('nv_amendment_events', {
  id: serial('id').primaryKey(),
  jurisdiction: text('jurisdiction').notNull(),
  eventType: text('event_type').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  affectedStatutes: jsonb('affected_statutes').$type<string[]>().default([]),
  severity: text('severity').notNull().default('minor'),
  sourceUrl: text('source_url'),
  sourceRef: text('source_ref'),
  publishedAt: timestamp('published_at'),
  effectiveAt: timestamp('effective_at'),
  processedAt: timestamp('processed_at'),
  impactScore: real('impact_score'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  jurisdictionEffectiveIdx: index('nv_amendment_events_jurisdiction_effective_idx').on(table.jurisdiction, table.effectiveAt),
  severityIdx: index('nv_amendment_events_severity_idx').on(table.severity),
  publishedAtIdx: index('nv_amendment_events_published_at_idx').on(table.publishedAt),
}));

export const nvLegalTemplates = pgTable('nv_legal_templates', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  category: text('category').notNull(),
  jurisdictions: jsonb('jurisdictions').$type<string[]>().notNull().default([]),
  templateText: text('template_text').notNull(),
  variables: jsonb('variables').$type<Array<{ name: string; type: string; required: boolean; description: string; default?: string }>>().notNull().default([]),
  constraints: jsonb('constraints').$type<Record<string, any>>().default({}),
  enforceabilityScore: real('enforceability_score'),
  version: text('version').notNull().default('1.0'),
  isActive: boolean('is_active').default(true),
  reviewedBy: text('reviewed_by'),
  lastReviewedAt: timestamp('last_reviewed_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  categoryIdx: index('nv_legal_templates_category_idx').on(table.category),
  enforceabilityIdx: index('nv_legal_templates_enforceability_idx').on(table.enforceabilityScore),
}));

export const nvTemplateClauses = pgTable('nv_template_clauses', {
  id: serial('id').primaryKey(),
  templateId: integer('template_id').references(() => nvLegalTemplates.id, { onDelete: 'cascade' }),
  clauseName: text('clause_name').notNull(),
  clauseText: text('clause_text').notNull(),
  clauseType: text('clause_type').notNull().default('optional'),
  riskLevel: integer('risk_level').notNull().default(1),
  riskExplanation: text('risk_explanation'),
  jurisdictions: jsonb('jurisdictions').$type<string[]>().default([]),
  alternatives: jsonb('alternatives').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  templateIdIdx: index('nv_template_clauses_template_id_idx').on(table.templateId),
  clauseTypeIdx: index('nv_template_clauses_clause_type_idx').on(table.clauseType),
  riskLevelIdx: index('nv_template_clauses_risk_level_idx').on(table.riskLevel),
}));

export const nvMatterMemory = pgTable('nv_matter_memory', {
  id: serial('id').primaryKey(),
  matterId: text('matter_id').notNull(),
  userId: integer('user_id'),
  orgId: integer('org_id'),
  memoryType: text('memory_type').notNull(),
  content: text('content').notNull(),
  tokens: integer('tokens'),
  importance: real('importance'),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  matterIdTypeIdx: index('nv_matter_memory_matter_type_idx').on(table.matterId, table.memoryType),
  userIdIdx: index('nv_matter_memory_user_id_idx').on(table.userId),
  createdAtIdx: index('nv_matter_memory_created_at_idx').on(table.createdAt),
  importanceIdx: index('nv_matter_memory_importance_idx').on(table.importance),
}));

export const nvClientMemory = pgTable('nv_client_memory', {
  id: serial('id').primaryKey(),
  clientId: text('client_id').notNull(),
  userId: integer('user_id'),
  attribute: text('attribute').notNull(),
  value: text('value').notNull(),
  confidence: real('confidence'),
  evidenceMatterIds: jsonb('evidence_matter_ids').$type<string[]>().default([]),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  clientAttributeIdx: index('nv_client_memory_client_attribute_idx').on(table.clientId, table.attribute),
  userIdIdx: index('nv_client_memory_user_id_idx').on(table.userId),
  lastUpdatedIdx: index('nv_client_memory_last_updated_idx').on(table.lastUpdated),
}));

export const nvJurisdictionalMemory = pgTable('nv_jurisdictional_memory', {
  id: serial('id').primaryKey(),
  jurisdiction: text('jurisdiction').notNull(),
  domain: text('domain').notNull(),
  insightKey: text('insight_key').notNull(),
  insightValue: text('insight_value').notNull(),
  confidence: real('confidence').default(0.5),
  source: text('source'),
  userId: integer('user_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  lastUpdated: timestamp('last_updated').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  jurisdictionDomainIdx: index('nv_jurisdictional_memory_jd_idx').on(table.jurisdiction, table.domain),
  insightKeyIdx: index('nv_jurisdictional_memory_key_idx').on(table.insightKey),
  lastUpdatedIdx: index('nv_jurisdictional_memory_updated_idx').on(table.lastUpdated),
}));

export const nvPrecedentMemory = pgTable('nv_precedent_memory', {
  id: serial('id').primaryKey(),
  caseId: text('case_id').notNull(),
  citation: text('citation').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  court: text('court'),
  year: integer('year'),
  principleOfLaw: text('principle_of_law').notNull(),
  headnote: text('headnote'),
  status: text('status').notNull().default('active'),
  overruledBy: text('overruled_by'),
  distinguishedIn: jsonb('distinguished_in').$type<string[]>().default([]),
  appliedIn: jsonb('applied_in').$type<string[]>().default([]),
  relevanceScore: real('relevance_score').default(0.5),
  embeddingVector: text('embedding_vector'),
  userId: integer('user_id'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  caseIdIdx: index('nv_precedent_memory_case_id_idx').on(table.caseId),
  citationIdx: index('nv_precedent_memory_citation_idx').on(table.citation),
  jurisdictionIdx: index('nv_precedent_memory_jurisdiction_idx').on(table.jurisdiction),
  statusIdx: index('nv_precedent_memory_status_idx').on(table.status),
  yearIdx: index('nv_precedent_memory_year_idx').on(table.year),
}));

export const nvLlmEvaluations = pgTable('nv_llm_evaluations', {
  id: serial('id').primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  judgeModel: text('judge_model').notNull(),
  legalAccuracyScore: real('legal_accuracy_score'),
  citationQualityScore: real('citation_quality_score'),
  jurisdictionCorrectnessScore: real('jurisdiction_correctness_score'),
  biasAbsenceScore: real('bias_absence_score'),
  actionabilityScore: real('actionability_score'),
  weightedTotalScore: real('weighted_total_score'),
  judgeReasoning: text('judge_reasoning'),
  flaggedIssues: jsonb('flagged_issues').$type<string[]>().default([]),
  passedThreshold: boolean('passed_threshold'),
  evaluatedAt: timestamp('evaluated_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  targetTypeIdIdx: index('nv_llm_evaluations_target_type_id_idx').on(table.targetType, table.targetId),
  passedThresholdIdx: index('nv_llm_evaluations_passed_threshold_idx').on(table.passedThreshold),
  weightedScoreIdx: index('nv_llm_evaluations_weighted_score_idx').on(table.weightedTotalScore),
  evaluatedAtIdx: index('nv_llm_evaluations_evaluated_at_idx').on(table.evaluatedAt),
}));

export const nvForensicVerifications = pgTable('nv_forensic_verifications', {
  id: serial('id').primaryKey(),
  documentId: text('document_id'),
  documentHash: text('document_hash').notNull(),
  aiGeneratedScore: real('ai_generated_score'),
  forgeryScore: real('forgery_score'),
  metadataConsistencyScore: real('metadata_consistency_score'),
  fontConsistencyScore: real('font_consistency_score'),
  signatureValid: boolean('signature_valid'),
  sealAuthentic: boolean('seal_authentic'),
  chainOfCustodyValid: boolean('chain_of_custody_valid'),
  overallAuthenticityScore: real('overall_authenticity_score'),
  verdict: text('verdict').default('pending'),
  evidence: jsonb('evidence').$type<Record<string, any>>().default({}),
  verifiedAt: timestamp('verified_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  documentHashIdx: index('nv_forensic_verifications_document_hash_idx').on(table.documentHash),
  verdictIdx: index('nv_forensic_verifications_verdict_idx').on(table.verdict),
  verifiedAtIdx: index('nv_forensic_verifications_verified_at_idx').on(table.verifiedAt),
}));

export const nvRegulatoryFeeds = pgTable('nv_regulatory_feeds', {
  id: serial('id').primaryKey(),
  sourceName: text('source_name').notNull(),
  jurisdiction: text('jurisdiction').notNull(),
  feedType: text('feed_type').notNull(),
  feedUrl: text('feed_url').notNull(),
  lastFetchedAt: timestamp('last_fetched_at'),
  lastChangeDetectedAt: timestamp('last_change_detected_at'),
  fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(60),
  isActive: boolean('is_active').default(true),
  parserType: text('parser_type'),
  authConfig: jsonb('auth_config').$type<Record<string, any>>().default({}),
  metadata: jsonb('metadata').$type<Record<string, any>>().default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  jurisdictionIdx: index('nv_regulatory_feeds_jurisdiction_idx').on(table.jurisdiction),
  feedTypeIdx: index('nv_regulatory_feeds_feed_type_idx').on(table.feedType),
  isActiveIdx: index('nv_regulatory_feeds_is_active_idx').on(table.isActive),
  lastFetchedAtIdx: index('nv_regulatory_feeds_last_fetched_at_idx').on(table.lastFetchedAt),
}));

// ── Type exports ──────────────────────────────────────────────────────────────
export type NvLegalOracleQa = InferSelectModel<typeof nvLegalOracleQa>;
export type NvStatuteVersion = InferSelectModel<typeof nvStatuteVersions>;
export type NvAmendmentEvent = InferSelectModel<typeof nvAmendmentEvents>;
export type NvLegalTemplate = InferSelectModel<typeof nvLegalTemplates>;
export type NvTemplateClause = InferSelectModel<typeof nvTemplateClauses>;
export type NvMatterMemory = InferSelectModel<typeof nvMatterMemory>;
export type NvClientMemory = InferSelectModel<typeof nvClientMemory>;
export type NvJurisdictionalMemory = InferSelectModel<typeof nvJurisdictionalMemory>;
export type NvPrecedentMemory = InferSelectModel<typeof nvPrecedentMemory>;
export type NvLlmEvaluation = InferSelectModel<typeof nvLlmEvaluations>;
export type NvForensicVerification = InferSelectModel<typeof nvForensicVerifications>;
export type NvRegulatoryFeed = InferSelectModel<typeof nvRegulatoryFeeds>;

export type NewNvLegalOracleQa = InferInsertModel<typeof nvLegalOracleQa>;
export type NewNvStatuteVersion = InferInsertModel<typeof nvStatuteVersions>;
export type NewNvAmendmentEvent = InferInsertModel<typeof nvAmendmentEvents>;
export type NewNvLegalTemplate = InferInsertModel<typeof nvLegalTemplates>;
export type NewNvTemplateClause = InferInsertModel<typeof nvTemplateClauses>;
export type NewNvMatterMemory = InferInsertModel<typeof nvMatterMemory>;
export type NewNvClientMemory = InferInsertModel<typeof nvClientMemory>;
export type NewNvJurisdictionalMemory = InferInsertModel<typeof nvJurisdictionalMemory>;
export type NewNvPrecedentMemory = InferInsertModel<typeof nvPrecedentMemory>;
export type NewNvLlmEvaluation = InferInsertModel<typeof nvLlmEvaluations>;
export type NewNvForensicVerification = InferInsertModel<typeof nvForensicVerifications>;
export type NewNvRegulatoryFeed = InferInsertModel<typeof nvRegulatoryFeeds>;

export type Subscription = InferSelectModel<typeof subscriptions>;
export type CreditWallet = InferSelectModel<typeof creditWallet>;
export type CreditTransaction = InferSelectModel<typeof creditTransactions>;
export type SubscriptionEvent = InferSelectModel<typeof subscriptionEvents>;
export type AiActivity = InferSelectModel<typeof aiActivity>;
export type CaseUpdate = InferSelectModel<typeof caseUpdates>;
export type InstitutionalLead = InferSelectModel<typeof institutionalLeads>;
export type Invoice = InferSelectModel<typeof invoices>;
export type Payment = InferSelectModel<typeof payments>;
export type GrpoPolicySnapshot = InferSelectModel<typeof grpoPolicySnapshots>;
export type HearingMetadata = InferSelectModel<typeof hearingMetadata>;
export type FilingMetadata = InferSelectModel<typeof filingMetadata>;
export type ClaWdBot = InferSelectModel<typeof claWdBots>;
export type ClaWdConversation = InferSelectModel<typeof claWdConversations>;
export type OpenBotAgent = InferSelectModel<typeof openBotAgents>;
export type OpenBotTask = InferSelectModel<typeof openBotTasks>;
export type AutomateWorkflow = InferSelectModel<typeof automateWorkflows>;
export type AutomateExecution = InferSelectModel<typeof automateExecutions>;
export type TwinDeskAgent = InferSelectModel<typeof twinDeskAgents>;
export type TwinDeskSession = InferSelectModel<typeof twinDeskSessions>;
export type SkillShopListing = InferSelectModel<typeof skillShopListings>;
export type PatternAuditLog = InferSelectModel<typeof patternAuditLog>;
export type AguiSession = InferSelectModel<typeof aguiSessions>;
export type HallucinationDetection = InferSelectModel<typeof hallucinationDetections>;
export type GrpoRun = InferSelectModel<typeof grpoRuns>;
export type PiiVault = InferSelectModel<typeof piiVault>;
export type RagNamespace = InferSelectModel<typeof ragNamespaces>;
export type TemplateLibrary = InferSelectModel<typeof templateLibrary>;
export type AuditLog = InferSelectModel<typeof auditLogs>;
export type JurisdictionProfile = InferSelectModel<typeof jurisdictionProfiles>;

export type NewSubscription = InferInsertModel<typeof subscriptions>;
export type NewCreditWallet = InferInsertModel<typeof creditWallet>;
export type NewCreditTransaction = InferInsertModel<typeof creditTransactions>;
export type NewAiActivity = InferInsertModel<typeof aiActivity>;
export type NewInvoice = InferInsertModel<typeof invoices>;
export type NewPayment = InferInsertModel<typeof payments>;
export type NewClaWdBot = InferInsertModel<typeof claWdBots>;
export type NewClaWdConversation = InferInsertModel<typeof claWdConversations>;
export type NewOpenBotAgent = InferInsertModel<typeof openBotAgents>;
export type NewOpenBotTask = InferInsertModel<typeof openBotTasks>;
export type NewAutomateWorkflow = InferInsertModel<typeof automateWorkflows>;
export type NewAutomateExecution = InferInsertModel<typeof automateExecutions>;
export type NewTwinDeskAgent = InferInsertModel<typeof twinDeskAgents>;
export type NewTwinDeskSession = InferInsertModel<typeof twinDeskSessions>;
export type NewSkillShopListing = InferInsertModel<typeof skillShopListings>;
export type NewPatternAuditLog = InferInsertModel<typeof patternAuditLog>;
export type NewAguiSession = InferInsertModel<typeof aguiSessions>;
export type NewHallucinationDetection = InferInsertModel<typeof hallucinationDetections>;

export type NvUser = InferSelectModel<typeof nvUsers>;
export type NvOrganization = InferSelectModel<typeof nvOrganizations>;
export type NvSession = InferSelectModel<typeof nvSessions>;
export type NvAuthToken = InferSelectModel<typeof nvAuthTokens>;
export type NvVoiceSession = InferSelectModel<typeof nvVoiceSessions>;

export type NewNvUser = InferInsertModel<typeof nvUsers>;
export type NewNvOrganization = InferInsertModel<typeof nvOrganizations>;
export type NewNvSession = InferInsertModel<typeof nvSessions>;
export type NewNvAuthToken = InferInsertModel<typeof nvAuthTokens>;
export type NewNvVoiceSession = InferInsertModel<typeof nvVoiceSessions>;

// ─── Legal Chat Dashboard (JRX-LEGAL-CHAT) ──────────────────────────────────
// Tables that back the admin Legal Chat tool inside JRX Console.
// The tool lets Superadmins + Superadmin-allocated SMEs (a) drive the full
// orchestration stack on real legal inputs, (b) watch every step in a live
// timeline, and (c) rate the response with a 5-criterion rubric whose
// preference pairs feed the offline GRPO retrainer.

export const legalChatSessions = pgTable('legal_chat_sessions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  ownerUserId: integer('owner_user_id').notNull(),
  orgId: integer('org_id'),
  title: varchar('title', { length: 255 }).notNull().default('Untitled session'),
  jurisdictions: jsonb('jurisdictions').$type<string[]>().notNull().default([]),
  tier: varchar('tier', { length: 32 }).notNull().default('pro'),
  mode: varchar('mode', { length: 64 }).notNull().default('chat'),
  preferences: jsonb('preferences').$type<Record<string, unknown>>().notNull().default({}),
  lastUsedAt: timestamp('last_used_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('legal_chat_sessions_owner_idx').on(table.ownerUserId),
  lastUsedIdx: index('legal_chat_sessions_last_used_idx').on(table.lastUsedAt),
}));

export const legalChatMessages = pgTable('legal_chat_messages', {
  id: varchar('id', { length: 36 }).primaryKey(),
  sessionId: varchar('session_id', { length: 36 }).notNull(),
  orchestrationId: varchar('orchestration_id', { length: 64 }),
  role: varchar('role', { length: 16 }).notNull(),
  content: text('content').notNull(),
  citations: jsonb('citations').$type<Array<Record<string, unknown>>>().notNull().default([]),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index('legal_chat_messages_session_idx').on(table.sessionId),
  orchestrationIdx: index('legal_chat_messages_orchestration_idx').on(table.orchestrationId),
}));

export const smeAllocations = pgTable('sme_allocations', {
  id: serial('id').primaryKey(),
  smeUserId: integer('sme_user_id').notNull(),
  allocatedByUserId: integer('allocated_by_user_id').notNull(),
  scope: jsonb('scope').$type<{
    jurisdictions?: string[];
    practiceAreas?: string[];
    notes?: string;
  }>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  revokedAt: timestamp('revoked_at'),
}, (table) => ({
  smeIdx: index('sme_allocations_sme_idx').on(table.smeUserId),
  activeIdx: index('sme_allocations_active_idx').on(table.active),
}));

export const smeFeedback = pgTable('sme_feedback', {
  id: serial('id').primaryKey(),
  orchestrationId: varchar('orchestration_id', { length: 64 }).notNull(),
  sessionId: varchar('session_id', { length: 36 }),
  smeUserId: integer('sme_user_id').notNull(),
  ratings: jsonb('ratings').$type<{
    legalAccuracy?: number;
    jurisdictionalFit?: number;
    draftingQuality?: number;
    citationGrounding?: number;
    reasoningDepth?: number;
    thumb?: 'up' | 'down' | null;
  }>().notNull().default({}),
  comment: text('comment'),
  preferredOver: varchar('preferred_over', { length: 64 }),
  judgeVerdict: jsonb('judge_verdict').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (table) => ({
  orchIdx: index('sme_feedback_orchestration_idx').on(table.orchestrationId),
  smeIdx: index('sme_feedback_sme_idx').on(table.smeUserId),
}));

export type LegalChatSession = InferSelectModel<typeof legalChatSessions>;
export type LegalChatMessage = InferSelectModel<typeof legalChatMessages>;
export type SmeAllocation = InferSelectModel<typeof smeAllocations>;
export type SmeFeedback = InferSelectModel<typeof smeFeedback>;
export type NewLegalChatSession = InferInsertModel<typeof legalChatSessions>;
export type NewLegalChatMessage = InferInsertModel<typeof legalChatMessages>;
export type NewSmeAllocation = InferInsertModel<typeof smeAllocations>;
export type NewSmeFeedback = InferInsertModel<typeof smeFeedback>;

// ── Persistent LLM router decision log (replaces in-memory ring) ──────────
// Every routing decision (success or failure) is appended here by the
// llm-orchestrator via a fire-and-forget batched writer in router-stats.ts.
// In-memory ring (last 1000) is preserved for fast `/router-stats/recent`;
// this table is the source of truth for >1k history, post-restart visibility,
// and BI/SME-feedback joins.
export const nvRouterDecisions = pgTable('nv_router_decisions', {
  id: serial('id').primaryKey(),
  ts: timestamp('ts').notNull().defaultNow(),
  requestId: varchar('request_id', { length: 64 }),
  agentId: varchar('agent_id', { length: 96 }),
  tier: varchar('tier', { length: 32 }),
  jurisdiction: varchar('jurisdiction', { length: 16 }),
  taskKind: varchar('task_kind', { length: 64 }),
  primaryModelId: varchar('primary_model_id', { length: 96 }).notNull(),
  pickedModelId: varchar('picked_model_id', { length: 96 }).notNull(),
  pickedProvider: varchar('picked_provider', { length: 32 }).notNull(),
  fallbackLevel: integer('fallback_level').notNull().default(0),
  ok: boolean('ok').notNull(),
  latencyMs: integer('latency_ms').notNull().default(0),
  costUsd: doublePrecision('cost_usd').notNull().default(0),
  tokensIn: integer('tokens_in').notNull().default(0),
  tokensOut: integer('tokens_out').notNull().default(0),
  errorMessage: text('error_message'),
  meta: jsonb('meta').$type<Record<string, unknown>>(),
}, (table) => ({
  tsIdx: index('nv_router_decisions_ts_idx').on(table.ts),
  modelIdx: index('nv_router_decisions_model_idx').on(table.pickedModelId),
  agentIdx: index('nv_router_decisions_agent_idx').on(table.agentId),
  jurisIdx: index('nv_router_decisions_juris_idx').on(table.jurisdiction),
}));

export type NvRouterDecision = InferSelectModel<typeof nvRouterDecisions>;
export type NewNvRouterDecision = InferInsertModel<typeof nvRouterDecisions>;

// ═══════════════════════════════════════════════════════════════════════════════
// NV_SCHEMA NAMESPACE — Governance & Hash-Chain Audit (April 27, 2026)
// ═══════════════════════════════════════════════════════════════════════════════
// These two tables live in the `nv_schema` Postgres schema (NOT public) and were
// originally created ad-hoc on production RDS during the Phase 1 Legal Chat
// smoke. Drizzle entries codified here so any fresh deploy (DR replica, new
// region, dev/staging from scratch) provisions them automatically.
//
// Column types deliberately match the existing prod RDS shape exactly (verified
// via information_schema.columns):
//   • Both PKs are NATIVE postgres `uuid` (NOT varchar) — using Drizzle uuid()
//     so db:push is a no-op against current prod and recreates the same shape
//     on a fresh database.
//   • model_governance.id has gen_random_uuid() default; nv_audit_logs.id has
//     no default because the hash-chain writer always supplies its own id.

export const nvModelGovernance = nvSchema.table('model_governance', {
  id:                 uuid('id').primaryKey().defaultRandom(),
  modelName:          text('model_name').notNull(),
  provider:           text('provider').notNull(),
  version:            text('version').notNull().default('1.0'),
  deploymentRegions:  jsonb('deployment_regions').$type<string[]>().notNull().default(sql`'["IN"]'::jsonb`),
  approvedBy:         text('approved_by').notNull().default('system'),
  riskAssessment:     jsonb('risk_assessment').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  status:             text('status').notNull().default('pending'),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Hash-chain immutable audit log written synchronously by
// jrx-sdk-tracking-middleware.ts on every release of an LLM answer. The
// `nv_audit_logs_prev_hash_uniq` UNIQUE constraint name is referenced by name
// from the middleware's error-recovery path — DO NOT rename it.
export const nvAuditLogsHashChain = nvSchema.table('nv_audit_logs', {
  id:           uuid('id').primaryKey(),
  eventType:    text('event_type').notNull(),
  payload:      jsonb('payload').$type<Record<string, unknown>>().notNull(),
  previousHash: text('previous_hash').notNull(),
  recordHash:   text('record_hash').notNull(),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  prevHashUniq: uniqueIndex('nv_audit_logs_prev_hash_uniq').on(table.previousHash),
  recordHashUniq: uniqueIndex('nv_audit_logs_record_hash_uniq').on(table.recordHash),
}));

export type NvModelGovernance     = InferSelectModel<typeof nvModelGovernance>;
export type NewNvModelGovernance  = InferInsertModel<typeof nvModelGovernance>;
export type NvAuditLogHashChain   = InferSelectModel<typeof nvAuditLogsHashChain>;
export type NewNvAuditLogHashChain = InferInsertModel<typeof nvAuditLogsHashChain>;

// ═══════════════════════════════════════════════════════════════════════════════
// NS_* TABLES — Document Pipeline (April 27, 2026)
// ═══════════════════════════════════════════════════════════════════════════════
// Backing tables for the production-doc-processor service. Without these the
// 3-second job poller fails with PG 42P01 ("relation does not exist") and
// floods CloudWatch. Adding them as Drizzle entries means a fresh `db:push`
// provisions them; the poller now also guards itself with an
// information_schema check and skips cleanly when they're absent (see
// src/services/document-pipeline/production-doc-processor.ts startJobPoller).
//
// Safe-ID convention per platform standard: varchar(36) PKs with
// gen_random_uuid() default for tables that didn't previously exist on RDS,
// integer org_id (matches `orgId: number` argument shape in the service).

export const nsDocProcessingJobs = pgTable('ns_doc_processing_jobs', {
  id:              varchar('id', { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
  orgId:           integer('org_id').notNull(),
  documentId:      varchar('document_id', { length: 36 }),
  documentType:    varchar('document_type', { length: 50 }).default('text'),
  extractionMode:  varchar('extraction_mode', { length: 50 }).default('full'),
  status:          varchar('status', { length: 30 }).notNull().default('queued'),
  progress:        integer('progress').notNull().default(0),
  fileName:        varchar('file_name', { length: 500 }),
  fileSizeBytes:   integer('file_size_bytes').default(0),
  priority:        integer('priority').notNull().default(5),
  workerId:        varchar('worker_id', { length: 100 }),
  startedAt:       timestamp('started_at', { withTimezone: true }),
  completedAt:     timestamp('completed_at', { withTimezone: true }),
  retryCount:      integer('retry_count').notNull().default(0),
  maxRetries:      integer('max_retries').notNull().default(3),
  errorMessage:    text('error_message'),
  result:          jsonb('result').$type<Record<string, unknown>>(),
  // Set by updateJobStatus(extras.storage_path) when the parsed doc is
  // persisted to S3/disk. Nullable — populated only after extraction.
  storagePath:     text('storage_path'),
  parsedJsonPath:  text('parsed_json_path'),
  metadata:        jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt:       timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:       timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pollerIdx: index('ns_doc_jobs_poller_idx').on(t.status, t.priority, t.createdAt),
  orgIdx:    index('ns_doc_jobs_org_idx').on(t.orgId, t.createdAt),
}));

export const nsParsedDocuments = pgTable('ns_parsed_documents', {
  id:                 serial('id').primaryKey(),
  organizationId:     integer('organization_id').notNull(),
  documentId:         varchar('document_id', { length: 36 }).notNull(),
  jobId:              varchar('job_id', { length: 36 }).notNull(),
  fileName:           varchar('file_name', { length: 500 }),
  fileType:           varchar('file_type', { length: 50 }),
  fileSizeBytes:      integer('file_size_bytes').default(0),
  mimeType:           varchar('mime_type', { length: 100 }),
  storagePath:        text('storage_path'),
  parsedJsonPath:     text('parsed_json_path'),
  rawContent:         text('raw_content'),
  parsedContent:      jsonb('parsed_content').$type<Record<string, unknown>>(),
  metadata:           jsonb('metadata').$type<Record<string, unknown>>().default({}),
  statistics:         jsonb('statistics').$type<Record<string, unknown>>().default({}),
  entities:           jsonb('entities').$type<unknown[]>().default([]),
  sections:           jsonb('sections').$type<unknown[]>().default([]),
  obligations:        jsonb('obligations').$type<unknown[]>().default([]),
  risks:              jsonb('risks').$type<unknown[]>().default([]),
  deadlines:          jsonb('deadlines').$type<unknown[]>().default([]),
  language:           varchar('language', { length: 10 }).default('en'),
  jurisdiction:       varchar('jurisdiction', { length: 10 }),
  documentClass:      varchar('document_class', { length: 100 }),
  pageCount:          integer('page_count').default(0),
  wordCount:          integer('word_count').default(0),
  processingTimeMs:   integer('processing_time_ms').default(0),
  status:             varchar('status', { length: 30 }).default('completed'),
  createdBy:          varchar('created_by', { length: 100 }),
  // v5.0.1 (G1 decision 2026-05-06): segregate documents by ecosystem platform
  // of origin (NSP / NYM / NSI / NSA / NSM / JRX / NSPM). Nullable for backfill;
  // populated by SDK gateway from the SDK key's variant. Index supports
  // per-platform queries without table bloat.
  platformCode:       varchar('platform_code', { length: 20 }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt:          timestamp('deleted_at', { withTimezone: true }),
}, (t) => ({
  orgDocIdx:  index('ns_parsed_docs_org_doc_idx').on(t.organizationId, t.documentId),
  jobIdx:     uniqueIndex('ns_parsed_docs_job_uniq').on(t.jobId),
  orgPlatformIdx: index('ns_parsed_docs_org_platform_idx').on(t.organizationId, t.platformCode),
}));

// ─── e-Sign session persistence (v5.0.1 D2 fix, 2026-05-06) ─────────────
// Replaces the in-memory Map in jrx-esign-adapter-service.ts. Sessions
// previously evaporated on every gateway restart, breaking legally-binding
// signing flows. Persisted to DB; in-memory cache kept request-scoped only.
export const nvEsignSessions = pgTable('nv_esign_sessions', {
  sessionId:      varchar('session_id', { length: 64 }).primaryKey(),
  organizationId: integer('organization_id').notNull(),
  documentHash:   varchar('document_hash', { length: 64 }).notNull(),
  signers:        jsonb('signers').$type<unknown[]>().notNull().default([]),
  status:         varchar('status', { length: 30 }).notNull().default('pending'),
  provider:       varchar('provider', { length: 50 }),
  platformCode:   varchar('platform_code', { length: 20 }),
  metadata:       jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt:      timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt:      timestamp('expires_at', { withTimezone: true }).notNull(),
  completedAt:    timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  orgIdx:    index('nv_esign_org_idx').on(t.organizationId, t.createdAt),
  expiryIdx: index('nv_esign_expiry_idx').on(t.status, t.expiresAt),
}));

export const nsRagDocumentChunks = pgTable('ns_rag_document_chunks', {
  id:               bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId:   integer('organization_id').notNull(),
  documentId:       varchar('document_id', { length: 36 }).notNull(),
  jobId:            varchar('job_id', { length: 36 }).notNull(),
  chunkIndex:       integer('chunk_index').notNull(),
  content:          text('content').notNull(),
  tokenCount:       integer('token_count').default(0),
  charCount:        integer('char_count').default(0),
  startPosition:    integer('start_position').default(0),
  endPosition:      integer('end_position').default(0),
  sectionTitle:     varchar('section_title', { length: 500 }),
  chunkMetadata:    jsonb('chunk_metadata').$type<Record<string, unknown>>().default({}),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgDocIdx:  index('ns_rag_chunks_org_doc_idx').on(t.organizationId, t.documentId),
  // Note: pgvector embedding column added at runtime by document-pipeline.
  // Keeping it out of Drizzle so db:push doesn't require pgvector locally.
}));

export const nsDocumentGraph = pgTable('ns_document_graph', {
  id:                  serial('id').primaryKey(),
  organizationId:      integer('organization_id').notNull(),
  sourceDocumentId:    varchar('source_document_id', { length: 36 }).notNull(),
  targetDocumentId:    varchar('target_document_id', { length: 36 }).notNull(),
  relationshipType:    varchar('relationship_type', { length: 60 }).notNull(),
  confidence:          real('confidence').default(0),
  metadata:            jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt:           timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgSrcIdx: index('ns_doc_graph_org_src_idx').on(t.organizationId, t.sourceDocumentId),
  orgTgtIdx: index('ns_doc_graph_org_tgt_idx').on(t.organizationId, t.targetDocumentId),
}));

export type NsDocProcessingJob   = InferSelectModel<typeof nsDocProcessingJobs>;
export type NewNsDocProcessingJob = InferInsertModel<typeof nsDocProcessingJobs>;
export type NsParsedDocument     = InferSelectModel<typeof nsParsedDocuments>;
export type NewNsParsedDocument  = InferInsertModel<typeof nsParsedDocuments>;
export type NsRagDocumentChunk   = InferSelectModel<typeof nsRagDocumentChunks>;
export type NewNsRagDocumentChunk = InferInsertModel<typeof nsRagDocumentChunks>;
export type NsDocumentGraph      = InferSelectModel<typeof nsDocumentGraph>;
export type NewNsDocumentGraph   = InferInsertModel<typeof nsDocumentGraph>;

// ─── nv_doc_share_grants — Jurexio-mediated cross-platform share grants ───
// Per Phase 2A decisions LOCKED 2026-05-06: large docs (>= auto_share_threshold_mb)
// auto-receive ecosystem-wide read grants. NULL granted_to_org_id = ecosystem-wide.
// Source-of-truth migration: scripts/migrations/2026-05-06-doc-share-grants.sql
export const nvDocShareGrants = pgTable('nv_doc_share_grants', {
  id:                    bigserial('id', { mode: 'number' }).primaryKey(),
  documentId:            text('document_id').notNull(),
  ownerOrgId:            text('owner_org_id').notNull(),
  ownerPlatformCode:     text('owner_platform_code').notNull(),
  grantedToPlatformCode: text('granted_to_platform_code').notNull(),
  grantedToOrgId:        text('granted_to_org_id'),
  grantType:             text('grant_type').notNull().default('read'),
  grantReason:           text('grant_reason'),
  thresholdBytes:        bigint('threshold_bytes', { mode: 'number' }),
  storagePath:           text('storage_path'),
  sharedBucket:          text('shared_bucket').notNull().default('jrx-shared-documents'),
  expiresAt:             timestamp('expires_at', { withTimezone: true }),
  revokedAt:             timestamp('revoked_at', { withTimezone: true }),
  revokedBy:             text('revoked_by'),
  revokeReason:          text('revoke_reason'),
  createdAt:             timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  createdBy:             text('created_by'),
  auditChainHash:        text('audit_chain_hash'),
  metadata:              jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
}, (t) => ({
  docIdx:     index('idx_doc_share_grants_doc').on(t.documentId),
  ownerIdx:   index('idx_doc_share_grants_owner').on(t.ownerOrgId, t.ownerPlatformCode, t.createdAt),
  grantedIdx: index('idx_doc_share_grants_granted').on(t.grantedToPlatformCode, t.grantedToOrgId, t.documentId),
}));

export type NvDocShareGrant    = InferSelectModel<typeof nvDocShareGrants>;
export type NewNvDocShareGrant = InferInsertModel<typeof nvDocShareGrants>;

// ════════════════════════════════════════════════════════════════════════════
// V5.0.0 — In-memory → DB Persistence (Workstream #1, 2026-05-06)
// 12 new tables across 5 services. nv_schema namespace (governance/audit).
// ════════════════════════════════════════════════════════════════════════════

// ── Federated Privacy (P0 — ε-budget MUST survive restart) ──────────────────
export const nvFedSessions = nvSchema.table('nv_fed_sessions', {
  sessionId:          varchar('session_id', { length: 64 }).primaryKey(),
  clientId:           varchar('client_id', { length: 128 }).notNull(),
  modelType:          varchar('model_type', { length: 64 }).notNull(),
  status:             varchar('status', { length: 24 }).notNull().default('initialized'),
  participantCount:   integer('participant_count').notNull().default(0),
  epsilonBudget:      doublePrecision('epsilon_budget').notNull().default(1.0),
  epsilonConsumed:    doublePrecision('epsilon_consumed').notNull().default(0.0),
  jurisdiction:       varchar('jurisdiction', { length: 8 }),
  createdAt:          timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:          timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  clientIdx:  index('nv_fed_sessions_client_idx').on(t.clientId),
  statusIdx:  index('nv_fed_sessions_status_idx').on(t.status),
}));

export const nvFedGradients = nvSchema.table('nv_fed_gradients', {
  id:              bigserial('id', { mode: 'number' }).primaryKey(),
  sessionId:       varchar('session_id', { length: 64 }).notNull(),
  gradientVec:     jsonb('gradient_vec').$type<number[]>().notNull(),
  noiseAdded:      boolean('noise_added').notNull().default(false),
  noiseScale:      doublePrecision('noise_scale'),
  epsilonDelta:    doublePrecision('epsilon_delta').notNull().default(0.0),
  submittedAt:     timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index('nv_fed_gradients_session_idx').on(t.sessionId),
}));

export const nvFedAggregated = nvSchema.table('nv_fed_aggregated_models', {
  sessionId:        varchar('session_id', { length: 64 }).primaryKey(),
  aggregatedVec:    jsonb('aggregated_vec').$type<number[]>().notNull(),
  participantCount: integer('participant_count').notNull(),
  noiseAdded:       boolean('noise_added').notNull().default(true),
  completedAt:      timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── ClaWdBot ────────────────────────────────────────────────────────────────
export const nvClawdbotBots = nvSchema.table('nv_clawdbot_bots', {
  botId:        varchar('bot_id', { length: 32 }).primaryKey(),
  orgId:        varchar('org_id', { length: 64 }).notNull(),
  name:         varchar('name', { length: 255 }).notNull(),
  config:       jsonb('config').$type<Record<string, unknown>>().notNull(),
  status:       varchar('status', { length: 24 }).notNull().default('draft'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:    timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('nv_clawdbot_bots_org_idx').on(t.orgId, t.status),
}));

export const nvClawdbotConversations = nvSchema.table('nv_clawdbot_conversations', {
  conversationId: varchar('conversation_id', { length: 64 }).primaryKey(),
  botId:          varchar('bot_id', { length: 32 }).notNull(),
  orgId:          varchar('org_id', { length: 64 }),
  data:           jsonb('data').$type<Record<string, unknown>>().notNull(),
  status:         varchar('status', { length: 24 }).notNull().default('active'),
  startedAt:      timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt:  timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  botIdx: index('nv_clawdbot_conv_bot_idx').on(t.botId, t.lastMessageAt),
}));

// ── OpenBot ──────────────────────────────────────────────────────────────────
// task-236: explicit `org_id` column on channels/routes/inbox so multi-tenant
// queries can filter server-side and survive gateway restarts. The in-memory
// `Map`s in `openbot-service.ts` are a cache; the DB is the source of truth.
export const nvOpenbotChannels = nvSchema.table('nv_openbot_channels', {
  channelId:   varchar('channel_id', { length: 32 }).primaryKey(),
  channelType: varchar('channel_type', { length: 32 }).notNull(),
  orgId:       varchar('org_id', { length: 64 }),
  config:      jsonb('config').$type<Record<string, unknown>>().notNull(),
  status:      varchar('status', { length: 24 }).notNull().default('active'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('nv_openbot_channels_org_idx').on(t.orgId, t.status),
}));

export const nvOpenbotRoutes = nvSchema.table('nv_openbot_routes', {
  ruleId:    varchar('rule_id', { length: 32 }).primaryKey(),
  orgId:     varchar('org_id', { length: 64 }),
  rule:      jsonb('rule').$type<Record<string, unknown>>().notNull(),
  isActive:  boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('nv_openbot_routes_org_idx').on(t.orgId, t.isActive),
}));

export const nvOpenbotInbox = nvSchema.table('nv_openbot_inbox', {
  messageId:  varchar('message_id', { length: 64 }).primaryKey(),
  channelId:  varchar('channel_id', { length: 32 }).notNull(),
  orgId:      varchar('org_id', { length: 64 }),
  message:    jsonb('message').$type<Record<string, unknown>>().notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chanIdx: index('nv_openbot_inbox_chan_idx').on(t.channelId, t.receivedAt),
  orgIdx:  index('nv_openbot_inbox_org_idx').on(t.orgId, t.receivedAt),
}));

// ── AutomateAI ───────────────────────────────────────────────────────────────
export const nvAutomateaiWorkflows = nvSchema.table('nv_automateai_workflows', {
  workflowId: varchar('workflow_id', { length: 48 }).primaryKey(),
  orgId:      varchar('org_id', { length: 64 }).notNull(),
  definition: jsonb('definition').$type<Record<string, unknown>>().notNull(),
  status:     varchar('status', { length: 24 }).notNull().default('draft'),
  version:    integer('version').notNull().default(1),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('nv_automateai_wf_org_idx').on(t.orgId, t.status),
}));

export const nvAutomateaiRuns = nvSchema.table('nv_automateai_runs', {
  executionId: varchar('execution_id', { length: 64 }).primaryKey(),
  workflowId:  varchar('workflow_id', { length: 48 }).notNull(),
  data:        jsonb('data').$type<Record<string, unknown>>().notNull(),
  status:      varchar('status', { length: 24 }).notNull(),
  startedAt:   timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  wfIdx: index('nv_automateai_runs_wf_idx').on(t.workflowId, t.startedAt),
}));

// ── TwinDesk ─────────────────────────────────────────────────────────────────
export const nvTwindeskTwins = nvSchema.table('nv_twindesk_twins', {
  twinId:    varchar('twin_id', { length: 48 }).primaryKey(),
  orgId:     varchar('org_id', { length: 64 }).notNull(),
  profile:   jsonb('profile').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgIdx: index('nv_twindesk_twins_org_idx').on(t.orgId),
}));

export const nvTwindeskScenarios = nvSchema.table('nv_twindesk_scenarios', {
  scenarioId:  varchar('scenario_id', { length: 64 }).primaryKey(),
  twinId:      varchar('twin_id', { length: 48 }).notNull(),
  data:        jsonb('data').$type<Record<string, unknown>>().notNull(),
  simulatedAt: timestamp('simulated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  twinIdx: index('nv_twindesk_scen_twin_idx').on(t.twinId, t.simulatedAt),
}));

// Task #223 — persona chat sessions (separate from one-shot simulations).
export const nvTwindeskChatSessions = nvSchema.table('nv_twindesk_chat_sessions', {
  sessionId:      varchar('session_id', { length: 64 }).primaryKey(),
  twinId:         varchar('twin_id', { length: 48 }).notNull(),
  data:           jsonb('data').$type<Record<string, unknown>>().notNull(),
  startedAt:      timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastMessageAt:  timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  twinIdx: index('nv_twindesk_chat_twin_idx').on(t.twinId, t.lastMessageAt),
}));

// ── Compliance Action Manager (CAM) — Task #190 / migration 0009 ────────────
// Public-schema table backing /api/jrx/cam/reviews. Previously created at
// runtime via CREATE TABLE IF NOT EXISTS in jrx-cam-routes.ts; now defined here
// and shipped via drizzle/0009_cam_actions.sql so prod RDS gets it during the
// next schema sync and the table appears in Drizzle introspection.
export const nvCamActions = pgTable('nv_cam_actions', {
  id:           serial('id').primaryKey(),
  actionId:     varchar('action_id', { length: 64 }).unique().notNull(),
  orgId:        varchar('org_id', { length: 100 }),
  customerOrgId: bigint('customer_org_id', { mode: 'number' }),
  framework:    varchar('framework', { length: 64 }),
  controlId:    varchar('control_id', { length: 100 }),
  severity:     varchar('severity', { length: 20 }).default('medium'),
  status:       varchar('status', { length: 20 }).default('pending'),
  title:        varchar('title', { length: 255 }).notNull(),
  description:  text('description'),
  assignedTo:   varchar('assigned_to', { length: 100 }),
  triggeredBy:  varchar('triggered_by', { length: 100 }),
  evidenceRef:  varchar('evidence_ref', { length: 255 }),
  metadata:     jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt:    timestamp('created_at').defaultNow(),
  updatedAt:    timestamp('updated_at').defaultNow(),
  reviewedAt:   timestamp('reviewed_at'),
  reviewedBy:   varchar('reviewed_by', { length: 100 }),
}, (t) => ({
  statusIdx: index('idx_nv_cam_actions_status').on(t.status, t.createdAt),
}));

export type NvCamAction = InferSelectModel<typeof nvCamActions>;
export type NewNvCamAction = InferInsertModel<typeof nvCamActions>;

// ── Per-Org Console Layout — Task #214 / migration 0008 ────────────────────
// Public-schema table backing /api/jrx/admin/org-console-layout/*. Previously
// created at runtime via CREATE TABLE IF NOT EXISTS in
// jrx-org-console-layout-routes.ts; now defined here and shipped via
// drizzle/0008_org_console_layout.sql so prod RDS gets it during the next
// schema sync and the table appears in Drizzle introspection / db:parity.
export const nvOrgConsoleLayout = pgTable('nv_org_console_layout', {
  orgId:            varchar('org_id', { length: 96 }).primaryKey(),
  displayName:      varchar('display_name', { length: 120 }),
  brandPrimaryHex:  varchar('brand_primary_hex', { length: 7 }),
  brandAccentHex:   varchar('brand_accent_hex', { length: 7 }),
  logoUrl:          text('logo_url'),
  defaultLanding:   varchar('default_landing', { length: 200 }),
  sidebarSections:  jsonb('sidebar_sections').$type<Record<string, boolean>>().notNull().default({}),
  hiddenRoutes:     jsonb('hidden_routes').$type<string[]>().notNull().default([]),
  featureOverrides: jsonb('feature_overrides').$type<Record<string, boolean>>().notNull().default({}),
  notes:            text('notes'),
  updatedBy:        varchar('updated_by', { length: 120 }),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  updatedIdx: index('idx_nv_org_console_layout_updated').on(t.updatedAt),
}));

export type NvOrgConsoleLayout = InferSelectModel<typeof nvOrgConsoleLayout>;
export type NewNvOrgConsoleLayout = InferInsertModel<typeof nvOrgConsoleLayout>;

export type NvFedSession = InferSelectModel<typeof nvFedSessions>;
export type NewNvFedSession = InferInsertModel<typeof nvFedSessions>;
export type NvClawdbotBot = InferSelectModel<typeof nvClawdbotBots>;
export type NvAutomateaiWorkflow = InferSelectModel<typeof nvAutomateaiWorkflows>;

// ═══════════════════════════════════════════════════════════════════════════════
// Security Audit Persistence — task #262 / migration 0011
// ═══════════════════════════════════════════════════════════════════════════════
// Backs src/packages/security/security-audit-persistence-service.ts.
//
// Until task #262 these six tables were stubbed in the persistence service
// (a local `db` no-op + `Tbl = {} as ...` shapes). Every logSecurityAudit /
// logPiiDetections / saveComplianceReport / etc. call appeared to succeed
// while silently dropping the row, so audit & compliance evidence never
// landed on disk. Real Drizzle bindings + a migration (drizzle/0011) make
// the writes durable and visible to introspection / schema-parity checks.
//
// All six tables live under nv_schema (governance / SDK runtime ownership),
// matching nvAuditLogsHashChain and the AutomateAI/ClaWdBot/etc. families.

export const nvSecurityAuditLogs = nvSchema.table('nv_security_audit_logs', {
  id:                serial('id').primaryKey(),
  scanType:          varchar('scan_type', { length: 64 }).notNull(),
  targetType:        varchar('target_type', { length: 32 }).notNull(),
  severity:          varchar('severity', { length: 16 }).notNull(),
  vulnerabilityType: varchar('vulnerability_type', { length: 64 }).notNull(),
  owaspId:           varchar('owasp_id', { length: 32 }).notNull(),
  cweId:             varchar('cwe_id', { length: 32 }),
  title:             varchar('title', { length: 255 }).notNull(),
  description:       text('description').notNull(),
  location:          text('location').notNull(),
  evidence:          text('evidence'),
  recommendation:    text('recommendation').notNull(),
  rawData:           jsonb('raw_data').$type<Record<string, unknown>>().default({}),
  agentId:           varchar('agent_id', { length: 100 }),
  userId:            varchar('user_id', { length: 100 }),
  projectId:         varchar('project_id', { length: 100 }),
  resolved:          boolean('resolved').notNull().default(false),
  resolvedAt:        timestamp('resolved_at', { withTimezone: true }),
  resolvedBy:        varchar('resolved_by', { length: 100 }),
  createdAt:         timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:         timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  createdIdx:  index('nv_security_audit_logs_created_idx').on(t.createdAt),
  severityIdx: index('nv_security_audit_logs_severity_idx').on(t.severity, t.createdAt),
  resolvedIdx: index('nv_security_audit_logs_resolved_idx').on(t.resolved, t.createdAt),
}));

export const nvPiiDetections = nvSchema.table('nv_pii_detections', {
  id:            serial('id').primaryKey(),
  auditLogId:    integer('audit_log_id').notNull(),
  piiType:       varchar('pii_type', { length: 32 }).notNull(),
  confidence:    integer('confidence').notNull(),
  locationStart: integer('location_start').notNull(),
  locationEnd:   integer('location_end').notNull(),
  redactedValue: text('redacted_value'),
  context:       text('context'),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  auditIdx: index('nv_pii_detections_audit_idx').on(t.auditLogId),
}));

export const nvComplianceReports = nvSchema.table('nv_compliance_reports', {
  id:               serial('id').primaryKey(),
  standard:         varchar('standard', { length: 32 }).notNull(),
  reportType:       varchar('report_type', { length: 32 }).notNull(),
  dateRangeStart:   timestamp('date_range_start', { withTimezone: true }).notNull(),
  dateRangeEnd:     timestamp('date_range_end', { withTimezone: true }).notNull(),
  compliant:        boolean('compliant').notNull().default(false),
  criticalFindings: integer('critical_findings').notNull().default(0),
  highFindings:     integer('high_findings').notNull().default(0),
  mediumFindings:   integer('medium_findings').notNull().default(0),
  lowFindings:      integer('low_findings').notNull().default(0),
  infoFindings:     integer('info_findings').notNull().default(0),
  totalFindings:    integer('total_findings').notNull().default(0),
  findings:         jsonb('findings').$type<unknown[]>().default([]),
  recommendations:  jsonb('recommendations').$type<unknown>().default([]),
  evidenceSources:  jsonb('evidence_sources').$type<Record<string, unknown>>().default({}),
  generatedBy:      varchar('generated_by', { length: 100 }),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  standardIdx: index('nv_compliance_reports_standard_idx').on(t.standard, t.createdAt),
}));

export const nvAttackSimulations = nvSchema.table('nv_attack_simulations', {
  id:          serial('id').primaryKey(),
  attackType:  varchar('attack_type', { length: 32 }).notNull(),
  targetAgent: varchar('target_agent', { length: 100 }).notNull(),
  payload:     text('payload').notNull(),
  response:    text('response'),
  successful:  boolean('successful').notNull().default(false),
  severity:    varchar('severity', { length: 16 }).notNull(),
  blocked:     boolean('blocked').notNull().default(false),
  mitigation:  text('mitigation'),
  techniques:  jsonb('techniques').$type<string[]>().default([]),
  metadata:    jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  agentIdx: index('nv_attack_simulations_agent_idx').on(t.targetAgent, t.createdAt),
}));

export const nvVulnerabilityHistory = nvSchema.table('nv_vulnerability_history', {
  id:               serial('id').primaryKey(),
  vulnerabilityId:  varchar('vulnerability_id', { length: 100 }).notNull(),
  auditLogId:       integer('audit_log_id').notNull(),
  status:           varchar('status', { length: 32 }).notNull().default('discovered'),
  priority:         varchar('priority', { length: 16 }).notNull(),
  cvssScore:        real('cvss_score'),
  affectedSystems:  jsonb('affected_systems').$type<string[]>().default([]),
  assignedTo:       varchar('assigned_to', { length: 100 }),
  notes:            text('notes'),
  createdAt:        timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:        timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  vulnIdx:   uniqueIndex('nv_vulnerability_history_vuln_idx').on(t.vulnerabilityId),
  statusIdx: index('nv_vulnerability_history_status_idx').on(t.status, t.updatedAt),
}));

export const nvSecurityMetrics = nvSchema.table('nv_security_metrics', {
  id:                       serial('id').primaryKey(),
  metricDate:               timestamp('metric_date', { withTimezone: true }).notNull(),
  totalScans:               integer('total_scans').notNull().default(0),
  promptInjectionAttempts:  integer('prompt_injection_attempts').notNull().default(0),
  piiLeaks:                 integer('pii_leaks').notNull().default(0),
  maliciousCodeDetected:    integer('malicious_code_detected').notNull().default(0),
  jailbreakAttempts:        integer('jailbreak_attempts').notNull().default(0),
  dataExtractionAttempts:   integer('data_extraction_attempts').notNull().default(0),
  criticalVulnerabilities:  integer('critical_vulnerabilities').notNull().default(0),
  highVulnerabilities:      integer('high_vulnerabilities').notNull().default(0),
  mediumVulnerabilities:    integer('medium_vulnerabilities').notNull().default(0),
  lowVulnerabilities:       integer('low_vulnerabilities').notNull().default(0),
  meanTimeToDetect:         integer('mean_time_to_detect'),
  meanTimeToResolve:        integer('mean_time_to_resolve'),
  complianceScore:          real('compliance_score'),
  metadata:                 jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt:                timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  dateIdx: uniqueIndex('nv_security_metrics_date_idx').on(t.metricDate),
}));

export type NvSecurityAuditLog       = InferSelectModel<typeof nvSecurityAuditLogs>;
export type NewNvSecurityAuditLog    = InferInsertModel<typeof nvSecurityAuditLogs>;
export type NvPiiDetection           = InferSelectModel<typeof nvPiiDetections>;
export type NewNvPiiDetection        = InferInsertModel<typeof nvPiiDetections>;
export type NvComplianceReport       = InferSelectModel<typeof nvComplianceReports>;
export type NewNvComplianceReport    = InferInsertModel<typeof nvComplianceReports>;
export type NvAttackSimulation       = InferSelectModel<typeof nvAttackSimulations>;
export type NewNvAttackSimulation    = InferInsertModel<typeof nvAttackSimulations>;
export type NvVulnerabilityHistory   = InferSelectModel<typeof nvVulnerabilityHistory>;
export type NewNvVulnerabilityHistory = InferInsertModel<typeof nvVulnerabilityHistory>;
export type NvSecurityMetric         = InferSelectModel<typeof nvSecurityMetrics>;
export type NewNvSecurityMetric      = InferInsertModel<typeof nvSecurityMetrics>;

// ── NV-CASE-MASTER-DATA-001 — jurisdiction master data (Appendix F) ──────────
// Static reference tables that let the CNR resolve path prefill courtType /
// courtName / stateName / districtName / complexName when the corpus row does
// not publish them. These are deterministic reference joins — they NEVER set
// claimEcourts: true. Seeded by migrations/2026-09-24-jrx-jurisdiction-master.sql
// (raw SQL kept in exact parity with these Drizzle declarations for the
// NV-SCHEMA-DRIFT-001 guardrail). See documents/working/
// JRX-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md Appendix F.

/** 1) CNR prefix rules: first 4/6 chars of an eCourts CNR → tier + state + establishment. */
export const nvCnrPrefixRules = pgTable('nv_cnr_prefix_rules', {
  cnrPrefix:     varchar('cnr_prefix', { length: 6 }).primaryKey(),   // 'APHC' / 'APHC01'
  stateCode:     varchar('state_code', { length: 2 }).notNull(),      // 'AP'
  courtTier:     varchar('court_tier', { length: 2 }).notNull(),      // 'HC' | 'CT' | 'IN'
  courtType:     varchar('court_type', { length: 2 }).notNull(),      // 'HC' | 'SC' | 'DC'
  benchCode:     varchar('bench_code', { length: 16 }),               // 'aphc'
  establishment: varchar('establishment', { length: 200 }),
  ssotSource:    varchar('ssot_source', { length: 40 }).notNull().default('ecourts_open_data'),
  updatedAt:     timestamp('updated_at').notNull().defaultNow(),
});

/** 2) Court jurisdictions: bench/court_code → canonical court + state. */
export const nvCourtJurisdictions = pgTable('nv_court_jurisdictions', {
  benchCode:  varchar('bench_code', { length: 16 }).primaryKey(),     // 'aphc'
  courtCode:  varchar('court_code', { length: 16 }),                  // '28_2'
  courtId:    varchar('court_id', { length: 80 }),                    // 'IN-HC-AP' (FK to nv_courts in SQL)
  courtName:  varchar('court_name', { length: 300 }).notNull(),
  courtType:  varchar('court_type', { length: 2 }).notNull(),
  stateName:  varchar('state_name', { length: 120 }),
  ssotSource: varchar('ssot_source', { length: 40 }).notNull().default('ecourts_open_data'),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
});

/** 3) Case-type codes: short code → display name, scoped by tier (+ optional state). */
export const nvCaseTypeCodes = pgTable('nv_case_type_codes', {
  code:        varchar('code', { length: 24 }).notNull(),             // 'CRLP' / 'WP(C)'
  courtType:   varchar('court_type', { length: 2 }).notNull(),        // 'HC' | 'SC' | 'DC'
  stateCode:   varchar('state_code', { length: 2 }).notNull().default(''), // '' = any state
  displayName: varchar('display_name', { length: 200 }).notNull(),    // 'Criminal Petition'
  ssotSource:  varchar('ssot_source', { length: 40 }).notNull().default('manual_sme'),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.code, t.courtType, t.stateCode] }),
}));

/** 4) District master: state + district/establishment code → district + default complex. */
export const nvDistrictMaster = pgTable('nv_district_master', {
  stateCode:      varchar('state_code', { length: 2 }).notNull(),     // 'TS'
  districtCode:   varchar('district_code', { length: 4 }).notNull(),  // establishment/district code
  districtName:   varchar('district_name', { length: 120 }).notNull(),// 'Warangal'
  defaultComplex: varchar('default_complex', { length: 200 }),
  ssotSource:     varchar('ssot_source', { length: 40 }).notNull().default('ecourts_open_data'),
  updatedAt:      timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.stateCode, t.districtCode] }),
}));

export type NvCnrPrefixRule       = InferSelectModel<typeof nvCnrPrefixRules>;
export type NewNvCnrPrefixRule    = InferInsertModel<typeof nvCnrPrefixRules>;
export type NvCourtJurisdiction   = InferSelectModel<typeof nvCourtJurisdictions>;
export type NewNvCourtJurisdiction = InferInsertModel<typeof nvCourtJurisdictions>;
export type NvCaseTypeCode         = InferSelectModel<typeof nvCaseTypeCodes>;
export type NewNvCaseTypeCode      = InferInsertModel<typeof nvCaseTypeCodes>;
export type NvDistrictMaster       = InferSelectModel<typeof nvDistrictMaster>;
export type NewNvDistrictMaster    = InferInsertModel<typeof nvDistrictMaster>;

/**
 * 5) Court complexes: the all-India district-court complex master (NV-COURT-MASTER-P0-001).
 * Seeded from the open `vanga/indian-district-court-judgments` `courts.csv`
 * (~3,566 complexes / ~714 districts / 36 states) by
 * scripts/jrx-seed-court-master-p0.ts. Keyed by the eCourts numeric
 * (state_code, district_code, complex_code) triple — this is the DC cascade
 * source (court type → state → district → complex) that powers the partner
 * lookup routes in src/routes/jrx-court-master-routes.ts. Complementary to
 * nv_district_master (which is keyed by CNR establishment letters like 'WL'
 * for the resolve-path prefill); this table is the numeric eCourts hierarchy.
 * Static reference joins only — never claims live eCourts. Raw SQL kept in
 * exact parity with migrations/2026-09-25-jrx-court-complexes.sql
 * (NV-SCHEMA-DRIFT-001). See NSP-CASE-SEARCH-INTEGRATION-2026-09.md §18 and
 * JRX-CASE-CORPUS-FIELD-GAP-PLAN-2026-09.md Appendix F.
 */
export const nvCourtComplexes = pgTable('nv_court_complexes', {
  stateCode:    varchar('state_code', { length: 4 }).notNull(),        // '2' (eCourts numeric)
  districtCode: varchar('district_code', { length: 8 }).notNull(),     // '2'
  complexCode:  varchar('complex_code', { length: 16 }).notNull(),     // '1020002'
  stateName:    varchar('state_name', { length: 120 }).notNull(),      // 'Andhra Pradesh'
  districtName: varchar('district_name', { length: 120 }).notNull(),   // 'Ananthapur'
  complexName:  varchar('complex_name', { length: 300 }).notNull(),    // 'District Court Complex, …'
  courtType:    varchar('court_type', { length: 2 }).notNull().default('DC'),
  courtNumbers: varchar('court_numbers', { length: 200 }),             // '11,12' (comma list)
  flag:         varchar('flag', { length: 8 }),                        // 'N' / 'Y'
  ssotSource:   varchar('ssot_source', { length: 40 }).notNull().default('ecourts_open_data'),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.stateCode, t.districtCode, t.complexCode] }),
}));

export type NvCourtComplex         = InferSelectModel<typeof nvCourtComplexes>;
export type NewNvCourtComplex      = InferInsertModel<typeof nvCourtComplexes>;

/**
 * 6) DC case-status decode master (NV-DC-STATUS-DECODE-001). DC rows publish a
 * numeric eCourts `case_status`; the numeric→label master is the NJDG
 * `t_case_status` table (not in corpus yet). Seeded with VERIFIABLE text
 * disposal/stage buckets only (numeric_code NULL until NJDG). Raw SQL kept in
 * parity with migrations/2026-09-25-jrx-dc-case-status-codes.sql (NV-SCHEMA-DRIFT-001).
 * See src/services/jrx-dc-status-codes.ts and NSP-CASE-SEARCH-INTEGRATION §22.
 */
export const nvDcCaseStatusCodes = pgTable('nv_dc_case_status_codes', {
  statusKey:   varchar('status_key', { length: 48 }).primaryKey(),      // label token / numeric code
  numericCode: varchar('numeric_code', { length: 12 }),                 // eCourts numeric (NULL until NJDG)
  label:       varchar('label', { length: 120 }).notNull(),
  category:    varchar('category', { length: 24 }).notNull(),           // disposed|pending|unknown
  ssotSource:  varchar('ssot_source', { length: 40 }).notNull().default('manual_sme'),
  updatedAt:   timestamp('updated_at').notNull().defaultNow(),
});

export type NvDcCaseStatusCode    = InferSelectModel<typeof nvDcCaseStatusCodes>;
export type NewNvDcCaseStatusCode = InferInsertModel<typeof nvDcCaseStatusCodes>;

/**
 * 7) DC establishment crosswalk (NV-DC-ESTAB-CROSSWALK-001). Maps CNR letters
 * (state pos 1–2, district/establishment pos 3–4) → eCourts NUMERIC codes so a
 * pasted DC CNR can prefill courtCode/complexCode + district/complex names.
 * Numeric codes come from the courts.csv-seeded nv_court_complexes (not invented).
 * Raw SQL kept in parity with migrations/2026-09-25-jrx-dc-establishment-crosswalk.sql
 * (NV-SCHEMA-DRIFT-001). Static reference join — never claims live eCourts.
 */
export const nvDcEstablishmentCrosswalk = pgTable('nv_dc_establishment_crosswalk', {
  stateLetters: varchar('state_letters', { length: 2 }).notNull(),     // 'TS'
  estabLetters: varchar('estab_letters', { length: 2 }).notNull(),     // 'WL'
  stateCode:    varchar('state_code', { length: 4 }),                  // eCourts numeric
  districtCode: varchar('district_code', { length: 8 }),
  complexCode:  varchar('complex_code', { length: 16 }),
  courtCode:    varchar('court_code', { length: 16 }),
  stateName:    varchar('state_name', { length: 120 }),
  districtName: varchar('district_name', { length: 120 }),
  complexName:  varchar('complex_name', { length: 300 }),
  ssotSource:   varchar('ssot_source', { length: 40 }).notNull().default('ecourts_open_data'),
  updatedAt:    timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.stateLetters, t.estabLetters] }),
}));

export type NvDcEstablishmentCrosswalk    = InferSelectModel<typeof nvDcEstablishmentCrosswalk>;
export type NewNvDcEstablishmentCrosswalk = InferInsertModel<typeof nvDcEstablishmentCrosswalk>;

/**
 * 8) HC/SC order-PDF → owned-S3 mapping (NV-HC-ORDER-PRESIGN-001). HC
 * `finalOrders[]`/`interimOrders[]` records carry a raw eCourts-portal
 * `filename` with NO matching object in the public judgment buckets. An
 * order-mirror job (caselaw-worker, ops GO) copies the PDF into an OWNED bucket
 * under a deterministic key and records it here; the JRX adapter presigns ONLY
 * when a row exists AND the bucket is allowlisted (never a non-existent key).
 * Raw SQL kept in parity with migrations/2026-09-25-jrx-hc-order-s3-map.sql
 * (NV-SCHEMA-DRIFT-001). Idempotent.
 */
export const nvHcOrderS3Map = pgTable('nv_hc_order_s3_map', {
  cnr:        varchar('cnr', { length: 24 }).notNull(),          // owning CNR
  orderPath:  varchar('order_path', { length: 512 }).notNull(),  // raw eCourts order filename
  s3Bucket:   varchar('s3_bucket', { length: 120 }).notNull(),   // owned bucket (allowlisted)
  s3Key:      varchar('s3_key', { length: 1024 }).notNull(),     // deterministic mirrored key
  orderKind:  varchar('order_kind', { length: 12 }).notNull().default('final'), // final|interim
  orderId:    varchar('order_id', { length: 24 }),
  orderDate:  date('order_date'),
  ssotSource: varchar('ssot_source', { length: 40 }).notNull().default('nv_hc_order_mirror'),
  updatedAt:  timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.cnr, t.orderPath] }),
}));

export type NvHcOrderS3Map    = InferSelectModel<typeof nvHcOrderS3Map>;
export type NewNvHcOrderS3Map = InferInsertModel<typeof nvHcOrderS3Map>;
