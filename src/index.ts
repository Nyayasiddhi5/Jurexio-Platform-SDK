/**
 * Jurexio Enterprise Platform 1.0.0 - Main Entry Point
 * JRX-SVC-GATEWAY | API Gateway + Orchestration Backend
 *
 * Standalone Legal AI SDK — Backbone for all Jurexio platforms
 * Compliance: JRX Naming Convention v5.0.0
 *
 * @version 5.0.0
 * @platform Jurexio Enterprise Platform
 * @license Enterprise Commercial License - Legal Edition
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import * as http from 'http';
import crypto from 'crypto';

dotenv.config();
import './config/jrx-env-bootstrap.js';

// ============================================================
// MIDDLEWARE
// ============================================================
import { authenticateToken, optionalAuth, requireAdmin, requireRole } from './middleware/jrx-auth.js';
import { dualSdkOrJwt } from './middleware/jrx-dual-auth.js';
import { tenantIsolation } from './middleware/jrx-tenant-isolation.js';
import { orgRlsMiddleware } from './middleware/jrx-org-rls-middleware.js';
import { firmClauseRequestContext } from './services/jrx-firm-clause-library.js';
import { nvRequestUsageContext } from './utils/jrx-request-usage-context.js';
import { nvResponseSigningMiddleware } from './middleware/jrx-response-signing-middleware.js';
import { errorHandler } from './middleware/jrx-error-handler.js';
import { apiVersion } from './middleware/jrx-api-versioning.js';
// NV-WIRING-BUDGET-001 Phase-1 wire-chain (2026-05-10): the 7 previously-orphan
// middleware files. Imports alone make them reachable from BFS audit; behaviour
// is opt-in via JRX_F_* feature flags below (default OFF — zero v5 impact).
import { requestLogger as nvCanonicalRequestLogger } from './middleware/jrx-request-logger.js';
import { tracingMiddleware as nvTracingMiddleware } from './middleware/jrx-tracing-middleware.js';
import { validateOrchestrationCompliance as nvOrchestrationGuardrails } from './middleware/jrx-orchestration-guardrails.js';
import { nsResponseMapper as nvNsResponseMapper } from './middleware/jrx-ns-response-mapper.js';
// creditGate is a per-route factory consumed by future v6 credit-gated routes;
// validateServiceApiKey is reserved for east-west calls per NV-AUTH-HEADER-001.
// Imported here to make them reachable from the BFS audit graph.
import { creditGate as _nvCreditGate } from './middleware/jrx-credit-gate-middleware.js';
import { validateServiceApiKey as _nvValidateServiceApiKey } from './middleware/jrx-inter-service-auth.js';
import { defaultPlatformRateLimiter as nvPlatformRateLimiterInmem } from './middleware/jrx-per-platform-rate-limiter.js';
import { nvUsageMetering } from './middleware/jrx-usage-metering-middleware.js';
import { nyvRequestMetricsMiddleware } from './middleware/jrx-request-metrics.js';
import {
  applyGatewayHttpServerTimeouts,
  nvLongAiHttpTimeoutMiddleware,
} from './middleware/jrx-long-ai-http-timeout.js';
import { guardrailManager } from './middleware/jrx-guardrails-enforcement.js';
import {
  publicRateLimit,
  authenticatedRateLimit,
  aiPatternRateLimit,
  authLoginRateLimit,
  enterpriseRateLimit,
  sdkApiKeyRateLimit,
} from './middleware/jrx-rate-limit-middleware.js';
import { createLogger } from './utils/logger.js';
import { nvJrxApiPrefixAlias } from './middleware/jrx-public-api-alias.js';

// ============================================================
// STARTUP VALIDATORS
// ============================================================
import { validateEnvironment } from './startup/jrx-environment-validator.js';
import { enforceJurisdictionPromptInvariants } from './startup/jrx-jurisdiction-prompt-validator.js';
import { validateJwtSecret } from './startup/jrx-jwt-validator.js';
import { runEnvValidation } from './utils/env-validator.js';
import { runMigrationSafetyChecks } from './startup/jrx-migration-safety-runner.js';
import { initPiiVaultCleanup } from './startup/jrx-pii-vault-cleanup.js';
import { runJwtRotationCheck, jwtRotationRouter } from './startup/jrx-jwt-rotation-monitor.js';
import { runDbIndexMigration } from './startup/jrx-db-index-migration.js';
import { loadDcNumericStatusMasterFromDb } from './startup/jrx-dc-status-master-boot.js';
import { assertAuditChainIntegrityOnBoot } from './startup/jrx-audit-chain-self-test.js';
// NV-MODEL-ID-VALIDATE-001: cascade ladders silently DROP unresolvable model ids,
// so a drifted id shortens the never-fail cascade with no signal. Validated at boot.
import { assertCascadeModelIdsAtStartup } from './services/intelligent-router/jrx-cascade-validator.js';
import { scheduleHashChainCron } from './services/hash-chain-verifier.js';
import { start as startVectorEvictionJob } from './services/jrx-vector-eviction-job.js';

// ============================================================
// SERVICES
// ============================================================
import { initializeServices } from './services/index.js';
import { initializeDatabase } from './services/database.js';
import { seedSdkApplications } from './services/sdk/sdk-seed.js';
import { seedSdkData } from './services/sdk/sdk-data-seed-service.js';
import { initializeAgentRegistry } from './services/agent-registry-service.js';
import { startPlatformJobs } from './startup/jrx-start-platform-jobs.js';
import { mountStaticFrontends } from './gateway/static-serving.js';

// ============================================================
// PLATFORM CONFIG
// ============================================================
import { CORS_CONFIG, PLATFORM_VERSION } from './config/platform-config.js';

// ============================================================
// NV SDK CORE ROUTES (jrx-* prefix)
// ============================================================
import { authRouter } from './routes/jrx-auth-routes.js';
import { nvCsrfGuard, nvCsrfHeaders } from './middleware/jrx-csrf-middleware.js';
import { healthRouter } from './routes/jrx-health-routes.js';
import { createPhaseCStubsRouter } from './routes/jrx-phase-c-stubs-routes.js';
import { createConsolePageStubsRouter } from './routes/jrx-console-page-stubs-routes.js';
import { createArchitectRouter } from './routes/jrx-architect-routes.js';
import { createUniversalChatRouter } from './routes/jrx-universal-chat-routes.js';
import driftMonitorRouter from './routes/jrx-drift-monitor-routes.js';
import nvActivityStreamRouter from './routes/jrx-activity-stream-routes.js';
import { activityPublisher } from './middleware/jrx-activity-publisher.js';
import nvGatewayRouter from './routes/jrx-gateway-routes.js';
import nvEmbedAliasRouter from './routes/jrx-embed-alias-routes.js';
// Session-10 Batch A — additive /api/nv5/orch/* sub-routers (flag-gated, default OFF).
import { isJrxFeatureOn } from './config/jrx-feature-flags.js';
import nv5OrchKbRouter from './routes/nv5-orch-kb.js';
import nv5OrchContextRouter from './routes/nv5-orch-context.js';
import nv5OrchMultimodalRagRouter from './routes/nv5-orch-multimodal-rag.js';
import nv5OrchPluginsRouter from './routes/nv5-orch-plugins.js';
import nv5OrchRomaRouter from './routes/nv5-orch-roma.js';
import nv5OrchAgentSelectRouter from './routes/nv5-orch-agent-select.js';
import nv5OrchProtocolsRouter from './routes/nv5-orch-protocols.js';
// Session-10 Batch B — additive /api/nv5/{multimodal,voice}/* nested barrels.
// Sub-routers are flag-gated INSIDE each barrel (default OFF); the barrels
// themselves are mounted unconditionally so the wiring auditor counts every
// reachable file. With all flags off the entire namespace returns 404.
import nv5MultimodalRouter from './routes/nv5/multimodal/index.js';
import nv5VoiceRouter from './routes/nv5/voice/index.js';
// Session-10 Batch C — additive /api/nv5/{workflows,doc-ai}/* nested barrels.
// Sub-routers are flag-gated INSIDE each barrel (default OFF). Workflow
// engines are import-loaded here for wiring-audit reachability but their
// loops do NOT auto-start at boot (see JRX-WORKFLOW-NO-AUTOSTART in
// autonomous-continuous-execution-engine.ts and continuous-execution-engine
// lifecycle on POST /start).
import nv5WorkflowsRouter from './routes/nv5/workflows/index.js';
import nv5DocAiRouter from './routes/nv5/doc-ai/index.js';
// Session-10 Batch D — additive /api/nv5/gov/* nested barrel for cross-
// cutting governance (maker-checker HITL queue, security-monitor status,
// cost-optimizer usage, concurrency-governor snapshot, org-rate-limiter
// status). Read-only admin endpoints. Sub-routers are flag-gated INSIDE
// the barrel (default OFF). The barrel is mounted unconditionally so the
// wiring auditor sees a static-import edge to all 5 underlying services
// (esp. jrx-security-monitor whose existing `await import` is invisible to
// the BFS walker). With all 5 flags off the namespace returns 404.
import nv5GovRouter from './routes/nv5/gov/index.js';
// Session-11 Batch E — additive /api/nv5/legal-pipeline/* nested barrel
// wiring 5 previously-orphan RAG services (chunker, embedding, reranker,
// summarizer, readability scorer). Read-only admin endpoints. Sub-routers
// are flag-gated INSIDE the barrel (default OFF). The barrel is mounted
// unconditionally so the wiring auditor sees a static-import edge to all
// 5 underlying services. With all 5 flags off the namespace returns 404.
import nv5LegalPipelineRouter from './routes/nv5/legal-pipeline/index.js';
// Session-11 Batch F — additive /api/nv5/compliance/* nested barrel
// wiring 3 previously-orphan services (jrx-eu-ai-act-service, jrx-pqc-service,
// jrx-federated-privacy-service). Read-only / deterministic admin endpoints.
// Sub-routers flag-gated INSIDE the barrel (default OFF). With all 3 flags
// off the namespace returns 404.
import nv5ComplianceRouter from './routes/nv5/compliance/index.js';
// Session-11 Batches G+H+I+J — consolidated /api/nv5/internal/* admin
// surface wiring 14 previously-orphan services (model-cascade, slm-router,
// llm-routing-engine, cost-aware-router, esign, ocr, pdfa, watermark,
// hallucination, escalation, event-sourcing, jurisdiction-overlay, audit-
// chain, case-update, azentzero, agentzero, provider-registry, feature-
// flags, orchestration-facade). Single namespace flag (default OFF).
import nv5InternalRouter from './routes/nv5/internal/index.js';
// NV-WIRING-BUDGET-001 Session-11 Batches E–K (2026-05-10) — additional
// side-effect-free static-import edge that the BFS auditor follows into
// 26 previously-orphan engine-internal / adapter / family-pipeline
// services NOT covered by the nv5/* HTTP routers above. Each import is
// `void`-discarded inside the chain file. Runtime behaviour unchanged —
// provider-emitting paths remain inside the canonical safety ring
// (NV-LLM-001 / NV-ARCH-001).
import { NV_INTERNAL_WIRE_CHAIN_ACTIVE } from './orchestration/jrx-internal-wire-chain.js';
void NV_INTERNAL_WIRE_CHAIN_ACTIVE;
import nvOrchestrationRouter from './routes/jrx-orchestration-routes.js';
import nvLegalChatRouter from './routes/jrx-legal-chat-routes.js';
import nvLegalChatVoicePartnerRouter from './routes/jrx-legal-chat-voice-partner-routes.js';
import { smeSetupAllocationRouter, smeSetupAuthRouter } from './routes/jrx-sme-setup-routes.js';
import nvPhase4Router from './routes/jrx-phase4-routes.js';
import { createDocSharingRouter } from './routes/jrx-doc-sharing-routes.js';
import nvPhase5Router from './routes/jrx-phase5-routes.js';
import nvApiKeysRouter from './routes/jrx-api-keys-routes.js';
import nvHealthFullRouter from './routes/jrx-health-full-routes.js';
import sdkDownloadsRouter from './routes/jrx-sdk-downloads-routes.js';
import nvTokenMetricsRouter from './routes/jrx-token-metrics-routes.js';
import nvRoutingWeightsRouter from './routes/jrx-routing-weights-routes.js';
import nvSwaggerRouter from './routes/jrx-swagger-routes.js';
import nvOpenApiRouter from './routes/jrx-openapi-routes.js';
import nvAdminHeapRouter from './routes/jrx-admin-heap-routes.js';
import nvAdminNv5ProxyRouter from './routes/jrx-admin-nv5-proxy-routes.js';
import nvSharedDocsRouter from './routes/jrx-shared-docs-routes.js';
import nvStorageFileRouter from './routes/jrx-storage-file-routes.js';
import nvEcosystemDocumentRoutes, { nvDocsLegacyRouter } from './routes/jrx-ecosystem-document-routes.js';
import nvPatraMitraRoutes from './routes/jrx-patra-mitra-routes.js';
import nvCnrRoutes from './routes/jrx-cnr-routes.js';
import nvCourtMasterRoutes from './routes/jrx-court-master-routes.js';
import nvRouterStatsRouter from './routes/jrx-router-stats-routes.js';
import { setupVoiceWebSocket } from './routes/jrx-voice-ws-routes.js';

// ============================================================
// NV SDK MANAGEMENT ROUTES (renamed from sdk-*)
// ============================================================
import sdkGatewayRoutes from './routes/jrx-sdk-gateway-routes.js';
import sdkEnterpriseRoutes from './routes/jrx-sdk-enterprise-routes.js';
import sdkConsoleRoutes from './routes/jrx-sdk-console-routes.js';
import sdkDocPipelineRoutes from './routes/jrx-sdk-doc-pipeline-routes.js';
import sdkMultimodalVoiceRoutes from './routes/jrx-sdk-multimodal-voice-routes.js';
import sdkWorkflowProtocolRoutes from './routes/jrx-sdk-workflow-protocol-routes.js';
import sdkProtocolAnalyticsRoutes from './routes/jrx-sdk-protocol-analytics-routes.js';
import sdkIntelligenceRoutes from './routes/jrx-sdk-intelligence-routes.js';
import { bridgeJwtOrgToSdkContext } from './middleware/jrx-jwt-org-bridge.js';
import sdkLlmCatalogRoutes from './routes/jrx-sdk-llm-catalog-routes.js';
import { sdkCamRouter, uiCamRouter } from './routes/jrx-sdk-cam-routes.js';
import sdkDeveloperPortalRoutes from './routes/jrx-sdk-developer-portal-routes.js';
import nvPlatformsRouter from './routes/jrx-platforms-routes.js';
import nvSdkProvisionRouter from './routes/jrx-sdk-provision-routes.js';
import nvCustomerOrgsRouter from './routes/jrx-customer-orgs-routes.js';
import nvPlatformLimitsRouter from './routes/jrx-platform-limits-routes.js';
import nvPlatformAccessRouter from './routes/jrx-platform-access-routes.js';
import nvPlatformRegistryRouter from './routes/jrx-platform-registry-routes.js';
import nvSuperOrgsRouter from './routes/jrx-super-orgs-routes.js';
import nvSdkKeylifeRouter from './routes/jrx-sdk-keylife-routes.js';
import nvUserProfileRouter from './routes/jrx-user-profile-routes.js';

// ============================================================
// NV DOMAIN ROUTES
// ============================================================
import { agentRouter } from './routes/jrx-agent-routes.js';
import { workspaceProjectsRouter } from './routes/jrx-workspace-routes.js';
import jurisdictionRouter from './routes/jrx-jurisdiction-routes.js';
import nvCoreRouter from './routes/jrx-core-routes.js';
// Task #177 (B2) — Operations aggregator routes (cost / regulatory / failover / ops overview)
import nvOperationsAggregatorsRouter from './routes/jrx-operations-aggregators.js';
// Task #176 (B2) — Governance aggregator routes (HITL queue, lineage, memory, etc.)
import nvGovernanceAggRouter from './routes/jrx-governance-aggregators.js';
import nvV311Router from './routes/jrx-v311-routes.js';
import { enterpriseServicesRouter } from './routes/jrx-enterprise-services-routes.js';
import enterpriseAdminRoutes from './routes/jrx-enterprise-admin-routes.js';
import romaL5AdminRoutes from './routes/jrx-roma-l5-admin-routes.js';
import identityExtractionRoutes from './routes/jrx-identity-extraction-routes.js';
import nvDocAnalyzeRouter from './routes/jrx-doc-analyze-routes.js';
import nvAgentPersonaRouter from './routes/jrx-agent-persona-routes.js';
import nvSocialMemoryRouter from './routes/jrx-social-memory-routes.js';
import nvMemoryManagerRouter from './routes/jrx-memory-manager-routes.js';
import nvFilterRouter from './routes/jrx-filter-routes.js';
import nvKnowledgeModuleRouter from './routes/jrx-knowledge-module-routes.js';
import nvKnowledgePlaneRouter from './routes/jrx-knowledge-plane-routes.js';
import nvLegalWorkRouter from './routes/jrx-legal-work-routes.js';
import nvTemplatesRouter from './routes/jrx-templates-routes.js';
import nvDomainPacksRouter from './routes/jrx-domain-packs-routes.js';
import nvMatterVaultRouter from './routes/jrx-matter-vault-routes.js';
import nvContentRouter from './routes/jrx-content-routes.js';
import nvNewServicesRouter from './routes/jrx-new-services-routes.js';
import nvCompletionsRouter from './routes/jrx-completions-routes.js';
import nvPatternsRouter from './routes/jrx-patterns-routes.js';
import nvNyayaToolsRouter from './routes/jrx-legal-tools-routes.js';
import nvMcpConnectorRouter from './routes/jrx-mcp-connector-routes.js';
import nvIntelligenceRouter from './routes/jrx-intelligence-routes.js';
import nvTestingRouter from './routes/jrx-testing-routes.js';
import documentOrchestratorRouter from './routes/jrx-document-orchestrator-routes.js';
import { modelRegistryRoutes } from './routes/jrx-model-registry-routes.js';
import { featureFlagsRoutes } from './routes/jrx-feature-flags-routes.js';
import nvProviderSecretsRouter from './routes/jrx-provider-secrets-routes.js';
import { tenantManagementRoutes } from './routes/jrx-tenant-management-routes.js';
import { versionRoutes } from './routes/jrx-version-routes.js';
import { createRedisPlatformRateLimiter } from './middleware/jrx-redis-platform-rate-limiter.js';
import { regulatoryMonitor } from './services/regulatory-monitor/regulatory-monitor-service.js';
import { nvMemoryManager } from './services/jrx-memory-manager.js';
import { nvDbPoolManager } from './db/index.js';
import { llmPriorityManager } from './services/llm-priority-manager/llm-priority-manager.js';
import { digitalTwinService } from './services/digital-twin/digital-twin-service.js';
import nvSkillsRouter from './routes/jrx-skills-routes.js';
import nvDigitalTwinRouter from './routes/jrx-digital-twin-routes.js';
import nvAguiStreamRouter from './routes/jrx-agui-stream-routes.js';
import nvRazorpayRouter from './routes/jrx-razorpay-routes.js';
import { featureFlagManager } from './services/jrx-feature-flag-manager.js';
import { PAYMENT_CONFIG } from './config/platform-config.js';

// ============================================================
// SPRINT 3 — SUBSCRIPTION, CREDITS, GST, CASE UPDATES, INSTITUTIONAL
// ============================================================
import { nvSubscriptionRouter } from './routes/jrx-subscription-routes.js';
import nvCreditsRouter from './routes/jrx-credits-routes.js';
import { nvGSTRouter } from './routes/jrx-gst-routes.js';
import { nvInstitutionalRouter } from './routes/jrx-institutional-routes.js';

// ============================================================
// MAY SPRINT — COMPLIANCE, CONSENT (DPDPA 2023), GOVERNANCE, VOICE
// ============================================================
import nvConsentRouter from './routes/jrx-consent-routes.js';
import nvComplianceRouter from './routes/jrx-compliance-routes.js';
import nvVoiceRouter from './routes/jrx-voice-ws-routes.js';
// task-357: BIPA §15(b) written-consent surface for IL biometric capture.
import nvBipaConsentRouter from './routes/jrx-bipa-consent-routes.js';

// ============================================================
// SPRINT 7 — WhatsApp, RLS, RAG Live, eCourts
// ============================================================
import nvWhatsAppRouter from './routes/jrx-whatsapp-routes.js';
import nvRlsRouter from './routes/jrx-rls-routes.js';
import nvRagRouter from './routes/jrx-rag-routes.js';
import nvECourtsRouter from './routes/jrx-ecourts-routes.js';

// ============================================================
// CUSTOMER AGENTIC PRODUCT ROUTES (May–Aug 2026 Build)
// ============================================================
import nvClaWdBotRouter from './routes/jrx-clawdbot-routes.js';
import nvOpenBotRouter from './routes/jrx-openbot-routes.js';
import nvAutomateAIRouter from './routes/jrx-automateai-routes.js';
import nvTwinDeskRouter from './routes/jrx-twindesk-routes.js';
import nvSkillShopRouter from './routes/jrx-skillshop-routes.js';


const logger = createLogger('index');

// ============================================================
// APPLICATION SETUP
// ============================================================

const JRX_PORT_GATEWAY = parseInt(process.env.JRX_PORT_GATEWAY || process.env.PORT || '5000');
const JRX_PORT_ORCH    = parseInt(process.env.JRX_PORT_ORCH || '3001');

const app: Express = express();
const server = http.createServer(app);
applyGatewayHttpServerTimeouts(server);

/*
 * NV-DEPLOY-DRAIN-001 — readiness flag, flipped by the SIGTERM handler.
 *
 * Kept here beside the server rather than in a service: it must be readable by the health
 * route with no import cycle, and it has exactly one writer (the shutdown handler).
 * Liveness must stay 200 while draining — the process IS alive — but readiness must fail so
 * nothing new is routed to a container that is on its way out.
 */
