import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runNspEvidenceDepict } from '../jrx-docparse-nsp-evidence-depict-service.js';

vi.mock('../jrx-vision-json-llm.js', () => ({
  executeVisionJsonLlm: vi.fn(),
}));

describe('runNspEvidenceDepict', () => {
  const prevFlag = process.env.JRX_F_DOCPARSE_EVIDENCE_DEPICT;

  beforeEach(() => {
    process.env.JRX_F_DOCPARSE_EVIDENCE_DEPICT = '1';
  });

  afterEach(() => {
    vi.resetAllMocks();
    if (prevFlag === undefined) delete process.env.JRX_F_DOCPARSE_EVIDENCE_DEPICT;
    else process.env.JRX_F_DOCPARSE_EVIDENCE_DEPICT = prevFlag;
  });

  it('maps vision JSON to depict response', async () => {
    const { executeVisionJsonLlm } = await import('../jrx-vision-json-llm.js');
    (executeVisionJsonLlm as ReturnType<typeof vi.fn>).mockResolvedValue({
      content: JSON.stringify({
        depiction: 'A small solid color region.',
        limitations: 'Low resolution image.',
        suggested_tags: ['probe'],
        pii_flags: [],
      }),
      model: 'gemini-test',
      provider: 'gemini',
    });

    const bytes = Buffer.from('fake-image');
    const out = await runNspEvidenceDepict({
      bytes,
      fileName: 'probe.png',
      mimeType: 'image/png',
    });

    expect(out.mode).toBe('nsp-evidence-depict');
    expect(out.depiction.text).toContain('solid color');
    expect(out.contentSha256).toHaveLength(64);
  });
});
