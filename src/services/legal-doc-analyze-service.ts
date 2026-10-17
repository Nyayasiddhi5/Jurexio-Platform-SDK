// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * JRX-SVC-DOCAI — Legal Document Analysis Service
 * Ported from Legal_Document_Analyzer_AI open-source repository.
 *
 * Capabilities (replacing Superwise AI with callJurexio):
 *  1. Pure parser-based PDF text extraction (pdf-parse — zero Vision AI cost)
 *  2. DOCX text extraction (mammoth)
 *  3. 6-mode structured AI analysis via callJurexio():
 *     - Summary + document type classification
 *     - Key clause extraction (8 clause categories)
 *     - Party-wise obligation extraction with deadlines + consequences
 *     - Risk assessment (High/Medium/Low) with recommendations
 *     - Missing terms detection against 30-clause standard checklist
 *     - Privacy/sensitive data alerts
 *  4. Analysis statistics tracking per org (nv_schema.nv_doc_analysis_stats)
 */

import { callJurexio } from './jrx-client.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createRequire } from 'module';
import { createLogger } from '../utils/logger.js';
import { nvOcrAdapterService } from './document-pipeline/jrx-got-ocr-adapter-service.js';


const logger = createLogger('legal-doc-analyze-service');

const require = createRequire(import.meta.url);

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocumentType =
  | 'NDA' | 'SLA' | 'Employment Contract' | 'Lease Agreement'
  | 'Joint Venture' | 'MoU' | 'Settlement Agreement' | 'Service Agreement'
  | 'Shareholders Agreement' | 'Franchise Agreement' | 'Loan Agreement'
  | 'IP Assignment' | 'Distribution Agreement' | 'Consulting Agreement'
  | 'Partnership Deed' | 'Other';

export type RiskLevel = 'High' | 'Medium' | 'Low';

export interface ExtractedClause {
  type: 'Payment' | 'Termination' | 'Liability' | 'IP' | 'Confidentiality'
      | 'Dispute Resolution' | 'Indemnification' | 'Warranty' | 'Other';
  content: string;
  pageRef?: string;
  importance: 'Critical' | 'High' | 'Medium' | 'Low';
}

export interface PartyObligation {
  party: string;
  obligation: string;
  deadline: string;
  consequence: string;
  obligationType: 'Mandatory' | 'Conditional' | 'Best Efforts';
}

export interface RiskItem {
  riskId: string;
  level: RiskLevel;
  type: string;
  description: string;
  affectedParty: string;
  recommendation: string;
  clauseReference?: string;
}

export interface MissingTerm {
  term: string;
  category: string;
  importance: 'Critical' | 'High' | 'Medium' | 'Low';
  suggestion: string;
  standardLanguage?: string;
}

export interface PrivacyAlert {
  alertType: 'PII' | 'Trade Secret' | 'Financial Data' | 'Health Data' | 'Sensitive Personal';
  severity: 'High' | 'Medium' | 'Low';
  excerpt: string;
  location?: string;
  recommendation: string;
}

export interface DocAnalysisOptions {
  generateSummary?: boolean;
  extractClauses?: boolean;
  identifyObligations?: boolean;
  assessRisks?: boolean;
  findMissingTerms?: boolean;
  detectPrivacyAlerts?: boolean;
  /** EDJ / UX fast path: skip Auto-RAG + elite CoT; use pro tier. */
  fastMode?: boolean;
}

export interface DocAnalysisResult {
  documentType: DocumentType;
  summary?: string;
  keyPoints?: string[];
  wordCount: number;
  pageCount: number;
  clauses?: ExtractedClause[];
  obligations?: PartyObligation[];
  risks?: RiskItem[];
  riskDistribution?: { High: number; Medium: number; Low: number };
  missingTerms?: MissingTerm[];
  privacyAlerts?: PrivacyAlert[];
  confidenceScore: number;
  analysisTimestampMs: number;
  processingTimeMs: number;
  /**
   * NV-ANALYZE-STATUS-005 — which of the six extractors actually completed.
   *
   * Every extractor here runs under `Promise.allSettled` and a rejection is mapped to
   * `[]`. That makes "the document contains no risks" and "the risk extractor threw"
   * the same value, so a consumer (EDJ worker → NSP webhook) cannot tell an empty
   * analysis from a broken one. `failedExtractors` records the rejections by name.
   */
  analysisStatus: 'structured' | 'unstructured' | 'failed';
  analysisStatusReason: string;
  /** Names of the extractors that rejected. Empty when everything ran. */
  failedExtractors: string[];
}