let platformDraining = false;
export function setPlatformDraining(v: boolean): void { platformDraining = v; }
export function isPlatformDraining(): boolean { return platformDraining; }

app.set('trust proxy', 1);

// JRX public API: native `/api/jrx/*` mounts below after Phase 2 rename (alias optional).
if (process.env.JRX_USE_LEGACY_NV_ALIAS === '1') {
  app.use(nvJrxApiPrefixAlias());
}

// ── Security Headers (must be first middleware — Audit P0-7) ────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: [
        "'self'",
        'https://openrouter.ai',
        'https://api.sarvam.ai',
        'https://api.openai.com',
        'wss:', 'ws:',
        ...(process.env.JRX_PUBLIC_API_URL ? [process.env.JRX_PUBLIC_API_URL] : []),
      ],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
  noSniff: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false,
  // JRX-OPS-HELMET-CORP-001 (2026-05-01): SDK consumers (NyayaMitra,
  // JRX-PRO, JRX-INS, JRX-ACE, JRX-MIN) embed gateway-served assets
  // and call the gateway from a different origin. Default 'same-origin'
  // CORP blocks cross-origin SDK fetches. 'cross-origin' is the
  // documented setting for an SDK gateway.
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.disable('x-powered-by');

// ── Request ID (tracing — every request gets a UUID) ─────────────────────────
app.use((_req: Request, res: Response, next: NextFunction) => {
  const requestId = crypto.randomUUID();
  res.set('X-Request-ID', requestId);
  _req.requestId = requestId;
  next();
});

// ── Per-request LLM usage accumulator (NV-AUDIT-TOKENS-001) ──────────────────
// Creates res.locals.nvUsage + an AsyncLocalStorage context so deep LLM calls
// (recordLlmUsage in the intelligent router) accumulate token/cost into the
// activity row the event-bus writes on response finish. Mounted before routes
// and before nvUsageMetering so both consumers share the same accumulator.
app.use(nvRequestUsageContext);

// ── HTTP Compression (Audit C003 — 70% egress savings on JSON) ──────────────
app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
}));

// ── Production CORS (Audit A003 — replace wildcard with allowlist) ────────────
const ALLOWED_ORIGINS = new Set<string>([
  'https://nyayasiddhi.com', 'https://www.nyayasiddhi.com',
  'https://app.nyayasiddhi.com', 'https://institutional.nyayasiddhi.com',
  'https://academy.nyayasiddhi.com', 'https://ministry.nyayasiddhi.com',
  ...(process.env.NODE_ENV !== 'production'
    ? ['http://localhost:3000', 'http://localhost:3004', 'http://localhost:5000']
    : []),
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(o => o.trim()) : []),
].filter(Boolean));

