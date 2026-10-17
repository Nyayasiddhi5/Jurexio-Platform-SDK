/**
 * nv-aux-cost-estimator.ts — NV-CREDIT-COST-DIM-001
 *
 * Pre-spend money estimate, in integer micro-USD, for the paid surfaces that spend
 * without consuming chat tokens: embeddings, speech-to-text, text-to-speech, and
 * off-safety-ring vision/OCR.
 *
 * WHY A MONEY UNIT AND NOT A TOKEN UNIT
 * ─────────────────────────────────────
 * `ai_credit_usage.tokens_used` cannot express a per-audio-second STT bill or a
 * per-page OCR bill. Forcing them into tokens requires inventing a conversion
 * factor, and that factor would then silently become the platform's pricing policy
 * for three product lines. Micro-USD (1e-6 USD) is the resolution the existing
 * `ai_credit_usage.cost_usd NUMERIC(10,6)` column already stores, so the money
 * dimension is the *same* number the recorder already persists — read back as an
 * integer to keep the budget arithmetic exact.
 *
 * NV-NO-DUPLICATE-001: the per-token/per-1k model price table stays in
 * `nv-llm-pricing.ts` and is not restated here. This module adds only the
 * non-token rates (per audio second, per character, per page), which had no home.
 *
 * MEASURABILITY IS PART OF THE RESULT — deliberately.
 * Some drivers cannot be priced before the call: an OCR page count is only known
 * after the document is rendered, and an audio duration behind a URL is not known
 * until the bytes are fetched and decoded. For those, this returns
 * `measurable: false` and `microUsd: 0` rather than a plausible-looking number. A
 * fabricated estimate that refuses a lawful request is worse than no estimate, and
 * the post-spend recorder still writes the true cost — so the *next* request from
 * the same subject is metered against real, measured spend.
 */

/** Non-token cost drivers, named after what the provider actually bills. */
export type NvAuxCostDriver =
  | 'embedding_tokens'
  | 'stt_audio_seconds'
  | 'tts_characters'
  | 'vision_images'
  | 'ocr_pages';

export interface NvAuxCostEstimate {
  driver: NvAuxCostDriver;
  /** Integer micro-USD. Always 0 when `measurable` is false. */
  microUsd: number;
  /**
   * False when the driver's quantity is not knowable before the call. The caller
   * must NOT treat 0 as "free" — it means "unmeasurable pre-spend, recorded
   * post-spend".
   */
  measurable: boolean;
  /** Quantity in `unit`, for the observe log line. 0 when unmeasurable. */
  quantity: number;
  unit: string;
  /** Why it could not be measured. Set only when `measurable` is false. */
  unmeasurableReason?: string;
}

/**
 * Public list rates, 2026-Q3 snapshot. Same status as `nv-llm-pricing.ts`: rough
 * list prices for gateway-side estimation, NOT a billing source of truth — billing
 * is the provider-reported `cost_usd` the recorder persists.
 *
 * Exported because the post-spend recording sites (STT, embeddings) must price with
 * the SAME rates the pre-spend estimate used. Two copies would drift, and a budget
 * whose estimate and its own recorded spend disagree cannot be tuned.
 */
export const NV_AUX_RATES = {
  /**
   * $0.00002 per 1k input tokens — OpenAI text-embedding-3-small, the platform
   * default in `nv-embedding-cascade.ts`. Bedrock Titan v2 (`amazon.titan-embed-
   * text-v2:0`, 1024 dims) lists at $0.00002/1k for the same shape, so one rate
   * covers the configured cascade's first two paid hops without pretending to a
   * precision the cascade does not have (it may fall through providers per call).
   */
  embeddingMicroUsdPer1kTokens: 20,
  /** $0.006/min ≈ $0.0001/s — OpenAI whisper-1 / gpt-4o-mini-transcribe. */
  sttMicroUsdPerSecond: 100,
  /** $0.000015/char — OpenAI tts-1, the rate `nv-phase4-services` already applies. */
  ttsMicroUsdPerCharacter: 15,
  /**
   * $0.005/image — gpt-4o vision, one ~1.1k-image-token tile plus the ~2k
   * completion cap `NvMultimodalVisionService.analyzeImage` sets.
   */
  visionMicroUsdPerImage: 5_000,
  /** $0.01/page — vision-model OCR of one rendered page at ~1.1k image tokens. */
  ocrMicroUsdPerPage: 10_000,
} as const;

const AUX_RATES = NV_AUX_RATES;

/** ~4 characters per token, the same ratio `estimatePromptTokens` uses. */
const CHARS_PER_EMBEDDING_TOKEN = 4;

