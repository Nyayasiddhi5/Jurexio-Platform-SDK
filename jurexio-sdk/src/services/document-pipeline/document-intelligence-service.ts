// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
import { db as _raw_db } from '../../db/index.js';
import { lazyRequire } from '../../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { eq, desc, sql } from 'drizzle-orm';
import { createRequire } from 'module';
import { documentParsing as waiDocuments, documentExtractedContent as waiDocumentChunks } from '@shared/schema.js';
import { createLogger } from '../../utils/logger.js';
import { nvOcrAdapterService } from './jrx-got-ocr-adapter-service.js';


const logger = createLogger('document-intelligence-service');
const require = createRequire(import.meta.url);

export interface DocumentMetadata {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  pageCount?: number;
  language?: string;
  author?: string;
  createdDate?: Date;
  modifiedDate?: Date;
  title?: string;
  subject?: string;
  keywords?: string[];
  customMetadata?: Record<string, any>;
}

export interface DocumentContent {
  id: string;
  documentId: string;
  rawText: string;
  structuredContent: StructuredContent;
  tables: ExtractedTable[];
  images: ExtractedImage[];
  forms: ExtractedForm[];
}

export interface StructuredContent {
  sections: DocumentSection[];
  headers: string[];
  footers: string[];
  toc?: TableOfContents;
}

export interface DocumentSection {
  id: string;
  title?: string;
  level: number;
  content: string;
  pageNumber?: number;
  boundingBox?: BoundingBox;
}

export interface TableOfContents {
  entries: TocEntry[];
}

export interface TocEntry {
  title: string;
  pageNumber: number;
  level: number;
}

export interface ExtractedTable {
  id: string;
  pageNumber: number;
  headers: string[];
  rows: string[][];
  boundingBox?: BoundingBox;
  confidence: number;
}

export interface ExtractedImage {
  id: string;
  pageNumber: number;
  description?: string;
  altText?: string;
  base64?: string;
  boundingBox?: BoundingBox;
  confidence: number;
}

export interface ExtractedForm {
  id: string;
  fieldName: string;
  fieldValue: string;
  fieldType: 'text' | 'checkbox' | 'radio' | 'signature' | 'date' | 'number';
  pageNumber: number;
  confidence: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EntityExtraction {
  documentId: string;
  entities: ExtractedEntity[];
  keyPhrases: string[];
  topics: string[];
  sentiment?: SentimentAnalysis;
}

export interface ExtractedEntity {
  text: string;
  type: 'person' | 'organization' | 'location' | 'date' | 'money' | 'percent' | 'email' | 'phone' | 'url' | 'legal_reference' | 'custom';
  startOffset: number;
  endOffset: number;
  confidence: number;
  metadata?: Record<string, any>;
}

export interface SentimentAnalysis {
  overall: 'positive' | 'neutral' | 'negative';
  score: number;
  aspects: AspectSentiment[];
}

export interface AspectSentiment {
  aspect: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  score: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  content: string;
  chunkIndex: number;
  pageNumbers: number[];
  embedding?: number[];
  metadata: Record<string, any>;
}

export interface ProcessingResult {
  documentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  metadata: DocumentMetadata;
  content?: DocumentContent;
  entities?: EntityExtraction;
  chunks?: DocumentChunk[];
  classification?: DocumentClassification;
  summary?: string;
  processingTimeMs: number;
  errors: string[];
}

export interface DocumentClassification {
  primaryCategory: string;
  secondaryCategories: string[];
  documentType: string;
  confidenceScore: number;
  tags: string[];
}

interface PersistableDocument {
  documentId: string;
  userId?: string;
  organizationId?: number;
  filename: string;
  mimeType: string;
  size: number;
  pageCount?: number;
  language?: string;
  status: string;
  rawText?: string;
  structuredContent: any;
  entities: any;
  classification: any;
  summary?: string;
  tags: string[];
  metadata: any;
  processingTimeMs?: number;
}

class NyayavignyaDocumentIntelligenceService {
  private documents: Map<string, ProcessingResult> = new Map();
  private documentChunks: Map<string, DocumentChunk[]> = new Map();

  private readonly SUPPORTED_FORMATS = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/markdown',
    'text/csv',
    'image/jpeg',
    'image/png',
    'image/tiff',
    'application/json',
    'text/html'
  ];

