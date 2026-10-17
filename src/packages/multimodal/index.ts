/**
 * Jurexio Enterprise Platform SDK Multimodal Package — public surface.
 *
 * The detailed avatar / video / vision implementations live in sibling files
 * but are intentionally NOT re-exported here. They are experimental modules
 * with provider-specific bindings (Unity, ChatDollKit, Three.js) that are
 * not part of the production orchestration surface and have known partial
 * type coverage. Routes that need them must import the specific file directly
 * and accept its contract.
 *
 * This index exposes only the package metadata + a lazy ChatDollKit loader
 * for backward compatibility with the SDK reflection layer.
 */
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('multimodal-index');

let _chatdollkit: { ChatDollKitAvatarService?: unknown } = {};
try {
  const mod: any = await import('./chatdollkit-avatar-service.js');
  _chatdollkit = mod;
} catch (e: any) {
  logger.warn('ChatDollKit avatar service failed to load:', { err: (e as Error).message });
}
export const ChatDollKitAvatarService = _chatdollkit.ChatDollKitAvatarService;

export const multimodalPackageInfo = {
  name: 'jurexio-sdk-multimodal',
  version: '2.0.0',
  services: [
    'advanced-3d-immersive-api',
    'avatar-3d-system',
    'chatdollkit-avatar-service',
    'unity-avatar-service',
    'hd-video-generator',
    'video-assembler',
    'video-script-generator',
    'professional-video-script-generator',
    'computer-vision-api',
    'advanced-multimodal-rag',
    'enhanced-multimodal-service',
  ],
  capabilities: [
    '3D Avatar Generation',
    'Video Generation & Assembly',
    'Computer Vision',
    'Multimodal RAG',
    'Unity Integration',
    'ChatDollKit Integration',
  ],
};
