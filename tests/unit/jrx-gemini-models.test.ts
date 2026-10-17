import { describe, it, expect, afterEach } from 'vitest';
import {
  getGeminiProModel,
  getGeminiFlashModel,
  getGeminiSttModel,
  getGeminiLanguageModel,
  getGeminiEmbedModel,
  getGeminiCascadeModels,
  toGeminiApiModelId,
} from '../../src/config/jrx-gemini-models.js';

const KEYS = [
  'NYV_GEMINI_PRO_MODEL',
  'NYV_GEMINI_FLASH_MODEL',
  'NYV_GEMINI_STT_MODEL',
  'NYV_GEMINI_LANGUAGE_MODEL',
  'NYV_GEMINI_EMBED_MODEL',
  'NYV_LLM_CASCADE_GEMINI',
];

describe('./jrx-gemini-models', () => {
  const prev: Record<string, string | undefined> = {};
  afterEach(() => {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  });

  function snapshot() {
    for (const k of KEYS) prev[k] = process.env[k];
  }

  it('defaults to Gemini 3.x flagship + embedding-2', () => {
    snapshot();
    for (const k of KEYS) delete process.env[k];
    expect(getGeminiProModel()).toBe('gemini-3-1-pro-preview');
    expect(getGeminiFlashModel()).toBe('gemini-3.7-flash');
    expect(getGeminiSttModel()).toBe('gemini-3.7-flash');
    expect(getGeminiLanguageModel()).toBe('gemini-3-1-pro-preview');
    expect(getGeminiEmbedModel()).toBe('gemini-embedding-2');
    expect(getGeminiCascadeModels()[0]).toBe('gemini-3.7-flash');
    expect(getGeminiCascadeModels()[1]).toBe('gemini-3-1-pro-preview');
  });

  it('maps catalog hyphen ids to Google API dotted ids', () => {
    expect(toGeminiApiModelId('gemini-3-1-pro-preview')).toBe('gemini-3.1-pro-preview');
    // Already-dotted live ids pass through untouched.
    expect(toGeminiApiModelId('gemini-3.7-flash')).toBe('gemini-3.7-flash');
  });

  it('remaps retired 2.5 ids to live models instead of dispatching a 404', () => {
    // NV-MODEL-AVAIL-PROBE-001: these ids return "no longer available to new
    // users" on the Gemini API, so dispatching them burns a full timeout + a
    // cascade hop. They must be rewritten at the boundary, not passed through.
    expect(toGeminiApiModelId('gemini-2.5-flash')).toBe('gemini-3.7-flash');
    expect(toGeminiApiModelId('gemini-2.5-pro')).toBe('gemini-3.1-pro-preview');
    expect(toGeminiApiModelId('gemini-2.5-flash-lite')).toBe('gemini-3.1-flash-lite');
  });

  it('honors env overrides', () => {
    snapshot();
    process.env.NYV_GEMINI_STT_MODEL = 'gemini-2.5-pro';
    process.env.NYV_LLM_CASCADE_GEMINI = 'gemini-2.5-flash,gemini-2.5-pro';
    expect(getGeminiSttModel()).toBe('gemini-2.5-pro');
    expect(getGeminiCascadeModels()).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
  });
});
