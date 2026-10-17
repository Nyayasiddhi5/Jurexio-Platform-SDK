/**
 * Phase C Scaffold Stubs (introduced 2026-05-06)
 *
 * Each of the 14 NEW console pages from `docs/v5.0.0/NAVIGATION-AND-DASHBOARD-AUDIT-2026-05-06.md` §6
 * Phase C is backed by a stub route here that returns 501 + feature_flag.
 *
 * The corresponding page (in `client/src/pages/<slug>.tsx`) renders a
 * "Phase C scaffold — feature pending" UI when it sees 501. When the backend
 * is implemented, replace the 501 handler here and the page will light up
 * automatically (no client edit needed).
 *
 * Spec: audit doc §6 — "real endpoint OR a new src/routes/jrx-<feature>-routes.ts
 * skeleton returning 501 with a clear feature_flag field — so the UI compiles
 * and renders, but production knows the feature is staged."
 */
import { Router } from 'express';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-phase-c-stubs');

interface PhaseCEndpoint {
  path: string;
  flag: string;
  feature: string;
  capabilities: string[];
  ownerNote: string;
  /** When backend is not yet live — surfaced in 501 manifest for honest UI */
  deferredReason?: string;
  /**
   * T011 Stream B (2026-05-06): when true the Phase C scaffold has been
   * replaced by a real backend. The stub remains for back-compat but
   * issues a 308 redirect to the live route declared in `passthrough`.
   */
  superseded?: boolean;
  passthrough?: string;
}

