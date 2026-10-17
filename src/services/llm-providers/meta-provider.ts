// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Meta/LLaMA Provider - Real API Integration
 * 
 * Implements comprehensive Meta LLaMA integration with:
 * - LLaMA 4 Maverick, LLaMA 4 Scout (Feb 2026)
 * - LLaMA 3.1, 3.2, 3.3 legacy model support
 * - Code LLaMA specialized models
 * - Real-time streaming responses
 * - Advanced cost optimization
 * - Circuit breaker protection
 * - Direct Meta API integration via Together AI and OpenRouter
 */

import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('meta-provider');

export class MetaProvider extends UnifiedLLMAdapter {
  private readonly models = {
    // LLaMA 4 Maverick - NEW (Feb 2026, 400B MoE, 200 languages)
    'llama-4-maverick': { inputCost: 0.8, outputCost: 0.8, contextWindow: 1000000, maxOutput: 16384, isLatest: true },
    // LLaMA 4 Scout - NEW (Feb 2026, 10M context!)
    'llama-4-scout': { inputCost: 0.4, outputCost: 0.4, contextWindow: 10000000, maxOutput: 16384, isLatest: true },
    // LLaMA 4 Maverick 17B-128E Instruct (Feb 2026)
    'llama-4-maverick-17b-128e-instruct': { inputCost: 0.2, outputCost: 0.2, contextWindow: 131072, maxOutput: 8192, isLatest: true },
    // LLaMA 4 Scout 17B-16E Instruct (Feb 2026)
    'llama-4-scout-17b-16e-instruct': { inputCost: 0.1, outputCost: 0.1, contextWindow: 131072, maxOutput: 8192, isLatest: true },
    
    // Legacy: LLaMA 3.3 Series
    'llama-3.3-70b-instruct': { inputCost: 0.9, outputCost: 0.9, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.3-70b-versatile': { inputCost: 0.9, outputCost: 0.9, contextWindow: 131072, maxOutput: 8192 },
    
    // Legacy: LLaMA 3.2 Series
    'llama-3.2-90b-text-preview': { inputCost: 1.2, outputCost: 1.2, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.2-11b-vision-instruct': { inputCost: 0.35, outputCost: 0.35, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.2-3b-instruct': { inputCost: 0.06, outputCost: 0.06, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.2-1b-instruct': { inputCost: 0.04, outputCost: 0.04, contextWindow: 131072, maxOutput: 8192 },
    
    // Legacy: LLaMA 3.1 Series
    'llama-3.1-405b-instruct': { inputCost: 5.32, outputCost: 16, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.1-70b-instruct': { inputCost: 0.88, outputCost: 0.88, contextWindow: 131072, maxOutput: 8192 },
    'llama-3.1-8b-instruct': { inputCost: 0.2, outputCost: 0.2, contextWindow: 131072, maxOutput: 8192 },
    
    // Legacy: Code LLaMA Series
    'code-llama-70b-instruct': { inputCost: 0.9, outputCost: 0.9, contextWindow: 16384, maxOutput: 4096 },
    'code-llama-34b-instruct': { inputCost: 0.776, outputCost: 0.776, contextWindow: 16384, maxOutput: 4096 },
    'code-llama-13b-instruct': { inputCost: 0.22, outputCost: 0.22, contextWindow: 16384, maxOutput: 4096 },
    'code-llama-7b-instruct': { inputCost: 0.2, outputCost: 0.2, contextWindow: 16384, maxOutput: 4096 },
    
    // Legacy: LLaMA 2 Series
    'llama-2-70b-chat': { inputCost: 0.9, outputCost: 0.9, contextWindow: 4096, maxOutput: 4096 },
    'llama-2-13b-chat': { inputCost: 0.22, outputCost: 0.22, contextWindow: 4096, maxOutput: 4096 },
    'llama-2-7b-chat': { inputCost: 0.2, outputCost: 0.2, contextWindow: 4096, maxOutput: 4096 }
  };

  private apiEndpoints = {
    togetherAI: 'https://api.together.xyz/v1',
    openRouter: 'https://openrouter.ai/api/v1',
    metaAPI: 'https://www.llama-api.com/v1' // Direct Meta API when available
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'meta',
      name: 'Meta LLaMA',
      models: Object.keys(MetaProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: false,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: true, // 3.2 Vision models
        functionCalling: true,
        streaming: true,
        embedding: false,
        reasoning: 95, // LLaMA 3.3 excels at reasoning
        creativity: 88,
        factualAccuracy: 90,
        codingProficiency: 96, // Code LLaMA specialization
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr', 'nl', 'sv']
      },
      pricing: {
        inputTokenCost: 0.9, // LLaMA 3.3 70B base price per 1M tokens
        outputTokenCost: 0.9, // LLaMA 3.3 70B base price per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 100000,
          requestsPerMinute: 50,
          requestsPerDay: 1000
        }
      },
      limits: {
        maxTokensPerRequest: 131072,
        maxRequestsPerMinute: 50,
        maxRequestsPerDay: 1000,
        maxConcurrentRequests: 10,
        contextWindow: 131072,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 95
    };

    const key = apiKey || process.env.TOGETHER_API_KEY || process.env.OPENROUTER_API_KEY || process.env.META_API_KEY;
    if (!key) {
      throw new Error('Meta LLaMA API key is required (TOGETHER_API_KEY, OPENROUTER_API_KEY, or META_API_KEY)');
    }

    super(provider, key);
    logger.info('✅ Meta LLaMA Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    // Prioritize Together AI for LLaMA models
    if (process.env.TOGETHER_API_KEY) {
      return this.apiEndpoints.togetherAI;
    } else if (process.env.OPENROUTER_API_KEY) {
      return this.apiEndpoints.openRouter;
    } else {
      return this.apiEndpoints.metaAPI;
    }
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      const testRequest = {
        model: 'llama-4-scout-17b-16e-instruct',
        messages: [{ role: 'user' as const, content: 'Hello' }],
        max_tokens: 10
      };

      if (this.baseUrl.includes('together.xyz')) {
        return await this.validateTogetherAI(testRequest);
      } else if (this.baseUrl.includes('openrouter.ai')) {
        return await this.validateOpenRouter(testRequest);
      } else {
        return await this.validateDirectMetaAPI(testRequest);
      }
    } catch (error: any) {
      logger.error('Meta LLaMA API key validation failed:', error);
      return false;
    }
  }

  private async validateTogetherAI(testRequest: any): Promise<boolean> {
    const response = await fetch(`${this.apiEndpoints.togetherAI}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        ...testRequest,
        model: `meta-llama/${testRequest.model}`
      })
    });
    return response.ok;
  }

  private async validateOpenRouter(testRequest: any): Promise<boolean> {
    const response = await fetch(`${this.apiEndpoints.openRouter}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nyayavigya-devstudio.com',
        'X-Title': 'Jurexio DevStudio'
      },
      body: JSON.stringify({
        ...testRequest,
        model: `meta-llama/${testRequest.model}`
      })
    });
    return response.ok;
  }

  private async validateDirectMetaAPI(testRequest: any): Promise<boolean> {
    // Direct Meta API validation when available
    const response = await fetch(`${this.apiEndpoints.metaAPI}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(testRequest)
    });
    return response.ok;
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();

    try {
      // Validate model
      const modelConfig = this.models[(request.model || 'llama-4-maverick') as keyof typeof this.models];
      if (!modelConfig) {
        throw new ProviderError(`Model ${request.model} not supported by Meta LLaMA provider`);
      }

      // Rate limiting check
      await this.checkRateLimit();

      // Prepare request based on API endpoint
      const apiRequest = await this.prepareAPIRequest(request, modelConfig);
      
      // Execute request with timeout protection
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);
      logger.info(`🦙 [${correlationId}] Sending request to Meta LLaMA: ${request.model}`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getAPIHeaders(),
        body: JSON.stringify(apiRequest),
        signal: timeoutController.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`Meta LLaMA API error: ${response.status} - ${errorText}`);
      }

      const responseData = await response.json() as Record<string, any>;
      const responseTime = Date.now() - startTime;

      // Calculate cost
      const usage = responseData.usage || {};
      const cost = this.calculateProviderCost(
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        modelConfig
      );

      // Build response
      const llmResponse: LLMResponse = {
        id: responseData.id || `meta-${Date.now()}`,
        content: responseData.choices?.[0]?.message?.content || '',
        model: request.model || 'llama-4-maverick',
        provider: 'meta',
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0
        },
        cost,
        responseTime,
        finishReason: this.mapFinishReason(responseData.choices?.[0]?.finish_reason),
        correlationId,
        timestamp: new Date()
      };

      // Update provider health metrics
      await this.updateHealthMetrics(true, responseTime);

      logger.info(`✅ [${correlationId}] Meta LLaMA response completed: ${responseTime}ms, $${cost.toFixed(6)}`);
      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      await this.updateHealthMetrics(false, responseTime);
      
      logger.error(`❌ [${correlationId}] Meta LLaMA request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`Meta LLaMA request failed: ${error}`);
    }
  }

