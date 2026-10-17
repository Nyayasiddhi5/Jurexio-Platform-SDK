export type Jurisdiction = "IN" | "US";

export interface CaselawDoc {
  id: number | null;
  jurisdiction: string;
  source: string;
  title: string;
  petitioner: string | null;
  respondent: string | null;
  judges: string | null;
  authorJudge: string | null;
  citation: string | null;
  cnr: string | null;
  decisionDate: string | null;
  disposalNature: string | null;
  court: string | null;
  year: number | null;
  languages: string[];
  description: string | null;
  url: string | null;
}

export interface CaselawSearchResponse {
  jurisdiction: string;
  total: number;
  results: CaselawDoc[];
}

export interface VerifyCitationResult {
  status: "verified" | "not_found" | "uncertain";
  note: string | null;
  matches: CaselawDoc[];
}

export interface CaselawSourceStat {
  source: string;
  jurisdiction: string;
  documentCount: number;
  minYear: number | null;
  maxYear: number | null;
}

export interface CaselawStats {
  totalDocuments: number;
  sources: CaselawSourceStat[];
  usLive: boolean;
}

export interface Authority {
  title: string;
  citation: string | null;
  court: string | null;
  date: string | null;
  url: string | null;
  source: string;
}

export interface Criterion {
  id: string;
  title: string;
  matchCriteria: string;
}

export interface LegalTask {
  id: number;
  category: string;
  categoryName: string;
  slug: string;
  title: string;
  workType: string;
  tags: string[];
  instructions: string;
  deliverables: string[];
  documents: string[];
  criteriaCount: number;
}

export interface LegalTaskDetail extends Omit<LegalTask, "criteriaCount"> {
  criteria: Criterion[];
}

export interface Category {
  slug: string;
  name: string;
  taskCount: number;
  workTypes: Array<{ workType: string; count: number }>;
}

export interface EvaluationResult {
  criterionId: string;
  title: string;
  passed: boolean;
  rationale: string;
}

export interface Evaluation {
  runId: number;
  score: number;
  passCount: number;
  totalCount: number;
  results: EvaluationResult[];
}

export interface Run {
  id: number;
  taskId: number | null;
  title: string;
  category: string;
  categoryName: string;
  workType: string;
  instruction: string;
  context: string | null;
  status: string;
  output: string | null;
  score: number | null;
  createdAt: string;
}

export interface RunDetail extends Run {
  criteria: Criterion[];
  evaluation: Evaluation | null;
  authorities?: Authority[];
}

export interface CreateRunInput {
  taskId?: number | null;
  title: string;
  category: string;
  workType: string;
  instruction: string;
  context?: string;
}

export type ChatAction =
  | "chat"
  | "summary"
  | "extract"
  | "case_details"
  | "draft"
  | "intelligence"
  | "predictions";

export type ChatOutputFormat = "brief" | "detailed";

export interface ChatConversation {
  id: number;
  title: string;
  outputFormat: ChatOutputFormat;
  messageCount: number;
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  role: "user" | "assistant";
  action: ChatAction;
  content: string;
  structured: Record<string, unknown> | null;
  createdAt: string;
}

export interface ChatDocument {
  id: number;
  conversationId: number;
  filename: string;
  mimeType: string;
  byteSize: number;
  textLength: number;
  preview: string;
  createdAt: string;
}