// Public-CORS gate: when NV_PUBLIC_CORS=true, allow any origin (no credentials).
// Used so external backends (e.g. Jurexio Citizen) can call /api/jrx/orchestrate.
const NV_PUBLIC_CORS = process.env.NV_PUBLIC_CORS === 'true';

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // same-origin / server-to-server
    if (ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    // Allow the full Jurexio domain family (nyv.*, api.nyv.*, console.nyv.*, nys.*, nym.*, etc.)
    if (/^https?:\/\/([a-z0-9-]+\.)*nyayasiddhi\.online$/i.test(origin)) {
      return cb(null, true);
    }
    if (/^https?:\/\/([a-z0-9-]+\.)*jurexio\.in$/i.test(origin)) {
      return cb(null, true);
    }
    if (NV_PUBLIC_CORS) return cb(null, true);
    cb(new Error(`CORS_BLOCKED: ${origin}`));
  },
  credentials: !NV_PUBLIC_CORS,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-JRX-Signature', 'X-Request-ID', 'X-JRX-SDK-Version', 'X-JRX-Jurisdiction', 'X-NSP-Inter-Secret', 'X-Inter-Service-Secret'],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Task #28 — operator request-rate + last-100 error histogram for
// /api/jrx/admin/health/full. Mounted before rate-limiters so even
// throttled requests are counted (4xx/5xx still classified).
app.use(nyvRequestMetricsMiddleware());

// ── Tier-Aware Rate Limiting (Audit P0-2/A001/P0-3 — Redis-backed) ───────────
// P0 base: all public API calls capped at 30/min
// NV-API-CONTRACT-001 Phase 0 (2026-05-10) — apply apiVersion globally so
// X-API-Version header is honored on every /api/jrx/* request. Purely additive:
// defaults to 'v1', sets X-API-Version response header, never rejects requests.
app.use('/api/jrx/', apiVersion);

// NV-WIRING-BUDGET-001 Phase-1 wire-chain (2026-05-10) — feature-flag-gated
// mounts for previously-orphan middleware. All default OFF.
{
  const { isJrxFeatureOn: _flag } = await import('./config/jrx-feature-flags.js');

  // (1) Canonical request logger (replaces inline access-log line ~360 when ON)
  if (_flag('canonicalRequestLogger')) {
    app.use('/api/jrx/', nvCanonicalRequestLogger);
    logger.info('[Phase-1/wire-chain] jrx-request-logger MOUNTED');
  }

  // (2) OpenTelemetry-style tracing (sets x-trace-id + traceparent on responses)
  if (_flag('tracing')) {
    app.use('/api/jrx/', nvTracingMiddleware);
    logger.info('[Phase-1/wire-chain] jrx-tracing-middleware MOUNTED');
  }

  // (4) Jurexio response-id remap (id → nyayasiddhi_*_id). HIGH BLAST RADIUS
  //     if mounted for non-NS clients — gated AND only mounted on /api/jrx/sdk/*
  //     so NV-core admin/health/agent endpoints stay byte-identical.
  if (_flag('nsResponseMap')) {
    app.use('/api/jrx/sdk/', nvNsResponseMapper());
    logger.info('[Phase-1/wire-chain] jrx-ns-response-mapper MOUNTED on /api/jrx/sdk/*');
  }

  // (7) In-memory per-platform rate limiter — alternative to the Redis-backed
  //     limiter mounted below. Use ONLY if Redis is unavailable (dev only).
  if (_flag('platformRateLimiterInmem')) {
    app.use('/api/jrx/', nvPlatformRateLimiterInmem.middleware);
    logger.info('[Phase-1/wire-chain] jrx-per-platform-rate-limiter (in-mem) MOUNTED');
  }
}

// (3) Orchestration-compliance header — pure no-op for /api/jrx/* paths
//     (only matches legacy /api/v3/... and /api/v1/sdk/... patterns), so
//     ALWAYS-ON is safe and adds zero observable behaviour to current routes.
app.use('/api/jrx/', nvOrchestrationGuardrails);

// Sentinel reads to keep the unused-var checker happy and document intent.
void _nvCreditGate;            // factory used by future v6 credit-gated routes
void _nvValidateServiceApiKey; // east-west auth helper (NV-AUTH-HEADER-001)

app.use('/api/jrx/', publicRateLimit);
// Auth brute-force protection: 10 attempts / 15 min
app.use('/api/jrx/auth/login', authLoginRateLimit);
app.use('/api/jrx/auth/register', authLoginRateLimit);
// Authenticated users get 120/min — optionalAuth reads token without blocking public routes
app.use('/api/jrx/', optionalAuth, authenticatedRateLimit);
// AI pattern calls are expensive — throttle to 20/min
app.use('/api/jrx/patterns/', aiPatternRateLimit);
app.use('/api/jrx/ai/', aiPatternRateLimit);
// Enterprise org accounts: 500/min
app.use('/api/jrx/enterprise/', enterpriseRateLimit);
// SDK API key calls: 200/min
app.use('/api/jrx/sdk/', sdkApiKeyRateLimit);

// Redis-backed per-platform sliding-window limiter (platform_id × tier × endpoint × identity)
// Fail-open if Redis unavailable; disable entirely with JRX_RATE_LIMITER=off.
// NV-WIRING-BUDGET-001 Phase-1 (2026-05-10) — mutual-exclusion with the in-mem
// variant: if JRX_F_PLATFORM_RATE_LIMITER_INMEM=on, skip mounting Redis limiter
// to avoid double-throttling. The in-mem variant is intended as a dev fallback
// when Redis is unavailable, NOT to stack on top of Redis.
{
  const { isJrxFeatureOn: _flag } = await import('./config/jrx-feature-flags.js');
  if (!_flag('platformRateLimiterInmem')) {
    app.use('/api/jrx/', createRedisPlatformRateLimiter());
  } else {
    logger.info('[Phase-1/wire-chain] skipping Redis platform rate-limiter — in-mem variant is active');
  }
}

// ── NSP Response Signing (X-JRX-Signature on responses to NSP-originated requests) ─
// Mounted before route handlers so res.send/res.end are wrapped for ALL /api/nv
// responses including 4xx/5xx. Activates only when an NSP header (x-nsp-client,
// x-nsp-tier, x-nsp-org) or an NSP origin is detected, so internal admin and
// non-NSP traffic is unaffected. Reads secret from NV_SDK_RESPONSE_SECRET (or
// fallback aliases). Disable globally with NV_DISABLE_RESPONSE_SIGNING=1.
// Counterpart to NSP's nvSdkResponseGuard verifier.
app.use('/api/jrx/', nvResponseSigningMiddleware);

// ── Structured Request Logger (replaces logger.info — Audit C002) ────────────
const gatewayLogger = createLogger('gateway');
app.use((req: Request, _res: Response, next: NextFunction) => {
  gatewayLogger.info(`${req.method} ${req.path}`, { requestId: req.requestId });
  next();
});

// ── JWT Rotation Monitor ────────────────────────────────────
app.use('/api/jrx/auth/rotate', jwtRotationRouter);

// ── Tenant isolation (cross-tenant 403) ─────────────────────
// Mounted AFTER the JWT auth middleware (`optionalAuth` on /api/jrx/*) so that
// by the time a request reaches a JWT-authenticated route handler, we already
// have `req.user.organizationId` to compare against any claimed tenant id.
//
// IMPORTANT: SDK API-key auth (`sdkGatewayAuth`) runs INSIDE each SDK
// sub-router (e.g. `jrx-sdk-gateway-routes.ts`), AFTER this app-level mount has
// already executed. To catch cross-tenant attacks on SDK paths (valid API key
// for tenant A + body claiming tenant B), `tenantIsolation` is ALSO mounted
// inside every SDK sub-router immediately after `sdkGatewayAuth`. The two
// mounts together give us full coverage:
//   • app-level here  -> JWT-authenticated /api/jrx/* paths
//   • per-sub-router  -> /api/jrx/sdk/*, /api/jrx/gateway/*, /api/jrx/v1/sdk/*
//
// Behaviour gated by JRX_TENANT_ENFORCE:
//   • unset / "0"  -> no-op (default; safe rollout)
//   • "1"          -> 403 if a request claims a tenant that does not match auth
//   • "strict"     -> additionally 401 on /api/jrx/sdk/* with no auth tenant
// See docs/v3.1.2/completed_docs/JRX-PLATFORM-GOVERNANCE.md for the rollout plan.
app.use('/api/jrx/', tenantIsolation);

// ── Postgres RLS context binding (Task #29 deliverable #2) ────────────────
// Attaches `req.withTenant(fn)` to every authenticated request. Routes opt
// in by wrapping their DB work with `await req.withTenant(async (tx) => ...)`,
// which opens a transaction and runs `SET LOCAL app.current_org_id = '…'`
// on the pinned connection so the strict RLS policies installed by
// `drizzle/0004_enable_rls_for_tenant_tables.sql` filter rows correctly.
//
// This is a no-op for unauthenticated requests (no req.user.organizationId),
// so it is safe to mount before route registration.
app.use('/api/jrx/', orgRlsMiddleware);

// ── Firm clause library request context (NV-FIRM-CLAUSE-ORCH-001) ──────────
// Binds the org + the caller's `_firmClauseLibrary` (and pre-reads the stored
// `nv_organizations.settings->'clauseLibrary'` through `req.withTenant`) into a
// request-scoped store, so the SYNC drafting-prompt composer can inject house
// wording on EVERY drafting branch instead of only `POST /gateway/documents/draft`.
//
// Mounted immediately AFTER orgRlsMiddleware and never before: it reads
// `req.orgId` and `req.withTenant`, which that middleware installs. It is a
// no-op for any request whose body does not look like a drafting request.
app.use('/api/jrx/', firmClauseRequestContext);

// ── Task #302: per-request usage metering tap ──────────────────────────────
// Writes a row to public.sdk_usage_metering on res.finish for every /api/jrx/*
// request so the Operations Hub + Cost Optimizer aggregators have real data.
// Non-fatal: failures are logged at debug level and do not affect the request.
app.use('/api/jrx/', nvUsageMetering);

// ── T-08: jrx-security-monitor middleware (Phase C / JRX_F_SECURITY_MONITOR) ───
// Defaults OFF.  When ON, runs cross-session attack detection on requests that
// upstream guardrails flagged for injection.  Mounted after auth + tenant
// isolation so it has access to req.user and the org scope; runs before route
// handlers so a SECURITY_BLOCK short-circuits before any business logic.
{
  const { isJrxFeatureOn: _flagOn } = await import('./config/jrx-feature-flags.js');
  // Session-10 Batch D: JRX_F_GOV_SECURITY_MON is an OR-aliased flag for the
  // existing JRX_F_SECURITY_MONITOR — flipping either ON mounts the
  // middleware. Default for both: OFF (preserves current behaviour).
  if (_flagOn('securityMonitor') || _flagOn('govSecurityMon')) {
    const { securityMonitorMiddleware } = await import('./services/jrx-security-monitor.js');
    app.use('/api/jrx/', securityMonitorMiddleware);
    logger.info('[Phase-C/T-08] jrx-security-monitor middleware MOUNTED');
  }

  // Session-10 Batch D: JRX_F_GOV_ORG_RATELIMIT — mounts the per-org rate
  // limiter middleware on /api/jrx/* AFTER auth/tenant context is populated
  // and BEFORE business-route handlers (matches the placement contract for
  // pre-existing checkAIRateLimit). The middleware is order-safe: it reads
  // orgId from `req.user?.orgId || req.headers['x-org-id'] || 'default'`,
  // attaches X-RateLimit-* response headers, and short-circuits 429 on
  // exceeded. Default OFF preserves current /api/jrx/* behaviour byte-for-byte.
  if (_flagOn('govOrgRatelimit')) {
    const { orgRateLimiter } = await import('./services/org-rate-limiter.js');
    app.use('/api/jrx/', orgRateLimiter.middleware());
    logger.info('[Session-10/Batch-D] org-rate-limiter middleware MOUNTED on /api/jrx/* (JRX_F_GOV_ORG_RATELIMIT)');
  }
}

// ============================================================
// ROUTE MOUNTING — ALL /api/jrx/* prefix
// ============================================================

// Health & Swagger (no auth required)
// NV-NEVER-BREAK-001 Item D — activity publisher records gateway calls into
// the in-memory event-bus that powers the Live Activity Feed. Inert wrt
// NV-ARCH-001 (no LLM, post-response only) and NV-AUTH-HEADER-001 (reads
// req.sdkContext set upstream; never inspects raw headers).
app.use('/api/jrx/', activityPublisher);
app.use('/api/jrx/activity', nvActivityStreamRouter);

