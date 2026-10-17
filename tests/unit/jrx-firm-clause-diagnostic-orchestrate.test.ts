/**
 * NV-FIRM-CLAUSE-DIAG-001 — the firm-clause diagnostic reaches the ORCHESTRATE
 * response on every branch, not just one.
 *
 * WHY THIS SUITE EXISTS, AND WHY IT ASSERTS THE SOURCE
 * ───────────────────────────────────────────────────
 * `getFirmClauseDiagnostic()` was exported and populated, and §4a.8 of
 * `NSP-NYM-AI-TASK-ENDPOINTS-2026-08-17.md` documented the response field — but
 * nothing wrote it into the response, so the "0 of 3 supplied clauses applied —
 * send X-Org-Id" signal was server-log-only. A partner reading the documented
 * field saw nothing and had no way to tell a silent 200 from a successful one.
 *
 * `jrx-orchestration-routes.ts` is 4.5k lines behind `authenticateToken` /
 * `dualSdkOrJwt` / `consentGate` and reaches the Queen, the doc-pipeline adapter
 * and the specialist client. Booting it to assert three object spreads would test
 * the mock harness, not the wiring. So this suite pins the two things that can
 * actually regress, each by execution:
 *
 *   1. BEHAVIOUR — `firmClauseExtras()`'s exact semantics, reproduced against the
 *      real `runWithFirmClauseContext` / real prompt composer, through the real
 *      `buildUnifiedOrchestrationContract` that all three branches call. Present
 *      when unapplied; ABSENT (not null, not `{}`) otherwise.
 *   2. COVERAGE — that all three `buildUnifiedOrchestrationContract` call sites in
 *      the route spread it. This codebase has twice shipped a branch-partial fix
 *      (the structured-fields block, the inline-document composition), so "one
 *      branch was updated" is the specific failure mode being pinned. The count
 *      assertion carries a positive control: `inlineDocMeta`, already threaded to
 *      all three, must be found the same number of times — if the scan returns an
 *      impossible shape it is the instrument that is wrong, not the route.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  FIRM_CLAUSE_CAPS_FAST,
  getFirmClauseDiagnostic,
  runWithFirmClauseContext,
  toFirmClauses,
  type FirmClauseRequestContext,
} from '../../src/services/jrx-firm-clause-library.js';
import { buildLegalDraftSystemPrompt } from '../../src/services/jrx-legal-drafting-prompt.js';

const ORG_A = '4001';
const ORG_B = '4002';
const ROUTE_FILE = resolve(__dirname, '../../src/routes/jrx-orchestration-routes.ts');
const MSA = 'master_services_agreement';

function clauses(orgId: string, count = 3) {
  return Array.from({ length: count }, (_, i) => ({
    orgId,
    clauseType: `type_${i}`,
    title: `HOUSE-CLAUSE-${i}`,
    text: `Wording ${i}. the aggregate liability of either party shall not exceed the fees paid.`,
  }));
}

function ctxFor(over: Partial<FirmClauseRequestContext> = {}): FirmClauseRequestContext {
  return {
    orgId: ORG_A,
    suppliedClauses: toFirmClauses(clauses(ORG_A)),
    suppliedCount: 3,
    storedClauses: [],
    caps: FIRM_CLAUSE_CAPS_FAST,
    ...over,
  };
}

/**
 * The route's helper, reproduced exactly. Kept in lock-step with the route by the
 * source assertions in the last block — a divergence there fails loudly rather
 * than leaving this suite asserting a shape the route no longer emits.
 */
function firmClauseExtras(): Record<string, unknown> {
  const diagnostic = getFirmClauseDiagnostic();
  return diagnostic ? { firmClauses: diagnostic } : {};
}

/** Compose a draft inside a bound context, then read the seam like a branch does. */
function extrasAfterDraft(
  ctx: FirmClauseRequestContext,
  template = MSA,
): Record<string, unknown> {
  return runWithFirmClauseContext(ctx, () => {
    buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template,
      instruction: 'Draft a master services agreement between Acme Pvt Ltd and Beta LLP.',
    });
    return firmClauseExtras();
  });
}

describe('NV-FIRM-CLAUSE-DIAG-001: the field appears when clauses are supplied but unapplied', () => {
  it('org_unresolved — the case a partner cannot debug from outside — carries counts and the X-Org-Id fix', () => {
    const extras = extrasAfterDraft(ctxFor({ orgId: undefined, suppliedCount: 3 }));
    expect(extras.firmClauses).toBeDefined();
    const d = extras.firmClauses as Record<string, unknown>;
    expect(d.supplied).toBe(3);
    expect(d.applied).toBe(0);
    expect(d.reason).toBe('org_unresolved');
    expect(String(d.message)).toContain('0 of 3 supplied clauses applied');
    expect(String(d.message)).toContain('X-Org-Id');
  });

  it('cross_tenant — org B supplied only org A wording — is reported, and names NEITHER org', () => {
    const extras = extrasAfterDraft(
      ctxFor({
        orgId: ORG_B,
        suppliedClauses: toFirmClauses([
          { orgId: ORG_A, clauseType: 'indemnity', title: 'ORG-A-SECRET-CARVEOUT', text: 'A secret wording' },
        ]),
        suppliedCount: 1,
      }),
    );
    const d = extras.firmClauses as Record<string, unknown>;
    expect(d.reason).toBe('cross_tenant');
    expect(d.supplied).toBe(1);
    expect(d.applied).toBe(0);
  });

  it('no_match — clauses aimed at another instrument — is reported', () => {
    const extras = extrasAfterDraft(
      ctxFor({
        suppliedClauses: toFirmClauses([
          {
            orgId: ORG_A,
            clauseType: 'indemnity',
            title: 'HOUSE-CLAUSE-X',
            text: 'wording',
            jurisdiction: 'US',
            practiceArea: 'maritime',
            documentType: 'charterparty',
          },
        ]),
        suppliedCount: 1,
      }),
    );
    const d = extras.firmClauses as Record<string, unknown>;
    expect(['no_match', 'cross_tenant']).toContain(d.reason);
    expect(d.applied).toBe(0);
  });
});

