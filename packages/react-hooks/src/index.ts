/**
 * @jurexio/react-hooks v3.1.2
 * React hooks for Jurexio Enterprise Platform legal AI integration.
 *
 * Hooks:
 *   useNyvClient            — client configuration and auth headers
 *   usePatternStream        — SSE streaming for all 22 AI patterns
 *   useCredits              — credit wallet management
 *   useGovernanceBadge      — AI risk score and badge computation
 *   useJurisdiction         — multi-jurisdiction context (IN/UK/US/EU/GC/SG)
 *   useAuditLog             — audit trail access and chain verification
 *   useIntelligence         — precedent search, regulatory digest, contract analysis
 *   useAgentTesting         — oracle, adversarial, LLM judge testing
 *   useCompliance           — EU AI Act, bias audit, watermark, digital signing
 *   useConflictDetector     — conflict of interest detection
 *   useAmendmentImpact      — amendment impact analysis
 *   useTemplateAssistant    — legal template management and fill sessions
 *   useTimeline             — limitation periods and procedural checklists
 *   useForensicVerifier     — document forensic verification
 *   useRegulatoryFeed       — real-time regulatory feed
 *   usePrecedentSimilarity  — precedent similarity search
 */

export { useNyvClient } from './useNyvClient.js';
export type { NyvClientConfig, UseNyvClientReturn } from './useNyvClient.js';

export { usePatternStream } from './usePatternStream.js';
export type { NyvPatternKey, PatternStreamOptions, GovernanceData, UsePatternStreamReturn } from './usePatternStream.js';

export { useCredits } from './useCredits.js';
export type { CreditWallet, CreditTransaction, UseCreditsOptions, UseCreditsReturn } from './useCredits.js';

export { useGovernanceBadge } from './useGovernanceBadge.js';
export type { RiskBadge, GovernanceBadgeData, UseGovernanceBadgeOptions } from './useGovernanceBadge.js';

export { useJurisdiction } from './useJurisdiction.js';
export type { JurisdictionInfo, UseJurisdictionReturn } from './useJurisdiction.js';

export { useAuditLog } from './useAuditLog.js';
export type { AuditEntry, UseAuditLogOptions, UseAuditLogReturn } from './useAuditLog.js';

export { useIntelligence } from './useIntelligence.js';
export type { UseIntelligenceReturn } from './useIntelligence.js';

export { useAgentTesting } from './useAgentTesting.js';
export type { UseAgentTestingReturn } from './useAgentTesting.js';

export { useCompliance } from './useCompliance.js';
export type { UseComplianceReturn } from './useCompliance.js';

export { useConflictDetector } from './useConflictDetector.js';
export type { UseConflictDetectorReturn } from './useConflictDetector.js';

export { useAmendmentImpact } from './useAmendmentImpact.js';
export type { UseAmendmentImpactReturn } from './useAmendmentImpact.js';

export { useTemplateAssistant } from './useTemplateAssistant.js';
export type { UseTemplateAssistantReturn } from './useTemplateAssistant.js';

export { useTimeline } from './useTimeline.js';
export type { UseTimelineReturn } from './useTimeline.js';

export { useForensicVerifier } from './useForensicVerifier.js';
export type { UseForensicVerifierReturn } from './useForensicVerifier.js';

export { useRegulatoryFeed } from './useRegulatoryFeed.js';
export type { UseRegulatoryFeedReturn } from './useRegulatoryFeed.js';

export { usePrecedentSimilarity } from './usePrecedentSimilarity.js';
export type { UsePrecedentSimilarityReturn } from './usePrecedentSimilarity.js';
