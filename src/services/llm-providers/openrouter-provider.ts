// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Enhanced OpenRouter Provider - Real API Integration
 * 
 * Implements comprehensive OpenRouter integration with:
 * - 200+ models from multiple providers
 * - Real-time model selection and routing
 * - Advanced cost optimization
 * - Provider arbitrage capabilities
 * - Circuit breaker protection
 * - Enhanced fallback mechanisms
 */

import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { openRouterGateway, type OpenRouterModel } from '../openrouter-universal-gateway.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('openrouter-provider');

export class OpenRouterProvider extends UnifiedLLMAdapter {
  private readonly models = {
    // Feb 2026 Latest Models — real OpenRouter model IDs
    'openai/gpt-4.1': { inputCost: 2, outputCost: 8, contextWindow: 1000000, maxOutput: 32768, isLatest: true },
    'openai/gpt-4.1-mini': { inputCost: 0.4, outputCost: 1.6, contextWindow: 1000000, maxOutput: 32768, isLatest: true },
    'openai/o4-mini': { inputCost: 1.1, outputCost: 4.4, contextWindow: 200000, maxOutput: 65536, isLatest: true },
    'openai/o3': { inputCost: 15, outputCost: 60, contextWindow: 200000, maxOutput: 65536 },
    'google/gemini-3.1-pro-preview': { inputCost: 3, outputCost: 12, contextWindow: 2000000, maxOutput: 16384, isLatest: true },
    'google/gemini-3-pro-preview': { inputCost: 2, outputCost: 8, contextWindow: 2000000, maxOutput: 8192, isLatest: true },
    'google/gemini-3-flash-preview': { inputCost: 0.5, outputCost: 2, contextWindow: 1000000, maxOutput: 8192, isLatest: true },
    'deepseek/deepseek-v3': { inputCost: 0.27, outputCost: 1.10, contextWindow: 64000, maxOutput: 8192, isLatest: true },
    'deepseek/deepseek-r1': { inputCost: 0.55, outputCost: 2.19, contextWindow: 64000, maxOutput: 16384, isLatest: true },
    'mistralai/mistral-large-3': { inputCost: 1.5, outputCost: 4.5, contextWindow: 256000, maxOutput: 16384 },
    'mistralai/devstral-medium': { inputCost: 0.3, outputCost: 0.9, contextWindow: 128000, maxOutput: 8192 },
    'meta-llama/llama-4-maverick:free': { inputCost: 0, outputCost: 0, contextWindow: 1000000, maxOutput: 16384, isLatest: true },
    'meta-llama/llama-4-scout:free': { inputCost: 0, outputCost: 0, contextWindow: 10000000, maxOutput: 16384, isLatest: true },
    'x-ai/grok-4': { inputCost: 3, outputCost: 15, contextWindow: 256000, maxOutput: 32768, isLatest: true },
    'x-ai/grok-3-beta': { inputCost: 3, outputCost: 15, contextWindow: 131072, maxOutput: 8192 },
    'x-ai/grok-3-mini-beta': { inputCost: 0.3, outputCost: 0.5, contextWindow: 131072, maxOutput: 8192 },
    
    // Featured Premium Models
    'openai/gpt-4o': { inputCost: 2.5, outputCost: 10, contextWindow: 128000, maxOutput: 4096 },
    'openai/gpt-4o-mini': { inputCost: 0.15, outputCost: 0.6, contextWindow: 128000, maxOutput: 16384 },
    'anthropic/claude-opus-4-6': { inputCost: 5, outputCost: 25, contextWindow: 200000, maxOutput: 64000, isLatest: true },
    'anthropic/claude-sonnet-4-6': { inputCost: 3, outputCost: 15, contextWindow: 200000, maxOutput: 64000, isLatest: true },
    'anthropic/claude-haiku-4-5': { inputCost: 0.25, outputCost: 1.25, contextWindow: 200000, maxOutput: 8192 },
    'anthropic/claude-opus-4-5': { inputCost: 5, outputCost: 25, contextWindow: 200000, maxOutput: 32768 },
    
    // Google Models — stable
    'google/gemini-2.5-pro': { inputCost: 1.25, outputCost: 5, contextWindow: 1000000, maxOutput: 8192 },
    'google/gemini-2.5-flash': { inputCost: 0.075, outputCost: 0.3, contextWindow: 1000000, maxOutput: 8192 },
    'google/gemma-2-27b-it': { inputCost: 0.27, outputCost: 0.27, contextWindow: 8192, maxOutput: 4096 },
    
    // Meta LLaMA Models
    'meta-llama/llama-4-maverick-17b-128e-instruct': { inputCost: 0.4, outputCost: 0.4, contextWindow: 1000000, maxOutput: 16384 },
    'meta-llama/llama-4-scout-17b-16e-instruct': { inputCost: 0.2, outputCost: 0.2, contextWindow: 10000000, maxOutput: 16384 },
    'meta-llama/llama-3.3-70b-instruct:free': { inputCost: 0, outputCost: 0, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/llama-3.3-70b-instruct': { inputCost: 0.9, outputCost: 0.9, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/llama-3.1-70b-instruct': { inputCost: 0.88, outputCost: 0.88, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/llama-3.1-8b-instruct': { inputCost: 0.2, outputCost: 0.2, contextWindow: 131072, maxOutput: 8192 },
    
    // Mistral Models
    'mistralai/mixtral-8x7b-instruct': { inputCost: 0.24, outputCost: 0.24, contextWindow: 32768, maxOutput: 4096 },
    'mistralai/mixtral-8x22b-instruct': { inputCost: 0.65, outputCost: 0.65, contextWindow: 65536, maxOutput: 4096 },
    'mistralai/mistral-7b-instruct': { inputCost: 0.06, outputCost: 0.06, contextWindow: 32768, maxOutput: 4096 },
    
    // Cohere Models
    'cohere/command-r-plus': { inputCost: 3, outputCost: 15, contextWindow: 128000, maxOutput: 4096 },
    'cohere/command-r': { inputCost: 0.5, outputCost: 1.5, contextWindow: 128000, maxOutput: 4096 },
    
    // Perplexity Models
    'perplexity/llama-3.1-sonar-large-128k-online': { inputCost: 1, outputCost: 1, contextWindow: 127072, maxOutput: 4096 },
    'perplexity/llama-3.1-sonar-small-128k-online': { inputCost: 0.2, outputCost: 0.2, contextWindow: 127072, maxOutput: 4096 },
    
    // DeepSeek Models — additional
    'deepseek/deepseek-coder-v2-instruct': { inputCost: 0.14, outputCost: 0.28, contextWindow: 128000, maxOutput: 8192 },
    
    // Qwen Models
    'qwen/qwen-2.5-72b-instruct': { inputCost: 0.4, outputCost: 0.4, contextWindow: 131072, maxOutput: 8192 },
    'qwen/qwen-2.5-coder-32b-instruct': { inputCost: 0.2, outputCost: 0.2, contextWindow: 131072, maxOutput: 8192 },
    
    // Other Providers
    'databricks/dbrx-instruct': { inputCost: 0.75, outputCost: 2.25, contextWindow: 32768, maxOutput: 4096 },
    'nousresearch/nous-hermes-2-mixtral-8x7b-dpo': { inputCost: 0.3, outputCost: 0.3, contextWindow: 32768, maxOutput: 4096 },
    'openchat/openchat-7b': { inputCost: 0.07, outputCost: 0.07, contextWindow: 8192, maxOutput: 4096 },
    
    // Image Generation
    'openai/gpt-image-1': { inputCost: 0, outputCost: 0, contextWindow: 0, maxOutput: 0 },
    'openai/dall-e-3': { inputCost: 0, outputCost: 0, contextWindow: 0, maxOutput: 0 },
    'stability-ai/stable-diffusion-xl': { inputCost: 0, outputCost: 0, contextWindow: 0, maxOutput: 0 }
  };

  private availableModels: Map<string, OpenRouterModel> = new Map();
  private modelPerformanceCache: Map<string, any> = new Map();

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'openrouter',
      name: 'OpenRouter Universal',
      models: Object.keys(OpenRouterProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: true,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: true,
        functionCalling: true,
        streaming: true,
        embedding: false,
        reasoning: 95, // Best-in-class routing
        creativity: 92,
        factualAccuracy: 94,
        codingProficiency: 96,
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr', 'nl', 'sv', 'da', 'no', 'fi']
      },
      pricing: {
        inputTokenCost: 2.5, // Variable based on selected model
        outputTokenCost: 10, // Variable based on selected model
        imageGenerationCost: 40, // DALL-E 3 pricing
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 200000, // 200K free tokens
          requestsPerMinute: 20,
          requestsPerDay: 500
        }
      },
      limits: {
        maxTokensPerRequest: 2097152, // Gemini Pro 1.5 limit
        maxRequestsPerMinute: 20,
        maxRequestsPerDay: 500,
        maxConcurrentRequests: 5,
        contextWindow: 2097152,
        timeoutMs: 300000 // 5 minutes for large models
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 98
    };

    const key = apiKey || process.env.OPENROUTER_API_KEY;
    if (!key) {
      throw new Error('OpenRouter API key is required (OPENROUTER_API_KEY)');
    }

    super(provider, key, 'https://openrouter.ai/api/v1');
    
    this.initializeEnhancedOpenRouter();
    logger.info('✅ Enhanced OpenRouter Provider initialized with 200+ models');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://openrouter.ai/api/v1';
  }