export const PHASE_C_ENDPOINTS: PhaseCEndpoint[] = [
  // ─── Command Center (3) ────────────────────────────────────────────
  {
    path: '/platform-health-map',
    flag: 'platform_health_map',
    feature: 'Platform Health Map',
    capabilities: ['Per-platform (NSP/NSPM/NSI/NSM/NSA/NYM/JRX) live request rate, p95 latency, error rate', 'SLO compliance gauges', 'Cross-region health diff'],
    ownerNote: 'Superseded 2026-05-28: live aggregator at /api/jrx/health/full/deps (+ admin alias).',
    superseded: true,
    passthrough: '/api/jrx/health/full/deps',
  },
  {
    path: '/live-activity-feed',
    flag: 'live_activity_feed',
    feature: 'Live Activity Feed',
    capabilities: ['SSE stream of recent SDK calls (org_id scoped)', 'Filter by platform_code, status, scope', 'Click-through to audit_chain entry'],
    ownerNote: 'New SSE endpoint; reuse audit_chain + sdk_request_log',
  },
  {
    path: '/my-approvals',
    flag: 'my_approvals',
    feature: 'My Approvals',
    capabilities: ['HITL queue items assigned_to current user', 'Decision card UI (approve/reject/escalate)', 'Decision history with hash-chain receipt'],
    ownerNote: 'Superseded 2026-05-13 (task #337): real backend at /api/jrx/my-approvals (wraps nv_hitl_queue + nv_hitl_decisions).',
    superseded: true,
    passthrough: '/api/jrx/my-approvals',
  },
  // ─── AI Operations (9) ─────────────────────────────────────────────
  {
    path: '/document-ai-hub',
    flag: 'document_ai_hub',
    feature: 'Document AI Hub',
    capabilities: ['Unified entry to OCR / Summarize / Compare / Compliance', 'Batch upload', 'Recent document timeline'],
    ownerNote: 'Superseded 2026-05-28: Console hub links to live docs-pipeline + RAG pages.',
    superseded: true,
    passthrough: '/api/jrx/sdk/docs-pipeline/documents/templates',
  },
  {
    path: '/ocr-extraction',
    flag: 'ocr_extraction',
    feature: 'OCR & Extraction',
    capabilities: ['Drop-zone for PDF / image', 'Tesseract + Gemini Vision OCR comparison', 'Field-level extraction (NER on legal entities)'],
    ownerNote: 'Superseded 2026-05-28: wraps /api/jrx/sdk/docs-pipeline/documents/parse.',
    superseded: true,
    passthrough: '/api/jrx/sdk/docs-pipeline/documents/parse',
  },
  {
    path: '/summarization',
    flag: 'summarization',
    feature: 'Summarization',
    capabilities: ['Per-document executive / detailed / bullet summaries', 'Per-jurisdiction prompt selection', 'Quality grade (LLM-as-judge)'],
    ownerNote: 'Superseded 2026-05-28: wraps /api/jrx/sdk/docs-pipeline/documents/summarize.',
    superseded: true,
    passthrough: '/api/jrx/sdk/docs-pipeline/documents/summarize',
  },
  {
    path: '/prompt-library',
    flag: 'prompt_library',
    feature: 'Prompt Library',
    capabilities: ['CRUD on org-level prompt templates', 'Variable substitution preview', 'Versioning + rollback'],
    ownerNote: 'Superseded 2026-05-28: reads /api/jrx/prompts curated seed + DB merge.',
    superseded: true,
    passthrough: '/api/jrx/prompts',
  },
  {
    path: '/rag-knowledge-base',
    flag: 'rag_knowledge_base',
    feature: 'RAG Knowledge Base',
    capabilities: ['Browse nv_rag_documents + nv_rag_chunks', 'Per-doc embedding inspection', 'Re-embed with newer model'],
    ownerNote: 'Superseded 2026-05-28: reads /api/jrx/rag/collections.',
    superseded: true,
    passthrough: '/api/jrx/rag/collections',
  },
  {
    path: '/tools-mcp',
    flag: 'tools_mcp',
    feature: 'Tools & MCP',
    capabilities: ['Browse nv_mcp_tools registry', 'Live invoke + log to nv_mcp_tool_calls', 'Per-tool RBAC'],
    ownerNote: 'Superseded 2026-05-28: jrx-legal-tools catalog + /api/jrx/v1/mcp/tools/:id/execute invoke.',
    superseded: true,
    passthrough: '/api/jrx/jrx-legal-tools/catalog',
  },
  {
    path: '/statutes-citations',
    flag: 'statutes_citations',
    feature: 'Statutes & Citations',
    capabilities: ['305 statute sections (IN/UK/EU/US/GC/SG) browser', 'Citation graph visualization', 'Cross-jurisdiction equivalence search'],
    ownerNote: 'Superseded 2026-05-28: live at /api/jrx/statutes + /api/jrx/statutes/_summary.',
    superseded: true,
    passthrough: '/api/jrx/statutes',
  },
  {
    path: '/jurisdiction-mapping',
    flag: 'jurisdiction_mapping',
    feature: 'Jurisdiction Mapping',
    capabilities: ['View 7 jurisdiction registries (1042 agents)', 'Per-jurisdiction agent capability matrix', 'Default-jurisdiction routing override'],
    ownerNote: 'Superseded 2026-05-28: live registry at /api/jrx/jurisdiction/registries/*.',
    superseded: true,
    passthrough: '/api/jrx/jurisdiction/registries/stats',
  },
  {
    path: '/web-scraping-targets',
    flag: 'web_scraping_targets',
    feature: 'Web Scraping Targets',
    capabilities: ['Configure regulatory monitor source URLs', 'Per-jurisdiction crawl cadence', 'Last-fetch status + deltas'],
    ownerNote: 'Superseded 2026-05-28: scraper allowlist at /api/jrx/tools/scrape/allowlist.',
    superseded: true,
    passthrough: '/api/jrx/tools/scrape/allowlist',
  },
  {
    path: '/multimodal-studio',
    flag: 'multimodal_studio',
    feature: 'Multimodal Studio',
    capabilities: ['Vision, video, audio, and 3D workspace', 'Unified upload + inference history', 'Operator-grade multimodal routing controls'],
    ownerNote: 'Superseded 2026-05-28: operator health at /api/nv5/multimodal/health (+ SDK paths under /api/jrx/sdk/multimodal/*).',
    superseded: true,
    passthrough: '/api/nv5/multimodal/health',
  },
  {
    path: '/identity-extraction',
    flag: 'identity_extraction',
    feature: 'Identity Extraction',
    capabilities: ['Government-ID field extraction', 'Confidence-scored entity review', 'PII-safe verification workflow'],
    ownerNote: 'Superseded 2026-05-28: live at /api/jrx/identity/extractions.',
    superseded: true,
    passthrough: '/api/jrx/identity/extractions',
  },
  {
    path: '/academy',
    flag: 'academy',
    feature: 'Jurexio Academy',
    capabilities: ['Learning pathways', 'Training sessions', 'Assessment and completion tracking'],
    ownerNote: 'Console route is gated until the Academy backend and curriculum workflows are fully wired',
    deferredReason: 'No first-class /api/jrx/academy/* router mounted — NSA platform health only at external NSA URL; academy schema tables exist but CRUD routes not wired.',
  },
  // ─── Observability (1) ──────────────────────────────────────────────
  {
    path: '/model-drift',
    flag: 'model_drift',
    feature: 'Model Drift Monitor',
    capabilities: [
      'Per-agent rolling p50/p95 latency from nv_agent_performance',
      '24h-vs-prior-24h accuracy delta',
      'Live agent drift list with empty-state handling',
    ],
    ownerNote: 'Superseded 2026-05-06 (T011): real backend at /api/jrx/drift/agents.',
    superseded: true,
    passthrough: '/api/jrx/drift/agents',
  },
  // ─── Governance (1) ─────────────────────────────────────────────────
  {
    path: '/dpdpa-compliance',
    flag: 'dpdpa_compliance',
    feature: 'DPDPA Compliance',
    capabilities: ['India DPDPA 2023 controls dashboard', 'Per-org consent ledger', 'PII-vault tokenization audit'],
    ownerNote: 'Superseded 2026-05-28: live dashboard at /api/jrx/compliance/dpdpa (Console page already wired).',
    superseded: true,
    passthrough: '/api/jrx/compliance/dpdpa',
  },
  // ─── SDK Developer (2) ──────────────────────────────────────────────
  {
    path: '/smoke-harness-console',
    flag: 'smoke_harness_console',
    feature: 'Smoke Harness Console',
    capabilities: ['Run scripts/jrx-smoke-bash.sh from UI', 'Per-platform pass/fail matrix', 'History of last 10 runs'],
    ownerNote: 'Wraps existing scripts/jrx-smoke-bash.sh; new run-and-stream endpoint',
    deferredReason: 'No POST /api/jrx/smoke-harness/run API — smoke is CLI-only (scripts/jrx-smoke-bash.sh, npm run smoke:*). UI run-and-stream endpoint not yet mounted.',
  },
  {
    path: '/database-schema',
    flag: 'database_schema',
    feature: 'Database Schema',
    capabilities: ['Browse 197 tables across public + nv_schema', 'Per-table column types, constraints, FK graph', 'Index utilization stats from pg_stat_user_indexes', 'Drift check vs shared/schema.ts (drizzle-kit check)'],
    ownerNote: 'Superseded 2026-05-28: pg_catalog browser at /api/jrx/db/schema.',
    superseded: true,
    passthrough: '/api/jrx/db/schema',
  },
];