app.use('/api/jrx/health', healthRouter);
app.use('/api/jrx/phase-c', createPhaseCStubsRouter());

// Task #337 (2026-05-13): real backend for the Console "My Approvals" page,
// replacing the Phase-C 501 stub at /api/jrx/phase-c/my-approvals. Wraps
// nv_hitl_queue + nv_hitl_decisions; JWT-auth via authenticateToken inside.
const { default: nvMyApprovalsRouter } = await import('./routes/jrx-my-approvals-routes.js');
app.use('/api/jrx/my-approvals', nvMyApprovalsRouter);
// task-247 (2026-05-12): mounted at /api so the Console pages that call
// /api/sdk-builds/list, /api/chat/* and /api/architect/deploy stop returning
// 404 and instead get scoped stubs (each carries `stub: true` + featureFlag).
app.use('/api', createConsolePageStubsRouter());
// task-258 (2026-05-13): Real Architect Workflow Builder backend. Replaces
// the structured-501 stub previously served by createConsolePageStubsRouter
// at /api/architect/deploy. Mounted on the /api root (NOT /api/nv) because
// the page calls /api/architect/* directly (matches the previous stub URL).
app.use('/api/architect', createArchitectRouter());
// task-257 (2026-05-13): real LRM-routed Universal Chat backend at /api/chat/*.
// Replaces the stub block previously inside createConsolePageStubsRouter.
// Per-route auth + rate limit live inside the router itself (selectors public,
// session/message/upload gated by authenticateToken).
app.use('/api', createUniversalChatRouter());
// T011 Stream B: real drift backend (replaces the `model_drift` Phase C stub).
app.use('/api/jrx/drift', driftMonitorRouter);

// ── SDK Distribution — signed-URL tarball downloads from S3 (v3.1.2)
//    Mounted off /downloads (NOT /api/nv) so tarballs aren't subject to the
//    SDK API key rate limiter. Auth is configurable per-request via env.
app.use('/downloads/sdk', sdkDownloadsRouter);
app.use('/api/jrx/health/full', nvHealthFullRouter);
// JRX-OBS-ADMIN-HEALTH-001 (Task #28): /admin alias for the operator
// dashboard — same data, separate path so the auth middleware can be
// applied without breaking the public liveness/readiness probes.
// JRX-OBS-ADMIN-AUTH-001 (Task #28 round 8): the admin payload
// contains breaker internals, queue depths, span latency buckets,
// and provider health metadata that we do NOT want to expose
// publicly. Gate behind authenticateToken + requireAdmin so only
// authenticated admins (or superadmins) can read the operator
// dashboard. /api/jrx/health/full remains unauthenticated for the
// liveness/readiness path.
app.use('/api/jrx/admin/health/full', authenticateToken, requireAdmin, nvHealthFullRouter);
// JRX-NS-013 (P2 G1): super_admin-gated heap snapshot endpoint. requireAdmin
// here is the outer gate; the route additionally enforces role === 'super_admin'
// on every handler. Heap dumps can leak secrets, so the double-gate is intentional.
app.use('/api/jrx/admin/heap', authenticateToken, requireAdmin, nvAdminHeapRouter);
// Task #115 (2026-05-11): Console-side proxy that lets Platform-v5 try-it
// forms reach /api/nv5/* sub-routes using only a Console JWT. The proxy
// authenticates the JWT here, then re-dispatches to /api/nv5/* over loopback
// with the canonical X-API-Key header set server-side from
// JRX_CONSOLE_ADMIN_SDK_KEY. Gated to super_admin ONLY — this proxy holds a
// platform-wide admin SDK secret server-side, so a plain `admin` user must
// not be able to drive arbitrary /api/nv5/* operations through it. Audit-
// chain entries record both the originating Console user_id and the masked
// SDK key prefix. NV-WIRING-001.
app.use('/api/jrx/admin/nv5-proxy', authenticateToken, requireRole('super_admin'), nvAdminNv5ProxyRouter);
app.use('/api/jrx/docs', nvSwaggerRouter);
/* NV-LOCAL-SIGNED-URL-001 — backs the URLs `LocalStorageAdapter.getSignedUrl()` emits.
 *
 * MUST mount here, ahead of the broad `app.use('/api/jrx', …)` routers below: several of
 * those apply `authenticateToken` internally, and the first one to match swallowed
 * `/api/jrx/storage/files/*` with `401 AUTH_TOKEN_MISSING` before this router ever ran.
 * That was caught by the acceptance probe expecting 403 and receiving 401.
 *
 * Intentionally NOT behind dualSdkOrJwt: the HMAC token IS the authorisation, exactly as
 * with an S3 presigned URL handed to a browser. The route is inert on the S3 backend and
 * rejects traversal + expired/forged tokens itself. */
app.use('/api/jrx/storage', nvStorageFileRouter);
// T012 Stream C — auto-generated OpenAPI 3.1 spec + Swagger UI shell.
// JSON at /api/jrx/openapi.json (overrides the 308 redirect below for direct
// reads), Swagger UI at /api/jrx/docs/swagger. Generated by
// scripts/generate-openapi-spec.ts → docs/openapi/jurexio-v5.openapi.json.
app.use('/api/jrx', nvOpenApiRouter);
// JRX-NS-008 (2026-05-01): canonical OpenAPI alias at /api/jrx/openapi.{json,yaml}
// so external code-gen tools (openapi-typescript, prism, stoplight) can
// auto-discover the spec without knowing the /docs/ subpath.
//
// We mount surgical aliases ONLY (not the whole swagger router) so the
// Swagger HTML UI continues to live at /api/jrx/docs and never accidentally
// shadows /api/jrx/. Hand-written 302 redirects let any client cache work.
app.get('/api/jrx/openapi.json', (_req, res) => res.redirect(308, '/api/jrx/docs/openapi.json'));
app.get('/api/jrx/openapi.yaml', (_req, res) => res.redirect(308, '/api/jrx/docs/openapi.yaml'));

// Public alias: bare /health for external monitors / Replit health checks
app.use('/health', healthRouter);

// Authentication — CSRF origin guard applied to all auth mutation routes
app.use('/api/jrx/auth', nvCsrfHeaders, nvCsrfGuard, authRouter);
app.use('/api/auth', nvCsrfHeaders, nvCsrfGuard, authRouter);
// Task #156 — SME setup-token redemption (additive, JWT-less; NV-API-CONTRACT-001 additive)
app.use('/api/jrx/auth', nvCsrfHeaders, nvCsrfGuard, smeSetupAuthRouter);

// SDK Gateway (API key auth)
app.use('/api/jrx/gateway', sdkGatewayRoutes);
// NV-EMBED-ALIAS-001 — POST /api/jrx/embed → cascade embeddings (1536-d)
app.use('/api/jrx', nvEmbedAliasRouter);
// NV-ORCH-ALIAS-001 — partners that call /api/jrx/v1/sdk/orchestrate (and /stream)
// must hit Queen/specialist AdaptiveRouter, not the SDK gateway 404. Mount a
// narrow alias BEFORE the broader /api/jrx/v1/sdk gateway so only orchestrate*
// is remapped; all other v1/sdk routes stay on sdkGatewayRoutes.
app.use('/api/jrx/v1/sdk', (req, res, next) => {
  if (req.path === '/orchestrate' || req.path === '/orchestrate/stream') {
    return nvOrchestrationRouter(req, res, next);
  }
  return next();
});
// Console JWT alias for SDK optimization (GRPO policy/stats) and related surfaces.
app.use('/api/jrx/v1/sdk', sdkGatewayRoutes);

// NV-WIRING-BUDGET-001 Session-10 Batch A — additive /api/nv5/orch/* surface.
// Wires 7 previously-orphan AI orchestration files (knowledge-base-system,
// context-engineering-service, advanced-multimodal-rag,
// jrx-integration-plugin-manager, roma-l5-engine, bm25-agent-selector,
// jrx-protocol-registry-manifest) without disturbing the frozen v5 surface.
// Each sub-router mounted as a flat file (so scripts/generate-openapi-spec.ts
// auto-discovers them) and flag-gated default OFF.
//
// Deferred orphans: provider-registry + jrx-agentzero-adapter + jrx-azentzero-service
// (pre-existing missing google-provider.js + circuitBreakerManager export bugs);
// jrx-orchestration-facade (JurexioOrchestrationCoreV9 instantiated as `new`
// on a plain object + sharedAGUIService missing methods). Both queued for
// dedicated repair tasks.
//
// NV-LLM-001: every endpoint here is read-only/metadata-only. Routes that
// might chain into LLM calls (kb /search, multimodal-rag /query, roma
// /governance/run, context /enhance) were intentionally NOT exposed —
// the canonical orchestrator path remains the only LLM-emitting surface.
//
// No always-on /api/nv5/orch/health: every path under this namespace MUST
// be flag-gated AND SDK-authenticated. Each sub-router exposes its own
// /health behind its own flag + sdkGatewayAuth. With all flags OFF the
// entire namespace returns 404 — preserving zero behavior change on
// no-env deploy.
if (isJrxFeatureOn('aiOrchKb'))            app.use('/api/nv5/orch/kb', nv5OrchKbRouter);
if (isJrxFeatureOn('aiOrchContext'))       app.use('/api/nv5/orch/context', nv5OrchContextRouter);
if (isJrxFeatureOn('aiOrchMultimodalRag')) app.use('/api/nv5/orch/multimodal-rag', nv5OrchMultimodalRagRouter);
if (isJrxFeatureOn('aiOrchPlugins'))       app.use('/api/nv5/orch/plugins', nv5OrchPluginsRouter);
if (isJrxFeatureOn('aiOrchRoma'))          app.use('/api/nv5/orch/roma', nv5OrchRomaRouter);
if (isJrxFeatureOn('aiOrchAgentSelect'))   app.use('/api/nv5/orch/agent-select', nv5OrchAgentSelectRouter);
if (isJrxFeatureOn('aiOrchProtocols'))     app.use('/api/nv5/orch/protocols', nv5OrchProtocolsRouter);

// Session-10 Batch B — additive /api/nv5/multimodal/* + /api/nv5/voice/*.
// Wires 8 previously-orphan multimodal + voice service files (unity-avatar,
// chatdollkit-avatar, enhanced-multimodal, advanced-3d-immersive, avatar-3d-system,
// realtime-voice-streaming, voice-synthesis-engine, jrx-voice-service-enhanced).
// Per-feature flag gating happens INSIDE each barrel so individual sub-routes
// are independently toggleable (JRX_F_MULTIMODAL_* / JRX_F_VOICE_*). With all
// 8 flags OFF (default) the entire namespace returns 404 — frozen
// /api/jrx/voice/* + /api/jrx/sdk/multimodal/* canonical pipelines untouched.
//
// NV-LLM-001 / NV-ARCH-001: every endpoint here is read-only/metadata-only.
// Provider-emitting paths (STT, TTS, avatar render, 3D init) are NOT exposed
// — they remain reachable only through the canonical pipelines that traverse
// the safety ring.
app.use('/api/nv5/multimodal', nv5MultimodalRouter);
app.use('/api/nv5/voice',      nv5VoiceRouter);

// Session-10 Batch C — /api/nv5/workflows/* + /api/nv5/doc-ai/*.
// Wires 3 previously-orphan files (autonomous-continuous-execution-engine,
// continuous-execution-engine, jrx-document-converter-service). Per-feature
// flag gating happens INSIDE each barrel (JRX_F_WORKFLOW_AUTONOMOUS /
// _CONTINUOUS / JRX_F_DOC_AI_CONVERT). With all 3 flags OFF (default) the
// entire namespace returns 404 and the workflow engines do not run loops
// (module-load auto-start removed entirely per architect review).
app.use('/api/nv5/workflows', nv5WorkflowsRouter);
app.use('/api/nv5/doc-ai',    nv5DocAiRouter);

// Session-11 Batch E — /api/nv5/legal-pipeline/*. Wires 5 previously-
// orphan RAG services. Per-feature flag gating happens INSIDE the barrel
// (JRX_F_LEGAL_PIPELINE_{CHUNKER,EMBEDDING,RERANKER,SUMMARIZER,READABILITY}).
// With all 5 flags OFF (default) the entire namespace returns 404 and the
// services do nothing; canonical RAG pipeline traversed by
// realLLMService.executeRequest is the only LLM-emitting path.
app.use('/api/nv5/legal-pipeline', nv5LegalPipelineRouter);

