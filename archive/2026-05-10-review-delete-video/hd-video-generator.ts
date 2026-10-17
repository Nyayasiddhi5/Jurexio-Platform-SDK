/**
 * HD Video Generator using Kie.ai (Veo 3) & Kling.ai
 * Professional-grade video generation with cinematic quality
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('hd-video-generator');

interface VideoGenerationRequest {
  prompt: string;
  duration: number;
  resolution: '1080p' | '4k';
  style: 'cinematic' | 'corporate' | 'tech' | 'modern';
  aspectRatio: '16:9' | '9:16' | '1:1';
}

interface VideoScene {
  sceneNumber: number;
  title: string;
  description: string;
  visualPrompt: string;
  duration: number;
  typography: {
    title: string;
    bullets: string[];
  };
}

export class HDVideoGenerator {
  private kieApiKey: string;
  private kieApiUrl: string = 'https://api.kie.ai/v1/video/generate';

  constructor() {
    this.kieApiKey = process.env.KIE_AI_API_KEY || '';
    if (!this.kieApiKey) {
      logger.warn('⚠️  KIE_AI_API_KEY not found. HD video generation will be limited.');
    }
  }

  /**
   * Generate professional video prompt for Veo 3
   */
  private createCinematicPrompt(scene: VideoScene): string {
    const styleGuides = {
      corporate: 'Professional corporate setting, clean modern design, elegant typography overlays',
      tech: 'Futuristic technology backdrop, holographic UI elements, sleek digital aesthetics',
      cinematic: 'Cinematic lighting, dramatic composition, professional color grading',
      modern: 'Contemporary minimalist design, sophisticated visual elements, premium quality'
    };

    return `
Ultra high-definition professional video scene:
${scene.visualPrompt}

Style: ${styleGuides.tech}
Lighting: Cinematic with soft key light, subtle rim lighting
Camera: Slow smooth tracking shot, professional stabilization
Typography: Modern sans-serif font overlays with elegant animations
Color Palette: Purple gradient (#7c3aed to #a78bfa), white text, dark backgrounds
Quality: 4K resolution, 30fps, perfect clarity
Duration: ${scene.duration} seconds

Text Overlays to Display:
TITLE: "${scene.title}" (Large, bold, purple color #7c3aed)
${scene.typography.bullets.map((b, i) => `BULLET ${i + 1}: "${b}" (Medium, white, fade in sequentially)`).join('\n')}

Technical Requirements:
- Sharp, crystal-clear text rendering
- Smooth text animations (fade in, subtle slide)
- Professional depth of field
- Motion blur for cinematic feel
- Perfect exposure and color accuracy
`.trim();
  }

  /**
   * Generate HD video using Kie.ai Veo 3
   */
  async generateWithKieAI(scene: VideoScene): Promise<string> {
    try {
      const prompt = this.createCinematicPrompt(scene);
      
      logger.info(`🎬 Generating HD video for Scene ${scene.sceneNumber}: ${scene.title}`);
      logger.info(`   Using Kie.ai Veo 3 model...`);

      const response = await axios.post(
        this.kieApiUrl,
        {
          prompt: prompt,
          model: 'veo-3',  // Latest Veo 3 model
          duration: scene.duration,
          resolution: '1080p',
          aspect_ratio: '16:9',
          quality: 'ultra',
          fps: 30,
          enhance_text: true,  // AI text enhancement for clarity
          style_consistency: 0.95  // High consistency
        },
        {
          headers: {
            'Authorization': `Bearer ${this.kieApiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 300000  // 5 minute timeout for HD generation
        }
      );

      if (response.data.status === 'success') {
        const videoUrl = response.data.video_url;
        const outputPath = `video-assets/hd-scenes/scene-${scene.sceneNumber}.mp4`;
        
        // Download generated video
        await this.downloadVideo(videoUrl, outputPath);
        logger.info(`   ✅ HD video generated: ${outputPath}`);
        
        return outputPath;
      } else {
        throw new Error(`Kie.ai generation failed: ${response.data.message}`);
      }

    } catch (error: any) {
      logger.error(`   ❌ Kie.ai error: ${error.message}`);
      
      // Fallback to Kling.ai if Kie.ai fails
      logger.info(`   🔄 Falling back to Kling.ai...`);
      return await this.generateWithKlingAI(scene);
    }
  }

  /**
   * Fallback: Generate using Kling.ai
   */
  private async generateWithKlingAI(scene: VideoScene): Promise<string> {
    try {
      const prompt = this.createCinematicPrompt(scene);
      
      const response = await axios.post(
        'https://api.kling.ai/v1/video/generate',
        {
          prompt: prompt,
          duration: scene.duration,
          quality: 'professional',
          resolution: '1920x1080'
        },
        {
          headers: {
            'Authorization': `Bearer ${process.env.KLING_AI_API_KEY || ''}`,
            'Content-Type': 'application/json'
          },
          timeout: 300000
        }
      );

      if (response.data.video_url) {
        const outputPath = `video-assets/hd-scenes/scene-${scene.sceneNumber}.mp4`;
        await this.downloadVideo(response.data.video_url, outputPath);
        logger.info(`   ✅ Kling.ai video generated: ${outputPath}`);
        return outputPath;
      }

      throw new Error('Kling.ai generation failed');

    } catch (error: any) {
      logger.error(`   ❌ Kling.ai error: ${error.message}`);
      throw new Error('All video generation services failed');
    }
  }

  /**
   * Download video from URL
   */
  private async downloadVideo(url: string, outputPath: string): Promise<void> {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const response = await axios.get(url, { responseType: 'stream' });
    const writer = fs.createWriteStream(outputPath);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });
  }

  /**
   * Generate complete HD investor video
   */
  async generateInvestorVideo(scenes: VideoScene[]): Promise<string[]> {
    logger.info('🎬 HD VIDEO GENERATION - Professional Quality');
    logger.info('='.repeat(60));
    logger.info(`📊 Total Scenes: ${scenes.length}`);
    logger.info(`🎨 Resolution: 1920x1080 (Full HD)`);
    logger.info(`🎭 Model: Kie.ai Veo 3 (fallback: Kling.ai)`);
    logger.info('='.repeat(60) + '\n');

    const videoPaths: string[] = [];

    for (const scene of scenes) {
      try {
        const videoPath = await this.generateWithKieAI(scene);
        videoPaths.push(videoPath);
      } catch (error: any) {
        logger.error(`❌ Failed to generate scene ${scene.sceneNumber}: ${error.message}`);
        // Continue with other scenes
      }
    }

    logger.info(`\n✅ Generated ${videoPaths.length}/${scenes.length} HD scenes successfully!`);
    return videoPaths;
  }
}

export default HDVideoGenerator;