  private async prepareAPIRequest(request: LLMRequest, modelConfig: any): Promise<any> {
    const model = request.model || 'llama-4-maverick';
    
    // Format model name based on API endpoint
    let formattedModel = model;
    if (this.baseUrl.includes('together.xyz') || this.baseUrl.includes('openrouter.ai')) {
      formattedModel = `meta-llama/${model}`;
    }

    const apiRequest: Record<string, any> = {
      model: formattedModel,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: this.formatMessageContent(msg.content)
      })),
      temperature: request.temperature || 0.7,
      max_tokens: Math.min(request.maxTokens || 2048, modelConfig.maxOutput),
      top_p: request.topP || 0.9,
      frequency_penalty: request.frequencyPenalty || 0,
      presence_penalty: request.presencePenalty || 0,
      stream: request.stream || false
    };

    // Add system prompt if provided
    if (request.systemPrompt) {
      apiRequest.messages.unshift({
        role: 'system',
        content: request.systemPrompt
      });
    }

    // Add stop sequences if provided
    if (request.stopSequences?.length) {
      apiRequest.stop = request.stopSequences;
    }

    return apiRequest;
  }

  private formatMessageContent(content: string | any[]): string {
    if (typeof content === 'string') {
      return content;
    }
    
    // Handle multimodal content for LLaMA 3.2 Vision models
    if (Array.isArray(content)) {
      return content
        .filter(item => item.type === 'text')
        .map(item => item.text)
        .join('\n');
    }
    
    return String(content);
  }

  private getAPIHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };

    // Add specific headers based on API endpoint
    if (this.baseUrl.includes('openrouter.ai')) {
      headers['HTTP-Referer'] = 'https://nyayavigya-devstudio.com';
      headers['X-Title'] = 'Jurexio DevStudio';
    }

    return headers;
  }

  private calculateProviderCost(promptTokens: number, completionTokens: number, modelConfig: any): number {
    const promptCost = (promptTokens / 1_000_000) * modelConfig.inputCost;
    const completionCost = (completionTokens / 1_000_000) * modelConfig.outputCost;
    return promptCost + completionCost;
  }

  private mapFinishReason(reason: string | undefined): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop':
      case 'end_turn':
        return 'stop';
      case 'length':
      case 'max_tokens':
        return 'length';
      case 'content_filter':
        return 'content_filter';
      case 'function_call':
      case 'tool_calls':
        return 'function_call';
      default:
        return 'stop';
    }
  }

  async generateStreamingResponse(request: LLMRequest): Promise<AsyncIterable<string>> {
    const correlationId = request.correlationId || generateCorrelationId();
    
    try {
      const modelConfig = this.models[(request.model || 'llama-4-maverick') as keyof typeof this.models];
      if (!modelConfig) {
        throw new ProviderError(`Model ${request.model} not supported by Meta LLaMA provider`);
      }

      await this.checkRateLimit();

      const apiRequest = await this.prepareAPIRequest(request, modelConfig);
      apiRequest.stream = true;

      logger.info(`🦙 [${correlationId}] Starting streaming request to Meta LLaMA: ${request.model}`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: this.getAPIHeaders(),
        body: JSON.stringify(apiRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`Meta LLaMA streaming API error: ${response.status} - ${errorText}`);
      }

      return this.parseStreamingResponse(response, correlationId);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Meta LLaMA streaming request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`Meta LLaMA streaming request failed: ${error}`);
    }
  }

  private async *parseStreamingResponse(response: Response, correlationId: string): AsyncIterable<string> {
    const reader = response.body?.getReader();
    if (!reader) {
      throw new ProviderError('No response body available for streaming');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              logger.info(`✅ [${correlationId}] Meta LLaMA streaming completed`);
              return;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                yield content;
              }
            } catch (parseError: any) {
              logger.warn(`⚠️ [${correlationId}] Failed to parse streaming chunk:`, parseError);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  getModelInfo(model: string) {
    const config = this.models[model as keyof typeof this.models];
    if (!config) {
      throw new ProviderError(`Model ${model} not found in Meta LLaMA provider`);
    }

    return {
      id: model,
      name: model,
      description: this.getModelDescription(model),
      contextWindow: config.contextWindow,
      maxOutput: config.maxOutput,
      inputCost: config.inputCost,
      outputCost: config.outputCost,
      capabilities: this.getModelCapabilities(model)
    };
  }

  private getModelDescription(model: string): string {
    if (model.includes('3.3')) {
      return 'Latest LLaMA 3.3 with enhanced reasoning and multilingual capabilities';
    } else if (model.includes('3.2')) {
      return 'LLaMA 3.2 with vision capabilities and improved performance';
    } else if (model.includes('3.1')) {
      return 'LLaMA 3.1 with extended context and advanced reasoning';
    } else if (model.includes('code-llama')) {
      return 'Specialized Code LLaMA for programming and software development';
    } else {
      return 'Meta LLaMA model for general text generation and conversation';
    }
  }

  private getModelCapabilities(model: string): string[] {
    const capabilities = ['text-generation', 'conversation', 'instruction-following'];
    
    if (model.includes('code-llama')) {
      capabilities.push('code-generation', 'code-completion', 'debugging');
    }
    
    if (model.includes('3.2') && model.includes('vision')) {
      capabilities.push('vision', 'multimodal');
    }
    
    if (model.includes('3.3') || model.includes('3.1')) {
      capabilities.push('advanced-reasoning', 'mathematical-reasoning');
    }
    
    return capabilities;
  }

  listAvailableModels(): string[] {
    return Object.keys(this.models);
  }

  supportsFeature(feature: string): boolean {
    const supportedFeatures = [
      'text-generation',
      'code-generation',
      'streaming',
      'function-calling',
      'conversation',
      'instruction-following',
      'multilingual'
    ];
    
    return supportedFeatures.includes(feature);
  }
}