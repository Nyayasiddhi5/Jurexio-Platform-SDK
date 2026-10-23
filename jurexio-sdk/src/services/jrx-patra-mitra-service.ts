/**
 * NV-PATRA-MITRA-001 — Patra Mitra (Document Companion)
 *
 * Unified partner feature: parse any document (PDF/DOCX/images + OCR) →
 * structured fields + counsel summary → grounded Q&A over the same session.
 */
import crypto from 'crypto';
import { createLogger } from '../utils/logger.js';
import { extractDocumentText } from './sdk/jrx-doc-content-extractor.js';
import { extractCourtDocumentFields } from './jrx-court-document-fields.js';
import { type LLMRequest } from './real-llm-service.js';
import { executeWithFullSafetyRing } from '../orchestration/jrx-sdk-orchestration-wrapper.js';
import { sanitizeOrchestrationContentForClient } from '../utils/jrx-client-outcome-sanitize.js';
import {
  loadPatraMitraSession,
  listPatraMitraSessionsFromDb,
  persistPatraMitraSession,
  pruneExpiredPatraMitraSessions,
} from './jrx-patra-mitra-session-store.js';

const logger = createLogger('./jrx-patra-mitra');

const SESSION_TTL_MS = Number(process.env.JRX_PATRA_MITRA_TTL_MS || 2 * 60 * 60 * 1000);
const MAX_DOC_CHARS = Number(process.env.JRX_PATRA_MITRA_MAX_CHARS || 120_000);
const MAX_CHAT_HISTORY = 12;

export interface PatraMitraField {
  key: string;
  label: string;
  value: string;
  confidence?: number;
}

export interface PatraMitraChatTurn {
  role: 'user' | 'assistant';
  content: string;
  at: string;
}

export interface PatraMitraSession {
  sessionId: string;
  orgId?: string;
  platformCode?: string;
  fileName: string;
  mimeType?: string;
  jurisdiction: string;
  extractionMethod: string;
  format: string;
  warnings: string[];
  text: string;
  textPreview: string;
  characterCount: number;
  wordCount: number;
  fields: PatraMitraField[];
  summary: string;
  keyPoints: string[];
  documentType?: string;
  /** Detected writing system / language cues (e.g. en, hi, te, mixed) */
  detectedLanguage?: string;
  languageLabel?: string;
  chat: PatraMitraChatTurn[];
  toolRuns?: Array<{ tool: string; at: string; result: Record<string, unknown> }>;
  extractionPath?: string | null;
  docparseMeta?: Record<string, unknown> | null;
  tables?: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
  expiresAt: number;
}

export type PatraMitraToolId =
  | 'detect_language'
  | 'extract_parties'
  | 'extract_dates'
  | 'extract_amounts'
  | 'extract_citations'
  | 'find_clauses'
  | 'pii_scan'
  | 'regenerate_summary'
  | 'export_fields';

export const PATRA_MITRA_TOOLS: Array<{
  id: PatraMitraToolId;
  label: string;
  description: string;
}> = [
  { id: 'detect_language', label: 'Detect language', description: 'Script / language cues (EN + Indic)' },
  { id: 'extract_parties', label: 'Extract parties', description: 'Names and party labels from the text' },
  { id: 'extract_dates', label: 'Extract dates', description: 'All date-like mentions' },
  { id: 'extract_amounts', label: 'Extract amounts', description: 'Currency and numeric considerations' },
  { id: 'extract_citations', label: 'Citations & CNR', description: 'Sections, case numbers, CNR patterns' },
  { id: 'find_clauses', label: 'Find key clauses', description: 'Termination, indemnity, confidentiality cues' },
  { id: 'pii_scan', label: 'PII scan', description: 'Emails, phones, ID-like patterns (flag only)' },
  { id: 'regenerate_summary', label: 'Regenerate summary', description: 'Counsel summary in chosen language' },
  { id: 'export_fields', label: 'Export fields', description: 'JSON snapshot of structured fields' },
];

