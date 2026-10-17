import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('./jrx-stt-service OpenRouter cascade', () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    for (const k of [
      'GEMINI_API_KEY', 'GOOGLE_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY',
      'DEEPGRAM_API_KEY', 'NYV_GEMINI_STT_MODEL', 'NYV_OPENROUTER_STT_MODEL',
    ]) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('cascades gemini failure to openrouter-whisper when OPENROUTER_API_KEY is set', async () => {
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.OPENROUTER_API_KEY = 'or-test-key';

    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('generativelanguage.googleapis.com')) {
        return new Response('quota exceeded', { status: 429 });
      }
      if (u.includes('openrouter.ai') && u.includes('/audio/transcriptions')) {
        return Response.json({ text: 'anticipatory bail under BNSS', language: 'en', duration: 1.2 });
      }
      return new Response('unexpected', { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { getSttService } = await import('../../src/services/jrx-stt-service.js');
    const svc = getSttService();
    const wav = Buffer.alloc(256, 1);
    const result = await svc.transcribeBatch(wav, { language: 'en-IN', encoding: 'wav' });

    expect(result.isSimulation).toBe(false);
    expect(result.provider).toBe('openrouter-whisper');
    expect(result.text).toContain('anticipatory bail');
    expect(fetchMock).toHaveBeenCalled();
    const orCall = fetchMock.mock.calls.find((c) => String(c[0]).includes('openrouter.ai'));
    expect(orCall).toBeTruthy();
  });

  it('reports openrouter-whisper availability in getAvailableProviders', async () => {
    process.env.OPENROUTER_API_KEY = 'or-test-key';
    const { getSttService } = await import('../../src/services/jrx-stt-service.js');
    const svc = getSttService();
    expect(svc.getAvailableProviders()['openrouter-whisper']).toBe(true);
  });
});
