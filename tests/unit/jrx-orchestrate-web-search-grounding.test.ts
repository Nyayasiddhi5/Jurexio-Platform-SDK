import { describe, expect, it } from 'vitest';
import { resolveOrchestrateWantsWebSearch } from '../../src/orchestration/jrx-orchestrate-web-search-grounding.js';

describe('NV-WEB-SEARCH-STREAM-PARITY-001 resolveOrchestrateWantsWebSearch', () => {
  it('honours tools web-search', () => {
    expect(
      resolveOrchestrateWantsWebSearch({
        body: { tools: ['web-search'] },
        taskType: 'legal-chat-fast',
        groundedPrompt: 'Hello',
      }),
    ).toBe(true);
  });

  it('honours taskType web-search', () => {
    expect(
      resolveOrchestrateWantsWebSearch({
        body: {},
        taskType: 'web-search',
        groundedPrompt: 'Hello',
      }),
    ).toBe(true);
  });

  it('auto-enables for latest legal news phrasing', () => {
    expect(
      resolveOrchestrateWantsWebSearch({
        body: {},
        taskType: 'legal-chat-fast',
        groundedPrompt: 'Latest legal news on BNSS bail provisions in India',
        rawPrompt: 'Latest legal news on BNSS bail provisions in India',
      }),
    ).toBe(true);
  });

  it('negative control — generic one-liner without live-data cues', () => {
    expect(
      resolveOrchestrateWantsWebSearch({
        body: {},
        taskType: 'legal-chat-fast',
        groundedPrompt: 'Define anticipatory bail in one sentence.',
        rawPrompt: 'Define anticipatory bail in one sentence.',
      }),
    ).toBe(false);
  });
});
