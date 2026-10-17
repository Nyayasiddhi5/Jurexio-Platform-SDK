/**
 * NV-QUEEN-NEVER-MISS-001 — core caps always in candidates; soft-bind unbound leaves.
 */
import { describe, it, expect } from 'vitest';
import {
  discoverCandidateCapabilities,
  QUEEN_CORE_CAPABILITY_IDS,
} from '../../src/orchestration/jrx-queen-orchestrator.js';
import { resolveIntentToCapability, capabilityManifest } from '../../src/orchestration/capability-manifest.js';
import { classifyRagIntent } from '../../src/services/jrx-auto-rag-router.js';

describe('Queen never-miss capability binding', () => {
  it('always includes core caps even with sparse keywords + skills allowlist', () => {
    const caps = discoverCandidateCapabilities({
      tier: 'enterprise',
      jurisdiction: 'IN',
      keywords: ['review'],
      intent: 'research_analysis',
      domains: ['technology'],
      skillsAllowlist: ['templates.catalog', 'efiling.steps'], // omit core on purpose
    });
    const ids = new Set(caps.map((c) => c.id));
    for (const core of QUEEN_CORE_CAPABILITY_IDS) {
      expect(ids.has(core), `missing core ${core}`).toBe(true);
    }
  });

  it('resolves domain_specific and quality_check when core caps are candidates', () => {
    const caps = discoverCandidateCapabilities({
      tier: 'enterprise',
      jurisdiction: 'IN',
      keywords: ['bail', 'draft'],
      intent: 'research_analysis',
      domains: ['legal'],
    });
    const candidateIds = new Set(caps.map((c) => c.id));
    const domain = resolveIntentToCapability(['domain_specific', 'legal'], candidateIds);
    const quality = resolveIntentToCapability(['quality_check', 'qa', 'review'], candidateIds);
    expect(domain?.capabilityId).toBeTruthy();
    expect(quality?.capabilityId).toBeTruthy();
  });

  it('quality_check prefers a safety leaf when available', () => {
    const candidateIds = new Set([
      'safety.hallucination-check',
      'safety.bias-check',
      'agent.auto-select',
      'rag.search',
    ]);
    const hit = resolveIntentToCapability(['quality_check'], candidateIds);
    expect(hit?.capabilityId).toBe('safety.hallucination-check');
  });

  it('prefers agent.auto-select over rag.search for swarm_exploration', () => {
    const candidateIds = new Set(['rag.search', 'agent.auto-select']);
    const hit = resolveIntentToCapability(['swarm_exploration'], candidateIds);
    expect(hit?.capabilityId).toBe('agent.auto-select');
  });

  it('classifyRagIntent never throws on undefined/empty query', () => {
    expect(classifyRagIntent(undefined as unknown as string)).toBe('general');
    expect(classifyRagIntent('')).toBe('general');
    expect(classifyRagIntent('Section 482 BNSS anticipatory bail')).toBe('citation_lookup');
  });

  it('rag.search accepts prompt alias when query missing', async () => {
    const result = await capabilityManifest.invoke(
      'rag.search',
      { prompt: 'BNSS anticipatory bail Section 482 India' },
      { tier: 'enterprise', jurisdiction: 'IN', requestId: 'test-never-miss' },
    );
    expect(result).toBeTruthy();
    expect(typeof result).toBe('object');
    // With a non-empty prompt, must not short-circuit as empty_query
    expect((result as any).reason).not.toBe('empty_query');
  }, 30_000);
});
