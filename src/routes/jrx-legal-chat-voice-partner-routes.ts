/**
 * NV-LEGAL-CHAT-VOICE-PARTNER-001 — NSP Pro mic path.
 * Mounted at /api/jrx/legal-chat/voice BEFORE JWT legal-chat router so SDK keys work.
 * Canonical body: audioUrl | audioBase64 (aliases: audio, content).
 */
import { Router, type Request, type Response } from 'express';
import { dualSdkOrJwt } from '../middleware/jrx-dual-auth.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
import { bipaConsentGate } from '../middleware/jrx-bipa-consent-gate.js';
import { sdkMultimodalVoiceService } from '../services/sdk/sdk-multimodal-voice-service.js';

const router = Router();
router.use(dualSdkOrJwt);

const consentBiometric = consentGate({
  purpose: 'biometric',
  triggeredBy: 'legal-chat-voice:transcribe',
});
const bipaVoice = bipaConsentGate({
  biometricType: 'voiceprint',
  triggeredBy: 'legal-chat-voice:transcribe',
});

function buildCtx(req: Request): Record<string, unknown> {
  const ctx = req.sdkContext;
  return {
    applicationId: ctx?.applicationId ?? 0,
    organizationId: ctx?.organizationId ?? 0,
    apiKeyId: ctx?.apiKeyId ?? 0,
    appName: ctx?.appName ?? 'legal-chat-voice',
    jurisdiction: ctx?.jurisdiction ?? 'IN',
    requestId: `req_${Date.now()}`,
  };
}

async function handleTranscribe(req: Request, res: Response): Promise<void> {
  const body = req.body || {};
  const audioUrl = body.audioUrl;
  const audioBase64 = body.audioBase64 || body.audio || body.content;
  const language = body.language || 'hi';
  if (!audioUrl && !audioBase64) {
    res.status(400).json({
      success: false,
      error: 'Missing required field: audioUrl or audioBase64',
      code: 'AUDIO_REQUIRED',
      retryable: false,
    });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.transcribeSpeech(
      audioUrl,
      audioBase64,
      language,
      buildCtx(req),
    );
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to transcribe audio';
    // Invalid audio → 400; provider outage → 422 (not 503) so NSP smoke can distinguish.
    const status = /required|decodable|invalid|empty/i.test(message) ? 400 : 422;
    res.status(status).json({
      success: false,
      error: message,
      code: status === 400 ? 'AUDIO_INVALID' : 'STT_PROVIDER_ERROR',
      retryable: status !== 400,
    });
  }
}

router.post('/transcribe', consentBiometric, bipaVoice, handleTranscribe);
router.post('/stt', consentBiometric, bipaVoice, handleTranscribe);

export default router;
