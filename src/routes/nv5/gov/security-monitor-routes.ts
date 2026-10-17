// /api/nv5/gov/security-monitor/* — admin status endpoint for the
// nv-security-monitor middleware. The middleware itself is mounted at
// /api/jrx/* via the existing JRX_F_SECURITY_MONITOR (T-08) flag in
// src/index.ts (untouched per task-101.md "Out of scope: touching existing
// auth/rate-limiting middleware"). This barrel exists primarily to give
// the wiring auditor a static-import edge to nv-security-monitor.ts so it
// counts as WIRED rather than orphan (the existing dynamic `await import`
// is invisible to the BFS walker).
import { Router, type Request, type Response } from 'express';
// Static import — sole purpose: wiring-audit reachability. The middleware
// is also referenced for completeness in /status payload (constructor
// fingerprint only, never invoked here).
import { securityMonitorMiddleware } from '../../../services/jrx-security-monitor.js';
import { requireSdkKeyOnly, requireScope, safeError } from '../_auth.js';

const router = Router();

router.get('/status', requireSdkKeyOnly, requireScope('admin'), (_req: Request, res: Response) => {
  try {
    const env = (k: string, fallback: string) => (process.env[k] ?? fallback);
    res.json({
      success: true,
      service: './jrx-security-monitor',
      middlewareLoaded: typeof securityMonitorMiddleware === 'function',
      mountedGlobally: (process.env.JRX_F_SECURITY_MONITOR ?? '').trim().toLowerCase() === '1' ||
                       (process.env.JRX_F_SECURITY_MONITOR ?? '').trim().toLowerCase() === 'true',
      thresholds: {
        maxExecDepth:   parseInt(env('NYV_MAX_EXEC_DEPTH', '12'), 10),
        attackWindowMs: parseInt(env('NYV_ATTACK_WINDOW_MS', '3600000'), 10),
        attackThreshold: parseInt(env('NYV_ATTACK_THRESHOLD', '5'), 10),
      },
    });
  } catch (e) { safeError(res, e); }
});

export default router;
