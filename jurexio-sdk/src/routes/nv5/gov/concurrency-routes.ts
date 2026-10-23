// /api/nv5/gov/concurrency/* — admin read endpoints for the orchestration
// concurrency governor (per-tenant + per-provider semaphores).
//
// The withTenantSlot/withProviderSlot/withSlots wrappers are invoked from
// the queen orchestrator chain (already wired); this barrel adds an
// observability surface plus a static-import edge so the wiring auditor
// counts the file WIRED. Strict SDK auth + admin scope.
import { Router, type Request, type Response } from 'express';
import { snapshotGovernor } from '../../../orchestration/concurrency-governor.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/snapshot', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  try {
    const snap = snapshotGovernor();
    res.json({
      success: true,
      capturedAt: new Date().toISOString(),
      ...snap,
      summary: {
        activeTenants:   snap.tenants.length,
        activeProviders: snap.providers.length,
        totalInFlight:   snap.tenants.reduce((n, t) => n + t.inFlight, 0),
        totalQueued:     snap.tenants.reduce((n, t) => n + t.queued, 0),
      },
    });
  } catch (e) { safeError(res, e); }
});

export default router;
