// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * NYV Model Registry Routes
 * /api/jrx/models/*
 * ─────────────────────────────────────────────────────────────────────────────
 * REST API for dynamic model management. Allows registering, disabling, and
 * querying LLM/SLM/LRM models without any code changes or restarts.
 *
 * Auth: Admin role required for write operations.
 * Read operations require API key or admin session.
 *
 * @module nv-model-registry-routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { dynamicModelRegistry, ModelRegistryEntry, ModelTier, JurisdictionCode } from '../config/nyv-dynamic-model-registry.js';
import {
  listModelCatalogAsRegistry,
  modelCatalogRegistryStats,
} from '../services/intelligent-router/jrx-model-catalog-bridge.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-model-registry-routes');
const router = Router();

// NV-RBAC-GAP-001: the registry is a PLATFORM-GLOBAL routing table — registering,
// toggling, deregistering or hot-reloading a model affects every tenant. The
// module header says "Admin role required for write operations" but nothing
// enforced it. Gate all writes with auth + super_admin (hierarchy-aware). Reads
// stay open for the customer-facing Model Catalog / SDK callers.
const adminOnly = [authenticateToken, requireRole('super_admin')];

// ─────────────────────────────────────────────────────────────────────────────
// Customer-facing catalog hygiene (console-cpo-audit §0): the dynamic registry
// keeps OpenRouter `:free` community models (Nous Hermes / OpenChat / Zephyr) as
// tier-4 SOVEREIGN fallbacks. They are routed in-process by the intelligent
// router and must stay registered — but enterprise legal buyers should never
// see "free tier" branding in the customer-facing Model Catalog page (which
// reads GET /api/jrx/models). We therefore HIDE these free-tier backups from the
// list response by default. Internal/admin callers can still inspect them with
// `?includeFreeTier=true`. This is presentation-only filtering on the HTTP
// surface; isProviderAvailable()/orchestrateLLM fallback is unaffected.
function isFreeTierBackup(m: ModelRegistryEntry): boolean {
  const providerModelId = String((m as { providerModelId?: string }).providerModelId ?? '');
  const tags = Array.isArray(m.tags) ? m.tags.map(t => String(t).toLowerCase()) : [];
  return (
    m.provider === 'openrouter' &&
    (providerModelId.includes(':free') || tags.includes('free'))
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/models
// List all registered models with optional filters
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const { type, tier, jurisdiction, provider, enabled, search, includeFreeTier } = req.query;

  // NV-MODEL-SSOT-001: customer-facing catalog reads intelligent-router MODEL_CATALOG.
  let models = listModelCatalogAsRegistry();

  // Default customer-facing view excludes `:free` OpenRouter backups (branding).
  if (includeFreeTier !== 'true') models = models.filter(m => !isFreeTierBackup(m));

  if (type) models = models.filter(m => m.type === type);
  if (tier) models = models.filter(m => m.routing.tier === Number(tier));
  if (jurisdiction) models = models.filter(m =>
    m.capabilities.supportedJurisdictions.includes(jurisdiction as JurisdictionCode) ||
    m.capabilities.supportedJurisdictions.includes('GLOBAL')
  );
  if (provider) models = models.filter(m => m.provider === provider);
  if (enabled !== undefined) models = models.filter(m => m.enabled === (enabled === 'true'));
  if (search) {
    const q = (search as string).toLowerCase();
    models = models.filter(m =>
      m.id.toLowerCase().includes(q) ||
      m.displayName.toLowerCase().includes(q) ||
      m.tags.some(t => t.includes(q))
    );
  }

  res.json({
    success: true,
    data: {
      models: models.sort((a, b) => a.routing.tier - b.routing.tier || a.routing.priority - b.routing.priority),
      stats: modelCatalogRegistryStats(),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/models/stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', (_req: Request, res: Response) => {
  res.json({ success: true, data: modelCatalogRegistryStats() });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/models/select
// Select the optimal model for given context
// Query: ?jurisdiction=IN&tier=2&queryType=legal-research&language=hi
// ─────────────────────────────────────────────────────────────────────────────
router.get('/select', (req: Request, res: Response) => {
  const { jurisdiction, tier, queryType, language, requiresStreaming, requiresVision, maxCostPer1kInput } = req.query;

  const model = dynamicModelRegistry.selectModel({
    jurisdiction: jurisdiction as JurisdictionCode | undefined,
    tier: tier ? Number(tier) as ModelTier : undefined,
    queryType: queryType as string | undefined,
    language: language as string | undefined,
    requiresStreaming: requiresStreaming === 'true',
    requiresVision: requiresVision === 'true',
    maxCostPer1kInput: maxCostPer1kInput ? Number(maxCostPer1kInput) : undefined,
  });

  if (!model) {
    res.status(404).json({ success: false, error: 'No model found matching criteria' });
  }

  res.json({ success: true, data: model });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/models/providers
// Per-provider readiness matrix for the console "LLM Providers" panel.
// NV-PROVIDER-READINESS-001 (2026-06-17): surfaces, for every allowed +
// inactive provider, whether it is live (env-key present / enable flag set),
// the env-var NAME(s) it needs (NV-SECRETS-001: names only, never values),
// and how many catalog models it carries. Registered BEFORE `/:modelId` so the
// literal path is not captured by the model-id param route.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/providers', async (_req: Request, res: Response): Promise<void> => {
  try {
    const {
      ALLOWED_PROVIDERS, INACTIVE_PROVIDERS, PROVIDER_MODEL_CATALOG,
    } = await import('../config/nyv-allowed-providers.js');
    const { isProviderAvailable, providerKeyRequirement } = await import('../services/intelligent-router/model-catalog.js');

    const build = (id: string, status: 'allowed' | 'inactive') => {
      let available = false;
      try { available = isProviderAvailable(id); } catch { available = false; }
      let requiresEnv: string[] = [];
      try { requiresEnv = providerKeyRequirement(id); } catch { requiresEnv = []; }
      const catalog = (PROVIDER_MODEL_CATALOG as Record<string, string[]>)[id] ?? [];
      return {
        id,
        status,
        available,
        configured: requiresEnv.length === 0 ? available : requiresEnv.some((k) => !!process.env[k]),
        requiresEnv,
        modelCount: catalog.length,
      };
    };

    const allowed = (ALLOWED_PROVIDERS as readonly string[]).map((p) => build(p, 'allowed'));
    const inactive = (INACTIVE_PROVIDERS as readonly string[]).map((p) => build(p, 'inactive'));
    const providers = [...allowed, ...inactive];

    res.json({
      success: true,
      data: {
        providers,
        summary: {
          allowed: allowed.length,
          inactive: inactive.length,
          total: providers.length,
          live: providers.filter((p) => p.available).length,
        },
        // NV-BEDROCK-LIVE-001: ops note surfaced to the console.
        notes: {
          bedrock: 'Code-ready + IAM-verified (ap-south-1). Set NYV_BEDROCK_ENABLED=true after submitting the one-time Anthropic use-case form in the Bedrock console for the AWS account.',
        },
      },
    });
  } catch (err) {
    logger.error('providers_status_failed', { error: err instanceof Error ? err.message : String(err) });
    res.status(500).json({ success: false, error: 'provider status unavailable' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/models/:modelId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:modelId', (req: Request, res: Response) => {
  const model = listModelCatalogAsRegistry().find((m) => m.id === req.params.modelId);
  if (!model) {
    res.status(404).json({ success: false, error: `Model not found: ${req.params.modelId}` });
    return;
  }
  res.json({ success: true, data: model });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/models/register
// Register a new model (or update existing) — zero code change
// Body: ModelRegistryEntry
// ─────────────────────────────────────────────────────────────────────────────
router.post('/register', adminOnly, (req: Request, res: Response) => {
  try {
    const entry: ModelRegistryEntry = req.body;
    if (!entry?.id) {
      res.status(400).json({ success: false, error: 'Missing required field: id' });
    }

    const wasExisting = !!dynamicModelRegistry.getModel(entry.id);
    dynamicModelRegistry.register(entry, req.user?.email ?? 'api');

    logger.info(`[ModelRegistry] Model ${wasExisting ? 'updated' : 'registered'} via API: ${entry.id}`);

    res.status(wasExisting ? 200 : 201).json({
      success: true,
      data: dynamicModelRegistry.getModel(entry.id),
      action: wasExisting ? 'updated' : 'registered',
    });
  } catch (err: any) {
    logger.error(`[ModelRegistry] Registration failed: ${err.message}`);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/jrx/models/:modelId/toggle
// Enable or disable a model without removing it
// Body: { enabled: true|false }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:modelId/toggle', adminOnly, (req: Request, res: Response) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ success: false, error: 'enabled must be a boolean' });
  }

  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    dynamicModelRegistry.setEnabled(req.params.modelId, enabled);
    res.json({
      success: true,
      data: { modelId: req.params.modelId, enabled },
    });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/jrx/models/:modelId
// Remove a model from the registry
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:modelId', adminOnly, (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const removed = dynamicModelRegistry.deregister(req.params.modelId);
  if (!removed) {
    res.status(404).json({ success: false, error: `Model not found: ${req.params.modelId}` });
  }
  res.json({ success: true, data: { removed: req.params.modelId } });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/models/reload
// Hot reload from config file and env vars (no restart)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/reload', adminOnly, async (req: Request, res: Response) => {
  try {
    const result = await dynamicModelRegistry.hotReload();
    logger.info(`[ModelRegistry] Hot reload triggered via API`);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/models/jurisdiction/:code
// Get models recommended for a jurisdiction
// ─────────────────────────────────────────────────────────────────────────────
router.get('/jurisdiction/:code', (req: Request, res: Response) => {
  const models = dynamicModelRegistry.getByJurisdiction(req.params.code as JurisdictionCode);
  const slm = dynamicModelRegistry.getForSLM(req.params.code as JurisdictionCode);
  res.json({
    success: true,
    data: {
      jurisdiction: req.params.code,
      slm: slm ?? null,
      ranked: models,
      total: models.length,
    },
  });
});

export { router as modelRegistryRoutes };
