/**
 * NV-DOCPARSE-INGEST-001 — ingest bytes resolution tests.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveIngestBytes,
  toCourtDocExtractOptions,
  DOCPARSE_BATCH_DOC_LIMIT,
} from '../../src/services/jrx-docparse-ingest-helper.js';

const PDF_B64 = Buffer.from('%PDF-1.4 test').toString('base64');

describe('NV-DOCPARSE-INGEST-001', () => {
  it('resolves primary bytes from base64', () => {
    const ctx = resolveIngestBytes({ base64: PDF_B64, fileName: 'fir.pdf' });
    expect(ctx.primary?.fileName).toBe('fir.pdf');
    expect(ctx.primary?.bytes.length).toBeGreaterThan(0);
    expect(ctx.batch.length).toBe(1);
  });

  it('resolves documentBase64 alias', () => {
    const ctx = resolveIngestBytes({ documentBase64: PDF_B64, fileName: 'plaint.pdf' });
    expect(ctx.primary?.fileName).toBe('plaint.pdf');
  });

  it('caps documents[] batch at DOCPARSE_BATCH_DOC_LIMIT', () => {
    const docs = Array.from({ length: 8 }, (_, i) => ({
      base64: PDF_B64,
      fileName: `doc${i}.pdf`,
    }));
    const ctx = resolveIngestBytes({ documents: docs });
    expect(ctx.batch.length).toBe(DOCPARSE_BATCH_DOC_LIMIT);
  });

  it('builds court extract options with batch documents', () => {
    const ctx = resolveIngestBytes({
      base64: PDF_B64,
      fileName: 'a.pdf',
      documents: [{ base64: PDF_B64, fileName: 'b.pdf' }],
    });
    const opts = toCourtDocExtractOptions(ctx, { batchId: 'b1', actor: 'test' });
    expect(opts?.bytes?.length).toBeGreaterThan(0);
    expect(opts?.documents?.length).toBe(2);
  });
});
