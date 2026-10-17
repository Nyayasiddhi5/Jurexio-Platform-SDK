// /api/nv5/multimodal/3d-immersive/* — Advanced 3D Immersive API.
// NV-LLM-001 / NV-ARCH-001 + single-auth discipline: see avatar-unity-routes.
import { Router, type Request, type Response } from 'express';
import canonicalMM from '../../jrx-sdk-multimodal-voice-routes.js';
import Advanced3DImmersiveService from '../../../packages/multimodal/advanced-3d-immersive-api.js';
import { requireSdkKey, delegateTo } from '../_auth.js';

void Advanced3DImmersiveService;

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'advanced-3d-immersive-api' });
});

router.post('/generate', delegateTo(canonicalMM, '/multimodal/3d/generate'));

export default router;
