/**
 * @jurexio/jurexio-citizen-sdk
 * v5.0.0 — companion to @jurexio/client-sdk@^5.0.0
 */

export { Jurexio CitizenClient } from './Jurexio CitizenClient.js';

export type {
  Jurexio CitizenClientConfig,
  Jurexio CitizenLanguage,
  Jurexio CitizenJurisdiction,
  MitraChatMessage,
  MitraChatRequest,
  MitraChatResponse,
  ClauseClassification,
  ClauseClassifyRequest,
  ClauseClassifyResponse,
  ClauseRiskLevel,
  CaseBriefIntake,
  CaseBriefStep,
  CaseBriefResponse,
} from './types.js';

export {
  NYAYAMITRA_LANGUAGES,
  NYAYAMITRA_LANGUAGE_LIST,
  NYAYAMITRA_UI_STRINGS,
  detectLanguage,
  isRTL,
  localeFor,
  t,
  type Jurexio CitizenLanguageInfo,
  type NymUiKey,
} from './indic.js';

export {
  OfflineDraftQueue,
  NYM_OFFLINE_DRAFTS_KEY,
  type OfflineDraft,
  type OfflineDraftEnvelope,
  type OfflineDraftStore,
  type OfflineDraftQueueOptions,
} from './offline.js';
