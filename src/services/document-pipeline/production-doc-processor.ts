// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
import crypto from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { pool } from '../../db/index.js';
import { JrxDocumentStorageService } from '../jrx-document-storage-service.js';
import { createLogger } from '../../utils/logger.js';
import { extractDocumentText } from '../sdk/jrx-doc-content-extractor.js';


const logger = createLogger('production-doc-processor');

const CHUNK_SIZE = 8000;
const CHUNK_OVERLAP = 500;
const MAX_RETRIES = 3;
const WORKER_ID = `worker-${process.pid}-${Date.now()}`;

export interface DocJobInput {
  orgId: number;
  documentId?: string;
  fileName: string;
  fileType: string;
  content?: string;
  extractionMode?: string;
  priority?: number;
  userId?: string;
  jurisdiction?: string;
  metadata?: Record<string, any>;
}

export interface DocJobRecord {
  id: string;
  org_id: number;
  document_id: string | null;
  file_name: string;
  file_type: string;
  file_size_bytes: number;
  extraction_mode: string;
  status: string;
  progress: number;
  result: any;
  storage_path: string | null;
  parsed_json_path: string | null;
  error_message: string | null;
  retry_count: number;
  priority: number;
  worker_id: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, any>;
}

export interface ParsedChunk {
  index: number;
  content: string;
  tokenCount: number;
  charCount: number;
  startPosition: number;
  endPosition: number;
  sectionTitle?: string;
  metadata: Record<string, any>;
}

export interface ParsedResult {
  rawContent: string;
  chunks: ParsedChunk[];
  entities: any[];
  sections: any[];
  obligations: any[];
  risks: any[];
  deadlines: any[];
  metadata: Record<string, any>;
  statistics: Record<string, any>;
  documentClass: string;
  language: string;
  pageCount: number;
  wordCount: number;
}

async function getDb() {
  if (!pool) throw new Error('Database pool not initialized');
  return pool;
}


export async function createJob(input: DocJobInput): Promise<DocJobRecord> {
  const db = await getDb();
  const jobId = crypto.randomUUID();
  const contentSize = input.content ? Buffer.byteLength(input.content, 'utf-8') : 0;
  const metadata = {
    ...(input.metadata || {}),
    ...(input.content ? { inlineContent: input.content.length <= 500_000 ? input.content : input.content.substring(0, 500_000) } : {}),
    jurisdiction: input.jurisdiction,
    userId: input.userId,
  };

  const result = await db.query(
    `INSERT INTO ns_doc_processing_jobs 
     (id, org_id, document_id, document_type, extraction_mode, status, progress, file_name, file_size_bytes, priority, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', 0, $6, $7, $8, $9, NOW(), NOW())
     RETURNING *`,
    [
      jobId,
      input.orgId,
      input.documentId || null,
      input.fileType || 'text',
      input.extractionMode || 'full',
      input.fileName || 'untitled',
      contentSize,
      input.priority || 5,
      JSON.stringify(metadata),
    ]
  );

  // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2740)
  return result.rows[0];
}

