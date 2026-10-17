/**
 * NV-EMBEDDING-CASCADE-001 — config order (Gemini first).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getEmbeddingCascadeConfig,
  describeEmbeddingCascade,
} from '../../src/config/jrx-embedding-cascade.js';
import { describeLlmCascadeConfig } from '../../src/config/jrx-llm-cascade-config.js';

describe('./jrx-embedding-cascade config', () => {
  const prev: Record<string, string | undefined> = {};
  const keys = [
    'JRX_EMBEDDING_PROVIDER',
    'JRX_EMBEDDING_CASCADE',
    'JRX_BEDROCK_EMBEDDINGS',
    'JRX_EMBEDDING_ALLOW_DIM_MISMATCH',
  ];

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('defaults to Gemini-first then Bedrock then OpenRouter', () => {
    const cfg = getEmbeddingCascadeConfig();
    expect(cfg.cascade[0]).toBe('gemini');
    expect(cfg.cascade.slice(0, 3)).toEqual(['gemini', 'bedrock', 'openrouter']);
    expect(cfg.primary).toBe('gemini');
  });

  it('respects JRX_EMBEDDING_CASCADE env without code change', () => {
    process.env.JRX_EMBEDDING_CASCADE = 'openrouter,gemini,local';
    process.env.JRX_EMBEDDING_PROVIDER = 'auto';
    const cfg = getEmbeddingCascadeConfig();
    expect(cfg.cascade[0]).toBe('openrouter');
    expect(cfg.cascade).toContain('gemini');
  });

  it('describe helpers expose env keys for ops', () => {
    const e = describeEmbeddingCascade();
    const l = describeLlmCascadeConfig();
    expect(Array.isArray(e.envKeys)).toBe(true);
    expect(Array.isArray(l.policyOrder)).toBe(true);
  });
});
