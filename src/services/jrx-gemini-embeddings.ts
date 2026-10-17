/**
 * NV-EMBED-GEMINI-001 — Gemini embeddings (AWS-credit-independent paid Google path).
 * Used when OpenAI quota is exhausted and Bedrock Titan is unavailable in-region.
 * Default outputDimensionality 1536 matches knowledge_chunks / rag_documents.
 */
import { createLogger } from '../utils/logger.js';
import { getGeminiEmbedModel, toGeminiApiModelId } from '../config/jrx-gemini-models.js';

const logger = createLogger('./jrx-gemini-embeddings');

export function resolveGeminiApiKeys(): string[] {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolveProviderSecret } = require('./jrx-runtime-provider-secrets.js') as typeof import('./jrx-runtime-provider-secrets.js');
    const overlayPool = resolveProviderSecret('GEMINI_API_KEYS');
    if (overlayPool) {
      process.env.GEMINI_API_KEYS = overlayPool;
    }
    for (const name of ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_AI_API_KEY', 'NYV_GOOGLE_API_KEY']) {
      const v = resolveProviderSecret(name);
      if (v) process.env[name] = v;
    }
  } catch {
    /* ignore */
  }
  const pool = String(process.env.GEMINI_API_KEYS || '')
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const singles = [
    process.env.GEMINI_API_KEY,
    process.env.GOOGLE_API_KEY,
    process.env.GOOGLE_AI_API_KEY,
    process.env.NYV_GOOGLE_API_KEY,
  ].filter((k): k is string => !!k && !!String(k).trim());
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of [...pool, ...singles]) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export async function generateGeminiEmbedding(
  text: string,
  dims = Number(process.env.NYV_EMBEDDING_DIMS) || 1536,
): Promise<number[] | null> {
  const keys = resolveGeminiApiKeys();
  if (!keys.length) return null;
  const model = toGeminiApiModelId(process.env.NYV_GEMINI_EMBED_MODEL || getGeminiEmbedModel());
  const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
  let lastErr = '';
  for (let i = 0; i < keys.length; i++) {
    const apiKey = keys[i];
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
      `:embedContent?key=${apiKey}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${model}`,
          content: { parts: [{ text: truncated }] },
          outputDimensionality: dims,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        lastErr = `Gemini embed ${res.status}: ${(await res.text()).slice(0, 160)}`;
        if (i < keys.length - 1 && /429|403|quota|resource/i.test(lastErr)) continue;
        logger.warn('[GEMINI-EMBED] failed', { status: res.status, err: lastErr.slice(0, 120) });
        return null;
      }
      const json = (await res.json()) as { embedding?: { values?: number[] } };
      const emb = json?.embedding?.values;
      if (Array.isArray(emb) && emb.length > 0) {
        logger.info('[GEMINI-EMBED] ok', { model, dims: emb.length, keyIndex: i });
        return emb;
      }
      lastErr = 'empty embedding';
    } catch (e: any) {
      lastErr = e?.message || String(e);
      if (i < keys.length - 1) continue;
    }
  }
  logger.warn('[GEMINI-EMBED] all keys failed', { err: lastErr.slice(0, 160) });
  return null;
}

export async function generateGeminiEmbeddingsBatch(
  texts: string[],
  dims = Number(process.env.NYV_EMBEDDING_DIMS) || 1536,
): Promise<Array<number[] | null>> {
  const out: Array<number[] | null> = [];
  for (const t of texts) {
    out.push(await generateGeminiEmbedding(t, dims));
  }
  return out;
}