export function createPhaseCStubsRouter(): Router {
  const router = Router();

  for (const ep of PHASE_C_ENDPOINTS) {
    router.get(ep.path, (req, res) => {
      // T011: when a stub has been superseded, redirect to its live route.
      if (ep.superseded && ep.passthrough) {
        logger.info({ feature: ep.feature, flag: ep.flag, passthrough: ep.passthrough }, 'phase_c_stub_superseded_redirect');
        res.redirect(308, ep.passthrough);
        return;
      }
      logger.info({ feature: ep.feature, flag: ep.flag }, 'phase_c_stub_called');
      res.status(501).json({
        ok: false,
        status: 'not_implemented',
        feature_flag: ep.flag,
        feature: ep.feature,
        message: `Phase C scaffold — ${ep.feature} backend pending. ${ep.ownerNote}`,
        deferredReason: ep.deferredReason ?? null,
        capabilities: ep.capabilities,
        scaffolded_at: '2026-05-06',
        replace_in: 'src/routes/jrx-phase-c-stubs-routes.ts',
      });
    });
  }

  // Manifest for the smoke harness + frontend introspection
  router.get('/_manifest', (_req, res) => {
    res.json({
      ok: true,
      total: PHASE_C_ENDPOINTS.length,
      scaffolded_at: '2026-05-06',
      endpoints: PHASE_C_ENDPOINTS.map(e => ({
        path: `/api/jrx/phase-c${e.path}`,
        feature: e.feature,
        flag: e.flag,
        superseded: e.superseded === true,
        passthrough: e.passthrough ?? null,
        deferredReason: e.deferredReason ?? null,
      })),
    });
  });

  logger.info({ count: PHASE_C_ENDPOINTS.length }, 'phase_c_stubs_router_initialized');
  return router;
}