function detectDocumentLanguage(text: string): { code: string; label: string } {
  const sample = text.slice(0, 8000);
  const counts: Array<{ code: string; label: string; re: RegExp }> = [
    { code: 'hi', label: 'Hindi (Devanagari)', re: /[\u0900-\u097F]/g },
    { code: 'bn', label: 'Bengali', re: /[\u0980-\u09FF]/g },
    { code: 'gu', label: 'Gujarati', re: /[\u0A80-\u0AFF]/g },
    { code: 'pa', label: 'Punjabi (Gurmukhi)', re: /[\u0A00-\u0A7F]/g },
    { code: 'or', label: 'Odia', re: /[\u0B00-\u0B7F]/g },
    { code: 'ta', label: 'Tamil', re: /[\u0B80-\u0BFF]/g },
    { code: 'te', label: 'Telugu', re: /[\u0C00-\u0C7F]/g },
    { code: 'kn', label: 'Kannada', re: /[\u0C80-\u0CFF]/g },
    { code: 'ml', label: 'Malayalam', re: /[\u0D00-\u0D7F]/g },
  ];
  const scored = counts
    .map((c) => ({ code: c.code, label: c.label, n: (sample.match(c.re) || []).length }))
    .filter((c) => c.n > 20)
    .sort((a, b) => b.n - a.n);
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  if (!scored.length) {
    return { code: 'en', label: latin > 40 ? 'English (Latin)' : 'Unknown / mixed' };
  }
  if (latin > scored[0].n * 2) {
    return { code: 'mixed', label: `Mixed · ${scored[0].label} + English` };
  }
  if (scored.length > 1 && scored[1].n > scored[0].n * 0.4) {
    return { code: 'mixed', label: `Mixed · ${scored[0].label} + ${scored[1].label}` };
  }
  return { code: scored[0].code, label: scored[0].label };
}

const sessions = new Map<string, PatraMitraSession>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt < now) sessions.delete(id);
  }
  void pruneExpiredPatraMitraSessions();
}

async function saveSession(session: PatraMitraSession): Promise<void> {
  sessions.set(session.sessionId, session);
  await persistPatraMitraSession(session);
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

function buildLLMRequest(prompt: string, systemPrompt: string, maxTokens = 4096): LLMRequest {
  return {
    id: genId('pm_llm'),
    userId: 'patra-mitra',
    prompt,
    systemPrompt,
    maxTokens,
    temperature: 0.25,
    requirements: {
      complexity: 'complex',
      domain: 'analytical',
      priority: 'high',
      costBudget: 'balanced',
      responseTime: 'balanced',
      qualityLevel: 'expert',
    },
    fallbackLevels: 3,
    timestamp: new Date(),
  };
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (!m) return null;
    return JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function heuristicFields(text: string, fileName: string): PatraMitraField[] {
  const fields: PatraMitraField[] = [
    { key: 'fileName', label: 'File name', value: fileName, confidence: 1 },
  ];
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) fields.push({ key: 'email', label: 'Email', value: email[0], confidence: 0.7 });
  const dates = text.match(
    /\b(?:\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-z]{3,9})[\/\-.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})\b/gi,
  );
  if (dates?.length) {
    fields.push({
      key: 'dates',
      label: 'Dates mentioned',
      value: [...new Set(dates)].slice(0, 8).join('; '),
      confidence: 0.55,
    });
  }
  const money = text.match(/(?:₹|Rs\.?|INR|USD|\$)\s?[\d,]+(?:\.\d+)?/gi);
  if (money?.length) {
    fields.push({
      key: 'amounts',
      label: 'Amounts',
      value: [...new Set(money)].slice(0, 8).join('; '),
      confidence: 0.55,
    });
  }
  const sections = text.match(/\b(?:Section|Sec\.?|§)\s*\d+[A-Za-z]?\b/gi);
  if (sections?.length) {
    fields.push({
      key: 'sections',
      label: 'Sections cited',
      value: [...new Set(sections)].slice(0, 12).join('; '),
      confidence: 0.6,
    });
  }
  return fields;
}

