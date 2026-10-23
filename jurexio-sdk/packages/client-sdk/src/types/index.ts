/**
 * @jurexio/client-sdk — Core Type Definitions
 * Jurexio Enterprise Platform 312 — All rights reserved
 */

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxClientConfig {
  apiKey: string;
  /** Gateway origin only (no path). SDK methods use absolute paths under `/api/jrx/`. */
  baseUrl?: string;
  /**
   * Documented convention for integrators (`/api/jrx`). Not prepended automatically —
   * every SDK method already encodes the full path prefix.
   */
  apiPathPrefix?: '/api/jrx';
  timeout?: number;
  /** Queen /api/jrx/orchestrate timeout (default 600_000 ms). */
  orchestrateTimeoutMs?: number;
  defaultJurisdiction?: JrxJurisdiction;
  defaultPlatform?: JrxPlatform;
  defaultAgentId?: string;
  debug?: boolean;
  /** NSP shared-docs header, e.g. nyayasiddhi-professional/1.0.0 */
  platformClient?: string;
  /** East-west inter-service secret → `X-NSP-Inter-Secret` (alias `X-Inter-Service-Secret`). */
  interServiceSecret?: string;
  /** SDK version override (defaults to JrxClient.VERSION). */
  version?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export type JrxJurisdiction = 'IN' | 'UK' | 'US' | 'GC' | 'EU' | 'SG';

export type JrxPlatform =
  | 'jurexio-citizen'
  | 'nys-professional'
  | 'nys-institutional'
  | 'nys-academy'
  | 'nys-ministry';

export type JrxAgentPattern =
  | 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08'
  | 'P09' | 'P10' | 'P11' | 'P12' | 'P13' | 'P14' | 'P15' | 'P16'
  | 'P17' | 'P18' | 'P19' | 'P20' | 'P21' | 'P22';

export type JrxRiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxBasePatternRequest {
  task: string;
  agentId?: string;
  jurisdiction?: JrxJurisdiction;
  platform?: JrxPlatform;
  context?: Record<string, unknown>;
}

export interface JrxPatternResponse {
  pattern: string;
  traceId: string;
  agentId?: string;
  jurisdiction?: JrxJurisdiction;
  result?: string;
  legalPosition?: string;
  reasoning?: string | string[];
  citations?: JrxCitation[];
  risks?: JrxRiskAssessment[];
  recommendation?: string;
  confidenceScore?: number;
  performanceMs?: number;
  [key: string]: unknown;
}

export interface JrxCitation {
  statute?: string;
  section?: string;
  case?: string;
  court?: string;
  year?: number | string;
  relevance?: string;
  url?: string;
}

export interface JrxRiskAssessment {
  type: string;
  level: JrxRiskLevel;
  description: string;
  mitigation?: string;
  probability?: number;
}

// Pattern-specific request extensions
export interface ReActRequest extends JrxBasePatternRequest {
  maxIterations?: number;
  tools?: string[];
}

export interface ToTRequest extends JrxBasePatternRequest {
  numBranches?: number;
  evaluationDepth?: number;
}

export interface GRPORequest extends JrxBasePatternRequest {
  outputId?: string;
  outputContent?: string;
  advocateScores?: {
    legalAccuracy: number;
    citationQuality: number;
    practicalUsability: number;
    jurisdictionPrecision: number;
    riskAssessmentAccuracy: number;
    completeness: number;
  };
}

export interface DigitalTwinRequest extends JrxBasePatternRequest {
  twinPersona?: 'managing-partner' | 'senior-litigator' | 'compliance-head';
  domainExpertise?: string;
  yearsExperience?: number;
  scenarioType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxDocumentUploadResponse {
  success: boolean;
  docId: string;
  jobId: string;
  statusUrl: string;
  async?: boolean;
  message?: string;
}

export interface JrxDocumentStatus {
  docId: string;
  jobId: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  progress?: number;
  stage?: string;
  chunksProcessed?: number;
  embeddingsGenerated?: number;
  error?: string;
  completedAt?: string;
}

export interface JrxDocumentSearchResult {
  results: JrxDocumentChunk[];
  query: string;
  totalResults: number;
  searchTimeMs: number;
}

export interface JrxDocumentChunk {
  docId: string;
  chunkId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  fileName?: string;
  pageNumber?: number;
}

export interface JrxDocumentAnalysis {
  success: boolean;
  analysis: {
    summary?: string;
    documentType?: string;
    parties?: string[];
    clauses?: Array<{ type: string; content: string; risk?: string }>;
    obligations?: Array<{ party: string; obligation: string; deadline?: string }>;
    risks?: JrxRiskAssessment[];
    missingTerms?: string[];
    privacyAlerts?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxAgent {
  agentId: string;
  name: string;
  type: string;
  pattern?: JrxAgentPattern;
  jurisdiction?: JrxJurisdiction[];
  status: 'active' | 'inactive' | 'training';
  description?: string;
  capabilities?: string[];
}

export interface JrxAgentExecution {
  executionId: string;
  agentId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result?: JrxPatternResponse;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SKILL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxSkill {
  skillId: string;
  name: string;
  description: string;
  category: string;
  agentPattern?: JrxAgentPattern;
  jurisdiction?: JrxJurisdiction[];
  version: string;
  author?: string;
  rating?: number;
  installCount?: number;
  pricingModel?: 'free' | 'subscription' | 'usage';
  pricePerUse?: number;
  tags?: string[];
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface JrxSkillExecution {
  executionId: string;
  skillId: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  latencyMs?: number;
  tokensUsed?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIGITAL TWIN TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxDigitalTwin {
  twinId: string;
  name: string;
  persona: string;
  expertise: string;
  jurisdiction: JrxJurisdiction;
  state: Record<string, unknown>;
  createdAt: string;
  lastSimulatedAt?: string;
}

export interface JrxTwinSimulationResult {
  twinId: string;
  scenarioId: string;
  scenario: string;
  outcomes: Array<{
    description: string;
    probability: number;
    reasoning: string;
    timeline?: string;
    risks?: JrxRiskAssessment[];
  }>;
  recommendation: string;
  confidence: number;
  simulatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE / RAG TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxKnowledgeSearchRequest {
  query: string;
  jurisdiction?: JrxJurisdiction;
  limit?: number;
  searchMode?: 'hybrid' | 'semantic' | 'keyword';
  filters?: {
    docType?: string;
    dateFrom?: string;
    dateTo?: string;
    tags?: string[];
  };
}

export interface JrxKnowledgeSearchResponse {
  results: JrxDocumentChunk[];
  query: string;
  totalResults: number;
  searchTimeMs: number;
  jurisdiction: JrxJurisdiction;
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING / AG-UI TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type JrxStreamEventType =
  | 'run_started'
  | 'agent_started'
  | 'agent_selected'
  | 'agent_thinking'
  | 'thinking_step'
  | 'tool_call_start'
  | 'tool_call_result'
  | 'text_delta'
  | 'message_snapshot'
  | 'run_finished'
  | 'error'
  // T002 — AG-UI specialized pattern mechanics events (P01-P10)
  | 'pattern_event'
  // Server-side AG-UI protocol event aliases
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'citation_block'
  | 'step_complete'
  | 'run_completed'
  | 'run_error'
  | 'metadata';

export interface JrxStreamEvent {
  type: JrxStreamEventType;
  traceId?: string;
  agentId?: string;
  pattern?: string;
  data?: unknown;
  timestamp?: string;
  sequence?: number;
}

export interface JrxThinkingStepEvent extends JrxStreamEvent {
  type: 'thinking_step';
  data: { step: string; index: number; total: number };
}

export interface JrxTextDeltaEvent extends JrxStreamEvent {
  type: 'text_delta';
  data: {
    delta: string;
    accumulated?: string;
    /**
     * Queen SSE contract (NV-QUEEN-SSE-001/003):
     * - `provisional: true` (or omitted) — pre-safety-gate synthesizer tokens; may be replaced
     * - `provisional: false` + `gated: true` — post-gate authoritative stream (client MUST reset UI buffer)
     */
    provisional?: boolean;
    gated?: boolean;
  };
}

export interface JrxRunFinishedEvent extends JrxStreamEvent {
  type: 'run_finished';
  data: { result: JrxPatternResponse; latencyMs: number };
}

/** T002 — Specialized pattern mechanics event (P01-P10) */
export interface JrxPatternSpecializedEvent {
  type: 'pattern_event';
  subtype: string;
  label: string;
  pattern: string;
  runId: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface JrxStreamHandlers {
  onStart?: (event: JrxStreamEvent) => void;
  /** Fired when Queen selects / starts a specialist agent (AG-UI agent_selected). */
  onAgentSelected?: (agent: string, event: JrxStreamEvent) => void;
  onThinking?: (step: string, index: number, total: number) => void;
  onToolCall?: (tool: string, input: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  onTextDelta?: (
    delta: string,
    accumulated: string,
    meta?: { provisional?: boolean; gated?: boolean },
  ) => void;
  onComplete?: (result: JrxPatternResponse) => void;
  onError?: (error: JrxApiError) => void;
  /** T002 — Fired for P01-P10 specialized events (react_cycle, reasoning_step, branch_evaluated, etc.) */
  onPatternEvent?: (event: JrxPatternSpecializedEvent) => void;
  /** Fired for all metadata events emitted during AG-UI streaming */
  onMetadata?: (event: JrxStreamEvent) => void;
  /** Fired for each citation block emitted during streaming */
  onCitationBlock?: (citations: unknown[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxVoiceSynthesisRequest {
  text: string;
  voice?: string;
  language?: 'en' | 'hi' | 'ta' | 'te' | 'ml' | 'kn' | 'mr' | 'bn';
  speed?: number;
  pitch?: number;
  format?: 'mp3' | 'wav' | 'ogg';
}

export interface JrxVoiceSynthesisResponse {
  audioBase64: string;
  format: string;
  durationMs: number;
  characters: number;
  voice: string;
}

export interface JrxVoiceTranscriptionResponse {
  text: string;
  language: string;
  confidence: number;
  words?: Array<{ word: string; start: number; end: number }>;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxApiError {
  code: string;
  message: string;
  status: number;
  traceId?: string;
  details?: unknown;
}

export class JrxError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly traceId?: string;
  public readonly details?: unknown;

  constructor(err: JrxApiError) {
    super(err.message);
    this.name = 'JrxError';
    this.code = err.code;
    this.status = err.status;
    this.traceId = err.traceId;
    this.details = err.details;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface JrxPaginationOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─────────────────────────────────────────────────────────────────────────────
// D5-D6 INTELLIGENCE + TESTING + COMPLIANCE TYPES (SDK v6.0)
// ─────────────────────────────────────────────────────────────────────────────

export type JrxLegalDomain =
  | 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip'
  | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';

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

// ─────────────────────────────────────────────────────────────────────────────
// NYAYA TOOLS TYPES (graph, diff, template, timeline, forensic, trail, amend)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE EXTRA TYPES (conflict, amendment, litigation, statute)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY MODULE TYPES
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// SLM TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface JrxSlmAvailability {
  jurisdiction: JrxJurisdiction;
  available: boolean;
  model: string;
  endpoint: string;
  latencyP50Ms: number;
  capacityRemaining: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE TYPES
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
