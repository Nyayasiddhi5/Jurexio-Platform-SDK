/**
 * jrx-llm-pricing.ts — simple per-model USD/1k-token price table used by
 * jrx-usage-metering-middleware and the cost-optimizer suggester.
 *
 * Values are intentionally rough public-list prices (2025-Q4 snapshot). They
 * are NOT a billing source of truth — billing is computed from
 * `nv_router_decisions.cost_usd` written by the LLM router. This table only
 * powers gateway-side estimation when the router did not stamp a cost.
 *
 * Add new models additively; default() falls back to the `default` row.
 *
 * NV-NAMING-001: jrx- prefix.
 */

export interface ModelPrice {
  in: number;   // USD per 1k input tokens
  out: number;  // USD per 1k output tokens
}

export const MODEL_PRICING_USD_PER_1K: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-4o':            { in: 0.0025,   out: 0.0100 },
  'gpt-4o-mini':       { in: 0.00015,  out: 0.00060 },
  'gpt-4-turbo':       { in: 0.0100,   out: 0.0300 },
  'gpt-4':             { in: 0.0300,   out: 0.0600 },
  'gpt-3.5-turbo':     { in: 0.00050,  out: 0.00150 },
  // Anthropic
  'claude-3-5-sonnet': { in: 0.0030,   out: 0.0150 },
  'claude-3-opus':     { in: 0.0150,   out: 0.0750 },
  'claude-3-haiku':    { in: 0.00025,  out: 0.00125 },
  // Google
  'gemini-1.5-pro':    { in: 0.00125,  out: 0.0050 },
  'gemini-1.5-flash':  { in: 0.000075, out: 0.00030 },
  'gemini-2.5-flash':  { in: 0.000075, out: 0.00030 },
  'gemini-2.5-pro':    { in: 0.00125,  out: 0.0050 },
  // Groq / OSS
  'llama-3.1-70b':     { in: 0.00059,  out: 0.00079 },
  'llama-3.1-8b':      { in: 0.00005,  out: 0.00008 },
  'mixtral-8x7b':      { in: 0.00027,  out: 0.00027 },
  // Sarvam (India-domain)
  'sarvam-2b':         { in: 0.00010,  out: 0.00030 },
  'sarvam-m':          { in: 0.00020,  out: 0.00060 },
  // OpenRouter typical pass-through
  'openrouter:auto':   { in: 0.00100,  out: 0.00300 },
  // Bedrock
  'titan-text-express': { in: 0.00080, out: 0.00160 },
  // Fallback when model is unknown
  default:             { in: 0.00050,  out: 0.00150 },
};

/** Normalize a model identifier to its price-table key. */
export function normalizeModel(raw: string | undefined | null): string {
  if (!raw) return 'unknown';
  const m = String(raw).toLowerCase().trim();
  // Strip provider prefix (e.g. "openai/gpt-4o" → "gpt-4o").
  const stripped = m.includes('/') ? m.split('/').slice(-1)[0] : m;
  // Strip date suffixes (e.g. "gpt-4o-2024-08-06" → "gpt-4o").
  return stripped.replace(/-\d{4}-\d{2}-\d{2}$/, '');
}

/** USD price for a (model, tokensIn, tokensOut) tuple. */
export function priceUsd(model: string, tokensIn: number, tokensOut: number): number {
  const key = normalizeModel(model);
  const row = MODEL_PRICING_USD_PER_1K[key] ?? MODEL_PRICING_USD_PER_1K.default;
  const cost = (tokensIn / 1000) * row.in + (tokensOut / 1000) * row.out;
  return Math.round(cost * 1e6) / 1e6;
}

/**
 * For a given (model, tokensIn, tokensOut), suggest the cheapest model
 * within the same family/tier whose cost would be lower. Used by the
 * cost-optimizer suggester.
 */
export function suggestCheaperModel(
  model: string,
  tokensIn: number,
  tokensOut: number,
): { model: string; estCost: number; savingPct: number } | null {
  const here = priceUsd(model, tokensIn, tokensOut);
  if (here <= 0) return null;
  const candidates = ['gemini-1.5-flash', 'gemini-2.5-flash', 'gpt-4o-mini', 'claude-3-haiku', 'llama-3.1-8b'];
  let best: { model: string; estCost: number } | null = null;
  for (const c of candidates) {
    if (normalizeModel(c) === normalizeModel(model)) continue;
    const cost = priceUsd(c, tokensIn, tokensOut);
    if (cost > 0 && cost < here && (!best || cost < best.estCost)) {
      best = { model: c, estCost: cost };
    }
  }
  if (!best) return null;
  const savingPct = Math.round(((here - best.estCost) / here) * 100);
  if (savingPct < 20) return null;
  return { ...best, savingPct };
}
