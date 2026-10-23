// JRX-NS-021 (2026-05-05): pre-existing TS errors (gateway runs via tsx).
/**
 * XAI Provider - Real API Integration
 * 
 * Implements comprehensive XAI Grok integration with:
 * - Grok-4 flagship (256K context) — real API ID: grok-4
 * - Grok-4-1-fast-reasoning (2M context, agentic) — real API ID: grok-4-1-fast-reasoning
 * - Grok-3 Beta, Fast, Mini series — real API IDs: grok-3-beta, grok-3-fast-beta, grok-3-mini-beta
 * - Grok Code Fast — real API ID: grok-code-fast-1
 * - Real-time X platform data integration
 * - Advanced reasoning and wit capabilities
 * - Function calling and tool use
 * - Real-time streaming responses
 * - Advanced cost optimization
 * - Circuit breaker protection
 * NOTE: "grok-4.1" with a dot is NOT a valid API ID — use grok-4 or grok-4-1-fast-reasoning
 */

import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('xai-provider');

export class XAIProvider extends UnifiedLLMAdapter {
  private readonly models = {
    // Grok 4 Series - Latest (Feb 2026, real API IDs)
    'grok-4': { inputCost: 3, outputCost: 15, contextWindow: 256000, maxOutput: 32768, isLatest: true },
    'grok-4-1-fast-reasoning': { inputCost: 0.2, outputCost: 0.5, contextWindow: 2000000, maxOutput: 32768, isLatest: true },
    'grok-4-1-fast-non-reasoning': { inputCost: 0.1, outputCost: 0.25, contextWindow: 2000000, maxOutput: 32768 },
    
    // Grok 3 Series
    'grok-3-beta': { inputCost: 3, outputCost: 15, contextWindow: 131072, maxOutput: 8192 },
    'grok-3-fast-beta': { inputCost: 0.6, outputCost: 3, contextWindow: 131072, maxOutput: 8192 },
    'grok-3-mini-beta': { inputCost: 0.3, outputCost: 0.5, contextWindow: 131072, maxOutput: 8192 },
    
    // Grok Code
    'grok-code-fast-1': { inputCost: 0.5, outputCost: 2, contextWindow: 256000, maxOutput: 32768 },
    
    // Legacy Grok 2 Series
    'grok-2-1212': { inputCost: 2, outputCost: 10, contextWindow: 131072, maxOutput: 8192 },
    'grok-2-vision-1212': { inputCost: 2, outputCost: 10, contextWindow: 8192, maxOutput: 8192 }
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'xai',
      name: 'XAI Grok',
      models: Object.keys(XAIProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: false,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: true, // Grok-2-vision supports images
        functionCalling: true,
        streaming: true,
        embedding: false,
        reasoning: 94,
        creativity: 96, // Grok is known for wit and humor
        factualAccuracy: 89,
        codingProficiency: 88,
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh']
      },
      pricing: {
        inputTokenCost: 2, // Grok-2 base price per 1M tokens
        outputTokenCost: 10, // Grok-2 base price per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 0,
          requestsPerMinute: 60,
          requestsPerDay: 1000
        }
      },
      limits: {
        maxTokensPerRequest: 131072,
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 1000,
        maxConcurrentRequests: 10,
        contextWindow: 131072,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 100
    };

    const key = apiKey || process.env.XAI_API_KEY;
    if (!key) {
      throw new Error('XAI API key is required');
    }

    super(provider, key, 'https://api.x.ai/v1');

