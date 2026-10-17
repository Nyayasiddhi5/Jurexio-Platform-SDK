/**
 * WebSocket Speech-to-Text (STT) Route — Jurexio Enterprise Platform 3.1.2
 * Real-time voice transcription for legal dictation.
 *
 * Protocol:
 *   1. Client connects to WS /api/jrx/voice/stream
 *   2. Client sends binary audio chunks (PCM 16kHz)
 *   3. Server accumulates chunks and forwards to Deepgram/Sarvam
 *   4. Server emits transcription events back to client
 *
 * Events sent to client:
 *   { type: 'transcript', text, isFinal, confidence, languageCode }
 *   { type: 'error', message }
 *   { type: 'ready', message }
 *
 * @version 3.1.2
 */
import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import { getSttService, type RealtimeStream } from '../services/jrx-stt-service.js';
import { sdkMultimodalVoiceService } from '../services/sdk/sdk-multimodal-voice-service.js';
import { sdkGatewayAuth } from '../middleware/jrx-sdk-gateway.js';
import { consentGate } from '../middleware/jrx-consent-gate.js';
// task-357: BIPA §15(b) gate for voice-print capture by IL residents.
import { bipaConsentGate } from '../middleware/jrx-bipa-consent-gate.js';
import { consentManagementService } from '../services/consent-management-service.js';
// task-357: BIPA §15(b) check for the live WS capture path (Express
// middleware can't intercept the upgrade handshake, so we gate at the
// 'start' message boundary). resolveBipaSubject is the SHARED identity
// resolver used by the HTTP middleware and the grant route, so the
// principal string we look up here is byte-identical to what a Console
// grant would write.
import { bipaConsentService } from '../services/compliance/jrx-bipa-consent-service.js';
import { resolveBipaSubject } from '../middleware/jrx-bipa-consent-gate.js';
import { sdkAppApiKeys } from '@shared/schema.js';
import { db as nvDb } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { describeGeminiModels } from '../config/jrx-gemini-models.js';
import { getLanguageProvider } from '../utils/jrx-language-provider.js';

const router = Router();
const logger = createLogger('voice-ws');

// JRX-AUDIT-F13 (2026-05-05 — architect callout): /api/jrx/voice/* exposed
// billable STT/TTS endpoints with NO auth guard. /voice/info is intentionally
// public (capability discovery), but /transcribe and /synthesize must require
// either an SDK key (sdkGatewayAuth — also handles the JWT bypass for
// internal dashboard users) or be removed. We add the gate per-handler so
// /voice/info stays open for the front-end's pre-flight feature detection.
const requireSdkOrJwt = sdkGatewayAuth;

/** GET /api/jrx/voice/info — STT endpoint info */
router.get('/info', (_req: Request, res: Response): void => {
  res.json({
    success: true,
    version: '3.1.2',
    languageProvider: getLanguageProvider(),
    geminiModels: describeGeminiModels(),
    capabilities: {
      realtime_stt: true,
      websocket_endpoint: '/api/jrx/voice/stream',
      providers: ['Gemini multimodal STT (default)', 'OpenAI Whisper (fallback)', 'Sarvam AI STT (opt-in via JRX_LANGUAGE_PROVIDER=sarvam)', 'Deepgram Nova-2'],
      languages: ['en-IN', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn', 'ml', 'pa', 'or', 'ur'],
      formats: ['PCM 16kHz 16-bit', 'WebM Opus', 'MP3'],
      maxDurationSeconds: 300,
    },
    legalDictationFeatures: {
      legalVocabulary: true,
      courtTermsBoost: true,
      statuteNamesBoost: true,
      punctuationEnabled: true,
      speakerDiarization: true,
      smartFormatting: true,
    },
    status: 'operational',
    websocketUpgrade: 'Handled by HTTP upgrade mechanism — see GET /api/jrx/voice/ws-upgrade',
  });
});

/**
 * GET /api/jrx/voice/ws-upgrade — WebSocket connection endpoint
 * This route is upgraded to WebSocket by the server.
 * Handler is registered directly in index.ts via server.on('upgrade', ...)
 */
router.get('/ws-upgrade', (_req: Request, res: Response): void => {
  res.json({
    error: 'This endpoint requires WebSocket upgrade (ws:// or wss://)',
    hint: 'Connect with a WebSocket client to this URL',
    protocol: 'jrx-stt-v1',
  });
});

/**
 * POST /api/jrx/voice/synthesize — Text-to-speech synthesis (non-streaming)
 * Body: { text, language?, voiceId?, speed?, format? }
 * Used by @jurexio/client-sdk VoiceApi.synthesize().
 */
router.post('/synthesize', requireSdkOrJwt, async (req: Request, res: Response): Promise<void> => {
  try {
    const { text, language = 'en', voiceId, speed = 1.0, format = 'mp3' } = req.body as {
      text?: string;
      language?: string;
      voiceId?: string;
      speed?: number;
      format?: string;
    };

    if (!text || typeof text !== 'string') {
      res.status(400).json({ success: false, error: 'text is required' });
      return;
    }

    logger.info('voice_synthesize_request', { language, format, voiceId, speed, len: text.length });

    const ctx = {
      apiKeyId: (req as any).user?.apiKeyId ?? null,
      orgId: (req as any).user?.orgId ?? (req as any).user?.org_id ?? null,
      userId: (req as any).user?.id ?? null,
      platform: (req as any).user?.platform ?? 'nv',
      jurisdiction: (req as any).user?.jurisdiction ?? 'IN',
      scopes: ['voice:write'],
    };

    const result = await sdkMultimodalVoiceService.synthesizeSpeech(
      text,
      language,
      voiceId,
      speed,
      format,
      ctx,
    );

    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err: err?.message }, 'voice_synthesize_failed');
    res.status(500).json({ success: false, error: err?.message || 'Failed to synthesize speech' });
  }
});

