/**
 * @jurexio/client-sdk — Jurexio Enterprise Platform 312 Official TypeScript SDK
 *
 * QUICK START:
 *   import { JrxClient } from '@jurexio/client-sdk';
 *
 *   const nyv = new JrxClient({
 *     apiKey: 'nyv_live_sk_your_api_key',
 *     baseUrl: 'https://api.jurexio.example',
 *   });
 *
 *   // Ask a legal question (P11 NyayaRAG)
 *   const answer = await nyv.ask('Explain BNS 2023 Section 103 (murder) with relevant case law');
 *
 *   // Run a specific pattern (P21 GRPO)
 *   const grpo = await nyv.patterns.grpo({ task: '...', advocateScores: { legalAccuracy: 9, ... } });
 *
 *   // Stream a pattern execution with AG-UI events
 *   await nyv.stream.streamPattern('cot', { task: '...' }, {
 *     onThinking: (step, i, total) => console.log(`Step ${i}/${total}: ${step}`),
 *     onTextDelta: (delta) => process.stdout.write(delta),
 *     onComplete: (result) => console.log('Done:', result.traceId),
 *   });
 *
 *   // Upload a legal document for RAG indexing
 *   const { docId } = await nyv.documents.uploadFormData(file, { fileName: 'contract.pdf' });
 *   const status = await nyv.documents.waitForCompletion(docId);
 *
 *   // Create and simulate a digital twin
 *   const twin = await nyv.twins.create({ name: 'Senior Partner AI', persona: 'managing-partner', jurisdiction: 'IN', expertise: 'M&A' });
 *   const sim = await nyv.twins.simulate({ twinId: twin.twinId, scenario: 'hostile-takeover', task: 'What is our legal strategy?' });
 *
 * PLATFORM: Jurexio 312 | India / UK / USA / GC / EU / SG
 * VERSION: 5.0.0
 */

export { JrxClient, JrxClient as JrxClient, JrxClient as JurexioClient } from './JrxClient.js';
export type { JrxHttpClient, JrxHttpClient as JrxHttpClient } from './JrxClient.js';
export { JrxStreamReader } from './JrxStreamReader.js';