  private async initializeEnhancedOpenRouter(): Promise<void> {
    try {
      // Load available models from OpenRouter
      await this.loadAvailableModels();
      
      // Initialize performance monitoring
      this.startPerformanceMonitoring();
      
      logger.info(`🌐 Enhanced OpenRouter initialized with ${this.availableModels.size} models`);
    } catch (error: any) {
      logger.error('Enhanced OpenRouter initialization failed:', error);
    }
  }

  private async loadAvailableModels(): Promise<void> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://jurexio-devstudio.com',
          'X-Title': 'Jurexio DevStudio Enhanced'
        }
      });

      if (response.ok) {
        const data = await response.json() as { data?: OpenRouterModel[] };
        data.data?.forEach((model: OpenRouterModel) => {
          this.availableModels.set(model.id, model);
        });
        logger.info(`📊 Loaded ${this.availableModels.size} models from OpenRouter`);
      }
    } catch (error: any) {
      logger.warn('Failed to load OpenRouter models, using fallback list:', error);
    }
  }

  private startPerformanceMonitoring(): void {
    // Monitor model performance every 5 minutes
    setInterval(async () => {
      try {
        await this.updateModelPerformanceMetrics();
      } catch (error: any) {
        logger.warn('Performance monitoring update failed:', error);
      }
    }, 5 * 60 * 1000);
  }

  private async updateModelPerformanceMetrics(): Promise<void> {
    // Update performance cache with latest metrics
    for (const [modelId, model] of this.availableModels) {
      const cached = this.modelPerformanceCache.get(modelId) || {
        requests: 0,
        totalResponseTime: 0,
        successRate: 1.0,
        averageCost: 0,
        lastUpdated: new Date()
      };
      
      this.modelPerformanceCache.set(modelId, cached);
    }
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/auth/key', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://jurexio-devstudio.com',
          'X-Title': 'Jurexio DevStudio Enhanced'
        }
      });
      return response.ok;
    } catch (error: any) {
      logger.error('OpenRouter API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();

    try {
      // Intelligent model selection if no specific model requested
      const selectedModel = await this.selectOptimalModel(request);
      const modelConfig = this.models[selectedModel as keyof typeof this.models] || this.getModelConfigFromAPI(selectedModel);

      if (!modelConfig) {
        throw new ProviderError(`Model ${selectedModel} not supported by OpenRouter provider`);
      }

      // Rate limiting check
      await this.checkRateLimit();

      // Prepare request with OpenRouter enhancements
      const apiRequest = this.prepareEnhancedAPIRequest(request, selectedModel, modelConfig);
      
      // Execute request with timeout protection
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);
      logger.info(`🌐 [${correlationId}] Sending request to OpenRouter: ${selectedModel}`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://jurexio-devstudio.com',
          'X-Title': 'Jurexio DevStudio Enhanced',
          'X-Correlation-ID': correlationId
        },
        body: JSON.stringify(apiRequest),
        signal: timeoutController.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      const responseData = await response.json() as Record<string, any>;
      const responseTime = Date.now() - startTime;

      // Calculate cost using OpenRouter's pricing
      const usage = responseData.usage || {};
      const cost = this.calculateOpenRouterCost(
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        selectedModel,
        modelConfig
      );

      // Build response with OpenRouter metadata
      const llmResponse: LLMResponse = {
        id: responseData.id || `openrouter-${Date.now()}`,
        content: responseData.choices?.[0]?.message?.content || '',
        model: selectedModel,
        provider: 'openrouter',
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0
        },
        cost,
        responseTime,
        finishReason: this.mapFinishReason(responseData.choices?.[0]?.finish_reason),
        correlationId,
        timestamp: new Date(),
        metadata: {
          openrouterProvider: responseData.provider,
          openrouterModelId: responseData.model,
          selectedModel: selectedModel,
          originalModel: request.model
        }
      };

      // Update performance metrics
      await this.updateModelPerformance(selectedModel, responseTime, cost, true);
      await this.updateHealthMetrics(true, responseTime);

      logger.info(`✅ [${correlationId}] OpenRouter response completed: ${responseTime}ms, $${cost.toFixed(6)} via ${responseData.provider || 'unknown'}`);
      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      await this.updateHealthMetrics(false, responseTime);
      
      logger.error(`❌ [${correlationId}] OpenRouter request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`OpenRouter request failed: ${error}`);
    }
  }

  private async selectOptimalModel(request: LLMRequest): Promise<string> {
    // If specific model requested, use it
    if (request.model && this.models[request.model as keyof typeof this.models]) {
      return request.model;
    }

    // Use OpenRouter gateway's intelligent selection
    try {
      const selection = await openRouterGateway.selectOptimalModel(
        {
          prompt: request.messages[request.messages.length - 1]?.content?.toString() || '',
          taskType: this.determineTaskType(request),
          urgency: 'medium',
          qualityRequirement: 'good'
        },
        { sessionId: request.correlationId || 'anonymous' },
        'performanceBased'
      );
      
      return selection.selectedModel.id;
    } catch (error: any) {
      logger.warn('OpenRouter model selection failed, using default:', error);
      return 'openai/o4-mini'; // Safe fallback
    }
  }

  private determineTaskType(request: LLMRequest): 'coding' | 'creative' | 'analytical' | 'general' {
    const content = request.messages.join(' ').toLowerCase();
    
    if (content.includes('code') || content.includes('programming') || content.includes('function')) {
      return 'coding';
    } else if (content.includes('write') || content.includes('story') || content.includes('creative')) {
      return 'creative';
    } else if (content.includes('analyze') || content.includes('data') || content.includes('research')) {
      return 'analytical';
    } else {
      return 'general';
    }
  }

  private prepareEnhancedAPIRequest(request: LLMRequest, selectedModel: string, modelConfig: any): any {
    const apiRequest: Record<string, any> = {
      model: selectedModel,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: this.formatMessageContent(msg.content)
      })),
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      max_tokens: Math.min(request.maxTokens || 2048, modelConfig.maxOutput || 4096),
      top_p: request.topP || 0.95,
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

    // Add function calling for supported models
    if (request.tools?.length) {
      apiRequest.tools = request.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      }));
    }

    // OpenRouter specific enhancements
    apiRequest.provider = {
      order: ['OpenAI', 'Anthropic', 'Google', 'Meta'],
      allow_fallbacks: true
    };

    return apiRequest;
  }

  private formatMessageContent(content: string | any[]): string | any {
    if (typeof content === 'string') {
      return content;
    }
    
    // Handle multimodal content
    if (Array.isArray(content)) {
      return content;
    }
    
    return String(content);
  }

  private calculateOpenRouterCost(promptTokens: number, completionTokens: number, model: string, modelConfig: any): number {
    // Use OpenRouter's actual pricing if available
    const openRouterModel = this.availableModels.get(model);
    if (openRouterModel?.pricing) {
      const promptCost = (promptTokens / 1_000_000) * openRouterModel.pricing.prompt;
      const completionCost = (completionTokens / 1_000_000) * openRouterModel.pricing.completion;
      return promptCost + completionCost;
    }

    // Fallback to estimated pricing
    const promptCost = (promptTokens / 1_000_000) * modelConfig.inputCost;
    const completionCost = (completionTokens / 1_000_000) * modelConfig.outputCost;
    return promptCost + completionCost;
  }

  private getModelConfigFromAPI(model: string): any {
    const openRouterModel = this.availableModels.get(model);
    if (openRouterModel) {
      return {
        inputCost: openRouterModel.pricing?.prompt || 1.0,
        outputCost: openRouterModel.pricing?.completion || 1.0,
        contextWindow: openRouterModel.context_length || 4096,
        maxOutput: (openRouterModel as OpenRouterModel & { top_provider?: { max_completion_tokens?: number } }).top_provider?.max_completion_tokens || 4096
      };
    }
    return null;
  }

  private async updateModelPerformance(model: string, responseTime: number, cost: number, success: boolean): Promise<void> {
    const cached = this.modelPerformanceCache.get(model) || {
      requests: 0,
      totalResponseTime: 0,
      successRate: 1.0,
      averageCost: 0,
      lastUpdated: new Date()
    };

    cached.requests += 1;
    cached.totalResponseTime += responseTime;
    cached.averageCost = (cached.averageCost * (cached.requests - 1) + cost) / cached.requests;
    cached.successRate = success 
      ? (cached.successRate * 0.95 + 0.05)
      : (cached.successRate * 0.95);
    cached.lastUpdated = new Date();

    this.modelPerformanceCache.set(model, cached);
  }

  private mapFinishReason(reason: string | undefined): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop':
        return 'stop';
      case 'length':
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
      const selectedModel = await this.selectOptimalModel(request);
      const modelConfig = this.models[selectedModel as keyof typeof this.models] || this.getModelConfigFromAPI(selectedModel);

      if (!modelConfig) {
        throw new ProviderError(`Model ${selectedModel} not supported by OpenRouter provider`);
      }

      await this.checkRateLimit();

      const apiRequest = this.prepareEnhancedAPIRequest(request, selectedModel, modelConfig);
      apiRequest.stream = true;

      logger.info(`🌐 [${correlationId}] Starting streaming request to OpenRouter: ${selectedModel}`);

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://jurexio-devstudio.com',
          'X-Title': 'Jurexio DevStudio Enhanced',
          'X-Correlation-ID': correlationId
        },
        body: JSON.stringify(apiRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`OpenRouter streaming API error: ${response.status} - ${errorText}`);
      }

      return this.parseStreamingResponse(response, correlationId);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] OpenRouter streaming request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`OpenRouter streaming request failed: ${error}`);
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
              logger.info(`✅ [${correlationId}] OpenRouter streaming completed`);
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

  // Enhanced OpenRouter features
  async getProviderStats(): Promise<any> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/generation/stats', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://jurexio-devstudio.com',
          'X-Title': 'Jurexio DevStudio Enhanced'
        }
      });

      if (response.ok) {
        return await response.json();
      }
    } catch (error: any) {
      logger.warn('Failed to fetch OpenRouter stats:', error);
    }
    return null;
  }

  async getModelRankings(category?: string): Promise<OpenRouterModel[]> {
    const models = Array.from(this.availableModels.values());
    
    if (category) {
      return models
        .filter(m => (m as OpenRouterModel & { specialties?: string[] }).specialties?.includes(category))
        .sort((a, b) => (b.capabilities?.reasoning || 0) - (a.capabilities?.reasoning || 0));
    }
    
    return models.sort((a, b) => (b.capabilities?.reasoning || 0) - (a.capabilities?.reasoning || 0));
  }

  async getBestModelForTask(taskType: string, budgetLimit?: number): Promise<string> {
    const selection = await openRouterGateway.selectOptimalModel(
      {
        prompt: `Task type: ${taskType}`,
        taskType,
        urgency: 'medium',
        qualityRequirement: 'good'
      },
      { sessionId: 'task-selection' },
      budgetLimit ? 'costOptimized' : 'performanceBased'
    );
    
    return selection.selectedModel.id;
  }

  getModelInfo(model: string) {
    const config = this.models[model as keyof typeof this.models] || this.getModelConfigFromAPI(model);
    const openRouterModel = this.availableModels.get(model);
    
    if (!config) {
      throw new ProviderError(`Model ${model} not found in OpenRouter provider`);
    }

    return {
      id: model,
      name: openRouterModel?.name || model,
      description: openRouterModel?.description || `OpenRouter model: ${model}`,
      contextWindow: config.contextWindow,
      maxOutput: config.maxOutput,
      inputCost: config.inputCost,
      outputCost: config.outputCost,
      capabilities: openRouterModel?.capabilities || {},
      specialties: (openRouterModel as (OpenRouterModel & { specialties?: string[]; provider?: string }) | undefined)?.specialties || [],
      provider: (openRouterModel as (OpenRouterModel & { specialties?: string[]; provider?: string }) | undefined)?.provider || 'openrouter'
    };
  }

  listAvailableModels(): string[] {
    return Array.from(this.availableModels.keys()).concat(Object.keys(this.models));
  }

  supportsFeature(feature: string): boolean {
    const supportedFeatures = [
      'text-generation',
      'code-generation',
      'image-generation',
      'streaming',
      'function-calling',
      'conversation',
      'instruction-following',
      'multilingual',
      'vision',
      'multimodal',
      'provider-arbitrage',
      'model-selection',
      'cost-optimization'
    ];
    
    return supportedFeatures.includes(feature);
  }

  getPerformanceMetrics(): Map<string, any> {
    return new Map(this.modelPerformanceCache);
  }

  // Provider arbitrage - automatically find the best deal
  async findBestDeal(requirements: {
    taskType: string;
    maxCost?: number;
    minQuality?: number;
    maxResponseTime?: number;
  }): Promise<string> {
    const candidates = Array.from(this.availableModels.values())
      .filter(model => {
        if (requirements.maxCost && model.pricing) {
          const avgCost = (model.pricing.prompt + model.pricing.completion) / 2;
          if (avgCost > requirements.maxCost) return false;
        }
        
        if (requirements.minQuality && model.capabilities) {
          const taskCapability = model.capabilities[requirements.taskType as keyof typeof model.capabilities] || 0;
          if (taskCapability < requirements.minQuality) return false;
        }
        
        return true;
      })
      .sort((a, b) => {
        // Sort by cost efficiency (quality per dollar)
        const aCost = a.pricing ? (a.pricing.prompt + a.pricing.completion) / 2 : 1;
        const bCost = b.pricing ? (b.pricing.prompt + b.pricing.completion) / 2 : 1;
        const aQuality = a.capabilities?.reasoning || 50;
        const bQuality = b.capabilities?.reasoning || 50;
        
        return (bQuality / bCost) - (aQuality / aCost);
      });

    return candidates[0]?.id || 'openai/o4-mini';
  }
}