export interface ExtractionResult {
  text: string;
  pageCount: number;
  wordCount: number;
  format: 'pdf' | 'docx';
  extractionMethod: 'parser' | 'ocr_fallback';
}

// ── Standard 30-clause legal checklist ───────────────────────────────────────

export const STANDARD_LEGAL_CHECKLIST: { term: string; category: string; importance: string }[] = [
  { term: 'Force Majeure Clause', category: 'Risk Management', importance: 'High' },
  { term: 'Governing Law & Jurisdiction', category: 'Legal Framework', importance: 'Critical' },
  { term: 'Data Protection / DPDPA Compliance', category: 'Compliance', importance: 'Critical' },
  { term: 'Limitation of Liability', category: 'Risk Management', importance: 'High' },
  { term: 'Dispute Resolution Mechanism', category: 'Legal Framework', importance: 'Critical' },
  { term: 'Assignment & Novation Rights', category: 'Transfer Rights', importance: 'Medium' },
  { term: 'Severability Clause', category: 'Contract Integrity', importance: 'Medium' },
  { term: 'Entire Agreement / Integration Clause', category: 'Contract Integrity', importance: 'High' },
  { term: 'Notice Requirements', category: 'Communication', importance: 'Medium' },
  { term: 'Confidentiality & Non-Disclosure', category: 'Information Protection', importance: 'Critical' },
  { term: 'Intellectual Property Ownership', category: 'IP Rights', importance: 'Critical' },
  { term: 'Indemnification Obligations', category: 'Risk Management', importance: 'High' },
  { term: 'Representations & Warranties', category: 'Assurances', importance: 'High' },
  { term: 'Termination for Cause', category: 'Exit Rights', importance: 'High' },
  { term: 'Termination for Convenience', category: 'Exit Rights', importance: 'Medium' },
  { term: 'Payment Terms & Conditions', category: 'Financial', importance: 'Critical' },
  { term: 'Late Payment Penalties / Interest', category: 'Financial', importance: 'Medium' },
  { term: 'Change Control / Amendment Process', category: 'Contract Management', importance: 'Medium' },
  { term: 'Audit Rights', category: 'Governance', importance: 'Medium' },
  { term: 'Non-Solicitation of Employees', category: 'Employment Protection', importance: 'Medium' },
  { term: 'Non-Compete Obligations', category: 'Competition', importance: 'Medium' },
  { term: 'Liquidated Damages', category: 'Financial Remedy', importance: 'Medium' },
  { term: 'Insurance Requirements', category: 'Risk Management', importance: 'Medium' },
  { term: 'Counterparts / Electronic Signature', category: 'Execution', importance: 'Low' },
  { term: 'Waiver Clause', category: 'Contract Integrity', importance: 'Low' },
  { term: 'Survival Clause', category: 'Contract Integrity', importance: 'Medium' },
  { term: 'Anti-Bribery & Corruption Compliance', category: 'Compliance', importance: 'High' },
  { term: 'Subcontracting / Third Party Rights', category: 'Delegation', importance: 'Medium' },
  { term: 'Escrow / Performance Security', category: 'Financial Security', importance: 'Medium' },
  { term: 'Business Continuity / Disaster Recovery', category: 'Operational Risk', importance: 'Medium' },
];

// ── DB Table Init ─────────────────────────────────────────────────────────────

let tablesReady = false;

