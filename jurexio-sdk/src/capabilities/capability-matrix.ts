export type ModelCapability = {
  model: string;
  maxTokens: number;
  supportsTools: boolean;
  supportedLanguages: string[];
};
export type ProviderCapability = {
  provider: string;
  models: ModelCapability[];
  healthy: boolean;
};
export class CapabilityMatrixManager {
  getCapabilities(): ProviderCapability[] {
    return [];
  }
}
