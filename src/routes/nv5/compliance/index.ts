// /api/nv5/compliance/* — barrel router for Session-11 Batch F (compliance
// + crypto). Wires 3 previously-orphan services:
//   - nv-eu-ai-act-service       → /eu-ai-act          (Article 9–15 docs)
//   - nv-pqc-service             → /pqc                (PQC keygen + caps)
//   - nv-federated-privacy-service → /federated-privacy (session listing + DP noise)
//
// All sub-routers admin-scoped, default-OFF flag-gated. With all 3 flags
// OFF the entire namespace returns 404. NV-LLM-001 / NV-ARCH-001: no
// LLM-emitting endpoints. EU-AI-Act doc generation is pure data lookup;
// PQC operations are deterministic crypto; federated-privacy session
// lifecycle mutations stay in code-path use only.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isNyvFeatureOn, type NyvFeatureFlag } from '../../../config/jrx-feature-flags.js';
import euAiActRouter from './eu-ai-act-routes.js';
import pqcRouter from './pqc-routes.js';
import federatedPrivacyRouter from './federated-privacy-routes.js';

const router = Router();

// Always-on liveness probe (Phase 1 audit fix 2026-05-11). Additive.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'compliance',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: {
      euAiAct:          isNyvFeatureOn('complianceEuAiAct'),
      pqc:              isNyvFeatureOn('compliancePqc'),
      federatedPrivacy: isNyvFeatureOn('complianceFederatedPrivacy'),
    },
  });
});

const gate = (flag: NyvFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isNyvFeatureOn(flag) ? sub(req, res, next) : next();

router.use('/eu-ai-act',          gate('complianceEuAiAct',          euAiActRouter));
router.use('/pqc',                gate('compliancePqc',              pqcRouter));
router.use('/federated-privacy',  gate('complianceFederatedPrivacy', federatedPrivacyRouter));

export default router;
