/**
 * Real-Time Voice Streaming Service
 * Cost-Optimized Voice AI with WebSocket/WebRTC Support
 * Inspired by Pipecat architecture for Node.js/TypeScript
 */

import { EventEmitter } from 'events';
import { WebSocket } from 'ws';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('realtime-voice-streaming');

// ==================== Types ====================

export interface AudioChunk {
  id: string;
  data: Buffer;
  timestamp: number;
  sampleRate: number;
  channels: number;
  format: 'pcm' | 'opus' | 'mp3';
}

export interface TranscriptionResult {
  id: string;
  text: string;
  confidence: number;
  isFinal: boolean;
  timestamp: number;
  words?: Array<{
    text: string;
    start: number;
    end: number;
    confidence: number;
  }>;
}

export interface VoiceStreamConfig {
  sessionId: string;
  sttProvider: 'deepgram' | 'assemblyai' | 'openai' | 'auto';
  ttsProvider: 'cartesia' | 'playht' | 'openai' | 'elevenlabs' | 'auto';
  voiceId?: string;
  language?: string;
  enableInterruption?: boolean;
  costMode?: 'economy' | 'balanced' | 'premium';
}

export interface ProviderCosts {
  stt: {
    deepgram: number;      // $0.0043/min
    assemblyai: number;     // $0.00032/sec
    openai: number;         // $0.006/min
  };
  tts: {
    cartesia: number;       // $0.01/1k chars (~70% cheaper)
    playht: number;         // $0.015/1k chars
    openai: number;         // $0.015/1k chars
    elevenlabs: number;     // $0.30/1k chars (premium)
  };
}

export interface StreamMetrics {
  sessionId: string;
  audioReceived: number;
  audioSent: number;
  transcriptionTime: number;
  synthesisTime: number;
  latency: number;
  costEstimate: number;
  providerUsed: {
    stt: string;
    tts: string;
  };
}

// ==================== Real-Time Voice Streaming Service ====================

export class RealtimeVoiceStreamingService extends EventEmitter {
  private sessions: Map<string, VoiceStreamSession> = new Map();
  private costs: ProviderCosts = {
    stt: {
      deepgram: 0.0043 / 60,       // per second
      assemblyai: 0.00032,          // per second
      openai: 0.006 / 60            // per second
    },
    tts: {
      cartesia: 0.01 / 1000,        // per char
      playht: 0.015 / 1000,         // per char
      openai: 0.015 / 1000,         // per char
      elevenlabs: 0.30 / 1000       // per char (expensive!)
    }
  };

  constructor() {
    super();
    logger.info('🎙️ Real-Time Voice Streaming Service initialized');
  }

  // Create new streaming session
  createSession(config: VoiceStreamConfig): VoiceStreamSession {
    const session = new VoiceStreamSession(config, this.costs);
    this.sessions.set(config.sessionId, session);
    
    // Forward events
    session.on('transcription', (result) => {
      this.emit('transcription', { sessionId: config.sessionId, result });
    });
    
    session.on('audio', (chunk) => {
      this.emit('audio', { sessionId: config.sessionId, chunk });
    });
    
    session.on('metrics', (metrics) => {
      this.emit('metrics', metrics);
    });
    
    session.on('error', (error) => {
      this.emit('error', { sessionId: config.sessionId, error });
    });
    
    logger.info(`✅ Created voice streaming session: ${config.sessionId}`);
    return session;
  }

  // Get session
  getSession(sessionId: string): VoiceStreamSession | undefined {
    return this.sessions.get(sessionId);
  }

  // Close session
  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.close();
      this.sessions.delete(sessionId);
      logger.info(`🔴 Closed voice streaming session: ${sessionId}`);
    }
  }

  // Get all metrics
  getAllMetrics(): StreamMetrics[] {
    return Array.from(this.sessions.values()).map(s => s.getMetrics());
  }

  // Auto-select provider based on cost mode
  selectProvider(type: 'stt' | 'tts', costMode: 'economy' | 'balanced' | 'premium'): string {
    if (type === 'stt') {
      switch (costMode) {
        case 'economy': return 'assemblyai';  // Cheapest
        case 'balanced': return 'deepgram';   // Good balance
        case 'premium': return 'openai';      // Best quality
        default: return 'deepgram';
      }
    } else {
      switch (costMode) {
        case 'economy': return 'cartesia';    // 70% cheaper than ElevenLabs
        case 'balanced': return 'playht';     // Mid-tier
        case 'premium': return 'elevenlabs';  // Highest quality
        default: return 'cartesia';
      }
    }
  }
}

// ==================== Voice Stream Session ====================

class VoiceStreamSession extends EventEmitter {
  private config: VoiceStreamConfig;
  private costs: ProviderCosts;
  private ws?: WebSocket;
  private sttConnection?: any;
  private ttsConnection?: any;
  private metrics: StreamMetrics;
  private audioBuffer: Buffer[] = [];
  private lastActivityTime: number = Date.now();

