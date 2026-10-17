/**
 * Anthropic Provider - Real API Integration
 * 
 * Implements comprehensive Anthropic Claude integration with:
 * - Claude Opus 4-6 (latest flagship, Feb 5, 2026) — API ID: claude-opus-4-6
 * - Claude Sonnet 4-6 (best agentic/coding, Feb 2026) — API ID: claude-sonnet-4-6
 * - Claude Haiku 4-5 (fast & cost-effective, Oct 2025) — API ID: claude-haiku-4-5
 * - Advanced reasoning and analysis capabilities
 * - Function calling and tool use
 * - Real-time streaming responses
 * - Vision and multimodal capabilities
 * - Advanced cost optimization
 * - Circuit breaker protection
 * 
 * Reference: blueprint:javascript_anthropic
 * IMPORTANT: Anthropic API IDs use hyphens, NOT dots (claude-opus-4-6 not claude-opus-4.6)
 */

import Anthropic from '@anthropic-ai/sdk';
import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('anthropic-provider');

export class AnthropicProvider extends UnifiedLLMAdapter {
  private client: Anthropic;
  
  // Reference: blueprint:javascript_anthropic
  // IMPORTANT: Anthropic API IDs use HYPHENS — claude-opus-4-6, not claude-opus-4.6
  private static readonly DEFAULT_MODEL_STR = 'claude-opus-4-6';
  
  private readonly models = {
    // Claude Opus 4-6 - Latest flagship (Feb 5, 2026)
    'claude-opus-4-6': { inputCost: 5, outputCost: 25, contextWindow: 1000000, maxOutput: 64000, isLatest: true },
    
    // Claude Sonnet 4-6 - Best agentic/coding model (Feb 2026)
    'claude-sonnet-4-6': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 64000, isLatest: true },
    
    // Claude Opus 4-5 - Previous flagship (Nov 2025)
    'claude-opus-4-5': { inputCost: 5, outputCost: 25, contextWindow: 200000, maxOutput: 32768 },
    