/** POST /api/jrx/voice/transcribe — Batch audio transcription (non-streaming) */
// Task #217: voice prints are DPDPA §9 biometric data — gate pre-flight.
router.post('/transcribe', requireSdkOrJwt, consentGate({ purpose: 'biometric', triggeredBy: 'voice-ws:/transcribe' }), bipaConsentGate({ biometricType: 'voiceprint', triggeredBy: 'voice-ws:/transcribe' }), async (req: Request, res: Response): Promise<void> => {
  try {
    const { audioBase64, language = 'en-IN', format = 'mp3' } = req.body as {
      audioBase64?: string;
      language?: string;
      format?: string;
    };

    if (!audioBase64) {
      res.status(400).json({ error: 'audioBase64 is required' });
      return;
    }

    logger.info('voice_transcribe_request', { language, format });

    const sttService = getSttService();
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const result = await sttService.transcribeBatch(audioBuffer, {
      language,
      encoding: format,
      legalVocabularyBoost: true,
      enablePunctuation: true,
    });

    res.json({
      success: true,
      transcription: result,
      routing: {
        selectedProvider: result.provider,
        primary: 'Gemini multimodal STT (Indic + EN) — default until Sarvam keys',
        indianLanguages: 'Gemini (default) · Sarvam when JRX_LANGUAGE_PROVIDER=sarvam',
        englishLegal: 'Gemini / Deepgram Nova-2 / Whisper',
        fallback: 'OpenAI Whisper-1',
      },
      providers: sttService.getAvailableProviders(),
    });
  } catch (err: any) {
    logger.error('voice_transcribe_error', { err: err.message });
    res.status(500).json({ error: 'Transcription failed' });
  }
});

/**
 * setupVoiceWebSocket — Attach WebSocket upgrade handler to HTTP server.
 * Called from index.ts with the HTTP server instance.
 */
export function setupVoiceWebSocket(server: any): void {
  const WS_PATH = '/api/jrx/voice/stream';
  server.on('upgrade', (request: any, socket: any, head: any) => {
    if (request.url !== WS_PATH) return;
    // Dynamically load ws to avoid hard dependency at module load time
    import('ws').then(({ WebSocketServer }) => {
      const wss = new WebSocketServer({ noServer: true });
      wss.handleUpgrade(request, socket, head, (ws: any) => {
        handleVoiceWebSocket(ws, request);
      });
    }).catch((err: Error) => {
      logger.warn('voice_ws_ws_unavailable', { err: err.message });
      socket.destroy();
    });
  });
  logger.info('voice_ws_setup', { path: WS_PATH });
}

