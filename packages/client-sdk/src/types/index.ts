/**
 * @jurexio/client-sdk — Core Type Definitions
 * Jurexio Enterprise Platform 312 — All rights reserved
 */

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeout?: number;
  /** Queen /api/jrx/orchestrate timeout (default 600_000 ms). */
  orchestrateTimeoutMs?: number;
  defaultJurisdiction?: NyvJurisdiction;
  defaultPlatform?: NyvPlatform;
  defaultAgentId?: string;
  debug?: boolean;
  /** NSP shared-docs header, e.g. nyayasiddhi-professional/1.0.0 */
  platformClient?: string;
  /** East-west inter-service secret → `X-NSP-Inter-Secret` (alias `X-Inter-Service-Secret`). */
  interServiceSecret?: string;
  /** SDK version override (defaults to NyvClient.VERSION). */
  version?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOMAIN ENUMS
// ─────────────────────────────────────────────────────────────────────────────

export type NyvJurisdiction = 'IN' | 'UK' | 'US' | 'GC' | 'EU' | 'SG';

export type NyvPlatform =
  | 'nyayamitra'
  | 'nys-professional'
  | 'nys-institutional'
  | 'nys-academy'
  | 'nys-ministry';

export type NyvAgentPattern =
  | 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08'
  | 'P09' | 'P10' | 'P11' | 'P12' | 'P13' | 'P14' | 'P15' | 'P16'
  | 'P17' | 'P18' | 'P19' | 'P20' | 'P21' | 'P22';

export type NyvRiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MINIMAL';

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvBasePatternRequest {
  task: string;
  agentId?: string;
  jurisdiction?: NyvJurisdiction;
  platform?: NyvPlatform;
  context?: Record<string, unknown>;
}

export interface NyvPatternResponse {
  pattern: string;
  traceId: string;
  agentId?: string;
  jurisdiction?: NyvJurisdiction;
  result?: string;
  legalPosition?: string;
  reasoning?: string | string[];
  citations?: NyvCitation[];
  risks?: NyvRiskAssessment[];
  recommendation?: string;
  confidenceScore?: number;
  performanceMs?: number;
  [key: string]: unknown;
}

export interface NyvCitation {
  statute?: string;
  section?: string;
  case?: string;
  court?: string;
  year?: number | string;
  relevance?: string;
  url?: string;
}

export interface NyvRiskAssessment {
  type: string;
  level: NyvRiskLevel;
  description: string;
  mitigation?: string;
  probability?: number;
}

// Pattern-specific request extensions
export interface ReActRequest extends NyvBasePatternRequest {
  maxIterations?: number;
  tools?: string[];
}

export interface ToTRequest extends NyvBasePatternRequest {
  numBranches?: number;
  evaluationDepth?: number;
}

