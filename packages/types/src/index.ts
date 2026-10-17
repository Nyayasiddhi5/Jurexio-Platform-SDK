/**
 * @jurexio/types v3.1.2
 * Jurexio Enterprise Platform 312 — Shared TypeScript Types
 *
 * Canonical type definitions consumed by:
 *  - @jurexio/client-sdk
 *  - @jurexio/enterprise-sdk
 *  - @jurexio/react-hooks
 *  - JRX Gateway API
 *  - All 5 Jurexio platforms
 *  - ROMA L5 agents (1,043)
 */

export type JrxJurisdiction = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';

export type JrxSubscriptionTier =
  | 'free'
  | 'solo'
  | 'plus'
  | 'pro'
  | 'enterprise'
  | 'government'
  | 'internal';

export type JrxTemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';

export type JrxPlatform =
  | 'jurexio-citizen'
  | 'nys-professional'
  | 'nys-institutional'
  | 'nys-academy'
  | 'nys-ministry';

export type JrxPatternKey =
  | 'P01_REACT'
  | 'P02_COT'
  | 'P03_TOT'
  | 'P04_REFLECT'
  | 'P05_PLAN_EXEC'
  | 'P06_REFINE'
  | 'P07_MAKER_CHECKER'
  | 'P08_TOOL_RETRY'
  | 'P09_FUNCTION_ROUTER'
  | 'P10_MCP_CHAIN'
  | 'P11_NYAYARAG'
  | 'P12_GRAPHRAG'
  | 'P13_MEM0'
  | 'P14_SEMANTIC_CACHE'
  | 'P15_HTA'
  | 'P16_SWARM'
  | 'P17_ACONIC'
  | 'P18_MOAT'
  | 'P19_ADAPT'
  | 'P20_COMPUTER_USE'
  | 'P21_GRPO'
  | 'P22_DIGITAL_TWIN';

export type JrxLegalDomain =
  | 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip'
  | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';

export interface JrxPatternRequest {
  task: string;
  jurisdiction?: JrxJurisdiction;
  agentId?: string;
  template_mode?: JrxTemplateMode;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ragConfidence?: number;
}

export interface JrxPatternResponse {
  success: boolean;
  data?: {
    result: string;
    pattern: JrxPatternKey;
    agentId?: string;
    jurisdiction?: JrxJurisdiction;
    executionTime?: number;
  };
  ai_metadata?: JrxAIMetadataBlock;
  grpoTelemetry?: JrxGRPOTelemetry;
  credit_warning?: JrxCreditWarning;
  error?: string;
}

export interface JrxRiskComponents {
  jurisdiction_mismatch: number;
  clause_absence: number;
  structural_deviation: number;
  hallucination_probability: number;
  unsupported_references: number;
}

export interface JrxRiskScore {
  score: number;
  blocked: boolean;
  block_reason: string | null;
  confidence: number;
  components: JrxRiskComponents;
  prompt_hash: string;
}

export interface JrxAIMetadataBlock {
  trace_id: string;
  generated_at: string;
  jurisdiction: {
    code: JrxJurisdiction;
    name: string;
    currency: string;
    legal_system: string;
    disclosure_appended: boolean;
  };
  template_mode: JrxTemplateMode;
  strict_mode_violations: string[];
  risk: JrxRiskScore;
  model: {
    provider: string;
    model: string;
    tokens_used: number;
    latency_ms: number;
  };
  governance: {
    jurisdiction_validated: boolean;
    jurisdiction_code: JrxJurisdiction;
    jurisdiction_name: string;
    currency: string;
    legal_system: string;
    disclosure_appended: boolean;
  };
  disclosure: string;
  nyv_version: string;
}

export interface JrxGRPOTelemetry {
  patternKey: string;
  agentId: string;
  jurisdiction: JrxJurisdiction;
  episodeCount: number;
  avgReward: number;
  policyUpdates: number;
  note?: string;
}

export interface JrxCreditWallet {
  wallet_id: string;
  user_id: string;
  credits_balance: number;
  reserved_credits: number;
  available_credits: number;
  credits_expiry: string | null;
  last_updated: string;
}

export type JrxCreditTransactionType = 'DEBIT' | 'CREDIT' | 'RESERVE' | 'RELEASE';
export type JrxCreditTransactionSource = 'AI_TOOL' | 'PURCHASE' | 'REFUND' | 'MANUAL' | 'SYSTEM';