export function handleVoiceWebSocket(ws: any, req: any): void {
  const clientId = crypto.randomUUID();
  logger.info('voice_ws_connected', { clientId });

  const sttService = getSttService();
  let realtimeStream: RealtimeStream | null = null;
  let isStreaming = false;
  let audioBuffer: Buffer[] = [];

  ws.send(JSON.stringify({
    type: 'ready',
    message: 'JRX Voice STT WebSocket connected',
    clientId,
    version: '3.1.2',
    liveProviders: sttService.getAvailableProviders(),
    supportedLanguages: sttService.getSupportedLanguages().map(l => l.code),
  }));

  ws.on('message', async (data: Buffer | string) => {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'start') {
          // Task #217: DPDPA §9 biometric pre-flight on the live
          // STT WebSocket. Express middleware can't intercept the
          // 'upgrade' handshake reliably, so we gate at the
          // semantic boundary (when the client actually asks us to
          // begin streaming audio). Identity is best-effort from
          // the upgrade headers (X-API-Key / Authorization) — when
          // absent we still emit a CAM breach row attributed to
          // the connection's clientId so the reviewer queue gets a
          // production signal. Observation by default; in enforce
          // mode (NV_DPDPA_CONSENT_ENFORCE=1) we refuse to start.
          const enforceWs = process.env.NV_DPDPA_CONSENT_ENFORCE === '1' ||
            process.env.NV_DPDPA_CONSENT_ENFORCE === 'true';
          const apiKeyHdr = (req?.headers?.['x-api-key'] as string | undefined) ||
            ((req?.headers?.authorization as string | undefined)?.replace(/^Bearer\s+/i, ''));
          const principal = apiKeyHdr ? `sdk:key:${apiKeyHdr.slice(0, 12)}` : `voice-ws:${clientId}`;
          try {
            const consentResult = await consentManagementService.checkConsent(
              principal,
              'biometric',
              {
                jurisdiction: msg.jurisdiction || 'IN',
                attemptedUse: true,
                requestId: clientId,
                triggeredBy: 'voice-ws:/voice/stream',
              },
            );
            if (!consentResult.granted && enforceWs) {
              ws.send(JSON.stringify({
                type: 'error',
                code: 'DPDPA_CONSENT_BREACH',
                message: 'Biometric (voice) consent required',
                purpose: 'biometric',
                status: consentResult.status,
              }));
              try { ws.close(1008, 'consent_required'); } catch { /* noop */ }
              return;
            }
          } catch (consentErr: any) {
            logger.warn('voice_ws_consent_check_failed', { clientId, err: consentErr?.message });
          }

          // task-357: BIPA §15(b) gate on the live WS capture path.
          //
          // Identity must match the HTTP gate byte-for-byte: a record
          // granted via Console under user.id=42 (or an SDK call's
          // sdk:app:<applicationId>) MUST be the same lookup key here
          // — otherwise valid consent appears as "missing" and the
          // socket gets blocked. We:
          //   1. Resolve the API key (if any) to applicationId via the
          //      same SHA-256 keyHash lookup the SDK gateway uses, so
          //      we can build a real `sdkContext.applicationId`.
          //   2. Pass a synthetic Express-like request to the SHARED
          //      resolveBipaSubject() — same precedence chain as the
          //      HTTP middleware (user > sdkContext.userId > X-Nv-User-Id
          //      > sdk:app:<id> > sdk:org:<id> > sdk:key:<id>).
          //
          // Scope rule mirrors the middleware: enforce when IL is
          // declared, the principal already has a BIPA record on file
          // (sticky-IL), or NV_BIPA_CONSENT_ENFORCE_ALL=1.
          try {
            const apiKeyRaw = (req?.headers?.['x-api-key'] as string | undefined)
              ?? ((req?.headers?.authorization as string | undefined)?.replace(/^Bearer\s+/i, ''));
            let sdkContext: any = undefined;
            if (apiKeyRaw && nvDb) {
              try {
                const keyHash = crypto.createHash('sha256').update(apiKeyRaw).digest('hex');
                const rows = await nvDb
                  .select()
                  .from(sdkAppApiKeys)
                  .where(eq(sdkAppApiKeys.keyHash, keyHash))
                  .limit(1);
                const rec: any = rows[0];
                if (rec) {
                  sdkContext = {
                    apiKeyId: rec.id,
                    applicationId: rec.applicationId,
                    organizationId: rec.organizationId ?? undefined,
                  };
                }
              } catch (lookupErr: any) {
                logger.warn('voice_ws_api_key_lookup_failed', { clientId, err: lookupErr?.message });
              }
            }

            // Synthetic request: only the fields resolveBipaSubject /
            // looksLikeIllinois actually read. msg.userId (when the
            // tenant pins their end-user) flows in via the synthetic
            // body — same path the HTTP gate honours.
            const syntheticReq: any = {
              user: undefined,
              sdkContext,
              headers: req?.headers ?? {},
              body: { userId: msg.userId, jurisdiction: msg.jurisdiction, usState: msg.usState, bipaApplicable: msg.bipaApplicable },
              query: {},
            };

            const subject = resolveBipaSubject(syntheticReq) ?? `voice-ws:${clientId}`;
            const usStateHdr = (req?.headers?.['x-jrx-us-state'] as string | undefined)
              ?? (req?.headers?.['x-jrx-jurisdiction'] as string | undefined);
            const jurisdictionStr = String(msg.jurisdiction ?? msg.usState ?? usStateHdr ?? '').toUpperCase();
            let illinois = jurisdictionStr === 'IL'
              || jurisdictionStr === 'US-IL'
              || jurisdictionStr === 'ILLINOIS'
              || jurisdictionStr.endsWith('/IL')
              || jurisdictionStr.endsWith('-IL')
              || Boolean(msg.bipaApplicable);
            const bipaCheck = await bipaConsentService.check(subject, 'voiceprint');
            if (bipaCheck.record) illinois = true;
            const enforceBipa = process.env.NV_BIPA_CONSENT_ENFORCE_ALL === '1'
              || process.env.NV_BIPA_CONSENT_ENFORCE_ALL === 'true'
              || illinois;
            if (enforceBipa && !bipaCheck.granted) {
              logger.warn('bipa_consent_blocked_ws', {
                clientId, subject, status: bipaCheck.status,
                triggeredBy: 'voice-ws:/voice/stream',
              });
              ws.send(JSON.stringify({
                type: 'error',
                code: 'BIPA_CONSENT_REQUIRED',
                message: 'BIPA §15(b) written informed consent required before voiceprint capture',
                biometricType: 'voiceprint',
                status: bipaCheck.status,
                policy: 'POL-US-BIPA-740-14-15',
                consent_url: '/console/bipa-consent',
                grant_endpoint: '/api/jrx/bipa/consent/grant',
              }));
              try { ws.close(1008, 'bipa_consent_required'); } catch { /* noop */ }
              return;
            }
          } catch (bipaErr: any) {
            logger.warn('voice_ws_bipa_check_failed', { clientId, err: bipaErr?.message });
          }

          isStreaming = true;
          audioBuffer = [];
          const language = msg.language || 'en-IN';

          try {
            realtimeStream = await sttService.createRealtimeStream(
              {
                language,
                enablePunctuation: msg.punctuation !== false,
                enableDiarization: msg.diarization === true,
                legalVocabularyBoost: msg.legalBoost !== false,
                interimResults: msg.interimResults !== false,
              },
              (result) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({
                    type: 'transcript',
                    text: result.text,
                    isFinal: result.isFinal,
                    confidence: result.confidence,
                    languageCode: result.languageCode,
                    provider: result.provider,
                    isSimulation: result.isSimulation,
                    words: result.words,
                    speakerId: result.speakerId,
                  }));
                }
              },
              (err) => {
                logger.error('voice_ws_stream_error', { clientId, err: err.message });
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'error', message: err.message }));
                }
              }
            );
          } catch (streamErr: any) {
            logger.error('voice_ws_stream_init_error', { clientId, err: streamErr.message });
          }

          ws.send(JSON.stringify({
            type: 'status',
            status: 'streaming',
            language,
            provider: sttService.selectProvider(language),
            isLive: sttService.isLiveAvailable(),
          }));
        } else if (msg.type === 'stop') {
          isStreaming = false;

          if (realtimeStream) {
            await realtimeStream.close();
            realtimeStream = null;
          } else if (audioBuffer.length > 0) {
            const combined = Buffer.concat(audioBuffer);
            const result = await sttService.transcribeBatch(combined, {
              language: msg.language || 'en-IN',
              legalVocabularyBoost: true,
              enablePunctuation: true,
            });
            ws.send(JSON.stringify({
              type: 'transcript',
              text: result.text,
              isFinal: true,
              confidence: result.confidence,
              languageCode: result.languageCode,
              provider: result.provider,
              isSimulation: result.isSimulation,
              words: result.words,
            }));
          }

          audioBuffer = [];
          ws.send(JSON.stringify({ type: 'status', status: 'stopped' }));
        }
      } catch { /* ignore malformed JSON */ }
    } else if (isStreaming && Buffer.isBuffer(data)) {
      if (realtimeStream && realtimeStream.isActive()) {
        realtimeStream.sendAudio(data);
      } else {
        audioBuffer.push(data);
      }
    }
  });

  ws.on('close', async () => {
    logger.info('voice_ws_disconnected', { clientId });
    if (realtimeStream) {
      await realtimeStream.close();
      realtimeStream = null;
    }
    audioBuffer = [];
  });

  ws.on('error', (err: Error) => {
    logger.error('voice_ws_error', { clientId, err: err.message });
  });
}

export default router;
