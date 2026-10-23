/**
 * Jurexio Enterprise Platform 3.1.2 — Real-Time Speech-to-Text (STT) Service
 * Supports Gemini (default Indic), Deepgram Nova-2, Sarvam AI (opt-in), OpenAI Whisper.
 * Legal vocabulary boosting for court terminology, statute names, and legal phrases.
 * @version 3.1.2
 */

import { createLogger } from '../utils/logger.js';
import { runWithRetryAndBreaker } from './circuit-breaker.js';
import {
  isSarvamSttEnabled,
  resolveGeminiApiKey,
  getLanguageProvider,
} from '../utils/jrx-language-provider.js';
import { getGeminiSttModel, toGeminiApiModelId } from '../config/jrx-gemini-models.js';
import { recordAuxSpend } from '../utils/jrx-request-usage-context.js';
import { NV_AUX_RATES } from '../middleware/jrx-aux-cost-estimator.js';

const logger = createLogger('./jrx-stt-service');

export type SttProvider = 'gemini' | 'deepgram' | 'sarvam' | 'whisper' | 'openrouter-whisper';

export interface SttConfig {
  provider: SttProvider;
  language: string;
  sampleRate?: number;
  encoding?: string;
  enablePunctuation?: boolean;
  enableDiarization?: boolean;
  legalVocabularyBoost?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
}

export interface TranscriptionResult {
  text: string;
  isFinal: boolean;
  confidence: number;
  languageCode: string;
  provider: SttProvider;
  isSimulation: boolean;
  words?: TranscriptionWord[];
  alternatives?: string[];
  speakerId?: number;
  durationMs?: number;
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speakerId?: number;
}

const INDIAN_LANGUAGES = new Set([
  'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn', 'ml', 'pa', 'or', 'ur',
  'as', 'bodo', 'doi', 'ks', 'kok', 'mai', 'mni', 'ne', 'sa', 'sat', 'sd'
]);

const LEGAL_VOCABULARY = [
  'habeas corpus', 'mandamus', 'certiorari', 'quo warranto', 'prohibition',
  'injunction', 'bail', 'anticipatory bail', 'FIR', 'chargesheet', 'cognizable',
  'non-cognizable', 'bailable', 'non-bailable', 'compoundable',
  'Bharatiya Nyaya Sanhita', 'BNS', 'BNSS', 'BSA',
  'Bharatiya Nagarik Suraksha Sanhita', 'Bharatiya Sakshya Adhiniyam',
  'Article 14', 'Article 19', 'Article 21', 'Article 32', 'Article 226',
  'Section 302', 'Section 304', 'Section 376', 'Section 420', 'Section 498A',
  'DPDPA', 'Data Protection', 'SEBI', 'RBI', 'NCLT', 'NCLAT',
  'Supreme Court', 'High Court', 'District Court', 'Sessions Court',
  'Magistrate', 'Additional Sessions Judge', 'Chief Justice',
  'writ petition', 'special leave petition', 'SLP', 'PIL',
  'ex parte', 'ad interim', 'res judicata', 'sub judice', 'locus standi',
  'prima facie', 'ultra vires', 'inter alia', 'mutatis mutandis',
  'amicus curiae', 'ratio decidendi', 'obiter dictum',
  'caveat', 'decree', 'order', 'judgment', 'plaint', 'written statement',
  'affidavit', 'vakalatnama', 'power of attorney', 'notarization',
  'arbitration', 'mediation', 'conciliation', 'Lok Adalat',
  'RERA', 'CPC', 'CrPC', 'IPC', 'Evidence Act',
  'Limitation Act', 'Specific Relief Act', 'Transfer of Property Act',
  'Companies Act', 'Insolvency and Bankruptcy Code', 'IBC',
  'GST', 'Income Tax', 'CGST', 'SGST', 'IGST',
  'MoU', 'NDA', 'SPA', 'SHA', 'APA',
];

const COURT_TERMS_BOOST = [
  'Your Honour', 'My Lord', 'Lordship', 'learned counsel',
  'prosecution', 'defence', 'complainant', 'accused', 'respondent',
  'petitioner', 'appellant', 'opposite party', 'intervener',
  'examination-in-chief', 'cross-examination', 're-examination',
  'adjournment', 'hearing', 'arguments', 'reserved judgment',
  'next date of hearing', 'case number', 'CNR number',
];

