/**
 * NV-MD-BOLD-BULLET-001 — `fix-bullet-spacing` must not split `**bold**`.
 */
import { describe, it, expect } from 'vitest';
import { responseEngineeringPipeline } from '../../src/orchestration/jrx-response-engineering-pipeline.js';
import {
  applyLegalResponseFormatting,
  repairSplitBoldMarkers,
} from '../../src/services/jrx-legal-response-format.js';

async function formatMarkdown(content: string): Promise<string> {
  const engineered = await responseEngineeringPipeline.process(
    { content },
    {
      enableSanitization: false,
      enableQualityCheck: false,
      enableTranslation: false,
      enableFormatting: true,
      format: 'markdown',
    },
  );
  return engineered.processed.content;
}

describe('repairSplitBoldMarkers', () => {
  it('rejoins `* *HEADING**` into `**HEADING**`', () => {
    expect(repairSplitBoldMarkers('* *ISSUE & SHORT ANSWER**\nBody')).toBe(
      '**ISSUE & SHORT ANSWER**\nBody',
    );
  });

  it('leaves real italic+bold list items alone', () => {
    expect(repairSplitBoldMarkers('* **bold item**')).toBe('* **bold item**');
  });
});

describe('response engineering bullet vs bold', () => {
  it('does not turn line-start **bold** into * *bold**', async () => {
    const out = await formatMarkdown('**ISSUE & SHORT ANSWER**\n\nUnder Section 10.');
    expect(out).toContain('**ISSUE & SHORT ANSWER**');
    expect(out).not.toMatch(/^\* \*ISSUE/m);
  });

  it('repairs already-split bold headings', async () => {
    const out = await formatMarkdown('* *BY SPEED POST / REGISTERED POST**\n\nTo,');
    expect(out).toContain('**BY SPEED POST / REGISTERED POST**');
    expect(out).not.toMatch(/^\* \*BY SPEED/m);
  });

  it('still normalizes a single-asterisk bullet', async () => {
    const out = await formatMarkdown('*item one\n*  item two');
    expect(out).toMatch(/^\* item one/m);
    expect(out).toMatch(/^\* item two/m);
  });

  it('does not break a thematic break', async () => {
    const out = await formatMarkdown('Para\n\n---\n\nNext');
    expect(out).toContain('---');
    expect(out).not.toContain('- --');
  });
});

describe('applyLegalResponseFormatting repairs split bold', () => {
  it('fixes counsel chrome headings before other polish', () => {
    const out = applyLegalResponseFormatting('* *REASONING TRACE (Step-by-Step Analysis)**\n\nThe Bharatiya Nyaya Sanhita.', {
      jurisdiction: 'IN',
      taskType: 'chat',
      includeDisclaimer: false,
    });
    expect(out).toContain('**REASONING TRACE (Step-by-Step Analysis)**');
    expect(out).not.toMatch(/^\* \*REASONING/m);
  });
});
