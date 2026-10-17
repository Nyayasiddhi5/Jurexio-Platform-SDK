import ffmpeg from 'fluent-ffmpeg';
import { VideoScript } from './video-script-generator.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('video-assembler');

export class VideoAssembler {
  async assembleVideo(
    script: VideoScript,
    videoClips: string[],
    voiceoverFiles: string[],
    backgroundMusic: string,
    outputPath: string
  ): Promise<void> {
    // Validate counts match
    if (videoClips.length !== voiceoverFiles.length || videoClips.length !== script.scenes.length) {
      throw new Error(
        `Clip/voiceover/scene count mismatch: ${videoClips.length} clips, ${voiceoverFiles.length} voiceovers, ${script.scenes.length} scenes`
      );
    }

    return new Promise((resolve, reject) => {
      const command = ffmpeg();

      // Add all inputs in order: videos, then voiceovers, then music
      videoClips.forEach((clip) => command.input(clip));
      voiceoverFiles.forEach((voice) => command.input(voice));
      command.input(backgroundMusic);

      // Build filter complex with proper timing alignment
      const filterComplex = this.buildFilterComplex(
        videoClips.length,
        voiceoverFiles.length,
        script
      );

      command
        .complexFilter(filterComplex)
        .outputOptions([
          '-map [vout]',
          '-map [aout]',
          '-c:v libx264',
          '-preset slow',
          '-crf 18',
          '-c:a aac',
          '-b:a 192k',
          '-movflags +faststart',
        ])
        .output(outputPath)
        .on('start', (cmd) => {
          logger.info('🎬 FFmpeg command (truncated):', cmd.substring(0, 500) + '...');
        })
        .on('progress', (progress) => {
          logger.info(`⏳ Processing: ${progress.percent?.toFixed(1)}%`);
        })
        .on('end', () => {
          logger.info('✅ Video assembly complete!');
          resolve();
        })
        .on('error', (err) => {
          logger.error('❌ FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }

  private buildFilterComplex(
    videoCount: number,
    audioCount: number,
    script: VideoScript
  ): string[] {
    const filters: string[] = [];
    
    // Step 1: Trim each video clip to exact scene duration and pair with voiceover
    script.scenes.forEach((scene, i) => {
      const videoInput = `[${i}:v]`;
      const audioInput = `[${videoCount + i}:a]`;
      
      // Trim video to exact duration
      filters.push(`${videoInput}trim=duration=${scene.duration},setpts=PTS-STARTPTS[v${i}]`);
      
      // Ensure voiceover doesn't exceed scene duration
      filters.push(`${audioInput}atrim=duration=${scene.duration},asetpts=PTS-STARTPTS[a${i}]`);
    });

    // Step 2: Concatenate all trimmed videos
    const videoInputs = script.scenes.map((_, i) => `[v${i}]`).join('');
    filters.push(`${videoInputs}concat=n=${videoCount}:v=1:a=0[vconcat]`);

    // Step 3: Concatenate all voiceovers
    const audioInputs = script.scenes.map((_, i) => `[a${i}]`).join('');
    filters.push(`${audioInputs}concat=n=${audioCount}:v=0:a=1[voice]`);

    // Step 4: Loop background music to match total duration
    const totalDuration = script.totalDuration;
    const musicInput = `[${videoCount + audioCount}:a]`;
    filters.push(`${musicInput}aloop=loop=-1:size=2e9,atrim=duration=${totalDuration},volume=0.15[music]`);

    // Step 5: Mix voiceover + background music
    filters.push('[voice][music]amix=inputs=2:duration=first:dropout_transition=0[aout]');

    // Step 6: Add fade in/out to final video
    const fadeOutStart = totalDuration - 2;
    filters.push(`[vconcat]fade=t=in:st=0:d=1,fade=t=out:st=${fadeOutStart}:d=2[vout]`);

    return filters;
  }

  async createSimpleVideo(
    videoClip: string,
    voiceover: string,
    outputPath: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoClip)
        .input(voiceover)
        .outputOptions([
          '-c:v libx264',
          '-preset fast',
          '-crf 23',
          '-c:a aac',
          '-b:a 192k',
          '-shortest',
        ])
        .output(outputPath)
        .on('end', () => {
          logger.info(`✅ Simple video created: ${outputPath}`);
          resolve();
        })
        .on('error', (err) => {
          logger.error('❌ FFmpeg error:', err);
          reject(err);
        })
        .run();
    });
  }
}
