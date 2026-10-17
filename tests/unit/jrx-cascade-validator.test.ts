/**
 * NV-MODEL-ID-VALIDATE-001 — cascade ladders must not silently drop rungs.
 *
 * `defaultSequenceFor` maps ids through `getModel()` and discards anything that
 * returns undefined, so a drifted or retired id erodes the never-fail cascade
 * with no signal whatsoever. This test is the signal. The one drift it found
 * (NV-CASCADE-DRIFT-001) is closed, so it now guards against reintroduction.
 */
import { describe, it, expect } from 'vitest';
import { validateCascadeModelIds } from '../../src/services/intelligent-router/jrx-cascade-validator.js';
import { getModel } from '../../src/services/intelligent-router/model-catalog.js';

const report = validateCascadeModelIds();

/**
 * NV-CASCADE-DRIFT-001 (closed 2026-08-16).
 *
 * This validator's first run found one real drift:
 *
 *   src/config/jrx-llm-routing-policy.ts:62  BEDROCK_CLAUDE_FAST
 *     'us.anthropic.claude-haiku-4-5-20251001-v1:0'
 *
 * Only the `global.` inference profile for Haiku 4.5 exists in the catalog
 * (`model-catalog.ts`), so the `us.` twin resolved to undefined and the rung was
 * dropped from every `plus`/`pro`/`enterprise`/`superadmin` ladder whenever
 * Bedrock routing was enabled. The dead rung has since been removed, so the
 * expectation is now inverted: ZERO unresolvable ids. Any reintroduced drift —
 * that id or any other — fails the suite.
 */
const KNOWN_UNRESOLVED = new Set<string>();

describe('./jrx-cascade-validator', () => {
  it('actually exercises the whole ladder matrix', () => {
    expect(report.laddersChecked).toBeGreaterThan(100);
    expect(report.idsChecked).toBeGreaterThan(20);
  });

  it('detects the ids that ladders silently drop', () => {
    // Proof the check still has teeth even with nothing left to find: the
    // resolver must reject a bogus id, and must accept the real Haiku profile
    // that replaced the drifted `us.` twin. Without both halves, a validator
    // that resolved everything (or nothing) would pass vacuously.
    expect(getModel('us.anthropic.claude-does-not-exist-v9:0')).toBeUndefined();
    expect(getModel('global.anthropic.claude-haiku-4-5-20251001-v1:0')).toBeDefined();
  });

  it('has no cascade id drift beyond the documented, externally-owned one', () => {
    const unexpected = [
      ...new Set(
        report.issues
          .filter((i) => i.kind === 'unresolvable_id' && !KNOWN_UNRESOLVED.has(i.detail))
          .map((i) => `${i.detail} @ ${i.context}`),
      ),
    ];
    expect(unexpected, 'unresolvable cascade ids are silently dropped from the ladder').toEqual([]);
  });

  it('no ladder resolves to zero rungs', () => {
    const empty = report.issues.filter((i) => i.kind === 'empty_sequence');
    expect(empty.map((i) => i.context)).toEqual([]);
  });

  it('every ladder still terminates in the free sovereign rung (NV-NEVER-EMPTY-001)', () => {
    const missing = report.issues.filter((i) => i.kind === 'no_terminal_fallback');
    expect(
      missing.map((i) => i.context),
      'a ladder without AgentZero can be emptied by cost/breaker filtering',
    ).toEqual([]);
  });

  it('reports ok now that the documented drift is closed', () => {
    // `ok` is the boot gate's input. It must reflect reality in BOTH directions:
    // it reported false while the drift was open, and must report true now that
    // the dead rung is gone — advisory kinds (dropped_lead / blocked_note) are
    // excluded on purpose because a lead can be legitimately filtered by cost or
    // a missing provider key.
    expect(report.ok).toBe(true);
    expect(report.issues.some((i) => i.kind === 'unresolvable_id')).toBe(false);
  });
});
