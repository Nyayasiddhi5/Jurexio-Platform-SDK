// NYV-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * Embedding Service for Jurexio Knowledge Base System
 * Production-ready text embedding generation with multiple provider support
 */
import OpenAI from 'openai';
import { EventEmitter } from 'events';
import { createLogger } from '../../utils/logger.js';
import { recordAuxSpend } from '../../utils/jrx-request-usage-context.js';
import { NV_AUX_RATES } from '../../middleware/jrx-aux-cost-estimator.js';


const logger = createLogger('embedding-service');

export interface EmbeddingRequest {
  text: string;
  model?: string;
  provider?: EmbeddingProvider;
  metadata?: Record<string, any>;
  maxTokens?: number;
  chunkSize?: number;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  provider: EmbeddingProvider;
  tokenCount: number;
  cost?: number;
  processingTime: number;
  metadata?: Record<string, any>;
}

export interface BatchEmbeddingRequest {
  texts: string[];
  model?: string;
  provider?: EmbeddingProvider;
  metadata?: Record<string, any>;
  maxTokens?: number;
  batchSize?: number;
}

export interface BatchEmbeddingResponse {
  embeddings: EmbeddingResponse[];
  totalCost: number;
  totalProcessingTime: number;
  successCount: number;
  errorCount: number;
  errors: EmbeddingError[];
}

export interface EmbeddingError {
  text: string;
  error: string;
  index: number;
}

export type EmbeddingProvider = 'openai' | 'anthropic' | 'google' | 'huggingface' | 'cohere' | 'local';

export interface EmbeddingProviderConfig {
  apiKey?: string;
  baseURL?: string;
  model: string;
  dimension: number;
  maxTokens: number;
  costPerToken: number;
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
}

export interface EmbeddingServiceConfig {
  providers: Record<EmbeddingProvider, EmbeddingProviderConfig>;
  defaultProvider: EmbeddingProvider;
  defaultModel: string;
  caching: {
    enabled: boolean;
    ttl: number;
    maxSize: number;
  };
  rateLimiting: {
    enabled: boolean;
    maxConcurrent: number;
    requestDelay: number;
  };
  monitoring: {
    enabled: boolean;
    metricsInterval: number;
  };
}

export interface EmbeddingMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalCost: number;
  averageProcessingTime: number;
  totalTokensProcessed: number;
  providerUsage: Record<EmbeddingProvider, number>;
  modelUsage: Record<string, number>;
  cacheHitRate: number;
}

export interface EmbeddingCache {
  get(key: string): Promise<number[] | null>;
  set(key: string, embedding: number[], ttl: number): Promise<void>;
  clear(): Promise<void>;
  size(): Promise<number>;
}

class MemoryEmbeddingCache implements EmbeddingCache {
  private cache = new Map<string, { embedding: number[]; expires: number }>();
  private maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  async get(key: string): Promise<number[] | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expires) {
      this.cache.delete(key);
      return null;
    }
    
    return item.embedding;
  }

  async set(key: string, embedding: number[], ttl: number): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      embedding,
      expires: Date.now() + (ttl * 1000)
    });
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async size(): Promise<number> {
    return this.cache.size;
  }
}

export class NyayavignyaEmbeddingService extends EventEmitter {
  private config: EmbeddingServiceConfig;
  private openaiClient?: OpenAI;
  private cache: EmbeddingCache;
  private metrics: EmbeddingMetrics;
  private rateLimiters: Map<EmbeddingProvider, { lastRequest: number; requestCount: number }>;

