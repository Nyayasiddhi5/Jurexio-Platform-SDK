/**
 * Jurexio Enterprise Platform SDK Voice Package — public surface.
 *
 * The TTS / streaming engines are experimental and not part of the production
 * orchestration surface; they are intentionally not re-exported here. Routes
 * that need them must import the specific implementation directly.
 */
export const voicePackageInfo = {
  name: 'nyayavigya-sdk-voice',
  version: '3.1.0',
  services: ['voice-synthesis-engine', 'voiceover-generator', 'realtime-voice-streaming'],
  capabilities: [
    'Text-to-Speech (TTS)',
    'Voice Synthesis',
    'ElevenLabs Integration',
    'Real-time Voice Streaming',
    'Voiceover Generation',
  ],
};
