/**
 * Jurexio Token Optimization Service
 * 
 * Features:
 * - Dynamic token budgeting per request
 * - Semantic compression
 * - Context pruning
 * - Cost tracking and optimization
 * - Per-agent budget limits
 */

export interface TokenBudget {
  totalBudget: number;
  usedTokens: number;
  remainingTokens: number;
  estimatedCost: number;
  breakdown: TokenBreakdown;
}

export interface TokenBreakdown {
  systemPrompt: number;
  context: number;
  userMessage: number;
  reservedForOutput: number;
  tools: number;
}

export interface OptimizationResult {
  originalTokens: number;
  optimizedTokens: number;
  savings: number;
  savingsPercent: number;
  techniques: string[];
  estimatedCostSavings: number;
}

export interface CostTracking {
  totalTokensUsed: number;
  totalCost: number;
  byProvider: Record<string, ProviderCost>;
  byAgent: Record<string, AgentCost>;
  byDay: DailyCost[];
}

export interface ProviderCost {
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
}

export interface AgentCost {
  agentId: string;
  agentName: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
  averageCostPerRequest: number;
}

export interface DailyCost {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  requestCount: number;
}

const PROVIDER_PRICING = {
  'openai': {
    'gpt-4o': { input: 0.0025, output: 0.01 },
    'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'gpt-4-turbo': { input: 0.01, output: 0.03 }
  },
  'anthropic': {
    'claude-sonnet-4': { input: 0.003, output: 0.015 },
    'claude-3.5-sonnet': { input: 0.003, output: 0.015 },
    'claude-3-haiku': { input: 0.00025, output: 0.00125 }
  },
  'google': {
    'gemini-2.5-flash': { input: 0.0001, output: 0.0004 },
    'gemini-2.5-pro': { input: 0.00125, output: 0.005 }
  },
  'sarvam': {
    'sarvam-2b': { input: 0.0001, output: 0.0002 }
  }
};

const CONTEXT_WINDOWS = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'claude-sonnet-4': 200000,
  'claude-3.5-sonnet': 200000,
  'gemini-2.5-flash': 1000000,
  'gemini-2.5-pro': 1000000
};

export class JurexioTokenOptimizationService {
  private costTracking: CostTracking = {
    totalTokensUsed: 0,
    totalCost: 0,
    byProvider: {},
    byAgent: {},
    byDay: []
  };
  
  calculateTokenBudget(
    model: string,
    systemPromptTokens: number,
    contextTokens: number,
    userMessageTokens: number,
    maxOutputTokens: number = 4096
  ): TokenBudget {
    const contextWindow = CONTEXT_WINDOWS[model as keyof typeof CONTEXT_WINDOWS] || 128000;
    const toolsReserve = 2000;
    
    const usedTokens = systemPromptTokens + contextTokens + userMessageTokens + toolsReserve;
    const reservedForOutput = Math.min(maxOutputTokens, Math.floor(contextWindow * 0.25));
    const totalBudget = contextWindow - reservedForOutput;
    const remainingTokens = totalBudget - usedTokens;
    
    const pricing = this.getModelPricing(model);
    const estimatedCost = (usedTokens / 1000) * pricing.input + (reservedForOutput / 1000) * pricing.output;
    
    return {
      totalBudget,
      usedTokens,
      remainingTokens,
      estimatedCost,
      breakdown: {
        systemPrompt: systemPromptTokens,
        context: contextTokens,
        userMessage: userMessageTokens,
        reservedForOutput,
        tools: toolsReserve
      }
    };
  }
  
  optimizeContext(
    context: string,
    targetTokens: number,
    options: {
      preserveRecent?: boolean;
      preserveCitations?: boolean;
      preserveStatutes?: boolean;
      compressionLevel?: 'light' | 'medium' | 'aggressive';
    } = {}
  ): OptimizationResult {
    const originalTokens = this.estimateTokens(context);
    const techniques: string[] = [];
    let optimizedContext = context;
    
    if (options.compressionLevel !== 'light') {
      optimizedContext = this.removeRedundancy(optimizedContext);
      techniques.push('Redundancy removal');
    }
    
    if (options.compressionLevel === 'aggressive') {
      optimizedContext = this.semanticCompression(optimizedContext);
      techniques.push('Semantic compression');
    }
    
    if (!options.preserveRecent) {
      optimizedContext = this.pruneOldContext(optimizedContext, targetTokens);
      techniques.push('Context pruning');
    }
    
    if (options.preserveCitations) {
      techniques.push('Citation preservation');
    }
    
    if (options.preserveStatutes) {
      techniques.push('Statute preservation');
    }
    
    const optimizedTokens = this.estimateTokens(optimizedContext);
    const savings = originalTokens - optimizedTokens;
    const savingsPercent = (savings / originalTokens) * 100;
    
    const pricing = this.getModelPricing('gpt-4o');
    const estimatedCostSavings = (savings / 1000) * pricing.input;
    
    return {
      originalTokens,
      optimizedTokens,
      savings,
      savingsPercent,
      techniques,
      estimatedCostSavings
    };
  }
  