  constructor(config: EmbeddingServiceConfig) {
    super();
    this.config = config;
    this.cache = new MemoryEmbeddingCache(config.caching.maxSize);
    this.rateLimiters = new Map();

    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalCost: 0,
      averageProcessingTime: 0,
      totalTokensProcessed: 0,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2740)
      providerUsage: {},
      modelUsage: {},
      cacheHitRate: 0
    };

    this.initializeProviders();
    this.startMetricsCollection();
  }

  private initializeProviders(): void {
    const providers = this.config.providers;

    if (providers.openai?.apiKey) {
      this.openaiClient = new OpenAI({
        apiKey: providers.openai.apiKey,
        baseURL: providers.openai.baseURL,
        dangerouslyAllowBrowser: true
      });
    }

    logger.info('🧠 Jurexio Embedding service initialized with providers:', Object.keys(providers));
  }

  private startMetricsCollection(): void {
    if (!this.config.monitoring.enabled) return;

    setInterval(() => {
      this.emit('metrics', this.metrics);
    }, this.config.monitoring.metricsInterval);
  }

  private async checkRateLimit(provider: EmbeddingProvider): Promise<void> {
    if (!this.config.rateLimiting.enabled) return;

    const now = Date.now();
    const rateLimiter = this.rateLimiters.get(provider) || { lastRequest: 0, requestCount: 0 };
    const providerConfig = this.config.providers[provider];

    if (!providerConfig) return;

    if (now - rateLimiter.lastRequest > 60000) {
      rateLimiter.requestCount = 0;
    }

    if (rateLimiter.requestCount >= providerConfig.rateLimit.requestsPerMinute) {
      const waitTime = 60000 - (now - rateLimiter.lastRequest);
      if (waitTime > 0) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      rateLimiter.requestCount = 0;
    }

    rateLimiter.lastRequest = now;
    rateLimiter.requestCount++;
    this.rateLimiters.set(provider, rateLimiter);

    if (this.config.rateLimiting.requestDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.rateLimiting.requestDelay));
    }
  }

  private generateCacheKey(text: string, model: string, provider: EmbeddingProvider): string {
    const content = `${provider}:${model}:${text}`;
    return Buffer.from(content).toString('base64').slice(0, 50);
  }

  private async getCachedEmbedding(
    text: string, 
    model: string, 
    provider: EmbeddingProvider
  ): Promise<number[] | null> {
    if (!this.config.caching.enabled) return null;
    
    const cacheKey = this.generateCacheKey(text, model, provider);
    return await this.cache.get(cacheKey);
  }

  private async cacheEmbedding(
    text: string, 
    model: string, 
    provider: EmbeddingProvider, 
    embedding: number[]
  ): Promise<void> {
    if (!this.config.caching.enabled) return;
    
    const cacheKey = this.generateCacheKey(text, model, provider);
    await this.cache.set(cacheKey, embedding, this.config.caching.ttl);
  }

  private async generateOpenAIEmbedding(
    text: string, 
    model: string
  ): Promise<{ embedding: number[]; tokenCount: number; cost: number }> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const response = await this.openaiClient.embeddings.create({
      model,
      input: text,
      encoding_format: 'float'
    });

    const embedding = response.data[0].embedding;
    const tokenCount = response.usage.total_tokens;
    const providerConfig = this.config.providers.openai;
    const cost = tokenCount * providerConfig.costPerToken;

    return { embedding, tokenCount, cost };
  }

  private async generateGoogleEmbedding(
    text: string,
    model: string
  ): Promise<{ embedding: number[]; tokenCount: number; cost: number }> {
    const { generateGeminiEmbedding } = await import('../jrx-gemini-embeddings.js');
    const embedding = await generateGeminiEmbedding(text);
    if (!embedding?.length) {
      throw new Error(`Google/Gemini embedding failed for model ${model || 'gemini-embedding-2'}`);
    }
    return {
      embedding,
      tokenCount: Math.ceil(text.split(/\s+/).length * 1.3),
      cost: 0,
    };
  }

  private async generateAnthropicEmbedding(
    text: string, 
    model: string
  ): Promise<{ embedding: number[]; tokenCount: number; cost: number }> {
    throw new Error('Anthropic embedding not yet implemented');
  }

  private async generateLocalEmbedding(
    text: string, 
    model: string
  ): Promise<{ embedding: number[]; tokenCount: number; cost: number }> {
    return this.generateLocalHashEmbedding(text);
  }

  /** Deterministic bag-of-hashes embedding so RAG never hard-fails when all cloud providers 429. */
  private async generateLocalHashEmbedding(
    text: string,
  ): Promise<{ embedding: number[]; tokenCount: number; cost: number }> {
    const dims = 384;
    const vec = new Array<number>(dims).fill(0);
    const tokens = String(text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1)
      .slice(0, 512);
    for (const tok of tokens) {
      let h = 2166136261;
      for (let i = 0; i < tok.length; i++) {
        h ^= tok.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const idx = Math.abs(h) % dims;
      vec[idx] += 1;
      vec[(idx + 17) % dims] += 0.5;
    }
    let norm = 0;
    for (const v of vec) norm += v * v;
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < dims; i++) vec[i] /= norm;
    return { embedding: vec, tokenCount: tokens.length, cost: 0 };
  }

  private updateMetrics(
    provider: EmbeddingProvider,
    model: string,
    processingTime: number,
    tokenCount: number,
    cost: number,
    success: boolean,
    cacheHit: boolean
  ): void {
    this.metrics.totalRequests++;
    
    if (success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
    }

    this.metrics.totalCost += cost;
    this.metrics.totalTokensProcessed += tokenCount;
    
    this.metrics.averageProcessingTime = 
      ((this.metrics.averageProcessingTime * (this.metrics.totalRequests - 1)) + processingTime) / 
      this.metrics.totalRequests;

    this.metrics.providerUsage[provider] = (this.metrics.providerUsage[provider] || 0) + 1;
    this.metrics.modelUsage[model] = (this.metrics.modelUsage[model] || 0) + 1;

    if (cacheHit) {
      const totalCacheableRequests = this.metrics.totalRequests;
      this.metrics.cacheHitRate = 
        ((this.metrics.cacheHitRate * (totalCacheableRequests - 1)) + 1) / totalCacheableRequests;
    }
  }

  async generateEmbedding(request: EmbeddingRequest): Promise<EmbeddingResponse> {
    const startTime = Date.now();

    // NV-EMBEDDING-CASCADE-001: prefer shared cascade (Gemini→Bedrock→OpenRouter→…)
    // unless caller explicitly pins a provider that is not "auto".
    const pinned = request.provider;
    const useCascade = !pinned || pinned === ('auto' as any);

    if (useCascade) {
      try {
        const { embedWithConfiguredCascade } = await import('../../config/jrx-embedding-cascade.js');
        const res = await embedWithConfiguredCascade(request.text);
        if (res?.embedding?.length) {
          const mappedProvider = (res.provider === 'gemini' ? 'google' : res.provider) as EmbeddingProvider;
          // Only return if provider is known to this service's type union; else treat as google/openai/local.
          const providerOut: EmbeddingProvider =
            mappedProvider === 'google' || mappedProvider === 'openai' || mappedProvider === 'local'
              ? mappedProvider
              : 'google';
          this.updateMetrics(providerOut, res.model, Date.now() - startTime, Math.ceil(request.text.split(/\s+/).length * 1.3), 0, true, false);
          return {
            embedding: res.embedding,
            model: res.model,
            provider: providerOut,
            tokenCount: Math.ceil(request.text.split(/\s+/).length * 1.3),
            cost: 0,
            processingTime: Date.now() - startTime,
            metadata: { ...(request.metadata || {}), embedCascadeProvider: res.provider },
          };
        }
      } catch (cascadeErr: any) {
        logger.warn('Embedding cascade failed; falling back to legacy provider switch', cascadeErr?.message || cascadeErr);
      }
    }

    const provider = request.provider || this.config.defaultProvider;
    const model = request.model || this.config.defaultModel;
    
    let cacheHit = false;
    let embedding: number[];
    let tokenCount: number;
    let cost: number;

    try {
      const cachedEmbedding = await this.getCachedEmbedding(request.text, model, provider);
      if (cachedEmbedding) {
        embedding = cachedEmbedding;
        tokenCount = request.text.split(' ').length;
        cost = 0;
        cacheHit = true;
      } else {
        await this.checkRateLimit(provider);

        switch (provider) {
          case 'openai':
            ({ embedding, tokenCount, cost } = await this.generateOpenAIEmbedding(request.text, model));
            break;
          case 'google':
            ({ embedding, tokenCount, cost } = await this.generateGoogleEmbedding(request.text, model));
            break;
          case 'anthropic':
            ({ embedding, tokenCount, cost } = await this.generateAnthropicEmbedding(request.text, model));
            break;
          case 'local':
            ({ embedding, tokenCount, cost } = await this.generateLocalEmbedding(request.text, model));
            break;
          default:
            throw new Error(`Unsupported embedding provider: ${provider}`);
        }

        await this.cacheEmbedding(request.text, model, provider, embedding);
      }

      const processingTime = Date.now() - startTime;

      this.updateMetrics(provider, model, processingTime, tokenCount, cost, true, cacheHit);

      // NV-CREDIT-COST-DIM-001 — embeddings bill per input token at an embedding
      // rate, not a chat rate, so they are invisible to the token-denominated credit
      // budget. Reported in money instead.
      //
      // Priced from NV_AUX_RATES rather than from the local `cost` variable on
      // purpose: `defaultEmbeddingConfig.providers.openai.costPerToken` is 0.00002
      // applied PER TOKEN, while text-embedding-3-small lists at $0.00002 per 1,000
      // tokens — a 1,000× over-price. Feeding that into a spend budget would refuse
      // lawful work, so the credit dimension uses the per-1k rate and the existing
      // metrics counter is left exactly as it was.
      //
      // A cache hit spent nothing with the provider and must not be billed.
      if (!cacheHit && tokenCount > 0 && provider !== 'local') {
        recordAuxSpend({
          costUsd: (tokenCount / 1000) * NV_AUX_RATES.embeddingMicroUsdPer1kTokens / 1_000_000,
          driver: 'embedding_tokens',
          provider,
          model,
          units: tokenCount,
        });
      }

      return {
        embedding,
        model,
        provider,
        tokenCount,
        cost,
        processingTime,
        metadata: request.metadata
      };

    } catch (error: any) {
      const processingTime = Date.now() - startTime;
      this.updateMetrics(provider, model, processingTime, 0, 0, false, false);

      // Legacy path: always try shared cascade before hard-fail.
      try {
        const { embedWithConfiguredCascade } = await import('../../config/jrx-embedding-cascade.js');
        const res = await embedWithConfiguredCascade(request.text);
        if (res?.embedding?.length) {
          logger.warn(`Embedding ${provider} failed — cascade recovered via ${res.provider}`);
          return {
            embedding: res.embedding,
            model: res.model,
            provider: (res.provider === 'gemini' ? 'google' : 'local') as EmbeddingProvider,
            tokenCount: Math.ceil(request.text.split(/\s+/).length * 1.3),
            cost: 0,
            processingTime: Date.now() - startTime,
            metadata: { ...(request.metadata || {}), embedFallbackFrom: provider, embedCascadeProvider: res.provider },
          };
        }
      } catch { /* continue */ }

      logger.error(`Embedding generation failed for provider ${provider}:`, error);
      throw error;
    }
  }

  async generateBatchEmbeddings(request: BatchEmbeddingRequest): Promise<BatchEmbeddingResponse> {
    const startTime = Date.now();
    const batchSize = request.batchSize || 10;
    const embeddings: EmbeddingResponse[] = [];
    const errors: EmbeddingError[] = [];
    
    let totalCost = 0;
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < request.texts.length; i += batchSize) {
      const batch = request.texts.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (text, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const embeddingRequest: EmbeddingRequest = {
            text,
            model: request.model,
            provider: request.provider,
            metadata: { ...request.metadata, originalIndex: globalIndex },
            maxTokens: request.maxTokens
          };

          const response = await this.generateEmbedding(embeddingRequest);
          embeddings[globalIndex] = response;
          totalCost += response.cost || 0;
          successCount++;
          
        } catch (error: any) {
          errors.push({
            text,
            error: error instanceof Error ? error.message : 'Unknown error',
            index: globalIndex
          });
          errorCount++;
        }
      });

      await Promise.all(batchPromises);
      
      if (i + batchSize < request.texts.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    const totalProcessingTime = Date.now() - startTime;

    return {
      embeddings: embeddings.filter(Boolean),
      totalCost,
      totalProcessingTime,
      successCount,
      errorCount,
      errors
    };
  }

  async clearCache(): Promise<void> {
    await this.cache.clear();
  }

  async getCacheSize(): Promise<number> {
    return await this.cache.size();
  }

  getMetrics(): EmbeddingMetrics {
    return { ...this.metrics };
  }

  async healthCheck(): Promise<{ status: string; providers: Record<string, boolean> }> {
    const providerStatus: Record<string, boolean> = {};

    const testText = "Hello, world!";

    for (const [providerName, config] of Object.entries(this.config.providers)) {
      try {
        const response = await this.generateEmbedding({
          text: testText,
          provider: providerName as EmbeddingProvider,
          model: config.model
        });
        providerStatus[providerName] = response.embedding.length > 0;
      } catch (error: any) {
        providerStatus[providerName] = false;
      }
    }

    const allHealthy = Object.values(providerStatus).every(status => status);
    
    return {
      status: allHealthy ? 'healthy' : 'degraded',
      providers: providerStatus
    };
  }

  async shutdown(): Promise<void> {
    logger.info('🔌 Shutting down Jurexio embedding service...');
    await this.clearCache();
    this.removeAllListeners();
  }
}

