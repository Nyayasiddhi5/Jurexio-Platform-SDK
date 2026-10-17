/**
 * nv-api-paths.ts — single source of truth for every backend endpoint the Console calls.
 *
 * Why this exists:
 *   The 2026-05-12 audit found ~30 sidebar pages calling /api/jrx/* paths that
 *   don't match the real backend mounts (e.g. /api/jrx/admin/orgs was
 *   really /api/jrx/admin/orgs; /api/jrx/llm/status was really /api/jrx/llm/status).
 *   Each page hardcoded its own path → drift was inevitable.
 *
 * Rule (NV-CONTRACT-001 corollary):
 *   New code MUST import paths from this registry — never hardcode `/api/jrx/...`
 *   strings in pages or components. CI-enforced via the
 *   `no-hardcoded-api-paths` ESLint rule (see `eslint-rules/no-hardcoded-api-paths.js`
 *   and `client/.eslintrc.json`). The rule flags any string literal or template
 *   element matching `/\/api\/nv\//` anywhere in `client/src/**` *except* this
 *   file. Use `p('KEY')` or `NV_API.KEY.path` instead.
 *
 * Path status legend:
 *   LIVE          — backend confirmed 200 as super_admin
 *   AUTH_GATED    — backend exists but RBAC may 403 for non-super_admin (page must handle gracefully)
 *   NEEDS_BACKEND — frontend page exists, backend route does not yet exist; consumer MUST render an
 *                   empty-state with `Coming soon — backend pending` instead of error toast.
 */

export type PathStatus = 'LIVE' | 'AUTH_GATED' | 'NEEDS_BACKEND';

export interface ApiPath {
  path: string;
  status: PathStatus;
  /** When backend exists at a different path than the legacy frontend expected */
  legacyAlias?: string;
  /** Brief note about backend mount or planned status */
  note?: string;
}

