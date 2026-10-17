export type LLMRequest = {
  model?: string;
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
};
export type LLMResponse = {
  text: string;
  model: string;
  tokensUsed: number;
  latencyMs: number;
};
export type ProviderHealth = {
  provider: string;
  healthy: boolean;
  latencyMs: number;
};
export class RealLLMServiceV9 {
  async complete(req: LLMRequest): Promise<LLMResponse> {
    return { text: '', model: req.model || 'gpt-4.1', tokensUsed: 0, latencyMs: 0 };
  }
  async getProviderHealth(): Promise<ProviderHealth[]> {
    return [];
  }
}