async function llmFieldsAndSummary(
  text: string,
  jurisdiction: string,
  fileName: string,
  ctx: Record<string, unknown>,
): Promise<{
  fields: PatraMitraField[];
  summary: string;
  keyPoints: string[];
  documentType?: string;
}> {
  const slice = text.slice(0, 14_000);
  const req = buildLLMRequest(
    `Analyse this ${jurisdiction} legal/business document ("${fileName}").\n\nDocument:\n${slice}`,
    `You are a senior Indian counsel document analyst for Jurexio Patra Mitra.
Return ONLY valid JSON:
{
  "documentType": "short type e.g. NDA, FIR, lease, judgment, invoice, petition, correspondence, other",
  "summary": "structured markdown summary (parties, purpose, key terms, dates, risks) — counsel register, no chatbot filler",
  "keyPoints": ["3-8 crisp bullets"],
  "fields": [{"key":"snake_case","label":"Human label","value":"extracted value","confidence":0.0-1.0}]
}
Extract parties, dates, jurisdiction cues, amounts, case/FIR numbers, obligations when present.
Never invent facts not supported by the text.`,
  );

  try {
    const llm = await executeWithFullSafetyRing(req, {
      ctx,
      sdkPlatform: 'patra-mitra',
      agentKey: 'document-analyst',
      jurisdiction,
      taskType: 'document_intelligence',
      domainContext: `${jurisdiction} Patra Mitra document parse`,
      enableMemory: false,
      enableRAG: false,
    });
    const parsed = parseJsonObject(llm.content);
    if (parsed) {
      const fieldsRaw = Array.isArray(parsed.fields) ? parsed.fields : [];
      const fields: PatraMitraField[] = fieldsRaw
        .filter((f: any) => f && (f.value != null || f.label))
        .map((f: any) => ({
          key: String(f.key || f.label || 'field').replace(/\s+/g, '_').toLowerCase(),
          label: String(f.label || f.key || 'Field'),
          value: String(f.value ?? '').trim(),
          confidence: typeof f.confidence === 'number' ? f.confidence : 0.75,
        }))
        .filter((f) => f.value);
      const summary = sanitizeOrchestrationContentForClient(String(parsed.summary || llm.content));
      const keyPoints = Array.isArray(parsed.keyPoints)
        ? parsed.keyPoints.map((k) => String(k)).filter(Boolean).slice(0, 10)
        : [];
      return {
        fields: fields.length ? fields : heuristicFields(text, fileName),
        summary: summary || text.slice(0, 600),
        keyPoints,
        documentType: parsed.documentType ? String(parsed.documentType) : undefined,
      };
    }
    return {
      fields: heuristicFields(text, fileName),
      summary: sanitizeOrchestrationContentForClient(llm.content) || text.slice(0, 600),
      keyPoints: [],
    };
  } catch (err: any) {
    logger.warn('[PatraMitra] LLM fields/summary failed — heuristic fallback', {
      err: err?.message,
    });
    const words = text.trim().split(/\s+/).filter(Boolean);
    return {
      fields: heuristicFields(text, fileName),
      summary: words.slice(0, 180).join(' ') + (words.length > 180 ? '…' : ''),
      keyPoints: words.filter((w) => w.length > 5).slice(0, 5),
    };
  }
}

