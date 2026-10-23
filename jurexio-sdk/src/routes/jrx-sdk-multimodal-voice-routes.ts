import { Router, Request, Response } from 'express';
import { sdkGatewayAuth } from '../middleware/sdk-gateway.js';
import { tenantIsolation } from '../middleware/jrx-tenant-isolation.js';
import { guardrailEnforcementMiddleware, responseGuardrailMiddleware } from '../middleware/guardrails-enforcement.js';
import { sdkMultimodalVoiceService } from '../services/sdk/sdk-multimodal-voice-service.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
// task-357: BIPA §15(b) gate for voice-print capture by IL residents.
import { bipaConsentGate } from '../middleware/jrx-bipa-consent-gate.js';
import { nvAiCreditCap } from '../middleware/jrx-ai-credit-cap-middleware.js';

function checkScope(scopes: string[], required: string): boolean {
  if (scopes.includes('*') || scopes.includes('all')) return true;
  return scopes.includes(required);
}

function buildCtx(req: Request): any {
  const ctx = req.sdkContext!;
  return {
    applicationId: ctx.applicationId,
    organizationId: ctx.organizationId,
    apiKeyId: ctx.apiKeyId,
    appName: ctx.appName,
    jurisdiction: ctx.jurisdiction,
    requestId: `req_${Date.now()}_${crypto.randomUUID().substring(0, 8)}`,
  };
}

const router = Router();

router.use(sdkGatewayAuth);
router.use(tenantIsolation);
router.use(guardrailEnforcementMiddleware);
router.use(responseGuardrailMiddleware);

// Task #217: DPDPA pre-flight on multimodal/voice SDK paths.
// `/voice/transcribe` and `/voice/stream/*` send raw audio of an
// identifiable speaker — under DPDPA §9 voice prints are special-
// category biometric data, so those paths gate on
// `purpose: 'biometric'`. The remaining multimodal paths process
// personal/legal data (vision/3D/avatar/RAG) and gate on
// `ai_processing`. Mounting per-handler so we can pick the right
// purpose per route.
const consentBiometric = consentGate({ purpose: 'biometric', triggeredBy: 'sdk-multimodal-voice:biometric' });
const consentAi = consentGate({ purpose: 'ai_processing', triggeredBy: 'sdk-multimodal-voice:ai' });
// task-357: BIPA §15(b) — block voice-print capture by IL residents
// without a written-consent record on file.
const bipaVoice = bipaConsentGate({ biometricType: 'voiceprint', triggeredBy: 'sdk-multimodal-voice:voice' });
// Vision/face capture for IL residents requires §15(b) facial-geometry consent.
const bipaFace = bipaConsentGate({ biometricType: 'facial_geometry', triggeredBy: 'sdk-multimodal-voice:vision' });

/* NV-CREDIT-COST-DIM-001 — the non-token paid surfaces in this router.
 *
 * STT bills per audio SECOND and TTS per CHARACTER; neither consumes a chat token,
 * so `ai_credit_usage.tokens_used` — the number the daily token budget compares
 * against — is structurally the wrong unit for them. These caps meter integer
 * micro-USD instead. All start in OBSERVE mode (NV-CREDIT-OBSERVE-001): they log
 * the would-be refusal with the full arithmetic and admit the request.
 *
 * Applied per-route, not via `router.use`: `/multimodal/capabilities` is a free
 * feature-detect read and `/voice/stream/{start,stop}` only mint and close a session
 * descriptor, so capping them would refuse work that costs nothing.
 *
 * `/voice/transcribe` and `/voice/stt` share `handleVoiceTranscribe`, so each mount
 * carries the cap separately — a handler is not capped by being referenced. */
const sttCostCap = nvAiCreditCap({ agentKey: 'sdk:voice/transcribe', costDriver: 'stt_audio_seconds' });
const ttsCostCap = nvAiCreditCap({ agentKey: 'sdk:voice/synthesize', costDriver: 'tts_characters' });
const voiceoverCostCap = nvAiCreditCap({ agentKey: 'sdk:voice/voiceover', costDriver: 'tts_characters' });
/* Vision goes through the safety ring here (executeWithFullSafetyRing → orchestrateLLM)
 * so it IS token-metered and its tokens land in the accumulator. It is nonetheless
 * listed in the aux inventory because a caller pays per image; metered on tokens,
 * which is the honest unit for THIS implementation. */
const visionTokenCap = nvAiCreditCap({ agentKey: 'sdk:multimodal/vision', completionAllowance: 4_096 });

router.post('/multimodal/vision/analyze', consentAi, bipaFace, visionTokenCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'multimodal:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: multimodal:read' });
    return;
  }
  const { imageUrl, imageBase64, analysisType, jurisdiction } = req.body;
  if (!analysisType || typeof analysisType !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: analysisType' });
    return;
  }
  if (!jurisdiction || typeof jurisdiction !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: jurisdiction' });
    return;
  }
  if (!imageUrl && !imageBase64) {
    res.status(400).json({ success: false, error: 'Missing required field: imageUrl or imageBase64' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.analyzeVision(imageUrl, imageBase64, analysisType, jurisdiction, buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to analyze image' });
  }
});

router.post('/multimodal/video/generate-script', consentAi, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'multimodal:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: multimodal:write' });
    return;
  }
  const { topic, jurisdiction, audience, duration, language } = req.body;
  if (!topic || typeof topic !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: topic' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.generateVideoScript(
      topic, jurisdiction || ctx.jurisdiction || 'IN', audience || 'general', duration || 120, language || 'en', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate video script' });
  }
});

