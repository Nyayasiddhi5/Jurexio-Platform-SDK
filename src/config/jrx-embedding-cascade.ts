/**
 * NV-EMBEDDING-CASCADE-001 — single SSoT for platform embedding provider order.
 *
 * Default (no code change to reorder — use env):
 *   NYV_EMBEDDING_CASCADE=gemini,bedrock,openrouter,openai,local
 *
 * Primary provider (first hop) also settable via:
 *   NYV_EMBEDDING_PROVIDER=gemini|google|bedrock|openrouter|openai|auto
 *
 * Models:
 *   NYV_GEMINI_EMBED_MODEL=gemini-embedding-2
 *   NYV_BEDROCK_EMBED_MODEL=amazon.titan-embed-text-v2:0
 *   NYV_BEDROCK_EMBED_DIMS=1024
 *   NYV_OPENROUTER_EMBED_MODEL=openai/text-embedding-3-small
 *   NYV_OPENAI_EMBED_MODEL=text-embedding-3-small
 *   NYV_EMBEDDING_DIMS / NYV_EMBEDDING_DIMENSION=1536
 *
 * Dim safety: providers whose native dims ≠ target are skipped unless
 * NYV_EMBEDDING_ALLOW_DIM_MISMATCH=1 (Titan v2 is typically 1024 vs 1536 pgvector).
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-embedding-cascade');

export type EmbedCascadeProvider =
  | 'gemini'
  | 'google'
  | 'bedrock'
  | 'openrouter'
  | 'openai'
  | 'local';

export interface EmbedCascadeResult {
  embedding: number[];
  provider: EmbedCascadeProvider;
  model: string;
  dims: number;
}

const DEFAULT_CASCADE: EmbedCascadeProvider[] = [
  'gemini',
  'bedrock',
  'openrouter',
  'openai',
  'local',
];

function envStr(name: string, fallback = ''): string {
  return String(process.env[name] ?? fallback).trim();
}

function envOn(name: string): boolean {
  const v = envStr(name).toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getEmbeddingTargetDims(): number {
  return (
    Number(process.env.NYV_EMBEDDING_DIMS)
    || Number(process.env.NYV_EMBEDDING_DIMENSION)
    || 1536
  );
}

export function getEmbeddingCascadeConfig(): {
  cascade: EmbedCascadeProvider[];
  primary: EmbedCascadeProvider | 'auto';
  models: Record<string, string>;
  targetDims: number;
  allowDimMismatch: boolean;
} {
  const primaryRaw = envStr('NYV_EMBEDDING_PROVIDER', 'gemini').toLowerCase() || 'gemini';
  const primary = (primaryRaw === 'google' ? 'gemini' : primaryRaw) as EmbedCascadeProvider | 'auto';

  const cascadeRaw = envStr('NYV_EMBEDDING_CASCADE');
  let cascade: EmbedCascadeProvider[] = cascadeRaw
    ? cascadeRaw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) as EmbedCascadeProvider[]
    : [...DEFAULT_CASCADE];

  // Normalize aliases
  cascade = cascade.map((p) => (p === 'google' ? 'gemini' : p));

  // If primary is a concrete provider, put it first (dedupe).
  if (primary && primary !== 'auto' && primary !== ('none' as any)) {
    cascade = [primary as EmbedCascadeProvider, ...cascade.filter((p) => p !== primary)];
  }

  // Deduplicate preserving order
  const seen = new Set<string>();
  cascade = cascade.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  if (envStr('NYV_BEDROCK_EMBEDDINGS') === '0') {
    cascade = cascade.filter((p) => p !== 'bedrock');
  }
  if (primaryRaw === 'none') {
    cascade = ['local'];
  }

  return {
    cascade,
    primary: primaryRaw === 'none' ? 'auto' : primary,
    models: {
      gemini: envStr('NYV_GEMINI_EMBED_MODEL', 'gemini-embedding-2'),
      bedrock: envStr('NYV_BEDROCK_EMBED_MODEL', 'amazon.titan-embed-text-v2:0'),
      openrouter: envStr('NYV_OPENROUTER_EMBED_MODEL', 'openai/text-embedding-3-small'),
      openai: envStr('NYV_OPENAI_EMBED_MODEL', envStr('NYV_EMBEDDING_MODEL', 'text-embedding-3-small')),
      local: 'local-hash-v1',
    },
    targetDims: getEmbeddingTargetDims(),
    allowDimMismatch: envOn('NYV_EMBEDDING_ALLOW_DIM_MISMATCH'),
  };
}

function dimsOk(emb: number[] | null | undefined, target: number, allowMismatch: boolean): emb is number[] {
  if (!Array.isArray(emb) || emb.length === 0) return false;
  if (allowMismatch) return true;
  return emb.length === target;
}

async function tryGemini(text: string, model: string): Promise<number[] | null> {
  const { generateGeminiEmbedding } = await import('../services/jrx-gemini-embeddings.js');
  return generateGeminiEmbedding(text);
}

async function tryBedrock(text: string, model: string): Promise<number[] | null> {
  try {
    const mod: any = await import('@aws-sdk/client-bedrock-runtime');
    const region = process.env.AWS_BEDROCK_REGION || process.env.AWS_REGION || 'ap-south-1';
    const client = new mod.BedrockRuntimeClient({ region });
    const truncated = text.length > 8000 ? text.slice(0, 8000) : text;
    const body: Record<string, unknown> = { inputText: truncated };
    if (String(model).includes('titan-embed-text-v2')) {
      body.dimensions = Number(process.env.NYV_BEDROCK_EMBED_DIMS) || 1024;
      body.normalize = true;
    }
    const out = await client.send(
      new mod.InvokeModelCommand({
        modelId: model,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(body),
      }),
    );
    const decoded = new TextDecoder().decode(out.body as Uint8Array);
    const parsed = JSON.parse(decoded) as { embedding?: number[] };
    return Array.isArray(parsed?.embedding) ? parsed.embedding : null;
  } catch (e: any) {
    logger.warn('[EMBED-CASCADE] Bedrock failed', { error: e?.message || String(e) });
    return null;
  }
}

async function tryOpenAICompatible(
  text: string,
  model: string,
  baseUrl: string,
  apiKey: string,
  label: string,
): Promise<number[] | null> {
  if (!apiKey) return null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
    });
    if (!res.ok) {
      const errText = await res.text();
      logger.warn(`[EMBED-CASCADE] ${label} HTTP ${res.status}`, { error: errText.slice(0, 160) });
      return null;
    }
    const data: any = await res.json();
    const emb = data?.data?.[0]?.embedding;
    return Array.isArray(emb) ? emb : null;
  } catch (e: any) {
    logger.warn(`[EMBED-CASCADE] ${label} failed`, { error: e?.message || String(e) });
    return null;
  }
}

function localHashEmbedding(text: string, dims: number): number[] {
  const vec = new Array<number>(dims).fill(0);
  const tokens = String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1)
    .slice(0, 512);
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] += 1;
    vec[(idx + 17) % dims] += 0.5;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i++) vec[i] /= norm;
  return vec;
}

/**
 * Run the configured cascade until one provider returns a usable embedding.
 */