export class PatraMitraService {
  async createSession(input: {
    base64?: string;
    content?: string;
    fileName?: string;
    mimeType?: string;
    jurisdiction?: string;
    orgId?: string;
    platformCode?: string;
    userId?: string;
    sdkContext?: Record<string, unknown>;
  }): Promise<PatraMitraSession> {
    pruneExpired();
    const fileName = input.fileName || 'document.pdf';
    const jurisdiction = (input.jurisdiction || 'IN').toUpperCase();

    const extracted = await extractDocumentText({
      base64: input.base64,
      content: input.content,
      fileName,
      mimeType: input.mimeType,
    });

    let text = extracted.text.slice(0, MAX_DOC_CHARS);
    if (extracted.text.length > MAX_DOC_CHARS) {
      extracted.warnings.push(`Document truncated to ${MAX_DOC_CHARS} characters for analysis`);
    }

    /* NV-DOCPARSE-ADAPTER-001 — court fields via docparse when bytes + IN jurisdiction. */
    let courtFieldsBlock: Record<string, unknown> = {};
    let docparseFields: PatraMitraField[] = [];
    try {
      let sourceBytes: Buffer | undefined;
      if (input.base64) {
        sourceBytes = Buffer.from(input.base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
      }
      if (sourceBytes?.length) {
        const courtExtraction = await extractCourtDocumentFields(text, jurisdiction, {
          bytes: sourceBytes,
          fileName,
          mimeType: input.mimeType,
          batchId: genId('pm_doc'),
          actor: input.orgId ? `org:${input.orgId}` : 'patra-mitra',
        });
        docparseFields = courtExtraction.fields.map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value,
          confidence: f.confidence,
        }));
        courtFieldsBlock = {
          fieldSource: courtExtraction.extractionPath === 'docparse' ? 'docparse'
            : courtExtraction.extractionPath === 'mixed' ? 'mixed'
            : courtExtraction.extractionPath === 'ocr_fallback' ? 'ocr_fallback'
            : courtExtraction.fieldCount > 0 ? 'nyv' : 'none',
          extractionPath: courtExtraction.extractionPath ?? null,
          docparseMeta: courtExtraction.docparseMeta ?? null,
          tables: courtExtraction.tables ?? [],
        };
      }
    } catch (err) {
      logger.warn('[PatraMitra] docparse court-field pass failed (non-fatal)', {
        err: err instanceof Error ? err.message : String(err),
      });
    }

    const ctx = {
      applicationId: input.sdkContext?.applicationId,
      organizationId: input.orgId || input.sdkContext?.organizationId,
      apiKeyId: input.sdkContext?.apiKeyId,
      appName: input.sdkContext?.appName || 'patra-mitra',
      jurisdiction,
      requestId: genId('pm_req'),
      userId: input.userId || 'patra-mitra',
    };

    const intel = await llmFieldsAndSummary(text, jurisdiction, fileName, ctx);
    const mergedFields: PatraMitraField[] = [...docparseFields];
    for (const f of intel.fields) {
      if (!mergedFields.some((m) => m.key === f.key)) mergedFields.push(f);
    }
    const lang = detectDocumentLanguage(text);
    const now = Date.now();
    const session: PatraMitraSession = {
      sessionId: genId('pm'),
      orgId: input.orgId,
      platformCode: input.platformCode,
      fileName,
      mimeType: input.mimeType,
      jurisdiction,
      extractionMethod: extracted.extractionMethod,
      format: extracted.format,
      warnings: extracted.warnings,
      text,
      textPreview: text.slice(0, 1200),
      characterCount: text.length,
      wordCount: text.split(/\s+/).filter(Boolean).length,
      fields: mergedFields.length ? mergedFields : intel.fields,
      summary: intel.summary,
      keyPoints: intel.keyPoints,
      documentType: intel.documentType,
      detectedLanguage: lang.code,
      languageLabel: lang.label,
      extractionPath: (courtFieldsBlock.extractionPath as string | null) ?? null,
      docparseMeta: (courtFieldsBlock.docparseMeta as Record<string, unknown> | null) ?? null,
      tables: (courtFieldsBlock.tables as Array<Record<string, unknown>>) ?? [],
      chat: [],
      toolRuns: [],
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: now + SESSION_TTL_MS,
    };
    sessions.set(session.sessionId, session);
    await saveSession(session);
    logger.info('[PatraMitra] session created', {
      sessionId: session.sessionId,
      fileName,
      method: session.extractionMethod,
      chars: session.characterCount,
      fields: session.fields.length,
    });
    return session;
  }

  getSession(sessionId: string): PatraMitraSession | null {
    pruneExpired();
    const cached = sessions.get(sessionId);
    if (cached && cached.expiresAt >= Date.now()) return cached;
    return null;
  }

  /** Load from hot cache or Postgres backing store. */
  async getSessionAsync(sessionId: string): Promise<PatraMitraSession | null> {
    pruneExpired();
    const cached = this.getSession(sessionId);
    if (cached) return cached;
    const loaded = await loadPatraMitraSession(sessionId);
    if (loaded) sessions.set(sessionId, loaded);
    return loaded;
  }

  async listSessions(limit = 40): Promise<Array<{
    sessionId: string;
    fileName: string;
    documentType?: string;
    wordCount: number;
    detectedLanguage?: string;
    languageLabel?: string;
    createdAt: string;
    updatedAt: string;
    fieldCount: number;
    chatTurns: number;
  }>> {
    pruneExpired();
    const dbRows = await listPatraMitraSessionsFromDb(limit);
    for (const s of dbRows) {
      if (!sessions.has(s.sessionId)) sessions.set(s.sessionId, s);
    }
    return [...sessions.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((s) => ({
        sessionId: s.sessionId,
        fileName: s.fileName,
        documentType: s.documentType,
        wordCount: s.wordCount,
        detectedLanguage: s.detectedLanguage,
        languageLabel: s.languageLabel,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        fieldCount: s.fields.length,
        chatTurns: s.chat.length,
      }));
  }

  /** Client-safe view (omit full text body unless requested). */
  toPublic(session: PatraMitraSession, opts?: { includeFullText?: boolean }) {
    return {
      sessionId: session.sessionId,
      fileName: session.fileName,
      mimeType: session.mimeType,
      jurisdiction: session.jurisdiction,
      documentType: session.documentType,
      extractionMethod: session.extractionMethod,
      format: session.format,
      warnings: session.warnings,
      characterCount: session.characterCount,
      wordCount: session.wordCount,
      textPreview: session.textPreview,
      ...(opts?.includeFullText ? { text: session.text } : {}),
      fields: session.fields,
      summary: session.summary,
      keyPoints: session.keyPoints,
      detectedLanguage: session.detectedLanguage,
      languageLabel: session.languageLabel,
      chat: session.chat,
      toolRuns: session.toolRuns || [],
      tools: PATRA_MITRA_TOOLS,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      product: {
        name: 'Patra Mitra',
        tagline: 'Parse · Understand · Ask',
        code: 'patra-mitra',
      },
    };
  }

  async runTool(input: {
    sessionId: string;
    tool: PatraMitraToolId | string;
    answerLanguage?: string;
    sdkContext?: Record<string, unknown>;
    userId?: string;
  }): Promise<{ tool: string; result: Record<string, unknown>; session: ReturnType<PatraMitraService['toPublic']> }> {
    const session = await this.getSessionAsync(input.sessionId);
    if (!session) throw new Error('Session not found or expired. Please re-upload the document.');
    const tool = String(input.tool || '') as PatraMitraToolId;
    const text = session.text;
    let result: Record<string, unknown> = {};

    switch (tool) {
      case 'detect_language': {
        const lang = detectDocumentLanguage(text);
        session.detectedLanguage = lang.code;
        session.languageLabel = lang.label;
        result = { ...lang };
        break;
      }
      case 'extract_parties': {
        const between = text.match(/\bbetween\s+([^.\n]{3,120}?)\s+and\s+([^.\n]{3,120})/i);
        const partyLines = text
          .split(/\n/)
          .filter((l) => /\b(party|petitioner|respondent|plaintiff|defendant|complainant|accused)\b/i.test(l))
          .slice(0, 12);
        result = {
          parties: between
            ? [
                { label: 'Party A', value: between[1].trim() },
                { label: 'Party B', value: between[2].trim() },
              ]
            : [],
          cues: partyLines,
          fromFields: session.fields.filter((f) => /party|petitioner|respondent|plaintiff|defendant/i.test(f.key + f.label)),
        };
        break;
      }
      case 'extract_dates': {
        const dates =
          text.match(
            /\b(?:\d{1,2}[\/\-.](?:\d{1,2}|[A-Za-z]{3,9})[\/\-.]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4}|\d{4}-\d{2}-\d{2})\b/gi,
          ) || [];
        result = { dates: [...new Set(dates)].slice(0, 40) };
        break;
      }
      case 'extract_amounts': {
        const amounts =
          text.match(/(?:₹|Rs\.?|INR|USD|EUR|\$)\s?[\d,]+(?:\.\d+)?|\b\d{1,3}(?:,\d{2,3})+(?:\.\d+)?\s*(?:rupees|only)\b/gi) ||
          [];
        result = { amounts: [...new Set(amounts)].slice(0, 40) };
        break;
      }
      case 'extract_citations': {
        const sections = text.match(/\b(?:Section|Sec\.?|§|Article|Art\.?)\s*\d+[A-Za-z]?\b/gi) || [];
        const cnr =
          text.match(/\b[A-Z]{4}\d{2}[A-Z]{0,2}\d{4}\d{6,7}\b/g) ||
          text.match(/\bCNR\s*[:\-]?\s*[A-Z0-9]{10,20}\b/gi) ||
          [];
        const caseNos = text.match(/\b(?:CRL|CIV|WP|SLA|SLP|O\.?S\.?|C\.?S\.?)\.?\s*(?:No\.?|NO\.?)?\s*\d+\s*(?:of|\/)\s*\d{4}\b/gi) || [];
        result = {
          sections: [...new Set(sections)].slice(0, 30),
          cnr: [...new Set(cnr)].slice(0, 10),
          caseNumbers: [...new Set(caseNos)].slice(0, 20),
        };
        break;
      }
      case 'find_clauses': {
        const keys = [
          'termination',
          'indemnity',
          'confidential',
          'arbitration',
          'jurisdiction',
          'force majeure',
          'limitation',
          'warranty',
          'liability',
          'governing law',
        ];
        const hits = keys
          .map((k) => {
            const idx = text.toLowerCase().indexOf(k);
            if (idx < 0) return null;
            return {
              clause: k,
              snippet: text.slice(Math.max(0, idx - 40), Math.min(text.length, idx + 180)).replace(/\s+/g, ' ').trim(),
            };
          })
          .filter(Boolean);
        result = { clauses: hits };
        break;
      }
      case 'pii_scan': {
        const emails = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
        const phones = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}\b|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g) || [];
        const aadhaarLike = text.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/g) || [];
        result = {
          emails: [...new Set(emails)].slice(0, 20),
          phones: [...new Set(phones)].slice(0, 20),
          idLikePatterns: [...new Set(aadhaarLike)].slice(0, 10),
          note: 'Flags only — not a determination of PII category. Review before sharing.',
        };
        break;
      }
      case 'regenerate_summary': {
        const answerLanguage = String(input.answerLanguage || session.detectedLanguage || 'en');
        const langHint =
          answerLanguage === 'en' || answerLanguage === 'mixed'
            ? 'Write the summary in clear English.'
            : `Write the summary primarily in language code "${answerLanguage}" (Indic script if applicable), with English labels for headings if needed.`;
        const ctx = {
          applicationId: input.sdkContext?.applicationId,
          organizationId: session.orgId || input.sdkContext?.organizationId,
          apiKeyId: input.sdkContext?.apiKeyId,
          appName: input.sdkContext?.appName || 'patra-mitra',
          jurisdiction: session.jurisdiction,
          requestId: genId('pm_sum'),
          userId: input.userId || 'patra-mitra',
        };
        const intel = await llmFieldsAndSummary(
          `${session.text}\n\n[${langHint}]`,
          session.jurisdiction,
          session.fileName,
          ctx,
        );
        session.summary = intel.summary;
        session.keyPoints = intel.keyPoints;
        if (intel.documentType) session.documentType = intel.documentType;
        if (intel.fields.length) session.fields = intel.fields;
        result = { summary: session.summary, keyPoints: session.keyPoints, answerLanguage };
        break;
      }
      case 'export_fields': {
        result = { fields: session.fields, exportedAt: new Date().toISOString() };
        break;
      }
      default:
        throw new Error(`Unknown tool: ${String(input.tool)}`);
    }

    const at = new Date().toISOString();
    session.toolRuns = [...(session.toolRuns || []), { tool, at, result }].slice(-30);
    session.updatedAt = at;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    await saveSession(session);
    return { tool, result, session: this.toPublic(session) };
  }

  async chat(input: {
    sessionId: string;
    message: string;
    jurisdiction?: string;
    answerLanguage?: string;
    sdkContext?: Record<string, unknown>;
    userId?: string;
  }): Promise<{ answer: string; session: ReturnType<PatraMitraService['toPublic']> }> {
    const session = await this.getSessionAsync(input.sessionId);
    if (!session) throw new Error('Session not found or expired. Please re-upload the document.');
    const message = String(input.message || '').trim();
    if (!message) throw new Error('message is required');

    const jurisdiction = (input.jurisdiction || session.jurisdiction || 'IN').toUpperCase();
    const answerLanguage = String(input.answerLanguage || session.detectedLanguage || 'en');
    const langRule =
      answerLanguage === 'en' || answerLanguage === 'mixed' || !answerLanguage
        ? 'Answer in clear English unless the user asks otherwise.'
        : `Prefer answering in language code "${answerLanguage}" (use the appropriate Indic script when the document is in that language). Keep citations and proper nouns accurate.`;
    const history = session.chat
      .slice(-MAX_CHAT_HISTORY)
      .map((t) => `${t.role === 'user' ? 'User' : 'Counsel'}: ${t.content}`)
      .join('\n');

    const ctx = {
      applicationId: input.sdkContext?.applicationId,
      organizationId: session.orgId || input.sdkContext?.organizationId,
      apiKeyId: input.sdkContext?.apiKeyId,
      appName: input.sdkContext?.appName || 'patra-mitra',
      jurisdiction,
      requestId: genId('pm_chat'),
      userId: input.userId || 'patra-mitra',
    };

    const req = buildLLMRequest(
      `DOCUMENT (authoritative source — answer only from this text):\n---\n${session.text.slice(0, 20_000)}\n---\n\nPRIOR TURNS:\n${history || '(none)'}\n\nUSER QUESTION:\n${message}\n\nAnswer in clear markdown for a practising advocate. Cite page/section clues from the document when possible. If the document does not contain the answer, say so plainly.`,
      `You are Patra Mitra, Jurexio's document companion for ${jurisdiction}.
Rules:
- Ground every answer in the provided DOCUMENT text only.
- ${langRule}
- Use counsel register; structured headings/bullets when helpful.
- Never invent clauses, dates, or parties.
- Never expose orchestration, agent names, or internal system details.
- End with a one-line practitioner caveat when giving legal-leaning guidance.`,
      3072,
    );

    const llm = await executeWithFullSafetyRing(req, {
      ctx,
      sdkPlatform: 'patra-mitra',
      agentKey: 'document-qa',
      jurisdiction,
      taskType: 'document_qa',
      domainContext: `${jurisdiction} Patra Mitra document Q&A (${session.fileName})`,
      enableMemory: false,
      enableRAG: false,
    });

    const answer = sanitizeOrchestrationContentForClient(llm.content || '');
    if (!answer.trim()) throw new Error('Unable to answer from this document right now. Please retry.');

    const at = new Date().toISOString();
    session.chat.push({ role: 'user', content: message, at });
    session.chat.push({ role: 'assistant', content: answer, at });
    session.updatedAt = at;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    await saveSession(session);

    return { answer, session: this.toPublic(session) };
  }
}

export const patraMitraService = new PatraMitraService();