export interface ChatConversationDetail {
  id: number;
  title: string;
  outputFormat: ChatOutputFormat;
  messages: ChatMessage[];
  documents: ChatDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatExchange {
  userMessage: ChatMessage;
  assistantMessage: ChatMessage;
}

export interface ChatConversationInput {
  title?: string;
  outputFormat?: ChatOutputFormat;
}

export interface ChatConversationUpdate {
  title?: string;
  outputFormat?: ChatOutputFormat;
}

export interface ChatMessageInput {
  content: string;
  action?: ChatAction;
  outputFormat?: ChatOutputFormat;
  /** Optional drafting template id — the draft action uses its body as a structural skeleton. */
  templateId?: number;
}

export interface ChatDocumentInput {
  filename: string;
  contentBase64: string;
}

/**
 * Statute code tag. Core codes: BNS, BNSS, BSA, IPC, CRPC, IEA, USC, COI
 * (Constitution of India). India Code central Acts use act-title slugs
 * (e.g. "COMPANIES-ACT-2013").
 */
export type StatuteCode = string;

export interface Statute {
  id: number;
  code: string;
  jurisdiction: string;
  section: string;
  uscTitle: string | null;
  heading: string;
  chapter: string | null;
  text: string;
  mappedCode: string | null;
  mappedSections: string[];
  changeNotes: string | null;
  actName?: string | null;
  actYear?: string | null;
  actNo?: string | null;
  ministry?: string | null;
  practiceArea?: string | null;
  provisionType?: string;
  enactmentDate?: string | null;
}

export interface StatuteSearchResponse {
  total: number;
  results: Statute[];
}

export interface StatuteAct {
  code: string;
  actName: string;
  jurisdiction: string;
  actYear: string | null;
  actNo: string | null;
  ministry: string | null;
  practiceArea: string | null;
  enactmentDate: string | null;
  sectionCount: number;
}

export interface StatuteActsResponse {
  total: number;
  totalSections: number;
  practiceAreas: string[];
  results: StatuteAct[];
}

export interface IpcBnsComparison {
  ipcSection: string;
  found: boolean;
  ipc: Statute | null;
  bnsMatches: Statute[];
  changeNotes: string | null;
}

export interface OldNewComparison {
  oldCode: string;
  newCode: string;
  oldSection: string;
  found: boolean;
  matches: Statute[];
}

export interface ExtractedCitation {
  raw: string;
  normalized: string;
  jurisdiction: "IN" | "US";
  reporter: string;
  volume: string | null;
  year: number | null;
  page: string | null;
  court: string | null;
  matches: CaselawDoc[];
}

export interface ExtractCitationsResult {
  total: number;
  citations: ExtractedCitation[];
}

export interface SimilarCasesResult {
  documentId: number;
  method: "vector" | "fts";
  provider: string;
  results: CaselawDoc[];
}

export interface NewOldComparison {
  newCode: string;
  oldCode: string;
  newSection: string;
  found: boolean;
  statute: Statute | null;
  oldSections: string[];
  matches: Statute[];
}

export interface RetrievalStep {
  tool:
    | "citation-lookup"
    | "statute-lookup"
    | "ipc-bns-compare"
    | "old-new-compare"
    | "new-old-compare"
    | "case-search";
  citations?: ExtractedCitation[];
  matches?: CaselawDoc[];
  statutes?: Statute[];
  comparison?: IpcBnsComparison;
  oldNew?: OldNewComparison;
  newOld?: NewOldComparison;
  jurisdiction?: string;
  results?: CaselawDoc[];
}

export interface RetrievalPlan {
  query: string;
  intent:
    | "citation"
    | "statute"
    | "ipc-bns-compare"
    | "old-new-compare"
    | "new-old-compare"
    | "case-search"
    | "generate";
  steps: RetrievalStep[];
  llmRequired: boolean;
  reason: string;
}

export type TemplateKind = "template" | "checklist";

export interface TemplateSummary {
  id: number;
  kind: TemplateKind;
  slug: string;
  title: string;
  category: string;
  jurisdiction: string;
  description: string;
  tags: string[];
}

export interface TemplateDetail extends TemplateSummary {
  body: string;
}

export interface UsageTotals {
  totalRequests: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  errorCount: number;
}

export interface UsageByFeature {
  feature: string;
  count: number;
  avgLatencyMs: number | null;
}

export interface UsageByJurisdiction {
  jurisdiction: string;
  count: number;
}

export interface UsageByDay {
  day: string;
  count: number;
  avgLatencyMs: number | null;
}

export interface ScoreByDay {
  day: string;
  avgScore: number | null;
  runCount: number;
}

export interface UsageByModel {
  model: string | null;
  count: number;
  avgLatencyMs: number | null;
}

export interface UsageAnalytics {
  windowDays: number;
  totals: UsageTotals;
  byFeature: UsageByFeature[];
  byJurisdiction: UsageByJurisdiction[];
  byModel: UsageByModel[];
  byDay: UsageByDay[];
  scoresOverTime: ScoreByDay[];
}

export interface AdviseInput {
  question: string;
  jurisdiction?: "IN" | "US";
  context?: string;
}

export interface AdviseResult {
  jurisdiction: string;
  assessment: string;
  keyIssues: string[];
  strategy: string;
  risks: string[];
  recommendedActions: string[];
  authorities: Authority[];
  statutes: Statute[];
  disclaimer: string;
}

/** Events emitted by the SSE streaming endpoints. */
export type StreamEvent<TDone = unknown> =
  | { type: "status"; stage: string }
  | { type: "delta"; text: string }
  | { type: "done"; payload: TDone }
  | { type: "error"; error: string };