export class NvSttService {
  private deepgramApiKey: string | null;
  private sarvamApiKey: string | null;
  private openaiApiKey: string | null;
  private openrouterApiKey: string | null;
  private geminiApiKey: string | null;

  constructor() {
    this.deepgramApiKey = process.env.DEEPGRAM_API_KEY || process.env.JRX_DEEPGRAM_API_KEY || null;
    this.sarvamApiKey = process.env.JRX_SARVAM_API_KEY || process.env.SARVAM_API_KEY || null;
    this.openaiApiKey = process.env.OPENAI_API_KEY || null;
    this.openrouterApiKey =
      process.env.OPENROUTER_API_KEY || process.env.AI_INTEGRATIONS_OPENROUTER_API_KEY || null;
    this.geminiApiKey = resolveGeminiApiKey();
    logger.info('nv_stt_service_init', {
      languageProvider: getLanguageProvider(),
      gemini: !!this.geminiApiKey,
      deepgram: !!this.deepgramApiKey,
      sarvam: !!this.sarvamApiKey && isSarvamSttEnabled(),
      whisper: !!this.openaiApiKey,
      openrouterWhisper: !!this.openrouterApiKey,
    });
  }

  selectProvider(language: string): SttProvider {
    const langCode = language.split('-')[0].toLowerCase();
    if (this.geminiApiKey) return 'gemini';
    if (isSarvamSttEnabled() && INDIAN_LANGUAGES.has(langCode) && this.sarvamApiKey) return 'sarvam';
    if (this.deepgramApiKey) return 'deepgram';
    if (this.openaiApiKey) return 'whisper';
    if (this.sarvamApiKey) return 'sarvam';
    return 'gemini';
  }

  isLiveAvailable(): boolean {
    return !!(
      this.geminiApiKey
      || this.openrouterApiKey
      || this.deepgramApiKey
      || (this.sarvamApiKey && isSarvamSttEnabled())
      || this.openaiApiKey
    );
  }

  getAvailableProviders(): Record<string, boolean> {
    return {
      gemini: !!this.geminiApiKey,
      'openrouter-whisper': !!this.openrouterApiKey,
      deepgram: !!this.deepgramApiKey,
      sarvam: !!this.sarvamApiKey && isSarvamSttEnabled(),
      whisper: !!this.openaiApiKey,
    };
  }

  /** Gemini → OpenRouter whisper → Deepgram → OpenAI whisper → simulation. */
  private async cascadeAfterGeminiFailure(
    audioBuffer: Buffer,
    language: string,
    config: Partial<SttConfig>,
    reason: string,
  ): Promise<TranscriptionResult> {
    logger.warn('stt_cascade_after_gemini', { reason });
    if (this.openrouterApiKey) {
      const or = await this.transcribeWithOpenRouterWhisper(audioBuffer, language, config);
      if (!or.isSimulation) return or;
    }
    if (this.deepgramApiKey) {
      const dg = await this.transcribeWithDeepgram(audioBuffer, language, config);
      if (!dg.isSimulation) return dg;
    }
    if (this.openaiApiKey) {
      return this.transcribeWithWhisper(audioBuffer, language, config);
    }
    return this.getSimulationResult(audioBuffer, language, 'gemini');
  }

  async transcribeBatch(
    audioBuffer: Buffer,
    config: Partial<SttConfig> = {}
  ): Promise<TranscriptionResult> {
    const language = config.language || 'en-IN';
    const provider = config.provider || this.selectProvider(language);

    const result = await (async (): Promise<TranscriptionResult> => {
      switch (provider) {
        case 'gemini':
          return this.transcribeWithGemini(audioBuffer, language, config);
        case 'deepgram':
          return this.transcribeWithDeepgram(audioBuffer, language, config);
        case 'sarvam':
          return this.transcribeWithSarvam(audioBuffer, language, config);
        case 'whisper':
          return this.transcribeWithWhisper(audioBuffer, language, config);
        case 'openrouter-whisper':
          return this.transcribeWithOpenRouterWhisper(audioBuffer, language, config);
        default:
          return this.getSimulationResult(audioBuffer, language, provider);
      }
    })();

    // NV-CREDIT-COST-DIM-001 — STT bills per audio second and consumes no chat
    // tokens, so without this the money it spends is invisible to the credit
    // enforcer entirely. Reported here rather than per provider because this is the
    // one funnel every provider passes through; a per-provider hook would be four
    // chances to forget one.
    //
    // `isSimulation` means no provider was called and nothing was billed — reporting
    // it would charge a caller for our own missing API key.
    if (!result.isSimulation) {
      const seconds = Number(result.durationMs) > 0
        ? Number(result.durationMs) / 1000
        // Provider did not report a duration. Byte-derived at the compressed floor
        // rate, so this under-prices rather than over-prices; over-pricing recorded
        // spend would make the budget refuse work it should have allowed.
        : audioBuffer.length / 32_000;
      recordAuxSpend({
        costUsd: (seconds * NV_AUX_RATES.sttMicroUsdPerSecond) / 1_000_000,
        driver: 'stt_audio_seconds',
        provider: result.provider,
        units: Math.round(seconds * 100) / 100,
      });
    }
    return result;
  }

