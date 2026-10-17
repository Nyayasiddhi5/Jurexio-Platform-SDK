import axios from 'axios';
import fs from 'fs';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('voiceover-generator');

// External dependency - VideoScript type
export interface VideoScript { scenes: Array<{ sceneNumber: number; narration: string }>; }

export class VoiceoverGenerator {
  private apiKey: string;
  private baseUrl = 'https://api.elevenlabs.io/v1';

  constructor() {
    this.apiKey = process.env.ELEVENLABS_API_KEY || '';
    if (!this.apiKey) {
      throw new Error('ELEVENLABS_API_KEY not found in environment');
    }
  }

  async generateVoiceover(
    text: string,
    outputPath: string,
    voiceId: string = 'EXAVITQu4vr4xnSDxMaL' // Sarah - professional female voice
  ): Promise<void> {
    const url = `${this.baseUrl}/text-to-speech/${voiceId}`;

    try {
      const response = await axios.post(
        url,
        {
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        },
        {
          headers: {
            'xi-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          responseType: 'arraybuffer',
        }
      );

      fs.writeFileSync(outputPath, response.data);
      logger.info(`✅ Voiceover saved: ${outputPath}`);
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        logger.error('ElevenLabs API Error:', error.response?.data || error.message);
      }
      throw error;
    }
  }

  async generateSceneVoiceovers(script: VideoScript): Promise<string[]> {
    const voiceFiles: string[] = [];

    for (const scene of script.scenes) {
      const filename = `video-assets/voiceover-scene-${scene.sceneNumber}.mp3`;
      
      logger.info(`🎙️ Generating voiceover for Scene ${scene.sceneNumber}...`);
      await this.generateVoiceover(scene.narration, filename);
      
      voiceFiles.push(filename);
    }

    return voiceFiles;
  }

  async listVoices(): Promise<any[]> {
    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: {
          'xi-api-key': this.apiKey,
        },
      });
      return response.data.voices;
    } catch (error: any) {
      logger.error('Failed to fetch voices:', error);
      return [];
    }
  }
}
