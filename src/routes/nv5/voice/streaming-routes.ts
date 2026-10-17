// /api/nv5/voice/streaming/* — Realtime Voice Streaming Service
// (JRX_F_VOICE_STREAM_RT).
//
// Local read-only metrics + provider selection from the package singleton.
// Stream start/stop delegate to the canonical /api/jrx/sdk/multimodal/*
// chain so STT provider emission goes through the safety ring.
//
// Single-auth discipline: requireSdkKey applied per-handler ONLY to local
// routes; delegated routes rely on canonical sdkGatewayAuth so rate-limit
// counters increment exactly once.
import { Router, type Request, type Response } from 'express';
import canonicalMM from '../../jrx-sdk-multimodal-voice-routes.js';
import {
  realtimeVoiceService,
  generateCostReport,
} from '../../../packages/voice/realtime-voice-streaming.js';
import { requireSdkKey, safeError, delegateTo } from '../_auth.js';

const router = Router();

router.get('/health', requireSdkKey, (_req: Request, res: Response) => {
  res.json({ success: true, service: 'realtime-voice-streaming' });
});

router.get('/metrics', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const metrics = realtimeVoiceService.getAllMetrics();
    res.json({ success: true, metrics, count: metrics.length });
  } catch (e) { safeError(res, e); }
});

router.get('/cost-report', requireSdkKey, (_req: Request, res: Response) => {
  try {
    const report = generateCostReport();
    res.json({ success: true, report });
  } catch (e) { safeError(res, e); }
});

router.get('/provider/:type/:costMode', requireSdkKey, (req: Request, res: Response) => {
  try {
    const { type, costMode } = req.params;
    if (type !== 'stt' && type !== 'tts') return safeError(res, 'type must be stt|tts', 400);
    if (costMode !== 'economy' && costMode !== 'balanced' && costMode !== 'premium') {
      return safeError(res, 'costMode must be economy|balanced|premium', 400);
    }
    const provider = realtimeVoiceService.selectProvider(type, costMode);
    res.json({ success: true, type, costMode, provider });
  } catch (e) { safeError(res, e); }
});

// Stream lifecycle delegates to canonical chain (canonical runs its own auth).
router.post('/start', delegateTo(canonicalMM, '/voice/stream/start'));
router.post('/stop',  delegateTo(canonicalMM, '/voice/stream/stop'));

export default router;
