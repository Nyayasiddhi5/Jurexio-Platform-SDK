// JRX-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * DeepSeek Provider - Real API Integration
 * 
 * Implements comprehensive DeepSeek integration with:
 * - DeepSeek V3.2 Speciale, DeepSeek-V3, DeepSeek-R1 model support
 * - DeepSeek-Coder specialized models
 * - Real-time streaming responses
 * - Advanced cost optimization
 * - Circuit breaker protection
 * - Direct DeepSeek API integration
 */

import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('deepseek-provider');

export class DeepSeekProvider extends UnifiedLLMAdapter {
  private readonly models = {
    // NOTE: deepseek-v3.2-speciale is an UNOFFICIAL/UNVERIFIED API ID — use deepseek-v3 for production
    // 'deepseek-v3.2-speciale': { inputCost: 0.55, outputCost: 2.19, contextWindow: 1000000, maxOutput: 16384, isLatest: true },
    
    // DeepSeek V3 Series
    'deepseek-v3': { inputCost: 0.27, outputCost: 1.10, contextWindow: 1000000, maxOutput: 8192, isLatest: true },
    'deepseek-v3-0324': { inputCost: 0.27, outputCost: 1.10, contextWindow: 1000000, maxOutput: 8192, isLatest: true },
    
    // DeepSeek R1 - Reasoning model
    'deepseek-r1': { inputCost: 0.55, outputCost: 2.19, contextWindow: 164000, maxOutput: 8192, isLatest: true },
    
    // Legacy: DeepSeek V2.5 Series
    'deepseek-v2.5': { inputCost: 0.14, outputCost: 0.28, contextWindow: 32768, maxOutput: 8192 },
    'deepseek-v2.5-1210': { inputCost: 0.14, outputCost: 0.28, contextWindow: 32768, maxOutput: 8192 },
    
    // Legacy: DeepSeek Coder Series
    'deepseek-coder-v2-instruct': { inputCost: 0.14, outputCost: 0.28, contextWindow: 128000, maxOutput: 8192 },
    'deepseek-coder-v2-lite-instruct': { inputCost: 0.14, outputCost: 0.28, contextWindow: 128000, maxOutput: 8192 },
    
    // Legacy: DeepSeek Chat Series
    'deepseek-chat': { inputCost: 0.14, outputCost: 0.28, contextWindow: 32768, maxOutput: 4096 },
    
    // Legacy: DeepSeek Math Series
    'deepseek-math-instruct': { inputCost: 0.14, outputCost: 0.28, contextWindow: 32768, maxOutput: 4096 },
    
    // Legacy Models
    'deepseek-v2': { inputCost: 0.14, outputCost: 0.28, contextWindow: 32768, maxOutput: 4096 },
    'deepseek-coder-instruct': { inputCost: 0.14, outputCost: 0.28, contextWindow: 16384, maxOutput: 4096 }
  };