    // Claude Sonnet 4-5 - Balanced performance (Sep 2025)
    'claude-sonnet-4-5': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 8192 },
    'claude-sonnet-4-5-20250929': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 8192 },
    
    // Claude Haiku 4-5 - Fast and cost-effective (Oct 2025)
    'claude-haiku-4-5': { inputCost: 0.25, outputCost: 1.25, contextWindow: 200000, maxOutput: 8192 },
    
    // Legacy: Claude Sonnet 4 Series (May 2025)
    'claude-sonnet-4-20250514': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 8192 },
    'claude-opus-4-20250514': { inputCost: 5, outputCost: 25, contextWindow: 200000, maxOutput: 32768 },
    
    // Legacy: Claude 3.7 Series
    'claude-3-7-sonnet-20250219': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 8192 },
    
    // Legacy: Claude 3.5 Series
    'claude-3-5-sonnet-20241022': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 8192 },
    'claude-3-5-sonnet-20240620': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 8192 },
    'claude-3-5-haiku-20241022': { inputCost: 0.25, outputCost: 1.25, contextWindow: 200000, maxOutput: 8192 },
    
    // Legacy: Claude 3 Series
    'claude-3-opus-20240229': { inputCost: 15, outputCost: 75, contextWindow: 200000, maxOutput: 4096 },
    'claude-3-sonnet-20240229': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 4096 },
    'claude-3-haiku-20240307': { inputCost: 0.25, outputCost: 1.25, contextWindow: 200000, maxOutput: 4096 },
    
    // REMOVED LEGACY: claude-3.7-sonnet, claude-3.5-sonnet, claude-3.5-haiku, claude-3-opus, claude-2.1, claude-2.0, claude-instant-1.2
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'anthropic',
      name: 'Anthropic Claude',
      models: Object.keys(AnthropicProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: false,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: true, // Vision capabilities
        functionCalling: true,
        streaming: true,
        embedding: false,
        reasoning: 98, // Claude excels at reasoning
        creativity: 95,
        factualAccuracy: 96,
        codingProficiency: 92,
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi']
      },
      pricing: {
        inputTokenCost: 3, // Claude Sonnet 4 base price per 1M tokens
        outputTokenCost: 15, // Claude Sonnet 4 base price per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 0,
          requestsPerMinute: 50,
          requestsPerDay: 1000
        }
      },
      limits: {
        maxTokensPerRequest: 200000,
        maxRequestsPerMinute: 50,
        maxRequestsPerDay: 1000,
        maxConcurrentRequests: 5,
        contextWindow: 200000,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['global'],
      apiVersion: '2023-06-01',
      lastHealthCheck: new Date(),
      healthScore: 100
    };

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('Anthropic API key is required');
    }

    super(provider, key);
    
    this.client = new Anthropic({
      apiKey: key,
      timeout: this.provider.limits.timeoutMs
    });

    logger.info('✅ Anthropic Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.anthropic.com';
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      // Test with a minimal request
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Test' }]
      });
      return true;
    } catch (error: any) {
      logger.error('Anthropic API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Anthropic generating response with model: ${request.model || AnthropicProvider.DEFAULT_MODEL_STR}`);
      
      // Check rate limiting
      if (!(await this.checkRateLimit())) {
        throw new ProviderError('Rate limit exceeded', 'anthropic', { correlationId });
      }

      // Select optimal model if not specified
      const model = request.model || this.selectOptimalModel(request);
      const modelConfig = this.models[model as keyof typeof this.models];
      
      if (!modelConfig) {
        throw new ProviderError(`Unsupported model: ${model}`, 'anthropic', { correlationId, model });
      }

      // Format messages for Anthropic
      const { messages, system } = this.formatMessages(request);
      
      // Create timeout controller
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);

      // Handle tools/function calling
      const tools = request.tools?.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters
      }));

      // Generate response
      const response = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens || modelConfig.maxOutput,
        messages,
        system,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP,
        stop_sequences: request.stopSequences,
        tools,
        stream: false
      }, {
        signal: timeoutController.signal
      });

      const responseTime = Date.now() - startTime;
      const usage = response.usage;
      
      // Calculate cost
      const cost = this.calculateModelCost(model, usage);

      // Extract content and tool calls
      const content = this.extractContent(response);
      const functionCalls = this.extractFunctionCalls(response);

      const llmResponse: LLMResponse = {
        id: response.id,
        content,
        model,
        provider: 'anthropic',
        usage: {
          promptTokens: usage.input_tokens,
          completionTokens: usage.output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens
        },
        cost,
        responseTime,
        finishReason: this.mapStopReason(response.stop_reason),
        functionCalls,
        correlationId,
        timestamp: new Date(),
        metadata: {
          model,
          anthropic_id: response.id,
          stop_reason: response.stop_reason,
          stop_sequence: response.stop_sequence
        }
      };

      // Track cost
      this.trackCost(llmResponse);

      logger.info(`✅ [${correlationId}] Anthropic response generated: ${llmResponse.usage.totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms`);
      this.emit('response-generated', llmResponse);

      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      logger.error(`❌ [${correlationId}] Anthropic request failed after ${responseTime}ms:`, error);
      
      if (error instanceof Error) {
        throw new ProviderError(
          `Anthropic request failed: ${error.message}`,
          'anthropic',
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
      logger.info(`🔄 [${correlationId}] Anthropic streaming response with model: ${request.model || 'claude-opus-4-6'}`);
      
      const model = request.model || this.selectOptimalModel(request);
      const { messages, system } = this.formatMessages(request);

      const tools = request.tools?.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        input_schema: tool.function.parameters
      }));

      const stream = await this.client.messages.create({
        model,
        max_tokens: request.maxTokens || 4096,
        messages,
        system,
        temperature: request.temperature ?? 0.7,
        top_p: request.topP,
        stop_sequences: request.stopSequences,
        tools,
        stream: true
      });

      let fullContent = '';
      let totalTokens = 0;
      let inputTokens = 0;
      let outputTokens = 0;

      for await (const event of stream) {
        if (event.type === 'message_start') {
          inputTokens = event.message.usage.input_tokens;
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            const deltaContent = event.delta.text;
            fullContent += deltaContent;
            outputTokens += this.estimateTokens(deltaContent);
          }
        } else if (event.type === 'message_delta') {
          outputTokens = event.usage.output_tokens;
        }

        totalTokens = inputTokens + outputTokens;

        const partialResponse: Partial<LLMResponse> = {
          content: fullContent,
          model,
          provider: 'anthropic',
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens
          },
          responseTime: Date.now() - startTime,
          correlationId,
          timestamp: new Date()
        };

        yield partialResponse;

        if (event.type === 'message_stop') {
          break;
        }
      }

      logger.info(`✅ [${correlationId}] Anthropic streaming completed: ${totalTokens} tokens`);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Anthropic streaming failed:`, error);
      throw new ProviderError(
        `Anthropic streaming failed: ${error}`,
        'anthropic',
        { correlationId }
      );
    }
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    // Anthropic doesn't provide embedding models, throw error
    throw new ProviderError(
      'Anthropic does not provide embedding models. Use OpenAI or other providers for embeddings.',
      'anthropic',
      { capability: 'embeddings' }
    );
  }

  async generateImage(prompt: string, options?: any): Promise<{ url: string; cost: number }> {
    // Anthropic doesn't provide image generation, throw error
    throw new ProviderError(
      'Anthropic does not provide image generation. Use OpenAI DALL-E or other providers for image generation.',
      'anthropic',
      { capability: 'image_generation' }
    );
  }

  async generateAudio(text: string, options?: any): Promise<{ url: string; cost: number }> {
    // Anthropic doesn't provide audio generation, throw error
    throw new ProviderError(
      'Anthropic does not provide audio generation. Use OpenAI TTS or other providers for audio generation.',
      'anthropic',
      { capability: 'audio_generation' }
    );
  }

  async transcribeAudio(audioUrl: string): Promise<{ text: string; cost: number }> {
    // Anthropic doesn't provide speech-to-text, throw error
    throw new ProviderError(
      'Anthropic does not provide speech-to-text. Use OpenAI Whisper or other providers for audio transcription.',
      'anthropic',
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
    // Anthropic API IDs use HYPHENS: claude-opus-4-6, claude-sonnet-4-6, claude-haiku-4-5
    if (hasImages) return AnthropicProvider.DEFAULT_MODEL_STR; // claude-opus-4-6: best for vision
    if (hasTools) return AnthropicProvider.DEFAULT_MODEL_STR; // claude-opus-4-6: best for function calling
    if (messageLength > 100000) return AnthropicProvider.DEFAULT_MODEL_STR; // claude-opus-4-6: 1M context
    if (messageLength > 20000) return 'claude-sonnet-4-6'; // Medium context, balanced + agentic
    
    return 'claude-haiku-4-5'; // Default for simple requests (cost-effective)
  }

  private formatMessages(request: LLMRequest): { messages: any[]; system?: string } {
    let system = request.systemPrompt;
    const messages = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        // Anthropic uses separate system parameter
        system = msg.content as string;
      } else {
        messages.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content: this.formatContent(msg.content)
        });
      }
    }

    return { messages, system };
  }

  private formatContent(content: string | any[]): any {
    if (typeof content === 'string') {
      return content;
    }

    // Handle multimodal content
    return content.map(item => {
      if (item.type === 'text') {
        return { type: 'text', text: item.text };
      } else if (item.type === 'image') {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: item.imageUrl?.split(',')[1] || item.imageUrl
          }
        };
      }
      return item;
    });
  }

  private extractContent(response: any): string {
    if (!response.content || !Array.isArray(response.content)) {
      return '';
    }

    return response.content
      .filter((block: any) => block.type === 'text')
      .map((block: any) => block.text)
      .join('');
  }

  private extractFunctionCalls(response: any): Array<{ name: string; arguments: any }> | undefined {
    if (!response.content || !Array.isArray(response.content)) {
      return undefined;
    }

    const toolUses = response.content.filter((block: any) => block.type === 'tool_use');
    if (toolUses.length === 0) {
      return undefined;
    }

    return toolUses.map((tool: any) => ({
      name: tool.name,
      arguments: tool.input
    }));
  }

  private calculateModelCost(model: string, usage: { input_tokens: number; output_tokens: number }): number {
    const modelConfig = this.models[model as keyof typeof this.models];
    if (!modelConfig) return 0;

    const inputCost = (usage.input_tokens / 1000000) * modelConfig.inputCost;
    const outputCost = (usage.output_tokens / 1000000) * modelConfig.outputCost;
    
    return inputCost + outputCost;
  }

  private mapStopReason(reason: string | null): LLMResponse['finishReason'] {
    switch (reason) {
      case 'end_turn': return 'stop';
      case 'max_tokens': return 'length';
      case 'stop_sequence': return 'stop';
      case 'tool_use': return 'function_call';
      default: return 'stop';
    }
  }

  private estimateTokens(text: string): number {
    // Rough estimation: 4 characters per token
    return Math.ceil(text.length / 4);
  }
}

export default AnthropicProvider;