// /api/nv5/multimodal/avatar-3d/* — Avatar 3D System.
// NV-LLM-001 / NV-ARCH-001 + single-auth discipline: see avatar-unity-routes.
import { Router, type Request, type Response } from 'express';
import canonicalMM from '../../jrx-sdk-multimodal-voice-routes.js';
import Avatar3DSystem from '../../../packages/multimodal/avatar-3d-system.js';
import { requireSdkKey, delegateTo } from '../_auth.js';

void Avatar3DSystem;

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'avatar-3d-system' });
});

router.post('/session',     delegateTo(canonicalMM, '/multimodal/avatar/create-session'));
router.post('/3d/generate', delegateTo(canonicalMM, '/multimodal/3d/generate'));

export default router;