/**
 * Lower bound on bytes per second of audio the platform will accept.
 *
 * The gateway's own voice-stream contract (`sdk-multimodal-voice-service`
 * `startVoiceStream`) declares LINEAR16 / 16 kHz / mono = 32,000 B/s, but callers
 * also POST compressed mp3/opus. Rather than assume the container, this uses a
 * deliberately *compressed* rate so byte-derived duration is a FLOOR: it can
 * under-price a request but never over-price one. Under-pricing admits; over-pricing
 * refuses lawful work, and refusing lawful work is the failure this whole task is
 * structured to avoid.
 */
const STT_MIN_BYTES_PER_SECOND = 32_000;

function base64DecodedBytes(b64: string): number {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  const len = cleaned.length;
  if (len === 0) return 0;
  let padding = 0;
  if (cleaned.endsWith('==')) padding = 2;
  else if (cleaned.endsWith('=')) padding = 1;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

export interface NvAuxCostInput {
  driver: NvAuxCostDriver;
  /** Text whose tokens/characters are billed (embeddings, TTS). */
  text?: string | string[];
  /** Base64 audio payload (STT). Exactly measurable in bytes. */
  audioBase64?: string;
  /** Remote audio (STT). Not measurable pre-spend — nothing has been fetched. */
  audioUrl?: string;
  /** Page count, when the caller stated it. OCR is unmeasurable without it. */
  pages?: number;
  /** Number of images presented inline (vision). One request = one billed image. */
  images?: number;
}

export function estimateAuxCostMicroUsd(input: NvAuxCostInput): NvAuxCostEstimate {
  switch (input.driver) {
    case 'embedding_tokens': {
      const texts = Array.isArray(input.text) ? input.text : input.text ? [input.text] : [];
      const chars = texts.reduce((sum, t) => sum + (typeof t === 'string' ? t.length : 0), 0);
      const tokens = Math.ceil(chars / CHARS_PER_EMBEDDING_TOKEN);
      return {
        driver: 'embedding_tokens',
        microUsd: Math.ceil((tokens / 1000) * AUX_RATES.embeddingMicroUsdPer1kTokens),
        measurable: true,
        quantity: tokens,
        unit: 'tokens',
      };
    }
    case 'stt_audio_seconds': {
      if (input.audioBase64) {
        const seconds = base64DecodedBytes(input.audioBase64) / STT_MIN_BYTES_PER_SECOND;
        return {
          driver: 'stt_audio_seconds',
          microUsd: Math.ceil(seconds * AUX_RATES.sttMicroUsdPerSecond),
          measurable: true,
          quantity: Math.round(seconds * 100) / 100,
          unit: 'audio_seconds_floor',
        };
      }
      return {
        driver: 'stt_audio_seconds',
        microUsd: 0,
        measurable: false,
        quantity: 0,
        unit: 'audio_seconds',
        unmeasurableReason: input.audioUrl
          ? 'audio behind a URL: duration unknown until fetched and decoded'
          : 'no audio payload presented',
      };
    }
    case 'tts_characters': {
      const texts = Array.isArray(input.text) ? input.text : input.text ? [input.text] : [];
      const chars = texts.reduce((sum, t) => sum + (typeof t === 'string' ? t.length : 0), 0);
      return {
        driver: 'tts_characters',
        microUsd: Math.ceil(chars * AUX_RATES.ttsMicroUsdPerCharacter),
        measurable: true,
        quantity: chars,
        unit: 'characters',
      };
    }
    case 'vision_images': {
      // A single inline image is exactly measurable: it is one billed tile, unlike
      // a multi-page document whose page count is only known after rendering.
      const images = Math.max(0, Math.floor(Number(input.images) || 0));
      if (images > 0) {
        return {
          driver: 'vision_images',
          microUsd: images * AUX_RATES.visionMicroUsdPerImage,
          measurable: true,
          quantity: images,
          unit: 'images',
        };
      }
      return {
        driver: 'vision_images',
        microUsd: 0,
        measurable: false,
        quantity: 0,
        unit: 'images',
        unmeasurableReason: 'no inline image presented on the request',
      };
    }
    case 'ocr_pages': {
      const pages = Math.floor(Number(input.pages) || 0);
      if (pages > 0) {
        return {
          driver: 'ocr_pages',
          microUsd: pages * AUX_RATES.ocrMicroUsdPerPage,
          measurable: true,
          quantity: pages,
          unit: 'pages',
        };
      }
      return {
        driver: 'ocr_pages',
        microUsd: 0,
        measurable: false,
        quantity: 0,
        unit: 'pages',
        unmeasurableReason: 'page count is only known after the document is rendered',
      };
    }
    default: {
      const exhaustive: never = input.driver;
      throw new Error(`unknown aux cost driver: ${String(exhaustive)}`);
    }
  }
}