export async function updateJobStatus(
  jobId: string,
  status: string,
  progress: number,
  extras?: { result?: any; error_message?: string; worker_id?: string; storage_path?: string; parsed_json_path?: string }
): Promise<void> {
  const db = await getDb();
  const sets: string[] = ['status = $2', 'progress = $3', 'updated_at = NOW()'];
  const params: any[] = [jobId, status, progress];
  let idx = 4;

  if (extras?.result !== undefined) {
    sets.push(`result = $${idx}`);
    params.push(JSON.stringify(extras.result));
    idx++;
  }
  if (extras?.error_message !== undefined) {
    sets.push(`error_message = $${idx}`);
    params.push(extras.error_message);
    idx++;
  }
  if (extras?.worker_id !== undefined) {
    sets.push(`worker_id = $${idx}`);
    params.push(extras.worker_id);
    idx++;
  }
  if (extras?.storage_path !== undefined) {
    sets.push(`storage_path = $${idx}`);
    params.push(extras.storage_path);
    idx++;
  }
  if (extras?.parsed_json_path !== undefined) {
    sets.push(`parsed_json_path = $${idx}`);
    params.push(extras.parsed_json_path);
    idx++;
  }
  if (status === 'processing') {
    sets.push('started_at = NOW()');
  }
  if (status === 'completed' || status === 'failed') {
    sets.push('completed_at = NOW()');
  }

  await db.query(`UPDATE ns_doc_processing_jobs SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function getJob(jobId: string): Promise<DocJobRecord | null> {
  const db = await getDb();
  const result = await db.query('SELECT * FROM ns_doc_processing_jobs WHERE id = $1', [jobId]);
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2740)
  return result.rows[0] || null;
}

export async function getJobsByOrg(orgId: number, limit = 50, offset = 0): Promise<{ jobs: DocJobRecord[]; total: number }> {
  const db = await getDb();
  const [jobsResult, countResult] = await Promise.all([
    db.query(
      'SELECT * FROM ns_doc_processing_jobs WHERE org_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
      [orgId, limit, offset]
    ),
    db.query('SELECT COUNT(*)::int as count FROM ns_doc_processing_jobs WHERE org_id = $1', [orgId]),
  ]);
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
  return { jobs: jobsResult.rows, total: countResult.rows[0].count };
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function chunkContent(content: string, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP): ParsedChunk[] {
  if (!content || content.length === 0) return [];

  const chunks: ParsedChunk[] = [];
  const paragraphs = content.split(/\n\s*\n/);
  let currentChunk = '';
  let chunkIndex = 0;
  let globalPosition = 0;
  let chunkStart = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      globalPosition += paragraph.length + 2;
      continue;
    }

    const combined = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
    const tokenEstimate = estimateTokens(combined);

    if (tokenEstimate > chunkSize && currentChunk) {
      chunks.push({
        index: chunkIndex,
        content: currentChunk,
        tokenCount: estimateTokens(currentChunk),
        charCount: currentChunk.length,
        startPosition: chunkStart,
        endPosition: globalPosition,
        sectionTitle: extractSectionTitle(currentChunk),
        metadata: {},
      });
      chunkIndex++;

      const overlapTokens = Math.ceil(overlap);
      const overlapChars = overlapTokens * 4;
      if (currentChunk.length > overlapChars) {
        currentChunk = currentChunk.slice(-overlapChars) + '\n\n' + trimmed;
      } else {
        currentChunk = trimmed;
      }
      chunkStart = Math.max(0, globalPosition - overlapChars);
    } else {
      currentChunk = combined;
    }

    globalPosition += paragraph.length + 2;
  }

  if (currentChunk.trim()) {
    chunks.push({
      index: chunkIndex,
      content: currentChunk,
      tokenCount: estimateTokens(currentChunk),
      charCount: currentChunk.length,
      startPosition: chunkStart,
      endPosition: globalPosition,
      sectionTitle: extractSectionTitle(currentChunk),
      metadata: {},
    });
  }

  return chunks;
}

function extractSectionTitle(text: string): string | undefined {
  const lines = text.split('\n');
  for (const line of lines.slice(0, 3)) {
    const trimmed = line.trim();
    if (trimmed.length > 0 && trimmed.length < 200) {
      if (/^(#{1,6}\s|SECTION|ARTICLE|CHAPTER|PART|SCHEDULE|ANNEXURE|CLAUSE|WHEREAS|NOW THEREFORE)/i.test(trimmed)) {
        return trimmed.replace(/^#+\s*/, '');
      }
      if (trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 100) {
        return trimmed;
      }
    }
  }
  return undefined;
}

export function extractEntities(content: string): any[] {
  const entities: any[] = [];
  
  const datePatterns = [
    /\b(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})\b/g,
    /\b(\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4})\b/gi,
    /\b((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})\b/gi,
  ];
  for (const pattern of datePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      entities.push({ type: 'date', text: match[1], confidence: 0.90, position: match.index });
    }
  }

  const amountPatterns = [
    /(?:INR|Rs\.?|₹|USD|\$|€|£|AED|SAR|SGD)\s*[\d,]+(?:\.\d{1,2})?/gi,
    /[\d,]+(?:\.\d{1,2})?\s*(?:crore|lakh|million|billion|thousand)/gi,
  ];
  for (const pattern of amountPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      entities.push({ type: 'amount', text: match[0].trim(), confidence: 0.88, position: match.index });
    }
  }

  const partyPatterns = [
    /(?:M\/s\.?|Shri|Smt\.?|Dr\.?|Mr\.?|Mrs\.?|Ms\.?)\s+[A-Z][a-zA-Z\s&]+(?:Ltd\.?|Pvt\.?|Inc\.?|LLC|LLP|Corp\.?)?/g,
    /(?:hereinafter\s+(?:referred\s+to\s+as|called)\s+["']?)([^"'\n]+)["']?/gi,
  ];
  for (const pattern of partyPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      entities.push({ type: 'party', text: (match[1] || match[0]).trim(), confidence: 0.85, position: match.index });
    }
  }

  const casePatterns = [
    /(?:AIR|SCC|SCR|ILR|DLT|Bom|Cal|Mad|Del)\s+\d{4}\s+\w+\s+\d+/g,
    /\d{4}\s+\(\d+\)\s+SCC\s+\d+/g,
    /(?:W\.?P\.?|C\.?A\.?|S\.?L\.?P\.?|Crl\.?\s*M\.?C\.?)\s*(?:\(C\)|\(Crl\))?\s*No\.?\s*\d+\s*(?:of|\/)\s*\d{4}/gi,
  ];
  for (const pattern of casePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      entities.push({ type: 'case_citation', text: match[0].trim(), confidence: 0.92, position: match.index });
    }
  }

  const statutePatterns = [
    /(?:The\s+)?[A-Z][a-zA-Z\s]+Act,?\s+\d{4}/g,
    /Section\s+\d+[A-Za-z]?\s+(?:of\s+the\s+)?[A-Z][a-zA-Z\s]+Act/gi,
  ];
  for (const pattern of statutePatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      entities.push({ type: 'statute', text: match[0].trim(), confidence: 0.90, position: match.index });
    }
  }

  const seen = new Set<string>();
  return entities.filter(e => {
    const key = `${e.type}:${e.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractSections(content: string): any[] {
  const sections: any[] = [];
  const lines = content.split('\n');
  let currentPos = 0;

  const sectionPatterns = [
    /^(#{1,6})\s+(.+)/,
    /^(SECTION|ARTICLE|CHAPTER|PART|SCHEDULE|ANNEXURE|CLAUSE|RECITAL)\s*[.:)\-]?\s*(\d*\.?\s*.+)/i,
    /^(\d+\.)\s+([A-Z][A-Z\s]{3,})/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    for (const pattern of sectionPatterns) {
      const match = line.match(pattern);
      if (match) {
        sections.push({
          title: match[2] ? match[2].trim() : match[0].trim(),
          type: match[1].startsWith('#') ? `h${match[1].length}` : match[1].toLowerCase(),
          lineNumber: i + 1,
          position: currentPos,
        });
        break;
      }
    }
    currentPos += lines[i].length + 1;
  }

  for (let i = 0; i < sections.length; i++) {
    sections[i].start = sections[i].position;
    sections[i].end = i < sections.length - 1 ? sections[i + 1].position : content.length;
  }

  return sections;
}

export function extractObligations(content: string): any[] {
  const obligations: any[] = [];
  const patterns = [
    /(?:shall|must|is\s+required\s+to|is\s+obligated\s+to|undertakes\s+to|agrees\s+to|covenants\s+to)\s+([^.;]{10,150})[.;]/gi,
    /(?:within|not\s+later\s+than|no\s+later\s+than|by|before|on\s+or\s+before)\s+(\d+\s+(?:days?|months?|weeks?|years?|business\s+days?))\b[^.;]*[.;]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const context = content.substring(Math.max(0, match.index - 100), match.index + match[0].length);
      obligations.push({
        text: match[0].trim().substring(0, 300),
        obligation_type: pattern.source.includes('within') ? 'deadline' : 'performance',
        severity: match[0].toLowerCase().includes('must') ? 'high' : 'medium',
        context: context.trim().substring(0, 200),
        position: match.index,
      });
    }
  }

  return obligations.slice(0, 50);
}

export function extractRisks(content: string): any[] {
  const risks: any[] = [];
  const riskPatterns = [
    /(?:penalty|liquidated\s+damages?|indemnif|termination|breach|default|liability|loss|damage|fine|sanction|forfeiture|void(?:able)?)/gi,
  ];

  for (const pattern of riskPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const start = Math.max(0, match.index - 150);
      const end = Math.min(content.length, match.index + match[0].length + 150);
      const context = content.substring(start, end);
      risks.push({
        type: match[0].toLowerCase().trim(),
        context: context.trim().substring(0, 300),
        severity: /penalty|termination|void/i.test(match[0]) ? 'high' : 'medium',
        position: match.index,
      });
    }
  }

  const seen = new Set<string>();
  return risks.filter(r => {
    const key = r.context.substring(0, 50);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 30);
}

export function extractDeadlines(content: string): any[] {
  const deadlines: any[] = [];
  const patterns = [
    /(?:within|not\s+later\s+than|no\s+later\s+than|by|before|on\s+or\s+before|expires?\s+(?:on|in)|valid\s+(?:until|till|for))\s+([^.;]{5,100})[.;]/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      deadlines.push({
        text: match[0].trim().substring(0, 200),
        deadline_value: match[1]?.trim().substring(0, 100),
        position: match.index,
      });
    }
  }

  return deadlines.slice(0, 30);
}

function classifyDocument(content: string): string {
  const lower = content.toLowerCase().substring(0, 5000);
  const classifiers: [string, RegExp[]][] = [
    ['court_order', [/(?:hon'?ble|honourable)\s+(?:court|justice|judge)/i, /(?:order|judgment|decree)\s+(?:dated|passed|pronounced)/i]],
    ['contract', [/(?:agreement|contract)\s+(?:between|by\s+and\s+between)/i, /(?:whereas|now\s+therefore|in\s+witness\s+whereof)/i]],
    ['petition', [/(?:writ\s+petition|civil\s+petition|special\s+leave\s+petition|bail\s+application)/i]],
    ['legal_notice', [/(?:legal\s+notice|cease\s+and\s+desist|show\s+cause|demand\s+notice)/i]],
    ['memorandum', [/(?:memorandum\s+of\s+understanding|mou|memorandum\s+of\s+association)/i]],
    ['affidavit', [/(?:affidavit|i\s+.*\s+do\s+hereby\s+solemnly\s+affirm|sworn\s+statement)/i]],
    ['power_of_attorney', [/(?:power\s+of\s+attorney|attorney-in-fact|hereby\s+appoint)/i]],
    ['compliance_report', [/(?:compliance\s+report|audit\s+report|regulatory\s+filing)/i]],
    ['legislation', [/(?:act\s+no\.?\s*\d|be\s+it\s+enacted|parliament|legislature)/i]],
  ];

  for (const [cls, patterns] of classifiers) {
    let matchCount = 0;
    for (const p of patterns) {
      if (p.test(lower)) matchCount++;
    }
    if (matchCount >= 1) return cls;
  }

  return 'legal_document';
}

function detectLanguage(content: string): string {
  const sample = content.substring(0, 2000);
  if (/[\u0900-\u097F]/.test(sample)) return 'hi';
  if (/[\u0600-\u06FF]/.test(sample)) return 'ar';
  if (/[\u4e00-\u9fff]/.test(sample)) return 'zh';
  if (/[\u0B80-\u0BFF]/.test(sample)) return 'ta';
  if (/[\u0C00-\u0C7F]/.test(sample)) return 'te';
  if (/[\u0A80-\u0AFF]/.test(sample)) return 'gu';
  if (/[\u0980-\u09FF]/.test(sample)) return 'bn';
  return 'en';
}

function computeStatistics(content: string): Record<string, any> {
  const words = content.split(/\s+/).filter(w => w.length > 0);
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);

  const avgWordsPerSentence = sentences.length > 0 ? words.length / sentences.length : 0;
  const avgSentencesPerParagraph = paragraphs.length > 0 ? sentences.length / paragraphs.length : 0;

  const syllableCount = words.reduce((sum, w) => sum + Math.max(1, (w.match(/[aeiouy]+/gi) || []).length), 0);
  const fleschKincaid = sentences.length > 0 && words.length > 0
    ? 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllableCount / words.length)
    : 50;

  return {
    totalCharacters: content.length,
    totalWords: words.length,
    totalSentences: sentences.length,
    totalParagraphs: paragraphs.length,
    averageWordsPerSentence: Math.round(avgWordsPerSentence * 10) / 10,
    averageSentencesPerParagraph: Math.round(avgSentencesPerParagraph * 10) / 10,
    readabilityScore: Math.round(Math.max(0, Math.min(100, fleschKincaid)) * 10) / 10,
    complexityScore: Math.round(Math.min(100, avgWordsPerSentence * 3 + (content.length > 50000 ? 30 : content.length > 10000 ? 15 : 5)) * 10) / 10,
    languageConfidence: 0.95,
  };
}

export async function parseTextContent(content: string, fileName: string, fileType: string): Promise<ParsedResult> {
  const chunks = chunkContent(content);
  const entities = extractEntities(content);
  const sections = extractSections(content);
  const obligations = extractObligations(content);
  const risks = extractRisks(content);
  const deadlines = extractDeadlines(content);
  const statistics = computeStatistics(content);
  const documentClass = classifyDocument(content);
  const language = detectLanguage(content);
  const words = content.split(/\s+/).filter(w => w.length > 0);

  return {
    rawContent: content,
    chunks,
    entities,
    sections,
    obligations,
    risks,
    deadlines,
    metadata: {
      fileName,
      fileType,
      mimeType: getMimeType(fileType),
      encoding: 'utf-8',
      language,
    },
    statistics,
    documentClass,
    language,
    pageCount: Math.max(1, Math.ceil(words.length / 300)),
    wordCount: words.length,
  };
}

function getMimeType(fileType: string): string {
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    md: 'text/markdown',
    html: 'text/html',
    json: 'application/json',
    csv: 'text/csv',
    xml: 'application/xml',
    rtf: 'application/rtf',
  };
  return map[fileType] || 'application/octet-stream';
}

export async function storeRAGChunks(
  orgId: number,
  documentId: string,
  jobId: string,
  chunks: ParsedChunk[]
): Promise<number> {
  if (chunks.length === 0) return 0;
  const db = await getDb();

  const batchSize = 50;
  let stored = 0;

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const values: any[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const chunk of batch) {
      placeholders.push(
        `($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10})`
      );
      values.push(
        orgId,
        documentId,
        jobId,
        chunk.index,
        chunk.content,
        chunk.tokenCount,
        chunk.charCount,
        chunk.startPosition,
        chunk.endPosition,
        chunk.sectionTitle || null,
        JSON.stringify(chunk.metadata),
      );
      paramIdx += 11;
    }

    await db.query(
      `INSERT INTO ns_rag_document_chunks 
       (organization_id, document_id, job_id, chunk_index, content, token_count, char_count, start_position, end_position, section_title, chunk_metadata)
       VALUES ${placeholders.join(', ')}`,
      values
    );
    stored += batch.length;
  }

  return stored;
}

