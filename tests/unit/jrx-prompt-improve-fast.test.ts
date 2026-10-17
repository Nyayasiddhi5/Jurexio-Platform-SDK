/**
 * NV-PROMPT-IMPROVE-FAST-001 — deterministic prompt improve tests.
 */
import { describe, it, expect } from 'vitest';
import {
  improvePromptFast,
  sanitizeUserFacingImprovedPrompt,
  buildUserFacingPromptBrief,
  INTERNAL_IMPROVE_PROMPT_MARKERS,
} from '../../src/services/jrx-prompt-improve-fast.js';

describe('NV-PROMPT-IMPROVE-FAST-001', () => {
  it('returns an improved prompt with metadata', async () => {
    const result = await improvePromptFast({
      prompt: 'Draft bail application for FIR 123/2026',
      taskType: 'legal-draft-fast',
      jurisdiction: 'IN',
    });

    expect(result.improvedPrompt.length).toBeGreaterThan(0);
    expect(result.metadata.enhancementsApplied).toContain('analyzePrompt-lite');
    expect(result.metadata.enhancementsApplied).toContain('user-facing-brief-enrichment');
    expect(result.metadata.model).toBe('deterministic-v1');
    expect(result.metadata.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.metadata.complexity).toBeTruthy();
  });

  it('does not leak internal JRX system overlays (NV-PROMPT-IMPROVE-USER-001)', async () => {
    const result = await improvePromptFast({
      prompt: 'Draft bail application for FIR 123/2026',
      taskType: 'legal-draft-fast',
      jurisdiction: 'IN',
    });

    for (const marker of INTERNAL_IMPROVE_PROMPT_MARKERS) {
      expect(result.improvedPrompt).not.toContain(marker);
    }
    expect(result.improvedPrompt).not.toContain('Domain Context:');
    expect(result.improvedPrompt).toContain('User brief:');
    expect(result.improvedPrompt).toContain('Draft bail application for FIR 123/2026');
  });

  it('cache-hits on identical input', async () => {
    const input = {
      prompt: 'Summarize contract indemnity clause risks',
      taskType: 'legal-chat-fast',
      jurisdiction: 'IN',
    };
    const first = await improvePromptFast(input);
    const second = await improvePromptFast(input);

    expect(second.improvedPrompt).toBe(first.improvedPrompt);
    expect(second.metadata.cacheHit).toBe(true);
    expect(second.metadata.latencyMs).toBeLessThan(first.metadata.latencyMs + 50);
  });

  it('rejects empty prompt', async () => {
    await expect(improvePromptFast({ prompt: '   ' })).rejects.toThrow('prompt is required');
  });

  it('sanitizeUserFacingImprovedPrompt strips Context wrapper and internal markers', () => {
    const leaked = `Context:\nDomain Context: NV-LEGAL-INTEL-FORCE-001\nNON-NEGOTIABLE\n\nRequest:\nUser brief: Draft notice under NI Act`;
    expect(sanitizeUserFacingImprovedPrompt(leaked)).toBe('User brief: Draft notice under NI Act');
  });

  it('buildUserFacingPromptBrief preserves long prompts with jurisdiction hint', () => {
    const long = 'A'.repeat(500);
    const out = buildUserFacingPromptBrief(long, { jurisdiction: 'IN', taskKind: 'draft' });
    expect(out).toContain(long);
    expect(out).toContain('Jurisdiction: IN');
  });
});