  private readonly DOCUMENT_CATEGORIES = {
    'legal': ['contract', 'agreement', 'nda', 'terms', 'policy', 'license', 'deed', 'affidavit', 'petition'],
    'financial': ['invoice', 'receipt', 'statement', 'report', 'budget', 'forecast', 'tax', 'audit'],
    'hr': ['resume', 'cv', 'offer letter', 'employment', 'payroll', 'benefits', 'policy', 'handbook'],
    'technical': ['specification', 'documentation', 'manual', 'guide', 'api', 'architecture', 'design'],
    'business': ['proposal', 'presentation', 'memo', 'minutes', 'plan', 'strategy', 'report'],
    'medical': ['prescription', 'diagnosis', 'lab report', 'medical record', 'insurance', 'claim'],
    'general': ['letter', 'email', 'form', 'application', 'certificate', 'id', 'passport']
  };

  private readonly ENTITY_PATTERNS: Record<string, RegExp> = {
    email: /[\w.-]+@[\w.-]+\.\w+/g,
    phone: /\+?[\d\s()-]{10,}/g,
    url: /https?:\/\/[^\s]+/g,
    date: /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
    money: /\$[\d,]+(?:\.\d{2})?|\b\d+(?:,\d{3})*(?:\.\d{2})?\s*(?:USD|EUR|GBP|INR|JPY)\b/gi,
    percent: /\d+(?:\.\d+)?%/g,
    legal_reference: /\b(?:Section|Article|Clause)\s+\d+(?:\.\d+)*|\b\d+\s*(?:USC|CFR|IPC|CrPC|BNS)\s*§?\s*\d+/gi
  };

  async processDocument(input: {
    content: string | Buffer;
    filename: string;
    mimeType: string;
    userId?: string;
    organizationId?: number;
    options?: {
      extractTables?: boolean;
      extractImages?: boolean;
      extractForms?: boolean;
      performOCR?: boolean;
      generateSummary?: boolean;
      generateEmbeddings?: boolean;
      chunkSize?: number;
    };
  }): Promise<ProcessingResult> {
    const startTime = Date.now();
    const documentId = `doc-${Date.now()}-${crypto.randomUUID().substring(0, 9)}`;
    
    const result: ProcessingResult = {
      documentId,
      status: 'processing',
      metadata: {
        id: documentId,
        filename: input.filename,
        mimeType: input.mimeType,
        size: typeof input.content === 'string' ? input.content.length : input.content.length,
        createdDate: new Date()
      },
      processingTimeMs: 0,
      errors: []
    };

    try {
      if (!this.SUPPORTED_FORMATS.includes(input.mimeType)) {
        throw new Error(`Unsupported document format: ${input.mimeType}`);
      }

      const rawText = await this.extractRawText(input.content, input.mimeType, input.filename);

      result.content = await this.extractContent(rawText, input.mimeType, input.options);
      result.metadata.pageCount = this.estimatePageCount(rawText);
      result.metadata.language = this.detectLanguage(rawText);
      result.entities = await this.extractEntities(rawText, documentId);
      result.classification = this.classifyDocument(rawText, input.filename);
      
      if (input.options?.generateSummary !== false) {
        result.summary = this.generateSummary(rawText);
      }

      result.chunks = this.chunkDocument(rawText, documentId, input.options?.chunkSize || 512);
      this.documentChunks.set(documentId, result.chunks);

      result.status = 'completed';
      result.processingTimeMs = Date.now() - startTime;

      this.documents.set(documentId, result);
      await this.persistDocument(result, input.userId, input.organizationId);

    } catch (error: any) {
      result.status = 'failed';
      result.errors.push(error.message);
      result.processingTimeMs = Date.now() - startTime;
    }

    return result;
  }

  /**
   * Turn raw upload content into plain text.
   * - string content is used as-is
   * - text/* and JSON buffers are decoded as UTF-8
   * - Word documents are parsed with mammoth
   * - PDFs and images go through the real OCR engine (digital text first, then OCR)
   */
  private async extractRawText(content: string | Buffer, mimeType: string, filename: string): Promise<string> {
    if (typeof content === 'string') return content;

    if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'text/html') {
      return content.toString('utf-8');
    }

