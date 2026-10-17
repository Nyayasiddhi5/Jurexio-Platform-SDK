/**
 * NV-PARSED-DOC-AUTOFILL-001 — autofill reads exclude raw_content projection.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('production-doc-processor autofill projection', () => {
  it('defines loadParsedDocumentForAutofill without SELECT *', () => {
    const file = fs.readFileSync(
      path.join(process.cwd(), 'src/services/document-pipeline/production-doc-processor.ts'),
      'utf8',
    );
    expect(file).toContain('loadParsedDocumentForAutofill');
    expect(file).toContain('loadParsedDocumentFull');
    expect(file).toContain('PARSED_DOC_AUTOFILL_COLUMNS');
    expect(file).not.toMatch(/loadParsedDocumentForAutofill[\s\S]*SELECT \* FROM ns_parsed_documents/);
    expect(file).toMatch(/loadParsedDocumentForAutofill[\s\S]*PARSED_DOC_AUTOFILL_COLUMNS[\s\S]*FROM ns_parsed_documents/);
    expect(file).toMatch(/loadParsedDocumentFull[\s\S]*raw_content[\s\S]*FROM ns_parsed_documents/);
  });
});
