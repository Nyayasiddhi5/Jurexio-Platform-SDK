// /api/nv5/voice/synthesis/* — Voice Synthesis Engine (JRX_F_VOICE_SYNTH).
//
// Local read-only voice catalogue from the package singleton. The actual
// TTS call delegates to the canonical /api/jrx/voice/* router
// (nv-voice-ws-routes) which traverses the safety ring + Sarvam/Deepgram
// provider chain. Single-auth discipline (see streaming-routes).
import { Router, type Request, type Response } from 'express';
import canonicalVoice from '../../jrx-voice-ws-routes.js';
import VoiceSynthesisEngine from '../../../packages/voice/voice-synthesis-engine.js';
import { requireSdkKey, safeError, delegateTo } from '../_auth.js';

let _engine: VoiceSynthesisEngine | null = null;
function getEngine(): VoiceSynthesisEngine {
  if (!_engine) _engine = new VoiceSynthesisEngine();
  return _engine;
}

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'voice-synthesis-engine', instantiated: _engine !== null });
});

router.get('/voices', requireSdkKey, (req: Request, res: Response) => {
  try {
    const providerId = typeof req.query.providerId === 'string' ? req.query.providerId : undefined;
    const voices = getEngine().getAvailableVoices(providerId);
    res.json({ success: true, voices, count: voices.length });
  } catch (e) { safeError(res, e); }
});

router.get('/provider/:id', requireSdkKey, (req: Request, res: Response) => {
  try {
    const provider = getEngine().getProvider(String(req.params.id));
    if (!provider) return safeError(res, `provider not found: ${req.params.id}`, 404);
    res.json({ success: true, provider });
  } catch (e) { safeError(res, e); }
});

// Functional TTS — strict-SDK-key auth then delegates to canonical
// /api/jrx/voice/synthesize. requireSdkKey upstream prevents the canonical
// JWT-bypass path from accepting session tokens on the nv5 surface.
router.post('/synthesize', requireSdkKey, delegateTo(canonicalVoice, '/synthesize'));

export default router;