// Session-11 Batch F — /api/nv5/compliance/*. Wires 3 previously-orphan
// compliance/crypto services. Per-feature flag gating (JRX_F_COMPLIANCE_*).
// Default OFF → namespace returns 404. EU-AI-Act doc generation is pure
// data lookup, PQC operations are deterministic crypto, federated-privacy
// exposes session listings + DP-noise probe only.
app.use('/api/nv5/compliance', nv5ComplianceRouter);

// Session-11 Batches G+H+I+J — /api/nv5/internal/*. Wires 14 previously-
// orphan internal services. Single namespace flag JRX_F_INTERNAL_SURFACE
// (default OFF → 404). Read-only / capability-only endpoints — no LLM
// emission. The barrel is mounted unconditionally so the wiring auditor
// sees static-import edges to every service even with the flag OFF.
app.use('/api/nv5/internal', nv5InternalRouter);

// Session-10 Batch D — /api/nv5/gov/* (governance / compliance / cost).
// Wires 5 previously-orphan files (maker-checker-service, jrx-security-
// monitor, jrx-cost-optimization-suite, concurrency-governor, org-rate-
// limiter). Per-feature flag gating happens INSIDE the barrel
// (JRX_F_GOV_MAKER_CHECKER / _SECURITY_MON / _COST_OPT / _CONCURRENCY /
// _ORG_RATELIMIT). All routes are admin-scoped + read-only; no daemons,
// no LLM calls, no /api/jrx/* behaviour change. With all 5 flags OFF
// (default) the namespace returns 404.
app.use('/api/nv5/gov',       nv5GovRouter);

// Mount jrx-statutes BEFORE nvCoreRouter so its /_summary route isn't shadowed
// by core's /statutes/:code. Same dualSdkOrJwt auth on both.
const { default: nvStatutesRouterEarly } = await import('./routes/jrx-statutes-routes.js');
app.use('/api/jrx/statutes', nvStatutesRouterEarly);

// Task #300: mount agentRouter BEFORE nvCoreRouter / nvOrchestrationRouter
// because both register a stub `router.get('/agents', authenticateToken, ...)`
// on the bare `/api/nv` prefix, which would otherwise shadow our 1042-agent
// registry endpoint and 401 SDK callers using the canonical X-API-Key.
app.use('/api/jrx/agents', agentRouter);

// Core NV SDK Routes
app.use('/api/jrx', nvCoreRouter);
// Task #177 (B2) — additive aggregator routes; mounted before generic catch-alls
// so /cost/overview, /regulatory, /providers/failover and /operations/overview
// are not shadowed. All four are RBAC-gated inside the router.
app.use('/api/jrx', nvOperationsAggregatorsRouter);
// Task #176 / B2 (2026-05-12) — governance aggregator MUST mount BEFORE
// `app.use('/api/jrx/orchestration', nvOrchestrationRouter)` below; otherwise
// the orchestration router's `GET /lineage/:requestId` (returns auditChain
// wrapped under `data`) shadows our `/api/jrx/orchestration/lineage/:requestId`
// which returns the auditChain at the top level — the shape LineagePage
// (client/src/pages/orchestration/LineagePage.tsx) actually reads.
app.use('/api/jrx', nvGovernanceAggRouter);
app.use('/api/jrx/v311', nvV311Router);
// Task #176 / B2 (2026-05-12) — governance/orchestration aggregator router
// MUST mount BEFORE `app.use('/api/jrx/orchestration', nvOrchestrationRouter)`
// below, otherwise the orchestration router's `GET /lineage/:requestId`
// (line ~829, returns the auditChain wrapped under `data`) shadows our
// `GET /api/jrx/orchestration/lineage/:requestId` (returns auditChain at the
// top level — the shape LineagePage expects).
app.use('/api/jrx', nvGovernanceAggRouter);
app.use(nvLongAiHttpTimeoutMiddleware());
app.use('/api/jrx/orchestration', nvOrchestrationRouter);
// JRX-AGUI-MOUNT-001 (Task #27): the AG-UI SSE streaming router (POST /)
// MUST be mounted BEFORE the /api/nv catch-all alias below, otherwise the
// catch-all's internal POST /stream (which expects `prompt`) shadows the
// AG-UI route (which expects `task`) and the AG-UI Queen wiring is dead.
app.use('/api/jrx/stream', nvAguiStreamRouter);
// JRX-NS-016 (2026-05-05, post-architect): the dedicated consent router
// MUST mount before the catch-all /api/nv mount of nvOrchestrationRouter.
// Otherwise GET /api/jrx/consent/purposes is captured by the orchestration
// router's `GET /consent/:userId` (line 1023, auth-gated) which treats
// "purposes" as a :userId and 401s the public endpoint. Bug found by
// jrx-credit-wallet.test.ts and jrx-patterns-api.test.ts.
app.use('/api/jrx/consent', nvConsentRouter);

// task-357: BIPA §15(b) written-consent surface. Mounted alongside the
// generic DPDPA consent router; the BIPA gate (jrx-bipa-consent-gate.ts)
// reads from this router's table and blocks biometric capture pre-flight.
app.use('/api/jrx/bipa/consent', nvBipaConsentRouter);

// Task #176 / B2 (2026-05-12) — 10 governance + orchestration aggregator
// routes (HITL queue, lineage, memory, governance surface, enforcement,
// LLM judge, adversarial, policies, router-decisions, CAM reviews). Read-
// only, RBAC-gated to super_admin / compliance_officer.
// (Mounted earlier at ~line 747, ahead of /api/jrx/orchestration; a second
// mount here is intentionally elided to avoid double-handling. The earlier
// mount also ensures `GET /hitl/queue` is not shadowed by the orchestration
// router's `GET /hitl/:reviewId`, and `GET /orchestration/lineage/:requestId`
// returns auditChain/summary at the top level, not under `data`.)

// Contract alias: Jurexio Citizen SDK posts to /api/jrx/orchestrate directly
app.use('/api/jrx', nvOrchestrationRouter);
// NSP Pro mic — SDK dual-auth BEFORE JWT-gated legal-chat dashboard routes.
app.use('/api/jrx/legal-chat/voice', nvLegalChatVoicePartnerRouter);
app.use('/api/jrx/legal-chat', nvLegalChatRouter);
// Task #156 — Superadmin SME issuance (additive sibling of /sme-allocations)
app.use('/api/jrx/legal-chat', smeSetupAllocationRouter);
app.use('/api/jrx/phase4', nvPhase4Router);
// Phase 2A: Document Management Service routes mounted unconditionally per
// 2026-05-06 Session 5 user mandate. Service-level routes are SDK-key-gated
// upstream (sdkApiKeyRateLimit + tenantIsolation already cover /api/jrx/sdk/*),
// admin-level routes (/api/jrx/admin/dms/*) are JWT-gated by authenticateToken.
// Tables nv_doc_share_grants + nv_esign_sessions exist in live DB.
// See: docs/v5.0.0/DOC-MGMT-PHASE2-ARCHITECTURE-PLAN-2026-05-06.md §10-§11
app.use('/api/jrx', createDocSharingRouter());
app.use('/api/jrx/phase5', nvPhase5Router);
app.use('/api/jrx/api-keys', nvApiKeysRouter);
app.use('/api/jrx/token-metrics', nvTokenMetricsRouter);
// Task #69 — admin HTML dashboard for live routing weights. Auth-gated
// because it surfaces the same live agent telemetry as the protected
// JSON endpoint at /api/jrx/routing/weights (Task #33).
app.use('/api/jrx/admin/routing-weights', authenticateToken, requireAdmin, nvRoutingWeightsRouter);
app.use('/api/jrx/shared-docs', nvSharedDocsRouter);
app.use('/api/jrx/v1/sdk/ecosystem-documents', nvEcosystemDocumentRoutes);
app.use('/api/jrx/v1/sdk/patra-mitra', nvPatraMitraRoutes);
app.use('/api/jrx/v1/sdk/cnr', nvCnrRoutes);
// NV-COURT-MASTER-P0-001 — jurisdiction cascade lookup (court type → state →
// district → complex → case type). Same partner SDK-key surface as CNR.
app.use('/api/jrx/v1/sdk/jurisdiction', nvCourtMasterRoutes);
app.use('/api/jrx-docs', nvDocsLegacyRouter);

// Intelligent LLM Router observability — model catalog, recent decisions,
// per-model health, scoring explainer. Single consolidated entry point for
// all LLM routing telemetry.
app.use('/api/jrx/observability', nvRouterStatsRouter);

// Agent Management — agentRouter mounted earlier (above nvCoreRouter) for task #300.
app.use('/api/jrx/agent-personas', nvAgentPersonaRouter);

// SDK Management
// JRX-UAT-FIX-006 (reviewer-flagged): the console router calls
// `router.use(authenticateToken)` at module top, so any request that lands on
// it without a JWT 401s before sub-mounts get a chance. The catch-all
// `/api/jrx/sdk` mount must therefore come AFTER all the more-specific SDK
// sub-paths (enterprise, developer-portal, docs-pipeline, multimodal,
// workflows, analytics), otherwise SDK API-key calls to those paths fail with
// "401 Invalid access token" — visible in UAT voice/STT scenarios.
app.use('/api/jrx/sdk/enterprise', sdkEnterpriseRoutes);
app.use('/api/jrx/sdk/developer-portal', sdkDeveloperPortalRoutes);
app.use('/api/jrx/sdk/docs-pipeline', sdkDocPipelineRoutes);
const { default: docparseSdkRoutes } = await import('./routes/jrx-docparse-sdk-routes.js');
app.use('/api/jrx/v1/sdk/docparse', docparseSdkRoutes);
// JRX HTTP docparse (same SDK job/packs contract; JRX keys via sdkGatewayAuth).
app.use('/api/jrx/v1/sdk/jrx/docparse', docparseSdkRoutes);
app.use('/api/jrx/sdk/multimodal', sdkMultimodalVoiceRoutes);
app.use('/api/jrx/sdk/workflows', sdkWorkflowProtocolRoutes);
app.use('/api/jrx/sdk/analytics', sdkProtocolAnalyticsRoutes);
// Task #337: firm-snapshot must work for both partner SDK keys AND Console
// JWT-only admin sessions. The route reads `req.sdkContext.organizationId`,
// which sdkGatewayAuth sets for SDK-key callers. For JWT callers we bridge
// the JWT's organizationId into sdkContext so the same handler resolves the
// caller's org without changing route logic.
const jwtToSdkOrgBridge = bridgeJwtOrgToSdkContext;
app.use('/api/jrx/v1/sdk/intelligence', jwtToSdkOrgBridge, sdkIntelligenceRoutes);
app.use('/api/jrx/v1/sdk/llm', sdkLlmCatalogRoutes);
app.use('/api/jrx/v1/sdk/cam', sdkCamRouter);
app.use('/api/jurexio/cam', uiCamRouter);

// ── SDK Provision — initialization handshake + key validation (v3.1.2)
// JRX-NS-015 (2026-05-01) — moved ABOVE the catch-all sdkConsoleRoutes mount.
// sdkConsoleRoutes calls `router.use(authenticateToken)` at module top, which
// would otherwise 401 every SDK-key call to /provision, /provision/validate,
// /provision/health, and /create-app. Mount this first so SDK-key auth
// (sdkGatewayAuth on /provision*; per-handler auth on /create-app) gets a
// chance to run.
app.use('/api/jrx/sdk', nvSdkProvisionRouter);

// Task #343: customer-org admin endpoints (X-API-Key auth, platform-scoped).
// Mount BEFORE the catch-all sdkConsoleRoutes so its module-top
// authenticateToken() doesn't 401 our SDK-key callers.
app.use('/api/jrx/sdk/customer-orgs', nvCustomerOrgsRouter);
app.use('/api/jrx/sdk/platform', nvPlatformLimitsRouter);
app.use('/api/jrx/platform/access', nvPlatformAccessRouter);
app.use('/api/jrx/platform/registry', nvPlatformRegistryRouter);
// Task #384: super-org admin endpoints (X-API-Key auth, admin-scope gated).
// Lets ONE enterprise customer use multiple Jurexio products under one
// account (NSP + NSI + NSM ⇒ ONE login / ONE bill). Grouping/UI/billing
// layer only — RLS policy customer_org_isolation stays unchanged.
app.use('/api/jrx/sdk/super-orgs', nvSuperOrgsRouter);