export async function embedWithConfiguredCascade(
  text: string,
  opts?: { skipLocal?: boolean },
): Promise<EmbedCascadeResult | null> {
  const cfg = getEmbeddingCascadeConfig();
  const providers = opts?.skipLocal
    ? cfg.cascade.filter((p) => p !== 'local')
    : cfg.cascade;

  for (const provider of providers) {
    try {
      let emb: number[] | null = null;
      const model = cfg.models[provider === 'google' ? 'gemini' : provider] || provider;

      if (provider === 'gemini' || provider === 'google') {
        emb = await tryGemini(text, model);
      } else if (provider === 'bedrock') {
        emb = await tryBedrock(text, model);
      } else if (provider === 'openrouter') {
        const key = process.env.OPENROUTER_API_KEY || '';
        emb = await tryOpenAICompatible(
          text,
          model,
          'https://openrouter.ai/api/v1',
          key,
          'OpenRouter',
        );
      } else if (provider === 'openai') {
        const key = process.env.OPENAI_API_KEY || process.env.NV_OPENAI_API_KEY || '';
        emb = await tryOpenAICompatible(
          text,
          model,
          'https://api.openai.com/v1',
          key,
          'OpenAI',
        );
      } else if (provider === 'local') {
        emb = localHashEmbedding(text, cfg.targetDims);
      }

      if (!dimsOk(emb, cfg.targetDims, cfg.allowDimMismatch || provider === 'local')) {
        if (emb?.length) {
          logger.warn('[EMBED-CASCADE] skipping dim mismatch', {
            provider,
            got: emb.length,
            want: cfg.targetDims,
          });
        }
        continue;
      }

      logger.info('[EMBED-CASCADE] ok', { provider, model, dims: emb.length });
      return { embedding: emb, provider, model, dims: emb.length };
    } catch (e: any) {
      logger.warn('[EMBED-CASCADE] provider error', {
        provider,
        error: e?.message || String(e),
      });
    }
  }

  logger.warn('[EMBED-CASCADE] all providers failed', { cascade: providers });
  return null;
}

/** Snapshot for admin / health / docs (no secrets). */
export function describeEmbeddingCascade(): Record<string, unknown> {
  const cfg = getEmbeddingCascadeConfig();
  return {
    cascade: cfg.cascade,
    primary: cfg.primary,
    models: cfg.models,
    targetDims: cfg.targetDims,
    allowDimMismatch: cfg.allowDimMismatch,
    envKeys: [
      'NYV_EMBEDDING_PROVIDER',
      'NYV_EMBEDDING_CASCADE',
      'NYV_GEMINI_EMBED_MODEL',
      'NYV_BEDROCK_EMBED_MODEL',
      'NYV_BEDROCK_EMBED_DIMS',
      'NYV_BEDROCK_EMBEDDINGS',
      'NYV_OPENROUTER_EMBED_MODEL',
      'NYV_OPENAI_EMBED_MODEL',
      'NYV_EMBEDDING_DIMS',
      'NYV_EMBEDDING_ALLOW_DIM_MISMATCH',
    ],
  };
}
