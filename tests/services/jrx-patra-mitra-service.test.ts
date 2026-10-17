import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/orchestration/jrx-sdk-orchestration-wrapper.js', () => ({
  executeWithFullSafetyRing: vi.fn(async () => ({
    content: JSON.stringify({
      documentType: 'NDA',
      summary: '## Summary\nMutual NDA between A and B.',
      keyPoints: ['Confidentiality', '2 year term'],
      fields: [
        { key: 'party_a', label: 'Party A', value: 'Acme Ltd', confidence: 0.9 },
        { key: 'party_b', label: 'Party B', value: 'Beta Pvt Ltd', confidence: 0.9 },
      ],
    }),
    tokens: { total: 100 },
    cost: 0,
    provider: 'test',
    model: 'test',
  })),
}));

vi.mock('../../src/services/sdk/jrx-doc-content-extractor.js', () => ({
  extractDocumentText: vi.fn(async () => ({
    text: 'This Non-Disclosure Agreement is entered into between Acme Ltd and Beta Pvt Ltd on 1 January 2025. Section 3 confidentiality for 2 years. Contact legal@acme.test',
    format: 'txt',
    extractionMethod: 'text',
    bytes: 120,
    warnings: [],
  })),
}));

describe('PatraMitraService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a session with fields, summary, and supports grounded chat', async () => {
    const { patraMitraService } = await import('../../src/services/jrx-patra-mitra-service.js');
    const session = await patraMitraService.createSession({
      content: 'ignored — mocked extractor',
      fileName: 'nda.txt',
      jurisdiction: 'IN',
    });

    expect(session.sessionId).toMatch(/^pm_/);
    expect(session.summary).toContain('Mutual NDA');
    expect(session.fields.some((f) => f.value.includes('Acme'))).toBe(true);
    expect(session.documentType).toBe('NDA');
    expect(session.detectedLanguage).toBeTruthy();

    const pub = patraMitraService.toPublic(session);
    expect(pub.product?.name).toBe('Patra Mitra');
    expect((pub as any).text).toBeUndefined();
    expect(Array.isArray(pub.tools)).toBe(true);

    const listed = patraMitraService.listSessions();
    expect(listed.some((s) => s.sessionId === session.sessionId)).toBe(true);

    const parties = await patraMitraService.runTool({
      sessionId: session.sessionId,
      tool: 'extract_parties',
    });
    expect(parties.result).toBeTruthy();

    const chat = await patraMitraService.chat({
      sessionId: session.sessionId,
      message: 'Who are the parties?',
      answerLanguage: 'en',
    });
    expect(chat.answer.length).toBeGreaterThan(10);
    expect(chat.session.chat.length).toBeGreaterThanOrEqual(2);
  });
});