export async function storeParsedDocument(
  orgId: number,
  jobId: string,
  parsed: ParsedResult,
  input: DocJobInput,
  storagePath?: string,
  parsedJsonPath?: string
): Promise<number> {
  const db = await getDb();
  const docId = input.documentId || crypto.randomUUID();

  const result = await db.query(
    `INSERT INTO ns_parsed_documents 
     (organization_id, document_id, job_id, file_name, file_type, file_size_bytes, mime_type,
      storage_path, parsed_json_path, raw_content, parsed_content, metadata, statistics,
      entities, sections, obligations, risks, deadlines,
      language, jurisdiction, document_class, page_count, word_count,
      processing_time_ms, status, created_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 'completed', $25, NOW(), NOW())
     RETURNING id`,
    [
      orgId,
      docId,
      jobId,
      input.fileName,
      input.fileType,
      parsed.rawContent ? Buffer.byteLength(parsed.rawContent, 'utf-8') : 0,
      parsed.metadata.mimeType,
      storagePath || null,
      parsedJsonPath || null,
      parsed.rawContent.length > 500000 ? parsed.rawContent.substring(0, 500000) : parsed.rawContent,
      JSON.stringify({
        chunkCount: parsed.chunks.length,
        entityCount: parsed.entities.length,
        sectionCount: parsed.sections.length,
        obligationCount: parsed.obligations.length,
        riskCount: parsed.risks.length,
        deadlineCount: parsed.deadlines.length,
      }),
      JSON.stringify(parsed.metadata),
      JSON.stringify(parsed.statistics),
      JSON.stringify(parsed.entities),
      JSON.stringify(parsed.sections),
      JSON.stringify(parsed.obligations),
      JSON.stringify(parsed.risks),
      JSON.stringify(parsed.deadlines),
      parsed.language,
      input.jurisdiction || null,
      parsed.documentClass,
      parsed.pageCount,
      parsed.wordCount,
      0,
      input.userId || null,
    ]
  );

  // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
  return result.rows[0].id;
}

