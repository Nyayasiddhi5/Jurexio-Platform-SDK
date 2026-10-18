/**
 * NV OCR Adapter — the single, real OCR + text-extraction engine for the platform.
 *
 * Consolidates what used to be three overlapping OCR services (this adapter,
 * jurexio-enhanced-ocr-service, real-ocr-pipeline-service) so there is exactly
 * ONE real implementation. The other two now delegate here.
 *
 * Provider precedence (auto-detected from env, first available wins):
 *   1. Self-hosted GOT-OCR / Mistral-OCR   — GOT_OCR_URL / MISTRAL_OCR_URL
 *   2. Amazon Textract (structured OCR)     — JRX_F_TEXTRACT=1 + IAM (ap-south-1 default)
 *   3. Mistral OCR API                      — MISTRAL_API_KEY / NV_MISTRAL_API_KEY
 *   4. Google Gemini vision                 — GEMINI_API_KEY / GOOGLE_API_KEY / NV_GOOGLE_API_KEY
 *   5. OpenAI vision                        — OPENAI_API_KEY
 *   6. Local Tesseract (tesseract.js)       — no key required, final real fallback
 *
 * PDFs: digital text is extracted first (pdf-parse, zero OCR cost). Scanned pages
 *       (no/low text layer) are rasterised (pdf-parse getScreenshot) and run through
 *       the vision-OCR precedence above, page by page.
 *
 * There are NO placeholders here. Every path is a real HTTP call or a real local
 * OCR run. When no provider can produce text, the methods throw a typed
 * OcrProviderUnavailableError instead of returning canned text.
 */

import Tesseract from 'tesseract.js';
import { createLogger } from '../../utils/logger.js';
import { getGeminiFlashModel, toGeminiApiModelId } from '../../config/jrx-gemini-models.js';
import { isTextractOcrEnabled, textractOcrPageBytes } from './jrx-textract-ocr-service.js';

const logger = createLogger('./jrx-got-ocr-adapter-service');

type JurisdictionCode = 'IN' | 'UK' | 'EU' | 'US' | 'GCC' | 'SG';

export type OcrProviderId =
  | 'pdf-text-layer'
  | 'got-self-hosted'
  | 'mistral-self-hosted'
  | 'aws-textract'
  | 'mistral-ocr-api'
  | 'gemini-vision'
  | 'openai-vision'
  | 'tesseract-local';

export type OcrExtractionMethod =
  | 'digital-text'    // PDF text layer (no OCR needed)
  | 'self-hosted-ocr'
  | 'textract-ocr'
  | 'vision-ocr'
  | 'local-ocr';

export interface OcrOptions {
  /** ISO language code, e.g. 'en', 'hi', 'ta'. Defaults to 'en'. */
  language?: string;
  documentType?: 'printed' | 'handwritten' | 'degraded' | 'stamp-paper';
  quality?: 'high' | 'medium' | 'low' | 'auto';
  jurisdiction?: JurisdictionCode;
  /** Force local Tesseract only (offline / no external calls). */
  forceLocal?: boolean;
  /** Custom extraction prompt for the vision providers. */
  prompt?: string;
}

export interface OcrPage {
  pageNumber: number;
  text: string;
  confidence: number;
}

export interface OcrResult {
  text: string;
  /** 0..1. Real provider confidence where the provider supplies one, else a labelled heuristic. */
  confidence: number;
  confidenceSource: 'provider' | 'heuristic';
  model: string;
  provider: OcrProviderId;
  language: string;
  pages: OcrPage[];
  extractionMethod: OcrExtractionMethod;
  costCategory: 'free' | 'cheap' | 'premium';
  processingTimeMs: number;
}

/**
 * Thrown when no configured OCR provider can extract text (e.g. every provider
 * key/endpoint is missing or every attempt failed). Never swallowed into canned
 * output — callers must handle a real failure.
 */
export class OcrProviderUnavailableError extends Error {
  readonly attempted: string[];
  constructor(message: string, attempted: string[] = []) {
    super(message);
    this.name = 'OcrProviderUnavailableError';
    this.attempted = attempted;
  }
}

// ISO → Tesseract traineddata language codes (covers the platform's 14 supported languages).
const TESSERACT_LANG: Record<string, string> = {
  en: 'eng', hi: 'hin', bn: 'ben', te: 'tel', mr: 'mar', ta: 'tam',
  gu: 'guj', kn: 'kan', ml: 'mal', pa: 'pan', or: 'ori', as: 'asm',
  ur: 'urd', ar: 'ara',
};

const VISION_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/bmp']);

const DEFAULT_TIMEOUT_MS = 90_000;

