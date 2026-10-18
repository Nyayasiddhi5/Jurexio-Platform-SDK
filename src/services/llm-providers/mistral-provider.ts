// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Mistral AI Provider - Real API Integration
 * 
 * Implements comprehensive Mistral AI integration with:
 * - Mistral Large 3, Devstral Medium, Codestral 2508 (Feb 2026)
 * - Mistral Medium 3, Ministral 3
 * - Mistral-Embed for embeddings
 * - Function calling and tool use
 * - Real-time streaming responses
 * - European AI sovereignty and GDPR compliance
 * - Advanced cost optimization
 * - Circuit breaker protection
 */

import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('mistral-provider');

export class MistralProvider extends UnifiedLLMAdapter {
  private readonly models = {
    // Mistral Large 3 - NEW Flagship (Feb 2026, 675B MoE, 92% of GPT-5.2 at 15% cost)
    'mistral-large-3': { inputCost: 1.5, outputCost: 4.5, contextWindow: 256000, maxOutput: 16384, isLatest: true },
    // Mistral Medium 3 (Feb 2026)
    'mistral-medium-3': { inputCost: 0.5, outputCost: 1.5, contextWindow: 128000, maxOutput: 8192, isLatest: true },
    // Devstral Medium - Agentic Coding (Feb 2026)
    'devstral-medium': { inputCost: 0.3, outputCost: 0.9, contextWindow: 128000, maxOutput: 8192, isLatest: true },
    // Codestral 2508 - 80+ Languages (Feb 2026)
    'codestral-2508': { inputCost: 0.2, outputCost: 0.6, contextWindow: 128000, maxOutput: 8192, isLatest: true },
    // Ministral 3 - Edge-Optimized (Feb 2026)
    'ministral-3': { inputCost: 0.1, outputCost: 0.3, contextWindow: 32768, maxOutput: 8192, isLatest: true },
    
    // Legacy: Large Models
    'mistral-large-latest': { inputCost: 2, outputCost: 6, contextWindow: 128000, maxOutput: 8192 },
    'mistral-large-2407': { inputCost: 2, outputCost: 6, contextWindow: 128000, maxOutput: 8192 },
    'mistral-large-2402': { inputCost: 2, outputCost: 6, contextWindow: 32768, maxOutput: 8192 },
    
    // Legacy: Medium Models
    'mistral-medium-latest': { inputCost: 0.7, outputCost: 2.1, contextWindow: 32768, maxOutput: 8192 },
    'mistral-medium-2312': { inputCost: 0.7, outputCost: 2.1, contextWindow: 32768, maxOutput: 8192 },
    
    // Legacy: Small Models
    'mistral-small-latest': { inputCost: 0.2, outputCost: 0.6, contextWindow: 32768, maxOutput: 8192 },
    'mistral-small-2402': { inputCost: 0.2, outputCost: 0.6, contextWindow: 32768, maxOutput: 8192 },
    'mistral-small-2312': { inputCost: 0.2, outputCost: 0.6, contextWindow: 32768, maxOutput: 8192 },
    
    // Legacy: Open Source Models
    'open-mistral-7b': { inputCost: 0.25, outputCost: 0.25, contextWindow: 32768, maxOutput: 8192 },
    'open-mixtral-8x7b': { inputCost: 0.7, outputCost: 0.7, contextWindow: 32768, maxOutput: 8192 },
    'open-mixtral-8x22b': { inputCost: 2, outputCost: 6, contextWindow: 65536, maxOutput: 8192 },
    
    // Legacy: Specialized Models
    'codestral-latest': { inputCost: 0.2, outputCost: 0.6, contextWindow: 32768, maxOutput: 8192 },
    'codestral-2405': { inputCost: 0.2, outputCost: 0.6, contextWindow: 32768, maxOutput: 8192 },
    'codestral-mamba-latest': { inputCost: 0.25, outputCost: 0.25, contextWindow: 256000, maxOutput: 8192 },
    
    // Embedding Model
    'mistral-embed': { inputCost: 0.1, outputCost: 0, contextWindow: 8192, maxOutput: 0 }
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'mistral',
      name: 'Mistral AI',
      models: Object.keys(MistralProvider.prototype.models),
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
        reasoning: 89,
        creativity: 86,
        factualAccuracy: 91,
        codingProficiency: 93, // Excellent with Codestral
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh']
      },
      pricing: {
        inputTokenCost: 2, // Mistral Large base price per 1M tokens
        outputTokenCost: 6, // Mistral Large base price per 1M tokens
        embeddingCost: 0.1, // Mistral-Embed per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 0,
          requestsPerMinute: 60,
          requestsPerDay: 1000
        }
      },
      limits: {
        maxTokensPerRequest: 128000,
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 1000,
        maxConcurrentRequests: 10,
        contextWindow: 128000,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['eu', 'global'], // European sovereignty
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 100
    };

    const key = apiKey || process.env.MISTRAL_API_KEY;
    if (!key) {
      throw new Error('Mistral API key is required');
    }

    super(provider, key, 'https://api.mistral.ai/v1');

    logger.info('✅ Mistral Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.mistral.ai/v1';
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch('https://api.mistral.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error: any) {
      logger.error('Mistral API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Mistral generating response with model: ${request.model || 'mistral-large-3'}`);
      
      // Check rate limiting
      if (!(await this.checkRateLimit())) {
        throw new ProviderError('Rate limit exceeded', 'mistral', { correlationId });
      }

      // Select optimal model if not specified
      const model = request.model || this.selectOptimalModel(request);
      const modelConfig = this.models[model as keyof typeof this.models];
      
      if (!modelConfig) {
        throw new ProviderError(`Unsupported model: ${model}`, 'mistral', { correlationId, model });
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
        stop: request.stopSequences,
        stream: false,
        tools: request.tools?.map(tool => ({
          type: 'function',
          function: tool.function
        })),
        tool_choice: request.tools ? 'auto' : undefined,
        safe_prompt: false // Allow creative content
      };

      // Generate response
      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
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
          `Mistral API error: ${response.status} ${response.statusText}`,
          'mistral',
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
        provider: 'mistral',
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
          mistral_id: data.id,
          // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
          object: data.object,
          // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
          created: data.created
        }
      };

      // Track cost
      this.trackCost(llmResponse);

      logger.info(`✅ [${correlationId}] Mistral response generated: ${llmResponse.usage.totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms`);
      this.emit('response-generated', llmResponse);

      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      logger.error(`❌ [${correlationId}] Mistral request failed after ${responseTime}ms:`, error);
      
      if (error instanceof Error) {
        throw new ProviderError(
          `Mistral request failed: ${error.message}`,
          'mistral',
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
      logger.info(`🔄 [${correlationId}] Mistral streaming response with model: ${request.model || 'mistral-large-3'}`);
      
      const model = request.model || this.selectOptimalModel(request);
      const messages = this.formatMessages(request);

      const requestBody = {
        model,
        messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens,
        top_p: request.topP,
        stop: request.stopSequences,
        stream: true,
        tools: request.tools?.map(tool => ({
          type: 'function',
          function: tool.function
        })),
        safe_prompt: false
      };

      const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (response.ok === false) {
        throw new ProviderError(`Mistral streaming failed: ${response.status}`, 'mistral', { correlationId });
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new ProviderError('No response body reader available', 'mistral', { correlationId });
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
                provider: 'mistral',
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

      logger.info(`✅ [${correlationId}] Mistral streaming completed: ${totalTokens} tokens`);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Mistral streaming failed:`, error);
      throw new ProviderError(
        `Mistral streaming failed: ${error}`,
        'mistral',
        { correlationId }
      );
    }
  }

  async generateEmbeddings(texts: string[], model = 'mistral-embed'): Promise<number[][]> {
    const correlationId = generateCorrelationId();
    const startTime = Date.now();
    
    try {
      logger.info(`🔄 [${correlationId}] Mistral generating embeddings for ${texts.length} texts`);
      
      const response = await fetch('https://api.mistral.ai/v1/embeddings', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          input: texts
        })
      });

      if (response.ok === false) {
        throw new ProviderError(`Mistral embeddings failed: ${response.status}`, 'mistral', { correlationId });
      }

      const data = await response.json();
      const responseTime = Date.now() - startTime;
      // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
      const totalTokens = data.usage?.total_tokens || texts.reduce((sum, text) => sum + this.estimateTokens(text), 0);
      const cost = (totalTokens / 1000000) * (this.models[model as keyof typeof this.models]?.inputCost || 0.1);

      logger.info(`✅ [${correlationId}] Mistral embeddings generated: ${totalTokens} tokens, $${cost.toFixed(6)} cost, ${responseTime}ms`);

      // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
      return data.data.map((item: any) => item.embedding);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Mistral embeddings failed:`, error);
      throw new ProviderError(
        `Mistral embeddings failed: ${error}`,
        'mistral',
        { correlationId }
      );
    }
  }

  async generateImage(prompt: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'Mistral does not provide image generation. Use OpenAI DALL-E or other providers for image generation.',
      'mistral',
      { capability: 'image_generation' }
    );
  }

  async generateAudio(text: string, options?: any): Promise<{ url: string; cost: number }> {
    throw new ProviderError(
      'Mistral does not provide audio generation. Use OpenAI TTS or other providers for audio generation.',
      'mistral',
      { capability: 'audio_generation' }
    );
  }

  async transcribeAudio(audioUrl: string): Promise<{ text: string; cost: number }> {
    throw new ProviderError(
      'Mistral does not provide speech-to-text. Use OpenAI Whisper or other providers for audio transcription.',
      'mistral',
      { capability: 'speech_to_text' }
    );
  }

  /**
   * Mistral-specific code generation method
   */
  async generateCode(prompt: string, language: string, options: {
    temperature?: number;
    max_tokens?: number;
    stop?: string[];
  } = {}): Promise<{
    code: string;
    explanation: string;
    cost: number;
  }> {
    const correlationId = generateCorrelationId();
    
    try {
      logger.info(`🔄 [${correlationId}] Mistral Codestral generating ${language} code`);
      
      const codePrompt = `Generate ${language} code for the following requirement:\n\n${prompt}\n\nProvide both the code and a brief explanation.`;
      
      const response = await this.generateResponse({
        messages: [{ role: 'user', content: codePrompt }],
        model: 'codestral-latest',
        temperature: options.temperature ?? 0.1, // Lower temperature for code
        maxTokens: options.max_tokens || 4096,
        stopSequences: options.stop,
        correlationId
      });

      // Split response into code and explanation (simple heuristic)
      const content = response.content;
      const codeMatch = content.match(/```[\w]*\n([\s\S]*?)\n```/);
      const code = codeMatch ? codeMatch[1] : content;
      const explanation = content.replace(/```[\w]*\n[\s\S]*?\n```/g, '').trim();

      return {
        code,
        explanation,
        cost: response.cost
      };

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Mistral code generation failed:`, error);
      throw error;
    }
  }

  /**
   * Private helper methods
   */
  private selectOptimalModel(request: LLMRequest): string {
    const messageLength = request.messages.reduce((sum, msg) => sum + msg.content.length, 0);
    const hasTools = request.tools && request.tools.length > 0;
    
    // Check if this is a code-related request
    const isCodeRequest = request.messages.some(msg => 
      typeof msg.content === 'string' && 
      (msg.content.includes('code') || 
       msg.content.includes('programming') || 
       msg.content.includes('function') ||
       msg.content.includes('debug') ||
       msg.content.includes('implement'))
    );

    // Select based on requirements
    if (isCodeRequest) return 'devstral-medium'; // Best for code
    if (hasTools) return 'mistral-large-3'; // Best for function calling
    if (messageLength > 50000) return 'mistral-large-3'; // Large context
    if (messageLength > 10000) return 'mistral-medium-3'; // Medium context
    
    return 'ministral-3'; // Cost-effective for simple requests
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
      content: msg.content
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
      case 'tool_calls': return 'function_call';
      case 'content_filter': return 'content_filter';
      default: return 'stop';
    }
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export default MistralProvider;