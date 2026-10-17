// /api/nv5/orch/context/* — Context Engineering Service wiring.
//
// Session-10 Batch A. Only /health is exposed for now: the previous
// /enhance endpoint was dropped because `enhancePrompt` may chain into
// LLM calls, which would violate NV-LLM-001's no-bypass-of-the-canonical-
// orchestrator rule for additive nv5 surfaces. Wiring of the full
// safety-ring path is queued as a follow-up alongside the deferred
// /facade route.
import { Router, type Request, type Response } from 'express';
import { contextEngineeringService } from '../services/context-engineering-service.js';
import { requireSdkKey } from './_nv5-orch-auth.js';

void contextEngineeringService;

const router = Router();
router.use(requireSdkKey);

router.get('/health', (_req: Request, res: Response) => {
  res.json({ success: true, service: 'context-engineering-service' });
});

export default router;
