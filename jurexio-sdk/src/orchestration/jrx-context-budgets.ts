/**
 * NV-CTX-BUDGET-001 — complexity-aware Memory ∥ RAG budgets.
 *
 * Pillars: (1) cost — simple paths retrieve less; (2) speed — wall timeout
 * aborts slow recall; (3) quality — complex/legal-depth keeps full fan-in.
 *
 * Used by Queen Step-0 and specialist jrx-client parallel hot path.
 */
export type ContextComplexity = 'simple' | 'moderate' | 'complex' | 'very_complex';

export interface ContextBudgets {
  complexity: ContextComplexity;
  memoryLimit: number;
  memoryMaxHops: number;
  memorySlice: number;
  memoryCharCap: number;
  memorySources: 'session' | 'session+longterm' | 'full';
  ragTopK: number;
  /**
   * NV-RAG-CHAR-BUDGET-001: per-chunk and total character ceilings for injected
   * RAG context.
   *
   * `ragTopK` bounded how MANY chunks were retrieved but nothing bounded how
   * LARGE each one was, so `formatAutoRagContext` interpolated `chunk.content`
   * raw. Measured worst case on the partner floor (`JRX_PARTNER_RAG_TOP_K`=16 for
   * NSP/NYM) with judgment-length excerpts (~4,500 chars) is ~18,000 tokens of
   * retrieval alone — 7.2x the `chat` prompt budget and 2.3x `research`. Memory
   * was already capped by `memoryCharCap`; retrieval was the asymmetry.
   */
  ragChunkCharCap: number;
  ragTotalCharCap: number;
  /** Wall-clock for the parallel memory∥RAG Promise.race (ms). */
  parallelTimeoutMs: number;
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function normalizeContextComplexity(c?: string | null): ContextComplexity {
  const v = String(c || 'moderate').toLowerCase();
  if (v === 'simple' || v === 'moderate' || v === 'complex' || v === 'very_complex') return v;
  if (v === 'very complex' || v === 'expert') return 'very_complex';
  return 'moderate';
}

export interface ContextBudgetOpts {
  /** NSP/NYM best-outcome — raise RAG floor (env JRX_PARTNER_RAG_TOP_K, default 16). */
  partnerBestOutcome?: boolean;
  /** NV-SLA-FAST-CTX-001 — explicit `-fast` / Hub SLA tasks skip the partner RAG floor. */
  partnerSlaFast?: boolean;
}

/**
 * Resolve budgets from AdaptiveRouter / Queen complexity assessment.
 */
export function resolveContextBudgets(
  complexity?: string | null,
  opts?: ContextBudgetOpts,
): ContextBudgets {
  const c = normalizeContextComplexity(complexity);
  let budgets: ContextBudgets;
  switch (c) {
    case 'simple':
      budgets = {
        complexity: c,
        memoryLimit: envInt('JRX_CTX_MEM_LIMIT_SIMPLE', 3),
        memoryMaxHops: 1,
        memorySlice: 3,
        memoryCharCap: 280,
        memorySources: 'session',
        ragTopK: envInt('JRX_CTX_RAG_TOPK_SIMPLE', 4),
        ragChunkCharCap: envInt('JRX_CTX_RAG_CHUNK_CHARS_SIMPLE', 900),
        ragTotalCharCap: envInt('JRX_CTX_RAG_TOTAL_CHARS_SIMPLE', 3_600),
        parallelTimeoutMs: envInt('JRX_CTX_PARALLEL_TIMEOUT_SIMPLE_MS', 8_000),
      };
      break;
    case 'complex':
      budgets = {
        complexity: c,
        memoryLimit: envInt('JRX_CTX_MEM_LIMIT_COMPLEX', 8),
        memoryMaxHops: 3,
        memorySlice: 8,
        memoryCharCap: 400,
        memorySources: 'full',
        ragTopK: envInt('JRX_CTX_RAG_TOPK_COMPLEX', 8),
        ragChunkCharCap: envInt('JRX_CTX_RAG_CHUNK_CHARS_COMPLEX', 1_600),
        ragTotalCharCap: envInt('JRX_CTX_RAG_TOTAL_CHARS_COMPLEX', 12_800),
        parallelTimeoutMs: envInt('JRX_CTX_PARALLEL_TIMEOUT_COMPLEX_MS', 25_000),
      };
      break;
    case 'very_complex':
      budgets = {
        complexity: c,
        memoryLimit: envInt('JRX_CTX_MEM_LIMIT_VCOMPLEX', 10),
        memoryMaxHops: 3,
        memorySlice: 10,
        memoryCharCap: 480,
        memorySources: 'full',
        ragTopK: envInt('JRX_CTX_RAG_TOPK_VCOMPLEX', 10),
        ragChunkCharCap: envInt('JRX_CTX_RAG_CHUNK_CHARS_VCOMPLEX', 1_800),
        ragTotalCharCap: envInt('JRX_CTX_RAG_TOTAL_CHARS_VCOMPLEX', 18_000),
        parallelTimeoutMs: envInt('JRX_CTX_PARALLEL_TIMEOUT_VCOMPLEX_MS', 35_000),
      };
      break;
    case 'moderate':
    default:
      budgets = {
        complexity: 'moderate',
        memoryLimit: envInt('JRX_CTX_MEM_LIMIT_MODERATE', 5),
        memoryMaxHops: 2,
        memorySlice: 5,
        memoryCharCap: 360,
        memorySources: 'session+longterm',
        ragTopK: envInt('JRX_CTX_RAG_TOPK_MODERATE', 6),
        ragChunkCharCap: envInt('JRX_CTX_RAG_CHUNK_CHARS_MODERATE', 1_200),
        ragTotalCharCap: envInt('JRX_CTX_RAG_TOTAL_CHARS_MODERATE', 7_200),
        parallelTimeoutMs: envInt('JRX_CTX_PARALLEL_TIMEOUT_MODERATE_MS', 20_000),
      };
      break;
  }
  if (opts?.partnerBestOutcome && !opts?.partnerSlaFast) {
    const floorK = envInt('JRX_PARTNER_RAG_TOP_K', 16);
    const floorMs = envInt('JRX_PARTNER_RAG_TIMEOUT_MS', 45_000);
    // NV-RAG-CHAR-BUDGET-001: the partner floor raises topK to 16, so the total
    // ceiling has to rise with it or partner requests would be starved of
    // retrieval relative to the non-partner path. Raise the TOTAL (breadth), not
    // the per-chunk cap — more distinct authorities beat longer excerpts of the
    // same one, and the per-chunk cap is what bounds a single runaway judgment.
    const partnerTotal = envInt('JRX_PARTNER_RAG_TOTAL_CHARS', 20_000);
    budgets = {
      ...budgets,
      ragTopK: Math.max(budgets.ragTopK, floorK),
      ragTotalCharCap: Math.max(budgets.ragTotalCharCap, partnerTotal),
      memorySources: 'full',
      memoryLimit: Math.max(budgets.memoryLimit, envInt('JRX_PARTNER_MEM_LIMIT', 10)),
      parallelTimeoutMs: Math.max(budgets.parallelTimeoutMs, floorMs),
    };
  }
  return budgets;
}

/** Fail-soft timeout wrapper for parallel context retrieval. */
export function withContextTimeout<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    promise
      .then((v) => {
        clearTimeout(t);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(fallback);
      });
  });
}