export { PatternsApi } from './api/PatternsApi.js';
export { DocumentsApi } from './api/DocumentsApi.js';
export { AgentsApi } from './api/AgentsApi.js';
export { SkillsApi } from './api/SkillsApi.js';
export { TwinApi } from './api/TwinApi.js';
export { KnowledgeApi } from './api/KnowledgeApi.js';
export { InstantSearchApi } from './api/InstantSearchApi.js';
export type { InstantSearchOptions } from './api/InstantSearchApi.js';
export { TemplatesApi } from './api/TemplatesApi.js';
export type {
  NspLegalTemplate,
  NspTemplateVariable,
  TemplatesCatalogResponse,
  TemplatesListParams,
  TemplateApprovalStatus,
  TemplateSmeRubric,
} from './api/TemplatesApi.js';
export { LegalWorkApi } from './api/LegalWorkApi.js';
export { MatterVaultApi } from './api/MatterVaultApi.js';
export { VoiceApi } from './api/VoiceApi.js';
export { IntelligenceApi } from './api/IntelligenceApi.js';
export { TestingApi } from './api/TestingApi.js';
export { ComplianceApi } from './api/ComplianceApi.js';
export { NyayaToolsApi } from './api/NyayaToolsApi.js';
export { MemoryApi } from './api/MemoryApi.js';
export { CacheApi } from './api/CacheApi.js';
export { CreditsApi } from './api/CreditsApi.js';
export { OrchApi } from './api/OrchApi.js';
export { WorkflowsApi } from './api/WorkflowsApi.js';
export { DocAiApi } from './api/DocAiApi.js';
export { GovApi } from './api/GovApi.js';
export { LegalPipelineApi } from './api/LegalPipelineApi.js';
export { ComplianceNv5Api } from './api/ComplianceNv5Api.js';
export { InternalApi } from './api/InternalApi.js';
export { RagApi } from './api/RagApi.js';
export { ModelsApi } from './api/ModelsApi.js';
export { McpApi } from './api/McpApi.js';
export { CotApi } from './api/CotApi.js';
export { ConnectorsApi } from './api/ConnectorsApi.js';
export { EcosystemDocumentsApi } from './api/EcosystemDocumentsApi.js';
export { CnrApi } from './api/CnrApi.js';
export type {
  CnrAdvocateEntry,
  CnrResolveOptions,
  CnrResolveData,
  CnrResolveMeta,
  CnrResolveResponse,
  CnrFieldValue,
  CnrDocument,
  CnrCandidate,
  CnrTimelineEntry,
} from './api/CnrApi.js';
export { PatraMitraApi } from './api/PatraMitraApi.js';
export type {
  PatraMitraHealthData,
  PatraMitraSessionSummary,
  PatraMitraCreateSessionInput,
  PatraMitraChatInput,
  PatraMitraToolInput,
} from './api/PatraMitraApi.js';
export { UsageApi } from './api/UsageApi.js';
export { OrchestrateApi } from './api/OrchestrateApi.js';
export { GatewayApi } from './api/GatewayApi.js';
export { PartnerIntelligenceApi } from './api/PartnerIntelligenceApi.js';
export { DocsPipelineApi } from './api/DocsPipelineApi.js';
export { DocparseApi } from './api/DocparseApi.js';
export type {
  DocparseJobSubmitBody,
  DocparseJobAccepted,
  DocparseJobStatusResponse,
  DomainPackCatalogEntry,
  PartnerDocparseMeta,
} from './api/DocparseApi.js';
export { LlmRouterApi } from './api/LlmRouterApi.js';
export { CamApi } from './api/CamApi.js';
export { SwarmApi } from './api/SwarmApi.js';
export { LegalSdkApi } from './api/LegalSdkApi.js';
export type { OrchestrateRequest, OrchestrateResult } from './api/OrchestrateApi.js';
export type { ClassifyDocumentRequest } from './api/PartnerIntelligenceApi.js';
export type { CaseAnalysisRequest } from './api/LegalSdkApi.js';
export { verifyWebhookSignature } from './utils/verifyWebhookSignature.js';
export type { VerifyWebhookSignatureInput } from './utils/verifyWebhookSignature.js';
export {
  assertSdkMethodSignature,
  mapReviewEnvelope,
  guardDocumentTextForReview,
  isDocumentTextPendingOrEmpty,
  isSdkSignatureExempt,
  normalizeAgentId,
  NvSdkPolicyViolationError,
  NV_REVIEW_ENVELOPE_METHODS,
  NV_AGENT_EXECUTE_ENVELOPE_METHODS,
  NV_SDK_SIGNATURE_EXEMPT_PATHS,
  NV_AGENT_ID_ALIASES,
} from './utils/sdkMethodSignatureGuard.js';

/** NSP legacy import alias — same as JrxClient */
export { JrxClient as NvSdkClient } from './JrxClient.js';

