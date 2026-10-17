import { createLogger } from '../../utils/logger.js';

const logger = createLogger('voice-synthesis-engine');

/**
 * Voice Synthesis Engine with ElevenLabs Primary and Fallback Support
 * Comprehensive voice generation with multiple provider support and quality fallbacks
 */

export interface VoiceSettings {
  voice: string;
  stability: number;
  similarityBoost: number;
  style: number;
  speakerBoost: boolean;
  language?: string;
  speed?: number;
  pitch?: number;
}

export interface VoiceProvider {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  capabilities: string[];
  voiceModels: VoiceModel[];
}

export interface VoiceModel {
  id: string;
  name: string;
  language: string;
  gender: 'male' | 'female' | 'neutral';
  age: 'child' | 'young' | 'adult' | 'elderly';
  accent?: string;
  specialty?: string[];
}

export class VoiceSynthesisEngine {
  private providers: Map<string, VoiceProvider> = new Map();
  private fallbackChain: string[] = ['elevenlabs', 'browser-tts', 'system-tts'];

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders() {
    // ElevenLabs - Primary Provider
    this.providers.set('elevenlabs', {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      enabled: true,
      priority: 1,
      capabilities: ['voice_cloning', 'multilingual', 'high_quality', 'emotion_control'],
      voiceModels: [
        {
          id: 'rachel',
          name: 'Rachel',
          language: 'en-US',
          gender: 'female',
          age: 'young',
          specialty: ['narration', 'professional']
        },
        {
          id: 'adam',
          name: 'Adam',
          language: 'en-US',
          gender: 'male',
          age: 'adult',
          specialty: ['deep_voice', 'authoritative']
        },
        {
          id: 'bella',
          name: 'Bella',
          language: 'en-US',
          gender: 'female',
          age: 'young',
          specialty: ['warm', 'friendly']
        },
        {
          id: 'antoni',
          name: 'Antoni',
          language: 'en-US',
          gender: 'male',
          age: 'adult',
          specialty: ['calm', 'storytelling']
        }
      ]
    });

    // Browser TTS - Fallback Provider
    this.providers.set('browser-tts', {
      id: 'browser-tts',
      name: 'Browser Text-to-Speech',
      enabled: true,
      priority: 2,
      capabilities: ['basic_tts', 'offline', 'free'],
      voiceModels: [
        {
          id: 'system-default',
          name: 'System Default',
          language: 'en-US',
          gender: 'neutral',
          age: 'adult'
        }
      ]
    });

    // System TTS - Ultimate Fallback
    this.providers.set('system-tts', {
      id: 'system-tts',
      name: 'System Text-to-Speech',
      enabled: true,
      priority: 3,
      capabilities: ['basic_tts', 'offline', 'free', 'reliable'],
      voiceModels: [
        {
          id: 'system-basic',
          name: 'System Basic',
          language: 'en-US',
          gender: 'neutral',
          age: 'adult'
        }
      ]
    });
  }

  async synthesizeVoice(
    text: string, 
    settings: VoiceSettings = this.getDefaultSettings(),
    fallbackEnabled: boolean = true
  ): Promise<{ audio: Buffer; provider: string; model: string }> {
    
    for (const providerId of this.fallbackChain) {
      const provider = this.providers.get(providerId);
      if (!provider?.enabled) continue;

      try {
        logger.info(`Attempting voice synthesis with ${provider.name}...`);
        
        const result = await this.synthesizeWithProvider(providerId, text, settings);
        
        logger.info(`✅ Voice synthesis successful with ${provider.name}`);
        return {
          audio: result,
          provider: providerId,
          model: settings.voice || 'default'
        };

      } catch (error: any) {
        logger.warn(`❌ Voice synthesis failed with ${provider.name}:`, error.message);
        
        if (!fallbackEnabled || providerId === this.fallbackChain[this.fallbackChain.length - 1]) {
          throw error;
        }
        
        logger.info(`🔄 Falling back to next provider...`);
      }
    }

    throw new Error('All voice synthesis providers failed');
  }