  private mimeForAudio(config: Partial<SttConfig>): string {
    const enc = String(config.encoding || '').toLowerCase();
    if (enc.includes('webm') || enc === 'webm') return 'audio/webm';
    if (enc.includes('ogg') || enc === 'ogg') return 'audio/ogg';
    if (enc.includes('mp3') || enc === 'mp3') return 'audio/mp3';
    if (enc.includes('m4a') || enc === 'm4a') return 'audio/mp4';
    return 'audio/wav';
  }

  private async transcribeWithGemini(
    audioBuffer: Buffer,
    language: string,
    config: Partial<SttConfig>
  ): Promise<TranscriptionResult> {
    if (!this.geminiApiKey) {
      return this.getSimulationResult(audioBuffer, language, 'gemini');
    }
    if (audioBuffer.length < 64) {
      return this.getSimulationResult(audioBuffer, language, 'gemini');
    }

    const model = toGeminiApiModelId(process.env.JRX_GEMINI_STT_MODEL || getGeminiSttModel());
    const mime = this.mimeForAudio(config);
    const prompt =
      `Transcribe this legal/counsel voice recording accurately. `
      + `Language hint: ${language}. `
      + `Preserve Indian legal terms (BNS, BNSS, FIR, bail, etc.). `
      + `Return ONLY the transcript text with no commentary.`;

    try {
      const data = await runWithRetryAndBreaker(
        'integration:gemini:stt',
        async () => {
          const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
            + `?key=${encodeURIComponent(this.geminiApiKey || '')}`;
          const r = await fetch(url, {
            method: 'POST',
            signal: AbortSignal.timeout(45_000),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [
                  { inline_data: { mime_type: mime, data: audioBuffer.toString('base64') } },
                  { text: prompt },
                ],
              }],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          });
          if (r.ok === false) {
            const body = await r.text().catch(() => '');
            const e: any = new Error(`gemini_stt_http_${r.status}:${body.slice(0, 180)}`);
            e.status = r.status;
            throw e;
          }
          return await r.json();
        },
        'outbound:integration',
        { maxAttempts: 2 },
      );