  constructor(config: VoiceStreamConfig, costs: ProviderCosts) {
    super();
    this.config = config;
    this.costs = costs;
    this.metrics = {
      sessionId: config.sessionId,
      audioReceived: 0,
      audioSent: 0,
      transcriptionTime: 0,
      synthesisTime: 0,
      latency: 0,
      costEstimate: 0,
      providerUsed: {
        stt: config.sttProvider === 'auto' ? 'deepgram' : config.sttProvider,
        tts: config.ttsProvider === 'auto' ? 'cartesia' : config.ttsProvider
      }
    };
  }

  // Connect WebSocket for real-time streaming
  connectWebSocket(ws: WebSocket): void {
    this.ws = ws;
    
    ws.on('message', async (data: Buffer) => {
      this.lastActivityTime = Date.now();
      this.metrics.audioReceived += data.length;
      
      // Process audio chunk
      await this.processAudioChunk({
        id: `chunk-${Date.now()}`,
        data,
        timestamp: Date.now(),
        sampleRate: 16000,
        channels: 1,
        format: 'pcm'
      });
    });

    ws.on('close', () => {
      this.close();
    });

    ws.on('error', (error) => {
      this.emit('error', error);
    });

    logger.info(`🔌 WebSocket connected for session: ${this.config.sessionId}`);
  }

  // Process incoming audio chunk
  private async processAudioChunk(chunk: AudioChunk): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Step 1: Speech-to-Text
      const transcription = await this.transcribeAudio(chunk);
      
      if (transcription && transcription.text.trim().length > 0) {
        this.emit('transcription', transcription);
        
        // Step 2: If final transcription, calculate cost
        if (transcription.isFinal) {
          const duration = (Date.now() - chunk.timestamp) / 1000; // seconds
          const sttCost = duration * this.costs.stt[this.metrics.providerUsed.stt as keyof typeof this.costs.stt];
          this.metrics.costEstimate += sttCost;
        }
      }
      