  private readonly baseUrl = 'https://api.deepseek.com';

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'deepseek',
      name: 'DeepSeek',
      models: Object.keys(DeepSeekProvider.prototype.models),
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
        embedding: false,
        reasoning: 94, // DeepSeek excels at reasoning and math
        creativity: 85,
        factualAccuracy: 92,
        codingProficiency: 98, // DeepSeek-Coder specialization
        multilingualSupport: ['en', 'zh', 'ja', 'ko', 'es', 'fr', 'de', 'ru', 'pt', 'it']
      },
      pricing: {
        inputTokenCost: 0.27, // DeepSeek V3 base price per 1M tokens
        outputTokenCost: 1.10, // DeepSeek V3 base price per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 10000000, // 10M tokens free tier
          requestsPerMinute: 60,
          requestsPerDay: 2000
        }
      },
      limits: {
        maxTokensPerRequest: 128000,
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 2000,
        maxConcurrentRequests: 10,
        contextWindow: 128000,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 95
    };

    const key = apiKey || process.env.DEEPSEEK_API_KEY;
    if (!key) {
      throw new Error('DeepSeek API key is required (DEEPSEEK_API_KEY)');
    }

    super(provider, key, 'https://api.deepseek.com');
    logger.info('✅ DeepSeek Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.deepseek.com';
  }

  protected async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      return response.ok;
    } catch (error: any) {
      logger.error('DeepSeek API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();

    try {
      // Validate model
      const modelConfig = this.models[request.model || 'deepseek-v3'];
      if (!modelConfig) {
        throw new ProviderError(`Model ${request.model} not supported by DeepSeek provider`);
      }

      // Rate limiting check
      await this.checkRateLimit();

      // Prepare request
      const apiRequest = this.prepareAPIRequest(request, modelConfig);
      
      // Execute request with timeout protection
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);
      logger.info(`🧠 [${correlationId}] Sending request to DeepSeek: ${request.model}`);

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Jurexio-DevStudio/1.0'
        },
        body: JSON.stringify(apiRequest),
        signal: timeoutController.signal
      });

      if (response.ok === false) {
        const errorText = await response.text();
        throw new ProviderError(`DeepSeek API error: ${response.status} - ${errorText}`);
      }

      const responseData = await response.json();
      const responseTime = Date.now() - startTime;

      // Calculate cost
      // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
      const usage = responseData.usage || {};
      const cost = this.calculateCost(
        usage.prompt_tokens || 0,
        usage.completion_tokens || 0,
        modelConfig
      );

      // Build response
      const llmResponse: LLMResponse = {
        // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
        id: responseData.id || `deepseek-${Date.now()}`,
        // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
        content: responseData.choices?.[0]?.message?.content || '',
        model: request.model || 'deepseek-v3',
        provider: 'deepseek',
        usage: {
          promptTokens: usage.prompt_tokens || 0,
          completionTokens: usage.completion_tokens || 0,
          totalTokens: usage.total_tokens || 0
        },
        cost,
        responseTime,
        // @ts-expect-error NV-TS230 legacy typing gap (TS18046)
        finishReason: this.mapFinishReason(responseData.choices?.[0]?.finish_reason),
        correlationId,
        timestamp: new Date()
      };

      // Update provider health metrics
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      await this.updateHealthMetrics(true, responseTime, cost);

      logger.info(`✅ [${correlationId}] DeepSeek response completed: ${responseTime}ms, $${cost.toFixed(6)}`);
      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      // @ts-expect-error NV-TS230 legacy typing gap (TS2554)
      await this.updateHealthMetrics(false, responseTime, 0);
      
      logger.error(`❌ [${correlationId}] DeepSeek request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`DeepSeek request failed: ${error}`);
    }
  }

  private prepareAPIRequest(request: LLMRequest, modelConfig: any): any {
    const model = request.model || 'deepseek-v3';

    const apiRequest = {
      model: model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)
      })),
      temperature: request.temperature !== undefined ? request.temperature : 0.7,
      max_tokens: Math.min(request.maxTokens || 2048, modelConfig.maxOutput),
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
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      apiRequest.stop = request.stopSequences;
    }

    // Add function calling for supported models
    if (request.tools?.length && this.supportsFeature('function-calling')) {
      // @ts-expect-error NV-TS230 legacy typing gap (TS2339)
      apiRequest.tools = request.tools.map(tool => ({
        type: 'function',
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters
        }
      }));
    }

    return apiRequest;
  }

  // @ts-expect-error NV-TS230 legacy typing gap (TS2416)
  private calculateCost(promptTokens: number, completionTokens: number, modelConfig: any): number {
    const promptCost = (promptTokens / 1_000_000) * modelConfig.inputCost;
    const completionCost = (completionTokens / 1_000_000) * modelConfig.outputCost;
    return promptCost + completionCost;
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
      const modelConfig = this.models[request.model || 'deepseek-v3'];
      if (!modelConfig) {
        throw new ProviderError(`Model ${request.model} not supported by DeepSeek provider`);
      }

      await this.checkRateLimit();

      const apiRequest = this.prepareAPIRequest(request, modelConfig);
      apiRequest.stream = true;

      logger.info(`🧠 [${correlationId}] Starting streaming request to DeepSeek: ${request.model}`);

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Jurexio-DevStudio/1.0'
        },
        body: JSON.stringify(apiRequest)
      });

      if (response.ok === false) {
        const errorText = await response.text();
        throw new ProviderError(`DeepSeek streaming API error: ${response.status} - ${errorText}`);
      }

      return this.parseStreamingResponse(response, correlationId);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] DeepSeek streaming request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`DeepSeek streaming request failed: ${error}`);
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
              logger.info(`✅ [${correlationId}] DeepSeek streaming completed`);
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

  // @ts-expect-error NV-TS230 legacy typing gap (TS2416)
  async performHealthCheck(): Promise<boolean> {
    try {
      const testRequest: LLMRequest = {
        messages: [{ role: 'user', content: 'Hello, respond with "OK"' }],
        model: 'deepseek-chat',
        maxTokens: 10,
        temperature: 0
      };

      const response = await this.generateResponse(testRequest);
      return response.content.toLowerCase().includes('ok');
    } catch (error: any) {
      logger.error('DeepSeek health check failed:', error);
      return false;
    }
  }

  getModelInfo(model: string) {
    const config = this.models[model];
    if (!config) {
      throw new ProviderError(`Model ${model} not found in DeepSeek provider`);
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
    if (model.includes('v3')) {
      return 'Latest DeepSeek V3 with enhanced reasoning and mathematical capabilities';
    } else if (model.includes('v2.5')) {
      return 'DeepSeek V2.5 with improved performance and efficiency';
    } else if (model.includes('coder')) {
      return 'Specialized DeepSeek-Coder for programming and software development';
    } else if (model.includes('math')) {
      return 'DeepSeek-Math specialized for mathematical reasoning and problem solving';
    } else if (model.includes('chat')) {
      return 'DeepSeek Chat model optimized for conversational interactions';
    } else {
      return 'DeepSeek model for general text generation and reasoning';
    }
  }

  private getModelCapabilities(model: string): string[] {
    const capabilities = ['text-generation', 'conversation', 'instruction-following', 'reasoning'];
    
    if (model.includes('coder')) {
      capabilities.push('code-generation', 'code-completion', 'debugging', 'code-analysis');
    }
    
    if (model.includes('math')) {
      capabilities.push('mathematical-reasoning', 'problem-solving', 'equation-solving');
    }
    
    if (model.includes('v3') || model.includes('v2.5')) {
      capabilities.push('advanced-reasoning', 'logical-thinking', 'analysis');
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
      'reasoning',
      'mathematical-reasoning'
    ];
    
    return supportedFeatures.includes(feature);
  }

  // DeepSeek-specific features
  async generateMathSolution(problem: string, model: string = 'deepseek-math-instruct'): Promise<LLMResponse> {
    const request: LLMRequest = {
      messages: [
        {
          role: 'system',
          content: 'You are a mathematical reasoning expert. Solve the given problem step by step with clear explanations.'
        },
        {
          role: 'user',
          content: problem
        }
      ],
      model,
      temperature: 0,
      maxTokens: 4096
    };

    return await this.generateResponse(request);
  }

  async generateCodeSolution(task: string, language: string = 'python', model: string = 'deepseek-coder-v2-instruct'): Promise<LLMResponse> {
    const request: LLMRequest = {
      messages: [
        {
          role: 'system',
          content: `You are an expert ${language} programmer. Write clean, efficient, and well-documented code.`
        },
        {
          role: 'user',
          content: `Task: ${task}\n\nProvide a complete solution in ${language}.`
        }
      ],
      model,
      temperature: 0.1,
      maxTokens: 8192
    };

    return await this.generateResponse(request);
  }

  async analyzeCode(code: string, language: string = 'auto', model: string = 'deepseek-coder-v2-instruct'): Promise<LLMResponse> {
    const request: LLMRequest = {
      messages: [
        {
          role: 'system',
          content: 'You are a code analysis expert. Analyze the given code for quality, performance, security issues, and suggest improvements.'
        },
        {
          role: 'user',
          content: `Language: ${language}\n\nCode:\n\`\`\`\n${code}\n\`\`\`\n\nProvide a detailed analysis.`
        }
      ],
      model,
      temperature: 0,
      maxTokens: 4096
    };

    return await this.generateResponse(request);
  }
}