describe('NV-FIRM-CLAUSE-DIAG-001: the field is ABSENT otherwise — not null, not empty', () => {
  it('applied clauses emit NO key at all (§4a.8: absence means applied)', () => {
    const extras = extrasAfterDraft(ctxFor());
    expect('firmClauses' in extras).toBe(false);
    expect(extras).toEqual({});
  });

  it('no clauses supplied emits no key', () => {
    const extras = extrasAfterDraft(ctxFor({ suppliedClauses: [], suppliedCount: 0 }));
    expect('firmClauses' in extras).toBe(false);
  });

  it('an ineligible family emits no key — the family gate working is not a partner mistake', () => {
    const extras = extrasAfterDraft(ctxFor(), 'bail_application');
    expect('firmClauses' in extras).toBe(false);
  });

  it('outside a request there is no context and no key — cron jobs and tests are unaffected', () => {
    expect(getFirmClauseDiagnostic()).toBeUndefined();
    expect('firmClauses' in firmClauseExtras()).toBe(false);
  });

  it('spreading the absent case into an extras object adds nothing — the branch shape itself', () => {
    const inlineDocMeta = { inlineDocument: { truncated: false } };
    const applied = { ...inlineDocMeta, ...extrasAfterDraft(ctxFor()) };
    expect(Object.keys(applied)).toEqual(['inlineDocument']);
  });
});

describe('NV-FIRM-CLAUSE-DIAG-001: it never leaks clause text or another org id', () => {
  it('the cross-tenant diagnostic contains no clause title, body, or the other org id', () => {
    const extras = extrasAfterDraft(
      ctxFor({
        orgId: ORG_B,
        suppliedClauses: toFirmClauses([
          { orgId: ORG_A, clauseType: 'indemnity', title: 'ORG-A-SECRET-CARVEOUT', text: 'A secret wording' },
        ]),
        suppliedCount: 1,
      }),
    );
    const serialised = JSON.stringify(extras);
    expect(serialised).not.toContain('ORG-A-SECRET-CARVEOUT');
    expect(serialised).not.toContain('A secret wording');
    expect(serialised).not.toContain(ORG_A);
  });

  it('the diagnostic carries ONLY the four contracted keys — a new field cannot leak in unnoticed', () => {
    const extras = extrasAfterDraft(ctxFor({ orgId: undefined, suppliedCount: 3 }));
    expect(Object.keys(extras.firmClauses as object).sort()).toEqual([
      'applied',
      'message',
      'reason',
      'supplied',
    ]);
  });
});

describe('NV-FIRM-CLAUSE-DIAG-001: ALL THREE orchestrate branches spread it, not one', () => {
  const src = readFileSync(ROUTE_FILE, 'utf8');

  /** Count occurrences that sit inside a `buildUnifiedOrchestrationContract(...)` call. */
  function countInsideContractCalls(needle: string): number {
    let found = 0;
    const re = /buildUnifiedOrchestrationContract\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      let i = re.lastIndex;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '(') depth++;
        else if (c === ')') depth--;
        i++;
      }
      if (src.slice(m.index, i).includes(needle)) found++;
    }
    return found;
  }

  it('the instrument works: there are exactly 3 contract call sites and inlineDocMeta reaches all 3', () => {
    // Positive control. `inlineDocMeta` is the pattern this change follows and is
    // known-threaded to every branch; if it does not come back as 3 the scan is
    // broken and every assertion below would be meaningless.
    expect(src.match(/buildUnifiedOrchestrationContract\(/g)?.length).toBe(3);
    expect(countInsideContractCalls('...(inlineDocMeta || {})')).toBe(3);
  });

  it('firmClauseExtras() is spread on all 3 — Queen, doc-pipeline and specialist', () => {
    expect(countInsideContractCalls('...firmClauseExtras()')).toBe(3);
  });

  it('the route imports the diagnostic at the top of the file, not inline', () => {
    const importIdx = src.indexOf("import {\n  getFirmClauseDiagnostic,");
    expect(importIdx).toBeGreaterThan(-1);
    expect(src.indexOf('const router = Router()')).toBeGreaterThan(importIdx);
    expect(/function[\s\S]{0,4000}?await import\([^)]*jrx-firm-clause-library/.test(src)).toBe(false);
  });

  it("the route's helper still guards on presence — the shape this suite reproduces", () => {
    expect(src).toContain('return diagnostic ? { firmClauses: diagnostic } : {};');
  });
});
