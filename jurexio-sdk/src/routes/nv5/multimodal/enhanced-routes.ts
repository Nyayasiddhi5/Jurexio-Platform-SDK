// /api/nv5/multimodal/rag-adv/* — Advanced multimodal RAG + vision (gated by
// JRX_F_MULTIMODAL_RAG_ADV). Backed by EnhancedMultimodalService for wiring-
// audit reachability; provider-emitting paths delegate to the canonical
// /api/jrx/sdk/multimodal/* chain. Single-auth discipline (see avatar-unity).
import { Router, type Request, type Response } from 'express';
import canonicalMM from '../../jrx-sdk-multimodal-voice-routes.js';
import { getEnhancedMultimodalService } from '../../../packages/multimodal/enhanced-multimodal-service.js';
import { requireSdkKey, delegateTo } from '../_auth.js';

void getEnhancedMultimodalService;

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'enhanced-multimodal-service' });
});

router.get('/capabilities',    delegateTo(canonicalMM, '/multimodal/capabilities'));
router.post('/vision/analyze', delegateTo(canonicalMM, '/multimodal/vision/analyze'));
router.post('/rag/query',      delegateTo(canonicalMM, '/multimodal/rag/query'));

export default router;