export interface JrxCreditTransaction {
  transaction_id: string;
  user_id: string;
  type: JrxCreditTransactionType;
  credits: number;
  source: JrxCreditTransactionSource;
  tool_name: string;
  reference_id: string | null;
  immutable_hash: string;
  created_at: string;
}

export interface JrxCreditWarning {
  warning: boolean;
  remaining_credits: number;
  message: string;
}

export type JrxSubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'past_due' | 'trialing';
export type JrxBillingCycle = 'monthly' | 'quarterly' | 'annual';

export interface JrxSubscription {
  subscription_id: string;
  user_id: string;
  plan_id: JrxSubscriptionTier;
  status: JrxSubscriptionStatus;
  billing_cycle: JrxBillingCycle;
  amount_inr: number;
  currency: 'INR';
  razorpay_sub_id?: string;
  current_period_start: string;
  current_period_end: string;
  trial_end?: string;
  cancelled_at?: string;
  cancel_reason?: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export type JrxCaseUpdateType = 'HEARING' | 'FILING' | 'DOCUMENT' | 'COMMUNICATION' | 'TASK' | 'NOTE';

export interface JrxCaseUpdate {
  update_id: string;
  case_id: string;
  user_id: string;
  update_type: JrxCaseUpdateType;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  locked: boolean;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface JrxGSTBreakdown {
  base_amount: number;
  cgst_rate: number;
  cgst_amount: number;
  sgst_rate: number;
  sgst_amount: number;
  igst_rate: number;
  igst_amount: number;
  total_tax: number;
  total_amount: number;
  is_interstate: boolean;
}

export interface JrxInvoice {
  invoice_id: string;
  invoice_type: 'TAX_INVOICE' | 'PROFORMA' | 'CREDIT_NOTE';
  gst: JrxGSTBreakdown;
  tds_applicable: boolean;
  tds_amount: number;
  net_payable: number;
  issued_at: string;
  due_date: string;
  currency: 'INR';
}

export type JrxOrgType =
  | 'law_firm'
  | 'corporate_legal'
  | 'judiciary'
  | 'government'
  | 'law_school'
  | 'legal_tech'
  | 'ngo'
  | 'other';

export interface JrxInstitutionalLead {
  lead_id: string;
  org_name: string;
  org_type: JrxOrgType;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  jurisdiction: JrxJurisdiction;
  team_size?: string;
  use_case: string;
  monthly_volume?: string;
  integrations_needed?: string[];
  compliance_needs?: string[];
  step_completed: number;
  form_data: Record<string, unknown>;
  status: 'new' | 'contacted' | 'qualified' | 'proposal_sent' | 'won' | 'lost';
  source: string;
  created_at: string;
  updated_at: string;
}

export interface JrxAgent {
  agentId: string;
  name: string;
  domain: string;
  jurisdiction: JrxJurisdiction[];
  tier: string;
  romaLevel: number;
  capabilities: string[];
  languages: string[];
  status: 'active' | 'maintenance' | 'deprecated';
}

export interface JrxClientConfig {
  apiKey: string;
  baseUrl?: string;
  jurisdiction?: JrxJurisdiction;
  timeout?: number;
  retries?: number;
  defaultTemplateMode?: JrxTemplateMode;
  enableStreaming?: boolean;
}

export interface JrxApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  ai_metadata?: JrxAIMetadataBlock;
  grpoTelemetry?: JrxGRPOTelemetry;
}

export interface JrxPrecedentMatch {
  caseId: string;
  citation: string;
  court: string;
  year: number;
  structuralSimilarityScore: number;
  precedentStrength: number;
  principleApplied: string;
  outcome: string;
  relevantRatio: string;
}

export interface JrxPrecedentSearchResult {
  matches: JrxPrecedentMatch[];
  strongestPrecedent: JrxPrecedentMatch;
  overallPrecedentStrength: number;
  jurisdiction: JrxJurisdiction;
}

export interface JrxRegulatoryUpdate {
  id: string;
  title: string;
  source: string;
  jurisdiction: JrxJurisdiction;
  domain: JrxLegalDomain;
  severity: 'informational' | 'moderate' | 'significant' | 'critical';
  effectiveDate: string;
  summary: string;
  affectedAreas: string[];
}

export interface JrxRegulatoryDigest {
  jurisdiction: JrxJurisdiction;
  period: { start: string; end: string };
  updates: JrxRegulatoryUpdate[];
  totalUpdates: number;
  criticalCount: number;
}

export interface JrxComplianceDeadline {
  date: string;
  description: string;
  authority: string;
  domain: JrxLegalDomain;
  penalty: string;
  isRecurring: boolean;
}

export interface JrxComplianceCalendar {
  jurisdiction: JrxJurisdiction;
  deadlines: JrxComplianceDeadline[];
}

export interface JrxSecureSession {
  id: string;
  hostUserId: string;
  status: 'pending' | 'active' | 'closed';
  privilegeProtected: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface JrxContractAnalysis {
  clauses: { clauseNumber: string; title: string; text: string; category: string; riskScore: number; riskReason: string }[];
  missingClauses: { name: string; category: string; reason: string }[];
  conflicts: { clauseA: string; clauseB: string; nature: string; severity: string }[];
  riskSummary: { critical: number; high: number; medium: number; low: number };
  overallRiskScore: number;
  recommendations: string[];
}

export interface JrxReadabilityScore {
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  averageSentenceLength: number;
  wordCount: number;
  complexWordPercentage: number;
  grade: string;
  withinTarget: boolean;
}

export interface JrxLegalEntity {
  text: string;
  type: string;
  start: number;
  end: number;
  confidence: number;
  canonicalForm: string;
  valid: boolean;
}

export interface JrxLegalNerResult {
  entities: JrxLegalEntity[];
  entityCounts: Record<string, number>;
  confidence: number;
  model: string;
}

export interface JrxOracleTestReport {
  jurisdiction: JrxJurisdiction;
  totalTested: number;
  passed: number;
  failed: number;
  accuracy: number;
  executedAt: string;
}

export interface JrxAdversarialTestReport {
  totalTests: number;
  passed: number;
  failed: number;
  categories: Record<string, { tested: number; passed: number }>;
  executedAt: string;
}

export interface JrxLlmJudgeResult {
  scores: {
    legalAccuracy: number;
    citationQuality: number;
    jurisdictionCorrectness: number;
    biasAbsence: number;
    actionability: number;
  };
  weightedTotal: number;
  passedThreshold: boolean;
  judgeReasoning: string;
  flaggedIssues: string[];
}

export interface JrxAgentScorecard {
  jurisdiction: JrxJurisdiction;
  oracleAccuracy: number;
  citationHallucinationRate: number;
  adversarialResistance: number;
  biasScore: number;
  latencyP99Ms: number;
  grpoRewardScore: number;
  overallPass: boolean;
}

export interface JrxEuComplianceReport {
  totalEuAgents: number;
  compliantAgents: number;
  nonCompliantAgents: number;
  articles: Record<string, { compliant: number; total: number }>;
}

export interface JrxBiasAuditReport {
  agentId: string;
  dimensionScores: Record<string, number>;
  overallBiasScore: number;
  passed: boolean;
  remediation: string[];
}

export interface JrxWatermarkResult {
  watermarked: boolean;
  method: 'invisible' | 'visible' | 'both';
  verificationHash: string;
}

export interface JrxSigningSession {
  sessionId: string;
  documentHash: string;
  status: 'pending' | 'in-progress' | 'completed' | 'expired' | 'cancelled';
  provider: string;
  createdAt: string;
  expiresAt: string;
}

export interface JrxGraphTraversalInput {
  startNodeId: string;
  depth?: number;
  jurisdiction: JrxJurisdiction;
  includeRepealed?: boolean;
}

export interface JrxGraphNode {
  id: string;
  type: 'statute' | 'section' | 'amendment' | 'ruling' | 'notification';
  label: string;
  jurisdiction: JrxJurisdiction;
  metadata: Record<string, unknown>;
}

export interface JrxGraphEdge {
  source: string;
  target: string;
  relationship: 'amends' | 'repeals' | 'cites' | 'supersedes' | 'interprets';
  weight: number;
}

export interface JrxGraphTraversalResult {
  nodes: JrxGraphNode[];
  edges: JrxGraphEdge[];
  totalNodes: number;
  traversalDepth: number;
}

export interface JrxCitationCheckResult {
  citation: string;
  valid: boolean;
  resolvedTitle: string;
  court: string;
  year: number;
  status: 'active' | 'overruled' | 'distinguished' | 'unknown';
}

export interface JrxLegalDiffResult {
  sections: { sectionId: string; before: string; after: string; changeType: 'added' | 'removed' | 'modified' }[];
  totalChanges: number;
  effectiveDate: string;
  summary: string;
}

export interface JrxTemplateListItem {
  id: string;
  name: string;
  category: string;
  jurisdiction: JrxJurisdiction;
  language: string;
  version: string;
}

export interface JrxTemplateGenerateResult {
  documentId: string;
  content: string;
  templateId: string;
  filledFields: Record<string, string>;
  missingFields: string[];
}

export interface JrxTemplateFillSession {
  sessionId: string;
  templateId: string;
  status: 'active' | 'completed' | 'expired';
  requiredFields: string[];
  completedFields: string[];
  createdAt: string;
}

export interface JrxLimitationResult {
  sectionId: string;
  title: string;
  limitationPeriod: string;
  startEvent: string;
  exceptions: string[];
  expired: boolean;
  daysRemaining: number | null;
}

export interface JrxChecklistItem {
  id: string;
  label: string;
  category: string;
  completed: boolean;
  dueDate: string | null;
  priority: 'high' | 'medium' | 'low';
}

export interface JrxForensicVerifyResult {
  documentId: string;
  authentic: boolean;
  confidenceScore: number;
  hashMatch: boolean;
  timestampValid: boolean;
  signerVerified: boolean;
  anomalies: string[];
}

export interface JrxAuditTrailEntry {
  entryId: string;
  timestamp: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  classification: 'privileged' | 'standard' | 'sensitive';
  metadata: Record<string, unknown>;
}

export interface JrxEDiscoveryResult {
  totalDocuments: number;
  relevantDocuments: number;
  privilegedDocuments: number;
  producibleDocuments: number;
  batches: { batchId: string; status: string; documentCount: number }[];
}

export interface JrxGazetteProcessResult {
  gazetteId: string;
  amendments: { actId: string; sectionId: string; changeType: string; summary: string }[];
  effectiveDate: string;
  processedAt: string;
}

export interface JrxAffectedMattersResult {
  amendmentId: string;
  affectedMatters: { matterId: string; clientName: string; impactLevel: 'high' | 'medium' | 'low'; description: string }[];
  totalAffected: number;
}

export interface JrxConflictDetectResult {
  conflicts: { partyA: string; partyB: string; nature: string; severity: 'critical' | 'high' | 'medium' | 'low'; recommendation: string }[];
  hasConflict: boolean;
  totalConflicts: number;
}

export interface JrxAmendmentImpactResult {
  amendmentId: string;
  affectedSections: { sectionId: string; impact: 'direct' | 'indirect'; description: string }[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  clientImpactSummary: string;
  recommendations: string[];
}

export interface JrxStatuteHistoryResult {
  statuteId: string;
  title: string;
  jurisdiction: JrxJurisdiction;
  timeline: { date: string; event: string; description: string; gazetteRef: string }[];
  currentStatus: 'active' | 'repealed' | 'amended' | 'suspended';
}

export interface JrxLitigationRiskResult {
  riskScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  factors: { factor: string; weight: number; score: number; explanation: string }[];
  precedentSupport: number;
  recommendedActions: string[];
  estimatedOutcome: string;
}

export interface JrxMatterMemory {
  matterId: string;
  title: string;
  jurisdiction: JrxJurisdiction;
  domain: JrxLegalDomain;
  facts: Record<string, unknown>;
  documents: string[];
  lastAccessed: string;
  createdAt: string;
}

export interface JrxClientMemory {
  clientId: string;
  name: string;
  matters: string[];
  preferences: Record<string, unknown>;
  communicationHistory: { date: string; channel: string; summary: string }[];
  lastAccessed: string;
}

export interface JrxSlmAvailability {
  jurisdiction: JrxJurisdiction;
  available: boolean;
  model: string;
  endpoint: string;
  latencyP50Ms: number;
  capacityRemaining: number;
}

export interface JrxCacheEntry {
  key: string;
  hit: boolean;
  value?: unknown;
  similarity?: number;
  ttlRemaining?: number;
  cachedAt?: string;
}

export interface JrxCacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  avgLatencyMs: number;
  memorySizeMb: number;
}

export interface JrxWebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
  signature: string;
}

export interface JrxSdkTierLimits {
  tier: JrxSubscriptionTier;
  rpm: number;
  rpd: number;
  maxTokensPerRequest: number;
  maxConcurrent: number;
  features: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// JRX-NS-012 · LegalStatuteResponse envelope (2026-05-01)
// ─────────────────────────────────────────────────────────────────────────────
//
// Canonical response envelope for any agent / route that returns a parsed
// statutory provision. The envelope unifies the 7-jurisdiction handler shapes
// (IN, UK, US, EU, GC, SG, plus the deprecated v3 IN payload) so partner
// SDKs can treat all jurisdictions uniformly.
//
// Adoption pattern (per jurisdiction agent):
//   1. The agent returns its raw provider-shaped payload as `raw_payload`.
//   2. The 7 jurisdiction handlers transform that into the envelope below
//      (one helper per jurisdiction in src/services/jurisdictions/).
//   3. The gateway response middleware sends the envelope wrapped in the
//      standard `{ success, data, error }` API envelope.
// ─────────────────────────────────────────────────────────────────────────────

/** Canonical reference identifier for any statute / regulation / case. */
export interface JrxStatuteRef {
  /** Jurisdiction code per JrxJurisdiction (IN/UK/US/EU/GC/SG). */
  jurisdiction: JrxJurisdiction;
  /** Short statute code. Examples: "BNS", "BSA", "IT-Act", "GDPR", "CCPA". */
  statute: string;
  /** Section / article identifier. Free-form so it survives e.g. "Art 5(2)". */
  section: string;
  /** Optional sub-clause or part identifier. */
  subSection?: string;
  /** Effective-date marker for time-aware lookups. ISO-8601. */
  effectiveDate?: string;
  /** Government-published source URL when available (preferred) or null. */
  sourceUrl?: string | null;
}

/** Provenance + retrieval metadata for a single statute lookup. */
export interface JrxStatuteProvenance {
  /** Was the answer served from cache, RAG, live source, or LLM synthesis? */
  origin: 'cache' | 'rag' | 'live-source' | 'llm-synthesis' | 'hybrid';
  /** Confidence in [0, 1]. Agents must set this honestly; 1.0 only for verbatim source. */
  confidence: number;
  /** Cited document hashes (SHA-256) so callers can verify integrity. */
  documentHashes: string[];
  /** UTC ISO-8601 timestamp the underlying source document was last fetched. */
  retrievedAt: string;
  /** Free-form chain of reasoning agents the response passed through. */
  agentChain: string[];
}

/** Replacement / supersession history (e.g. IPC s.302 → BNS s.103). */
export interface JrxStatuteSupersession {
  replaces?: JrxStatuteRef[];
  replacedBy?: JrxStatuteRef[];
  /** Human-readable note explaining the transition. */
  note?: string;
}

/** Canonical statute response envelope. ALL jurisdiction agents MUST emit this shape. */
export interface JrxLegalStatuteResponse {
  /** The statute being described. */
  ref: JrxStatuteRef;
  /** Plain-language title of the provision. */
  title: string;
  /** Full statutory text as published. */
  text: string;
  /** Plain-language summary suitable for non-lawyer end users. */
  summary?: string;
  /** Penalties, fines, imprisonment terms — structured for downstream UI. */
  penalties?: Array<{
    type: 'imprisonment' | 'fine' | 'forfeiture' | 'disqualification' | 'other';
    description: string;
    minDurationDays?: number;
    maxDurationDays?: number;
    minFineMinor?: number;
    maxFineMinor?: number;
    currency?: string;
  }>;
  /** Cross-references to related statutes / case law. */
  relatedRefs?: JrxStatuteRef[];
  /** Supersession history (replaced / replacedBy). */
  supersession?: JrxStatuteSupersession;
  /** Provenance + retrieval metadata. */
  provenance: JrxStatuteProvenance;
  /** Raw provider payload preserved for forensic debugging (NEVER user-facing). */
  rawPayload?: unknown;
  /** Schema version of this envelope. Bump on breaking shape changes. */
  schemaVersion: '1.0.0';
}

/**
 * Type guard: narrow an unknown payload to JrxLegalStatuteResponse.
 * Useful in route handlers and SDK consumers that receive untyped JSON.
 */
export function isJrxLegalStatuteResponse(
  value: unknown
): value is JrxLegalStatuteResponse {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ref === 'object' && v.ref !== null &&
    typeof v.title === 'string' &&
    typeof v.text === 'string' &&
    typeof v.provenance === 'object' && v.provenance !== null &&
    v.schemaVersion === '1.0.0'
  );
}
