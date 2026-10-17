// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * Together AI Provider - Real API Integration
 * 
 * Implements comprehensive Together AI integration with:
 * - Open source models (LLaMA, Mistral, CodeLlama, etc.)
 * - Real-time streaming responses
 * - Advanced cost optimization
 * - Circuit breaker protection
 * - Direct Together AI API integration
 */

import { UnifiedLLMAdapter, type LLMProvider, type LLMRequest, type LLMResponse } from './unified-llm-adapter.js';
import { generateCorrelationId, createTimeoutController } from '../orchestration-utils.js';
import { ProviderError } from '../orchestration-errors.js';
import { createLogger } from '../../utils/logger.js';


const logger = createLogger('together-ai-provider');

export class TogetherAIProvider extends UnifiedLLMAdapter {
  private readonly models = {
    // Meta LLaMA Models
    'meta-llama/Llama-3.3-70B-Instruct-Turbo': { inputCost: 0.9, outputCost: 0.9, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo': { inputCost: 1.2, outputCost: 1.2, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo': { inputCost: 0.35, outputCost: 0.35, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/Llama-3.1-405B-Instruct-Turbo': { inputCost: 5.0, outputCost: 5.0, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/Llama-3.1-70B-Instruct-Turbo': { inputCost: 0.88, outputCost: 0.88, contextWindow: 131072, maxOutput: 8192 },
    'meta-llama/Llama-3.1-8B-Instruct-Turbo': { inputCost: 0.18, outputCost: 0.18, contextWindow: 131072, maxOutput: 8192 },
    
    // Code LLaMA Models
    'meta-llama/CodeLlama-70b-Instruct-hf': { inputCost: 0.9, outputCost: 0.9, contextWindow: 16384, maxOutput: 4096 },
    'meta-llama/CodeLlama-34b-Instruct-hf': { inputCost: 0.78, outputCost: 0.78, contextWindow: 16384, maxOutput: 4096 },
    'meta-llama/CodeLlama-13b-Instruct-hf': { inputCost: 0.22, outputCost: 0.22, contextWindow: 16384, maxOutput: 4096 },
    'meta-llama/CodeLlama-7b-Instruct-hf': { inputCost: 0.2, outputCost: 0.2, contextWindow: 16384, maxOutput: 4096 },
    
    // Mistral Models
    'mistralai/Mixtral-8x7B-Instruct-v0.1': { inputCost: 0.6, outputCost: 0.6, contextWindow: 32768, maxOutput: 4096 },
    'mistralai/Mixtral-8x22B-Instruct-v0.1': { inputCost: 1.2, outputCost: 1.2, contextWindow: 65536, maxOutput: 4096 },
    'mistralai/Mistral-7B-Instruct-v0.3': { inputCost: 0.2, outputCost: 0.2, contextWindow: 32768, maxOutput: 4096 },
    
    // Qwen Models
    'Qwen/Qwen2.5-72B-Instruct-Turbo': { inputCost: 1.2, outputCost: 1.2, contextWindow: 131072, maxOutput: 8192 },
    'Qwen/Qwen2.5-32B-Instruct-Turbo': { inputCost: 0.8, outputCost: 0.8, contextWindow: 131072, maxOutput: 8192 },
    'Qwen/Qwen2.5-14B-Instruct-Turbo': { inputCost: 0.3, outputCost: 0.3, contextWindow: 131072, maxOutput: 8192 },
    'Qwen/Qwen2.5-7B-Instruct-Turbo': { inputCost: 0.2, outputCost: 0.2, contextWindow: 131072, maxOutput: 8192 },
    
    // Anthropic Models (via Together)
    'anthropic/claude-3-5-sonnet': { inputCost: 3.0, outputCost: 15.0, contextWindow: 200000, maxOutput: 8192 },
    'anthropic/claude-3-opus': { inputCost: 15.0, outputCost: 75.0, contextWindow: 200000, maxOutput: 4096 },
    'anthropic/claude-3-haiku': { inputCost: 0.25, outputCost: 1.25, contextWindow: 200000, maxOutput: 4096 },
    
    // Specialized Models
    'google/gemma-2-27b-it': { inputCost: 0.8, outputCost: 0.8, contextWindow: 8192, maxOutput: 4096 },
    'google/gemma-2-9b-it': { inputCost: 0.3, outputCost: 0.3, contextWindow: 8192, maxOutput: 4096 },
    'microsoft/DialoGPT-medium': { inputCost: 0.1, outputCost: 0.1, contextWindow: 1024, maxOutput: 1024 },
    
    // Open Source Alternatives
    'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO': { inputCost: 0.6, outputCost: 0.6, contextWindow: 32768, maxOutput: 4096 },
    'NousResearch/Nous-Hermes-2-Mixtral-8x7B-SFT': { inputCost: 0.6, outputCost: 0.6, contextWindow: 32768, maxOutput: 4096 },
    'teknium/OpenHermes-2.5-Mistral-7B': { inputCost: 0.2, outputCost: 0.2, contextWindow: 8192, maxOutput: 4096 },
    
    // Image Generation Models
    'stabilityai/stable-diffusion-xl-base-1.0': { inputCost: 0, outputCost: 0, contextWindow: 0, maxOutput: 0 },
    'runwayml/stable-diffusion-v1-5': { inputCost: 0, outputCost: 0, contextWindow: 0, maxOutput: 0 },
    
    // Embedding Models  
    'sentence-transformers/all-MiniLM-L6-v2': { inputCost: 0.02, outputCost: 0, contextWindow: 256, maxOutput: 0 },
    'sentence-transformers/all-mpnet-base-v2': { inputCost: 0.02, outputCost: 0, contextWindow: 384, maxOutput: 0 }
  };

  constructor(apiKey?: string) {
    const provider: LLMProvider = {
      id: 'together-ai',
      name: 'Together AI',
      models: Object.keys(TogetherAIProvider.prototype.models),
      capabilities: {
        textGeneration: true,
        codeGeneration: true,
        imageGeneration: true,
        audioGeneration: false,
        speechToText: false,
        textToSpeech: false,
        multimodal: true, // LLaMA 3.2 Vision models
        functionCalling: true,
        streaming: true,
        embedding: true,
        reasoning: 90, // Average across all models
        creativity: 88,
        factualAccuracy: 89,
        codingProficiency: 93, // Strong with CodeLlama models
        multilingualSupport: ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'ko', 'zh', 'ar', 'hi', 'tr', 'nl']
      },
      pricing: {
        inputTokenCost: 0.9, // LLaMA 3.3 70B base price per 1M tokens
        outputTokenCost: 0.9, // LLaMA 3.3 70B base price per 1M tokens
        imageGenerationCost: 2, // Stable Diffusion XL per image
        embeddingCost: 0.02, // Sentence transformers per 1M tokens
        currency: 'USD',
        billingModel: 'pay-per-use',
        freeTierLimits: {
          tokensPerMonth: 1000000, // 1M tokens free tier
          requestsPerMinute: 60,
          requestsPerDay: 2000
        }
      },
      limits: {
        maxTokensPerRequest: 131072,
        maxRequestsPerMinute: 60,
        maxRequestsPerDay: 2000,
        maxConcurrentRequests: 10,
        contextWindow: 131072,
        timeoutMs: 120000
      },
      status: 'available',
      region: ['global'],
      apiVersion: 'v1',
      lastHealthCheck: new Date(),
      healthScore: 92
    };

    const key = apiKey || process.env.TOGETHER_API_KEY;
    if (!key) {
      throw new Error('Together AI API key is required (TOGETHER_API_KEY)');
    }

    super(provider, key, 'https://api.together.xyz');
    logger.info('✅ Together AI Provider initialized with real API integration');
  }

  protected getDefaultBaseUrl(): string {
    return 'https://api.together.xyz';
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
      logger.error('Together AI API key validation failed:', error);
      return false;
    }
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    const correlationId = request.correlationId || generateCorrelationId();
    const startTime = Date.now();

    try {
      // Validate model
      const modelConfig = this.models[(request.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo') as keyof typeof this.models];
      if (!modelConfig) {
        throw new ProviderError(`Model ${request.model} not supported by Together AI provider`);
      }

      // Rate limiting check
      await this.checkRateLimit();

      // Prepare request
      const apiRequest = this.prepareAPIRequest(request, modelConfig);
      
      // Execute request with timeout protection
      const timeoutController = createTimeoutController(this.provider.limits.timeoutMs);
      logger.info(`🤝 [${correlationId}] Sending request to Together AI: ${request.model}`);

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

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`Together AI API error: ${response.status} - ${errorText}`);
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
        id: responseData.id || `together-${Date.now()}`,
        content: responseData.choices?.[0]?.message?.content || '',
        model: request.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
        provider: 'together-ai',
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

      logger.info(`✅ [${correlationId}] Together AI response completed: ${responseTime}ms, $${cost.toFixed(6)}`);
      return llmResponse;

    } catch (error: any) {
      const responseTime = Date.now() - startTime;
      await this.updateHealthMetrics(false, responseTime);
      
      logger.error(`❌ [${correlationId}] Together AI request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`Together AI request failed: ${error}`);
    }
  }

  private prepareAPIRequest(request: LLMRequest, modelConfig: any): any {
    const model = request.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo';

    const apiRequest: Record<string, any> = {
      model: model,
      messages: request.messages.map(msg => ({
        role: msg.role,
        content: this.formatMessageContent(msg.content)
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
      apiRequest.stop = request.stopSequences;
    }

    // Add function calling for supported models
    if (request.tools?.length && this.supportsFeature('function-calling')) {
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

  private formatMessageContent(content: string | any[]): string | any {
    if (typeof content === 'string') {
      return content;
    }
    
    // Handle multimodal content for Vision models
    if (Array.isArray(content)) {
      // For Together AI, we may need to format multimodal content specifically
      const hasImage = content.some(item => item.type === 'image');
      if (hasImage) {
        return content; // Return as-is for multimodal
      } else {
        return content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
      }
    }
    
    return String(content);
  }

  private calculateProviderCost(promptTokens: number, completionTokens: number, modelConfig: any): number {
    const promptCost = (promptTokens / 1_000_000) * modelConfig.inputCost;
    const completionCost = (completionTokens / 1_000_000) * modelConfig.outputCost;
    return promptCost + completionCost;
  }

  private mapFinishReason(reason: string | undefined): LLMResponse['finishReason'] {
    switch (reason) {
      case 'stop':
      case 'eos':
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
      const modelConfig = this.models[(request.model || 'meta-llama/Llama-3.3-70B-Instruct-Turbo') as keyof typeof this.models];
      if (!modelConfig) {
        throw new ProviderError(`Model ${request.model} not supported by Together AI provider`);
      }

      await this.checkRateLimit();

      const apiRequest = this.prepareAPIRequest(request, modelConfig);
      apiRequest.stream = true;

      logger.info(`🤝 [${correlationId}] Starting streaming request to Together AI: ${request.model}`);

      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'Jurexio-DevStudio/1.0'
        },
        body: JSON.stringify(apiRequest)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`Together AI streaming API error: ${response.status} - ${errorText}`);
      }

      return this.parseStreamingResponse(response, correlationId);

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Together AI streaming request failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`Together AI streaming request failed: ${error}`);
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
              logger.info(`✅ [${correlationId}] Together AI streaming completed`);
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

  // Together AI specific features
  async generateImage(prompt: string, model: string = 'stabilityai/stable-diffusion-xl-base-1.0'): Promise<any> {
    const correlationId = generateCorrelationId();
    
    try {
      logger.info(`🎨 [${correlationId}] Generating image with Together AI: ${model}`);

      const response = await fetch(`${this.baseUrl}/v1/images/generations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          n: 1,
          size: "1024x1024",
          response_format: "url"
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`Together AI image generation error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as Record<string, any>;
      
      logger.info(`✅ [${correlationId}] Image generation completed`);
      return {
        url: result.data?.[0]?.url,
        model: model,
        prompt: prompt,
        provider: 'together-ai',
        correlationId
      };

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Together AI image generation failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`Together AI image generation failed: ${error}`);
    }
  }

  async generateEmbedding(text: string, model: string = 'sentence-transformers/all-MiniLM-L6-v2'): Promise<number[]> {
    const correlationId = generateCorrelationId();
    
    try {
      logger.info(`🔢 [${correlationId}] Generating embedding with Together AI: ${model}`);

      const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          input: text
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new ProviderError(`Together AI embedding error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as Record<string, any>;
      
      logger.info(`✅ [${correlationId}] Embedding generation completed`);
      return result.data?.[0]?.embedding || [];

    } catch (error: any) {
      logger.error(`❌ [${correlationId}] Together AI embedding generation failed:`, error);
      throw error instanceof ProviderError ? error : new ProviderError(`Together AI embedding generation failed: ${error}`);
    }
  }

  getModelInfo(model: string) {
    const config = this.models[model as keyof typeof this.models];
    if (!config) {
      throw new ProviderError(`Model ${model} not found in Together AI provider`);
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
    if (model.includes('Llama-3.3')) {
      return 'Latest LLaMA 3.3 with enhanced reasoning via Together AI';
    } else if (model.includes('Llama-3.2')) {
      return 'LLaMA 3.2 with vision capabilities via Together AI';
    } else if (model.includes('Llama-3.1')) {
      return 'LLaMA 3.1 with extended context via Together AI';
    } else if (model.includes('CodeLlama')) {
      return 'Specialized Code LLaMA for programming via Together AI';
    } else if (model.includes('Mixtral')) {
      return 'Mistral Mixtral mixture of experts model via Together AI';
    } else if (model.includes('Qwen')) {
      return 'Qwen multilingual model via Together AI';
    } else if (model.includes('claude')) {
      return 'Anthropic Claude model via Together AI';
    } else if (model.includes('stable-diffusion')) {
      return 'Stable Diffusion image generation model via Together AI';
    } else if (model.includes('sentence-transformers')) {
      return 'Sentence transformer embedding model via Together AI';
    } else {
      return 'Open source model hosted on Together AI platform';
    }
  }

  private getModelCapabilities(model: string): string[] {
    const capabilities = ['text-generation', 'conversation', 'instruction-following'];
    
    if (model.includes('CodeLlama') || model.includes('code')) {
      capabilities.push('code-generation', 'code-completion', 'debugging');
    }
    
    if (model.includes('Vision') || model.includes('vision')) {
      capabilities.push('vision', 'multimodal', 'image-analysis');
    }
    
    if (model.includes('stable-diffusion')) {
      capabilities.splice(0); // Clear text capabilities
      capabilities.push('image-generation', 'art-creation', 'visual-design');
    }
    
    if (model.includes('sentence-transformers')) {
      capabilities.splice(0); // Clear text capabilities
      capabilities.push('embeddings', 'semantic-search', 'similarity');
    }
    
    if (model.includes('Mixtral') || model.includes('Qwen')) {
      capabilities.push('multilingual', 'reasoning', 'analysis');
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
      'image-generation',
      'embeddings',
      'streaming',
      'function-calling',
      'conversation',
      'instruction-following',
      'multilingual',
      'vision',
      'multimodal'
    ];
    
    return supportedFeatures.includes(feature);
  }

  // Get models by category
  getModelsByCategory(category: 'text' | 'code' | 'vision' | 'image' | 'embedding'): string[] {
    const models = Object.keys(this.models);
    
    switch (category) {
      case 'text':
        return models.filter(m => 
          !m.includes('CodeLlama') && 
          !m.includes('Vision') && 
          !m.includes('stable-diffusion') && 
          !m.includes('sentence-transformers')
        );
      case 'code':
        return models.filter(m => m.includes('CodeLlama') || m.includes('code'));
      case 'vision':
        return models.filter(m => m.includes('Vision') || m.includes('vision'));
      case 'image':
        return models.filter(m => m.includes('stable-diffusion'));
      case 'embedding':
        return models.filter(m => m.includes('sentence-transformers'));
      default:
        return models;
    }
  }
}