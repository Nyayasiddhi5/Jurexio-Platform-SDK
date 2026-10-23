import { createLogger } from '../../utils/logger.js';
import { nvLegalParserService, type ParsedDocument, type LegalDocType } from './jrx-legal-parser-service.js';
import { isJrxFeatureOn } from '../../config/jrx-feature-flags.js';
import crypto from 'crypto';

const logger = createLogger('./jrx-legal-chunker');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';

export interface ChunkOptions {
  minChunkTokens?: number;
  maxChunkTokens?: number;
  overlapTokens?: number;
  jurisdiction?: JurisdictionCode;
  includeParentContext?: boolean;
  /**
   * NV-CTX-RETRIEVAL-001 — opt-in Anthropic-style contextual retrieval. When
   * true AND JRX_F_CONTEXTUAL_RETRIEVAL is on, each chunk is enriched with a
   * one-sentence LLM-generated situating header before it is returned (and
   * therefore before downstream embedding). Default false so the deterministic
   * chunker (and the legal-pipeline preview route) is unchanged and makes NO
   * LLM calls.
   */
  contextualize?: boolean;
  /** Optional document title used as enrichment context (e.g. "BNS 2023"). */
  docTitle?: string;
}

const CONTEXTUALIZE_CONCURRENCY = 4;

export interface LegalChunk {
  id: string;
  content: string;
  parentContext: string;
  chunkType: 'section' | 'clause' | 'definition' | 'recital' | 'schedule' | 'heading';
  level: number;
  sectionRef?: string;
  docType: LegalDocType;
  tokens: number;
  jurisdiction: JurisdictionCode;
  metadata: Record<string, unknown>;
}

const DEFAULT_MIN_CHUNK_TOKENS = 100;
const DEFAULT_MAX_CHUNK_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.split(/\s+/).filter(Boolean).length * 1.3);
}

function findSentenceBoundary(text: string, targetPosition: number): number {
  const sentenceEnders = /[.!?;]\s+/g;
  let lastEnd = 0;
  let match;
  while ((match = sentenceEnders.exec(text)) !== null) {
    if (match.index >= targetPosition) return match.index + match[0].length;
    lastEnd = match.index + match[0].length;
  }
  return lastEnd > 0 ? lastEnd : text.length;
}

export class NvLegalChunkerService {
  private static instance: NvLegalChunkerService;

  private constructor() {}

  static getInstance(): NvLegalChunkerService {
    if (!NvLegalChunkerService.instance) {
      NvLegalChunkerService.instance = new NvLegalChunkerService();
    }
    return NvLegalChunkerService.instance;
  }

  async chunkDocument(doc: ParsedDocument, options: ChunkOptions = {}): Promise<LegalChunk[]> {
    const startTime = Date.now();
    const minTokens = options.minChunkTokens || DEFAULT_MIN_CHUNK_TOKENS;
    const maxTokens = options.maxChunkTokens || DEFAULT_MAX_CHUNK_TOKENS;
    const overlapTokens = options.overlapTokens || DEFAULT_OVERLAP_TOKENS;
    const jurisdiction = options.jurisdiction || 'IN';
    const docType = doc.structure.docType;

    try {
      let chunks: LegalChunk[];

      switch (docType) {
        case 'statute':
          chunks = this.chunkStatute(doc, jurisdiction, minTokens, maxTokens, overlapTokens);
          break;
        case 'contract':
          chunks = this.chunkContract(doc, jurisdiction, minTokens, maxTokens, overlapTokens);
          break;
        case 'case':
        case 'order':
          chunks = this.chunkJudgment(doc, jurisdiction, minTokens, maxTokens, overlapTokens);
          break;
        default:
          chunks = this.chunkGeneric(doc, jurisdiction, minTokens, maxTokens, overlapTokens);
      }

      chunks = this.applyOverlap(chunks, overlapTokens);
      chunks = this.mergeSmallChunks(chunks, minTokens);

      // NV-CTX-RETRIEVAL-001 — opt-in contextual enrichment. Only runs when the
      // caller explicitly asks (options.contextualize) AND the flag is on, so
      // the deterministic chunking contract (and the preview route) is intact.
      if (options.contextualize && isJrxFeatureOn('contextualRetrieval')) {
        chunks = await this.contextualizeChunks(chunks, {
          docTitle: options.docTitle || doc.metadata?.title || 'Legal document',
          docType,
          jurisdiction,
        });
      }

      logger.info({
        service: 'NvLegalChunkerService',
        method: 'chunkDocument',
        docType,
        totalChunks: chunks.length,
        contextualized: Boolean(options.contextualize && isJrxFeatureOn('contextualRetrieval')),
        avgTokens: Math.round(chunks.reduce((s, c) => s + c.tokens, 0) / (chunks.length || 1)),
        durationMs: Date.now() - startTime,
      });

      return chunks;
    } catch (error: any) {
      logger.error({
        service: 'NvLegalChunkerService',
        method: 'chunkDocument',
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });
      return [this.createChunk(doc.content, 'Document', 'section', 1, docType, jurisdiction)];
    }
  }

