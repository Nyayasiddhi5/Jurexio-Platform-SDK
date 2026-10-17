export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'sarvam';
export type LLMModel = string;
export type RoutingRequest = {
  task: string;
  preferredProvider?: LLMProvider;
  jurisdiction?: string;
  language?: string;
};
export class LLMRoutingEngine {
  async route(req: RoutingRequest): Promise<{ provider: LLMProvider; model: LLMModel }> {
    return { provider: 'openai', model: 'gpt-4.1' };
  }
}