export type {
  JrxClientConfig,
  JrxJurisdiction,
  JrxPlatform,
  JrxAgentPattern,
  JrxRiskLevel,
  JrxBasePatternRequest,
  JrxPatternResponse,
  JrxCitation,
  JrxRiskAssessment,
  ReActRequest,
  ToTRequest,
  GRPORequest,
  DigitalTwinRequest,
  JrxDocumentUploadResponse,
  JrxDocumentStatus,
  JrxDocumentSearchResult,
  JrxDocumentChunk,
  JrxDocumentAnalysis,
  JrxAgent,
  JrxAgentExecution,
  JrxSkill,
  JrxSkillExecution,
  JrxDigitalTwin,
  JrxTwinSimulationResult,
  JrxKnowledgeSearchRequest,
  JrxKnowledgeSearchResponse,
  JrxVoiceSynthesisRequest,
  JrxVoiceSynthesisResponse,
  JrxVoiceTranscriptionResponse,
  JrxStreamEventType,
  JrxStreamEvent,
  JrxStreamHandlers,
  JrxPatternSpecializedEvent,
  JrxApiError,
  JrxListResponse,
  JrxPaginationOptions,
  JrxGraphTraversalInput,
  JrxGraphNode,
  JrxGraphEdge,
  JrxGraphTraversalResult,
  JrxCitationCheckResult,
  JrxLegalDiffResult,
  JrxTemplateListItem,
  JrxTemplateGenerateResult,
  JrxTemplateFillSession,
  JrxLimitationResult,
  JrxChecklistItem,
  JrxForensicVerifyResult,
  JrxAuditTrailEntry,
  JrxEDiscoveryResult,
  JrxGazetteProcessResult,
  JrxAffectedMattersResult,
  JrxConflictDetectResult,
  JrxAmendmentImpactResult,
  JrxStatuteHistoryResult,
  JrxLitigationRiskResult,
  JrxMatterMemory,
  JrxClientMemory,
  JrxSlmAvailability,
  JrxCacheEntry,
  JrxCacheStats,
  JrxCreditWallet,
  JrxCreditTransaction,
  JrxEuComplianceReport,
  JrxBiasAuditReport,
  JrxWatermarkResult,
  JrxSigningSession,
  JrxOracleTestReport,
  JrxAdversarialTestReport,
  JrxLlmJudgeResult,
  JrxAgentScorecard,
  JrxLegalDomain,
  JrxPrecedentSearchResult,
  JrxRegulatoryDigest,
  JrxComplianceCalendar,
  JrxSecureSession,
  JrxContractAnalysis,
  JrxReadabilityScore,
  JrxLegalNerResult,
} from './types/index.js';

export { JrxError } from './types/index.js';

export type {
  DocumentUploadOptions,
  DocumentSearchOptions,
  DocumentAnalysisOptions,
  RedlineOptions,
  RedlineSegment,
  RedlineResult,
  MergeInputDocument,
  MergeConflict,
  MergeResult,
  HighlightSpan,
  HighlightResult,
} from './api/DocumentsApi.js';

export type {
  AgentRunRequest,
  AgentSkillInstallRequest,
  AgentExecuteType,
  AgentExecuteRequest,
  AgentExecuteResult,
  AgentRunMetrics,
  OrchestrationStrategy,
  AgentOrchestrateRequest,
  AgentOrchestrateResult,
} from './api/AgentsApi.js';

export type {
  RagQueryOptions,
  RagChunk,
  RagQueryResult,
  AutoRetrieveRequest,
  AutoRetrieveResult,
} from './api/RagApi.js';

export type {
  ProviderReadiness,
  ProvidersResponse,
} from './api/ModelsApi.js';

export type {
  McpToolDescriptor,
  McpToolListResponse,
  McpExecutionResult,
} from './api/McpApi.js';

export type {
  UsageSummaryOptions,
  UsageSummary,
  UsageTokens,
} from './api/UsageApi.js';

export type {
  SkillSearchOptions,
  SkillPublishRequest,
} from './api/SkillsApi.js';

export type {
  CreateTwinRequest,
  SimulateRequest,
  TwinChatRequest,
} from './api/TwinApi.js';

export type {
  AddKnowledgeRequest,
  GraphSearchOptions,
} from './api/KnowledgeApi.js';

export type {
  VoiceCommandOptions,
} from './api/VoiceApi.js';

export type {
  PrecedentSearchOptions,
  SecureSessionOptions,
} from './api/IntelligenceApi.js';

export type {
  JrxStreamOptions,
} from './JrxStreamReader.js';

export type {
  LegalParseGuideV1,
  LegalParseGuideEntry,
  LegalParseGuideAutofillHint,
  DocparseIntelligenceV1,
  DocparseMetaPartner,
} from './types/JrxLegalDocparse.js';
export { nspAutofillAction } from './types/JrxLegalDocparse.js';