async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  try {
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_doc_analysis_stats (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id TEXT NOT NULL,
        doc_type TEXT,
        word_count INT,
        page_count INT,
        risk_distribution JSONB DEFAULT '{"High":0,"Medium":0,"Low":0}',
        missing_terms_count INT DEFAULT 0,
        clauses_found INT DEFAULT 0,
        obligations_found INT DEFAULT 0,
        privacy_alerts_count INT DEFAULT 0,
        confidence_score NUMERIC(5,4) DEFAULT 0,
        processing_time_ms INT DEFAULT 0,
        analyzed_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_doc_stats_org_id
        ON nv_schema.nv_doc_analysis_stats(org_id)
    `);
    tablesReady = true;
  } catch (err: any) {
    logger.error('[JRX-SVC-DOCAI] ensureTables error:', err.message);
  }
}

// ── Text Extraction ───────────────────────────────────────────────────────────

export async function extractTextFromPDF(buffer: Buffer): Promise<ExtractionResult> {
  // pdf-parse v2 is class-based. Digital text layer first (zero OCR cost),
  // then a real OCR fallback for scanned / image-only PDFs.
  const { PDFParse } = await import('pdf-parse');
  let text = '';
  let pageCount = 1;
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const res = await parser.getText();
      text = (res.text || '').trim();
      pageCount = res.total || res.pages.length || 1;
    } finally {
      await parser.destroy().catch(() => undefined);
    }
  } catch (err: any) {
    logger.warn('[JRX-SVC-DOCAI] PDF digital-text extraction failed, attempting OCR:', err?.message);
  }

  const meaningfulChars = text.replace(/\s+/g, '').length;
  if (meaningfulChars >= Math.max(20, pageCount * 10)) {
    return {
      text,
      pageCount,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      format: 'pdf',
      extractionMethod: 'parser',
    };
  }

  // Scanned / image-only PDF — real OCR (throws OcrProviderUnavailableError if no provider).
  const ocr = await nvOcrAdapterService.ocrDocument(buffer, 'application/pdf', {});
  const ocrText = ocr.text.trim();
  return {
    text: ocrText,
    pageCount: ocr.pages.length || pageCount,
    wordCount: ocrText.split(/\s+/).filter(Boolean).length,
    format: 'pdf',
    extractionMethod: 'ocr_fallback',
  };
}

export async function extractTextFromDOCX(buffer: Buffer): Promise<ExtractionResult> {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value || '').trim();
  if (!text) {
    throw new Error('No text could be extracted from the DOCX document');
  }
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return {
    text,
    pageCount: Math.ceil(wordCount / 300),
    wordCount,
    format: 'docx',
    extractionMethod: 'parser',
  };
}

// ── AI Analysis via callJurexio (RAG-grounded when Knowledge Plane on) ──

const DOC_AI_OPTS = {
  maxTokens: 2000,
  tier: 'elite' as const,
  jurisdiction: 'india',
  enableRAG: true,
};

function docAiOpts(extra: Record<string, unknown> = {}, fastMode = false) {
  if (fastMode) {
    return {
      jurisdiction: 'india',
      maxTokens: typeof extra.maxTokens === 'number' ? extra.maxTokens : 1200,
      tier: 'pro' as const,
      enableRAG: false,
      enableOrchestration: false,
      enableCoT: false,
      taskType: extra.taskType,
    };
  }
  return { ...DOC_AI_OPTS, ...extra };
}

async function classifyDocumentType(text: string, fastMode = false): Promise<DocumentType> {
  const truncated = text.substring(0, 3000);
  const result = await callJurexio(
    'legal-document-classifier',
    `You are a legal document classification expert. Analyze the beginning of the document and determine its type.
Reply with ONLY a JSON object: { "documentType": "<type>" }
Valid types: NDA, SLA, Employment Contract, Lease Agreement, Joint Venture, MoU, Settlement Agreement, Service Agreement, Shareholders Agreement, Franchise Agreement, Loan Agreement, IP Assignment, Distribution Agreement, Consulting Agreement, Partnership Deed, Other`,
    `Document text (first 3000 chars):\n\n${truncated}`,
    docAiOpts({ maxTokens: 200 }, fastMode),
  );

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return parsed.documentType as DocumentType || 'Other';
    }
  } catch { /* fallback below */ }
  return 'Other';
}

async function generateSummary(text: string, docType: DocumentType, fastMode = false): Promise<{ summary: string; keyPoints: string[] }> {
  const truncated = text.substring(0, fastMode ? 5000 : 8000);
  const result = await callJurexio(
    'legal-document-summarizer',
    `You are a senior legal analyst specializing in contract law. Provide a concise, accurate executive summary.
Reply with ONLY a JSON object:
{
  "summary": "<2-3 paragraph executive summary>",
  "keyPoints": ["<key point 1>", "<key point 2>", ..., "<key point 8>"]
}`,
    `Document Type: ${docType}\n\nDocument Text:\n\n${truncated}`,
    docAiOpts({ maxTokens: fastMode ? 900 : 1500, taskType: 'document-analysis' }, fastMode),
  );

  try {
    const jsonMatch = result.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  return { summary: result.content.substring(0, 500), keyPoints: [] };
}

async function extractClauses(text: string, fastMode = false): Promise<ExtractedClause[]> {
  const truncated = text.substring(0, fastMode ? 6000 : 10000);
  const result = await callJurexio(
    'legal-clause-extractor',
    `You are a contract specialist. Extract and classify all significant legal clauses from this document.
Reply with ONLY a JSON array:
[{
  "type": "<Payment|Termination|Liability|IP|Confidentiality|Dispute Resolution|Indemnification|Warranty|Other>",
  "content": "<exact clause text or summary>",
  "importance": "<Critical|High|Medium|Low>"
}]
Find ALL significant clauses. Return empty array [] if none found.`,
    `Document text:\n\n${truncated}`,
    docAiOpts({ maxTokens: fastMode ? 1500 : 2500, taskType: 'clause-extraction' }, fastMode),
  );

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  // NV-NSP-CLAUSE-001: never return [] for non-empty contract text.
  try {
    const objMatch = result.content.match(/\{[\s\S]*\}/);
    if (objMatch) {
      const obj = JSON.parse(objMatch[0]);
      if (Array.isArray(obj?.clauses)) return obj.clauses;
    }
  } catch { /* fallback */ }
  return heuristicExtractClauses(truncated);
}

function heuristicExtractClauses(text: string): ExtractedClause[] {
  const patterns: Array<{ re: RegExp; type: ExtractedClause['type']; importance: ExtractedClause['importance'] }> = [
    { re: /\bindemnif/i, type: 'Indemnification', importance: 'Critical' },
    { re: /\bterminat/i, type: 'Termination', importance: 'High' },
    { re: /\bliabilit/i, type: 'Liability', importance: 'Critical' },
    { re: /\bconfidential/i, type: 'Confidentiality', importance: 'High' },
    { re: /\barbitration|dispute resolution|jurisdiction/i, type: 'Dispute Resolution', importance: 'High' },
    { re: /\bpayment|invoice|fee/i, type: 'Payment', importance: 'Medium' },
    { re: /\bintellectual property|\bIP\b/i, type: 'IP', importance: 'High' },
    { re: /\bwarrant/i, type: 'Warranty', importance: 'Medium' },
  ];
  const blocks = String(text || '')
    .split(/(?=\n\s*(?:\d+[\).]|[A-Z][A-Za-z ]{2,40}:)\s*)/)
    .map((b) => b.trim())
    .filter((b) => b.length > 20);
  const out: ExtractedClause[] = [];
  for (const block of (blocks.length ? blocks : [text])) {
    for (const p of patterns) {
      if (!p.re.test(block)) continue;
      out.push({
        type: p.type,
        content: block.length > 400 ? `${block.slice(0, 397)}...` : block,
        importance: p.importance,
      });
      break;
    }
  }
  return out.slice(0, 20);
}

async function identifyObligations(text: string): Promise<PartyObligation[]> {
  const truncated = text.substring(0, 10000);
  const result = await callJurexio(
    'legal-obligation-extractor',
    `You are a contract obligations specialist. Extract all contractual obligations, grouped by party.
Reply with ONLY a JSON array:
[{
  "party": "<party name or role (e.g., 'Service Provider', 'Client', 'Licensor')>",
  "obligation": "<description of the obligation>",
  "deadline": "<deadline or 'Ongoing' or 'Not specified'>",
  "consequence": "<consequence of breach or 'Not specified'>",
  "obligationType": "<Mandatory|Conditional|Best Efforts>"
}]
Return empty array [] if no obligations found.`,
    `Document text:\n\n${truncated}`,
    { maxTokens: 2500, tier: 'elite', jurisdiction: 'india', taskType: 'obligation-analysis', enableRAG: true }
  );

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  return [];
}

async function assessRisks(text: string, docType: DocumentType): Promise<RiskItem[]> {
  const truncated = text.substring(0, 10000);
  const result = await callJurexio(
    'legal-risk-assessor',
    `You are a legal risk management expert. Identify all legal, financial, and operational risks in this document.
Reply with ONLY a JSON array:
[{
  "riskId": "<risk-001, risk-002, etc.>",
  "level": "<High|Medium|Low>",
  "type": "<e.g., 'Payment Risk', 'Liability Risk', 'IP Risk', 'Compliance Risk', 'Termination Risk'>",
  "description": "<detailed description of the risk>",
  "affectedParty": "<which party bears this risk>",
  "recommendation": "<specific actionable recommendation to mitigate this risk>",
  "clauseReference": "<which clause creates this risk, or 'Absence of clause'>"
}]
Return empty array [] if no risks found.`,
    `Document Type: ${docType}\n\nDocument text:\n\n${truncated}`,
    { maxTokens: 2500, tier: 'elite', jurisdiction: 'india', taskType: 'risk-assessment', enableRAG: true }
  );

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  return [];
}

async function detectMissingTerms(text: string, docType: DocumentType): Promise<MissingTerm[]> {
  const truncated = text.substring(0, 10000);
  const checklist = STANDARD_LEGAL_CHECKLIST.map(c => `- ${c.term} (${c.category})`).join('\n');

  const result = await callJurexio(
    'legal-missing-terms-detector',
    `You are a legal compliance expert. Check this ${docType} document against the standard legal clause checklist and identify which important clauses are ABSENT.
Standard checklist:
${checklist}

Reply with ONLY a JSON array of MISSING clauses (do not include clauses that are present):
[{
  "term": "<clause name from checklist>",
  "category": "<category from checklist>",
  "importance": "<Critical|High|Medium|Low>",
  "suggestion": "<specific recommendation for adding this clause>",
  "standardLanguage": "<example standard language for this clause, 2-3 sentences>"
}]
Return empty array [] if all standard clauses are present.`,
    `Document type: ${docType}\n\nDocument text:\n\n${truncated}`,
    { maxTokens: 3000, tier: 'elite', jurisdiction: 'india', taskType: 'compliance-check', enableRAG: true }
  );

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  return [];
}

async function detectPrivacyAlerts(text: string): Promise<PrivacyAlert[]> {
  const truncated = text.substring(0, 8000);
  const result = await callJurexio(
    'legal-privacy-scanner',
    `You are a data protection and privacy law specialist (DPDPA, GDPR). Scan this legal document for privacy risks and sensitive data.
Reply with ONLY a JSON array:
[{
  "alertType": "<PII|Trade Secret|Financial Data|Health Data|Sensitive Personal>",
  "severity": "<High|Medium|Low>",
  "excerpt": "<the concerning text excerpt, max 100 chars>",
  "location": "<location in document: 'Preamble', 'Section X', 'Schedule Y', etc.>",
  "recommendation": "<specific recommendation for handling this sensitivity>"
}]
Return empty array [] if no privacy risks found.`,
    `Document text:\n\n${truncated}`,
    { maxTokens: 1500, tier: 'elite', jurisdiction: 'india', taskType: 'privacy-analysis', enableRAG: true }
  );

  try {
    const jsonMatch = result.content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch { /* fallback */ }
  return [];
}

/**
 * NV-ANALYZE-STATUS-005 — derive the three-way status from settled extractor results.
 *
 * Pure and exported so it can be tested behaviourally. It previously lived inline in
 * `analyzeDocument`, which needs Postgres and an LLM, so the only available test was a
 * source-text grep — and a mutation that gutted the rejection filter kept that grep
 * green. A status field whose logic cannot be exercised is barely better than no
 * status field.
 */
export function deriveAnalysisStatus(
  settled: readonly (readonly [string, { status: 'fulfilled' | 'rejected' }])[],
  hasAnyContent: boolean,
): { analysisStatus: DocAnalysisResult['analysisStatus']; analysisStatusReason: string; failedExtractors: string[] } {
  const failedExtractors = settled
    .filter(([, s]) => s.status === 'rejected')
    .map(([name]) => name);

  if (failedExtractors.length > 0) {
    return {
      analysisStatus: 'failed',
      analysisStatusReason:
        `Extractors failed: ${failedExtractors.join(', ')}. Empty arrays for those sections are missing data, not an empty document.`,
      failedExtractors,
    };
  }
  if (hasAnyContent) {
    return {
      analysisStatus: 'structured',
      analysisStatusReason: 'All requested extractors completed.',
      failedExtractors,
    };
  }
  return {
    analysisStatus: 'unstructured',
    analysisStatusReason:
      'All extractors completed and found nothing; empty arrays are a result, not a failure.',
    failedExtractors,
  };
}

// ── Main Analysis Orchestrator ─────────────────────────────────────────────

export async function analyzeDocument(
  text: string,
  pageCount: number,
  options: DocAnalysisOptions,
  orgId: string
): Promise<DocAnalysisResult> {
  await ensureTables();
  const start = Date.now();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const fastMode = options.fastMode === true;

  const docType = await classifyDocumentType(text, fastMode);

  const [summary, clauses, obligations, risks, missingTerms, privacyAlerts] = await Promise.allSettled([
    options.generateSummary !== false ? generateSummary(text, docType, fastMode) : Promise.resolve(undefined),
    options.extractClauses !== false ? extractClauses(text, fastMode) : Promise.resolve([]),
    options.identifyObligations !== false ? identifyObligations(text) : Promise.resolve([]),
    options.assessRisks !== false ? assessRisks(text, docType) : Promise.resolve([]),
    options.findMissingTerms !== false ? detectMissingTerms(text, docType) : Promise.resolve([]),
    options.detectPrivacyAlerts !== false ? detectPrivacyAlerts(text) : Promise.resolve([]),
  ]);

  const summaryResult = summary.status === 'fulfilled' ? summary.value : undefined;
  const clausesResult = clauses.status === 'fulfilled' ? (clauses.value as ExtractedClause[]) : [];
  const obligationsResult = obligations.status === 'fulfilled' ? (obligations.value as PartyObligation[]) : [];
  const risksResult = risks.status === 'fulfilled' ? (risks.value as RiskItem[]) : [];
  const missingResult = missingTerms.status === 'fulfilled' ? (missingTerms.value as MissingTerm[]) : [];
  const privacyResult = privacyAlerts.status === 'fulfilled' ? (privacyAlerts.value as PrivacyAlert[]) : [];

  /* NV-ANALYZE-STATUS-005 — capture the rejections the `[]` defaults above erase.
   * Without this, a document whose risk extractor threw is indistinguishable from a
   * document that genuinely has no risks, which is the ambiguity NSP reported. */
  const settledByName = [
    ['summary', summary],
    ['clauses', clauses],
    ['obligations', obligations],
    ['risks', risks],
    ['missingTerms', missingTerms],
    ['privacyAlerts', privacyAlerts],
  ] as const;

  const statusBlock = deriveAnalysisStatus(
    settledByName,
    Boolean(
      clausesResult.length
      || obligationsResult.length
      || risksResult.length
      || missingResult.length
      || privacyResult.length
      || summaryResult?.summary,
    ),
  );

  for (const [name, settled] of settledByName) {    if (settled.status === 'rejected') {
      logger.warn('[JRX-SVC-DOCAI] extractor rejected', {
        extractor: name,
        err: settled.reason instanceof Error ? settled.reason.message : String(settled.reason),
      });
    }
  }

  const riskDist = { High: 0, Medium: 0, Low: 0 };
  for (const r of risksResult) {
    if (r.level in riskDist) riskDist[r.level as RiskLevel]++;
  }

  const confidenceScore = Math.min(
    0.95,
    0.5 + (clausesResult.length > 0 ? 0.15 : 0) + (obligationsResult.length > 0 ? 0.1 : 0) + (wordCount > 500 ? 0.1 : 0) + (pageCount > 1 ? 0.1 : 0)
  );

  const processingTimeMs = Date.now() - start;

  try {
    await db.execute(sql`
      INSERT INTO nv_schema.nv_doc_analysis_stats
        (org_id, doc_type, word_count, page_count, risk_distribution,
         missing_terms_count, clauses_found, obligations_found,
         privacy_alerts_count, confidence_score, processing_time_ms)
      VALUES (
        ${orgId}, ${docType}, ${wordCount}, ${pageCount},
        ${JSON.stringify(riskDist)}::jsonb,
        ${missingResult.length}, ${clausesResult.length},
        ${obligationsResult.length}, ${privacyResult.length},
        ${confidenceScore}, ${processingTimeMs}
      )
    `);
  } catch (err: any) {
    logger.error('[JRX-SVC-DOCAI] stats insert error:', err.message);
  }

  return {
    documentType: docType,
    summary: summaryResult?.summary,
    keyPoints: summaryResult?.keyPoints,
    wordCount,
    pageCount,
    clauses: clausesResult,
    obligations: obligationsResult,
    risks: risksResult,
    riskDistribution: riskDist,
    missingTerms: missingResult,
    privacyAlerts: privacyResult,
    confidenceScore,
    analysisTimestampMs: Date.now(),
    processingTimeMs,
    ...statusBlock,
  };
}

export async function getAnalysisStats(orgId: string): Promise<{
  totalAnalyzed: number;
  riskDistribution: { High: number; Medium: number; Low: number };
  docTypeBreakdown: Record<string, number>;
  avgConfidence: number;
  avgProcessingMs: number;
}> {
  await ensureTables();
  try {
    const rows = await db.execute(sql`
      SELECT
        COUNT(*) AS total,
        AVG(confidence_score) AS avg_confidence,
        AVG(processing_time_ms) AS avg_processing_ms,
        SUM((risk_distribution->>'High')::int) AS total_high,
        SUM((risk_distribution->>'Medium')::int) AS total_medium,
        SUM((risk_distribution->>'Low')::int) AS total_low
      FROM nv_schema.nv_doc_analysis_stats
      WHERE org_id = ${orgId}
    `);
    const typeRows = await db.execute(sql`
      SELECT doc_type, COUNT(*) AS cnt
      FROM nv_schema.nv_doc_analysis_stats
      WHERE org_id = ${orgId}
      GROUP BY doc_type
      ORDER BY cnt DESC
    `);

    const r = (rows as any).rows?.[0] || {};
    const docTypeBreakdown: Record<string, number> = {};
    for (const row of ((typeRows as any).rows || [])) {
      docTypeBreakdown[row.doc_type || 'Unknown'] = parseInt(row.cnt);
    }

    return {
      totalAnalyzed: parseInt(r.total) || 0,
      riskDistribution: {
        High: parseInt(r.total_high) || 0,
        Medium: parseInt(r.total_medium) || 0,
        Low: parseInt(r.total_low) || 0,
      },
      docTypeBreakdown,
      avgConfidence: parseFloat(r.avg_confidence) || 0,
      avgProcessingMs: parseFloat(r.avg_processing_ms) || 0,
    };
  } catch (err: any) {
    logger.error('[JRX-SVC-DOCAI] getAnalysisStats error:', err.message);
    return { totalAnalyzed: 0, riskDistribution: { High: 0, Medium: 0, Low: 0 }, docTypeBreakdown: {}, avgConfidence: 0, avgProcessingMs: 0 };
  }
}

export const legalDocAnalyzeService = {
  extractTextFromPDF,
  extractTextFromDOCX,
  analyzeDocument,
  getAnalysisStats,
  STANDARD_LEGAL_CHECKLIST,
};