function env(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

function defaultPrompt(opts: OcrOptions): string {
  if (opts.prompt) return opts.prompt;
  const kind = opts.documentType ? `${opts.documentType} ` : '';
  const juris = opts.jurisdiction ? `${opts.jurisdiction} ` : '';
  return (
    `Extract ALL text from this ${kind}${juris}document image verbatim. ` +
    `Preserve reading order, line breaks, tables and layout as plain text / markdown. ` +
    `Do not summarise, translate, or add commentary. ` +
    `Language hint: ${opts.language || 'en'}. Output only the extracted text.`
  );
}

/** Honest confidence for providers that do not return one. Derived from output density, clearly labelled heuristic. */
function heuristicConfidence(text: string): number {
  const nonSpace = text.replace(/\s+/g, '').length;
  if (nonSpace === 0) return 0;
  // Grows with the amount of recovered text; capped so it never claims certainty.
  return Math.min(0.92, 0.55 + Math.min(0.37, (nonSpace / 4000) * 0.37));
}

class NvOcrAdapterService {
  // ── Public surface ──────────────────────────────────────────────────────

  /**
   * OCR a single image buffer. Runs the provider precedence and throws
   * OcrProviderUnavailableError if every available provider fails.
   */
  async ocrImage(imageBuffer: Buffer, mimeType: string, options: OcrOptions = {}): Promise<OcrResult> {
    const start = Date.now();
    const opts = this.normalise(options);
    const order = this.providerOrder(opts);
    const attempted: string[] = [];

    for (const provider of order) {
      try {
        const result = await this.runImageProvider(provider, imageBuffer, mimeType, opts);
        result.processingTimeMs = Date.now() - start;
        logger.info({ method: 'ocrImage', provider, chars: result.text.length, confidence: result.confidence });
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempted.push(`${provider}: ${message}`);
        logger.warn({ method: 'ocrImage', provider, failed: message });
      }
    }

    throw new OcrProviderUnavailableError(
      `No OCR provider could process the image (${mimeType}). Configure GOT_OCR_URL / MISTRAL_OCR_URL, ` +
        `MISTRAL_API_KEY, GEMINI_API_KEY/GOOGLE_API_KEY, or OPENAI_API_KEY, or ensure local Tesseract can run.`,
      attempted,
    );
  }

  /**
   * Extract text from a document buffer (PDF or image).
   * PDFs: digital text layer first, then per-page vision OCR for scanned pages.
   */
  async ocrDocument(buffer: Buffer, mimeType: string, options: OcrOptions = {}): Promise<OcrResult> {
    const opts = this.normalise(options);
    const isPdf = mimeType === 'application/pdf' || mimeType === 'application/x-pdf';

    if (isPdf) return this.ocrPdf(buffer, opts);
    if (VISION_IMAGE_MIME.has(mimeType)) return this.ocrImage(buffer, mimeType, opts);

    throw new OcrProviderUnavailableError(
      `Unsupported document MIME type for OCR: ${mimeType}. Supported: application/pdf and ${[...VISION_IMAGE_MIME].join(', ')}.`,
    );
  }

  /** Provider order resolved from configured env, in the documented precedence. */
  detectAvailableProviders(): OcrProviderId[] {
    return this.providerOrder(this.normalise({}));
  }

  // ── PDF handling ──────────────────────────────────────────────────────────

  private async ocrPdf(buffer: Buffer, opts: Required<Pick<OcrOptions, 'language'>> & OcrOptions): Promise<OcrResult> {
    const start = Date.now();
    const { PDFParse } = await import('pdf-parse');

    let digital: { pages: { num: number; text: string }[]; text: string; total: number } | null = null;
    try {
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const textResult = await parser.getText();
        digital = {
          text: textResult.text || '',
          total: textResult.total || textResult.pages.length || 1,
          pages: textResult.pages.map((p) => ({ num: p.num, text: p.text || '' })),
        };
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } catch (err) {
      logger.warn({ method: 'ocrPdf', stage: 'getText', error: err instanceof Error ? err.message : String(err) });
    }

    const pageCount = digital?.total ?? 1;
    const meaningfulChars = (digital?.text ?? '').replace(/\s+/g, '').length;
    const digitalThreshold = Math.max(20, pageCount * 10);

    if (digital && meaningfulChars >= digitalThreshold) {
      const pages: OcrPage[] = digital.pages.map((p) => ({ pageNumber: p.num, text: p.text, confidence: 1 }));
      return {
        text: digital.text.trim(),
        confidence: 1,
        confidenceSource: 'provider',
        model: 'pdf-text-layer',
        provider: 'pdf-text-layer',
        language: opts.language,
        pages: pages.length ? pages : [{ pageNumber: 1, text: digital.text.trim(), confidence: 1 }],
        extractionMethod: 'digital-text',
        costCategory: 'free',
        processingTimeMs: Date.now() - start,
      };
    }

    // Scanned / image-only PDF → rasterise each page and OCR it.
    logger.info({ method: 'ocrPdf', mode: 'scanned', pageCount, meaningfulChars });
    const screenshots = await this.rasterisePdf(buffer);
    if (screenshots.length === 0) {
      throw new OcrProviderUnavailableError(
        'PDF has no extractable text layer and could not be rasterised for OCR.',
      );
    }

    const ocrPages: OcrPage[] = [];
    let provider: OcrProviderId = 'tesseract-local';
    let model = '';
    let confidenceSource: 'provider' | 'heuristic' = 'heuristic';
    const attempted: string[] = [];

    for (const shot of screenshots) {
      try {
        const pageResult = await this.ocrImage(shot.data, 'image/png', opts);
        ocrPages.push({ pageNumber: shot.pageNumber, text: pageResult.text, confidence: pageResult.confidence });
        provider = pageResult.provider;
        model = pageResult.model;
        confidenceSource = pageResult.confidenceSource;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        attempted.push(`page ${shot.pageNumber}: ${message}`);
        logger.warn({ method: 'ocrPdf', page: shot.pageNumber, failed: message });
      }
    }

    if (ocrPages.length === 0) {
      throw new OcrProviderUnavailableError(
        `Scanned PDF OCR failed on every page (${screenshots.length} pages).`,
        attempted,
      );
    }

    const combined = ocrPages.map((p) => p.text).join('\n\n');
    const avgConfidence = ocrPages.reduce((s, p) => s + p.confidence, 0) / ocrPages.length;
    return {
      text: combined.trim(),
      confidence: Number(avgConfidence.toFixed(4)),
      confidenceSource,
      model: model || provider,
      provider,
      language: opts.language,
      pages: ocrPages,
      extractionMethod: provider === 'tesseract-local' ? 'local-ocr' : provider.includes('self-hosted') ? 'self-hosted-ocr' : 'vision-ocr',
      costCategory: provider === 'tesseract-local' ? 'free' : provider === 'got-self-hosted' || provider === 'mistral-self-hosted' ? 'cheap' : 'premium',
      processingTimeMs: Date.now() - start,
    };
  }

  private async rasterisePdf(buffer: Buffer): Promise<{ pageNumber: number; data: Buffer }[]> {
    try {
      const { PDFParse } = await import('pdf-parse');
      const parser = new PDFParse({ data: new Uint8Array(buffer) });
      try {
        const shots = await parser.getScreenshot({ scale: 2, imageBuffer: true, imageDataUrl: false });
        return shots.pages
          .filter((p) => p.data && p.data.length > 0)
          .map((p) => ({ pageNumber: p.pageNumber, data: Buffer.from(p.data) }));
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } catch (err) {
      logger.error({ method: 'rasterisePdf', error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }

  // ── Provider routing ───────────────────────────────────────────────────────

  private normalise(options: OcrOptions): Required<Pick<OcrOptions, 'language'>> & OcrOptions {
    return { ...options, language: options.language || 'en' };
  }

  private providerOrder(opts: OcrOptions): OcrProviderId[] {
    if (opts.forceLocal) return ['tesseract-local'];
    const order: OcrProviderId[] = [];
    if (env('GOT_OCR_URL')) order.push('got-self-hosted');
    if (env('MISTRAL_OCR_URL')) order.push('mistral-self-hosted');
    if (isTextractOcrEnabled()) order.push('aws-textract');
    if (env('MISTRAL_API_KEY', 'NV_MISTRAL_API_KEY')) order.push('mistral-ocr-api');
    if (env('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'NV_GOOGLE_API_KEY')) order.push('gemini-vision');
    if (env('OPENAI_API_KEY')) order.push('openai-vision');
    // Local Tesseract is always the final, key-free real fallback.
    order.push('tesseract-local');
    return order;
  }

  private runImageProvider(provider: OcrProviderId, image: Buffer, mimeType: string, opts: OcrOptions): Promise<OcrResult> {
    switch (provider) {
      case 'got-self-hosted':
        return this.callSelfHostedOcr('got-self-hosted', env('GOT_OCR_URL')!, 'got-ocr-2.0', image, mimeType, opts);
      case 'mistral-self-hosted':
        return this.callSelfHostedOcr('mistral-self-hosted', env('MISTRAL_OCR_URL')!, 'mistral-ocr-self-hosted', image, mimeType, opts);
      case 'aws-textract':
        return this.callTextract(image, opts);
      case 'mistral-ocr-api':
        return this.callMistralOcrApi(image, mimeType, opts);
      case 'gemini-vision':
        return this.callGeminiVision(image, mimeType, opts);
      case 'openai-vision':
        return this.callOpenAiVision(image, mimeType, opts);
      case 'tesseract-local':
        return this.callTesseract(image, opts);
      default:
        return Promise.reject(new Error(`Unknown OCR provider: ${provider}`));
    }
  }

  // ── Amazon Textract (before vision LLM) ─────────────────────────────────────

  private async callTextract(image: Buffer, opts: OcrOptions): Promise<OcrResult> {
    const hit = await textractOcrPageBytes(image);
    if (!hit?.text.trim()) {
      throw new Error('Amazon Textract returned empty text');
    }
    const text = hit.text.trim();
    return {
      text,
      confidence: hit.meanConf,
      confidenceSource: 'provider',
      model: 'analyze-document',
      provider: 'aws-textract',
      language: opts.language || 'en',
      pages: [{ pageNumber: 1, text, confidence: hit.meanConf }],
      extractionMethod: 'textract-ocr',
      costCategory: 'cheap',
      processingTimeMs: 0,
    };
  }

  // ── 1. Self-hosted GOT-OCR / Mistral-OCR ────────────────────────────────────

  private async callSelfHostedOcr(
    provider: OcrProviderId,
    endpoint: string,
    model: string,
    image: Buffer,
    mimeType: string,
    opts: OcrOptions,
  ): Promise<OcrResult> {
    const base64 = image.toString('base64');
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        image: base64,
        document_base64: base64,
        mime_type: mimeType,
        language: opts.language,
        document_type: opts.documentType,
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.ok === false) {
      throw new Error(`self-hosted OCR (${endpoint}) returned HTTP ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const text: string = (data.text ?? data.markdown ?? data.result ?? '').toString();
    if (!text.trim()) throw new Error('self-hosted OCR returned empty text');

    const providerConfidence = typeof data.confidence === 'number' ? Math.max(0, Math.min(1, data.confidence > 1 ? data.confidence / 100 : data.confidence)) : undefined;
    const pages: OcrPage[] = Array.isArray(data.pages) && data.pages.length
      ? data.pages.map((p: any, i: number) => ({ pageNumber: p.pageNumber ?? p.page ?? i + 1, text: (p.text ?? p.markdown ?? '').toString(), confidence: providerConfidence ?? heuristicConfidence((p.text ?? '').toString()) }))
      : [{ pageNumber: 1, text, confidence: providerConfidence ?? heuristicConfidence(text) }];

    return {
      text: text.trim(),
      confidence: providerConfidence ?? heuristicConfidence(text),
      confidenceSource: providerConfidence !== undefined ? 'provider' : 'heuristic',
      model,
      provider,
      language: opts.language || 'en',
      pages,
      extractionMethod: 'self-hosted-ocr',
      costCategory: 'cheap',
      processingTimeMs: 0,
    };
  }

  // ── 2. Mistral OCR API ───────────────────────────────────────────────────────

  private async callMistralOcrApi(image: Buffer, mimeType: string, opts: OcrOptions): Promise<OcrResult> {
    const apiKey = env('MISTRAL_API_KEY', 'NV_MISTRAL_API_KEY');
    if (!apiKey) throw new Error('Mistral OCR API key not configured');

    const model = env('NV_OCR_MISTRAL_MODEL') || 'mistral-ocr-latest';
    const base64 = image.toString('base64');
    const document = mimeType === 'application/pdf'
      ? { type: 'document_url', document_url: `data:application/pdf;base64,${base64}` }
      : { type: 'image_url', image_url: `data:${mimeType};base64,${base64}` };

    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, document, include_image_base64: false }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.ok === false) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Mistral OCR API HTTP ${response.status} ${response.statusText} ${detail.slice(0, 200)}`);
    }

    const data: any = await response.json();
    const apiPages: any[] = Array.isArray(data.pages) ? data.pages : [];
    const pages: OcrPage[] = apiPages.map((p, i) => ({
      pageNumber: typeof p.index === 'number' ? p.index + 1 : i + 1,
      text: (p.markdown ?? p.text ?? '').toString(),
      confidence: heuristicConfidence((p.markdown ?? p.text ?? '').toString()),
    }));
    const text = (pages.length ? pages.map((p) => p.text).join('\n\n') : (data.text ?? '')).toString().trim();
    if (!text) throw new Error('Mistral OCR API returned empty text');

    return {
      text,
      confidence: heuristicConfidence(text),
      confidenceSource: 'heuristic',
      model,
      provider: 'mistral-ocr-api',
      language: opts.language || 'en',
      pages: pages.length ? pages : [{ pageNumber: 1, text, confidence: heuristicConfidence(text) }],
      extractionMethod: 'vision-ocr',
      costCategory: 'premium',
      processingTimeMs: 0,
    };
  }

  // ── 3. Google Gemini vision ──────────────────────────────────────────────────

  private async callGeminiVision(image: Buffer, mimeType: string, opts: OcrOptions): Promise<OcrResult> {
    const apiKey = env('GEMINI_API_KEY', 'GOOGLE_API_KEY', 'NV_GOOGLE_API_KEY');
    if (!apiKey) throw new Error('Gemini/Google API key not configured');

    const model = env('NV_OCR_GEMINI_MODEL') || toGeminiApiModelId(getGeminiFlashModel());
    const baseUrl = env('JRX_GOOGLE_BASE_URL') || 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: defaultPrompt(opts) },
              { inline_data: { mime_type: mimeType, data: image.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 8192 },
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.ok === false) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Gemini vision HTTP ${response.status} ${response.statusText} ${detail.slice(0, 200)}`);
    }

    const data: any = await response.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p?.text ?? '').join('').trim();
    if (!text) throw new Error('Gemini vision returned empty text');

    return {
      text,
      confidence: heuristicConfidence(text),
      confidenceSource: 'heuristic',
      model,
      provider: 'gemini-vision',
      language: opts.language || 'en',
      pages: [{ pageNumber: 1, text, confidence: heuristicConfidence(text) }],
      extractionMethod: 'vision-ocr',
      costCategory: 'premium',
      processingTimeMs: 0,
    };
  }

  // ── 4. OpenAI vision ─────────────────────────────────────────────────────────

  private async callOpenAiVision(image: Buffer, mimeType: string, opts: OcrOptions): Promise<OcrResult> {
    const apiKey = env('OPENAI_API_KEY');
    if (!apiKey) throw new Error('OpenAI API key not configured');
    if (!VISION_IMAGE_MIME.has(mimeType)) {
      throw new Error(`OpenAI vision requires an image input; got ${mimeType}`);
    }

    const model = env('NV_OCR_OPENAI_MODEL') || 'gpt-4o';
    const baseUrl = env('OPENAI_BASE_URL') || 'https://api.openai.com/v1';
    const dataUrl = `data:${mimeType};base64,${image.toString('base64')}`;

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 8192,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: defaultPrompt(opts) },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });

    if (response.ok === false) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI vision HTTP ${response.status} ${response.statusText} ${detail.slice(0, 200)}`);
    }

    const data: any = await response.json();
    const text = (data?.choices?.[0]?.message?.content ?? '').toString().trim();
    if (!text) throw new Error('OpenAI vision returned empty text');

    return {
      text,
      confidence: heuristicConfidence(text),
      confidenceSource: 'heuristic',
      model,
      provider: 'openai-vision',
      language: opts.language || 'en',
      pages: [{ pageNumber: 1, text, confidence: heuristicConfidence(text) }],
      extractionMethod: 'vision-ocr',
      costCategory: 'premium',
      processingTimeMs: 0,
    };
  }

  // ── 5. Local Tesseract (real, no key) ────────────────────────────────────────

  private async callTesseract(image: Buffer, opts: OcrOptions): Promise<OcrResult> {
    const lang = TESSERACT_LANG[opts.language || 'en'] || 'eng';
    const worker = await Tesseract.createWorker(lang);
    try {
      const { data } = await worker.recognize(image);
      const text = (data.text || '').trim();
      if (!text) throw new Error('Tesseract returned empty text');
      const confidence = Math.max(0, Math.min(1, (data.confidence ?? 0) / 100));
      return {
        text,
        confidence: Number(confidence.toFixed(4)),
        confidenceSource: 'provider',
        model: `tesseract-${lang}`,
        provider: 'tesseract-local',
        language: opts.language || 'en',
        pages: [{ pageNumber: 1, text, confidence }],
        extractionMethod: 'local-ocr',
        costCategory: 'free',
        processingTimeMs: 0,
      };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }
}

export const nvOcrAdapterService = new NvOcrAdapterService();
// Backwards-compatible export name (the service was historically the "GOT OCR adapter").
export const nvGotOcrAdapterService = nvOcrAdapterService;
export { NvOcrAdapterService };
