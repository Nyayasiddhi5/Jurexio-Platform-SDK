import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-rag-service-contract');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface RagQueryInput {
  query: string;
  jurisdiction: JurisdictionCode;
  maxResults?: number;
  filters?: Record<string, unknown>;
  rerankStrategy?: 'rrf' | 'cross-encoder' | 'mmr';
}

interface RagQueryResult {
  chunks: RetrievedChunk[];
  totalFound: number;
  rerankScore: number;
  model: string;
  latencyMs: number;
}

interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
  source: string;
}

interface IndexDocumentInput {
  documentId: string;
  chunks: { text: string; metadata: Record<string, unknown> }[];
  jurisdiction: JurisdictionCode;
  collection?: string;
}

interface IndexResult {
  documentId: string;
  chunksIndexed: number;
  collection: string;
}

interface CitationVerifyInput {
  citations: string[];
  jurisdiction: JurisdictionCode;
}

interface CitationVerifyResult {
  verified: { citation: string; valid: boolean; source?: string }[];
  overallScore: number;
  hallucinatedCount: number;
}

export interface NvRagServiceContract {
  query(input: RagQueryInput): Promise<RagQueryResult>;
  indexDocument(input: IndexDocumentInput): Promise<IndexResult>;
  verifyCitations(input: CitationVerifyInput): Promise<CitationVerifyResult>;
  deleteDocument(documentId: string): Promise<void>;
}

export class NvRagServiceAdapter implements NvRagServiceContract {
  async query(input: RagQueryInput): Promise<RagQueryResult> {
    logger.info({ method: 'query', jurisdiction: input.jurisdiction, maxResults: input.maxResults });
    return {
      chunks: [],
      totalFound: 0,
      rerankScore: 0,
      model: 'legal-bert',
      latencyMs: 0,
    };
  }

  async indexDocument(input: IndexDocumentInput): Promise<IndexResult> {
    logger.info({ method: 'indexDocument', documentId: input.documentId, chunkCount: input.chunks.length });
    return {
      documentId: input.documentId,
      chunksIndexed: input.chunks.length,
      collection: input.collection || 'default',
    };
  }

  async verifyCitations(input: CitationVerifyInput): Promise<CitationVerifyResult> {
    logger.info({ method: 'verifyCitations', citationCount: input.citations.length });
    return {
      verified: input.citations.map(c => ({ citation: c, valid: false })),
      overallScore: 0,
      hallucinatedCount: input.citations.length,
    };
  }

  async deleteDocument(documentId: string): Promise<void> {
    logger.info({ method: 'deleteDocument', documentId });
  }
}

export const HTTP_CONTRACT = {
  serviceName: 'JRX-RAG-SERVICE',
  baseUrl: '/api/jrx/rag-service',
  endpoints: [
    { method: 'POST', path: '/query', handler: 'query' },
    { method: 'POST', path: '/index', handler: 'indexDocument' },
    { method: 'POST', path: '/verify-citations', handler: 'verifyCitations' },
    { method: 'DELETE', path: '/document/:id', handler: 'deleteDocument' },
  ],
} as const;

export const GRPC_CONTRACT = {
  serviceName: 'NvRagService',
  package: 'nyv.rag.v1',
  methods: [
    { name: 'Query', requestType: 'RagQueryRequest', responseType: 'RagQueryResponse' },
    { name: 'IndexDocument', requestType: 'IndexDocumentRequest', responseType: 'IndexResponse' },
    { name: 'VerifyCitations', requestType: 'CitationVerifyRequest', responseType: 'CitationVerifyResponse' },
    { name: 'DeleteDocument', requestType: 'DocumentIdRequest', responseType: 'Empty' },
  ],
} as const;
