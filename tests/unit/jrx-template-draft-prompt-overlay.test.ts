import { describe, expect, it } from 'vitest';
import { formatMatterRecallBlock } from '../../src/services/jrx-legal-drafting-prompt.js';
import { formatTemplateDraftOverlay } from '../../src/services/jrx-template-draft-prompt-overlay.js';

describe('NV-OPTION-B Phase 3 overlays', () => {
  it('formatMatterRecallBlock accepts string summary', () => {
    const block = formatMatterRecallBlock({
      matterRecall: 'CS 55/2023 judgment dated 2024-01-12; review limited to para 42 error apparent.',
    });
    expect(block).toContain('MATTER RECALL');
    expect(block).toContain('para 42');
  });

  it('formatMatterRecallBlock accepts structured matter object', () => {
    const block = formatMatterRecallBlock({
      matter: {
        summary: 'Money recovery suit at Bengaluru',
        stage: 'written statement filed',
      },
    });
    expect(block).toContain('Money recovery');
  });

  it('formatTemplateDraftOverlay returns empty without templateId', () => {
    expect(formatTemplateDraftOverlay({ documentType: 'bail_application' })).toBe('');
  });
});