  private chunkStatute(doc: ParsedDocument, jurisdiction: JurisdictionCode, minTokens: number, maxTokens: number, overlapTokens: number): LegalChunk[] {
    const chunks: LegalChunk[] = [];
    const breadcrumbParts: string[] = [];

    for (const section of doc.structure.sections) {
      if (section.level <= 2) {
        breadcrumbParts.length = 0;
        breadcrumbParts.push(section.title);
      } else {
        while (breadcrumbParts.length > section.level - 1) breadcrumbParts.pop();
        breadcrumbParts.push(section.title);
      }

      const parentContext = breadcrumbParts.join(' > ');
      const tokens = estimateTokens(section.content);

      if (tokens <= maxTokens) {
        chunks.push(this.createChunk(section.content, parentContext, 'section', section.level, doc.structure.docType, jurisdiction, section.sectionRef));
      } else {
        const subChunks = this.recursiveSplit(section.content, parentContext, section.level, maxTokens, doc.structure.docType, jurisdiction, section.sectionRef);
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  private chunkContract(doc: ParsedDocument, jurisdiction: JurisdictionCode, minTokens: number, maxTokens: number, overlapTokens: number): LegalChunk[] {
    const chunks: LegalChunk[] = [];
    const definitions = doc.structure.definitions;
    const defContext = Object.keys(definitions).length > 0 ? `Definitions: ${Object.entries(definitions).slice(0, 5).map(([k, v]) => `"${k}" = ${v.substring(0, 60)}`).join('; ')}` : '';

    for (const section of doc.structure.sections) {
      const isRecital = /recital|whereas/i.test(section.title);
      const isSchedule = /schedule|annexure|exhibit/i.test(section.title);
      const chunkType = isRecital ? 'recital' : isSchedule ? 'schedule' : 'clause';
      const parentContext = `Contract > ${section.title}`;
      const tokens = estimateTokens(section.content);

      if (tokens <= maxTokens) {
        const chunk = this.createChunk(section.content, parentContext, chunkType, section.level, 'contract', jurisdiction, section.sectionRef);
        if (defContext) chunk.metadata.definitions = defContext;
        chunks.push(chunk);
      } else {
        const subChunks = this.recursiveSplit(section.content, parentContext, section.level, maxTokens, 'contract', jurisdiction, section.sectionRef);
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  private chunkJudgment(doc: ParsedDocument, jurisdiction: JurisdictionCode, minTokens: number, maxTokens: number, overlapTokens: number): LegalChunk[] {
    const chunks: LegalChunk[] = [];
    const caseInfo = doc.structure.courts.length > 0 ? doc.structure.courts[0] : 'Court';

    for (const section of doc.structure.sections) {
      const parentContext = `${caseInfo} > ${section.title}`;
      const tokens = estimateTokens(section.content);

      if (tokens <= maxTokens) {
        chunks.push(this.createChunk(section.content, parentContext, 'section', section.level, doc.structure.docType, jurisdiction, section.sectionRef));
      } else {
        const subChunks = this.recursiveSplit(section.content, parentContext, section.level, maxTokens, doc.structure.docType, jurisdiction, section.sectionRef);
        chunks.push(...subChunks);
      }
    }

    return chunks;
  }

  private chunkGeneric(doc: ParsedDocument, jurisdiction: JurisdictionCode, minTokens: number, maxTokens: number, overlapTokens: number): LegalChunk[] {
    const chunks: LegalChunk[] = [];
    for (const section of doc.structure.sections) {
      const tokens = estimateTokens(section.content);
      if (tokens <= maxTokens) {
        chunks.push(this.createChunk(section.content, section.title, 'section', section.level, doc.structure.docType, jurisdiction));
      } else {
        chunks.push(...this.recursiveSplit(section.content, section.title, section.level, maxTokens, doc.structure.docType, jurisdiction));
      }
    }
    return chunks;
  }

  private recursiveSplit(text: string, parentContext: string, level: number, maxTokens: number, docType: LegalDocType, jurisdiction: JurisdictionCode, sectionRef?: string): LegalChunk[] {
    const tokens = estimateTokens(text);
    if (tokens <= maxTokens) {
      return [this.createChunk(text, parentContext, 'section', level, docType, jurisdiction, sectionRef)];
    }

    const chunks: LegalChunk[] = [];
    const words = text.split(/\s+/);
    const wordsPerChunk = Math.floor(maxTokens / 1.3);
    let start = 0;
    let partNum = 1;

    while (start < words.length) {
      const end = Math.min(start + wordsPerChunk, words.length);
      let chunkText = words.slice(start, end).join(' ');
      const boundaryPos = findSentenceBoundary(chunkText, Math.max(chunkText.length - 100, 0));
      if (boundaryPos > 0 && boundaryPos < chunkText.length && end < words.length) {
        chunkText = chunkText.substring(0, boundaryPos);
      }

      chunks.push(this.createChunk(chunkText, `${parentContext} (Part ${partNum})`, 'section', Math.min(level + 1, 5) as 1 | 2 | 3 | 4 | 5, docType, jurisdiction, sectionRef));
      start = end;
      partNum++;
    }

    return chunks;
  }

  private applyOverlap(chunks: LegalChunk[], overlapTokens: number): LegalChunk[] {
    if (chunks.length <= 1) return chunks;
    const overlapWordCount = Math.floor(overlapTokens / 1.3);

    for (let i = 1; i < chunks.length; i++) {
      const prevWords = chunks[i - 1].content.split(/\s+/);
      const overlapText = prevWords.slice(-overlapWordCount).join(' ');
      if (overlapText.length > 0) {
        chunks[i].content = `[...] ${overlapText} ${chunks[i].content}`;
        chunks[i].tokens = estimateTokens(chunks[i].content);
        chunks[i].id = crypto.createHash('sha256').update(chunks[i].content).digest('hex').substring(0, 16);
      }
    }

    return chunks;
  }

  private mergeSmallChunks(chunks: LegalChunk[], minTokens: number): LegalChunk[] {
    if (chunks.length <= 1) return chunks;
    const merged: LegalChunk[] = [];
    let buffer: LegalChunk | null = null;

    for (const chunk of chunks) {
      if (buffer) {
        if (buffer.tokens < minTokens) {
          buffer.content += '\n\n' + chunk.content;
          buffer.tokens = estimateTokens(buffer.content);
          buffer.id = crypto.createHash('sha256').update(buffer.content).digest('hex').substring(0, 16);
          continue;
        } else {
          merged.push(buffer);
          buffer = { ...chunk };
        }
      } else {
        buffer = { ...chunk };
      }
    }
    if (buffer) merged.push(buffer);

    return merged;
  }

  /**
   * NV-CTX-RETRIEVAL-001 — Anthropic-style contextual retrieval enrichment.
   *
   * For each chunk, generate a single concise sentence that situates the chunk
   * within its document (statute/act, section, what it governs) using the
   * canonical safety ring (callJurexioSimple → callJurexio, NV-LLM-001),
   * store it in `metadata.contextualHeader`, and prepend `[Context: …]` to the
   * chunk text so the SAME enriched text is what gets embedded and lexically
   * indexed downstream (the technique that materially lifts retrieval recall).
   *
   * Bounded concurrency + per-chunk fail-safe: if the LLM is unavailable or
   * errors for a chunk, that chunk is left untouched (keeps its deterministic
   * `parentContext` breadcrumb). NEVER fabricates context. Public so ingest
   * pipelines can call it directly on chunks built elsewhere.
   */
  async contextualizeChunks(
    chunks: LegalChunk[],
    docCtx: { docTitle: string; docType: LegalDocType; jurisdiction: JurisdictionCode },
  ): Promise<LegalChunk[]> {
    if (!isJrxFeatureOn('contextualRetrieval') || chunks.length === 0) return chunks;

    let callSimple: ((system: string, user: string, maxTokens?: number) => Promise<string>) | null = null;
    try {
      ({ callJurexioSimple: callSimple } = await import('../jrx-client.js'));
    } catch (err) {
      logger.warn('contextual-retrieval: LLM client unavailable, skipping enrichment', {
        error: (err as Error)?.message,
      });
      return chunks;
    }
    if (!callSimple) return chunks;

    const system =
      'You write a SINGLE concise sentence (max 30 words) that situates a chunk of a legal document ' +
      'within the whole document, to improve search retrieval. State the act/statute, the section/clause, ' +
      'and what the chunk governs. Output ONLY the sentence — no preamble, no quotes.';

    let enriched = 0;
    const enrichOne = async (chunk: LegalChunk): Promise<void> => {
      try {
        const user =
          `Document: ${docCtx.docTitle} (${docCtx.docType}, jurisdiction ${docCtx.jurisdiction})\n` +
          `Location: ${chunk.parentContext}${chunk.sectionRef ? ` [${chunk.sectionRef}]` : ''}\n` +
          `Chunk:\n${chunk.content.slice(0, 1200)}\n\n` +
          'Situating sentence:';
        const raw = await callSimple!(system, user, 60);
        const header = (raw || '')
          .trim()
          .split('\n')
          .map((l) => l.trim())
          .find((l) => l.length > 0) || '';
        const cleaned = header.replace(/^["'`]+|["'`]+$/g, '').trim().slice(0, 300);
        if (cleaned.length >= 8) {
          chunk.metadata.contextualHeader = cleaned;
          chunk.content = `[Context: ${cleaned}]\n${chunk.content}`;
          chunk.tokens = estimateTokens(chunk.content);
          chunk.id = crypto.createHash('sha256').update(chunk.content).digest('hex').substring(0, 16);
          enriched++;
        }
      } catch (err) {
        // Per-chunk fail-safe — keep the deterministic parentContext.
        logger.debug('contextual-retrieval: chunk enrichment failed (kept as-is)', {
          chunkId: chunk.id,
          error: (err as Error)?.message,
        });
      }
    };

    // Bounded-concurrency sweep so we don't fan out hundreds of LLM calls.
    for (let i = 0; i < chunks.length; i += CONTEXTUALIZE_CONCURRENCY) {
      await Promise.all(chunks.slice(i, i + CONTEXTUALIZE_CONCURRENCY).map(enrichOne));
    }

    logger.info('contextual-retrieval: enrichment complete', {
      total: chunks.length,
      enriched,
      docType: docCtx.docType,
      jurisdiction: docCtx.jurisdiction,
    });
    return chunks;
  }

  private createChunk(
    content: string, parentContext: string, chunkType: LegalChunk['chunkType'],
    level: number, docType: LegalDocType, jurisdiction: JurisdictionCode, sectionRef?: string
  ): LegalChunk {
    const tokens = estimateTokens(content);
    const id = crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
    return { id, content, parentContext, chunkType, level, sectionRef, docType, tokens, jurisdiction, metadata: {} };
  }
}

export const nvLegalChunkerService = NvLegalChunkerService.getInstance();
