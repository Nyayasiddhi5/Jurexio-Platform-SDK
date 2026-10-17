/**
 * @jurexio/types v3.1.2
 * Jurexio Enterprise Platform 312 — Shared TypeScript Types
 *
 * Canonical type definitions consumed by:
 *  - @jurexio/client-sdk
 *  - @jurexio/enterprise-sdk
 *  - @jurexio/react-hooks
 *  - NYV Gateway API
 *  - All 5 Jurexio platforms
 *  - ROMA L5 agents (1,043)
 */

export type NyvJurisdiction = 'IN' | 'UK' | 'US' | 'EU' | 'GC' | 'SG';

export type NyvSubscriptionTier =
  | 'free'
  | 'solo'
  | 'plus'
  | 'pro'
  | 'enterprise'
  | 'government'
  | 'internal';

export type NyvTemplateMode = 'STRICT' | 'GUIDED' | 'MENTOR';

export type NyvPlatform =
  | 'nyayamitra'
  | 'nys-professional'
  | 'nys-institutional'
  | 'nys-academy'
  | 'nys-ministry';

export type NyvPatternKey =
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

export type NyvLegalDomain =
  | 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip'
  | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';

export interface NyvPatternRequest {
  task: string;
  jurisdiction?: NyvJurisdiction;
  agentId?: string;
  template_mode?: NyvTemplateMode;
  context?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ragConfidence?: number;
}

export interface NyvPatternResponse {
  success: boolean;
  data?: {
    result: string;
    pattern: NyvPatternKey;
    agentId?: string;
    jurisdiction?: NyvJurisdiction;
    executionTime?: number;
  };
  ai_metadata?: NyvAIMetadataBlock;
  grpoTelemetry?: NyvGRPOTelemetry;
  credit_warning?: NyvCreditWarning;
  error?: string;
}

export interface NyvRiskComponents {
  jurisdiction_mismatch: number;
  clause_absence: number;
  structural_deviation: number;
  hallucination_probability: number;
  unsupported_references: number;
}

export interface NyvRiskScore {
  score: number;
  blocked: boolean;
  block_reason: string | null;
  confidence: number;
  components: NyvRiskComponents;
  prompt_hash: string;
}

export interface NyvAIMetadataBlock {
  trace_id: string;
  generated_at: string;
  jurisdiction: {
    code: NyvJurisdiction;
    name: string;
    currency: string;
    legal_system: string;
    disclosure_appended: boolean;
  };
  template_mode: NyvTemplateMode;
  strict_mode_violations: string[];
  risk: NyvRiskScore;
  model: {
    provider: string;
    model: string;
    tokens_used: number;
    latency_ms: number;
  };
  governance: {
    jurisdiction_validated: boolean;
    jurisdiction_code: NyvJurisdiction;
    jurisdiction_name: string;
    currency: string;
    legal_system: string;
    disclosure_appended: boolean;
  };
  disclosure: string;
  nyv_version: string;
}

export interface NyvGRPOTelemetry {
  patternKey: string;
  agentId: string;
  jurisdiction: NyvJurisdiction;
  episodeCount: number;
  avgReward: number;
  policyUpdates: number;
  note?: string;
}

export interface NyvCreditWallet {
  wallet_id: string;
  user_id: string;
  credits_balance: number;
  reserved_credits: number;
  available_credits: number;
  credits_expiry: string | null;
  last_updated: string;
}

export type NyvCreditTransactionType = 'DEBIT' | 'CREDIT' | 'RESERVE' | 'RELEASE';
export type NyvCreditTransactionSource = 'AI_TOOL' | 'PURCHASE' | 'REFUND' | 'MANUAL' | 'SYSTEM';

export interface NyvCreditTransaction {
  transaction_id: string;
  user_id: string;
  type: NyvCreditTransactionType;
  credits: number;
  source: NyvCreditTransactionSource;
  tool_name: string;
  reference_id: string | null;
  immutable_hash: string;
  created_at: string;
}

export interface NyvCreditWarning {
  warning: boolean;
  remaining_credits: number;
  message: string;
}

export type NyvSubscriptionStatus = 'active' | 'paused' | 'cancelled' | 'past_due' | 'trialing';
export type NyvBillingCycle = 'monthly' | 'quarterly' | 'annual';

