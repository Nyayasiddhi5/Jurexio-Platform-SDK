import { describe, it, expect, afterEach } from 'vitest';
import {
  getLanguageProvider,
  isSarvamSttEnabled,
  isSarvamTranslateEnabled,
} from '../../src/utils/jrx-language-provider.js';

const KEYS = [
  'NYV_LANGUAGE_PROVIDER',
  'NYV_SARVAM_ENABLED',
  'NYV_SARVAM_STT_ENABLED',
  'NYV_SARVAM_TTS_ENABLED',
  'SARVAM_API_KEY',
  'NYV_SARVAM_API_KEY',
];

describe('./jrx-language-provider', () => {
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

  it('defaults to gemini (Sarvam off until keys ready)', () => {
    snapshot();
    for (const k of KEYS) delete process.env[k];
    expect(getLanguageProvider()).toBe('gemini');
    expect(isSarvamSttEnabled()).toBe(false);
    expect(isSarvamTranslateEnabled()).toBe(false);
  });

  it('opt-in to sarvam via NYV_LANGUAGE_PROVIDER=sarvam + key', () => {
    snapshot();
    process.env.NYV_LANGUAGE_PROVIDER = 'sarvam';
    process.env.SARVAM_API_KEY = 'test-key';
    expect(getLanguageProvider()).toBe('sarvam');
    expect(isSarvamSttEnabled()).toBe(true);
  });

  it('sarvam flag without key falls back to gemini for provider resolution', () => {
    snapshot();
    delete process.env.NYV_LANGUAGE_PROVIDER;
    delete process.env.SARVAM_API_KEY;
    delete process.env.NYV_SARVAM_API_KEY;
    process.env.NYV_SARVAM_STT_ENABLED = '1';
    expect(getLanguageProvider()).toBe('gemini');
  });
});