/* eslint-disable @typescript-eslint/naming-convention */
export const NV_API = {
  // ─────────── AUTH ───────────
  AUTH_LOGIN:      { path: '/api/auth/login',  status: 'LIVE' },
  AUTH_LOGOUT:     { path: '/api/auth/logout', status: 'LIVE' },
  AUTH_ME:         { path: '/api/jrx/auth/me',  status: 'LIVE', legacyAlias: '/api/auth/me' },
  AUTH_REGISTER:   { path: '/api/auth/signup', status: 'LIVE' },

  // ─────────── HOME ───────────
  CHAT_SESSIONS:   { path: '/api/jrx/legal-chat',     status: 'LIVE',  legacyAlias: '/api/jrx/chat/sessions' },
  DOC_AI:          { path: '/api/jrx/doc-analyze',    status: 'LIVE',  legacyAlias: '/api/jrx/document-ai' },
  SKILLSHOP:       { path: '/api/jrx/skillshop',         status: 'LIVE',  legacyAlias: '/api/jrx/skills', note: 'SkillShop catalogue + install at /api/jrx/skillshop/*' },
  BILLING_SUB:     { path: '/api/jrx/subscription',   status: 'LIVE',          legacyAlias: '/api/jrx/billing/subscription', note: 'Task #178 (B2): root GET aggregator added' },
  BILLING_LEDGER:  { path: '/api/jrx/credits',        status: 'LIVE',          legacyAlias: '/api/jrx/billing/ledger',       note: 'Task #178 (B2): root GET paged ledger added' },

  // ─────────── AGENTS ───────────
  AGENTS:                { path: '/api/jrx/agents',                       status: 'LIVE' },
  AGENT_REGISTRY:        { path: '/api/jrx/registry/agents',              status: 'LIVE' },
  AGENTS_STATS:          { path: '/api/jrx/agents',                       status: 'LIVE',  legacyAlias: '/api/jrx/agents', note: 'Compute stats client-side from /api/jrx/agents' },
  AGENT_PERSONAS:        { path: '/api/jrx/agent-personas',               status: 'LIVE' },
  ORCHESTRATION_DASH:    { path: '/api/jrx/orchestration/dashboard',      status: 'LIVE' },
  ACTIVITY_RECENT:       { path: '/api/jrx/activity/recent',              status: 'LIVE' },
  APPROVALS:             { path: '/api/jrx/admin/audit',                  status: 'LIVE',  legacyAlias: '/api/jrx/approvals', note: 'No HITL approvals queue; surface from audit log' },
  AGENT_SCORECARD:       { path: '/api/jrx/orchestration/dashboard',      status: 'LIVE',  legacyAlias: '/api/jrx/orchestration/dashboard', note: 'Compute scorecard from orchestration dashboard payload' },
  ROUTER_DECISIONS:      { path: '/api/jrx/orchestration/router-decisions', status: 'LIVE',  legacyAlias: '/api/jrx/orchestration/router-decisions', note: 'Task #176 (B2): aggregates public.nv_router_decisions' },
  ORCHESTRATION_PROTOCOLS: { path: '/api/jrx/orchestration/protocols',     status: 'LIVE', note: 'Task #170: protocol_registry rows for A2A page' },
  ORCHESTRATION_CHAINS:    { path: '/api/jrx/orchestration/chains',        status: 'LIVE', note: 'Task #170: nv_schema.agent_chains list for A2A/BMAD pages' },
  BMAD_TEMPLATES:          { path: '/api/jrx/orchestration/bmad/templates', status: 'LIVE', note: 'Task #170: canonical BMAD template catalog' },
  LINEAGE:               { path: '/api/jrx/orchestration/lineage',        status: 'LIVE',  legacyAlias: '/api/jrx/orchestration/lineage',        note: 'Task #176 (B2): aggregates nv_schema.data_lineage_events' },
  MEMORY:                { path: '/api/jrx/orchestration/memory',         status: 'LIVE',  legacyAlias: '/api/jrx/orchestration/memory',         note: 'Task #176 (B2): aggregates nv_schema.memory_entries' },
  POLICIES:              { path: '/api/jrx/orchestration/policies',       status: 'LIVE',  legacyAlias: '/api/jrx/orchestration/policies',       note: 'Task #176 (B2): aggregates nv_schema.nv_grpo_policy_snapshots' },
  CAM_REVIEWS:           { path: '/api/jrx/orchestration/cam/reviews',    status: 'LIVE',  legacyAlias: '/api/jrx/cam/reviews',                  note: 'Task #176 (B2) aggregator at /orchestration/cam/reviews; Task #190 reviewer queue still mounted at /api/jrx/cam/reviews on backend' },
  CAM_ENTRIES:           { path: '/api/jrx/cam/entries',                  status: 'LIVE',  note: 'mem0/CAM memory browser — compliance_reviewer+ JWT' },
  CAM_STATS:             { path: '/api/jrx/cam/stats',                    status: 'LIVE',  note: 'CAM aggregate stats for Memory Browser tiles' },
  CAM_REVIEW_APPROVE:    { path: '/api/jrx/cam/reviews/:actionId/approve', status: 'LIVE', note: 'Task #200: POST — approve a pending CAM action (audit-chained)' },
  CAM_REVIEW_REJECT:     { path: '/api/jrx/cam/reviews/:actionId/reject',  status: 'LIVE', note: 'Task #200: POST {reason} — reject a pending CAM action (audit-chained)' },
  CAM_REVIEW_ASSIGN:     { path: '/api/jrx/cam/reviews/:actionId/assign',  status: 'LIVE', note: 'Task #200: POST {assignee} — reassign a CAM action (audit-chained)' },

  CLAWDBOT:                 { path: '/api/jrx/clawdbot',                       status: 'LIVE', note: 'Mounted at src/index.ts:928 — base for sub-paths below' },
  CLAWDBOT_BOTS:            { path: '/api/jrx/clawdbot/bots',                  status: 'LIVE' },
  CLAWDBOT_BOT:             { path: '/api/jrx/clawdbot/bots/:botId',           status: 'LIVE' },
  CLAWDBOT_CHAT:            { path: '/api/jrx/clawdbot/bots/:botId/chat',      status: 'LIVE' },
  CLAWDBOT_ACTIVATE:        { path: '/api/jrx/clawdbot/bots/:botId/activate',  status: 'LIVE' },
  CLAWDBOT_PAUSE:           { path: '/api/jrx/clawdbot/bots/:botId/pause',     status: 'LIVE' },
  CLAWDBOT_ANALYTICS:       { path: '/api/jrx/clawdbot/bots/:botId/analytics', status: 'LIVE' },
  CLAWDBOT_WHATSAPP_HOOK:   { path: '/api/jrx/clawdbot/webhooks/whatsapp/:botId', status: 'LIVE' },
  OPENBOT:                  { path: '/api/jrx/openbot',                        status: 'LIVE', note: 'Mounted at src/index.ts:931' },
  OPENBOT_CHANNELS:         { path: '/api/jrx/openbot/channels',               status: 'LIVE' },
  OPENBOT_CHANNEL_SEND:     { path: '/api/jrx/openbot/channels/:channelId/send', status: 'LIVE' },
  OPENBOT_CHANNEL_INBOX:    { path: '/api/jrx/openbot/channels/:channelId/inbox', status: 'LIVE' },
  OPENBOT_INBOX:            { path: '/api/jrx/openbot/inbox',                  status: 'LIVE' },
  OPENBOT_RULES:            { path: '/api/jrx/openbot/rules',                  status: 'LIVE' },
  AUTOMATEAI:               { path: '/api/jrx/automateai',                     status: 'LIVE', note: 'Mounted at src/index.ts (automateAI router)' },
  AUTOMATEAI_WORKFLOWS:     { path: '/api/jrx/automateai/workflows',           status: 'LIVE' },
  AUTOMATEAI_WORKFLOW:      { path: '/api/jrx/automateai/workflows/:workflowId', status: 'LIVE' },
  AUTOMATEAI_EXECUTE:       { path: '/api/jrx/automateai/workflows/:workflowId/execute', status: 'LIVE' },
  AUTOMATEAI_EXECUTIONS:    { path: '/api/jrx/automateai/workflows/:workflowId/executions', status: 'LIVE' },
  AUTOMATEAI_EXECUTION:     { path: '/api/jrx/automateai/executions/:executionId', status: 'LIVE' },
  AUTOMATEAI_APPROVE:       { path: '/api/jrx/automateai/executions/:executionId/approve', status: 'LIVE' },
  AUTOMATEAI_GATE_TYPES:    { path: '/api/jrx/automateai/gate-types',          status: 'LIVE' },
  ORCHESTRATE:              { path: '/api/jrx/orchestrate',                  status: 'LIVE',          note: 'Canonical JWT-auth LLM orchestration entrypoint' },
  AGUI_STREAM:              { path: '/api/jrx/stream',                       status: 'LIVE',          note: 'Admin JWT AG-UI Queen stream — partner /orchestrate/stream stays sanitized' },
  CAM_TELEMETRY:            { path: '/api/nyayavigya/cam/dashboard',         status: 'LIVE',          note: 'CAM 2.0 telemetry (JWT)' },
  DIGITAL_TWIN:          { path: '/api/jrx/digital-twin',                 status: 'LIVE',  legacyAlias: '/api/jrx/digital-twin' },
  TWINDESK:                 { path: '/api/jrx/twindesk',                       status: 'LIVE', note: 'Mounted at src/index.ts:1002 — base for sub-paths below' },
  TWINDESK_TWINS:           { path: '/api/jrx/twindesk/twins',                 status: 'LIVE' },
  TWINDESK_TWIN:            { path: '/api/jrx/twindesk/twins/:twinId',         status: 'LIVE' },
  TWINDESK_SIMULATE:        { path: '/api/jrx/twindesk/twins/:twinId/simulate', status: 'LIVE' },
  TWINDESK_SIMULATIONS:     { path: '/api/jrx/twindesk/twins/:twinId/simulations', status: 'LIVE' },
  TWINDESK_CHAT:            { path: '/api/jrx/twindesk/twins/:twinId/chat',    status: 'LIVE' },
  TWINDESK_BENCHMARK:       { path: '/api/jrx/twindesk/twins/:twinId/benchmark', status: 'LIVE' },
  TWINDESK_PERSONAS:        { path: '/api/jrx/twindesk/personas',              status: 'LIVE' },

  // ─────────── INTELLIGENCE ───────────
  MODELS:                { path: '/api/jrx/models',                       status: 'LIVE' },
  MODEL_CATALOG:         { path: '/api/jrx/models',                       status: 'LIVE',  legacyAlias: '/api/jrx/models' },
  PROVIDERS:             { path: '/api/jrx/providers',                    status: 'LIVE',  legacyAlias: '/api/jrx/providers' },
  LLM_STATUS:            { path: '/api/jrx/llm/status',                   status: 'LIVE',  legacyAlias: '/api/jrx/llm/status' },
  LRM_DASHBOARD:         { path: '/api/jrx/orchestration/dashboard',      status: 'LIVE',  legacyAlias: '/api/jrx/orchestration/dashboard' },
  INTEL_CLASSIFY:        { path: '/api/jrx/intelligence/classify',        status: 'LIVE', note: 'task-175 B2: NLP wrapper via realLLMService.executeRequest (NV-LLM-001)' },
  INTEL_PREDICT:         { path: '/api/jrx/intelligence/predict',         status: 'LIVE', note: 'task-175 B2: NLP wrapper via realLLMService.executeRequest (NV-LLM-001)' },
  INTEL_SENTIMENT:       { path: '/api/jrx/intelligence/sentiment',       status: 'LIVE', note: 'task-175 B2: NLP wrapper via realLLMService.executeRequest (NV-LLM-001)' },
  INTEL_TRANSLATE:       { path: '/api/jrx/intelligence/translate',       status: 'LIVE', note: 'task-175 B2: NLP wrapper via realLLMService.executeRequest (NV-LLM-001)' },
  NER:                   { path: '/api/jrx/intelligence/ner',             status: 'LIVE', note: 'task-175 B2: NLP wrapper via realLLMService.executeRequest (NV-LLM-001)' },
  SUMMARIZE:             { path: '/api/jrx/intelligence/summarize',       status: 'LIVE', note: 'task-175 B2: NLP wrapper via realLLMService.executeRequest (NV-LLM-001)' },
  INTEL_FIRM_SNAPSHOT:   { path: '/api/jrx/v1/sdk/intelligence/firm-snapshot',     status: 'LIVE', note: 'task-199: GET — derives firm metrics (active cases, hearings 7d, post-hearing tasks, revenue YTD) from nv_cases / nv_hearing_metadata / nv_invoices, scoped via sdkContext.organizationId. task-337: dual-auth (X-API-Key OR Console JWT via sdkGatewayAuth JWT-bypass).' },
  MY_APPROVALS:          { path: '/api/jrx/my-approvals',                        status: 'LIVE', note: 'task-337 (2026-05-13): JWT-auth — list HITL items assigned to caller; POST /:request_id/decision records approve|reject|modify|escalate to nv_hitl_decisions and updates nv_hitl_queue.status' },
  MY_APPROVALS_DECISION: { path: '/api/jrx/my-approvals/:request_id/decision',   status: 'LIVE', note: 'task-337: POST {decision, reason?, policy_refs?, modified_output?}' },
  INTEL_DASHBOARD_INSIGHTS: { path: '/api/jrx/v1/sdk/intelligence/dashboard-insights', status: 'AUTH_GATED', note: 'AI morning briefing — requires firm snapshot' },

  // ─────────── KNOWLEDGE ───────────
  KNOWLEDGE:             { path: '/api/jrx/knowledge',                    status: 'LIVE' },
  KNOWLEDGE_STATUTES_SEARCH: { path: '/api/jrx/knowledge/statutes/search', status: 'LIVE', note: 'Instant Search statutes (SDK instantSearch.statutes)' },
  KNOWLEDGE_CASELAW_SEARCH:  { path: '/api/jrx/knowledge/caselaw/search',  status: 'LIVE', note: 'Instant Search caselaw; default mode=fts; ?mode=hybrid for vector+RRF' },
  KNOWLEDGE_CASELAW_TREATMENT: { path: '/api/jrx/knowledge/caselaw/treatment', status: 'LIVE', note: 'NV-CITATOR-NEGATIVE-TREATMENT-001: ?citation=&exact=true — negative-treatment check. Not a citator; never asserts good law' },
  KNOWLEDGE_STATUTES_ACTS:   { path: '/api/jrx/knowledge/statutes/acts',   status: 'LIVE', note: 'Act catalog for Instant Search' },
  KNOWLEDGE_RETRIEVE:        { path: '/api/jrx/knowledge/retrieve',        status: 'LIVE', note: 'POST retrieve on Enter' },
  LEGAL_INTEL_FEED:          { path: '/api/jrx/v1/sdk/legal-intelligence/feed', status: 'LIVE', note: 'Live Legal Feed digest (own RSS→S3/RDS/RAG)' },
  LEGAL_INTEL_FEED_HISTORY:  { path: '/api/jrx/v1/sdk/legal-intelligence/feed/history', status: 'LIVE' },
  LEGAL_INTEL_FEED_GENERATE: { path: '/api/jrx/v1/sdk/legal-intelligence/feed/generate', status: 'LIVE', note: 'POST generate digest' },
  INTELLIGENCE_REGULATORY_FEED: { path: '/api/jrx/intelligence/regulatory-feed', status: 'LIVE', note: 'Own nv_regulatory_feeds digest' },
  MATTER_VAULT:          { path: '/api/jrx/matter-vault',                 status: 'LIVE', note: 'Harvey-style matter review — list/create/upload-batch/run-playbook' },
  MATTER_VAULT_HEALTH:   { path: '/api/jrx/matter-vault/health',          status: 'LIVE' },
  PROMPTS:               { path: '/api/jrx/prompts',                      status: 'LIVE',          legacyAlias: '/api/jrx/prompts',         note: 'Task #178 (B2): paged template_library aggregator' },
  RAG_COLLECTIONS:       { path: '/api/jrx/rag/collections',              status: 'LIVE',          legacyAlias: '/api/jrx/rag/collections', note: 'Task #178 (B2): rag_namespaces aggregator' },
  STATUTES:              { path: '/api/jrx/statutes',                     status: 'LIVE',          note: 'Task #189: paged nv_statutes aggregator (jurisdiction filter, limit/offset)' },
  TOOLS:                 { path: '/api/jrx/tools',                        status: 'LIVE' },
  PROMPT_CATEGORIES:     { path: '/api/jrx/prompts/categories',           status: 'LIVE',          note: 'task-303 G3A: distinct categories with counts' },
  MCP_TOOL_CATALOG:      { path: '/api/jrx/nyaya-tools/catalog',          status: 'LIVE',          note: 'task-303 G3A: MCP catalog (502 tools, filterable)' },
  MCP_TOOL_TEST:         { path: '/api/jrx/nyaya-tools/test',             status: 'LIVE',          note: 'task-303 G3A: per-tool test-connection probe' },

  // ─────────── OPERATIONS ───────────
  HEALTH_FULL:           { path: '/api/jrx/health/full',                  status: 'LIVE' },
  PLATFORM_HEALTH:       { path: '/api/jrx/admin/platform-health',        status: 'LIVE' },
  OPERATIONS_OVERVIEW:   { path: '/api/jrx/operations/overview',          status: 'LIVE',  legacyAlias: '/api/jrx/admin/stats', note: 'Task #177 B2 — analyst+ aggregator route' },
  COST_OVERVIEW:         { path: '/api/jrx/cost/overview',                status: 'LIVE',  legacyAlias: '/api/jrx/admin/stats', note: 'Task #177 B2 — super_admin aggregator route' },
  DRIFT:                 { path: '/api/jrx/drift',                        status: 'LIVE' },
  REGULATORY:            { path: '/api/jrx/regulatory',                   status: 'LIVE',  legacyAlias: '/api/jrx/admin/audit', note: 'Task #177 B2 — super_admin aggregator route' },
  PROVIDER_FAILOVER:     { path: '/api/jrx/providers/failover',           status: 'LIVE',  legacyAlias: '/api/jrx/llm/status', note: 'Task #177 B2 — analyst+ aggregator route' },
  OPS_ACTIVE_SESSIONS:   { path: '/api/jrx/operations/active-sessions',   status: 'LIVE', note: 'Task #302 — analyst+; last-5-minute SDK sessions from sdk_usage_metering' },
  OPS_PROVIDER_HEALTH:   { path: '/api/jrx/operations/provider-health',   status: 'LIVE', note: 'Task #302 — analyst+; per-provider success-rate + latency + cost (24h)' },
  OPS_RECENT_ERRORS:     { path: '/api/jrx/operations/recent-errors',     status: 'LIVE', note: 'Task #302 — analyst+; last 50 4xx/5xx with route/provider/model' },
  OPS_THROUGHPUT:        { path: '/api/jrx/operations/throughput',        status: 'LIVE', note: 'Task #302 — analyst+; rpm (60min) + rph (24h) buckets' },
  COST_SUGGESTIONS:      { path: '/api/jrx/cost/suggestions',             status: 'LIVE', note: 'Task #302 — super_admin; rule-based optimisation suggestions' },
  COST_TREND:            { path: '/api/jrx/cost/trend',                   status: 'LIVE', note: 'Task #302 — super_admin; daily spend/tokens/requests, default 7-day window' },

  // ─────────── GOVERNANCE ───────────
  HITL_QUEUE:            { path: '/api/jrx/hitl/queue',                   status: 'LIVE',  legacyAlias: '/api/jrx/hitl/queue',          note: 'Task #176 (B2): aggregates nv_schema.hitl_reviews' },
  AUDIT_CHAIN:           { path: '/api/jrx/audit/chain',                  status: 'LIVE' },
  GUARDRAILS:            { path: '/api/jrx/audit/guardrail-stats',        status: 'LIVE',  legacyAlias: '/api/jrx/audit/guardrail-stats' },
  GOVERNANCE_SURFACE:    { path: '/api/jrx/governance/surface',           status: 'LIVE',  legacyAlias: '/api/jrx/governance/surface',  note: 'Task #176 (B2): aggregated counts (policies, HITL, guardrails, incidents)' },
  RBAC_ROLES:            { path: '/api/jrx/rbac/roles',                   status: 'LIVE' },
  RBAC_AUDIT_LOG:        { path: '/api/jrx/rbac/audit-log',               status: 'LIVE' },
  LINEAGE_AUDIT:         { path: '/api/jrx/lineage/audit',                status: 'LIVE' },
  LINEAGE_EXPORT:        { path: '/api/jrx/lineage/export',               status: 'LIVE' },
  ENFORCEMENT:           { path: '/api/jrx/enforcement',                  status: 'LIVE',  legacyAlias: '/api/jrx/enforcement',         note: 'Task #176 (B2): aggregates nv_audit_logs (block/flag/enforce events)' },
  LLM_JUDGE:             { path: '/api/jrx/llm-judge',                    status: 'LIVE',  legacyAlias: '/api/jrx/llm-judge',           note: 'Task #176 (B2): aggregates nv_schema.hallucination_checks' },
  ADVERSARIAL:           { path: '/api/jrx/adversarial',                  status: 'LIVE',  legacyAlias: '/api/jrx/adversarial',         note: 'Task #176 (B2): aggregates nv_schema.adversarial_test_runs' },

  // ─────────── COMPLIANCE ───────────
  COMPLIANCE_DPDPA:      { path: '/api/jrx/compliance/dpdpa',             status: 'LIVE',          legacyAlias: '/api/jrx/compliance/dpdpa',     note: 'Task #178 (B2) + task-298: consent rollup + registry + 9 principles' },
  COMPLIANCE_POLICY_ENFORCEMENT: { path: '/api/jrx/compliance/policy-enforcement', status: 'LIVE', note: 'task-298: live counters off nv_cam_actions + nv_policy_violations' },
  POLICIES_LIST:         { path: '/api/jrx/policies',                     status: 'LIVE', note: 'task-298: list active policies; supports ?category= ?status= ?jurisdiction=' },
  POLICY_DRILLDOWN:      { path: '/api/jrx/policies/:id',                 status: 'LIVE', note: 'task-298: drilldown — policy + versions + assignments + violations' },
  COMPLIANCE_EU_AI_ACT:  { path: '/api/jrx/compliance/eu-ai-act',         status: 'LIVE',          legacyAlias: '/api/jrx/compliance/eu-ai-act', note: 'Task #178 (B2): EU AI Act inventory aggregator' },
  COMPLIANCE_ISO:        { path: '/api/jrx/compliance/iso',               status: 'LIVE',          legacyAlias: '/api/jrx/compliance/iso',       note: 'Task #299: ISO 42001 + ISO 27001 + SOC2 framework summaries' },
  COMPLIANCE_CONTROL:    { path: '/api/jrx/compliance/control',           status: 'LIVE',          legacyAlias: '/api/jrx/compliance/control',   note: 'Task #299: drilldown for a single control by id' },
  COMPLIANCE_ISO_EXPORT: { path: '/api/jrx/compliance/iso/export',        status: 'LIVE',          legacyAlias: '/api/jrx/compliance/iso/export',note: 'Task #310: signed PDF auditor pack (IronLedger-stamped)' },
  GRPO:                  { path: '/api/jrx/compliance/grpo',              status: 'LIVE',          legacyAlias: '/api/jrx/grpo',                 note: 'Task #178 (B2): GRPO training/snapshot aggregator' },

  // ─────────── DEVELOPER / SDK ───────────
  SDK_KEYS:              { path: '/api/jrx/sdk/keys',                     status: 'LIVE' },
  SDK_OVERVIEW:          { path: '/api/jrx/sdk/developer-portal',         status: 'AUTH_GATED', legacyAlias: '/api/jrx/sdk/developer-portal' },
  SDK_ANALYTICS:         { path: '/api/jrx/sdk/analytics',                status: 'LIVE' },
  SDK_DOCS:              { path: '/api/jrx/sdk/docs-pipeline',            status: 'LIVE' },
  DB_SCHEMA:             { path: '/api/jrx/db/schema',                    status: 'LIVE',          legacyAlias: '/api/jrx/db/schema', note: 'Task #178 (B2): information_schema catalog query' },

  // ─────────── PHASE C PROMOTED (2026-05-28) ───────────
  JURISDICTION_REGISTRY_STATS:  { path: '/api/jrx/jurisdiction/registries/stats',  status: 'LIVE', note: 'Jurisdiction mapping — registry stats' },
  JURISDICTION_REGISTRY_AGENTS: { path: '/api/jrx/jurisdiction/registries/agents', status: 'LIVE', note: 'Jurisdiction mapping — flat agent list' },
  SCRAPE_ALLOWLIST:             { path: '/api/jrx/tools/scrape/allowlist',         status: 'LIVE', note: 'Web scraping targets — allowlisted hosts' },
  SCRAPE_RATE_LIMITER:          { path: '/api/jrx/tools/scrape/rate-limiter',      status: 'LIVE', note: 'Web scraping — per-host rate buckets' },
  MULTIMODAL_HEALTH:            { path: '/api/nv5/multimodal/health',             status: 'LIVE', note: 'Multimodal studio — sub-mount feature flags' },
  IDENTITY_EXTRACTIONS:         { path: '/api/jrx/identity/extractions',           status: 'LIVE', note: 'Identity extraction — user history' },
  SMOKE_HARNESS:         { path: '/api/jrx/testing',                      status: 'AUTH_GATED', legacyAlias: '/api/jrx/smoke' },
  TESTING:               { path: '/api/jrx/testing',                      status: 'LIVE' },

  // ─────────── ADMIN ───────────
  ADMIN_ORGS:            { path: '/api/jrx/admin/orgs',                   status: 'LIVE',  legacyAlias: '/api/jrx/admin/orgs' },
  ADMIN_USERS:           { path: '/api/jrx/admin/users',                  status: 'LIVE' },
  ADMIN_STATS:           { path: '/api/jrx/admin/stats',                  status: 'LIVE' },
  ADMIN_AUDIT:           { path: '/api/jrx/admin/audit',                  status: 'LIVE' },
  ADMIN_AUDIT_LOGS:      { path: '/api/jrx/admin/audit-logs',             status: 'LIVE' },
  ADMIN_API_KEYS:        { path: '/api/jrx/admin/api-keys',               status: 'LIVE' },
  ADMIN_FEATURE_FLAGS:   { path: '/api/jrx/admin/feature-flags',          status: 'LIVE' },
  ADMIN_ROUTING_WEIGHTS: { path: '/api/jrx/admin/routing-weights',        status: 'LIVE', note: 'Live routing weights HTML dashboard — analyst+ JWT' },
  SDK_PLATFORM_LIMITS:   { path: '/api/jrx/sdk/platform/limits',          status: 'LIVE', note: 'Platform tier headroom — SDK key or super_admin JWT bypass' },
  SDK_PLATFORM_TIERS:    { path: '/api/jrx/sdk/platform/tiers',           status: 'LIVE', note: 'Platform + customer org tier catalog' },
  SDK_LLM_CATALOG:       { path: '/api/jrx/v1/sdk/llm/catalog',           status: 'LIVE', note: 'Partner LLM catalog introspection' },
  SDK_LLM_PROVIDERS:     { path: '/api/jrx/v1/sdk/llm/providers',         status: 'LIVE' },
  SDK_LLM_ROUTER_HEALTH: { path: '/api/jrx/v1/sdk/llm/router/health',     status: 'LIVE' },
  TOKEN_METRICS:         { path: '/api/jrx/token-metrics',                status: 'LIVE', note: 'HTML token metrics dashboard — analyst+ JWT' },
  ADMIN_PLATFORMS:       { path: '/api/jrx/platforms',                    status: 'LIVE',  legacyAlias: '/api/jrx/platforms' },
  ADMIN_TENANTS:         { path: '/api/jrx/tenants',                      status: 'LIVE',  legacyAlias: '/api/jrx/tenants' },
  ADMIN_WHITE_LABEL:     { path: '/api/jrx/admin/white-label',            status: 'LIVE',          legacyAlias: '/api/jrx/admin/white-label', note: 'Task #178 GET + Task #188 PATCH: org settings white-label (audited)' },
  ADMIN_LLM_BUDGET:      { path: '/api/jrx/admin/llm-budget',             status: 'LIVE',          legacyAlias: '/api/jrx/admin/llm-budget',  note: 'Task #178 GET + Task #188 PATCH: per-org LLM monthly budget (audited)' },

  // ─────────── SUPER-ADMIN (canonical = /api/jrx/admin/*) ───────────
  SUPERADMIN_OVERVIEW:   { path: '/api/jrx/admin/stats',                  status: 'LIVE',  legacyAlias: '/api/jrx/admin/stats' },
  SUPERADMIN_AGENTS:     { path: '/api/jrx/agents',                       status: 'LIVE',  legacyAlias: '/api/jrx/agents' },
  SUPERADMIN_GOVERNANCE: { path: '/api/jrx/audit/guardrail-stats',        status: 'LIVE',  legacyAlias: '/api/jrx/audit/guardrail-stats' },
  SUPERADMIN_LLM_BUDGET: { path: '/api/jrx/superadmin/llm-budget',        status: 'LIVE',          legacyAlias: '/api/jrx/superadmin/llm-budget', note: 'Task #178 (B2): all-org LLM rollup' },
  SUPERADMIN_FAILOVER:   { path: '/api/jrx/llm/status',                   status: 'LIVE',  legacyAlias: '/api/jrx/llm/status' },
  ROMA_L5:               { path: '/api/jrx/admin/roma-l5',                status: 'AUTH_GATED', legacyAlias: '/api/jrx/roma/dashboard' },
} as const satisfies Record<string, ApiPath>;
/* eslint-enable */

