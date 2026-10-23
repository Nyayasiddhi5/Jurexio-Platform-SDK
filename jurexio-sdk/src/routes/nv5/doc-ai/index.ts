// /api/nv5/doc-ai/* — barrel router for Batch C document-AI sub-routers.
// Convert sub-router is flag-gated (default OFF). Doc-AI is conversion-only;
// NV-LLM-001 does not apply because the converter is pure (no LLM/provider).
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isJrxFeatureOn, type JrxFeatureFlag } from '../../../config/jrx-feature-flags.js';
import convertRouter from './convert-routes.js';

const router = Router();

// Always-on liveness probe (Phase 1 audit fix 2026-05-11). Additive.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'doc-ai',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: { convert: isJrxFeatureOn('docAiConvert') },
  });
});

const gate = (flag: JrxFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isJrxFeatureOn(flag) ? sub(req, res, next) : next();

router.use('/convert', gate('docAiConvert', convertRouter));

export default router;
