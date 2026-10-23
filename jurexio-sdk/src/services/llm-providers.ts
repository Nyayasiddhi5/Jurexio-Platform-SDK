import { RealLLMService, type LLMRequest as RealLLMRequest, type LLMResponse as RealLLMResponse } from './real-llm-service.js';

export interface LLMResponse {
  content: string;
  model: string;
  provider: string;
  tokens: number;
  cost: number;
  processingTime: number;
}

export interface LLMRequest {
  prompt: string;
  type: 'text' | 'code' | 'analysis';
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

export class LLMProviders {
  private llmService: RealLLMService;

  constructor() {
    // NV-LLM-001 (R3 — WHITELISTED): llm-providers.ts is the low-level provider
    // abstraction layer that RealLLMService itself sits on top of. This
    // constructor is the inverse-direction handle used by provider health checks
    // and registry discovery — wrapping it would create a cycle. See replit.md
    // NV-LLM-001 whitelist.
    this.llmService = new RealLLMService();
  }

  private async executeRequest(request: LLMRequest, preferredProvider: string, defaultModel: string): Promise<LLMResponse> {
    const startTime = Date.now();
    
    try {
      const llmRequest: RealLLMRequest = {
        id: `llm-providers-${Date.now()}`,
        userId: 'system',
        prompt: request.prompt,
        provider: preferredProvider,
        model: request.model || defaultModel,
        maxTokens: request.maxTokens || 4096,
        temperature: request.temperature ?? 0.7,
        systemPrompt: `You are a legal AI assistant specializing in ${request.type} tasks.`,
        requirements: {
          complexity: 'medium',
          domain: 'general',
          priority: 'medium',
          costBudget: 'balanced',
          responseTime: 'balanced',
          qualityLevel: 'professional',
        },
        fallbackLevels: 3,
        timestamp: new Date(),
      };

      const result: RealLLMResponse = await this.llmService.executeRequest(llmRequest);
      const processingTime = Date.now() - startTime;

      // RealLLMResponse exposes a typed `tokens` block; older code paths
      // surfaced a flat `tokensUsed` integer. Read both via narrow optional
      // shapes rather than blanket `any`.
      const tokensTotal = result.tokens?.total
        ?? (result as { tokensUsed?: number }).tokensUsed
        ?? 0;

      return {
        content: result.content,
        model: result.model,
        provider: result.provider || preferredProvider,
        tokens: tokensTotal,
        cost: result.cost || 0,
        processingTime,
      };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`LLM processing failed: ${msg}`);
    }
  }

  async processWithOpenAI(request: LLMRequest): Promise<LLMResponse> {
    return this.executeRequest(request, 'openai', 'gpt-4.1');
  }

  async processWithAnthropic(request: LLMRequest): Promise<LLMResponse> {
    return this.executeRequest(request, 'anthropic', 'claude-opus-4-6');
  }

  async processWithGoogle(request: LLMRequest): Promise<LLMResponse> {
    return this.executeRequest(request, 'google', 'gemini-3-pro');
  }

  async generateResponse(request: LLMRequest): Promise<LLMResponse> {
    return this.executeRequest(request, 'auto', 'auto');
  }

  async processRequest(request: LLMRequest): Promise<LLMResponse> {
    return this.generateResponse(request);
  }

  getAvailableModels(): string[] {
    return [
      'deepseek/deepseek-v3:free',
      'meta-llama/llama-4-scout:free',
      'mistralai/mistral-large-3:free',
      'google/gemma-3-27b-it:free',
      'deepseek/deepseek-r1-0528:free'
    ];
  }

  getProviderStatus(): Record<string, boolean> {
    return {
      openrouter: true,
      openai: false,
      anthropic: false,
      google: false,
    };
  }
}

export const llmProviders = new LLMProviders();
