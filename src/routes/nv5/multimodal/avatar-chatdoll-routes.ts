// /api/nv5/multimodal/avatar-chatdoll/* — ChatDollKit Avatar Service.
// NV-LLM-001 / NV-ARCH-001 + single-auth discipline: see avatar-unity-routes.
import { Router, type Request, type Response } from 'express';
import canonicalMM from '../../jrx-sdk-multimodal-voice-routes.js';
import { chatDollKitAvatarService } from '../../../packages/multimodal/chatdollkit-avatar-service.js';
import { requireSdkKey, delegateTo } from '../_auth.js';

void chatDollKitAvatarService;

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'chatdollkit-avatar-service', engine: 'chatdollkit' });
});

router.post('/session', delegateTo(canonicalMM, '/multimodal/avatar/create-session'));

export default router;