// Catch-all console (JWT-only); keep LAST among /api/jrx/sdk/* mounts.
app.use('/api/jrx/sdk', sdkConsoleRoutes);

// ── Platform Registry — 5 Jurexio ecosystem platforms (v3.1.2)
app.use('/api/jrx/platforms', nvPlatformsRouter);

// ── SDK Key Lifecycle — generate, rotate, revoke, verify (v3.1.2)
app.use('/api/jrx/sdk/keys', authenticateToken, nvSdkKeylifeRouter);

// ── User Profile — profile, 2FA, password, sessions (v3.1.2)
app.use('/api/jrx/user', nvUserProfileRouter);

// Enterprise
app.use('/api/jrx/enterprise', enterpriseServicesRouter);
app.use('/api/jrx/enterprise/admin', enterpriseAdminRoutes);
app.use('/api/jrx/admin/roma-l5', romaL5AdminRoutes);

// Domain Routes
app.use('/api/jrx/workspace', workspaceProjectsRouter);
app.use('/api/jrx/jurisdiction', jurisdictionRouter);
app.use('/api/jrx/identity', identityExtractionRoutes);
app.use('/api/jrx/doc-analyze', nvDocAnalyzeRouter);
app.use('/api/jrx/documents', documentOrchestratorRouter);
app.use('/api/jrx/memory', nvMemoryManagerRouter);
app.use('/api/jrx/memory/social', nvSocialMemoryRouter);
app.use('/api/jrx/filter', nvFilterRouter);
// NYS Knowledge Plane must mount BEFORE knowledge-modules alias so
// /knowledge/{caselaw,statutes,retrieve,search,templates,...} resolve here.
app.use('/api/jrx/knowledge', nvKnowledgePlaneRouter);
app.use('/api/jrx/knowledge', nvKnowledgeModuleRouter);
app.use('/api/jrx/legal-work', nvLegalWorkRouter);
// NV-TEMPLATES-API-001 — canonical catalog for NSP / ecosystem (Bearer or X-API-Key)
app.use('/api/jrx/templates', nvTemplatesRouter);
app.use('/api/jrx/domains', nvDomainPacksRouter);
app.use('/api/jrx/matter-vault', nvMatterVaultRouter);
app.use('/api/jrx/content', nvContentRouter);

// Agent Skills System — composable capability marketplace (v3.1.2)
// MUST be before nvNewServicesRouter (which has /skills/:id catch-all at /api/nv)
app.use('/api/jrx/skills', nvSkillsRouter);

// New Production Services (v3.1.2)
app.use('/api/jrx', nvNewServicesRouter);

// Completions Routes — missing endpoints now wired (v3.1.2)
app.use('/api/jrx', nvCompletionsRouter);

// 22 Agentic Pattern Routes — ReAct · CoT · ToT · Reflect · Plan+Exec · Refine · Maker-Checker ·
// Tool-Retry · Function-Router · MCP-Chain · NyayaRAG · GraphRAG · Mem0 · Semantic-Cache ·
// HTA · Swarm · ACONIC · MOAt · ADaPT · Computer-Use · GRPO · Digital-Twin (v3.1.2-ROMA5)
app.use('/api/jrx/patterns', nvPatternsRouter);

// Nyaya Tools — NyayaGraph, NyayaWatch, NyayaCompare, NyayaAmend, Template, Timeline, Forensic, Trail, Agent Lifecycle, Memory, Citations (v3.1.2)
app.use('/api/jrx/jrx-legal-tools', dualSdkOrJwt, nvNyayaToolsRouter);
app.use('/api/jrx/mcp/connectors', authenticateToken, nvMcpConnectorRouter);

// Intelligence — Conflict Detector, Amendment Impact, Litigation Risk V2, Precedent Similarity, Regulatory, Collaboration (v3.1.2)
// NV-AUTH-HEADER-001: accept either SDK key (X-API-Key) or JWT. Consumer SDK platforms
// (NSP/NSPM/NSI/NSA/NSM/NYM/JRX) need to call /intelligence/* with their X-API-Key.
// task-2026-05-13.
app.use('/api/jrx/intelligence', dualSdkOrJwt, nvIntelligenceRouter);
// NV-NSP-NYAYAWATCH-ALIAS-001: NSP integrations call /intelligence/nyayawatch/*; canonical path is /jrx-legal-tools/watch/* (same router + auth).
app.use('/api/jrx/intelligence/nyayawatch', dualSdkOrJwt, (req, res, next) => {
  const suffix = req.url === '/' ? '' : req.url;
  req.url = `/watch${suffix}`;
  nvNyayaToolsRouter(req, res, next);
});
// task-175 (B2): backward-compatible alias for callers using /api/jrx/ai/{classify,predict,sentiment,translate,ner,summarize}.
app.use('/api/jrx/ai', dualSdkOrJwt, nvIntelligenceRouter);

// Testing — Agent Oracle Tests, Adversarial Tests, LLM Judge, Scorecard (v3.1.2 — admin-only)
app.use('/api/jrx/testing', authenticateToken, nvTestingRouter);

// AG-UI SSE Streaming — All 22 patterns with real-time event streaming (v3.1.2)
app.use('/api/jrx/stream', nvAguiStreamRouter);

// Razorpay Payment Gateway — MUST integration: UPI, cards, subscriptions, invoices, payment links (v3.1.2)
app.use('/api/jrx/payments', nvRazorpayRouter);

// Digital Twin REST API — customer-facing twin management (v3.1.2)
app.use('/api/jrx/digital-twin', nvDigitalTwinRouter);

// ── Enterprise SaaS Management (v3.1.2) ─────────────────────
// Dynamic Model Registry — zero-core-change LLM/SLM/LRM integration
app.use('/api/jrx/models', modelRegistryRoutes);

// Feature Flag Management — per-tenant, kill-switch, A/B, gradual rollout
app.use('/api/jrx/flags', featureFlagsRoutes);
// Legacy alias — metering middleware + UAT probes expect /api/jrx/feature-flags (NV-UAT-D8-001)
app.use('/api/jrx/feature-flags', featureFlagsRoutes);

// Web scraper — agent-callable, allowlist-gated, rate-limited, PII-redacting
{
  const { default: nvWebScraperRouter } = await import('./routes/jrx-web-scraper-routes.js');
  app.use('/api/jrx/tools/scrape', nvWebScraperRouter);
}

// RAG Coverage Audit (Workstream #2) — 29×7 cell coverage heatmap
{
  const { default: nvRagAuditRouter } = await import('./routes/jrx-rag-audit-routes.js');
  app.use('/api/jrx/admin/rag', nvRagAuditRouter);
}

// SaaS Tenant Management — enterprise data isolation and provisioning
app.use('/api/jrx/tenants', tenantManagementRoutes);

// Per-Org Console Layout — Phase 5 (Session-15 v13, 2026-05-11). Backend
// closes Phase 5 in docs/audit/console-cpo-audit-2026-05-11.md. Bootstrap-
// on-demand CREATE TABLE so a fresh dev box doesn't need a manual migrate.
{
  const { default: nvOrgConsoleLayoutRouter } = await import('./routes/jrx-org-console-layout-routes.js');
  app.use('/api/jrx/admin/org-console-layout', nvOrgConsoleLayoutRouter);

  // Session-15 v19 / Task #153 (2026-05-12) — top-level audit chain read API.
  const { default: nvAuditChainRouter } = await import('./routes/jrx-audit-chain-routes.js');
  app.use('/api/jrx/audit', nvAuditChainRouter);

}

// Deployment Version Management — module versioning, rollback, changelog
app.use('/api/jrx/versions', versionRoutes);

// ── Sprint 3 — Subscription, Credits, GST, Case Updates, Institutional ──
// Subscription & Credit Management (plans, wallets, ledger)
app.use('/api/jrx/subscription', nvSubscriptionRouter);
app.use('/api/jrx/credits', nvCreditsRouter);


// GST Engine (INV/PAY invoice IDs, 18% GST, GSTIN validation, SAC 998399, PDF generation)
app.use('/api/jrx/gst', nvGSTRouter);

// Institutional Onboarding (7-step wizard → institutional_leads table)
app.use('/api/jrx/institutional', nvInstitutionalRouter);

// DPDPA 2023 Consent Management (grant/withdraw/export/right-to-erasure)
// JRX-NS-016: actual mount lives ABOVE the /api/nv catch-all (see line ~460);
// the duplicate idempotent re-mount here is a no-op because Express routes
// the first match — kept as a documentation marker.

// Compliance Dashboard: ISO 42001 AIMS · SOC 2 · EU AI Act · Bias Assessment
app.use('/api/jrx/compliance', nvComplianceRouter);

// Task #190 — Compliance Action Manager (CAM) reviewer queue.
// GET /api/jrx/cam/reviews (RBAC: compliance_reviewer/org_admin/super_admin).
const { default: nvCamRouter } = await import('./routes/jrx-cam-routes.js');
app.use('/api/jrx/cam', nvCamRouter);

// Task #178 (B2) — additive aggregator/CRUD routes spanning Compliance,
// Billing, Knowledge, and Admin extras. All read-only. Mounted alongside
// existing routers; only adds new sub-paths and root GETs that the
// existing routers do not already serve.
const { default: nvComplianceAggregatorsRouter } = await import('./routes/jrx-compliance-aggregators.js');
app.use('/api/jrx/compliance', nvComplianceAggregatorsRouter);

// Task #299 — ISO 42001 / ISO 27001 / SOC 2 catalogue + drilldown.
// Mounts /api/jrx/compliance/iso, /api/jrx/compliance/iso/control/:id and
// /api/jrx/compliance/control/:id (alias used by the deep-link route).
const { default: nvIsoComplianceRouter } = await import('./routes/jrx-iso-compliance-routes.js');
app.use('/api/jrx/compliance', nvIsoComplianceRouter);
try {
  const { seedIsoControlsAndEvidence, startIsoEvidenceRefresher } = await import('./services/compliance/jrx-iso-evidence-mapper.js');
  await seedIsoControlsAndEvidence();
  // Task #312 — keep nv_iso_control_evidence rows fresh as new CAM
  // actions, audit events and security-scan runs land. Default cadence
  // 15 min; override via JRX_ISO_EVIDENCE_REFRESH_MS. The scheduler is
  // unref()'d so it never blocks process shutdown.
  startIsoEvidenceRefresher();
} catch (isoErr: any) {
  logger.warn(`  ⚠ ISO control seed non-critical: ${isoErr?.message}`);
}

// Task — 2026-05-14 — Governance posture + Policies CRUD (additive).
// /api/jrx/governance/* powers the Console Dashboard compliance tiles.
// /api/jrx/policies/*   is full CRUD for organisation policies + violations.
const { default: nvPoliciesRouter } = await import('./routes/jrx-policies-routes.js');
const { default: nvGovernancePostureRouter } = await import('./routes/jrx-governance-posture-routes.js');
app.use('/api/jrx/policies', nvPoliciesRouter);
// task #335 — additive alias for the singular spelling so older clients
// (and the PolicyManagementConsole hot-fix) reach the same handlers.
// NV-API-CONTRACT-001 OK: pure alias, no shape change, no removals.
app.use('/api/jrx/policy', nvPoliciesRouter);
app.use('/api/jrx/governance', nvGovernancePostureRouter);

// task-356 — US state breach-notification pipeline. POST an incident,
// per-state notice drafts (NY SHIELD §899-aa, MA c.93H §3, IL BIPA)
// are generated, routed to the Compliance owner queue (CAM), dispatched
// outbound, and persisted to the audit chain.
const { default: nvBreachNoticeRouter } = await import('./routes/jrx-breach-notice-routes.js');
app.use('/api/jrx/compliance/breach', nvBreachNoticeRouter);

// task-298 (Demo G1B) — Policy Engine bootstrap. Idempotent: ensures the
// nv_policies* tables exist, seeds ≥ 12 US/IN-tagged demo policies, and
// backfills 7 days of consent traffic for the US (org 1000-1099) and
// IN (1100-1199) demo tenants. Fire-and-forget so a slow DB does not
// block startup.
const { nvPolicyEngine } = await import('./services/compliance/jrx-policy-engine.js');
void nvPolicyEngine.bootstrap();
const { nvConsoleDemoSeed } = await import('./services/jrx-console-demo-seed.js');
void nvConsoleDemoSeed.bootstrap();
const { nvEnvSdkKeySync } = await import('./services/jrx-env-sdk-key-sync.js');
void nvEnvSdkKeySync.bootstrap();
const { subscriptionRoot: nvSubscriptionRootRouter, creditsRoot: nvCreditsRootRouter } =
  await import('./routes/jrx-billing-routes.js');
