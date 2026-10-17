import { createLogger } from '../../utils/logger.js';

const logger = createLogger('nv-voice-service-contract');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface VoiceTranscribeInput {
  audioBuffer: Buffer;
  language: string;
  format: 'wav' | 'mp3' | 'ogg' | 'webm';
  jurisdiction?: JurisdictionCode;
}

interface VoiceTranscribeResult {
  text: string;
  language: string;
  confidence: number;
  durationSeconds: number;
  segments: { start: number; end: number; text: string }[];
  model: string;
}

interface VoiceSynthesizeInput {
  text: string;
  language: string;
  voice?: string;
  speed?: number;
  jurisdiction?: JurisdictionCode;
}

interface VoiceSynthesizeResult {
  audioBuffer: Buffer;
  format: string;
  durationSeconds: number;
  model: string;
}

interface VoiceTranslateInput {
  text: string;
  sourceLanguage: string;
  targetLanguage: string;
  jurisdiction?: JurisdictionCode;
}

interface VoiceTranslateResult {
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  confidence: number;
  model: string;
}

export interface NvVoiceServiceContract {
  transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult>;
  synthesize(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult>;
  translate(input: VoiceTranslateInput): Promise<VoiceTranslateResult>;
}

export class NvVoiceServiceAdapter implements NvVoiceServiceContract {
  async transcribe(input: VoiceTranscribeInput): Promise<VoiceTranscribeResult> {
    logger.info({ method: 'transcribe', language: input.language, format: input.format });
    return {
      text: '',
      language: input.language,
      confidence: 0,
      durationSeconds: 0,
      segments: [],
      model: process.env.NYV_VOICE_STT_MODEL || 'whisper-large-v3',
    };
  }

  async synthesize(input: VoiceSynthesizeInput): Promise<VoiceSynthesizeResult> {
    logger.info({ method: 'synthesize', language: input.language, textLength: input.text.length });
    return {
      audioBuffer: Buffer.alloc(0),
      format: 'wav',
      durationSeconds: 0,
      model: process.env.NYV_VOICE_TTS_MODEL || 'elevenlabs-multilingual-v2',
    };
  }

  async translate(input: VoiceTranslateInput): Promise<VoiceTranslateResult> {
    logger.info({ method: 'translate', source: input.sourceLanguage, target: input.targetLanguage });
    return {
      translatedText: input.text,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      confidence: 0,
      model: process.env.NYV_VOICE_TRANSLATE_MODEL || 'sarvam-translate-v1',
    };
  }
}

export const HTTP_CONTRACT = {
  serviceName: 'NYV-VOICE-SERVICE',
  baseUrl: '/api/nv/voice-service',
  endpoints: [
    { method: 'POST', path: '/transcribe', handler: 'transcribe' },
    { method: 'POST', path: '/synthesize', handler: 'synthesize' },
    { method: 'POST', path: '/translate', handler: 'translate' },
  ],
} as const;

export const GRPC_CONTRACT = {
  serviceName: 'NvVoiceService',
  package: 'nyv.voice.v1',
  methods: [
    { name: 'Transcribe', requestType: 'TranscribeRequest', responseType: 'TranscribeResponse' },
    { name: 'Synthesize', requestType: 'SynthesizeRequest', responseType: 'SynthesizeResponse' },
    { name: 'Translate', requestType: 'TranslateRequest', responseType: 'TranslateResponse' },
  ],
} as const;