export async function storeParsedJsonToObjectStorage(
  orgId: number,
  jobId: string,
  parsed: ParsedResult
): Promise<string | null> {
  try {
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateDir) return null;

    const objectName = `${privateDir.replace(/^\//, '').replace(/\/$/, '')}/parsed-docs/org-${orgId}/${jobId}.json`;

    const storage = JrxDocumentStorageService.getInstance();
    const jsonContent = JSON.stringify({
      jobId,
      orgId,
      timestamp: new Date().toISOString(),
      metadata: parsed.metadata,
      statistics: parsed.statistics,
      documentClass: parsed.documentClass,
      language: parsed.language,
      pageCount: parsed.pageCount,
      wordCount: parsed.wordCount,
      entities: parsed.entities,
      sections: parsed.sections,
      obligations: parsed.obligations,
      risks: parsed.risks,
      deadlines: parsed.deadlines,
      chunks: parsed.chunks.map(c => ({
        index: c.index,
        tokenCount: c.tokenCount,
        charCount: c.charCount,
        sectionTitle: c.sectionTitle,
        preview: c.content.substring(0, 200),
      })),
    }, null, 2);

    await storage.uploadRaw(objectName, Buffer.from(jsonContent, 'utf-8'), 'application/json');

    const storagePath = `/${objectName}`;
    logger.info(`📦 Parsed JSON stored at: ${storagePath}`);
    return storagePath;
  } catch (error: any) {
    logger.warn(`⚠️ Object storage not available for parsed JSON, skipping: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

export async function storeRawContentToObjectStorage(
  orgId: number,
  jobId: string,
  content: string,
  fileName: string
): Promise<string | null> {
  try {
    const privateDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateDir) return null;

    const ext = path.extname(fileName) || '.txt';
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const objectName = `${privateDir.replace(/^\//, '').replace(/\/$/, '')}/raw-docs/org-${orgId}/${jobId}_${safeName}`;

    const storage = JrxDocumentStorageService.getInstance();
    await storage.uploadRaw(objectName, Buffer.from(content, 'utf-8'), getMimeType(ext.replace('.', '')));

    const storagePath = `/${objectName}`;
    logger.info(`📁 Raw content stored at: ${storagePath}`);
    return storagePath;
  } catch (error: any) {
    logger.warn(`⚠️ Object storage not available for raw content, skipping: ${error instanceof Error ? error.message : 'Unknown'}`);
    return null;
  }
}

export async function resolveJobContent(job: DocJobRecord): Promise<string> {
  const resolved = await resolveJobContentWithBinary(job);
  return resolved.text;
}

export interface ResolvedJobContent {
  text: string;
  bytes?: Buffer;
  fileName: string;
  mimeType?: string;
}

/** Resolve job bytes + text — binary kept for @jurexio/docparse on IN legal ingest. */
export async function resolveJobContentWithBinary(job: DocJobRecord): Promise<ResolvedJobContent> {
  const meta = job.metadata || {};
  const fileName = job.file_name || 'document.pdf';

  if (typeof meta.inlineContent === 'string' && meta.inlineContent.trim()) {
    return { text: meta.inlineContent, fileName };
  }

  const storedPath = job.storage_path || meta.storagePath;
  if (storedPath && typeof storedPath === 'string') {
    try {
      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (privateDir) {
        const objectName = storedPath.replace(/^\//, '');
        const storage = JrxDocumentStorageService.getInstance();
        const buf = await storage.downloadRaw(objectName);
        const extracted = await extractDocumentText({
          base64: buf.toString('base64'),
          fileName,
        });
        return {
          text: extracted.text,
          bytes: buf,
          fileName,
          mimeType: getMimeType(job.file_type || path.extname(fileName).replace('.', '') || 'pdf'),
        };
      }
    } catch (err: any) {
      throw new Error(`Download/extract failed for job ${job.id}: ${err?.message || err}`);
    }
  }

  const db = await getDb();
  const contentResult = await db.query(
    'SELECT raw_content FROM ns_parsed_documents WHERE job_id = $1 LIMIT 1',
    [job.id]
  );
  const storedContent = contentResult.rows?.[0]?.raw_content;
  if (storedContent) {
    return { text: String(storedContent), fileName };
  }

  throw new Error(`Job ${job.id} has no resolvable content (inline, storage_path, or parsed row)`);
}

export async function processDocumentJob(jobId: string, content: string, input: DocJobInput): Promise<ParsedResult> {
  await updateJobStatus(jobId, 'processing', 5, { worker_id: WORKER_ID });

  const parsed = await parseTextContent(content, input.fileName, input.fileType);
  await updateJobStatus(jobId, 'processing', 40);

  /* NV-DOCPARSE-ADAPTER-001 — attach court-field extraction when IN legal + bytes. */
  const binary = input.metadata?.sourceBytes as Buffer | undefined;
  if (binary?.length && (input.jurisdiction || 'IN').toUpperCase().startsWith('IN')) {
    try {
      const { extractCourtDocumentFields } = await import('../jrx-court-document-fields.js');
      const progressStages: Array<{ stage: string; at: string; detail?: Record<string, unknown> }> = [];
      const courtExtraction = await extractCourtDocumentFields(content, input.jurisdiction || 'IN', {
        bytes: binary,
        fileName: input.fileName,
        mimeType: getMimeType(input.fileType),
        batchId: jobId,
        actor: `org:${input.orgId}`,
        onProgress: (stage, detail) => {
          progressStages.push({ stage, at: new Date().toISOString(), detail });
        },
      });
      if (progressStages.length && courtExtraction.docparseMeta) {
        courtExtraction.docparseMeta.progressStages = progressStages;
      }
      parsed.metadata = {
        ...parsed.metadata,
        courtFields: courtExtraction.fields,
        courtFieldCount: courtExtraction.fieldCount,
        courtExtractionPath: courtExtraction.extractionPath,
        docparseMeta: courtExtraction.docparseMeta,
        detectedDocumentType: courtExtraction.detectedDocumentType,
        tables: courtExtraction.tables,
      };
    } catch (err) {
      logger.warn('[DocProcessor] court field extraction failed (non-fatal)', {
        jobId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const [rawStoragePath, parsedJsonPath] = await Promise.all([
    storeRawContentToObjectStorage(input.orgId, jobId, content, input.fileName),
    storeParsedJsonToObjectStorage(input.orgId, jobId, parsed),
  ]);
  await updateJobStatus(jobId, 'processing', 60, { storage_path: rawStoragePath || undefined, parsed_json_path: parsedJsonPath || undefined });

  const docId = input.documentId || jobId;
  await storeRAGChunks(input.orgId, docId, jobId, parsed.chunks);
  await updateJobStatus(jobId, 'processing', 80);

  await storeParsedDocument(input.orgId, jobId, parsed, input, rawStoragePath || undefined, parsedJsonPath || undefined);
  await updateJobStatus(jobId, 'processing', 90);

  const resultSummary = {
    entities: parsed.entities.slice(0, 20),
    sections: parsed.sections,
    obligations: parsed.obligations.slice(0, 15),
    risks: parsed.risks.slice(0, 15),
    deadlines: parsed.deadlines.slice(0, 15),
    metadata: {
      page_count: parsed.pageCount,
      word_count: parsed.wordCount,
      language: parsed.language,
      document_class: parsed.documentClass,
      chunk_count: parsed.chunks.length,
      entity_count: parsed.entities.length,
    },
    storage: {
      raw_path: rawStoragePath,
      parsed_json_path: parsedJsonPath,
      rag_chunks_stored: parsed.chunks.length,
      db_record_stored: true,
    },
  };

  await updateJobStatus(jobId, 'completed', 100, { result: resultSummary });

  return parsed;
}

export async function retryFailedJob(jobId: string): Promise<boolean> {
  const db = await getDb();
  const result = await db.query(
    `UPDATE ns_doc_processing_jobs 
     SET status = 'queued', progress = 0, retry_count = retry_count + 1, error_message = NULL, updated_at = NOW()
     WHERE id = $1 AND status = 'failed' AND retry_count < max_retries
     RETURNING id`,
    [jobId]
  );
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  return result.rows.length > 0;
}

export async function getRAGChunks(
  orgId: number,
  documentId: string,
  limit = 100,
  offset = 0
): Promise<{ chunks: any[]; total: number }> {
  const db = await getDb();
  const [chunksResult, countResult] = await Promise.all([
    db.query(
      `SELECT id, chunk_index, content, token_count, char_count, section_title, chunk_metadata, embedding_status
       FROM ns_rag_document_chunks 
       WHERE organization_id = $1 AND document_id = $2
       ORDER BY chunk_index
       LIMIT $3 OFFSET $4`,
      [orgId, documentId, limit, offset]
    ),
    db.query(
      'SELECT COUNT(*)::int as count FROM ns_rag_document_chunks WHERE organization_id = $1 AND document_id = $2',
      [orgId, documentId]
    ),
  ]);
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048,TS2322)
  return { chunks: chunksResult.rows, total: countResult.rows[0].count };
}

/** Column projection for autofill / field blocks — excludes heavy raw_content blob. */
const PARSED_DOC_AUTOFILL_COLUMNS = [
  'id', 'organization_id', 'document_id', 'job_id', 'file_name', 'file_type', 'file_size_bytes',
  'mime_type', 'storage_path', 'parsed_json_path', 'parsed_content', 'metadata', 'statistics',
  'entities', 'sections', 'obligations', 'risks', 'deadlines', 'language', 'jurisdiction',
  'document_class', 'page_count', 'word_count', 'processing_time_ms', 'status', 'created_by',
  'created_at', 'updated_at', 'deleted_at',
].join(', ');

/** Autofill / court-field mapping — no raw_content (use object storage or loadParsedDocumentFull). */
export async function loadParsedDocumentForAutofill(orgId: number, documentId: string): Promise<any | null> {
  const db = await getDb();
  const result = await db.query(
    `SELECT ${PARSED_DOC_AUTOFILL_COLUMNS} FROM ns_parsed_documents WHERE organization_id = $1 AND document_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [orgId, documentId]
  );
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  return result.rows[0] || null;
}

/** Full parsed row including raw_content — only when raw text is explicitly required. */
export async function loadParsedDocumentFull(orgId: number, documentId: string): Promise<any | null> {
  const db = await getDb();
  const result = await db.query(
    `SELECT ${PARSED_DOC_AUTOFILL_COLUMNS}, raw_content FROM ns_parsed_documents WHERE organization_id = $1 AND document_id = $2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [orgId, documentId]
  );
  // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
  return result.rows[0] || null;
}

/**
 * @deprecated Prefer loadParsedDocumentForAutofill (default) or loadParsedDocumentFull.
 */
export async function getParsedDocument(
  orgId: number,
  documentId: string,
  opts?: { includeRawContent?: boolean },
): Promise<any | null> {
  return opts?.includeRawContent
    ? loadParsedDocumentFull(orgId, documentId)
    : loadParsedDocumentForAutofill(orgId, documentId);
}

export async function searchRAGChunks(
  orgId: number,
  query: string,
  limit = 10
): Promise<any[]> {
  const db = await getDb();
  const searchTerms = query.split(/\s+/).filter(t => t.length > 2).slice(0, 5);
  if (searchTerms.length === 0) return [];

  const tsQuery = searchTerms.map(t => `${t}:*`).join(' & ');

  const result = await db.query(
    `SELECT id, document_id, chunk_index, content, token_count, section_title, chunk_metadata,
            ts_rank(to_tsvector('english', content), to_tsquery('english', $2)) as relevance
     FROM ns_rag_document_chunks
     WHERE organization_id = $1 
       AND to_tsvector('english', content) @@ to_tsquery('english', $2)
     ORDER BY relevance DESC
     LIMIT $3`,
    [orgId, tsQuery, limit]
  );
  // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
  return result.rows;
}

export async function getDocumentGraph(orgId: number, documentId: string): Promise<any[]> {
  const db = await getDb();
  const result = await db.query(
    `SELECT * FROM ns_document_graph 
     WHERE organization_id = $1 AND (source_document_id = $2 OR target_document_id = $2)
     ORDER BY confidence DESC`,
    [orgId, documentId]
  );
  // @ts-expect-error NV-TS230 legacy typing gap (TS2322)
  return result.rows;
}

export async function addDocumentRelationship(
  orgId: number,
  sourceDocId: string,
  targetDocId: string,
  relationshipType: string,
  confidence: number,
  metadata?: Record<string, any>
): Promise<void> {
  const db = await getDb();
  await db.query(
    `INSERT INTO ns_document_graph (organization_id, source_document_id, target_document_id, relationship_type, confidence, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [orgId, sourceDocId, targetDocId, relationshipType, confidence, JSON.stringify(metadata || {})]
  );
}

let processingActive = false;
let pollInterval: ReturnType<typeof setInterval> | null = null;
/** Latched when PG 42P01/3F000 proves tables vanished after pre-flight passed. */
let pollerDisabledForSchemaDrift = false;

function isMissingTableError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: string }).code || '');
  return code === '42P01' || code === '3F000';
}

/**
 * Pre-flight check: returns true iff every table the poller depends on
 * exists in the public schema. When false, the caller should NOT start
 * the 3-second poll loop (which would otherwise spam logs with PG 42P01).
 *
 * Guards against environments where the document-pipeline tables haven't
 * been provisioned yet (DR replica before db:push, fresh dev sandbox,
 * staging-from-scratch).
 */
async function checkPollerDependenciesOrSkip(): Promise<boolean> {
  try {
    const db = await getDb();
    const required = ['ns_doc_processing_jobs', 'ns_parsed_documents'] as const;
    const r = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [required as unknown as string[]]
    );
    // @ts-expect-error NV-TS230 legacy typing gap (TS18048)
    const present = new Set<string>(r.rows.map((row: any) => row.table_name));
    const missing = required.filter(t => !present.has(t));
    if (missing.length > 0) {
      logger.warn(
        `⚠️  Document job poller DISABLED — missing required tables: ${missing.join(', ')}. ` +
        `Run \`npm run db:push --force\` to provision them. Document upload endpoints will reject until tables exist.`
      );
      return false;
    }
    return true;
  } catch (err: any) {
    logger.warn(`⚠️  Document job poller DISABLED — pre-flight check failed: ${err?.message || err}`);
    return false;
  }
}

export async function startJobPoller(intervalMs = 3000): Promise<void> {
  if (pollInterval) return;

  // Pre-flight gate — bail cleanly if backing tables are missing instead of
  // spamming the log every 3 s with "relation does not exist".
  const ok = await checkPollerDependenciesOrSkip();
  if (!ok) return;

  pollInterval = setInterval(async () => {
    if (pollerDisabledForSchemaDrift || processingActive) return;
    processingActive = true;

    try {
      const db = await getDb();
      const result = await db.query(
        `UPDATE ns_doc_processing_jobs 
         SET status = 'processing', worker_id = $1, started_at = NOW(), updated_at = NOW()
         WHERE id = (
           SELECT id FROM ns_doc_processing_jobs 
           WHERE status = 'queued' AND retry_count < max_retries
           ORDER BY priority ASC, created_at ASC 
           LIMIT 1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [WORKER_ID]
      );

      if ((result.rows?.length ?? 0) > 0) {
        const job = result.rows![0] as unknown as DocJobRecord;
        logger.info(`🔄 Processing job ${job.id}: ${job.file_name}`);

        try {
          const resolved = await resolveJobContentWithBinary(job);
          const meta = (job.metadata ?? {}) as { jurisdiction?: string; userId?: string };
          await processDocumentJob(job.id, resolved.text, {
            orgId: job.org_id,
            documentId: job.document_id ?? job.id,
            fileName: job.file_name || 'document',
            fileType: job.file_type || 'text',
            extractionMode: job.extraction_mode,
            jurisdiction: meta.jurisdiction,
            userId: meta.userId,
            metadata: {
              ...(job.metadata || {}),
              ...(resolved.bytes ? { sourceBytes: resolved.bytes } : {}),
            },
          });
        } catch (error: any) {
          const errMsg = error instanceof Error ? error.message : 'Unknown processing error';
          logger.error(`❌ Job ${job.id} failed: ${errMsg}`);
          await updateJobStatus(job.id, 'failed', job.progress || 0, { error_message: errMsg });

          await db.query(
            'UPDATE ns_doc_processing_jobs SET retry_count = retry_count + 1, updated_at = NOW() WHERE id = $1',
            [job.id]
          );
        }
      }
    } catch (error: any) {
      if (isMissingTableError(error)) {
        if (!pollerDisabledForSchemaDrift) {
          pollerDisabledForSchemaDrift = true;
          logger.warn(
            '⚠️  Document job poller DISABLED — ns_doc_processing_jobs missing (PG 42P01/3F000). ' +
            'Run `npm run db:push --force` or set JRX_DOC_PROCESSOR_ENABLED=0.',
          );
          stopJobPoller();
        }
      } else {
        logger.error('Job poller error:', error);
      }
    } finally {
      processingActive = false;
    }
  }, intervalMs);

  logger.info(`🏭 Document job poller started (interval: ${intervalMs}ms, worker: ${WORKER_ID})`);
}

export function stopJobPoller(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('🛑 Document job poller stopped');
  }
}
