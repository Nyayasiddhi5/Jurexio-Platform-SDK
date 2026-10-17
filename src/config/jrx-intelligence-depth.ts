/**
 * NV-INTEL-DEPTH-001 — Canonical intelligence depth tiers for DMS / Word / EDJ / gateway.
 * Concise | detailed | comprehensive (aliases: brief/short, standard/medium, long/full).
 */
export type NvIntelligenceDepth = 'concise' | 'detailed' | 'comprehensive';

export type NvSubscriptionTierHint = 'free' | 'starter' | 'pro' | 'enterprise' | 'internal';

const ALIASES: Record<string, NvIntelligenceDepth> = {
  concise: 'concise',
  brief: 'concise',
  short: 'concise',
  detailed: 'detailed',
  standard: 'detailed',
  medium: 'detailed',
  comprehensive: 'comprehensive',
  long: 'comprehensive',
  full: 'comprehensive',
};

/** Word targets for summarization prompts. */
export const DEPTH_WORD_LIMITS: Record<NvIntelligenceDepth, number> = {
  concise: 150,
  detailed: 400,
  comprehensive: 800,
};

/** Legacy gateway detailLevel mapping. */
export function depthToLegacyDetailLevel(
  depth: NvIntelligenceDepth,
): 'brief' | 'standard' | 'detailed' {
  if (depth === 'concise') return 'brief';
  if (depth === 'comprehensive') return 'detailed';
  return 'standard';
}

/** Docs-pipeline length mapping. */
export function depthToPipelineLength(
  depth: NvIntelligenceDepth,
): 'short' | 'medium' | 'long' {
  if (depth === 'concise') return 'short';
  if (depth === 'comprehensive') return 'long';
  return 'medium';
}

export function parseIntelligenceDepth(
  raw: unknown,
  fallback: NvIntelligenceDepth = 'detailed',
): NvIntelligenceDepth {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const key = raw.trim().toLowerCase();
  return ALIASES[key] ?? fallback;
}

/**
 * Resolve depth from body fields: depth | detailLevel | length | verbosity.
 */
export function resolveIntelligenceDepth(
  body: Record<string, unknown> | undefined | null,
  fallback: NvIntelligenceDepth = 'detailed',
): NvIntelligenceDepth {
  if (!body) return fallback;
  return parseIntelligenceDepth(
    body.depth ?? body.detailLevel ?? body.length ?? body.verbosity,
    fallback,
  );
}

/** Tier gate — returns null if allowed, else error message. */
export function depthDeniedForTier(
  depth: NvIntelligenceDepth,
  tier: NvSubscriptionTierHint | string | undefined,
): string | null {
  if (process.env.NYV_ENFORCE_DEPTH_TIERS !== '1') return null;
  const t = String(tier ?? 'pro').toLowerCase();
  if (depth === 'comprehensive' && (t === 'free' || t === 'starter')) {
    return 'comprehensive depth requires pro or enterprise tier';
  }
  if (depth === 'detailed' && t === 'free') {
    return 'detailed depth requires starter tier or higher';
  }
  return null;
}

export function depthSystemHint(depth: NvIntelligenceDepth, documentType?: string): string {
  const doc = documentType ? ` Document type: ${documentType}.` : '';
  if (depth === 'concise') {
    return `Produce a concise legal output (≈${DEPTH_WORD_LIMITS.concise} words). Only critical facts, parties, and risks.${doc}`;
  }
  if (depth === 'comprehensive') {
    return `Produce a comprehensive legal analysis (≈${DEPTH_WORD_LIMITS.comprehensive}+ words). Cover clauses, obligations, dates, money, risks, missing terms, and jurisdiction notes.${doc}`;
  }
  return `Produce a detailed legal output (≈${DEPTH_WORD_LIMITS.detailed} words). Include parties, key obligations, dates, and material risks.${doc}`;
}

/** EDJ analysis breadth boost for comprehensive depth. */
export function depthAnalysisFlags(depth: NvIntelligenceDepth): {
  generateSummary: boolean;
  extractClauses: boolean;
  extractObligations: boolean;
  extractRisks: boolean;
  extractMissingTerms: boolean;
  extractPrivacy: boolean;
} {
  if (depth === 'concise') {
    return {
      generateSummary: true,
      extractClauses: false,
      extractObligations: false,
      extractRisks: true,
      extractMissingTerms: false,
      extractPrivacy: false,
    };
  }
  if (depth === 'comprehensive') {
    return {
      generateSummary: true,
      extractClauses: true,
      extractObligations: true,
      extractRisks: true,
      extractMissingTerms: true,
      extractPrivacy: true,
    };
  }
  return {
    generateSummary: true,
    extractClauses: true,
    extractObligations: true,
    extractRisks: true,
    extractMissingTerms: false,
    extractPrivacy: false,
  };
}