/** Helper: returns true if the path is known to lack a backend (consumer should render empty-state). */
export function isNeedsBackend(key: keyof typeof NV_API): boolean {
  return NV_API[key].status === 'NEEDS_BACKEND';
}

/** Helper: returns the canonical path for a given key. */
export function p(key: keyof typeof NV_API): string {
  return NV_API[key].path;
}

/**
 * Canonical /api/jrx/ prefix.
 *
 * Lives here (and only here) so the `no-hardcoded-api-paths` lint rule
 * can keep banning the literal substring everywhere else. Pages that
 * call ad-hoc backend paths (the long tail not yet promoted into NV_API)
 * import `NV_BASE` / `nv()` instead of hardcoding `/api/jrx/...`.
 */
export const NV_BASE = '/api/jrx/';

/**
 * Build a backend URL from a relative suffix.
 *
 *   nv('agents')              -> '/api/jrx/agents'
 *   nv('agents/' + id)        -> '/api/jrx/agents/<id>'
 *   nv('admin/audit?limit=8') -> '/api/jrx/admin/audit?limit=8'
 *
 * Prefer `p('KEY')` when the path is in the NV_API registry; reach for
 * `nv()` only for one-off / dynamic paths.
 */
export function nv(rest: string = ''): string {
  return NV_BASE + rest.replace(/^\/+/, '');
}