export interface GRPORequest extends NyvBasePatternRequest {
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

export interface DigitalTwinRequest extends NyvBasePatternRequest {
  twinPersona?: 'managing-partner' | 'senior-litigator' | 'compliance-head';
  domainExpertise?: string;
  yearsExperience?: number;
  scenarioType?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvDocumentUploadResponse {
  success: boolean;
  docId: string;
  jobId: string;
  statusUrl: string;
  async?: boolean;
  message?: string;
}

export interface NyvDocumentStatus {
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

export interface NyvDocumentSearchResult {
  results: NyvDocumentChunk[];
  query: string;
  totalResults: number;
  searchTimeMs: number;
}

export interface NyvDocumentChunk {
  docId: string;
  chunkId: string;
  content: string;
  score: number;
  metadata?: Record<string, unknown>;
  fileName?: string;
  pageNumber?: number;
}

export interface NyvDocumentAnalysis {
  success: boolean;
  analysis: {
    summary?: string;
    documentType?: string;
    parties?: string[];
    clauses?: Array<{ type: string; content: string; risk?: string }>;
    obligations?: Array<{ party: string; obligation: string; deadline?: string }>;
    risks?: NyvRiskAssessment[];
    missingTerms?: string[];
    privacyAlerts?: string[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// AGENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvAgent {
  agentId: string;
  name: string;
  type: string;
  pattern?: NyvAgentPattern;
  jurisdiction?: NyvJurisdiction[];
  status: 'active' | 'inactive' | 'training';
  description?: string;
  capabilities?: string[];
}

export interface NyvAgentExecution {
  executionId: string;
  agentId: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  result?: NyvPatternResponse;
  startedAt: string;
  completedAt?: string;
  latencyMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SKILL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvSkill {
  skillId: string;
  name: string;
  description: string;
  category: string;
  agentPattern?: NyvAgentPattern;
  jurisdiction?: NyvJurisdiction[];
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

export interface NyvSkillExecution {
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

export interface NyvDigitalTwin {
  twinId: string;
  name: string;
  persona: string;
  expertise: string;
  jurisdiction: NyvJurisdiction;
  state: Record<string, unknown>;
  createdAt: string;
  lastSimulatedAt?: string;
}

export interface NyvTwinSimulationResult {
  twinId: string;
  scenarioId: string;
  scenario: string;
  outcomes: Array<{
    description: string;
    probability: number;
    reasoning: string;
    timeline?: string;
    risks?: NyvRiskAssessment[];
  }>;
  recommendation: string;
  confidence: number;
  simulatedAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE / RAG TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvKnowledgeSearchRequest {
  query: string;
  jurisdiction?: NyvJurisdiction;
  limit?: number;
  searchMode?: 'hybrid' | 'semantic' | 'keyword';
  filters?: {
    docType?: string;
    dateFrom?: string;
    dateTo?: string;
    tags?: string[];
  };
}

export interface NyvKnowledgeSearchResponse {
  results: NyvDocumentChunk[];
  query: string;
  totalResults: number;
  searchTimeMs: number;
  jurisdiction: NyvJurisdiction;
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING / AG-UI TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type NyvStreamEventType =
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

export interface NyvStreamEvent {
  type: NyvStreamEventType;
  traceId?: string;
  agentId?: string;
  pattern?: string;
  data?: unknown;
  timestamp?: string;
  sequence?: number;
}

export interface NyvThinkingStepEvent extends NyvStreamEvent {
  type: 'thinking_step';
  data: { step: string; index: number; total: number };
}

export interface NyvTextDeltaEvent extends NyvStreamEvent {
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

export interface NyvRunFinishedEvent extends NyvStreamEvent {
  type: 'run_finished';
  data: { result: NyvPatternResponse; latencyMs: number };
}

/** T002 — Specialized pattern mechanics event (P01-P10) */
export interface NyvPatternSpecializedEvent {
  type: 'pattern_event';
  subtype: string;
  label: string;
  pattern: string;
  runId: string;
  timestamp: string;
  [key: string]: unknown;
}

export interface NyvStreamHandlers {
  onStart?: (event: NyvStreamEvent) => void;
  /** Fired when Queen selects / starts a specialist agent (AG-UI agent_selected). */
  onAgentSelected?: (agent: string, event: NyvStreamEvent) => void;
  onThinking?: (step: string, index: number, total: number) => void;
  onToolCall?: (tool: string, input: unknown) => void;
  onToolResult?: (tool: string, result: unknown) => void;
  onTextDelta?: (
    delta: string,
    accumulated: string,
    meta?: { provisional?: boolean; gated?: boolean },
  ) => void;
  onComplete?: (result: NyvPatternResponse) => void;
  onError?: (error: NyvApiError) => void;
  /** T002 — Fired for P01-P10 specialized events (react_cycle, reasoning_step, branch_evaluated, etc.) */
  onPatternEvent?: (event: NyvPatternSpecializedEvent) => void;
  /** Fired for all metadata events emitted during AG-UI streaming */
  onMetadata?: (event: NyvStreamEvent) => void;
  /** Fired for each citation block emitted during streaming */
  onCitationBlock?: (citations: unknown[]) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// VOICE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvVoiceSynthesisRequest {
  text: string;
  voice?: string;
  language?: 'en' | 'hi' | 'ta' | 'te' | 'ml' | 'kn' | 'mr' | 'bn';
  speed?: number;
  pitch?: number;
  format?: 'mp3' | 'wav' | 'ogg';
}

export interface NyvVoiceSynthesisResponse {
  audioBase64: string;
  format: string;
  durationMs: number;
  characters: number;
  voice: string;
}

export interface NyvVoiceTranscriptionResponse {
  text: string;
  language: string;
  confidence: number;
  words?: Array<{ word: string; start: number; end: number }>;
  durationMs: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvApiError {
  code: string;
  message: string;
  status: number;
  traceId?: string;
  details?: unknown;
}

export class NyvError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly traceId?: string;
  public readonly details?: unknown;

  constructor(err: NyvApiError) {
    super(err.message);
    this.name = 'NyvError';
    this.code = err.code;
    this.status = err.status;
    this.traceId = err.traceId;
    this.details = err.details;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PAGINATION
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvListResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface NyvPaginationOptions {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// ─────────────────────────────────────────────────────────────────────────────
// D5-D6 INTELLIGENCE + TESTING + COMPLIANCE TYPES (SDK v6.0)
// ─────────────────────────────────────────────────────────────────────────────

export type NyvLegalDomain =
  | 'criminal' | 'civil' | 'corporate' | 'tax' | 'ip'
  | 'family' | 'constitutional' | 'labour' | 'banking' | 'other';

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

// ─────────────────────────────────────────────────────────────────────────────
// NYAYA TOOLS TYPES (graph, diff, template, timeline, forensic, trail, amend)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// INTELLIGENCE EXTRA TYPES (conflict, amendment, litigation, statute)
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// MEMORY MODULE TYPES
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// SLM TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface NyvSlmAvailability {
  jurisdiction: NyvJurisdiction;
  available: boolean;
  model: string;
  endpoint: string;
  latencyP50Ms: number;
  capacityRemaining: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CACHE TYPES
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT TYPES
// ─────────────────────────────────────────────────────────────────────────────

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
