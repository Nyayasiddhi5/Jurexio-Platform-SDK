/**
 * Groq Provider - Real API Integration
 * 
 * Implements comprehensive Groq fast inference integration with:
 * - LLaMA 3.1, 3.2, 3.3 model support  
 * - Mixtral, Gemma, Tool Use models
 * - Ultra-fast inference speeds (up to 750 tokens/sec)
 * - Function calling and tool use
 * - Real-time streaming responses
 * - Cost-effective pricing
 * - Circuit breaker protection
 */

import Groq from 'groq-sdk';
import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('groq-provider');

export class GroqProvider extends UnifiedLLMAdapter {
  private client: Groq;
  private readonly models = {
    // LLaMA 4 Models - Latest (Feb 2026)
    'llama-4-maverick-17b-128e-instruct': { inputCost: 0.50, outputCost: 0.75, contextWindow: 131072, maxOutput: 32768, isLatest: true },
    'llama-4-scout-17b-16e-instruct': { inputCost: 0.20, outputCost: 0.30, contextWindow: 131072, maxOutput: 32768, isLatest: true },
    
    // LLaMA 3.3 Models (Meta)
    'llama-3.3-70b-versatile': { inputCost: 0.59, outputCost: 0.79, contextWindow: 131072, maxOutput: 32768 },
    
    // Legacy: LLaMA 3.2 Models
    'llama-3.2-90b-text-preview': { inputCost: 0.9, outputCost: 0.9, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.2-11b-text-preview': { inputCost: 0.18, outputCost: 0.18, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.2-3b-preview': { inputCost: 0.06, outputCost: 0.06, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.2-1b-preview': { inputCost: 0.04, outputCost: 0.04, contextWindow: 131072, maxOutput: 8192 },
    
    // Legacy: LLaMA 3.1 Models
    'llama-3.1-405b-reasoning': { inputCost: 0, outputCost: 0, contextWindow: 32768, maxOutput: 8192 },
    'llama-3.1-70b-versatile': { inputCost: 0.59, outputCost: 0.79, contextWindow: 131072, maxOutput: 32768 },
    'llama-3.1-8b-instant': { inputCost: 0.05, outputCost: 0.08, contextWindow: 131072, maxOutput: 8192 },
    'llama3-groq-70b-8192-tool-use-preview': { inputCost: 0.89, outputCost: 0.89, contextWindow: 8192, maxOutput: 8192 },
    'llama3-groq-8b-8192-tool-use-preview': { inputCost: 0.19, outputCost: 0.19, contextWindow: 8192, maxOutput: 8192 },
    'llama3-70b-8192': { inputCost: 0.59, outputCost: 0.79, contextWindow: 8192, maxOutput: 8192 },
    'llama3-8b-8192': { inputCost: 0.05, outputCost: 0.08, contextWindow: 8192, maxOutput: 8192 },
    
    // Mixtral Models (Mistral AI)
    'mixtral-8x7b-32768': { inputCost: 0.24, outputCost: 0.24, contextWindow: 32768, maxOutput: 32768 },
    
    // Gemma Models (Google)
    'gemma2-9b-it': { inputCost: 0.2, outputCost: 0.2, contextWindow: 8192, maxOutput: 8192 },
    'gemma-7b-it': { inputCost: 0.07, outputCost: 0.07, contextWindow: 8192, maxOutput: 8192 },
    
    // Vision Models
    'llama-3.2-90b-vision-preview': { inputCost: 0.9, outputCost: 0.9, contextWindow: 8192, maxOutput: 8192 },
    'llama-3.2-11b-vision-preview': { inputCost: 0.18, outputCost: 0.18, contextWindow: 8192, maxOutput: 8192 }
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'groq',
      name: 'Groq Fast Inference',
      models: Object.keys(GroqProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: false,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: true, // LLaMA 3.2 vision models
        functionCalling: true,
        streaming: true,
        embedding: false,
        reasoning: 92,
        creativity: 85,
        factualAccuracy: 90,
        codingProficiency: 89,
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh']
      },
      pricing: {
        inputTokenCost: 0.59, // LLaMA 3.1 70B base price per 1M tokens
        outputTokenCost: 0.79, // LLaMA 3.1 70B base price per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 0,
          requestsPerMinute: 30,
          requestsPerDay: 14400
        }
      },
      limits: {
        maxTokensPerRequest: 131072,
        maxRequestsPerMinute: 30,
        maxRequestsPerDay: 14400,
        maxConcurrentRequests: 10,
        contextWindow: 131072,
        timeoutMs: 30000 // Groq is fast, shorter timeout
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 100
    };

    const key = apiKey || process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error('Groq API key is required');
    }

    super(provider, key);
    
    this.client = new Groq({
      apiKey: key,
      timeout: this.provider.limits.timeoutMs
    });

    logger.info('✅ Groq Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.groq.com/openai/v1';
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch (error: any) {
      logger.error('Groq API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Groq generating response with model: ${request.model || 'llama-4-maverick-17b-128e-instruct'}`);
      
      // Check rate limiting
      if (!(await this.checkRateLimit())) {
        throw new ProviderError('Rate limit exceeded', 'groq', { correlationId });
      }

      // Select optimal model if not specified
      const model = request.model || this.selectOptimalModel(request);
      const modelConfig = this.models[model as keyof typeof this.models];
      
      if (!modelConfig) {
        throw new ProviderError(`Unsupported model: ${model}`, 'groq', { correlationId, model });
      }

      // Format messages
      const messages = this.formatMessages(request);
      
      // Create timeout controller
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);

      // Generate response
      const completion = await this.client.chat.completions.create({
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens || modelConfig.maxOutput,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stopSequences,
        tools: request.tools?.map(tool => ({
          type: 'function' as const,
          function: tool.function
        })),
        tool_choice: request.tools ? 'auto' : undefined,
        stream: false
      }, {
        signal: timeoutController.signal
      });

      const responseTime = Date.now() - startTime;
      const usage = completion.usage!;
      const choice = completion.choices[0];
      
      // Calculate cost
      const cost = this.calculateModelCost(model, usage);

      const llmResponse: LLMResponse = {
        id: completion.id,
        content: choice.message.content || '',
        model,
        provider: 'groq',
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens
        },
        cost,
        responseTime,
        finishReason: this.mapFinishReason(choice.finish_reason),
        functionCalls: choice.message.tool_calls?.map(tc => ({
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments)
        })),
        correlationId,
        timestamp: new Date(),
        metadata: {
          model,
          groq_id: completion.id,
          system_fingerprint: completion.system_fingerprint,
          inference_speed: Math.round(usage.completion_tokens / (responseTime / 1000)) // tokens/sec
        }
      };

      // Track cost
      this.trackCost(llmResponse);

      logger.info(`⚡ [${correlationId}] Groq response generated: ${llmResponse.usage.totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms (${llmResponse.metadata?.inference_speed} tokens/sec)`);
      this.emit('response-generated', llmResponse);

      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      logger.error(`❌ [${correlationId}] Groq request failed after ${responseTime}ms:`, error);
      
      if (error instanceof Error) {
        throw new ProviderError(
          `Groq request failed: ${error.message}`,
          'groq',
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
      logger.info(`🔄 [${correlationId}] Groq streaming response with model: ${request.model || 'llama-4-maverick-17b-128e-instruct'}`);
      
      const model = request.model || this.selectOptimalModel(request);
      const messages = this.formatMessages(request);

      const stream = await this.client.chat.completions.create({
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        frequency_penalty: request.frequencyPenalty,
        presence_penalty: request.presencePenalty,
        stop: request.stopSequences,
        tools: request.tools?.map(tool => ({
          type: 'function' as const,
          function: tool.function
        })),
        stream: true
      });

      let fullContent = '';
      let totalTokens = 0;

      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (!choice) continue;

        const deltaContent = choice.delta?.content || '';
        if (deltaContent) {
          fullContent += deltaContent;
          totalTokens += this.estimateTokens(deltaContent);
        }

        const partialResponse: Partial<LLMResponse> = {
          id: chunk.id,
          content: fullContent,
          model,
          provider: 'groq',
          usage: {
            promptTokens: 0,
            completionTokens: totalTokens,
            totalTokens: totalTokens
          },
          responseTime: Date.now() - startTime,
          finishReason: choice.finish_reason ? this.mapFinishReason(choice.finish_reason) : 'stop',
          correlationId,
          timestamp: new Date()
        };

        yield partialResponse;

        if (choice.finish_reason) {
          break;
        }
      }

      logger.info(`⚡ [${correlationId}] Groq streaming completed: ${totalTokens} tokens`);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Groq streaming failed:`, error);
      throw new ProviderError(
        `Groq streaming failed: ${error}`,
        'groq',
        { correlationId }
      );
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    throw new ProviderError(
      'Groq does not provide embedding models. Use OpenAI or other providers for embeddings.',
      'groq',
      { capability: 'embeddings' }
    );
  }

  async generateImage(prompt: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'Groq does not provide image generation. Use OpenAI DALL-E or other providers for image generation.',
      'groq',
      { capability: 'image_generation' }
    );
  }

  async generateAudio(text: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'Groq does not provide audio generation. Use OpenAI TTS or other providers for audio generation.',
      'groq',
      { capability: 'audio_generation' }
    );
  }

  async transcribeAudio(audioUrl: string): Promise<{ text: string; cost: number }> {
    throw new ProviderError(
      'Groq does not provide speech-to-text. Use OpenAI Whisper or other providers for audio transcription.',
      'groq',
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

    // Select based on complexity and requirements
    if (hasImages) return 'llama-3.2-90b-vision-preview'; // Best for vision
    if (hasTools) return 'llama-4-maverick-17b-128e-instruct'; // Best for function calling
    if (messageLength > 80000) return 'llama-4-maverick-17b-128e-instruct'; // Large context, latest model
    if (messageLength > 20000) return 'llama-4-scout-17b-16e-instruct'; // Medium-large context
    if (messageLength > 5000) return 'llama-3.3-70b-versatile'; // Versatile for medium tasks
    
    return 'llama-4-scout-17b-16e-instruct'; // Default fast model for simple requests
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

export default GroqProvider;