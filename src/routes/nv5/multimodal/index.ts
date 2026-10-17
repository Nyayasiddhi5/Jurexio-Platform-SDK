// /api/nv5/multimodal/* — barrel router for Batch B multimodal sub-routers.
//
// Each sub-mount is independently flag-gated (default OFF). With all
// flags off this barrel responds 404 for every sub-path — preserving
// zero behaviour change on no-env deploys.
//
// Flag check is per-request (not at module-import time) because ESM
// hoists imports above `dotenv.config()` in src/index.ts, so .env-loaded
// flags would otherwise be read as undefined at boot.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isNyvFeatureOn, type NyvFeatureFlag } from '../../../config/jrx-feature-flags.js';
import avatarUnityRouter   from './avatar-unity-routes.js';
import avatarChatdollRouter from './avatar-chatdoll-routes.js';
import ragAdvRouter        from './enhanced-routes.js';
import threeDImmersiveRouter from './3d-immersive-routes.js';
import avatar3dRouter      from './avatar-3d-routes.js';

const router = Router();

// Always-on liveness probe for console health-map polling. Returns the
// flag-on status of every sub-mount so the UI can render a per-feature dot.
// Added 2026-05-11 (Phase 1 audit-action item) — additive, NV-LLM-001 inert.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'multimodal',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: {
      avatarUnity:    isNyvFeatureOn('multimodalAvatarUnity'),
      avatarChatdoll: isNyvFeatureOn('multimodalAvatarChatdoll'),
      ragAdv:         isNyvFeatureOn('multimodalRagAdv'),
      threeDImmersive:isNyvFeatureOn('multimodal3dImmersive'),
      avatar3d:       isNyvFeatureOn('multimodalAvatar3d'),
    },
  });
});

const gate = (flag: NyvFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isNyvFeatureOn(flag) ? sub(req, res, next) : next();

router.use('/avatar-unity',    gate('multimodalAvatarUnity',    avatarUnityRouter));
router.use('/avatar-chatdoll', gate('multimodalAvatarChatdoll', avatarChatdollRouter));
router.use('/rag-adv',         gate('multimodalRagAdv',         ragAdvRouter));
router.use('/3d-immersive',    gate('multimodal3dImmersive',    threeDImmersiveRouter));
router.use('/avatar-3d',       gate('multimodalAvatar3d',       avatar3dRouter));

export default router;
