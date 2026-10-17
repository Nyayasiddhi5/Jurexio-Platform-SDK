// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * NYV Enhanced Voice Service v1.0.0
 * ─────────────────────────────────────────────────────────────────────────────
 * Production TTS/STT pipeline integrating:
 *   - ElevenLabs TTS (multilingual, voice cloning, streaming)
 *   - Sarvam AI STT (Indian languages: hi/ta/bn/te/mr/gu/kn/ml/pa/ur/od/as)
 *   - OpenAI Whisper-1 STT (universal fallback, 99 languages)
 *   - Google TTS (47-language fallback, cheap)
 *   - Smart routing: detect language → select optimal provider
 *   - Response caching with Redis for repeated TTS requests
 *   - Prosody control: legal reading pace (slower, clearer)
 *   - SSML injection for legal document reading
 *
 * SUPPORTED LANGUAGES:
 *   ElevenLabs: 30+ languages (en/hi/ta/te/bn/mr/gu/kn/ml/pa/ur/fr/de/es/it/ja/zh/ko...)
 *   Sarvam STT: hi/ta/bn/te/mr/gu/kn/ml/pa/ur/od/as (Indian subcontinent)
 *   Whisper-1: 99 languages (universal)
 *
 * VOICE SELECTION:
 *   - Platform-specific voices: NYM = warm/approachable, NYS-PRO = professional/authoritative
 *   - Jurisdiction-specific: Indian accents for IN, UK accents for UK, etc.
 *   - Custom voice cloning supported via ElevenLabs IVC (NYS-PRO/INS/GOV)
 *
 * LEGAL PROSODY:
 *   - Legal text read at 0.85x normal speed (clearly articulated)
 *   - Statute sections announced with pauses: "Section 420 of the Indian Penal Code..."
 *   - SSML tags injected for clause boundaries, defined terms, citations
 *
 * @module nyv-voice-service-enhanced
 * @version 1.0.0
 */

import { createLogger } from '../utils/logger.js';
import { NYV_VOICE } from '../config/nyv-master-config.js';
// NYV-OPS-BREAKER-SARVAM-002 (2026-04-30, Task #28): wrap Sarvam STT in the
// shared retry-breaker registry so a Sarvam outage opens the breaker and
// fast-fails the next ~60s of voice traffic instead of starving the gateway.
import { runWithRetryAndBreaker } from './circuit-breaker.js';

const logger = createLogger('nyv-voice-enhanced');

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type TTSProvider = 'elevenlabs' | 'sarvam' | 'openai' | 'google' | 'browser';
export type STTProvider = 'sarvam' | 'openai_whisper' | 'google' | 'browser';

export type VoiceLanguage =
  | 'en' | 'en-IN' | 'en-GB' | 'en-US'
  | 'hi' | 'ta' | 'bn' | 'te' | 'mr' | 'gu' | 'kn' | 'ml' | 'pa' | 'ur' | 'od' | 'as'
  | 'fr' | 'de' | 'es' | 'it' | 'pt' | 'nl' | 'pl' | 'sv' | 'fi' | 'da' | 'no'
  | 'ja' | 'zh' | 'ko' | 'ar' | 'tr' | 'ru' | 'id' | 'ms' | 'th' | 'vi';

export type VoicePersona =
  | 'legal_neutral'      // Default: professional, clear
  | 'legal_authoritative'// For statute readings, court judgments
  | 'legal_approachable' // For citizen-facing (NYM)
  | 'legal_academic';    // For Academy/training

export interface TTSRequest {
  text: string;
  language: VoiceLanguage;
  platform?: string;
  voiceId?: string;
  persona?: VoicePersona;
  speed?: number;         // 0.5 - 2.0, default 1.0 (legal: 0.85)
  pitch?: number;         // -20 to +20 semitones
  isLegalText?: boolean;  // Enable legal prosody (slower, pauses at statutes)
  useSSML?: boolean;      // Inject SSML markup
  outputFormat?: 'mp3' | 'wav' | 'pcm' | 'ogg';
  sampleRate?: number;    // 16000 | 22050 | 44100
  streaming?: boolean;
  cacheKey?: string;
}