  private async synthesizeWithProvider(
    providerId: string, 
    text: string, 
    settings: VoiceSettings
  ): Promise<Buffer> {
    switch (providerId) {
      case 'elevenlabs':
        return await this.elevenLabsSynthesize(text, settings);
      case 'browser-tts':
        return await this.browserTTSSynthesize(text, settings);
      case 'system-tts':
        return await this.systemTTSSynthesize(text, settings);
      default:
        throw new Error(`Unknown provider: ${providerId}`);
    }
  }

  private async elevenLabsSynthesize(text: string, settings: VoiceSettings): Promise<Buffer> {
    if (!process.env.ELEVENLABS_API_KEY) {
      console.warn('[voice-synthesis-engine] ELEVENLABS_API_KEY not configured — falling back to browser-tts');
      return await this.browserTTSSynthesize(text, settings);
    }

    const voiceId = this.getElevenLabsVoiceId(settings.voice);
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text: text.slice(0, 5000), // ElevenLabs limit
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          stability: settings.stability || 0.5,
          similarity_boost: settings.similarityBoost || 0.5,
          style: settings.style || 0.0,
          use_speaker_boost: settings.speakerBoost || true
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`ElevenLabs API error ${response.status}: ${errorText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  private async browserTTSSynthesize(text: string, settings: VoiceSettings): Promise<Buffer> {
    // This would typically require a browser environment
    // For server-side, we simulate or use alternative TTS
    throw new Error('Browser TTS requires client-side implementation');
  }

  private async systemTTSSynthesize(text: string, settings: VoiceSettings): Promise<Buffer> {
    // Use system TTS commands (like espeak, festival, or OS-specific TTS)
    const { spawn } = require('child_process');
    
    return new Promise((resolve, reject) => {
      // Example using espeak (would need to be installed)
      const espeak = spawn('espeak', ['-s', '150', '-v', 'en', '--stdout'], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let audioData = Buffer.alloc(0);

      espeak.stdout.on('data', (data: Buffer) => {
        audioData = Buffer.concat([audioData, data]);
      });

      espeak.on('error', (error: Error) => {
        reject(new Error(`System TTS error: ${error.message}`));
      });

      espeak.on('close', (code: number | null) => {
        if (code === 0) {
          resolve(audioData);
        } else {
          reject(new Error(`System TTS failed with code ${code}`));
        }
      });

      espeak.stdin.write(text);
      espeak.stdin.end();
    });
  }

  private getElevenLabsVoiceId(voiceName?: string): string {
    const voiceMap = {
      'rachel': '21m00Tcm4TlvDq8ikWAM',
      'adam': 'pNInz6obpgDQGcFmaJgB',
      'bella': 'EXAVITQu4vr4xnSDxMaL',
      'antoni': 'ErXwobaYiN019PkySvjV',
      'elli': 'MF3mGyEYCl7XYWbV9V6O',
      'josh': 'TxGEqnHWrfWFTfGW9XjX',
      'arnold': 'VR6AewLTigWG4xSOukaG',
      'domi': 'AZnzlk1XvdvUeBnXmlld',
      'dave': 'CYw3kZ02Hs0563khs1Fj'
    };

    return voiceMap[voiceName?.toLowerCase() as keyof typeof voiceMap] || voiceMap['rachel'];
  }

  private getDefaultSettings(): VoiceSettings {
    return {
      voice: 'rachel',
      stability: 0.5,
      similarityBoost: 0.5,
      style: 0.0,
      speakerBoost: true,
      language: 'en-US',
      speed: 1.0,
      pitch: 1.0
    };
  }

  // Voice management methods
  getAvailableVoices(providerId?: string): VoiceModel[] {
    if (providerId) {
      const provider = this.providers.get(providerId);
      return provider?.voiceModels || [];
    }

    // Return all voices from all providers
    const allVoices: VoiceModel[] = [];
    for (const provider of Array.from(this.providers.values())) {
      allVoices.push(...provider.voiceModels);
    }
    return allVoices;
  }

  getProvider(id: string): VoiceProvider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): VoiceProvider[] {
    return Array.from(this.providers.values());
  }

  setProviderEnabled(id: string, enabled: boolean): void {
    const provider = this.providers.get(id);
    if (provider) {
      provider.enabled = enabled;
    }
  }

  updateFallbackChain(newChain: string[]): void {
    // Validate that all providers in chain exist
    const validProviders = newChain.filter(id => this.providers.has(id));
    this.fallbackChain = validProviders;
  }

  // Utility methods
  async testProvider(providerId: string): Promise<boolean> {
    try {
      const testText = "This is a test of the voice synthesis system.";
      await this.synthesizeWithProvider(providerId, testText, this.getDefaultSettings());
      return true;
    } catch (error: any) {
      logger.error(`Provider ${providerId} test failed:`, error.message);
      return false;
    }
  }

  async getProviderStatus(): Promise<{ [key: string]: boolean }> {
    const status: { [key: string]: boolean } = {};
    
    for (const providerId of Array.from(this.providers.keys())) {
      status[providerId] = await this.testProvider(providerId);
    }
    
    return status;
  }

  // Voice cloning for ElevenLabs
  async cloneVoice(
    name: string, 
    description: string, 
    audioFiles: Buffer[]
  ): Promise<string> {
    if (!process.env.ELEVENLABS_API_KEY) {
      throw new Error('ElevenLabs API key required for voice cloning');
    }

    const formData = new FormData();
    formData.append('name', name);
    formData.append('description', description);
    
    audioFiles.forEach((audio, index) => {
      formData.append('files', new Blob([audio]), `sample_${index}.mp3`);
    });

    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY
      },
      body: formData
    });

    if (!response.ok) {
      throw new Error(`Voice cloning failed: ${response.status}`);
    }

    const result = await response.json() as { voice_id: string };
    return result.voice_id;
  }

  // Speech-to-Text Transcription (using OpenAI Whisper)
  async transcribeAudio(
    audioPath: string,
    options?: { language?: string; timestamps?: boolean }
  ): Promise<{
    text: string;
    language?: string;
    duration?: number;
    segments?: Array<{ id: number; start: number; end: number; text: string; confidence?: number }>;
  }> {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OpenAI API key not configured for transcription. Please set OPENAI_API_KEY environment variable.');
    }

    const fs = require('fs');
    const OpenAI = require('openai').default;
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // Verify file exists
    if (!fs.existsSync(audioPath)) {
      throw new Error(`Audio file not found: ${audioPath}`);
    }

    const audioFile = fs.createReadStream(audioPath);

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: options?.language?.split('-')[0], // Convert 'en-US' to 'en'
      response_format: options?.timestamps ? 'verbose_json' : 'json',
    });

    return {
      text: transcription.text,
      language: transcription.language || options?.language,
      duration: transcription.duration,
      segments: transcription.segments?.map((seg: any, idx: number) => ({
        id: idx,
        start: seg.start,
        end: seg.end,
        text: seg.text,
        confidence: seg.avg_logprob ? Math.exp(seg.avg_logprob) : undefined,
      })),
    };
  }

  // Multilingual support
  async synthesizeMultilingual(
    text: string, 
    language: string, 
    settings?: Partial<VoiceSettings>
  ): Promise<Buffer> {
    const multilingualSettings: VoiceSettings = {
      ...this.getDefaultSettings(),
      ...settings,
      language
    };

    // Select appropriate voice model for language
    const voiceForLanguage = this.selectVoiceForLanguage(language);
    multilingualSettings.voice = voiceForLanguage;

    const result = await this.synthesizeVoice(text, multilingualSettings);
    return result.audio;
  }

  private selectVoiceForLanguage(language: string): string {
    const languageVoiceMap = {
      'en-US': 'rachel',
      'en-GB': 'bella',
      'es-ES': 'antoni',
      'fr-FR': 'antoni',
      'de-DE': 'adam',
      'it-IT': 'bella',
      'pt-BR': 'antoni',
      'hi-IN': 'rachel', // ElevenLabs supports Hindi with multilingual model
      'ja-JP': 'bella',
      'ko-KR': 'rachel',
      'zh-CN': 'antoni'
    };

    return languageVoiceMap[language as keyof typeof languageVoiceMap] || 'rachel';
  }
}

export default VoiceSynthesisEngine;