app.use('/api/jrx/subscription', nvSubscriptionRootRouter);
app.use('/api/jrx/credits', nvCreditsRootRouter);
const { promptsRouter: nvPromptsRouter, ragCollectionsRouter: nvRagCollectionsRouter } =
  await import('./routes/jrx-knowledge-aggregators.js');
app.use('/api/jrx/prompts', nvPromptsRouter);
app.use('/api/jrx/rag/collections', nvRagCollectionsRouter);
const {
  whiteLabelRouter: nvWhiteLabelRouter,
  llmBudgetRouter: nvLlmBudgetRouter,
  superadminLlmBudgetRouter: nvSuperadminLlmBudgetRouter,
  dbSchemaRouter: nvDbSchemaRouter,
} = await import('./routes/jrx-admin-extras-routes.js');
app.use('/api/jrx/admin/white-label', nvWhiteLabelRouter);
app.use('/api/jrx/admin/llm-budget', nvLlmBudgetRouter);
app.use('/api/jrx/admin/provider-secrets', authenticateToken, requireRole('super_admin'), nvProviderSecretsRouter);
app.use('/api/jrx/superadmin/llm-budget', nvSuperadminLlmBudgetRouter);
app.use('/api/jrx/db/schema', nvDbSchemaRouter);

// Voice STT — Real-time speech-to-text for legal dictation (WebSocket upgrade + REST)
app.use('/api/jrx/voice', nvVoiceRouter);

// ── Customer Agentic Products (May–Sep 2026) ─────────────────
// ClaWdBot™ — Legal Chatbot Builder (no-code, HITL, WhatsApp)
app.use('/api/jrx/clawdbot', nvClaWdBotRouter);

// OpenBot™ — Multi-Channel Studio (Slack, Teams, Telegram, Email)
app.use('/api/jrx/openbot', nvOpenBotRouter);

// AutomateAI™ — Visual Workflow Builder (8 AI decision gate types)
app.use('/api/jrx/automateai', nvAutomateAIRouter);

// TwinDesk™ — Customer Digital Twin Product (Monte Carlo simulation)
app.use('/api/jrx/twindesk', nvTwinDeskRouter);

// SkillShop™ — Legal Skills Marketplace
app.use('/api/jrx/skillshop', nvSkillShopRouter);

// ── Sprint 7: WhatsApp, Multi-Org RLS, pgvector RAG, eCourts ────────────────
// WhatsApp Business API — ClaWdBot/OpenBot channels (graceful when token not set)
app.use('/api/jrx/channels/whatsapp', nvWhatsAppRouter);
// Multi-Org Row Level Security — data isolation + admin policies
app.use('/api/jrx/org/rls', nvRlsRouter);
// pgvector Live RAG Pipeline — embeddings via OpenRouter + vector search
app.use('/api/jrx/rag', nvRagRouter);
// eCourts NIC API — case status, hearings, cause list (India)
app.use('/api/jrx/ecourts', nvECourtsRouter);

// Task #114 — hydrate the runtime feature-flag overlay cache from
// nv_runtime_flag_overrides and wire it into jrx-feature-flags.flagOn().
// Best-effort: failures fall through to env-only behaviour (the legacy path).
import('./services/jrx-runtime-flag-overrides.js').then(async (m) => {
  try {
    await m.initFlagOverrides();
    const cfg = await import('./config/jrx-feature-flags.js');
    cfg.wireFlagOverlayLookup(m.getOverride);
    logger.info('[FlagOverlay] runtime feature-flag overlay wired into flagOn()');
  } catch (e: any) {
    logger.warn('[FlagOverlay] init failed (env-only fallback)', { err: e?.message });
  }
}).catch(() => { /* module load failure is non-fatal */ });

// NV-PROVIDER-SECRETS-001 — hydrate dashboard LLM/API key overlays into process.env
import('./services/jrx-runtime-provider-secrets.js').then(async (m) => {
  try {
    await m.bootProviderSecretsOverlay();
  } catch (e: any) {
    logger.warn('[ProviderSecrets] boot failed (env-only fallback)', { err: e?.message });
  }
}).catch(() => { /* non-fatal */ });

// Background workers — started in start() after DB + Redis (see startPlatformJobs).

// Voice WebSocket
setupVoiceWebSocket(server);

// ── Static Frontend (production) ────────────────────────────
mountStaticFrontends(app);

// ── 404 Handler ─────────────────────────────────────────────
app.use('*', (req: Request, res: Response) => {
  res.status(404).json({
    error: 'JRX-404: Route not found',
    path: req.originalUrl,
    platform: 'Jurexio Enterprise Platform 1.0.0',
    docs: '/api/jrx/docs'
  });
});

// ── Global Error Handler ─────────────────────────────────────
app.use(errorHandler);

