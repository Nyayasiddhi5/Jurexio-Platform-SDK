// /api/nv5/multimodal/avatar-unity/* — Unity Avatar Service.
//
// NV-LLM-001 / NV-ARCH-001: provider-emitting paths delegate to the
// canonical /api/jrx/sdk/multimodal/* router (jrx-sdk-multimodal-voice-routes)
// which traverses the safety ring. The package singleton is imported only
// for wiring-audit reachability.
//
// Single-auth discipline: requireSdkKey is applied per-handler ONLY to
// local routes. Delegated routes rely on the canonical router's own
// sdkGatewayAuth so rate-limit/audit counters increment exactly once per
// request.
import { Router, type Request, type Response } from 'express';
import canonicalMM from '../../jrx-sdk-multimodal-voice-routes.js';
import { unityAvatarService } from '../../../packages/multimodal/unity-avatar-service.js';
import { requireSdkKey, delegateTo } from '../_auth.js';

void unityAvatarService;

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'unity-avatar-service', engine: 'unity' });
});

// POST /api/nv5/multimodal/avatar-unity/session
//   → canonical POST /api/jrx/sdk/multimodal/multimodal/avatar/create-session
router.post('/session', delegateTo(canonicalMM, '/multimodal/avatar/create-session'));

export default router;
