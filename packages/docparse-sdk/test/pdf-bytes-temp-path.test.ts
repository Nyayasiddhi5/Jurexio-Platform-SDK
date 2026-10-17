import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/pipeline/run.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'minimal.pdf');

describe('PDF bytes ingest', () => {
  it('materializes temp path and does not emit OCR_NEEDS_PATH for bytes-only PDF', async () => {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(readFileSync(FIXTURE));
    } catch {
      // Skip when minimal.pdf not present in CI without poppler fixture
      return;
    }
    const result = await run([{ bytes, fileName: 'minimal.pdf', mime: 'application/pdf' }], {
      batchId: 'bytes-pdf-test',
      actor: 'vitest',
      domainPackId: 'legal-in-civil',
      maxPagesPerDoc: 1,
    });
    const blocked = result.warnings.filter((w) => w.code === 'OCR_NEEDS_PATH');
    expect(blocked).toHaveLength(0);
  });
});
