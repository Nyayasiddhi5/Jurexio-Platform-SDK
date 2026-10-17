/**
 * @jurexio/client-sdk-react-native
 * v5.0.0 — companion to @jurexio/client-sdk@^5.0.0
 */

export { JrxClientRN, type JrxClientRNCreateOptions } from './JrxClientRN.js';
export {
  createSecureStorage,
  JrxStorageKeys,
  type JrxSecureStorage,
  type JrxStorageOptions,
} from './storage.js';
export {
  JrxRNStreamReader,
  type JrxRNStreamOptions,
  type JrxRNStreamReaderConfig,
} from './sse.js';
export {
  requestCameraPermission,
  requestMicrophonePermission,
  requestMediaLibraryPermission,
  requestPushNotificationPermission,
  requestStandardSdkPermissions,
  type JrxPermissionResult,
} from './permissions.js';
export {
  registerForHITLPushNotifications,
  type HITLPushPayload,
  type HITLRegistration,
  type RegisterHITLOptions,
} from './push.js';

// Re-export the underlying client + types so consumers only import this package.
export {
  JrxClient,
  JrxError,
  JrxStreamReader,
  type JrxClientConfig,
  type JrxHttpClient,
  type JrxJurisdiction,
  type JrxPlatform,
  type JrxAgentPattern,
  type JrxRiskLevel,
  type JrxPatternResponse,
  type JrxCitation,
  type JrxStreamHandlers,
  type JrxStreamEvent,
  type JrxApiError,
} from '@jurexio/client-sdk';
