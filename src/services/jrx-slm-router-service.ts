import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-slm-router-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

interface SlmResult {
  text: string;
  confidence: number;
  tokens: number;
  model: string;
  tier: 1;
}

interface SlmAvailability {
  jurisdiction: JurisdictionCode;
  available: boolean;
  model?: string;
  endpoint?: string;
  confidenceThreshold?: number;
}

const SLM_MODELS: Record<JurisdictionCode, string> = {
  'IN': process.env.NYV_SLM_MODEL_IN || 'sarvam-2b',
  'UK': process.env.NYV_SLM_MODEL_UK || 'phi-3.5-mini',
  'EU': process.env.NYV_SLM_MODEL_EU || 'mistral-7b-legal',
  'US': process.env.NYV_SLM_MODEL_US || 'llama-3.1-8b',
  'GCC': process.env.NYV_SLM_MODEL_GCC || 'acegpt-7b',
  'SG': process.env.NYV_SLM_MODEL_SG || 'phi-3.5-mini',
};

const SLM_CONFIDENCE_THRESHOLD = parseFloat(process.env.NYV_SLM_CONFIDENCE_THRESHOLD || '0.75');

class NvSlmRouterService {
  async isSlmAvailable(jurisdiction: JurisdictionCode): Promise<boolean> {
    const endpoint = process.env[`SLM_ENDPOINT_${jurisdiction}`];
    return !!endpoint;
  }

  async getSlmAvailability(jurisdiction: JurisdictionCode): Promise<SlmAvailability> {
    const endpoint = process.env[`SLM_ENDPOINT_${jurisdiction}`];
    return {
      jurisdiction,
      available: !!endpoint,
      model: SLM_MODELS[jurisdiction],
      endpoint: endpoint || undefined,
      confidenceThreshold: SLM_CONFIDENCE_THRESHOLD,
    };
  }

  async callSlm(
    jurisdiction: JurisdictionCode,
    query: string,
    context: string
  ): Promise<SlmResult | { available: false }> {
    const endpoint = process.env[`SLM_ENDPOINT_${jurisdiction}`];
    if (!endpoint) {
      logger.info({ method: 'callSlm', jurisdiction, status: 'not_available' });
      return { available: false };
    }

    logger.info({ method: 'callSlm', jurisdiction, model: SLM_MODELS[jurisdiction] });

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, context, jurisdiction }),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        logger.warn({ method: 'callSlm', jurisdiction, status: response.status });
        return { available: false };
      }

      const data = await response.json() as { text: string; confidence: number; tokens: number };
      return {
        text: data.text,
        confidence: data.confidence,
        tokens: data.tokens || 0,
        model: SLM_MODELS[jurisdiction],
        tier: 1,
      };
    } catch (error: any) {
      logger.error({ method: 'callSlm', jurisdiction, error: (error as Error).message });
      return { available: false };
    }
  }

  async resolveWithFallback(
    jurisdiction: JurisdictionCode,
    query: string,
    context: string
  ): Promise<{ result: string; source: 'slm' | 'llm'; tier: 1 | 2 | 3; confidence: number }> {
    const slmResult = await this.callSlm(jurisdiction, query, context);

    if ('available' in slmResult && slmResult.available === false) {
      return {
        result: '[Fallback to LLM — SLM not available]',
        source: 'llm',
        tier: 2,
        confidence: 0,
      };
    }

    const result = slmResult as SlmResult;
    if (result.confidence < SLM_CONFIDENCE_THRESHOLD) {
      logger.info({ method: 'resolveWithFallback', jurisdiction, slmConfidence: result.confidence, action: 'falling_back_to_llm' });
      return {
        result: '[Fallback to LLM — SLM confidence below threshold]',
        source: 'llm',
        tier: 2,
        confidence: result.confidence,
      };
    }

    return {
      result: result.text,
      source: 'slm',
      tier: 1,
      confidence: result.confidence,
    };
  }
}

export const nvSlmRouterService = new NvSlmRouterService();
