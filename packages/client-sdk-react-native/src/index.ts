/**
 * @jurexio/client-sdk-react-native
 * v5.0.0 — companion to @jurexio/client-sdk@^5.0.0
 */

export { NyvClientRN, type NyvClientRNCreateOptions } from './NyvClientRN.js';
export {
  createSecureStorage,
  NyvStorageKeys,
  type NyvSecureStorage,
  type NyvStorageOptions,
} from './storage.js';
export {
  NyvRNStreamReader,
  type NyvRNStreamOptions,
  type NyvRNStreamReaderConfig,
} from './sse.js';
export {
  requestCameraPermission,
  requestMicrophonePermission,
  requestMediaLibraryPermission,
  requestPushNotificationPermission,
  requestStandardSdkPermissions,
  type NyvPermissionResult,
} from './permissions.js';
export {
  registerForHITLPushNotifications,
  type HITLPushPayload,
  type HITLRegistration,
  type RegisterHITLOptions,
} from './push.js';

// Re-export the underlying client + types so consumers only import this package.
export {
  NyvClient,
  NyvError,
  NyvStreamReader,
  type NyvClientConfig,
  type NyvHttpClient,
  type NyvJurisdiction,
  type NyvPlatform,
  type NyvAgentPattern,
  type NyvRiskLevel,
  type NyvPatternResponse,
  type NyvCitation,
  type NyvStreamHandlers,
  type NyvStreamEvent,
  type NyvApiError,
} from '@jurexio/client-sdk';