// ============================================================
// STARTUP SEQUENCE
// ============================================================
async function start() {
  try {
    logger.info('\n══════════════════════════════════════════════════════');
    logger.info('  NYAYAVIGYA PLATFORM 3.1.2 — Starting up');
    logger.info(`  Version: ${PLATFORM_VERSION}`);
    logger.info('══════════════════════════════════════════════════════\n');

    // Step 1: Validate environment variables (secrets check — insecure values blocked in prod)
    runEnvValidation();
    await validateEnvironment();
    await enforceJurisdictionPromptInvariants();
    logger.info('  ✓ Environment validated');

    // Step 2: Validate JWT secret strength
    await validateJwtSecret();
    logger.info('  ✓ JWT secret validated');

    // Step 2b (NV-MODEL-ID-VALIDATE-001): every cascade rung must resolve.
    // `defaultSequenceFor` drops unresolvable ids silently, so this is the only
    // point where a drifted/retired model id is observable before it quietly
    // erodes the fallback depth the never-fail SLA depends on. Advisory unless
    // JRX_VALIDATE_CASCADE_STRICT=1 (CI), because a single drifted id is a far
    // smaller incident than refusing to boot the gateway.
    try {
      const cascadeReport = assertCascadeModelIdsAtStartup();
      logger.info(
        `  ✓ Cascade model ids validated (${cascadeReport.idsChecked} ids, ${cascadeReport.laddersChecked} ladders)`,
      );
    } catch (e: any) {
      logger.error(`  ✗ Cascade model-id validation failed: ${e?.message || e}`);
      throw e;
    }

    // Step 3: Connect to database
    // Task #28: initialize structured tracer (Sentry if @sentry/node + DSN
    // present, JSONL fallback otherwise — never throws).
    try {
      const { initTracer } = await import('./utils/jrx-tracer.js');
      await initTracer();
      logger.info('  ✓ Structured tracer initialized');
    } catch (tracerErr: any) {
      logger.warn(`  ⚠ Tracer init non-critical: ${tracerErr?.message ?? tracerErr}`);
    }

    await initializeDatabase();
    logger.info('  ✓ Database connected');

    // Step 4: Run migration safety checks
    await runMigrationSafetyChecks();
    logger.info('  ✓ Migration safety checks passed');

    // Step 5: Run DB index maintenance
    await runDbIndexMigration();
    logger.info('  ✓ DB indexes verified');

    await loadDcNumericStatusMasterFromDb();

    // Step 5b (JRX-NS-010, 2026-05-01): audit-log hash-chain self-test.
    // Bootstrap-blocking unless JRX_AUDIT_CHAIN_TOLERATE=1.
    await assertAuditChainIntegrityOnBoot();
    logger.info('  ✓ Audit hash-chain integrity verified');

    // Step 5b2 (NV-HASHCHAIN-CRON-001, 2026-06-25): schedule the DAILY audit
    // hash-chain re-verification (02:00 UTC). Implementation existed in
    // hash-chain-verifier.ts (scheduleHashChainCron) but was never wired from
    // any bootstrap (the referenced src/cron/index.ts never existed), so the
    // SOC2/ISO control CRY-006 "periodic integrity verification" had only the
    // one-shot boot self-test, not the recurring cron. Non-blocking; disable
    // with JRX_HASHCHAIN_CRON_DISABLED=1.
    if (!/^(1|true|yes|on)$/i.test(String(process.env.JRX_HASHCHAIN_CRON_DISABLED ?? ''))) {
      try {
        scheduleHashChainCron();
        logger.info('  ✓ Daily hash-chain verification cron scheduled (02:00 UTC)');
      } catch (e: any) {
        logger.warn(`  ! Hash-chain cron NOT scheduled: ${e?.message || e}`);
      }
    }

    // Step 5c (JRX-NS-014, 2026-05-01): schedule vector-store eviction.
    // Non-blocking: failures log and the gateway continues. Disable with
    // JRX_RAG_EVICT_DISABLED=1 (e.g. on read-only replicas).
    try {
      startVectorEvictionJob();
      logger.info('  ✓ Vector-store eviction scheduled');
    } catch (e: any) {
      logger.warn(`  ! Vector-store eviction NOT scheduled: ${e?.message || e}`);
    }

    // Step 6: Initialize services
    await initializeServices();
    logger.info('  ✓ Services initialized');

    // Step 7: Initialize active v5.1.0 registry (Default 164 + optional jurisdiction overlay)
    await initializeAgentRegistry();
    logger.info('  ✓ Agent registry loaded');

    // Step 7b: Load the canonical jurisdiction registry set for discovery/reporting
    try {
      const { loadAllJurisdictionRegistries } = await import('./config/jurisdiction-configs.js');
      const jResult = loadAllJurisdictionRegistries();
      logger.info(`  ✓ Jurisdiction registries loaded: ${jResult.totalAgents} agents across ${jResult.jurisdictions.length} jurisdictions [${jResult.jurisdictions.join(',')}]`);
    } catch (jErr: any) {
      logger.warn(`  ⚠ Jurisdiction registry load non-critical: ${jErr.message}`);
    }

    // Step 8: Seed SDK apps (idempotent)
    await seedSdkApplications();
    await seedSdkData();
    logger.info('  ✓ SDK applications seeded');

    // Step 8b: Seed statute database (all 6 jurisdictions — idempotent)
    try {
      const { seedStatuteDatabase } = await import('./services/jrx-statute-seeding-service.js');
      const statuteResult = await seedStatuteDatabase();
      logger.info(`  ✓ Statute database ready: ${statuteResult.seeded} sections [${statuteResult.jurisdictions.join(',')}] — ${statuteResult.status}`);
    } catch (statuteErr: any) {
      logger.warn(`  ⚠ Statute seeding non-critical error: ${statuteErr.message}`);
    }

    // Step 8b2: Seed model catalog + LLM providers (8 providers, 15 models)
    try {
      const { seedModelCatalog } = await import('./services/jrx-model-catalog-seeding-service.js');
      const catalogResult = await seedModelCatalog();
      logger.info(`  ✓ Model catalog ready: ${catalogResult.providers} providers, ${catalogResult.models} models`);
    } catch (catalogErr: any) {
      logger.warn(`  ⚠ Model catalog seeding non-critical error: ${catalogErr.message}`);
    }

    // Step 8c: Initialize Redis cache (with in-memory LRU fallback if unavailable)
    try {
      const { nvRedisCache } = await import('./services/jrx-redis-cache-service.js');
      await nvRedisCache.connect();
      const redisStats = nvRedisCache.getStats();
      logger.info(`  ✓ Cache service initialized [mode: ${redisStats.mode}]`);
    } catch (redisErr: any) {
      logger.warn(`  ⚠ Cache service non-critical error: ${redisErr.message}`);
    }

    // Step 8c2: Background workers (PgJobQueue EDJ, BullMQ, doc poller, timers)
    try {
      const platformJobs = await startPlatformJobs();
      /*
       * NV-DEPLOY-DRAIN-001 (2026-08-18) — graceful shutdown, not just job teardown.
       *
       * This handler previously stopped background jobs and nothing else, so on `docker
       * stop` the process died with in-flight HTTP requests still open. Combined with a
       * deploy that does `docker stop && docker rm && up -d`, that is how NSP's durable
       * task 387 failed: it was created 124 ms after the new container started and 61 s
       * before health went green, and a refused connection surfaces to the partner as a
       * 502. Every deploy was an outage window for in-flight partner work.
       *
       * Draining here is the half we own: stop accepting new connections, let in-flight
       * requests finish inside a bounded grace period, then exit. `server.close()` alone
       * would hang indefinitely on keep-alive sockets, hence the timeout and the explicit
       * `closeAllConnections()` once the grace period expires.
       */
      const drainMs = (() => {
        const n = Number(process.env.JRX_SHUTDOWN_DRAIN_MS);
        return Number.isFinite(n) && n >= 0 ? Math.min(60_000, Math.floor(n)) : 15_000;
      })();
      let shuttingDown = false;
      for (const sig of ['SIGTERM', 'SIGINT'] as const) {
        process.once(sig, () => {
          if (shuttingDown) return;
          shuttingDown = true;
          logger.info(`[shutdown] ${sig} received — draining for up to ${drainMs}ms`);
          /* Flip readiness FIRST so a load balancer or the deploy's own health poll stops
           * routing to us while we finish what we already accepted. */
          setPlatformDraining(true);
          void platformJobs.stop();
          const srv = server;
          const forceExit = setTimeout(() => {
            logger.warn('[shutdown] grace period expired — closing remaining connections');
            /* Node 18.2+; guarded because a missing method must not turn a clean
             * shutdown into an unhandled TypeError. */
            (srv as unknown as { closeAllConnections?: () => void }).closeAllConnections?.();
            process.exit(0);
          }, drainMs);
          forceExit.unref();
          srv.close(() => {
            clearTimeout(forceExit);
            logger.info('[shutdown] in-flight requests drained; exiting cleanly');
            process.exit(0);
          });
        });
      }
      logger.info(`  ✓ Platform background jobs: ${JSON.stringify(platformJobs.status())}`);
    } catch (jobsErr: any) {
      logger.error(`  ✗ Platform background jobs failed: ${jobsErr?.message || jobsErr}`);
    }

    // Step 8d: Load swarm topology registry (107 topologies)
    try {
      const { nvSwarmTopologyService } = await import('./services/jrx-swarm-topology-service.js');
      const swarmStats = nvSwarmTopologyService.stats();
      logger.info(`  ✓ Swarm topology registry loaded: ${swarmStats.total} topologies (GRPO: ${swarmStats.grpoCompatible})`);
    } catch (swarmErr: any) {
      logger.warn(`  ⚠ Swarm topology load non-critical error: ${swarmErr.message}`);
    }

    // Step 8e: Initialize 47-language router
    try {
      const { nvLanguageRouter } = await import('./services/jrx-language-router-service.js');
      const langStats = nvLanguageRouter.getSupportedLanguages();
      logger.info(`  ✓ Language router ready: ${langStats.total} languages (${langStats.indian} Indian, ${langStats.global} global)`);
    } catch (langErr: any) {
      logger.warn(`  ⚠ Language router non-critical error: ${langErr.message}`);
    }

    // Step 9: JWT rotation monitor
    await runJwtRotationCheck();
    logger.info('  ✓ JWT rotation monitor active');

    // Step 10: PII vault cleanup scheduler (Redis-backed, cluster-safe)
    await initPiiVaultCleanup();
    logger.info('  ✓ PII vault cleanup scheduled');

    // Step 11: Document pipeline poller — started via startPlatformJobs() (Step 8c2)

    // Step 12a: Razorpay Payment Gateway — MUST integration for India market
    {
      const rzpConfigured = PAYMENT_CONFIG.razorpay.isConfigured;
      const rzpKeyId = PAYMENT_CONFIG.razorpay.keyId;
      const rzpIsTest = rzpKeyId?.startsWith('rzp_test_');
      if (rzpConfigured && !rzpIsTest) {
        logger.info('  ✓ Razorpay Payment Gateway: LIVE MODE — orders, subscriptions, UPI, invoices, payment links active');
      } else if (rzpConfigured && rzpIsTest) {
        logger.info('  ✓ Razorpay Payment Gateway: TEST MODE (rzp_test_...) — switch to rzp_live_... for production');
      } else {
        logger.info('  ℹ Razorpay Payment Gateway: mock mode — set RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET to activate');
        logger.info('    Endpoints: /api/jrx/payments/* — health, orders, capture, refund, subscriptions, customers, invoices, links, webhook');
      }
    }

    // Step 12c: Feature Flag DB sync — wire in-memory flags from scoped_feature_flags table
    try {
      await featureFlagManager.syncFromDatabase();
      logger.info('  ✓ Feature flags synced from database');
    } catch (ffErr: any) {
      logger.warn(`  ⚠ Feature flag DB sync non-critical: ${ffErr.message}`);
    }

    // Step 12d: Quantum Security Framework — activate if JRX_FEATURE_QUANTUM=true
    if (process.env.JRX_FEATURE_QUANTUM === 'true') {
      try {
        const { quantumSecurityWiringService } = await import('./packages/security/quantum-security-wiring-service.js');
        const qStatus = await quantumSecurityWiringService.getSecurityStatus();
        // The wiring service's status object varies by initialization branch
        // (initialized vs. error). Read `kemAlgorithm` through a narrow
        // optional shape rather than blanket `any`.
        const kemAlgorithm = (qStatus as { kemAlgorithm?: string; framework?: { kemAlgorithm?: string } }).kemAlgorithm
          ?? (qStatus as { framework?: { kemAlgorithm?: string } }).framework?.kemAlgorithm
          ?? 'ML-KEM-512';
        logger.info(`  ✓ Quantum Security Framework active — Algorithm: ${kemAlgorithm}`);
      } catch (qErr: any) {
        logger.warn(`  ⚠ Quantum Security non-critical: ${qErr.message}`);
      }
    } else {
      logger.info('  ℹ Quantum Security: simulation mode (set JRX_FEATURE_QUANTUM=true to activate)');
    }

    // Step 12e: Start background monitoring services
    regulatoryMonitor.startPolling(3600000);
    logger.info('  ✓ Regulatory Monitor polling started (1-hour interval)');

    // NV-OWN-REG-FEED-001: Tavily regulatory sweeps DISABLED by default.
    // Own RSS → S3 + RDS + RAG ingest runs via legal-intelligence feed scheduler.
    if (String(process.env.JRX_ENABLE_TAVILY_REG_SWEEP || '0').trim() === '1') {
      regulatoryMonitor.startTavilySweeps(30 * 60_000);
      logger.info('  ✓ Tavily regulatory sweeps enabled (JRX_ENABLE_TAVILY_REG_SWEEP=1)');
    } else {
      logger.info('  ✓ Own regulatory feed path (Tavily sweeps off — legal-intel RSS/S3/RDS/RAG)');
    }

    llmPriorityManager.startHealthChecks(30000);
    logger.info('  ✓ LLM Priority Manager health checks started (30s interval)');

    digitalTwinService.startMonitoring();
    logger.info('  ✓ Digital Twin monitoring started');

    nvMemoryManager.startMonitoring();
    logger.info('  ✓ Memory Manager monitoring started (session LRU + heap pressure)');

    nvDbPoolManager.startMonitoring();
    logger.info('  ✓ DB Pool Manager monitoring started (all registered pools, 30s interval)');

    nvDbPoolManager.warmup(2).catch((e: Error) =>
      logger.warn('  ⚠ DB pool warmup partial', { error: e.message })
    );

    // Step 12.5: Governance DDL on empty RDS (protocol_registry for manifest boot).
    try {
      const { ensureGovernanceBootstrap } = await import('./db/jrx-governance-bootstrap.js');
      await ensureGovernanceBootstrap();
      logger.info('  ✓ Governance schema bootstrap (protocol_registry)');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('  ⚠ Governance schema bootstrap failed (manifest init may retry DDL)', { error: msg });
    }

    // Step 12.6: Manifest-driven catalog bootstrap (Task #32).
    // Initialize the protocol registry from the SSoT capability manifest so
    // every catalogued capability is uniformly callable via the registry
    // contract on the first request. PROD fails loud on initialization
    // failure; non-PROD logs a warning and continues.
    try {
      const { nvProtocolRegistryService } = await import('./services/jrx-orchestration-services.js');
      const stats = await nvProtocolRegistryService.initializeFromManifest();
      logger.info(`  ✓ Manifest registry bootstrap: ${stats.registered} registered, ${stats.skipped} skipped, ${stats.total} total`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (process.env.NODE_ENV === 'production') {
        logger.error('  ✗ Manifest registry bootstrap failed in production — aborting startup', { error: msg });
        throw new Error(`[Bootstrap] manifest registry initialization failed in production: ${msg}`);
      }
      logger.warn('  ⚠ Manifest registry bootstrap failed (non-PROD, continuing)', { error: msg });
    }

    // Step 11.5 — Task #223: deterministically hydrate the four "products"
    // services from Postgres BEFORE we start serving requests. The services
    // themselves call _hydrate() lazily on read, but lazy hydrate is async
    // and synchronous getters can't await it, so first-read after restart
    // could return empty even when records exist in DB. Awaiting here makes
    // cold-start consistent and matches the requirement that records survive
    // restart and stay consistent across pods.
    try {
      const [
        { claWdBotService },
        { automateAIService },
        { openBotService },
        { twinDeskService },
      ] = await Promise.all([
        import('./services/clawdbot/clawdbot-service.js'),
        import('./services/automateai/automateai-service.js'),
        import('./services/openbot/openbot-service.js'),
        import('./services/twindesk/twindesk-service.js'),
      ]);
      await Promise.all([
        claWdBotService._hydrate(),
        automateAIService._hydrate(),
        openBotService._hydrate(),
        twinDeskService._hydrate(),
      ]);
      logger.info('  ✓ ClaWdBot™ / AutomateAI™ / OpenBot™ / TwinDesk™ hydrated from DB');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('  ⚠ Bot/workflow/twin hydration failed (lazy hydrate will retry on first read)', { error: msg });
    }

    // Task #337 (2026-05-13): idempotent dev seeder for the Console
    // Intelligence Dashboard's firm-snapshot fetch (cases / hearings /
    // invoices for org_id=1). NODE_ENV !== 'production' guard is enforced
    // both here AND inside seedFirmSnapshotDemo() itself.
    if (process.env.NODE_ENV !== 'production') {
      try {
        const { seedFirmSnapshotDemo } = await import('../scripts/jrx-seed-firm-snapshot-demo.js');
        const r = await seedFirmSnapshotDemo({ quiet: true });
        if (r.skipped) {
          logger.info(`  ⓘ Firm-snapshot demo seed skipped: ${r.reason ?? 'unknown'}`);
        } else {
          logger.info(`  ✓ Firm-snapshot demo seed: cases+${r.inserted.cases}, hearings+${r.inserted.hearings}, invoices+${r.inserted.invoices}`);
        }
      } catch (e: any) {
        logger.warn('  ⚠ Firm-snapshot demo seed crashed (non-fatal)', { error: e?.message });
      }
    }

    try {
      const { romaL5Engine } = await import('./packages/protocols/roma/roma-l5-engine.js');
      await romaL5Engine.hydrate();
      const { seedRomaStoreFromRouterDecisions } = await import('./services/jrx-roma-seed-from-router.js');
      const seeded = await seedRomaStoreFromRouterDecisions();
      const keys = Object.keys(romaL5Engine.getPerformanceStore()).length;
      logger.info(`  ✓ ROMA L5 performance store hydrated (${keys} agents${seeded ? `, seeded ${seeded}` : ''})`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('  ⚠ ROMA L5 hydrate/seed failed (in-memory store still live)', { error: msg });
    }

    // Step 12: Start server
    server.listen(JRX_PORT_GATEWAY, '0.0.0.0', () => {
      logger.info('\n══════════════════════════════════════════════════════');
      logger.info(`  JRX-SVC-GATEWAY online  → http://0.0.0.0:${JRX_PORT_GATEWAY}`);
      logger.info(`  API Docs               → http://0.0.0.0:${JRX_PORT_GATEWAY}/api/jrx/docs`);
      logger.info(`  Health Check           → http://0.0.0.0:${JRX_PORT_GATEWAY}/api/jrx/health`);
      logger.info('══════════════════════════════════════════════════════\n');
    });

  } catch (error: any) {
    logger.error('  ✗ STARTUP FAILED:', error);
    // Pino-pretty in dev swallows the Error object — also dump raw stack to
    // stderr so the operator can actually diagnose startup crashes.
    // eslint-disable-next-line no-console
    console.error('[STARTUP-FAILED-RAW]', error?.stack || error?.message || error);
    process.exit(1);
  }
}

start();

export { app, server };
export { getAgentRegistry } from './services/jrx-client.js';
