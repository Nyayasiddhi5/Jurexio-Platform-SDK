import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-doc-service-contract');

interface ParseDocumentInput {
  content: string | Buffer;
  mimeType: string;
  fileName?: string;
  options?: { extractMetadata?: boolean; language?: string };
}

interface ParsedDocument {
  text: string;
  metadata: Record<string, unknown>;
  pages: number;
  language: string;
  mimeType: string;
}

interface ChunkDocumentInput {
  text: string;
  options?: { maxChunkSize?: number; overlap?: number; strategy?: string };
}

interface LegalChunk {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  metadata: Record<string, unknown>;
}

interface EmbedDocumentInput {
  chunks: LegalChunk[];
  model?: string;
}

interface EmbeddedDocument {
  chunks: (LegalChunk & { embedding: number[] })[];
  model: string;
  dimensions: number;
}

interface OcrInput {
  imageBuffer: Buffer;
  mimeType: string;
  language?: string;
  documentType?: string;
}

interface OcrResult {
  text: string;
  confidence: number;
  model: string;
  language: string;
  pages: { pageNumber: number; text: string }[];
  costCategory: 'cheap' | 'premium';
}

export interface NvDocServiceContract {
  parseDocument(input: ParseDocumentInput): Promise<ParsedDocument>;
  chunkDocument(input: ChunkDocumentInput): Promise<LegalChunk[]>;
  embedDocument(input: EmbedDocumentInput): Promise<EmbeddedDocument>;
  ocrDocument(input: OcrInput): Promise<OcrResult>;
}

export class NvDocServiceAdapter implements NvDocServiceContract {
  async parseDocument(input: ParseDocumentInput): Promise<ParsedDocument> {
    logger.info({ method: 'parseDocument', mimeType: input.mimeType });
    return {
      text: typeof input.content === 'string' ? input.content : input.content.toString('utf-8'),
      metadata: {},
      pages: 1,
      language: input.options?.language || 'en',
      mimeType: input.mimeType,
    };
  }

  async chunkDocument(input: ChunkDocumentInput): Promise<LegalChunk[]> {
    logger.info({ method: 'chunkDocument', textLength: input.text.length });
    const maxSize = input.options?.maxChunkSize || 1000;
    const chunks: LegalChunk[] = [];
    for (let i = 0; i < input.text.length; i += maxSize) {
      chunks.push({
        id: `chunk-${chunks.length}`,
        text: input.text.slice(i, i + maxSize),
        startOffset: i,
        endOffset: Math.min(i + maxSize, input.text.length),
        metadata: {},
      });
    }
    return chunks;
  }

  async embedDocument(input: EmbedDocumentInput): Promise<EmbeddedDocument> {
    logger.info({ method: 'embedDocument', chunkCount: input.chunks.length });
    return {
      chunks: input.chunks.map(c => ({ ...c, embedding: [] })),
      model: input.model || 'legal-bert',
      dimensions: 768,
    };
  }

  async ocrDocument(input: OcrInput): Promise<OcrResult> {
    logger.info({ method: 'ocrDocument', mimeType: input.mimeType });
    return {
      text: '',
      confidence: 0,
      model: process.env.NYV_DOC_OCR_MODEL || 'tesseract-indic-v5',
      language: input.language || 'en',
      pages: [],
      costCategory: 'cheap',
    };
  }
}

export const HTTP_CONTRACT = {
  serviceName: 'NYV-DOC-SERVICE',
  baseUrl: '/api/jrx/doc-service',
  endpoints: [
    { method: 'POST', path: '/parse', handler: 'parseDocument' },
    { method: 'POST', path: '/chunk', handler: 'chunkDocument' },
    { method: 'POST', path: '/embed', handler: 'embedDocument' },
    { method: 'POST', path: '/ocr', handler: 'ocrDocument' },
  ],
} as const;

export const GRPC_CONTRACT = {
  serviceName: 'NvDocService',
  package: 'nyv.doc.v1',
  methods: [
    { name: 'ParseDocument', requestType: 'ParseDocumentRequest', responseType: 'ParsedDocumentResponse' },
    { name: 'ChunkDocument', requestType: 'ChunkDocumentRequest', responseType: 'LegalChunkListResponse' },
    { name: 'EmbedDocument', requestType: 'EmbedDocumentRequest', responseType: 'EmbeddedDocumentResponse' },
    { name: 'OcrDocument', requestType: 'OcrRequest', responseType: 'OcrResponse' },
  ],
} as const;