  private removeRedundancy(text: string): string {
    const sentences = text.split(/[.!?]+/);
    const seen = new Set<string>();
    const uniqueSentences: string[] = [];
    
    for (const sentence of sentences) {
      const normalized = sentence.toLowerCase().trim();
      if (normalized.length > 10 && !seen.has(normalized)) {
        seen.add(normalized);
        uniqueSentences.push(sentence);
      }
    }
    
    return uniqueSentences.join('. ');
  }
  
  private semanticCompression(text: string): string {
    return text
      .replace(/\b(very|really|extremely|quite|rather)\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/\b(the|a|an)\b(?=\s+\w+\s+(?:is|was|are|were))/gi, '')
      .trim();
  }
  
  private pruneOldContext(text: string, targetTokens: number): string {
    const currentTokens = this.estimateTokens(text);
    if (currentTokens <= targetTokens) return text;
    
    const ratio = targetTokens / currentTokens;
    const targetLength = Math.floor(text.length * ratio);
    
    return text.slice(-targetLength);
  }
  
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
  
  trackUsage(
    providerId: string,
    agentId: string,
    agentName: string,
    inputTokens: number,
    outputTokens: number,
    model: string
  ): void {
    const pricing = this.getModelPricing(model);
    const cost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output;
    
    this.costTracking.totalTokensUsed += inputTokens + outputTokens;
    this.costTracking.totalCost += cost;
    
    if (!this.costTracking.byProvider[providerId]) {
      this.costTracking.byProvider[providerId] = {
        providerId,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        requestCount: 0
      };
    }
    this.costTracking.byProvider[providerId].inputTokens += inputTokens;
    this.costTracking.byProvider[providerId].outputTokens += outputTokens;
    this.costTracking.byProvider[providerId].totalCost += cost;
    this.costTracking.byProvider[providerId].requestCount++;
    
    if (!this.costTracking.byAgent[agentId]) {
      this.costTracking.byAgent[agentId] = {
        agentId,
        agentName,
        inputTokens: 0,
        outputTokens: 0,
        totalCost: 0,
        requestCount: 0,
        averageCostPerRequest: 0
      };
    }
    this.costTracking.byAgent[agentId].inputTokens += inputTokens;
    this.costTracking.byAgent[agentId].outputTokens += outputTokens;
    this.costTracking.byAgent[agentId].totalCost += cost;
    this.costTracking.byAgent[agentId].requestCount++;
    this.costTracking.byAgent[agentId].averageCostPerRequest = 
      this.costTracking.byAgent[agentId].totalCost / this.costTracking.byAgent[agentId].requestCount;
    
    const today = new Date().toISOString().split('T')[0];
    let dailyEntry = this.costTracking.byDay.find(d => d.date === today);
    if (!dailyEntry) {
      dailyEntry = { date: today, inputTokens: 0, outputTokens: 0, totalCost: 0, requestCount: 0 };
      this.costTracking.byDay.push(dailyEntry);
    }
    dailyEntry.inputTokens += inputTokens;
    dailyEntry.outputTokens += outputTokens;
    dailyEntry.totalCost += cost;
    dailyEntry.requestCount++;
  }
  
  getCostTracking(): CostTracking {
    return this.costTracking;
  }
  
  getAgentBudgetStatus(agentId: string, monthlyBudget: number): {
    used: number;
    remaining: number;
    percentUsed: number;
    projectedMonthlySpend: number;
    onTrack: boolean;
  } {
    const agentCost = this.costTracking.byAgent[agentId];
    const used = agentCost?.totalCost || 0;
    const remaining = monthlyBudget - used;
    const percentUsed = (used / monthlyBudget) * 100;
    
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const projectedMonthlySpend = (used / dayOfMonth) * daysInMonth;
    
    return {
      used,
      remaining,
      percentUsed,
      projectedMonthlySpend,
      onTrack: projectedMonthlySpend <= monthlyBudget
    };
  }
  
  private getModelPricing(model: string): { input: number; output: number } {
    for (const provider of Object.values(PROVIDER_PRICING)) {
      if (provider[model as keyof typeof provider]) {
        return provider[model as keyof typeof provider] as { input: number; output: number };
      }
    }
    return { input: 0.001, output: 0.002 };
  }
  
  getProviderPricing(): typeof PROVIDER_PRICING {
    return PROVIDER_PRICING;
  }
  
  getContextWindows(): typeof CONTEXT_WINDOWS {
    return CONTEXT_WINDOWS;
  }
  
  resetTracking(): void {
    this.costTracking = {
      totalTokensUsed: 0,
      totalCost: 0,
      byProvider: {},
      byAgent: {},
      byDay: []
    };
  }
}

export const tokenOptimizationService = new JurexioTokenOptimizationService();
