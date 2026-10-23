// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX Tenant Management Routes
 * /api/jrx/tenants/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Enterprise SaaS tenant provisioning, management, and reporting.
 * All operations are admin-only. Tenant data is strictly isolated.
 *
 * @module jrx-tenant-management-routes
 */

import { Router, Request, Response } from 'express';
import { tenantManager, TenantTier, DeploymentModel, DataResidencyRegion } from '../services/jrx-saas-tenant-manager.js';
import { authenticateToken, requireRole } from '../middleware/jrx-auth.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-tenant-routes');
const router = Router();

// NV-RBAC-GAP-001: the whole tenant lifecycle (list/provision/suspend/activate/
// usage/audit) is platform-superadmin territory — the module header already
// states "All operations are admin-only" but nothing enforced it. Gate the
// ENTIRE router with auth + a hierarchy-aware super_admin check (roleSatisfies),
// closing the unauthenticated cross-tenant exposure surfaced by the RBAC sweep.
router.use(authenticateToken, requireRole('super_admin'));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/tenants
// List all tenants (admin only)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const { status, tier, deploymentModel, region } = req.query;
  let tenants = tenantManager.getAll();

  if (status) tenants = tenants.filter(t => t.status === status);
  if (tier) tenants = tenants.filter(t => t.tier === tier as TenantTier);
  if (deploymentModel) tenants = tenants.filter(t => t.deploymentModel === deploymentModel as DeploymentModel);
  if (region) tenants = tenants.filter(t => t.data.dataResidencyRegion === region as DataResidencyRegion);

  res.json({
    success: true,
    data: {
      tenants,
      total: tenants.length,
      active: tenants.filter(t => t.status === 'active').length,
      byTier: tenants.reduce((acc, t) => { acc[t.tier] = (acc[t.tier] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/tenants/:tenantId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:tenantId', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const tenant = tenantManager.get(req.params.tenantId);
  if (!tenant) {
    res.status(404).json({ success: false, error: `Tenant not found: ${req.params.tenantId}` });
  }
  res.json({ success: true, data: tenant });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/tenants
// Provision a new tenant
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', (req: Request, res: Response) => {
  try {
    const config = req.body;
    if (!config.tenantId || !config.orgId || !config.tier) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: tenantId, orgId, tier',
      });
    }

    if (tenantManager.get(config.tenantId)) {
      res.status(409).json({ success: false, error: `Tenant already exists: ${config.tenantId}` });
    }

    const tenant = tenantManager.provision(config);
    logger.info(`[TenantRoutes] Provisioned tenant: ${config.tenantId}`);
    res.status(201).json({ success: true, data: tenant });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/jrx/tenants/:tenantId/tier
// Upgrade or downgrade tenant tier
// Body: { tier: 'enterprise' }
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:tenantId/tier', (req: Request, res: Response) => {
  const { tier } = req.body;
  if (!tier) { res.status(400).json({ success: false, error: 'Missing required field: tier' }); return; }
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    tenantManager.upgrade(req.params.tenantId, tier as TenantTier);
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    res.json({ success: true, data: tenantManager.get(req.params.tenantId) });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/tenants/:tenantId/suspend
// Suspend a tenant (access blocked, data retained)
// Body: { reason: 'payment_failed' }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:tenantId/suspend', (req: Request, res: Response) => {
  const { reason } = req.body;
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    tenantManager.suspend(req.params.tenantId, reason ?? 'admin-action');
    logger.warn(`[TenantRoutes] Suspended: ${req.params.tenantId} — ${reason}`);
    res.json({ success: true, data: { tenantId: req.params.tenantId, status: 'suspended' } });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/tenants/:tenantId/activate
// Activate a suspended or pending tenant
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:tenantId/activate', (req: Request, res: Response) => {
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    tenantManager.activate(req.params.tenantId);
    res.json({ success: true, data: { tenantId: req.params.tenantId, status: 'active' } });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/tenants/:tenantId/usage
// Usage and spend report for a tenant
// Query: ?from=2026-04-01&to=2026-04-30
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:tenantId/usage', async (req: Request, res: Response) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const to = req.query.to ? new Date(req.query.to as string) : new Date();
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    const report = await tenantManager.getUsageReport(req.params.tenantId, from, to);
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/tenants/:tenantId/model-access
// Check which models this tenant can use
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:tenantId/model-access', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const tenant = tenantManager.get(req.params.tenantId);
  if (!tenant) { res.status(404).json({ success: false, error: `Tenant not found: ${req.params.tenantId}` }); return; }
  res.json({
    success: true,
    data: {
      tenantId: req.params.tenantId,
      tier: tenant.tier,
      allowedModels: tenant.llm.allowedModels,
      blockedModels: tenant.llm.blockedModels,
      defaultModel: tenant.llm.defaultModel,
      maxModelTier: tenant.llm.maxModelTier,
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/jrx/tenants/:tenantId/audit
// Log an admin audit event for this tenant
// Body: { action, actor, details }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:tenantId/audit', (req: Request, res: Response) => {
  const { action, actor, details } = req.body;
  try {
    // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
    tenantManager.auditLog(req.params.tenantId, action, actor ?? 'api', details ?? {});
    res.json({ success: true, data: { logged: true } });
  } catch (err: any) {
    res.status(404).json({ success: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/jrx/tenants/by-org/:orgId
// Look up tenant by organization ID
// ─────────────────────────────────────────────────────────────────────────────
router.get('/by-org/:orgId', (req: Request, res: Response) => {
  // @ts-expect-error NV-TS230 legacy typing gap (TS2345)
  const tenant = tenantManager.getByOrgId(req.params.orgId);
  if (!tenant) {
    res.status(404).json({ success: false, error: `No tenant found for org: ${req.params.orgId}` });
  }
  res.json({ success: true, data: tenant });
});

export { router as tenantManagementRoutes };