router.post('/multimodal/3d/generate', consentAi, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'multimodal:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: multimodal:write' });
    return;
  }
  const { visualizationType, data, format } = req.body;
  if (!visualizationType || typeof visualizationType !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: visualizationType' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.generate3D(visualizationType, data, format, buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate 3D visualization' });
  }
});

router.post('/multimodal/avatar/create-session', consentAi, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'multimodal:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: multimodal:write' });
    return;
  }
  const { avatarType, language, jurisdiction } = req.body;
  try {
    const result = await sdkMultimodalVoiceService.createAvatarSession(
      avatarType || 'professional', language || 'en', jurisdiction || ctx.jurisdiction || 'IN', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to create avatar session' });
  }
});

router.post('/multimodal/rag/query', consentAi, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'multimodal:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: multimodal:read' });
    return;
  }
  const { query, modalities, jurisdiction, topK } = req.body;
  if (!query || typeof query !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: query' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.queryMultimodalRAG(
      query, modalities || ['text'], jurisdiction || ctx.jurisdiction || 'IN', topK || 5, buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to query RAG' });
  }
});

// JRX-AUDIT-F8 (2026-05-05): /multimodal/capabilities is a META endpoint that
// returns "what is supported" — no PII, no LLM call, no usage cost. It must be
// reachable by any authenticated SDK key so platforms can feature-detect at
// runtime, mirroring /gateway/translate/languages (also unscoped). Previously
// gated on `multimodal:read` which only NSI/NSM/JRX have (via `*` wildcard) —
// NSP/NSPM/NSA/NYM 403'd. Per-feature scope checks remain on actual voice/image
// invocation handlers below (/voice/synthesize, /voice/transcribe, etc.).
router.get('/multimodal/capabilities', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = sdkMultimodalVoiceService.getCapabilities();
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to fetch capabilities' });
  }
});

router.post('/voice/synthesize', consentAi, ttsCostCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'voice:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: voice:write' });
    return;
  }
  const { text, language, voiceId, speed, format } = req.body;
  if (!text || typeof text !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: text' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.synthesizeSpeech(
      text, language || 'en', voiceId, speed || 1.0, format || 'mp3', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to synthesize speech' });
  }
});

async function handleVoiceTranscribe(req: Request, res: Response): Promise<void> {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'voice:read')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: voice:read' });
    return;
  }
  const body = req.body || {};
  const audioUrl = body.audioUrl;
  const audioBase64 = body.audioBase64 || body.audio || body.content;
  const language = body.language || 'en';
  if (!audioUrl && !audioBase64) {
    // NSP Pro expects AUDIO_REQUIRED (400) — never 503 for empty mic body.
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
      audioUrl, audioBase64, language, buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to transcribe audio';
    const status = /required|decodable|invalid|empty/i.test(message) ? 400 : 422;
    res.status(status).json({
      success: false,
      error: message,
      code: status === 400 ? 'AUDIO_INVALID' : 'STT_PROVIDER_ERROR',
      retryable: status !== 400,
    });
  }
}

router.post('/voice/transcribe', consentBiometric, bipaVoice, sttCostCap, handleVoiceTranscribe);
/** NSP / playground alias */
router.post('/voice/stt', consentBiometric, bipaVoice, sttCostCap, handleVoiceTranscribe);

router.post('/voice/stream/start', consentBiometric, bipaVoice, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'voice:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: voice:write' });
    return;
  }
  const { language, mode, jurisdiction } = req.body;
  try {
    const result = await sdkMultimodalVoiceService.startVoiceStream(
      language || 'en', mode || 'dictation', jurisdiction || ctx.jurisdiction || 'IN', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to start voice stream' });
  }
});

router.post('/voice/stream/stop', consentBiometric, bipaVoice, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'voice:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: voice:write' });
    return;
  }
  const { sessionId } = req.body;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: sessionId' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.stopVoiceStream(sessionId, buildCtx(req));
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to stop voice stream' });
  }
});

router.post('/voice/voiceover/generate', consentBiometric, bipaVoice, voiceoverCostCap, async (req: Request, res: Response): Promise<void> => {
  const ctx = req.sdkContext!;
  if (!checkScope(ctx.scopes, 'voice:write')) {
    res.status(403).json({ success: false, error: 'Insufficient scope. Required: voice:write' });
    return;
  }
  const { script, language, voiceProfile, outputFormat } = req.body;
  if (!script || typeof script !== 'string') {
    res.status(400).json({ success: false, error: 'Missing required field: script' });
    return;
  }
  try {
    const result = await sdkMultimodalVoiceService.generateVoiceover(
      script, language || 'en', voiceProfile || 'professional', outputFormat || 'mp3', buildCtx(req)
    );
    res.json({ success: true, data: result });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error?.message || 'Failed to generate voiceover' });
  }
});

export default router;
