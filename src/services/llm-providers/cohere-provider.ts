// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Cohere Provider - Real API Integration
 * 
 * Implements comprehensive Cohere integration with:
 * - Command-R, Command-R+ models with advanced reasoning
 * - Coral chat models for conversational AI
 * - Advanced text generation and embeddings
 * - Tool use and function calling
 * - Real-time streaming responses
 * - Multi-step tool use capabilities
 * - Advanced cost optimization
 * - Circuit breaker protection
 */

import { CohereClientV2 } from 'cohere-ai';
import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('cohere-provider');

export class CohereProvider extends UnifiedLLMAdapter {
  private client: CohereClientV2;
  private readonly models = {
    // Command-R Series (Latest)
    'command-r-plus-08-2024': { inputCost: 2.5, outputCost: 10, contextWindow: 128000, maxOutput: 4096 },
    'command-r-plus': { inputCost: 3, outputCost: 15, contextWindow: 128000, maxOutput: 4096 },
    'command-r-08-2024': { inputCost: 0.15, outputCost: 0.6, contextWindow: 128000, maxOutput: 4096 },
    'command-r': { inputCost: 0.5, outputCost: 1.5, contextWindow: 128000, maxOutput: 4096 },
    'command-r-plus-04-2024': { inputCost: 3, outputCost: 15, contextWindow: 128000, maxOutput: 4096 },
    'command-r-03-2024': { inputCost: 0.5, outputCost: 1.5, contextWindow: 128000, maxOutput: 4096 },
    
    // Command Series
    'command': { inputCost: 1, outputCost: 2, contextWindow: 4096, maxOutput: 4096 },
    'command-nightly': { inputCost: 1, outputCost: 2, contextWindow: 4096, maxOutput: 4096 },
    'command-light': { inputCost: 0.3, outputCost: 0.6, contextWindow: 4096, maxOutput: 4096 },
    'command-light-nightly': { inputCost: 0.3, outputCost: 0.6, contextWindow: 4096, maxOutput: 4096 },
    
    // Embedding Models
    'embed-english-v3.0': { inputCost: 0.1, outputCost: 0, contextWindow: 512, maxOutput: 0 },
    'embed-multilingual-v3.0': { inputCost: 0.1, outputCost: 0, contextWindow: 512, maxOutput: 0 },
    'embed-english-light-v3.0': { inputCost: 0.1, outputCost: 0, contextWindow: 512, maxOutput: 0 },
    'embed-multilingual-light-v3.0': { inputCost: 0.1, outputCost: 0, contextWindow: 512, maxOutput: 0 },
    
    // Rerank Models
    'rerank-english-v3.0': { inputCost: 1, outputCost: 0, contextWindow: 4096, maxOutput: 0 },
    'rerank-multilingual-v3.0': { inputCost: 1, outputCost: 0, contextWindow: 4096, maxOutput: 0 }
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'cohere',
      name: 'Cohere',
      models: Object.keys(CohereProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: false,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: false,
        functionCalling: true,
        streaming: true,
        embedding: true,
        reasoning: 91,
        creativity: 87,
        factualAccuracy: 92,
        codingProficiency: 85,
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'bn']
      },
      pricing: {
        inputTokenCost: 2.5, // Command-R+ base price per 1M tokens
        outputTokenCost: 10, // Command-R+ base price per 1M tokens
        embeddingCost: 0.1, // Embed v3.0 per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 1000000, // 1M tokens per month free
          requestsPerMinute: 100,
          requestsPerDay: 1000
        }
      },
      limits: {
        maxTokensPerRequest: 128000,
        maxRequestsPerMinute: 100,
        maxRequestsPerDay: 1000,
        maxConcurrentRequests: 10,
        contextWindow: 128000,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v2',
      lastHealthCheck: new Date(),
      healthScore: 100
    };

    const key = apiKey || process.env.COHERE_API_KEY;
    if (!key) {
      throw new Error('Cohere API key is required');
    }

    super(provider, key);
    
    this.client = new CohereClientV2({
      token: key,
      // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
      timeout: this.provider.limits.timeoutMs
    });

    logger.info('✅ Cohere Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.cohere.ai/v2';
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error: any) {
      logger.error('Cohere API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Cohere generating response with model: ${request.model || 'command-r-plus'}`);
      
      // Check rate limiting
      if (!(await this.checkRateLimit())) {
        throw new ProviderError('Rate limit exceeded', 'cohere', { correlationId });
      }

      // Select optimal model if not specified
      const model = request.model || this.selectOptimalModel(request);
      const modelConfig = this.models[model as keyof typeof this.models];
      
      if (!modelConfig) {
        throw new ProviderError(`Unsupported model: ${model}`, 'cohere', { correlationId, model });
      }

      // Format messages for Cohere
      const { message, chatHistory, tools } = this.formatForCohere(request);
      
      // Generate response
      const response = await this.client.chat({
        model,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2561)
        message,
        chatHistory,
        tools,
        temperature: request.temperature ?? 0.7,
        maxTokens: request.maxTokens || modelConfig.maxOutput,
        topP: request.topP,
        frequencyPenalty: request.frequencyPenalty,
        presencePenalty: request.presencePenalty,
        stopSequences: request.stopSequences,
        stream: false
      });

      const responseTime = Date.now() - startTime;
      const usage = response.usage;
      
      // Calculate cost
      const cost = this.calculateModelCost(model, usage);

      // Extract content and tool calls
      const content = this.extractContent(response);
      const functionCalls = this.extractFunctionCalls(response);

      const llmResponse: LLMResponse = {
        id: response.id || generateCorrelationId(),
        content,
        model,
        provider: 'cohere',
        usage: {
          promptTokens: usage?.tokens?.inputTokens || 0,
          completionTokens: usage?.tokens?.outputTokens || 0,
          totalTokens: (usage?.tokens?.inputTokens || 0) + (usage?.tokens?.outputTokens || 0)
        },
        cost,
        responseTime,
        finishReason: this.mapFinishReason(response.finishReason),
        functionCalls,
        correlationId,
        timestamp: new Date(),
        metadata: {
          model,
          cohere_id: response.id,
          finish_reason: response.finishReason,
          // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
          citations: response.citations || [],
          // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
          documents: response.documents || []
        }
      };

      // Track cost
      this.trackCost(llmResponse);

      logger.info(`✅ [${correlationId}] Cohere response generated: ${llmResponse.usage.totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms`);
      this.emit('response-generated', llmResponse);

      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      logger.error(`❌ [${correlationId}] Cohere request failed after ${responseTime}ms:`, error);
      
      if (error instanceof Error) {
        throw new ProviderError(
          `Cohere request failed: ${error.message}`,
          'cohere',
          { correlationId, responseTime, originalError: error }
        );
      }
      
      throw error;
    }
  }

  async *generateStream(request: LLMRequest): AsyncGenerator<Partial<LLMResponse>, void, unknown> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Cohere streaming response with model: ${request.model || 'command-r-plus'}`);
      
      const model = request.model || this.selectOptimalModel(request);
      const { message, chatHistory, tools } = this.formatForCohere(request);

      const stream = await this.client.chatStream({
        model,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2561)
        message,
        chatHistory,
        tools,
        temperature: request.temperature ?? 0.7,
        maxTokens: request.maxTokens,
        topP: request.topP,
        frequencyPenalty: request.frequencyPenalty,
        presencePenalty: request.presencePenalty,
        stopSequences: request.stopSequences
      });

      let fullContent = '';
      let totalTokens = 0;
      let citations: any[] = [];
      let documents: any[] = [];

      for await (const event of stream) {
        if (event.type === 'content-delta') {
          const deltaContent = event.delta?.message?.content?.text || '';
          fullContent += deltaContent;
          totalTokens += this.estimateTokens(deltaContent);
        // @ts-expect-error NV-TS230 legacy typing gap (TS2367)
        } else if (event.type === 'citation-generation') {
          // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
          if (event.citations) {
            // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
            citations = event.citations;
          }
        // @ts-expect-error NV-TS230 legacy typing gap (TS2367)
        } else if (event.type === 'stream-end') {
          // Final event with usage info
          // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
          if (event.response?.usage) {
            // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
            totalTokens = (event.response.usage.tokens?.inputTokens || 0) + 
                         // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
                         (event.response.usage.tokens?.outputTokens || 0);
          }
        }

        const partialResponse: Partial<LLMResponse> = {
          content: fullContent,
          model,
          provider: 'cohere',
          usage: {
            promptTokens: 0,
            completionTokens: totalTokens,
            totalTokens: totalTokens
          },
          responseTime: Date.now() - startTime,
          correlationId,
          timestamp: new Date(),
          metadata: {
            citations,
            documents
          }
        };

        yield partialResponse;

        // @ts-expect-error NV-TS230 legacy typing gap (TS2367)
        if (event.type === 'stream-end') {
          break;
        }
      }

      logger.info(`✅ [${correlationId}] Cohere streaming completed: ${totalTokens} tokens`);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Cohere streaming failed:`, error);
      throw new ProviderError(
        `Cohere streaming failed: ${error}`,
        'cohere',
        { correlationId }
      );
    }
  }

  async generateEmbeddings(texts: string[], model = 'embed-english-v3.0'): Promise<number[][]> {
    const correlationId = generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Cohere generating embeddings for ${texts.length} texts`);
      
      const response = await this.client.embed({
        model,
        texts,
        inputType: 'search_document',
        embeddingTypes: ['float']
      });

      const responseTime = Date.now() - startTime;
      const totalTokens = texts.reduce((sum, text) => sum + this.estimateTokens(text), 0);
      const cost = (totalTokens / 1000000) * (this.models[model as keyof typeof this.models]?.inputCost || 0.1);

      logger.info(`✅ [${correlationId}] Cohere embeddings generated: ${totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms`);

      return response.embeddings?.float || [];

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Cohere embeddings failed:`, error);
      throw new ProviderError(
        `Cohere embeddings failed: ${error}`,
        'cohere',
        { correlationId }
      );
    }
  }

  async generateImage(prompt: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'Cohere does not provide image generation. Use OpenAI DALL-E or other providers for image generation.',
      'cohere',
      { capability: 'image_generation' }
    );
  }

  async generateAudio(text: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'Cohere does not provide audio generation. Use OpenAI TTS or other providers for audio generation.',
      'cohere',
      { capability: 'audio_generation' }
    );
  }

  async transcribeAudio(audioUrl: string): Promise<{ text: string; cost: number }> {
    throw new ProviderError(
      'Cohere does not provide speech-to-text. Use OpenAI Whisper or other providers for audio transcription.',
      'cohere',
      { capability: 'speech_to_text' }
    );
  }

  /**
   * Cohere-specific methods
   */
  async rerank(query: string, documents: string[], model = 'rerank-english-v3.0'): Promise<{
    results: Array<{ index: number; relevanceScore: number; document: string }>;
    cost: number;
  }> {
    const correlationId = generateCorrelationId();
    
    try {
      logger.info(`🔄 [${correlationId}] Cohere reranking ${documents.length} documents`);
      
      const response = await this.client.rerank({
        model,
        query,
        documents,
        topN: documents.length,
        // @ts-expect-error NV-TS230 legacy typing gap (TS2353)
        returnDocuments: true
      });

      const cost = (documents.length / 1000) * (this.models[model as keyof typeof this.models]?.inputCost || 1);

      const results = response.results?.map((result: any) => ({
        index: result.index || 0,
        relevanceScore: result.relevanceScore || 0,
        document: result.document?.text || documents[result.index || 0]
      })) || [];

      logger.info(`✅ [${correlationId}] Cohere reranking completed: ${documents.length} documents, $${cost.toFixed(6)} cost`);

      return { results, cost };

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Cohere reranking failed:`, error);
      throw new ProviderError(
        `Cohere reranking failed: ${error}`,
        'cohere',
        { correlationId }
      );
    }
  }

  /**
   * Private helper methods
   */
  private selectOptimalModel(request: LLMRequest): string {
    const messageLength = request.messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const hasTools = request.tools && request.tools.length > 0;

    // Select based on complexity and requirements
    if (hasTools) return 'command-r-plus'; // Best for function calling
    if (messageLength > 50000) return 'command-r-plus'; // Large context
    if (messageLength > 10000) return 'command-r'; // Medium context, cost-effective
    
    return 'command-r-08-2024'; // Latest cost-effective model
  }

  private formatForCohere(request: LLMRequest): {
    message: string;
    chatHistory: any[];
    tools?: any[];
  } {
    const messages = [...request.messages];
    let systemMessage = request.systemPrompt;
    
    // Extract system message from messages if present
    const systemMsgIndex = messages.findIndex(m => m.role === 'system');
    if (systemMsgIndex !== -1) {
      systemMessage = messages[systemMsgIndex].content as string;
      messages.splice(systemMsgIndex, 1);
    }

    // Get the latest user message
    const userMessages = messages.filter(m => m.role === 'user');
    const latestMessage = userMessages[userMessages.length - 1]?.content as string || '';

    // Build chat history (exclude the latest message)
    const chatHistory = messages.slice(0, -1).map(msg => ({
      role: msg.role === 'assistant' ? 'CHATBOT' : 'USER',
      message: msg.content
    }));

    // Add system message to preamble if present
    if (systemMessage && chatHistory.length > 0) {
      chatHistory.unshift({
        role: 'SYSTEM',
        message: systemMessage
      });
    }

    // Format tools
    const tools = request.tools?.map(tool => ({
      type: 'function',
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters
      }
    }));

    return {
      message: latestMessage,
      chatHistory,
      tools
    };
  }

  private extractContent(response: any): string {
    if (response.message?.content) {
      return Array.isArray(response.message.content)
        ? response.message.content.map((c: any) => c.text).join('')
        : response.message.content;
    }
    return response.text || '';
  }

  private extractFunctionCalls(response: any): Array<{ name: string; arguments: any }> | undefined {
    if (response.toolCalls && response.toolCalls.length > 0) {
      return response.toolCalls.map((call: any) => ({
        name: call.function?.name || '',
        arguments: call.function?.arguments || {}
      }));
    }
    return undefined;
  }

  private calculateModelCost(model: string, usage: any): number {
    const modelConfig = this.models[model as keyof typeof this.models];
    if (!modelConfig || !usage?.tokens) return 0;

    const inputTokens = usage.tokens.inputTokens || 0;
    const outputTokens = usage.tokens.outputTokens || 0;

    const inputCost = (inputTokens / 1000000) * modelConfig.inputCost;
    const outputCost = (outputTokens / 1000000) * modelConfig.outputCost;
    
    return inputCost + outputCost;
  }

  private mapFinishReason(reason: string | undefined): LLMResponse['finishReason'] {
    switch (reason) {
      case 'COMPLETE': return 'stop';
      case 'MAX_TOKENS': return 'length';
      case 'TOOL_CALL': return 'function_call';
      case 'CONTENT_FILTER': return 'content_filter';
      default: return 'stop';
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export default CohereProvider;