    logger.info('✅ XAI Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.x.ai/v1';
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error: any) {
      logger.error('XAI API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] XAI generating response with model: ${request.model || 'grok-4'}`);
      
      // Check rate limiting
      if (!(await this.checkRateLimit())) {
        throw new ProviderError('Rate limit exceeded', 'xai', { correlationId });
      }

      // Select optimal model if not specified
      const model = request.model || this.selectOptimalModel(request);
      const modelConfig = this.models[model as keyof typeof this.models];
      
      if (!modelConfig) {
        throw new ProviderError(`Unsupported model: ${model}`, 'xai', { correlationId, model });
      }

      // Format messages
      const messages = this.formatMessages(request);
      
      // Create timeout controller
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);

      // Prepare request body
      const requestBody = {
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens || modelConfig.maxOutput,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stopSequences,
        stream: false,
        tools: request.tools?.map(tool => ({
          type: 'function',
          function: tool.function
        })),
        tool_choice: request.tools ? 'auto' : undefined
      };

      // Generate response
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: timeoutController.signal
      });

      if (response.ok === false) {
        throw new ProviderError(
          `XAI API error: ${response.status} ${response.statusText}`,
          'xai',
          { correlationId, status: response.status }
        );
      }

      const data = await response.json();
      const responseTime = Date.now() - startTime;
      // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
      const usage = data.usage;
      // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
      const choice = data.choices[0];
      
      // Calculate cost
      const cost = this.calculateModelCost(model, usage);

      const llmResponse: LLMResponse = {
        // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
        id: data.id,
        content: choice.message.content || '',
        model,
        provider: 'xai',
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        },
        cost,
        responseTime,
        finishReason: this.mapFinishReason(choice.finish_reason),
        functionCalls: choice.message.tool_calls?.map((tc: any) => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        })),
        correlationId,
        timestamp: new Date(),
        metadata: {
          model,
          // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
          xai_id: data.id,
          // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
          system_fingerprint: data.system_fingerprint
        }
      };

      // Track cost
      this.trackCost(llmResponse);

      logger.info(`✅ [${correlationId}] XAI response generated: ${llmResponse.usage.totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms`);
      this.emit('response-generated', llmResponse);

      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      logger.error(`❌ [${correlationId}] XAI request failed after ${responseTime}ms:`, error);
      
      if (error instanceof Error) {
        throw new ProviderError(
          `XAI request failed: ${error.message}`,
          'xai',
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
      logger.info(`🔄 [${correlationId}] XAI streaming response with model: ${request.model || 'grok-4'}`);
      
      const model = request.model || this.selectOptimalModel(request);
      const messages = this.formatMessages(request);

      const requestBody = {
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stopSequences,
        stream: true,
        tools: request.tools?.map(tool => ({
          type: 'function',
          function: tool.function
        }))
      };

      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok === false) {
        throw new ProviderError(`XAI streaming failed: ${response.status}`, 'xai', { correlationId });
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError('No response body reader available', 'xai', { correlationId });
      }

      let fullContent = '';
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = new TextDecoder().decode(value);
        const lines = text.split('\n').filter(line => line.trim());

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              const delta = parsed.choices[0]?.delta?.content || '';
              
              if (delta) {
                fullContent += delta;
                totalTokens += this.estimateTokens(delta);
              }

              const partialResponse: Partial<LLMResponse> = {
                id: parsed.id,
                content: fullContent,
                model,
                provider: 'xai',
                usage: {
                  promptTokens: 0,
                  completionTokens: totalTokens,
                  totalTokens: totalTokens
                },
                responseTime: Date.now() - startTime,
                correlationId,
                timestamp: new Date()
              };

              yield partialResponse;

              if (parsed.choices[0]?.finish_reason) {
                break;
              }
            } catch (parseError: any) {
              // Skip invalid JSON
              continue;
            }
          }
        }
      }

      logger.info(`✅ [${correlationId}] XAI streaming completed: ${totalTokens} tokens`);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] XAI streaming failed:`, error);
      throw new ProviderError(
        `XAI streaming failed: ${error}`,
        'xai',
        { correlationId }
      );
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    throw new ProviderError(
      'XAI does not provide embedding models. Use OpenAI or other providers for embeddings.',
      'xai',
      { capability: 'embeddings' }
    );
  }

  async generateImage(prompt: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'XAI does not provide image generation. Use OpenAI DALL-E or other providers for image generation.',
      'xai',
      { capability: 'image_generation' }
    );
  }

  async generateAudio(text: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'XAI does not provide audio generation. Use OpenAI TTS or other providers for audio generation.',
      'xai',
      { capability: 'audio_generation' }
    );
  }

  async transcribeAudio(audioUrl: string): Promise<{ text: string; cost: number }> {
    throw new ProviderError(
      'XAI does not provide speech-to-text. Use OpenAI Whisper or other providers for audio transcription.',
      'xai',
      { capability: 'speech_to_text' }
    );
  }

  /**
   * Private helper methods
   */
  private selectOptimalModel(request: LLMRequest): string {
    const messageLength = request.messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const hasTools = request.tools && request.tools.length > 0;
    const hasImages = request.messages.some(msg => 
      Array.isArray(msg.content) && msg.content.some(c => c.type === 'image')
    );

    // Select based on complexity and requirements (real API IDs use hyphens, no dots)
    if (hasImages) return 'grok-2-vision-1212'; // Vision support
    if (hasTools) return 'grok-4'; // Best for function calling
    if (messageLength > 200000) return 'grok-4-1-fast-reasoning'; // 2M context, agentic
    if (messageLength > 80000) return 'grok-4'; // Large context (256K)
    if (messageLength > 20000) return 'grok-3-beta'; // Medium context
    
    return 'grok-4'; // Default to latest flagship
  }

  private formatMessages(request: LLMRequest): any[] {
    const messages = [...request.messages];
    
    // Add system prompt if provided
    if (request.systemPrompt) {
      messages.unshift({
        role: 'system',
        content: request.systemPrompt
      });
    }

    return messages.map(msg => ({
      role: msg.role,
      content: msg.content,
      name: msg.name
    }));
  }

  private calculateModelCost(model: string, usage: { prompt_tokens: number; completion_tokens: number }): number {
    const modelConfig = this.models[model as keyof typeof this.models];
    if (!modelConfig) return 0;

    const inputCost = (usage.prompt_tokens / 1000000) * modelConfig.inputCost;
    const outputCost = (usage.completion_tokens / 1000000) * modelConfig.outputCost;
    
    return inputCost + outputCost;
  }

  private mapFinishReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop': return 'stop';
      case 'length': return 'length';
      case 'function_call':
      case 'tool_calls': return 'function_call';
      case 'content_filter': return 'content_filter';
      default: return 'stop';
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export default XAIProvider;