/**
 * VoiceApi — Multilingual legal voice synthesis and transcription for Jurexio Enterprise Platform 312.
 * Wraps: /api/jrx/voice/*
 * Supports: English, Hindi, Tamil, Telugu, Malayalam, Kannada, Marathi, Bengali
 */

import type {
  NyvVoiceSynthesisRequest,
  NyvVoiceSynthesisResponse,
  NyvVoiceTranscriptionResponse,
} from '../types/index.js';
import type { NyvHttpClient } from '../NyvClient.js';

export interface VoiceCommandOptions {
  language?: NyvVoiceSynthesisRequest['language'];
  jurisdiction?: string;
  context?: string;
  returnAudio?: boolean;
}

export class VoiceApi {
  constructor(private readonly http: NyvHttpClient) {}

  /** Convert text to speech in the specified language */
  synthesize(req: NyvVoiceSynthesisRequest): Promise<NyvVoiceSynthesisResponse> {
    return this.http.post('/api/jrx/voice/synthesize', req);
  }

  /** Transcribe audio to text (base64-encoded audio buffer) */
  transcribe(
    audioBase64: string,
    options: { language?: string; format?: 'mp3' | 'wav' | 'ogg' | 'webm' } = {}
  ): Promise<NyvVoiceTranscriptionResponse> {
    return this.http.post('/api/jrx/voice/transcribe', { audioBase64, ...options });
  }

  /**
   * Legal voice command — transcribe + classify + execute legal intent.
   * Supports: "Search for IPC section 302", "Draft a contract", "What is my case status?"
   */
  command(
    audioBase64: string,
    options: VoiceCommandOptions = {}
  ): Promise<{
    transcript: string;
    intent: string;
    entities: Array<{ type: string; value: string }>;
    response: string;
    audioResponse?: string;
  }> {
    return this.http.post('/api/jrx/voice/command', { audioBase64, ...options });
  }

  /** List available voice models */
  listVoices(language?: string): Promise<{
    voices: Array<{
      voiceId: string;
      name: string;
      language: string;
      gender: string;
      accent?: string;
    }>;
  }> {
    const params = language ? `?language=${language}` : '';
    return this.http.get(`/api/jrx/voice/voices${params}`);
  }

  /** Get voice usage stats for the current org */
  getStats(): Promise<{
    totalSynthesized: number;
    totalTranscribed: number;
    charactersUsed: number;
    audioMinutesProcessed: number;
  }> {
    return this.http.get('/api/jrx/voice/stats');
  }
}
