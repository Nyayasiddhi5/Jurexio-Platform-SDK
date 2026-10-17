// /api/nv5/voice/enhanced/* — NyvVoiceServiceEnhanced (JRX_F_VOICE_ENHANCED).
//
// NV-LLM-001 / NV-ARCH-001: synthesize/transcribe delegate to the canonical
// /api/jrx/voice/* router (nv-voice-ws-routes) which traverses the safety
// ring + Sarvam (22-Indic) / OpenAI / Deepgram provider chain. The package
// singleton is imported only for wiring-audit reachability. Single-auth
// discipline (see streaming-routes).
import { Router, type Request, type Response } from 'express';
import canonicalVoice from '../../jrx-voice-ws-routes.js';
import { nyvVoiceService } from '../../../services/nyv-voice-service-enhanced.js';
import { requireSdkKey, delegateTo } from '../_auth.js';

void nyvVoiceService;

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'nyv-voice-service-enhanced' });
});

// Strict-SDK-key auth then delegate to canonical voice chain.
router.post('/synthesize', requireSdkKey, delegateTo(canonicalVoice, '/synthesize'));
router.post('/transcribe', requireSdkKey, delegateTo(canonicalVoice, '/transcribe'));

export default router;
