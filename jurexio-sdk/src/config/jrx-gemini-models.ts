/**
 * NV-GEMINI-MODELS-001 — SSoT for paid Gemini model IDs across STT, language,
 * chat/classify, embeddings, and web-search grounding.
 *
 * Defaults prefer the latest high-quality Google Gemini API models.
 * Override any slot via env without code changes.
 *
 * Catalog ids use hyphens (`gemini-3-1-pro-preview`); Google REST often accepts
 * dotted aliases (`gemini-3.1-pro-preview`). `toGeminiApiModelId` normalizes.
 */
function envModel(name: string, fallback: string): string {
  const v = String(process.env[name] ?? '').trim();
  return v || fallback;
}

/** Latest flagship reasoning / multilingual quality (catalog id). */
export function getGeminiProModel(): string {
  return envModel('JRX_GEMINI_PRO_MODEL', 'gemini-3-1-pro-preview');
}

/** Fast high-quality flash for classify / volume / web-search. */
export function getGeminiFlashModel(): string {
  // NV-MODEL-AVAIL-PROBE-001: gemini-3.7-flash is the latest Flash that answers
  // on this account and is measurably the best speed/quality trade — 6.99s on a
  // real BNSS×PMLA legal question vs 20.79s for 3.1 Pro at the same answer depth
  // (`scripts/_ec2-model-bench.sh`, 2026-08-16).
  return envModel('JRX_GEMINI_FLASH_MODEL', 'gemini-3.7-flash');
}

/** Multimodal STT (audio → text). Flash accepts inline audio; Pro preview 400s on v1beta. */
export function getGeminiSttModel(): string {
  return envModel('JRX_GEMINI_STT_MODEL', getGeminiFlashModel());
}

/** Translate / detect-language. Flash is sufficient and matches demo-week routing. */
export function getGeminiLanguageModel(): string {
  return envModel('JRX_GEMINI_LANGUAGE_MODEL', getGeminiFlashModel());
}

/** Classification / extraction / short structured tasks. */
export function getGeminiClassifyModel(): string {
  return envModel('JRX_GEMINI_CLASSIFY_MODEL', getGeminiFlashModel());
}

/**
 * Embeddings — gemini-embedding-2 with outputDimensionality=1536 to match
 * existing pgvector columns (see JRX_EMBEDDING_DIMS).
 */
export function getGeminiEmbedModel(): string {
  return envModel('JRX_GEMINI_EMBED_MODEL', 'gemini-embedding-2');
}

/** Google Search grounding / hub web-search Gemini path. */
export function getGeminiSearchModel(): string {
  return envModel(
    'JRX_WEB_SEARCH_GEMINI_MODEL',
    envModel('JRX_GEMINI_SEARCH_MODEL', getGeminiFlashModel()),
  );
}

/** Ordered Gemini pool for LLM cascade (best → fast → proven). */
export function getGeminiCascadeModels(): string[] {
  const fromEnv = String(process.env.JRX_LLM_CASCADE_GEMINI || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return fromEnv;
  // NV-MODEL-AVAIL-PROBE-001: the previous last two rungs (`gemini-2.5-pro`,
  // `gemini-2.5-flash`) are DEAD on this account — both 404 with "no longer
  // available to new users", so the tail of the cascade could only ever burn a
  // hop plus the per-attempt timeout. Replaced with ids verified HTTP 200 on
  // 2026-08-16, ordered fastest-useful first because every rung after the lead
  // is being reached precisely because latency or availability already hurt.
  // Flash before Pro: 3.7-flash is the latest live Flash (6.99s bench); 3-1-pro is fallback only.
  return [
    getGeminiFlashModel(),
    getGeminiProModel(),
    'gemini-3-flash-preview',
    'gemini-3.1-flash-lite',
  ];
}

/** Map catalog / dotted / hyphenated ids to Google generateContent model path. */
export function toGeminiApiModelId(modelId: string): string {
  const id = String(modelId || '').trim();
  if (!id) return getGeminiFlashModel();
  if (id.startsWith('google/')) return toGeminiApiModelId(id.slice('google/'.length));
  // NV-MODEL-AVAIL-PROBE-001: retired ids that now 404 ("no longer available to
  // new users") are remapped to the nearest live model rather than dispatched.
  const RETIRED: Record<string, string> = {
    'gemini-2.5-pro': 'gemini-3.1-pro-preview',
    'gemini-2.5-flash': 'gemini-3.7-flash',
    'gemini-2.5-flash-lite': 'gemini-3.1-flash-lite',
  };
  if (RETIRED[id]) return RETIRED[id];
  // Catalog: gemini-3-1-pro-preview → API: gemini-3.1-pro-preview
  if (id.startsWith('gemini-3-1-')) return id.replace('gemini-3-1-', 'gemini-3.1-');
  return id;
}

export function describeGeminiModels(): Record<string, string | string[]> {
  return {
    pro: getGeminiProModel(),
    flash: getGeminiFlashModel(),
    stt: getGeminiSttModel(),
    language: getGeminiLanguageModel(),
    classify: getGeminiClassifyModel(),
    embed: getGeminiEmbedModel(),
    search: getGeminiSearchModel(),
    cascade: getGeminiCascadeModels(),
  };
}
