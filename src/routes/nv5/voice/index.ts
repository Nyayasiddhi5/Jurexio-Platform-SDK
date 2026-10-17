// /api/nv5/voice/* — barrel router for Batch B voice sub-routers.
//
// Each sub-mount is independently flag-gated (default OFF). With all
// flags off this barrel responds 404 for every sub-path. Provider-emitting
// voice paths (STT/TTS) delegate to the canonical /api/jrx/voice/* +
// /api/jrx/sdk/multimodal/* pipelines per NV-ARCH-001.
import { Router, type Request, type Response, type NextFunction } from 'express';
import { isJrxFeatureOn, type JrxFeatureFlag } from '../../../config/jrx-feature-flags.js';
import streamingRouter from './streaming-routes.js';
import synthesisRouter from './synthesis-routes.js';
import enhancedRouter  from './enhanced-routes.js';

const router = Router();

// Always-on liveness probe for console health-map polling.
// Added 2026-05-11 (Phase 1 audit-action item) — additive, NV-LLM-001 inert.
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    namespace: 'voice',
    version: 'v5.0.1',
    uptimeSec: Math.floor(process.uptime()),
    flags: {
      streamRt:  isJrxFeatureOn('voiceStreamRt'),
      synth:     isJrxFeatureOn('voiceSynth'),
      enhanced:  isJrxFeatureOn('voiceEnhanced'),
    },
    note: 'Provider-emitting voice paths live at /api/jrx/voice/* + /api/jrx/sdk/multimodal/* (canonical NV-ARCH-001 pipeline).',
  });
});

const gate = (flag: JrxFeatureFlag, sub: Router) =>
  (req: Request, res: Response, next: NextFunction) =>
    isJrxFeatureOn(flag) ? sub(req, res, next) : next();

router.use('/streaming', gate('voiceStreamRt', streamingRouter));
router.use('/synthesis', gate('voiceSynth',    synthesisRouter));
router.use('/enhanced',  gate('voiceEnhanced', enhancedRouter));

export default router;
