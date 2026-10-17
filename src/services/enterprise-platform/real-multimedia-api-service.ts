/**
 * RealMultimediaAPIService
 *
 * NV-REAL-DATA-001 (Session-29, 2026-06-29): previously returned synthetic
 * image URLs and canned transcription text. Audio transcription is now wired
 * to the REAL `jrx-stt-service` (Deepgram / Sarvam / Whisper). Image generation
 * has no real provider on this legal platform, so it FAILS LOUD instead of
 * returning a fabricated URL. No method ever returns synthetic data.
 */
import { getSttService } from '../jrx-stt-service.js';

class RealMultimediaAPIService {
  private processedCount = 0;

  async processMultimedia(input: { type: string; content?: string; url?: string; language?: string }): Promise<{ type: string; result: any; processingTime: number }> {
    const start = Date.now();
    if (input.type === 'audio' || input.type === 'transcription') {
      if (!input.content) throw new Error('processMultimedia(audio): base64 `content` is required');
      const result = await this.transcribeAudio(input.content, input.language);
      this.processedCount++;
      return { type: input.type, result, processingTime: Date.now() - start };
    }
    throw new Error(`Unsupported multimedia type "${input.type}" — no real provider wired`);
  }

  async generateImage(_prompt: string, _options?: Record<string, any>): Promise<{ url: string; prompt: string; model: string }> {
    // Fail loud — no image-generation provider is configured for this platform.
    throw new Error('Image generation is not configured on this platform');
  }

  async transcribeAudio(audioData: string | Buffer, language?: string): Promise<{ text: string; language: string; confidence: number; duration: number }> {
    const buffer = typeof audioData === 'string'
      ? Buffer.from(audioData.replace(/^data:[^;]+;base64,/, ''), 'base64')
      : audioData;
    if (!buffer || buffer.length === 0) throw new Error('transcribeAudio: empty audio payload');

    const result = await getSttService().transcribeBatch(buffer, { language: language || 'en-IN' });
    if (result.isSimulation) {
      throw new Error('Audio transcription unavailable: no STT provider configured (set DEEPGRAM/SARVAM/OpenAI Whisper credentials)');
    }
    this.processedCount++;
    return {
      text: result.text,
      language: result.languageCode || language || 'en',
      confidence: result.confidence,
      duration: result.durationMs ? result.durationMs / 1000 : 0,
    };
  }

  getStats(): { processedCount: number } {
    return { processedCount: this.processedCount };
  }
}

export const realMultimediaAPIService = new RealMultimediaAPIService();
export const multimediaApiService = realMultimediaAPIService;
