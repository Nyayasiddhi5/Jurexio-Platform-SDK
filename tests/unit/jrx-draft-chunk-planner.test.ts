import { describe, it, expect } from 'vitest';
import {
  planDraftChunks,
  shouldUseChunkedDraftGeneration,
  resolveChunkedDraftPlan,
} from '../../src/services/jrx-draft-chunk-planner.js';

describe('NV-DRAFT-CHUNK-001 planner', () => {
  it('activates for complex_agreement comprehensive tier', () => {
    expect(shouldUseChunkedDraftGeneration({
      documentType: 'complex_agreement',
      tier: 'comprehensive',
      totalTokens: 30_000,
    })).toBe(true);
  });

  it('activates when tokens exceed 40K even at medium tier', () => {
    expect(shouldUseChunkedDraftGeneration({
      documentType: 'complex_agreement',
      tier: 'medium',
      totalTokens: 45_000,
    })).toBe(true);
  });

  it('does not activate for bail_application', () => {
    expect(shouldUseChunkedDraftGeneration({
      documentType: 'bail_application',
      tier: 'comprehensive',
      totalTokens: 80_000,
    })).toBe(false);
  });

  it('plans four chunks in order outline → operative → boilerplate', () => {
    const chunks = planDraftChunks({
      prompt: 'Draft a share purchase agreement between Acme and Beta.',
      documentType: 'complex_agreement',
      tier: 'comprehensive',
      totalTokens: 120_000,
    });
    expect(chunks).toHaveLength(4);
    expect(chunks[0]!.phase).toBe('outline');
    expect(chunks[1]!.phase).toBe('operative');
    expect(chunks[2]!.phase).toBe('operative');
    expect(chunks[3]!.phase).toBe('boilerplate');
    expect(chunks[0]!.instruction).toMatch(/recitals/i);
    expect(chunks[3]!.instruction).toMatch(/IN WITNESS WHEREOF/i);
  });

  it('resolveChunkedDraftPlan from orchestrate body', () => {
    const plan = resolveChunkedDraftPlan({
      taskType: 'legal-draft-fast',
      prompt: 'Draft SPA for acquisition of Beta Ltd.',
      parameters: { documentType: 'complex_agreement' },
      options: { draftLength: 'comprehensive' },
    }, 'Draft SPA for acquisition of Beta Ltd.');
    expect(plan).not.toBeNull();
    expect(plan!.chunks.length).toBe(4);
    expect(plan!.tier).toBe('comprehensive');
  });
});
