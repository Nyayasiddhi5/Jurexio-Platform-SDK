import { describe, it, expect, beforeAll } from 'vitest';
import {
  JurisdictionPromptResolver,
  PromptNotFoundError,
  SUPPORTED_JURISDICTIONS,
  type JurisdictionCode,
} from '../src/services/jrx-jurisdiction-prompt-resolver.js';
import {
  inferJurisdiction,
  normaliseJurisdiction,
} from '../src/utils/jurisdiction-resolver.js';
import {
  validateJurisdictionPrompts,
  PRODUCTION_INVARIANTS,
} from '../src/startup/jrx-jurisdiction-prompt-validator.js';

describe('JurisdictionPromptResolver', () => {
  let resolver: JurisdictionPromptResolver;

  beforeAll(async () => {
    JurisdictionPromptResolver.__resetForTests();
    resolver = JurisdictionPromptResolver.getInstance();
    await resolver.init();
  });

  it('eagerly loads all 7 jurisdiction registries', () => {
    const stats = resolver.getStats();
    expect(stats.initialized).toBe(true);
    expect(stats.initializedAt).not.toBeNull();
    for (const j of SUPPORTED_JURISDICTIONS) {
      expect(stats.perJurisdiction[j]).toBeGreaterThan(0);
    }
  });

  it('matches the production invariants exactly: 6×149 + 148 = 1042 prompts', () => {
    const stats = resolver.getStats();
    expect(stats.totalPrompts).toBe(PRODUCTION_INVARIANTS.expectedTotal);
    expect(stats.totalPrompts).toBe(1042);
    expect(stats.perJurisdiction.IN).toBe(149);
    expect(stats.perJurisdiction.UK).toBe(149);
    expect(stats.perJurisdiction.US).toBe(149);
    expect(stats.perJurisdiction.EU).toBe(149);
    expect(stats.perJurisdiction.SG).toBe(149);
    expect(stats.perJurisdiction.GC).toBe(149);
    expect(stats.perJurisdiction.DEFAULT).toBe(148);
  });

  it('resolves a known agent in IN jurisdiction with 23 sections (§0-§22) and >15 KB prompt', () => {
    // v5 registry adds §0 (registry-format header) on top of §1-§22 → 23 sections.
    const r = resolver.resolvePrompt('tax-compliance', 'IN');
    expect(r.agentId).toBe('tax-compliance');
    expect(r.jurisdiction).toBe('IN');
    expect(r.sectionCount).toBe(23);
    expect(r.promptBytes).toBeGreaterThan(15_000);
    expect(r.prompt).toContain('<section_1_identity>');
    // v5 renamed §22 from `behavioral` → `version_slm` (now carries SLM
    // versioning + GRPO training signals); accept either to stay compatible
    // with both v3.x and v5.x registries.
    expect(r.prompt).toMatch(/<section_22_(behavioral|version_slm)>/);
  });

  it('resolves the same agent in DEFAULT with multi-jurisdiction context', () => {
    const r = resolver.resolvePrompt('tax-compliance', 'DEFAULT');
    expect(r.jurisdiction).toBe('DEFAULT');
    expect(r.sectionCount).toBe(23);
    expect(r.prompt.toLowerCase()).toMatch(/multi-jurisdic|all 6 jurisdictions|cross-border/);
  });

  it('throws PromptNotFoundError for unknown agent (no silent fallback)', () => {
    expect(() => resolver.resolvePrompt('does-not-exist-agent', 'IN'))
      .toThrow(PromptNotFoundError);
  });

  it('throws PromptNotFoundError for ns-queen in DEFAULT (we removed it)', () => {
    expect(() => resolver.resolvePrompt('ns-queen', 'DEFAULT'))
      .toThrow(PromptNotFoundError);
    // But still present in IN (149 agents include ns-queen)
    expect(resolver.hasPrompt('ns-queen', 'IN')).toBe(true);
  });

  it('tryResolvePrompt returns null instead of throwing', () => {
    expect(resolver.tryResolvePrompt('does-not-exist-agent', 'IN')).toBeNull();
    expect(resolver.tryResolvePrompt('tax-compliance', 'IN')).not.toBeNull();
  });

  it('every loaded prompt contains all 22 section tags', () => {
    let checked = 0;
    for (const j of SUPPORTED_JURISDICTIONS) {
      // Sample 5 agents per jurisdiction (full sweep is in the validator)
      const stats = resolver.getStats();
      if (stats.perJurisdiction[j] === 0) continue;
      const sampleAgents = ['tax-compliance', 'contract-review', 'litigation-strategy'];
      for (const aid of sampleAgents) {
        if (!resolver.hasPrompt(aid, j)) continue;
        const r = resolver.resolvePrompt(aid, j);
        for (let n = 1; n <= 22; n++) {
          expect(r.prompt).toMatch(new RegExp(`<section_${n}_[a-z_]+>`));
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe('jurisdiction inference chain', () => {
  it('uses explicit when present', () => {
    const out = inferJurisdiction({ explicit: 'UK', userProfile: 'IN', tenantDefault: 'US' });
    expect(out.jurisdiction).toBe('UK');
    expect(out.source).toBe('explicit');
  });

  it('falls back to user-profile when explicit is missing', () => {
    const out = inferJurisdiction({ explicit: null, userProfile: 'EU' });
    expect(out.jurisdiction).toBe('EU');
    expect(out.source).toBe('user-profile');
  });

  it('falls back to tenant-default when explicit & profile are missing', () => {
    const out = inferJurisdiction({ tenantDefault: 'SG' });
    expect(out.jurisdiction).toBe('SG');
    expect(out.source).toBe('tenant-default');
  });

  it('falls back to platform default (India-first → IN) when nothing is supplied', () => {
    // Platform-default policy is India-first: no juris → IN registry, not DEFAULT.
    // DEFAULT is reserved for agents that only exist there. See
    // src/utils/jurisdiction-resolver.ts inferJurisdiction() for rationale.
    const out = inferJurisdiction({});
    expect(out.jurisdiction).toBe('IN');
    expect(out.source).toBe('platform-default');
    expect(out.warnedAt).not.toBeNull();
  });

  it('normalises common aliases', () => {
    expect(normaliseJurisdiction('India')).toBe('IN');
    expect(normaliseJurisdiction('GBR')).toBe('UK');
    expect(normaliseJurisdiction('USA')).toBe('US');
    expect(normaliseJurisdiction('Singapore')).toBe('SG');
    expect(normaliseJurisdiction('GCC')).toBe('GC');
    expect(normaliseJurisdiction('european union')).toBe('EU');
    expect(normaliseJurisdiction('ALL')).toBe('DEFAULT');
    expect(normaliseJurisdiction('garbage')).toBeNull();
  });
});

describe('production invariants', () => {
  it('startup validator returns ok=true on a healthy install', async () => {
    const out = await validateJurisdictionPrompts();
    expect(out.ok).toBe(true);
    expect(out.failures).toEqual([]);
    expect(out.loadedTotal).toBe(out.expectedTotal);
    expect(out.loadedTotal).toBe(1042);
  });
});