export interface NyvSubscription {
  subscription_id: string;
  user_id: string;
  plan_id: NyvSubscriptionTier;
  status: NyvSubscriptionStatus;
  billing_cycle: NyvBillingCycle;
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

export type NyvCaseUpdateType = 'HEARING' | 'FILING' | 'DOCUMENT' | 'COMMUNICATION' | 'TASK' | 'NOTE';

export interface NyvCaseUpdate {
  update_id: string;
  case_id: string;
  user_id: string;
  update_type: NyvCaseUpdateType;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  locked: boolean;
  locked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface NyvGSTBreakdown {
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

export interface NyvInvoice {
  invoice_id: string;
  invoice_type: 'TAX_INVOICE' | 'PROFORMA' | 'CREDIT_NOTE';
  gst: NyvGSTBreakdown;
  tds_applicable: boolean;
  tds_amount: number;
  net_payable: number;
  issued_at: string;
  due_date: string;
  currency: 'INR';
}

export type NyvOrgType =
  | 'law_firm'
  | 'corporate_legal'
  | 'judiciary'
  | 'government'
  | 'law_school'
  | 'legal_tech'
  | 'ngo'
  | 'other';

export interface NyvInstitutionalLead {
  lead_id: string;
  org_name: string;
  org_type: NyvOrgType;
  contact_name: string;
  contact_email: string;
  contact_phone?: string;
  jurisdiction: NyvJurisdiction;
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

export interface NyvAgent {
  agentId: string;
  name: string;
  domain: string;
  jurisdiction: NyvJurisdiction[];
  tier: string;
  romaLevel: number;
  capabilities: string[];
  languages: string[];
  status: 'active' | 'maintenance' | 'deprecated';
}

export interface NyvClientConfig {
  apiKey: string;
  baseUrl?: string;
  jurisdiction?: NyvJurisdiction;
  timeout?: number;
  retries?: number;
  defaultTemplateMode?: NyvTemplateMode;
  enableStreaming?: boolean;
}

export interface NyvApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  ai_metadata?: NyvAIMetadataBlock;
  grpoTelemetry?: NyvGRPOTelemetry;
}

export interface NyvPrecedentMatch {
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

export interface NyvPrecedentSearchResult {
  matches: NyvPrecedentMatch[];
  strongestPrecedent: NyvPrecedentMatch;
  overallPrecedentStrength: number;
  jurisdiction: NyvJurisdiction;
}

export interface NyvRegulatoryUpdate {
  id: string;
  title: string;
  source: string;
  jurisdiction: NyvJurisdiction;
  domain: NyvLegalDomain;
  severity: 'informational' | 'moderate' | 'significant' | 'critical';
  effectiveDate: string;
  summary: string;
  affectedAreas: string[];
}

export interface NyvRegulatoryDigest {
  jurisdiction: NyvJurisdiction;
  period: { start: string; end: string };
  updates: NyvRegulatoryUpdate[];
  totalUpdates: number;
  criticalCount: number;
}

export interface NyvComplianceDeadline {
  date: string;
  description: string;
  authority: string;
  domain: NyvLegalDomain;
  penalty: string;
  isRecurring: boolean;
}

export interface NyvComplianceCalendar {
  jurisdiction: NyvJurisdiction;
  deadlines: NyvComplianceDeadline[];
}

export interface NyvSecureSession {
  id: string;
  hostUserId: string;
  status: 'pending' | 'active' | 'closed';
  privilegeProtected: boolean;
  createdAt: string;
  expiresAt: string;
}

export interface NyvContractAnalysis {
  clauses: { clauseNumber: string; title: string; text: string; category: string; riskScore: number; riskReason: string }[];
  missingClauses: { name: string; category: string; reason: string }[];
  conflicts: { clauseA: string; clauseB: string; nature: string; severity: string }[];
  riskSummary: { critical: number; high: number; medium: number; low: number };
  overallRiskScore: number;
  recommendations: string[];
}

export interface NyvReadabilityScore {
  fleschKincaidGrade: number;
  fleschReadingEase: number;
  averageSentenceLength: number;
  wordCount: number;
  complexWordPercentage: number;
  grade: string;
  withinTarget: boolean;
}

export interface NyvLegalEntity {
  text: string;
  type: string;
  start: number;
  end: number;
  confidence: number;
  canonicalForm: string;
  valid: boolean;
}

export interface NyvLegalNerResult {
  entities: NyvLegalEntity[];
  entityCounts: Record<string, number>;
  confidence: number;
  model: string;
}

export interface NyvOracleTestReport {
  jurisdiction: NyvJurisdiction;
  totalTested: number;
  passed: number;
  failed: number;
  accuracy: number;
  executedAt: string;
}

export interface NyvAdversarialTestReport {
  totalTests: number;
  passed: number;
  failed: number;
  categories: Record<string, { tested: number; passed: number }>;
  executedAt: string;
}

export interface NyvLlmJudgeResult {
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

export interface NyvAgentScorecard {
  jurisdiction: NyvJurisdiction;
  oracleAccuracy: number;
  citationHallucinationRate: number;
  adversarialResistance: number;
  biasScore: number;
  latencyP99Ms: number;
  grpoRewardScore: number;
  overallPass: boolean;
}

export interface NyvEuComplianceReport {
  totalEuAgents: number;
  compliantAgents: number;
  nonCompliantAgents: number;
  articles: Record<string, { compliant: number; total: number }>;
}

export interface NyvBiasAuditReport {
  agentId: string;
  dimensionScores: Record<string, number>;
  overallBiasScore: number;
  passed: boolean;
  remediation: string[];
}

export interface NyvWatermarkResult {
  watermarked: boolean;
  method: 'invisible' | 'visible' | 'both';
  verificationHash: string;
}

export interface NyvSigningSession {
  sessionId: string;
  documentHash: string;
  status: 'pending' | 'in-progress' | 'completed' | 'expired' | 'cancelled';
  provider: string;
  createdAt: string;
  expiresAt: string;
}

export interface NyvGraphTraversalInput {
  startNodeId: string;
  depth?: number;
  jurisdiction: NyvJurisdiction;
  includeRepealed?: boolean;
}

export interface NyvGraphNode {
  id: string;
  type: 'statute' | 'section' | 'amendment' | 'ruling' | 'notification';
  label: string;
  jurisdiction: NyvJurisdiction;
  metadata: Record<string, unknown>;
}

export interface NyvGraphEdge {
  source: string;
  target: string;
  relationship: 'amends' | 'repeals' | 'cites' | 'supersedes' | 'interprets';
  weight: number;
}

export interface NyvGraphTraversalResult {
  nodes: NyvGraphNode[];
  edges: NyvGraphEdge[];
  totalNodes: number;
  traversalDepth: number;
}

export interface NyvCitationCheckResult {
  citation: string;
  valid: boolean;
  resolvedTitle: string;
  court: string;
  year: number;
  status: 'active' | 'overruled' | 'distinguished' | 'unknown';
}

export interface NyvLegalDiffResult {
  sections: { sectionId: string; before: string; after: string; changeType: 'added' | 'removed' | 'modified' }[];
  totalChanges: number;
  effectiveDate: string;
  summary: string;
}

export interface NyvTemplateListItem {
  id: string;
  name: string;
  category: string;
  jurisdiction: NyvJurisdiction;
  language: string;
  version: string;
}

export interface NyvTemplateGenerateResult {
  documentId: string;
  content: string;
  templateId: string;
  filledFields: Record<string, string>;
  missingFields: string[];
}

export interface NyvTemplateFillSession {
  sessionId: string;
  templateId: string;
  status: 'active' | 'completed' | 'expired';
  requiredFields: string[];
  completedFields: string[];
  createdAt: string;
}

export interface NyvLimitationResult {
  sectionId: string;
  title: string;
  limitationPeriod: string;
  startEvent: string;
  exceptions: string[];
  expired: boolean;
  daysRemaining: number | null;
}

export interface NyvChecklistItem {
  id: string;
  label: string;
  category: string;
  completed: boolean;
  dueDate: string | null;
  priority: 'high' | 'medium' | 'low';
}

export interface NyvForensicVerifyResult {
  documentId: string;
  authentic: boolean;
  confidenceScore: number;
  hashMatch: boolean;
  timestampValid: boolean;
  signerVerified: boolean;
  anomalies: string[];
}

export interface NyvAuditTrailEntry {
  entryId: string;
  timestamp: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  classification: 'privileged' | 'standard' | 'sensitive';
  metadata: Record<string, unknown>;
}

export interface NyvEDiscoveryResult {
  totalDocuments: number;
  relevantDocuments: number;
  privilegedDocuments: number;
  producibleDocuments: number;
  batches: { batchId: string; status: string; documentCount: number }[];
}

export interface NyvGazetteProcessResult {
  gazetteId: string;
  amendments: { actId: string; sectionId: string; changeType: string; summary: string }[];
  effectiveDate: string;
  processedAt: string;
}

export interface NyvAffectedMattersResult {
  amendmentId: string;
  affectedMatters: { matterId: string; clientName: string; impactLevel: 'high' | 'medium' | 'low'; description: string }[];
  totalAffected: number;
}

export interface NyvConflictDetectResult {
  conflicts: { partyA: string; partyB: string; nature: string; severity: 'critical' | 'high' | 'medium' | 'low'; recommendation: string }[];
  hasConflict: boolean;
  totalConflicts: number;
}

export interface NyvAmendmentImpactResult {
  amendmentId: string;
  affectedSections: { sectionId: string; impact: 'direct' | 'indirect'; description: string }[];
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  clientImpactSummary: string;
  recommendations: string[];
}

export interface NyvStatuteHistoryResult {
  statuteId: string;
  title: string;
  jurisdiction: NyvJurisdiction;
  timeline: { date: string; event: string; description: string; gazetteRef: string }[];
  currentStatus: 'active' | 'repealed' | 'amended' | 'suspended';
}

export interface NyvLitigationRiskResult {
  riskScore: number;
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  factors: { factor: string; weight: number; score: number; explanation: string }[];
  precedentSupport: number;
  recommendedActions: string[];
  estimatedOutcome: string;
}

export interface NyvMatterMemory {
  matterId: string;
  title: string;
  jurisdiction: NyvJurisdiction;
  domain: NyvLegalDomain;
  facts: Record<string, unknown>;
  documents: string[];
  lastAccessed: string;
  createdAt: string;
}

export interface NyvClientMemory {
  clientId: string;
  name: string;
  matters: string[];
  preferences: Record<string, unknown>;
  communicationHistory: { date: string; channel: string; summary: string }[];
  lastAccessed: string;
}

export interface NyvSlmAvailability {
  jurisdiction: NyvJurisdiction;
  available: boolean;
  model: string;
  endpoint: string;
  latencyP50Ms: number;
  capacityRemaining: number;
}

export interface NyvCacheEntry {
  key: string;
  hit: boolean;
  value?: unknown;
  similarity?: number;
  ttlRemaining?: number;
  cachedAt?: string;
}

export interface NyvCacheStats {
  totalEntries: number;
  hitRate: number;
  missRate: number;
  avgLatencyMs: number;
  memorySizeMb: number;
}

export interface NyvWebhookEvent {
  id: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
  signature: string;
}

export interface NyvSdkTierLimits {
  tier: NyvSubscriptionTier;
  rpm: number;
  rpd: number;
  maxTokensPerRequest: number;
  maxConcurrent: number;
  features: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// NYV-NS-012 · LegalStatuteResponse envelope (2026-05-01)
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
export interface NyvStatuteRef {
  /** Jurisdiction code per NyvJurisdiction (IN/UK/US/EU/GC/SG). */
  jurisdiction: NyvJurisdiction;
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
export interface NyvStatuteProvenance {
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
export interface NyvStatuteSupersession {
  replaces?: NyvStatuteRef[];
  replacedBy?: NyvStatuteRef[];
  /** Human-readable note explaining the transition. */
  note?: string;
}

/** Canonical statute response envelope. ALL jurisdiction agents MUST emit this shape. */
export interface NyvLegalStatuteResponse {
  /** The statute being described. */
  ref: NyvStatuteRef;
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
  relatedRefs?: NyvStatuteRef[];
  /** Supersession history (replaced / replacedBy). */
  supersession?: NyvStatuteSupersession;
  /** Provenance + retrieval metadata. */
  provenance: NyvStatuteProvenance;
  /** Raw provider payload preserved for forensic debugging (NEVER user-facing). */
  rawPayload?: unknown;
  /** Schema version of this envelope. Bump on breaking shape changes. */
  schemaVersion: '1.0.0';
}

/**
 * Type guard: narrow an unknown payload to NyvLegalStatuteResponse.
 * Useful in route handlers and SDK consumers that receive untyped JSON.
 */
export function isNyvLegalStatuteResponse(
  value: unknown
): value is NyvLegalStatuteResponse {
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