    if (mimeType.includes('wordprocessingml') || mimeType === 'application/msword') {
      const mammoth = require('mammoth');
      const { value } = await mammoth.extractRawText({ buffer: content });
      const text = (value || '').trim();
      if (!text) throw new Error(`No text could be extracted from ${filename}`);
      return text;
    }

    if (mimeType === 'application/pdf' || mimeType.startsWith('image/')) {
      const ocr = await nvOcrAdapterService.ocrDocument(content, mimeType, {});
      logger.info('extractRawText:ocr', { filename, mimeType, provider: ocr.provider, method: ocr.extractionMethod, chars: ocr.text.length });
      return ocr.text;
    }

    // Other supported binary formats (xls/ppt) — best-effort UTF-8 decode.
    return content.toString('utf-8');
  }

  private async extractContent(text: string, mimeType: string, options?: any): Promise<DocumentContent> {
    const sections = this.extractSections(text);
    const tables = options?.extractTables ? this.extractTables(text) : [];
    
    return {
      id: `content-${Date.now()}`,
      documentId: '',
      rawText: text,
      structuredContent: {
        sections,
        headers: this.extractHeaders(text),
        footers: this.extractFooters(text),
        toc: this.extractTableOfContents(text)
      },
      tables,
      images: [],
      forms: options?.extractForms ? this.extractForms(text) : []
    };
  }

  private extractSections(text: string): DocumentSection[] {
    const sections: DocumentSection[] = [];
    const lines = text.split('\n');
    let currentSection: DocumentSection | null = null;
    let sectionContent: string[] = [];
    let sectionIndex = 0;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/) || 
                          trimmedLine.match(/^(\d+\.)+\s+(.+)$/);
      
      if (headingMatch || (trimmedLine.length < 100 && trimmedLine === trimmedLine.toUpperCase() && trimmedLine.length > 5)) {
        if (currentSection) {
          currentSection.content = sectionContent.join('\n');
          sections.push(currentSection);
        }
        
        const level = headingMatch ? 
          (headingMatch[1].startsWith('#') ? headingMatch[1].length : headingMatch[1].split('.').length) : 
          1;
        
        currentSection = {
          id: `section-${sectionIndex++}`,
          title: headingMatch ? headingMatch[2] : trimmedLine,
          level,
          content: ''
        };
        sectionContent = [];
      } else if (currentSection) {
        sectionContent.push(line);
      } else if (trimmedLine.length > 0) {
        currentSection = {
          id: `section-${sectionIndex++}`,
          title: undefined,
          level: 1,
          content: ''
        };
        sectionContent = [line];
      }
    }

    if (currentSection) {
      currentSection.content = sectionContent.join('\n');
      sections.push(currentSection);
    }

    return sections;
  }

  private extractHeaders(text: string): string[] {
    const lines = text.split('\n').slice(0, 10);
    return lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.length > 0 && trimmed.length < 200;
    }).slice(0, 3);
  }

  private extractFooters(text: string): string[] {
    const lines = text.split('\n').slice(-10);
    return lines.filter(line => {
      const trimmed = line.trim();
      return trimmed.match(/page\s*\d+|©|\d{4}|all rights reserved/i);
    });
  }

  private extractTableOfContents(text: string): TableOfContents | undefined {
    const tocMatch = text.match(/table of contents|contents\n([\s\S]*?)(?:\n\n|\n[A-Z])/i);
    if (!tocMatch) return undefined;

    const entries: TocEntry[] = [];
    const tocLines = tocMatch[1].split('\n');
    
    for (const line of tocLines) {
      const match = line.match(/^(\s*)(.+?)\s*\.{2,}\s*(\d+)/);
      if (match) {
        entries.push({
          title: match[2].trim(),
          pageNumber: parseInt(match[3]),
          level: Math.floor(match[1].length / 2) + 1
        });
      }
    }

    return entries.length > 0 ? { entries } : undefined;
  }

  private extractTables(text: string): ExtractedTable[] {
    const tables: ExtractedTable[] = [];
    const tablePattern = /\|.+\|(?:\n\|.+\|)+/g;
    let match;
    let tableIndex = 0;

    while ((match = tablePattern.exec(text)) !== null) {
      const tableText = match[0];
      const rows = tableText.split('\n').filter(r => r.trim());
      
      if (rows.length < 2) continue;

      const parseRow = (row: string): string[] => {
        return row.split('|').filter(cell => cell.trim()).map(cell => cell.trim());
      };

      const headers = parseRow(rows[0]);
      const dataRows = rows.slice(1)
        .filter(r => !r.match(/^[\|\s\-:]+$/))
        .map(parseRow);

      tables.push({
        id: `table-${tableIndex++}`,
        pageNumber: 1,
        headers,
        rows: dataRows,
        confidence: 0.85
      });
    }

    return tables;
  }

  private extractForms(text: string): ExtractedForm[] {
    const forms: ExtractedForm[] = [];
    const fieldPattern = /([A-Za-z\s]+):\s*(.+?)(?=\n|$)/g;
    let match;
    let formIndex = 0;

    while ((match = fieldPattern.exec(text)) !== null) {
      const fieldName = match[1].trim();
      const fieldValue = match[2].trim();

      if (fieldName.length > 2 && fieldValue.length > 0) {
        let fieldType: 'text' | 'checkbox' | 'radio' | 'signature' | 'date' | 'number' = 'text';
        
        if (fieldValue.match(/^\d+$/)) fieldType = 'number';
        if (fieldValue.match(/\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/)) fieldType = 'date';
        if (fieldValue.match(/^(?:yes|no|true|false|x|✓)$/i)) fieldType = 'checkbox';

        forms.push({
          id: `form-field-${formIndex++}`,
          fieldName,
          fieldValue,
          fieldType,
          pageNumber: 1,
          confidence: 0.8
        });
      }
    }

    return forms;
  }

  private async extractEntities(text: string, documentId: string): Promise<EntityExtraction> {
    const entities: ExtractedEntity[] = [];
    
    for (const [entityType, pattern] of Object.entries(this.ENTITY_PATTERNS)) {
      let match;
      const regex = new RegExp(pattern.source, pattern.flags);
      
      while ((match = regex.exec(text)) !== null) {
        entities.push({
          text: match[0],
          type: entityType as any,
          startOffset: match.index,
          endOffset: match.index + match[0].length,
          confidence: 0.9
        });
      }
    }

    const words = text.toLowerCase().split(/\s+/);
    const wordFreq: Record<string, number> = {};
    
    for (const word of words) {
      if (word.length > 4) {
        wordFreq[word] = (wordFreq[word] || 0) + 1;
      }
    }

    const keyPhrases = Object.entries(wordFreq)
      .filter(([_, count]) => count > 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);

    const topics = this.extractTopics(text);

    return {
      documentId,
      entities,
      keyPhrases,
      topics,
      sentiment: this.analyzeSentiment(text)
    };
  }

  private extractTopics(text: string): string[] {
    const topicKeywords: Record<string, string[]> = {
      'Legal': ['agreement', 'contract', 'party', 'terms', 'conditions', 'liability', 'indemnify'],
      'Financial': ['revenue', 'profit', 'expense', 'budget', 'forecast', 'investment', 'capital'],
      'Technical': ['system', 'architecture', 'implementation', 'api', 'database', 'algorithm'],
      'HR': ['employee', 'salary', 'benefits', 'performance', 'hiring', 'onboarding'],
      'Marketing': ['campaign', 'brand', 'audience', 'engagement', 'conversion', 'marketing'],
      'Operations': ['process', 'workflow', 'efficiency', 'optimization', 'production', 'logistics']
    };

    const lowerText = text.toLowerCase();
    const detectedTopics: [string, number][] = [];

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      let matchCount = 0;
      for (const keyword of keywords) {
        if (lowerText.includes(keyword)) matchCount++;
      }
      if (matchCount >= 2) {
        detectedTopics.push([topic, matchCount]);
      }
    }

    return detectedTopics
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);
  }

  private analyzeSentiment(text: string): SentimentAnalysis {
    const positiveWords = ['excellent', 'great', 'good', 'positive', 'success', 'benefit', 'improve', 'growth'];
    const negativeWords = ['poor', 'bad', 'negative', 'failure', 'issue', 'problem', 'risk', 'decline'];
    
    const lowerText = text.toLowerCase();
    let positiveCount = 0;
    let negativeCount = 0;

    for (const word of positiveWords) {
      const matches = lowerText.match(new RegExp(word, 'g'));
      positiveCount += matches ? matches.length : 0;
    }

    for (const word of negativeWords) {
      const matches = lowerText.match(new RegExp(word, 'g'));
      negativeCount += matches ? matches.length : 0;
    }

    const score = positiveCount - negativeCount;
    let overall: 'positive' | 'neutral' | 'negative' = 'neutral';
    if (score > 3) overall = 'positive';
    if (score < -3) overall = 'negative';

    return {
      overall,
      score: Math.max(-1, Math.min(1, score / 10)),
      aspects: []
    };
  }

  private classifyDocument(text: string, filename: string): DocumentClassification {
    const lowerText = text.toLowerCase();
    const lowerFilename = filename.toLowerCase();
    let bestCategory = 'general';
    let bestScore = 0;
    const matchedKeywords: string[] = [];

    for (const [category, keywords] of Object.entries(this.DOCUMENT_CATEGORIES)) {
      let score = 0;
      for (const keyword of keywords) {
        if (lowerText.includes(keyword) || lowerFilename.includes(keyword)) {
          score++;
          matchedKeywords.push(keyword);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestCategory = category;
      }
    }

    let documentType = 'document';
    if (lowerFilename.endsWith('.pdf')) documentType = 'pdf';
    if (lowerFilename.endsWith('.docx') || lowerFilename.endsWith('.doc')) documentType = 'word';
    if (lowerFilename.endsWith('.xlsx') || lowerFilename.endsWith('.xls')) documentType = 'spreadsheet';
    if (lowerFilename.endsWith('.pptx') || lowerFilename.endsWith('.ppt')) documentType = 'presentation';
    if (lowerFilename.endsWith('.txt')) documentType = 'text';
    if (lowerFilename.endsWith('.md')) documentType = 'markdown';

    return {
      primaryCategory: bestCategory,
      secondaryCategories: Object.keys(this.DOCUMENT_CATEGORIES).filter(c => c !== bestCategory).slice(0, 2),
      documentType,
      confidenceScore: Math.min(0.95, 0.5 + (bestScore * 0.1)),
      tags: Array.from(new Set(matchedKeywords)).slice(0, 10)
    };
  }

  private generateSummary(text: string): string {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 20);
    if (sentences.length === 0) return text.substring(0, 200);

    const importantSentences = sentences.slice(0, 3).map(s => s.trim());
    return importantSentences.join('. ') + '.';
  }

  private chunkDocument(text: string, documentId: string, chunkSize: number): DocumentChunk[] {
    const chunks: DocumentChunk[] = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = '';
    let chunkIndex = 0;

    for (const sentence of sentences) {
      if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 0) {
        chunks.push({
          id: `chunk-${documentId}-${chunkIndex}`,
          documentId,
          content: currentChunk.trim(),
          chunkIndex,
          pageNumbers: [Math.floor(chunkIndex / 3) + 1],
          metadata: {}
        });
        currentChunk = sentence;
        chunkIndex++;
      } else {
        currentChunk += (currentChunk.length > 0 ? ' ' : '') + sentence;
      }
    }

    if (currentChunk.trim().length > 0) {
      chunks.push({
        id: `chunk-${documentId}-${chunkIndex}`,
        documentId,
        content: currentChunk.trim(),
        chunkIndex,
        pageNumbers: [Math.floor(chunkIndex / 3) + 1],
        metadata: {}
      });
    }

    return chunks;
  }

  private estimatePageCount(text: string): number {
    const wordsPerPage = 300;
    const wordCount = text.split(/\s+/).length;
    return Math.max(1, Math.ceil(wordCount / wordsPerPage));
  }

  private detectLanguage(text: string): string {
    const sample = text.substring(0, 1000).toLowerCase();
    
    if (sample.match(/\b(the|is|are|was|were|have|has|been|being)\b/)) return 'en';
    if (sample.match(/[अ-ह]/)) return 'hi';
    if (sample.match(/[ا-ي]/)) return 'ar';
    if (sample.match(/[あ-んア-ン]/)) return 'ja';
    if (sample.match(/[가-힣]/)) return 'ko';
    if (sample.match(/[一-龯]/)) return 'zh';
    if (sample.match(/\b(der|die|das|und|ist|sind)\b/)) return 'de';
    if (sample.match(/\b(le|la|les|est|sont|dans)\b/)) return 'fr';
    if (sample.match(/\b(el|la|los|las|es|son)\b/)) return 'es';
    
    return 'en';
  }

  private async persistDocument(result: ProcessingResult, userId?: string, organizationId?: number): Promise<void> {
    try {
      const docData: PersistableDocument = {
        documentId: result.documentId,
        userId,
        organizationId,
        filename: result.metadata.filename,
        mimeType: result.metadata.mimeType,
        size: result.metadata.size,
        pageCount: result.metadata.pageCount,
        language: result.metadata.language,
        status: result.status,
        rawText: result.content?.rawText?.substring(0, 50000),
        structuredContent: result.content?.structuredContent || {},
        entities: result.entities || {},
        classification: result.classification || {},
        summary: result.summary,
        tags: result.classification?.tags || [],
        metadata: result.metadata,
        processingTimeMs: result.processingTimeMs
      };

      await db.insert(waiDocuments).values(docData as any).onConflictDoUpdate({
        // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
        target: waiDocuments.documentId,
        set: {
          status: result.status,
          content: result.content?.rawText || '',
          entities: result.entities || {},
          classification: result.classification || {},
          summary: result.summary,
          updatedAt: new Date()
        } as any
      });

      if (result.chunks && result.chunks.length > 0) {
        for (const chunk of result.chunks.slice(0, 100)) {
          await db.insert(waiDocumentChunks).values({
            chunkId: chunk.id,
            documentId: chunk.documentId,
            content: chunk.content,
            chunkIndex: chunk.chunkIndex,
            pageNumbers: chunk.pageNumbers,
            metadata: chunk.metadata
          } as any).onConflictDoNothing();
        }
      }
    } catch (error: any) {
      logger.error('Failed to persist document:', error);
    }
  }

  async searchDocuments(query: string, options?: {
    userId?: string;
    organizationId?: number;
    category?: string;
    limit?: number;
  }): Promise<ProcessingResult[]> {
    const allDocs = Array.from(this.documents.values());
    const lowerQuery = query.toLowerCase();

    return allDocs
      .filter(doc => {
        const text = doc.content?.rawText?.toLowerCase() || '';
        const filename = doc.metadata.filename.toLowerCase();
        const summary = doc.summary?.toLowerCase() || '';
        
        const matchesQuery = text.includes(lowerQuery) || 
                            filename.includes(lowerQuery) || 
                            summary.includes(lowerQuery);
        
        const matchesCategory = !options?.category || 
                               doc.classification?.primaryCategory === options.category;
        
        return matchesQuery && matchesCategory;
      })
      .slice(0, options?.limit || 10);
  }

  getDocument(documentId: string): ProcessingResult | undefined {
    return this.documents.get(documentId);
  }

  getDocumentChunks(documentId: string): DocumentChunk[] {
    return this.documentChunks.get(documentId) || [];
  }

  getSupportedFormats(): string[] {
    return this.SUPPORTED_FORMATS;
  }

  getCategories(): typeof this.DOCUMENT_CATEGORIES {
    return this.DOCUMENT_CATEGORIES;
  }

  getStats(): {
    totalDocuments: number;
    totalChunks: number;
    byCategory: Record<string, number>;
    byStatus: Record<string, number>;
    supportedFormats: number;
  } {
    const docs = Array.from(this.documents.values());
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};

    for (const doc of docs) {
      const cat = doc.classification?.primaryCategory || 'unknown';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
      byStatus[doc.status] = (byStatus[doc.status] || 0) + 1;
    }

    return {
      totalDocuments: docs.length,
      totalChunks: Array.from(this.documentChunks.values()).reduce((sum, chunks) => sum + chunks.length, 0),
      byCategory,
      byStatus,
      supportedFormats: this.SUPPORTED_FORMATS.length
    };
  }
}

export { NyayavignyaDocumentIntelligenceService as DocumentIntelligenceService };
export const documentIntelligenceService = new NyayavignyaDocumentIntelligenceService();
