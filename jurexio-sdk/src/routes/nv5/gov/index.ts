// /api/nv5/gov/* — barrel router for Session-10 Batch D (governance /
// compliance / cost). All sub-routers are admin-scoped, read-only status /
// queue / snapshot endpoints. Each sub-mount is independently feature-
// flagged (default OFF). With all 5 flags OFF the entire namespace
// returns 404 — matching Batches A/B/C wiring discipline.
//
// Service classification (per task-101.md step 1):
//   - maker-checker-service        → admin route only (HITL queue read)
//   - jrx-security-monitor          → admin route only (already mounted as
//                                    middleware via JRX_F_SECURITY_MONITOR
//                                    in src/index.ts; this barrel adds the
//                                    static-import edge so the wiring
//                                    auditor counts it WIRED)
//   - jrx-cost-optimization-suite   → admin route only (cache + budget read)
//   - concurrency-governor         → admin route only (snapshot read)
//   - org-rate-limiter             → admin /check (read) + /cache/:orgId/
//                                    invalidate (cache flush — documented
//                                    exception to read-only). The middleware
//                                    IS conditionally mounted on /api/jrx/*
//                                    by src/index.ts under the SAME flag
//                                    (JRX_F_GOV_ORG_RATELIMIT, default OFF) —
//                                    architect-final 2026-05-10.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isJrxFeatureOn, type JrxFeatureFlag } from '../../../config/jrx-feature-flags.js';
import makerCheckerRouter from './maker-checker-routes.js';
import securityMonitorRouter from './security-monitor-routes.js';
import costOptimizerRouter from './cost-optimizer-routes.js';
import concurrencyRouter from './concurrency-routes.js';
import orgRatelimitRouter from './org-ratelimit-routes.js';

const router = Router();

// Always-on liveness probe (Phase 1 audit fix 2026-05-11). Additive.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'gov',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: {
      makerChecker:    isJrxFeatureOn('govMakerChecker'),
      securityMonitor: isJrxFeatureOn('govSecurityMon'),
      costOptimizer:   isJrxFeatureOn('govCostOpt'),
      concurrency:     isJrxFeatureOn('govConcurrency'),
      orgRatelimit:    isJrxFeatureOn('govOrgRatelimit'),
    },
  });
});

const gate = (flag: JrxFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isJrxFeatureOn(flag) ? sub(req, res, next) : next();

router.use('/maker-checker',    gate('govMakerChecker',  makerCheckerRouter));
router.use('/security-monitor', gate('govSecurityMon',   securityMonitorRouter));
router.use('/cost-optimizer',   gate('govCostOpt',       costOptimizerRouter));
router.use('/concurrency',      gate('govConcurrency',   concurrencyRouter));
router.use('/org-ratelimit',    gate('govOrgRatelimit',  orgRatelimitRouter));

export default router;
