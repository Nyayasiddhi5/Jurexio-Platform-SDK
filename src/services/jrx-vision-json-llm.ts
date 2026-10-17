/**
 * NV-VISION-JSON-LLM-001 — direct Gemini/OpenAI vision for small JSON payloads.
 * Used by NSP evidence-depict; orchestrator text path does not attach image bytes (NV-LLM-001 ring).
 */
import { getGeminiFlashModel, toGeminiApiModelId } from '../config/jrx-gemini-models.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-vision-json-llm');

export interface VisionJsonLlmRequest {
  systemPrompt: string;
  userPrompt: string;
  /** data: URL or raw base64 with optional mime prefix */
  imageDataUrl: string;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface VisionJsonLlmResponse {
  content: string;
  model: string;
  provider: 'gemini' | 'openai';
}

function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const trimmed = dataUrl.trim();
  const m = /^data:([^;]+);base64,(.+)$/i.exec(trimmed);
  if (m) {
    return { mimeType: m[1]!, base64: m[2]!.replace(/\s/g, '') };
  }
  return { mimeType: 'image/jpeg', base64: trimmed.replace(/\s/g, '') };
}

function geminiKeys(): string[] {
  const raw =
    process.env.GEMINI_API_KEYS ??
    process.env.GEMINI_API_KEY ??
    process.env.GOOGLE_API_KEY ??
    process.env.NV_GOOGLE_API_KEY ??
    '';
  return String(raw)
    .split(/[,;\s]+/)
    .map((k) => k.trim())
    .filter((k) => k.length > 8);
}

async function callGeminiVision(req: VisionJsonLlmRequest): Promise<VisionJsonLlmResponse> {
  const keys = geminiKeys();
  if (!keys.length) throw new Error('VISION_LLM_NO_GEMINI_KEY');

  const { mimeType, base64 } = parseDataUrl(req.imageDataUrl);
  const model = toGeminiApiModelId(getGeminiFlashModel());
  const baseUrl = (process.env.NYV_GOOGLE_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(
    /\/$/,
    '',
  );
  const timeoutMs = req.timeoutMs ?? 45_000;
  const combinedUser = `${req.systemPrompt}\n\n${req.userPrompt}`.trim();

  let lastErr: Error | null = null;
  for (const apiKey of keys) {
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: combinedUser },
                { inline_data: { mime_type: mimeType, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: req.maxTokens ?? 900,
            responseMimeType: 'application/json',
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Gemini vision HTTP ${res.status}: ${detail.slice(0, 180)}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? '')
        .join('')
        .trim();
      if (!text) throw new Error('Gemini vision empty content');
      return { content: text, model, provider: 'gemini' };
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error('VISION_LLM_GEMINI_FAILED');
}

async function callOpenAiVision(req: VisionJsonLlmRequest): Promise<VisionJsonLlmResponse> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) throw new Error('VISION_LLM_NO_OPENAI_KEY');

  const dataUrl = req.imageDataUrl.startsWith('data:')
    ? req.imageDataUrl
    : `data:image/jpeg;base64,${req.imageDataUrl}`;
  const model = (process.env.NYV_VISION_OPENAI_MODEL ?? 'gpt-4o').trim();
  const baseUrl = (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  const timeoutMs = req.timeoutMs ?? 45_000;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: req.maxTokens ?? 900,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: req.systemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: req.userPrompt },
            { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`OpenAI vision HTTP ${res.status}: ${detail.slice(0, 180)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = (json.choices?.[0]?.message?.content ?? '').trim();
  if (!content) throw new Error('OpenAI vision empty content');
  return { content, model, provider: 'openai' };
}

/** Prefer Gemini (jrx-staging default), then OpenAI. */
export async function executeVisionJsonLlm(req: VisionJsonLlmRequest): Promise<VisionJsonLlmResponse> {
  const prefer = (process.env.NYV_VISION_LLM_PREFER ?? 'gemini,openai').split(',').map((s) => s.trim());
  const errors: string[] = [];
  for (const p of prefer) {
    try {
      if (p === 'gemini') return await callGeminiVision(req);
      if (p === 'openai') return await callOpenAiVision(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${p}:${msg.slice(0, 120)}`);
      logger.warn('[vision-json] provider failed', { provider: p, err: msg.slice(0, 160) });
    }
  }
  throw new Error(`VISION_LLM_UNAVAILABLE (${errors.join(' | ')})`);
}
