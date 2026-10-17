import { createLogger } from '../../utils/logger.js';

const logger = createLogger('./jrx-legal-embedding');

/**
 * Thrown when no embedding provider can be reached (no API key / no reachable
 * self-hosted endpoint, or the provider returns a hard error). Callers MUST
 * catch this and degrade EXPLICITLY to lexical / full-text retrieval — they
 * must never substitute random or synthetic vectors, which would silently
 * corrupt similarity ranking. This is a typed error so degradation can be
 * matched precisely (`err instanceof EmbeddingProviderUnavailableError`).
 */
export class EmbeddingProviderUnavailableError extends Error {
  readonly code = 'EMBEDDING_PROVIDER_UNAVAILABLE';
  readonly model?: string;
  readonly cause?: unknown;

  constructor(message: string, opts?: { model?: string; cause?: unknown }) {
    super(message);
    this.name = 'EmbeddingProviderUnavailableError';
    this.model = opts?.model;
    this.cause = opts?.cause;
    Object.setPrototypeOf(this, EmbeddingProviderUnavailableError.prototype);
  }
}

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GC' | 'SG';
type LegalDocType = 'statute' | 'case' | 'contract' | 'pleading' | 'affidavit' | 'order' | 'gazette' | 'other';

export interface EmbedOptions {
  jurisdiction: JurisdictionCode;
  language: string;
  docType: LegalDocType;
  namespace: 'global' | 'org' | 'user' | 'matter';
}

export interface EmbedResult {
  embedding: number[];
  model: string;
  dimensions: number;
  tokens: number;
}

interface EmbedModelConfig {
  modelId: string;
  apiType: 'openai' | 'self-hosted' | 'cohere';
  dimensions: number;
  endpoint?: string;
}

const INDIC_LANGUAGES = new Set(['hi', 'bn', 'te', 'ta', 'kn', 'ml', 'mr', 'gu', 'pa', 'or', 'as', 'ur']);

const MODEL_CONFIGS: Record<string, EmbedModelConfig> = {
  'multilingual-e5-large': { modelId: 'multilingual-e5-large', apiType: 'self-hosted', dimensions: 1024 },
  'in-legal-bert': { modelId: 'in-legal-bert', apiType: 'self-hosted', dimensions: 768 },
  'legal-bert-base': { modelId: 'legal-bert-base', apiType: 'self-hosted', dimensions: 768 },
  'text-embedding-3-large': { modelId: 'text-embedding-3-large', apiType: 'openai', dimensions: 1536 },
};

export class NvLegalEmbeddingService {
  private static instance: NvLegalEmbeddingService;

  private constructor() {}

  static getInstance(): NvLegalEmbeddingService {
    if (!NvLegalEmbeddingService.instance) {
      NvLegalEmbeddingService.instance = new NvLegalEmbeddingService();
    }
    return NvLegalEmbeddingService.instance;
  }

  async selectModel(context: EmbedOptions): Promise<EmbedModelConfig> {
    if (INDIC_LANGUAGES.has(context.language)) {
      const selfHostedUrl = process.env.MULTILINGUAL_E5_URL;
      if (selfHostedUrl) {
        return { ...MODEL_CONFIGS['multilingual-e5-large'], endpoint: selfHostedUrl };
      }
    }

    if (context.jurisdiction === 'IN' && (context.docType === 'statute' || context.docType === 'case')) {
      const inLegalUrl = process.env.IN_LEGAL_BERT_URL;
      if (inLegalUrl) {
        return { ...MODEL_CONFIGS['in-legal-bert'], endpoint: inLegalUrl };
      }
    }

    if (context.docType === 'contract' && context.language === 'en') {
      const legalBertUrl = process.env.LEGAL_BERT_URL;
      if (legalBertUrl) {
        return { ...MODEL_CONFIGS['legal-bert-base'], endpoint: legalBertUrl };
      }
    }

    return MODEL_CONFIGS['text-embedding-3-large'];
  }

  async embed(text: string, options: EmbedOptions): Promise<EmbedResult> {
    const startTime = Date.now();
    const modelConfig = await this.selectModel(options);

    try {
      let embedding: number[];

      if (modelConfig.apiType === 'openai') {
        embedding = await this.callOpenAIEmbed(text, modelConfig.modelId);
      } else if (modelConfig.apiType === 'self-hosted' && modelConfig.endpoint) {
        embedding = await this.callSelfHostedEmbed(text, modelConfig.endpoint);
      } else {
        embedding = await this.callOpenAIEmbed(text, 'text-embedding-3-large');
      }

      const tokens = Math.ceil(text.split(/\s+/).length * 1.3);

      logger.info({
        service: 'NvLegalEmbeddingService',
        method: 'embed',
        model: modelConfig.modelId,
        dimensions: embedding.length,
        tokens,
        jurisdiction: options.jurisdiction,
        durationMs: Date.now() - startTime,
      });

      return { embedding, model: modelConfig.modelId, dimensions: embedding.length, tokens };
    } catch (error: any) {
      logger.error({
        service: 'NvLegalEmbeddingService',
        method: 'embed',
        model: modelConfig.modelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      });

      // FAIL LOUD — never substitute random/synthetic vectors. A garbage vector
      // would silently rank documents at random; retrieval callers must instead
      // catch this and degrade explicitly to lexical / full-text search.
      if (error instanceof EmbeddingProviderUnavailableError) throw error;
      throw new EmbeddingProviderUnavailableError(
        `Embedding generation failed for model "${modelConfig.modelId}": ${error instanceof Error ? error.message : 'unknown error'}`,
        { model: modelConfig.modelId, cause: error },
      );
    }
  }

  async embedBatch(texts: string[], options: EmbedOptions): Promise<EmbedResult[]> {
    const results: EmbedResult[] = [];
    for (const text of texts) {
      results.push(await this.embed(text, options));
    }
    return results;
  }

  private async callOpenAIEmbed(text: string, model: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new EmbeddingProviderUnavailableError(
        'No embeddings API key configured (set OPENAI_API_KEY or OPENROUTER_API_KEY). ' +
          'Refusing to emit random vectors — caller must degrade to lexical/FTS retrieval.',
        { model },
      );
    }

    const isOpenRouter = !process.env.OPENAI_API_KEY;
    const baseUrl = isOpenRouter ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1';

    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: text.substring(0, 8000) }),
    });

    if (!response.ok) {
      throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json() as any;
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Embedding API returned no vector for model "${model}"`);
    }
    return embedding;
  }

  private async callSelfHostedEmbed(text: string, endpoint: string): Promise<number[]> {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.substring(0, 8000) }),
    });

    if (!response.ok) {
      throw new Error(`Self-hosted embedding error: ${response.status}`);
    }

    const data = await response.json() as any;
    const embedding = data?.embedding ?? data?.embeddings?.[0];
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error(`Self-hosted endpoint returned no vector (${endpoint})`);
    }
    return embedding;
  }
}

export const nvLegalEmbeddingService = NvLegalEmbeddingService.getInstance();