      this.metrics.transcriptionTime = Date.now() - startTime;
      this.metrics.latency = Date.now() - chunk.timestamp;
      
    } catch (error: any) {
      logger.error('Error processing audio chunk:', error);
      this.emit('error', error);
    }
  }

  // Speech-to-Text transcription
  private async transcribeAudio(chunk: AudioChunk): Promise<TranscriptionResult | null> {
    const provider = this.metrics.providerUsed.stt;
    
    try {
      switch (provider) {
        case 'deepgram':
          return await this.transcribeWithDeepgram(chunk);
        case 'assemblyai':
          return await this.transcribeWithAssemblyAI(chunk);
        case 'openai':
          return await this.transcribeWithOpenAI(chunk);
        default:
          throw new Error(`Unknown STT provider: ${provider}`);
      }
    } catch (error: any) {
      logger.error(`STT error with ${provider}:`, error);
      // Auto-fallback to next provider
      return this.fallbackTranscription(chunk);
    }
  }

  // Deepgram STT (Recommended - good balance)
  private async transcribeWithDeepgram(chunk: AudioChunk): Promise<TranscriptionResult | null> {
    // Placeholder - would use @deepgram/sdk in production
    // This demonstrates the integration pattern
    return {
      id: `trans-${Date.now()}`,
      text: '',
      confidence: 0.95,
      isFinal: false,
      timestamp: Date.now()
    };
  }

  // AssemblyAI STT (Cheapest option)
  private async transcribeWithAssemblyAI(chunk: AudioChunk): Promise<TranscriptionResult | null> {
    // Placeholder - would use assemblyai SDK in production
    return {
      id: `trans-${Date.now()}`,
      text: '',
      confidence: 0.92,
      isFinal: false,
      timestamp: Date.now()
    };
  }

  // OpenAI Whisper STT (Premium quality)
  private async transcribeWithOpenAI(chunk: AudioChunk): Promise<TranscriptionResult | null> {
    // Placeholder - would use OpenAI SDK in production
    return {
      id: `trans-${Date.now()}`,
      text: '',
      confidence: 0.98,
      isFinal: true,
      timestamp: Date.now()
    };
  }

  // Fallback transcription if primary fails
  private async fallbackTranscription(chunk: AudioChunk): Promise<TranscriptionResult | null> {
    logger.warn(`🔄 Falling back to alternative STT provider from ${this.metrics.providerUsed.stt}`);
    // Try alternative providers in order
    const alternatives: Array<keyof typeof this.costs.stt> = ['deepgram', 'assemblyai', 'openai'];
    const originalProvider = this.metrics.providerUsed.stt;
    
    for (const provider of alternatives) {
      if (provider !== originalProvider) {
        try {
          logger.info(`🔄 Trying fallback STT provider: ${provider}`);
          this.metrics.providerUsed.stt = provider;
          
          // Actually try the provider
          const result = await this.transcribeAudio(chunk);
          if (result) {
            logger.info(`✅ Fallback succeeded with ${provider}`);
            return result;
          }
        } catch (error: any) {
          logger.warn(`❌ Fallback ${provider} failed:`, error);
          continue;
        }
      }
    }
    
    // Restore original provider if all fallbacks fail
    this.metrics.providerUsed.stt = originalProvider;
    logger.error(`❌ All STT fallback providers failed`);
    return null;
  }

  // Text-to-Speech synthesis
  async synthesizeResponse(text: string): Promise<AudioChunk> {
    const startTime = Date.now();
    const provider = this.metrics.providerUsed.tts;
    
    try {
      let audioData: Buffer;
      
      switch (provider) {
        case 'cartesia':
          audioData = await this.synthesizeWithCartesia(text);
          break;
        case 'playht':
          audioData = await this.synthesizeWithPlayHT(text);
          break;
        case 'openai':
          audioData = await this.synthesizeWithOpenAI(text);
          break;
        case 'elevenlabs':
          audioData = await this.synthesizeWithElevenLabs(text);
          break;
        default:
          throw new Error(`Unknown TTS provider: ${provider}`);
      }
      
      // Calculate cost
      const ttsCost = text.length * this.costs.tts[provider as keyof typeof this.costs.tts];
      this.metrics.costEstimate += ttsCost;
      this.metrics.synthesisTime = Date.now() - startTime;
      this.metrics.audioSent += audioData.length;
      
      const chunk: AudioChunk = {
        id: `audio-${Date.now()}`,
        data: audioData,
        timestamp: Date.now(),
        sampleRate: 24000,
        channels: 1,
        format: 'opus'
      };
      
      // Send via WebSocket
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(audioData);
      }
      
      this.emit('audio', chunk);
      return chunk;
      
    } catch (error: any) {
      logger.error(`TTS error with ${provider}:`, error);
      throw error;
    }
  }

  // Cartesia TTS (70% cheaper than ElevenLabs!)
  private async synthesizeWithCartesia(text: string): Promise<Buffer> {
    // Placeholder - would use @cartesia/cartesia-js in production
    // Cartesia offers ultra-low latency at $0.01/1k chars vs ElevenLabs $0.30/1k
    return Buffer.from(text); // Mock audio data
  }

  // PlayHT TTS (Mid-tier pricing)
  private async synthesizeWithPlayHT(text: string): Promise<Buffer> {
    // Placeholder - would use playht SDK in production
    return Buffer.from(text); // Mock audio data
  }

  // OpenAI TTS (Good quality, reasonable price)
  private async synthesizeWithOpenAI(text: string): Promise<Buffer> {
    // Placeholder - would use OpenAI SDK in production
    return Buffer.from(text); // Mock audio data
  }

  // ElevenLabs TTS (Premium, expensive)
  private async synthesizeWithElevenLabs(text: string): Promise<Buffer> {
    // Placeholder - would use existing voice-synthesis-engine
    return Buffer.from(text); // Mock audio data
  }

  // Handle interruption (user starts speaking)
  handleInterruption(): void {
    if (this.config.enableInterruption) {
      // Cancel ongoing TTS
      logger.info(`⏸️ Interruption detected, stopping TTS`);
      this.emit('interrupted');
    }
  }

  // Get session metrics
  getMetrics(): StreamMetrics {
    return {
      ...this.metrics,
      latency: Date.now() - this.lastActivityTime
    };
  }

  // Close session
  async close(): Promise<void> {
    if (this.ws) {
      this.ws.close();
    }
    if (this.sttConnection) {
      // Close STT connection
    }
    if (this.ttsConnection) {
      // Close TTS connection
    }
    
    this.emit('metrics', this.getMetrics());
    this.removeAllListeners();
    
    logger.info(`📊 Session ${this.config.sessionId} metrics:`, {
      duration: (Date.now() - this.lastActivityTime) / 1000,
      cost: `$${this.metrics.costEstimate.toFixed(4)}`,
      providers: this.metrics.providerUsed
    });
  }
}

// ==================== Cost Comparison Report ====================

export interface CostComparison {
  provider: string;
  costPer1000Chars: number;
  costPer10MinSession: number;
  savingsVsElevenLabs: string;
}

export function generateCostReport(): CostComparison[] {
  const avgCharsPerMin = 150; // ~150 chars spoken per minute
  const sessionMinutes = 10;
  const totalChars = avgCharsPerMin * sessionMinutes;

  const providers = [
    { name: 'Cartesia', cost: 0.01 },
    { name: 'PlayHT', cost: 0.015 },
    { name: 'OpenAI TTS', cost: 0.015 },
    { name: 'ElevenLabs', cost: 0.30 }
  ];

  const elevenLabsCost = (providers[3].cost / 1000) * totalChars;

  return providers.map(p => {
    const sessionCost = (p.cost / 1000) * totalChars;
    const savings = ((elevenLabsCost - sessionCost) / elevenLabsCost * 100).toFixed(1);
    
    return {
      provider: p.name,
      costPer1000Chars: p.cost,
      costPer10MinSession: sessionCost,
      savingsVsElevenLabs: p.name === 'ElevenLabs' ? 'baseline' : `${savings}% savings`
    };
  });
}

// ==================== Export ====================

export const realtimeVoiceService = new RealtimeVoiceStreamingService();