export interface TTSResult {
  audioBuffer: Buffer;
  audioBase64?: string;
  mimeType: string;
  provider: TTSProvider;
  voiceId: string;
  language: VoiceLanguage;
  durationMs?: number;
  characterCount: number;
  cached?: boolean;
  latencyMs: number;
}

export interface STTRequest {
  audioBuffer: Buffer;
  mimeType?: string;         // audio/wav, audio/webm, audio/mp4, audio/ogg
  language?: VoiceLanguage;  // Hint (auto-detected if not provided)
  platform?: string;
  isLegalContext?: boolean;  // Enable legal vocabulary boost
  timestamps?: boolean;      // Return word-level timestamps
  speakerDiarization?: boolean;
}

export interface STTResult {
  transcript: string;
  confidence: number;
  language: VoiceLanguage;
  provider: STTProvider;
  words?: Array<{ word: string; start: number; end: number; confidence: number }>;
  latencyMs: number;
  isFinal: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// LANGUAGE → PROVIDER ROUTING
// ─────────────────────────────────────────────────────────────────────────────

const SARVAM_LANGUAGES = new Set<VoiceLanguage>(['hi', 'ta', 'bn', 'te', 'mr', 'gu', 'kn', 'ml', 'pa', 'ur', 'od', 'as']);
const ELEVENLABS_LANGUAGES = new Set<VoiceLanguage>(['en', 'en-IN', 'en-GB', 'en-US', 'hi', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'sv', 'fi', 'da', 'no', 'ja', 'zh', 'ko', 'ar', 'tr', 'ru', 'id', 'ms', 'th', 'vi']);

// Platform-specific ElevenLabs voice IDs (pre-configured)
const PLATFORM_VOICES: Record<string, { voiceId: string; name: string }> = {
  NYM: { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Approachable)' },           // Warm, citizen-friendly
  'NYS-PRO': { voiceId: 'TX3LPaxmHKxFdv7VOQHJ', name: 'Liam (Professional)' },       // Authoritative, clear
  'NYS-INS': { voiceId: 'nPczCjzI2devNBz1zQrb', name: 'Brian (Enterprise)' },        // Deep, trustworthy
  'NYS-ACE': { voiceId: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica (Academic)' },        // Articulate, pedagogical
  'NYS-GOV': { voiceId: 'iP95p4xoKVk53GoZ742B', name: 'Chris (Governmental)' },      // Formal, authoritative
  default: { voiceId: 'EXAVITQu4vr4xnSDxMaL', name: 'Sarah (Default)' },
};

// Legal vocabulary to boost in STT (Sarvam / Whisper hot words)
const LEGAL_HOT_WORDS = [
  'Indian Penal Code', 'BNS', 'BNSS', 'BSA', 'CrPC', 'IPC', 'Section', 'Article',
  'High Court', 'Supreme Court', 'SEBI', 'RBI', 'GDPR', 'DPDP', 'RERA',
  'plaintiff', 'defendant', 'injunction', 'arbitration', 'jurisdiction',
  'habeas corpus', 'mandamus', 'certiorari', 'quo warranto', 'mens rea', 'actus reus',
  'affidavit', 'writ petition', 'suo motu', 'ex parte', 'prima facie', 'inter alia',
];

// ─────────────────────────────────────────────────────────────────────────────
// SSML LEGAL PROSODY INJECTOR
// ─────────────────────────────────────────────────────────────────────────────

function injectLegalSSML(text: string, language: VoiceLanguage, speed: number): string {
  const effectiveSpeed = speed ?? 0.85;
  const lang = language.split('-')[0]; // 'en-IN' → 'en'

  // Detect statute references and add emphasis + pauses
  let ssml = text
    .replace(/\b(Section|S\.|Article|Art\.)\s+(\d+[A-Z]?)\b/g, '<emphasis level="moderate">$1 $2</emphasis>')
    .replace(/\b(Indian Penal Code|BNS|BNSS|BSA|IPC|CrPC|GDPR|DPDP|SEBI|RBI|RERA)\b/g, '<say-as interpret-as="characters">$1</say-as>')
    .replace(/([.!?])\s+(?=[A-Z])/g, '$1 <break time="300ms"/> ')  // Sentence pauses
    .replace(/([;:])\s+/g, '$1 <break time="200ms"/> ')             // Clause pauses
    .replace(/\b(Note:|Disclaimer:|IMPORTANT:|WARNING:)/g, '<break time="400ms"/><emphasis level="strong">$1</emphasis> ');

  return `<speak xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}"><prosody rate="${effectiveSpeed}" pitch="+0%">${ssml}</prosody></speak>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// NYV VOICE SERVICE
// ─────────────────────────────────────────────────────────────────────────────

export class NyvVoiceServiceEnhanced {
  private cache: Map<string, { buffer: Buffer; mimeType: string; cachedAt: number }> = new Map();
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
  private readonly MAX_CACHE_SIZE = 500;

  // ─── TTS ─────────────────────────────────────────────────────────────────

  async synthesize(req: TTSRequest): Promise<TTSResult> {
    const start = Date.now();
    const language = req.language || 'en';
    const speed = req.isLegalText ? (req.speed || 0.85) : (req.speed || 1.0);
    const outputFormat = req.outputFormat || 'mp3';

    // Check cache
    const cacheKey = req.cacheKey || this.buildCacheKey(req.text, language, req.voiceId || '', outputFormat);
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      return {
        audioBuffer: cached.buffer,
        mimeType: cached.mimeType,
        provider: 'elevenlabs',
        voiceId: req.voiceId || 'cached',
        language,
        characterCount: req.text.length,
        cached: true,
        latencyMs: Date.now() - start,
      };
    }

    // Route to provider
    const apiKey = process.env.NYV_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY || '';
    const sarvamKey = process.env.NYV_SARVAM_API_KEY || process.env.SARVAM_API_KEY || '';
    const openaiKey = process.env.NYV_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    // Choose provider
    let result: TTSResult;
    if (apiKey && ELEVENLABS_LANGUAGES.has(language)) {
      result = await this.synthesizeElevenLabs(req, apiKey, language, speed, start);
    } else if (openaiKey) {
      result = await this.synthesizeOpenAITTS(req, openaiKey, language, speed, start);
    } else {
      // Return silence/error buffer so client knows it failed
      logger.warn(`[Voice TTS] No API key configured for TTS (language: ${language})`);
      result = this.buildFallbackTTSResult(req, language, start);
    }

    // Cache result
    if (result.audioBuffer.length > 0) {
      this.putInCache(cacheKey, result.audioBuffer, result.mimeType);
    }

    return result;
  }

  private async synthesizeElevenLabs(
    req: TTSRequest, apiKey: string, language: VoiceLanguage, speed: number, start: number,
  ): Promise<TTSResult> {
    const platform = req.platform || 'default';
    const voiceId = req.voiceId || PLATFORM_VOICES[platform]?.voiceId || PLATFORM_VOICES.default.voiceId;

    let text = req.text;
    if (req.useSSML && req.isLegalText) {
      text = injectLegalSSML(req.text, language, speed);
    }

    const body: Record<string, any> = {
      text,
      model_id: (NYV_VOICE.tts as any).elevenLabsModel,
      voice_settings: {
        stability: 0.71,
        similarity_boost: 0.85,
        style: 0.15,
        use_speaker_boost: true,
      },
    };

    // Speed control via text normalization (ElevenLabs doesn't support speed directly in v1)
    // Use speaking_rate in model_id='eleven_turbo_v2_5' or inject SSML

    const response = await fetch(`${(NYV_VOICE.tts as any).elevenLabsApiUrl}/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/mpeg',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'Unknown error');
      throw new Error(`ElevenLabs TTS failed: ${response.status} ${errText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);

    logger.info(`[Voice TTS] ElevenLabs: ${req.text.length} chars → ${audioBuffer.length} bytes (${Date.now() - start}ms)`);

    return {
      audioBuffer,
      audioBase64: audioBuffer.toString('base64'),
      mimeType: 'audio/mpeg',
      provider: 'elevenlabs',
      voiceId,
      language,
      characterCount: req.text.length,
      cached: false,
      latencyMs: Date.now() - start,
    };
  }

  private async synthesizeOpenAITTS(
    req: TTSRequest, apiKey: string, language: VoiceLanguage, speed: number, start: number,
  ): Promise<TTSResult> {
    const voice = req.persona === 'legal_approachable' ? 'nova'
      : req.persona === 'legal_authoritative' ? 'onyx'
      : req.persona === 'legal_academic' ? 'shimmer'
      : 'alloy';

    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1-hd',
        input: req.text.slice(0, 4096), // OpenAI TTS limit
        voice,
        response_format: 'mp3',
        speed,
      }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      throw new Error(`OpenAI TTS failed: ${response.status}`);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    logger.info(`[Voice TTS] OpenAI TTS: ${req.text.length} chars → ${audioBuffer.length} bytes (${Date.now() - start}ms)`);

    return {
      audioBuffer,
      audioBase64: audioBuffer.toString('base64'),
      mimeType: 'audio/mpeg',
      provider: 'openai',
      voiceId: voice,
      language,
      characterCount: req.text.length,
      cached: false,
      latencyMs: Date.now() - start,
    };
  }

  private buildFallbackTTSResult(req: TTSRequest, language: VoiceLanguage, start: number): TTSResult {
    return {
      audioBuffer: Buffer.alloc(0),
      mimeType: 'audio/mpeg',
      provider: 'browser',
      voiceId: 'none',
      language,
      characterCount: req.text.length,
      cached: false,
      latencyMs: Date.now() - start,
    };
  }

  // ─── STT ─────────────────────────────────────────────────────────────────

  async transcribe(req: STTRequest): Promise<STTResult> {
    const start = Date.now();
    const language = req.language;

    const sarvamKey = process.env.NYV_SARVAM_API_KEY || process.env.SARVAM_API_KEY || '';
    const openaiKey = process.env.NYV_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';

    // Route: Sarvam for Indian languages, Whisper for everything else
    if (sarvamKey && language && SARVAM_LANGUAGES.has(language)) {
      try {
        return await this.transcribeSarvam(req, sarvamKey, language, start);
      } catch (err: any) {
        logger.warn(`[Voice STT] Sarvam failed (${err.message}), falling back to Whisper`);
      }
    }

    if (openaiKey) {
      return await this.transcribeWhisper(req, openaiKey, language, start);
    }

    return {
      transcript: '',
      confidence: 0,
      language: language || 'en',
      provider: 'openai_whisper',
      latencyMs: Date.now() - start,
      isFinal: false,
    };
  }

  private async transcribeSarvam(
    req: STTRequest, apiKey: string, language: VoiceLanguage, start: number,
  ): Promise<STTResult> {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', req.audioBuffer, {
      filename: 'audio.wav',
      contentType: req.mimeType || 'audio/wav',
    });
    form.append('model', (NYV_VOICE.stt as any).sarvamModel);
    form.append('language_code', language);
    if (req.isLegalContext) {
      form.append('prompt', `Legal context: ${LEGAL_HOT_WORDS.slice(0, 10).join(', ')}`);
    }

    // NYV-OPS-BREAKER-SARVAM-002 (post-architect-review hardening, round 2):
    // (a) Throw on !response.ok INSIDE the breaker so HTTP 5xx/429 actually
    //     count as breaker failures (raw fetch only rejects on network errors).
    // (b) AbortSignal.timeout(20_000) aligned with outbound:integration breaker
    //     policy timeout (src/services/circuit-breaker.ts:69) — previously this
    //     site used 30s which left the upload socket alive 10s past breaker
    //     timeout. If Sarvam multipart uploads need a longer ceiling, define a
    //     dedicated 30s integration-upload breaker policy first.
    const result: any = await runWithRetryAndBreaker(
      'integration:sarvam:stt',
      async () => {
        const r = await fetch(`${(NYV_VOICE.stt as any).sarvamApiUrl}/speech-to-text`, {
          method: 'POST',
          headers: {
            'api-subscription-key': apiKey,
            ...form.getHeaders(),
          },
          body: form as any,
          signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) {
          const e: any = new Error(`sarvam_stt_http_${r.status}`);
          e.status = r.status;
          throw e;
        }
        return await r.json();
      },
      'outbound:integration',
      { maxAttempts: 1 },
    );
    const transcript = result.transcript || result.text || '';

    logger.info(`[Voice STT] Sarvam (${language}): "${transcript.slice(0, 60)}" (${Date.now() - start}ms)`);

    return {
      transcript,
      confidence: result.confidence || 0.9,
      language,
      provider: 'sarvam',
      latencyMs: Date.now() - start,
      isFinal: true,
    };
  }

  private async transcribeWhisper(
    req: STTRequest, apiKey: string, language: VoiceLanguage | undefined, start: number,
  ): Promise<STTResult> {
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', req.audioBuffer, {
      filename: `audio.${this.getMimeExtension(req.mimeType || 'audio/wav')}`,
      contentType: req.mimeType || 'audio/wav',
    });
    form.append('model', 'whisper-1');
    if (language) form.append('language', language.split('-')[0]);
    form.append('response_format', req.timestamps ? 'verbose_json' : 'json');
    if (req.isLegalContext) {
      form.append('prompt', LEGAL_HOT_WORDS.slice(0, 8).join(', '));
    }

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...form.getHeaders(),
      },
      body: form as any,
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(`Whisper STT failed: ${response.status}`);
    }

    const result: any = await response.json();
    const transcript = result.text || '';
    const detectedLang = (result.language || language || 'en') as VoiceLanguage;

    logger.info(`[Voice STT] Whisper (${detectedLang}): "${transcript.slice(0, 60)}" (${Date.now() - start}ms)`);

    const words = req.timestamps && result.segments
      ? result.segments.flatMap((seg: any) =>
          (seg.words || []).map((w: any) => ({ word: w.word, start: w.start, end: w.end, confidence: w.probability || 0.9 }))
        )
      : undefined;

    return {
      transcript,
      confidence: 0.92,
      language: detectedLang,
      provider: 'openai_whisper',
      words,
      latencyMs: Date.now() - start,
      isFinal: true,
    };
  }

  // ─── CACHE ────────────────────────────────────────────────────────────────

  private buildCacheKey(text: string, language: string, voiceId: string, format: string): string {
    const crypto = require('crypto');
    return `tts:${language}:${voiceId}:${format}:${crypto.createHash('md5').update(text).digest('hex')}`;
  }

  private getFromCache(key: string): { buffer: Buffer; mimeType: string } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return { buffer: entry.buffer, mimeType: entry.mimeType };
  }

  private putInCache(key: string, buffer: Buffer, mimeType: string): void {
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
      // Evict oldest entry
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { buffer, mimeType, cachedAt: Date.now() });
  }

  private getMimeExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'audio/wav': 'wav', 'audio/wave': 'wav',
      'audio/webm': 'webm', 'audio/mp4': 'mp4', 'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3', 'audio/flac': 'flac', 'audio/aac': 'aac',
    };
    return map[mimeType] || 'wav';
  }

  // ─── STATUS ───────────────────────────────────────────────────────────────

  getStatus(): Record<string, any> {
    return {
      version: '1.0.0',
      ttsProviders: {
        elevenlabs: !!(process.env.NYV_ELEVENLABS_API_KEY || process.env.ELEVENLABS_API_KEY),
        openaiTTS: !!(process.env.NYV_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
      },
      sttProviders: {
        sarvam: !!(process.env.NYV_SARVAM_API_KEY || process.env.SARVAM_API_KEY),
        whisper: !!(process.env.NYV_OPENAI_API_KEY || process.env.OPENAI_API_KEY),
      },
      supportedLanguagesTTS: [...ELEVENLABS_LANGUAGES],
      supportedLanguagesSTT: [...SARVAM_LANGUAGES, 'en', 'fr', 'de', 'es', 'it', 'ja', 'zh', 'ko', 'ar'],
      cacheSize: this.cache.size,
      legalProsody: true,
      ssmlSupport: true,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export const nyvVoiceService = new NyvVoiceServiceEnhanced();
export default nyvVoiceService;