export { NyayavignyaEmbeddingService as EmbeddingService };

export const defaultEmbeddingConfig: EmbeddingServiceConfig = {
  providers: {
    openai: {
      apiKey: process.env.OPENAI_API_KEY,
      model: 'text-embedding-3-small',
      dimension: 1536,
      maxTokens: 8192,
      costPerToken: 0.00002,
      rateLimit: {
        requestsPerMinute: 3000,
        tokensPerMinute: 1000000
      }
    },
    google: {
      apiKey: process.env.GOOGLE_AI_API_KEY,
      model: 'embedding-001',
      dimension: 768,
      maxTokens: 2048,
      costPerToken: 0.00001,
      rateLimit: {
        requestsPerMinute: 1500,
        tokensPerMinute: 300000
      }
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: 'claude-3-haiku',
      dimension: 1024,
      maxTokens: 4096,
      costPerToken: 0.00003,
      rateLimit: {
        requestsPerMinute: 1000,
        tokensPerMinute: 200000
      }
    },
    huggingface: {
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: 'sentence-transformers/all-MiniLM-L6-v2',
      dimension: 384,
      maxTokens: 512,
      costPerToken: 0,
      rateLimit: {
        requestsPerMinute: 1000,
        tokensPerMinute: 100000
      }
    },
    cohere: {
      apiKey: process.env.COHERE_API_KEY,
      model: 'embed-english-v3.0',
      dimension: 1024,
      maxTokens: 512,
      costPerToken: 0.0001,
      rateLimit: {
        requestsPerMinute: 1000,
        tokensPerMinute: 100000
      }
    },
    local: {
      model: 'all-MiniLM-L6-v2',
      dimension: 384,
      maxTokens: 512,
      costPerToken: 0,
      rateLimit: {
        requestsPerMinute: 10000,
        tokensPerMinute: 1000000
      }
    }
  },
  defaultProvider: 'google',
  defaultModel: 'gemini-embedding-2',
  caching: {
    enabled: true,
    ttl: 3600,
    maxSize: 10000
  },
  rateLimiting: {
    enabled: true,
    maxConcurrent: 10,
    requestDelay: 50
  },
  monitoring: {
    enabled: true,
    metricsInterval: 60000
  }
};

export function chunkText(text: string, maxTokens: number = 500): string[] {
  const words = text.split(' ');
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentTokenCount = 0;

  for (const word of words) {
    const wordTokenCount = Math.ceil(word.length / 4);
    
    if (currentTokenCount + wordTokenCount > maxTokens && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '));
      currentChunk = [word];
      currentTokenCount = wordTokenCount;
    } else {
      currentChunk.push(word);
      currentTokenCount += wordTokenCount;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '));
  }

  return chunks;
}

export function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  if (vectorA.length !== vectorB.length) {
    throw new Error('Vectors must have the same length');
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vectorA.length; i++) {
    dotProduct += vectorA[i] * vectorB[i];
    magnitudeA += vectorA[i] * vectorA[i];
    magnitudeB += vectorB[i] * vectorB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0;
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

export const nyayavignyaEmbeddingService = new NyayavignyaEmbeddingService(defaultEmbeddingConfig);