      const text = String(
        (data as any)?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text || '')
          .join('') || '',
      ).trim();

      if (!text) {
        logger.warn('gemini_stt_empty', { language, bytes: audioBuffer.length });
        return this.cascadeAfterGeminiFailure(audioBuffer, language, config, 'empty_transcript');
      }

      return {
        text,
        isFinal: true,
        confidence: 0.9,
        languageCode: language,
        provider: 'gemini',
        isSimulation: false,
      };
    } catch (err: any) {
      logger.error('gemini_transcription_error', { err: err.message });
      return this.cascadeAfterGeminiFailure(audioBuffer, language, config, 'gemini_error');
    }
  }

  private openRouterSttModel(): string {
    return String(process.env.JRX_OPENROUTER_STT_MODEL || 'openai/whisper-1').trim();
  }

  private openRouterSttBaseUrl(): string {
    const base = String(
      process.env.OPENROUTER_BASE_URL
      || process.env.AI_INTEGRATIONS_OPENROUTER_BASE_URL
      || 'https://openrouter.ai/api/v1',
    ).trim().replace(/\/$/, '');
    return base;
  }

  /** OpenRouter exposes an OpenAI-compatible /audio/transcriptions proxy. */
  private async transcribeWithOpenRouterWhisper(
    audioBuffer: Buffer,
    language: string,
    config: Partial<SttConfig>,
  ): Promise<TranscriptionResult> {
    if (!this.openrouterApiKey) {
      return this.getSimulationResult(audioBuffer, language, 'openrouter-whisper');
    }

    try {
      const formData = new FormData();
      const mime = this.mimeForAudio(config);
      const audioBlob = new Blob([audioBuffer], { type: mime });
      formData.append('file', audioBlob, `audio.${mime.split('/')[1] || 'wav'}`);
      formData.append('model', this.openRouterSttModel());
      formData.append('language', language.split('-')[0]);
      formData.append('response_format', 'verbose_json');

      const legalPrompt = LEGAL_VOCABULARY.slice(0, 30).join(', ');
      formData.append('prompt', `Legal transcription context: ${legalPrompt}`);

      const response = await fetch(`${this.openRouterSttBaseUrl()}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.openrouterApiKey}`,
          'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://jurexio.example',
          'X-Title': 'Jurexio Enterprise Platform STT',
        },
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });

      if (response.ok === false) {
        const errText = await response.text();
        logger.error('openrouter_whisper_api_error', { status: response.status, body: errText.slice(0, 180) });
        return this.getSimulationResult(audioBuffer, language, 'openrouter-whisper');
      }

      const data = await response.json() as any;
      const text = String(data.text || '').trim();
      if (!text) {
        return this.getSimulationResult(audioBuffer, language, 'openrouter-whisper');
      }

      return {
        text,
        isFinal: true,
        confidence: 0.88,
        languageCode: data.language || language,
        provider: 'openrouter-whisper',
        isSimulation: false,
        words: (data.words || []).map((w: any) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: 1.0,
        })),
        durationMs: Math.round((data.duration || 0) * 1000),
      };
    } catch (err: any) {
      logger.error('openrouter_whisper_transcription_error', { err: err.message });
      return this.getSimulationResult(audioBuffer, language, 'openrouter-whisper');
    }
  }

  private async transcribeWithDeepgram(
    audioBuffer: Buffer,
    language: string,
    config: Partial<SttConfig>
  ): Promise<TranscriptionResult> {
    if (!this.deepgramApiKey) {
      return this.getSimulationResult(audioBuffer, language, 'deepgram');
    }

    try {
      const params = new URLSearchParams({
        model: 'nova-2',
        language: language === 'en-IN' ? 'en' : language.split('-')[0],
        punctuate: String(config.enablePunctuation !== false),
        diarize: String(config.enableDiarization === true),
        smart_format: 'true',
        utterances: 'true',
      });

      if (config.legalVocabularyBoost !== false) {
        const keywords = [...LEGAL_VOCABULARY.slice(0, 50), ...COURT_TERMS_BOOST.slice(0, 20)]
          .map(kw => `${kw}:2`)
          .join(',');
        params.set('keywords', keywords);
      }

      const response = await fetch(
        `https://api.deepgram.com/v1/listen?${params.toString()}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${this.deepgramApiKey}`,
            'Content-Type': 'audio/wav',
          },
          body: audioBuffer,
        }
      );

      if (response.ok === false) {
        const errText = await response.text();
        logger.error('deepgram_api_error', { status: response.status, body: errText });
        return this.getSimulationResult(audioBuffer, language, 'deepgram');
      }

      const data = await response.json() as any;
      const channel = data.results?.channels?.[0];
      const alternative = channel?.alternatives?.[0];

      if (!alternative) {
        return this.getSimulationResult(audioBuffer, language, 'deepgram');
      }

      return {
        text: alternative.transcript || '',
        isFinal: true,
        confidence: alternative.confidence || 0,
        languageCode: language,
        provider: 'deepgram',
        isSimulation: false,
        words: (alternative.words || []).map((w: any) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: w.confidence,
          speakerId: w.speaker,
        })),
        alternatives: channel?.alternatives?.slice(1).map((a: any) => a.transcript) || [],
        durationMs: Math.round((data.metadata?.duration || 0) * 1000),
      };
    } catch (err: any) {
      logger.error('deepgram_transcription_error', { err: err.message });
      return this.getSimulationResult(audioBuffer, language, 'deepgram');
    }
  }

  private async transcribeWithSarvam(
    audioBuffer: Buffer,
    language: string,
    config: Partial<SttConfig>
  ): Promise<TranscriptionResult> {
    if (!isSarvamSttEnabled() || !this.sarvamApiKey) {
      if (this.geminiApiKey) return this.transcribeWithGemini(audioBuffer, language, config);
      if (this.openaiApiKey) return this.transcribeWithWhisper(audioBuffer, language, config);
      return this.getSimulationResult(audioBuffer, language, 'sarvam');
    }

    try {
      const langCode = language.split('-')[0].toLowerCase();
      const sarvamLangMap: Record<string, string> = {
        hi: 'hi-IN', ta: 'ta-IN', te: 'te-IN', mr: 'mr-IN', bn: 'bn-IN',
        gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-IN', or: 'or-IN',
        ur: 'ur-IN', en: 'en-IN', as: 'as-IN', ne: 'ne-NP', sa: 'sa-IN',
        sd: 'sd-IN', kok: 'kok-IN', mai: 'mai-IN', doi: 'doi-IN',
        mni: 'mni-IN', bodo: 'brx-IN', sat: 'sat-IN',
      };
      const sarvamLang = sarvamLangMap[langCode] || 'hi-IN';

      const base64Audio = audioBuffer.toString('base64');

      // JRX-OPS-BREAKER-SARVAM-001 (post-architect-review hardening):
      // (a) Throw on !response.ok INSIDE the breaker so HTTP 5xx/429 actually
      //     count as breaker failures (raw fetch only rejects on network errors,
      //     so without this the breaker would never open on a degraded Sarvam
      //     returning 5xx). (b) AbortSignal.timeout(20_000) matches the
      //     outbound:integration policy timeout so timed-out calls actually
      //     abort the underlying socket instead of leaking event-loop slots.
      const data = await runWithRetryAndBreaker(
        'integration:sarvam:stt',
        async () => {
          const r = await fetch('https://api.sarvam.ai/speech-to-text', {
            method: 'POST',
            signal: AbortSignal.timeout(20_000),
            headers: {
              'Content-Type': 'application/json',
              'API-Subscription-Key': this.sarvamApiKey || '',
            },
            body: JSON.stringify({
              inputs: [base64Audio],
              config: {
                language: { sourceLanguage: sarvamLang },
                audioFormat: config.encoding || 'wav',
                samplingRate: config.sampleRate || 16000,
                postProcessors: ['itn', 'punctuation'],
              },
            }),
          });
          if (r.ok === false) {
            const errText = await r.text().catch(() => '');
            const e: any = new Error(`sarvam_stt_http_${r.status}`);
            e.status = r.status;
            e.body = errText;
            throw e;
          }
          return await r.json() as any;
        },
        'outbound:integration',
        { maxAttempts: 1 },
      );
      const transcript = data.output?.[0]?.source || data.transcript || '';

      return {
        text: transcript,
        isFinal: true,
        confidence: data.output?.[0]?.confidence || 0.85,
        languageCode: sarvamLang,
        provider: 'sarvam',
        isSimulation: false,
        durationMs: Math.round((data.duration || 0) * 1000),
      };
    } catch (err: any) {
      logger.error('sarvam_transcription_error', { err: err.message });
      return this.getSimulationResult(audioBuffer, language, 'sarvam');
    }
  }

  private async transcribeWithWhisper(
    audioBuffer: Buffer,
    language: string,
    _config: Partial<SttConfig>
  ): Promise<TranscriptionResult> {
    if (!this.openaiApiKey) {
      return this.getSimulationResult(audioBuffer, language, 'whisper');
    }

    try {
      const formData = new FormData();
      const audioBlob = new Blob([audioBuffer], { type: 'audio/wav' });
      formData.append('file', audioBlob, 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', language.split('-')[0]);
      formData.append('response_format', 'verbose_json');

      const legalPrompt = LEGAL_VOCABULARY.slice(0, 30).join(', ');
      formData.append('prompt', `Legal transcription context: ${legalPrompt}`);

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiApiKey}`,
        },
        body: formData,
      });

      if (response.ok === false) {
        const errText = await response.text();
        logger.error('whisper_api_error', { status: response.status, body: errText });
        if (response.status === 429 || /insufficient_quota|credit_balance_exhausted/i.test(errText)) {
          return {
            text: `[Simulation] OpenAI Whisper quota exhausted (key is configured). Primary STT is Gemini; add OpenAI credits only if Whisper fallback is required.`,
            isFinal: true,
            confidence: 0,
            languageCode: language,
            provider: 'whisper',
            isSimulation: true,
          };
        }
        return this.getSimulationResult(audioBuffer, language, 'whisper');
      }

      const data = await response.json() as any;

      return {
        text: data.text || '',
        isFinal: true,
        confidence: 0.9,
        languageCode: data.language || language,
        provider: 'whisper',
        isSimulation: false,
        words: (data.words || []).map((w: any) => ({
          word: w.word,
          start: w.start,
          end: w.end,
          confidence: 1.0,
        })),
        durationMs: Math.round((data.duration || 0) * 1000),
      };
    } catch (err: any) {
      logger.error('whisper_transcription_error', { err: err.message });
      return this.getSimulationResult(audioBuffer, language, 'whisper');
    }
  }

  private getSimulationResult(
    audioBuffer: Buffer,
    language: string,
    provider: SttProvider
  ): TranscriptionResult {
    const keyName = this.getRequiredKeyName(provider);
    const hasKey =
      (provider === 'gemini' && !!this.geminiApiKey)
      || (provider === 'openrouter-whisper' && !!this.openrouterApiKey)
      || (provider === 'whisper' && !!this.openaiApiKey)
      || (provider === 'deepgram' && !!this.deepgramApiKey)
      || (provider === 'sarvam' && !!this.sarvamApiKey);
    const hint = hasKey
      ? `Provider ${provider} failed despite ${keyName} being configured — check model/quota/logs.`
      : `Set ${keyName} to enable live ${provider} transcription.`;
    return {
      text: `[Simulation] Received ${audioBuffer.length} bytes. ${hint}`,
      isFinal: true,
      confidence: 0,
      languageCode: language,
      provider,
      isSimulation: true,
    };
  }

  private getRequiredKeyName(provider: SttProvider): string {
    switch (provider) {
      case 'gemini': return 'GEMINI_API_KEY';
      case 'openrouter-whisper': return 'OPENROUTER_API_KEY';
      case 'deepgram': return 'DEEPGRAM_API_KEY';
      case 'sarvam': return 'JRX_SARVAM_API_KEY (set JRX_LANGUAGE_PROVIDER=sarvam when ready)';
      case 'whisper': return 'OPENAI_API_KEY';
      default: {
        const _exhaustive: never = provider;
        return String(_exhaustive);
      }
    }
  }

  async createRealtimeStream(
    config: Partial<SttConfig>,
    onTranscript: (result: TranscriptionResult) => void,
    onError: (error: Error) => void
  ): Promise<RealtimeStream> {
    const language = config.language || 'en-IN';
    const provider = config.provider || this.selectProvider(language);

    if (provider === 'deepgram' && this.deepgramApiKey) {
      return this.createDeepgramStream(language, config, onTranscript, onError);
    }

    return this.createBufferedStream(language, provider, config, onTranscript, onError);
  }

  private async createDeepgramStream(
    language: string,
    config: Partial<SttConfig>,
    onTranscript: (result: TranscriptionResult) => void,
    onError: (error: Error) => void
  ): Promise<RealtimeStream> {
    const params = new URLSearchParams({
      model: 'nova-2',
      language: language === 'en-IN' ? 'en' : language.split('-')[0],
      punctuate: 'true',
      interim_results: String(config.interimResults !== false),
      smart_format: 'true',
      endpointing: '300',
      utterance_end_ms: '1000',
    });

    if (config.enableDiarization) {
      params.set('diarize', 'true');
    }

    if (config.legalVocabularyBoost !== false) {
      const topKeywords = [...LEGAL_VOCABULARY.slice(0, 30), ...COURT_TERMS_BOOST.slice(0, 15)]
        .map(kw => `${kw}:2`)
        .join(',');
      params.set('keywords', topKeywords);
    }

    let ws: any;
    try {
      const { WebSocket } = await import('ws');
      ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
        headers: { 'Authorization': `Token ${this.deepgramApiKey}` },
      });
    } catch (err: any) {
      logger.error('deepgram_ws_connect_error', { err: err.message });
      return this.createBufferedStream(language, 'deepgram', config, onTranscript, onError);
    }

    let isOpen = false;

    ws.on('open', () => { isOpen = true; });
    ws.on('error', (err: Error) => { onError(err); });
    ws.on('close', () => { isOpen = false; });

    ws.on('message', (data: Buffer | string) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'Results') {
          const alt = msg.channel?.alternatives?.[0];
          if (alt && alt.transcript) {
            onTranscript({
              text: alt.transcript,
              isFinal: msg.is_final || false,
              confidence: alt.confidence || 0,
              languageCode: language,
              provider: 'deepgram',
              isSimulation: false,
              words: (alt.words || []).map((w: any) => ({
                word: w.word,
                start: w.start,
                end: w.end,
                confidence: w.confidence,
                speakerId: w.speaker,
              })),
              speakerId: alt.words?.[0]?.speaker,
            });
          }
        }
      } catch { /* ignore parse errors */ }
    });

    return {
      sendAudio(chunk: Buffer) {
        if (isOpen && ws.readyState === 1) {
          ws.send(chunk);
        }
      },
      close() {
        if (isOpen && ws.readyState === 1) {
          ws.send(JSON.stringify({ type: 'CloseStream' }));
          setTimeout(() => ws.close(), 500);
        }
      },
      isActive() {
        return isOpen && ws.readyState === 1;
      },
    };
  }

  private async createBufferedStream(
    language: string,
    provider: SttProvider,
    config: Partial<SttConfig>,
    onTranscript: (result: TranscriptionResult) => void,
    _onError: (error: Error) => void
  ): Promise<RealtimeStream> {
    const chunks: Buffer[] = [];
    let active = true;
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const flushBuffer = async () => {
      if (chunks.length === 0) return;
      const combined = Buffer.concat(chunks.splice(0));
      const result = await this.transcribeBatch(combined, { ...config, language, provider });
      if (active) {
        onTranscript(result);
      }
    };

    flushTimer = setInterval(flushBuffer, 3000);

    return {
      sendAudio(chunk: Buffer) {
        if (active) chunks.push(chunk);
      },
      async close() {
        active = false;
        if (flushTimer) clearInterval(flushTimer);
        await flushBuffer();
      },
      isActive() { return active; },
    };
  }

  getLegalVocabulary(): string[] {
    return [...LEGAL_VOCABULARY];
  }

  getCourtTerms(): string[] {
    return [...COURT_TERMS_BOOST];
  }

  getSupportedLanguages(): Array<{ code: string; name: string; providers: SttProvider[] }> {
    return [
      { code: 'en-IN', name: 'English (India)', providers: ['deepgram', 'whisper'] },
      { code: 'hi', name: 'Hindi', providers: ['sarvam', 'whisper'] },
      { code: 'ta', name: 'Tamil', providers: ['sarvam', 'whisper'] },
      { code: 'te', name: 'Telugu', providers: ['sarvam', 'whisper'] },
      { code: 'mr', name: 'Marathi', providers: ['sarvam', 'whisper'] },
      { code: 'bn', name: 'Bengali', providers: ['sarvam', 'whisper'] },
      { code: 'gu', name: 'Gujarati', providers: ['sarvam', 'whisper'] },
      { code: 'kn', name: 'Kannada', providers: ['sarvam', 'whisper'] },
      { code: 'ml', name: 'Malayalam', providers: ['sarvam', 'whisper'] },
      { code: 'pa', name: 'Punjabi', providers: ['sarvam', 'whisper'] },
      { code: 'or', name: 'Odia', providers: ['sarvam', 'whisper'] },
      { code: 'ur', name: 'Urdu', providers: ['sarvam', 'whisper'] },
      { code: 'as', name: 'Assamese', providers: ['sarvam'] },
      { code: 'ne', name: 'Nepali', providers: ['sarvam'] },
      { code: 'sa', name: 'Sanskrit', providers: ['sarvam'] },
      { code: 'sd', name: 'Sindhi', providers: ['sarvam'] },
      { code: 'kok', name: 'Konkani', providers: ['sarvam'] },
      { code: 'mai', name: 'Maithili', providers: ['sarvam'] },
      { code: 'doi', name: 'Dogri', providers: ['sarvam'] },
      { code: 'mni', name: 'Manipuri', providers: ['sarvam'] },
      { code: 'bodo', name: 'Bodo', providers: ['sarvam'] },
      { code: 'sat', name: 'Santali', providers: ['sarvam'] },
    ];
  }
}

export interface RealtimeStream {
  sendAudio(chunk: Buffer): void;
  close(): void | Promise<void>;
  isActive(): boolean;
}

let sttServiceInstance: NvSttService | null = null;

export function getSttService(): NvSttService {
  if (!sttServiceInstance) {
    sttServiceInstance = new NvSttService();
  }
  return sttServiceInstance;
}
