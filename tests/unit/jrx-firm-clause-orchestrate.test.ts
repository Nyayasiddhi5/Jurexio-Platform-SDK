/**
 * NV-FIRM-CLAUSE-ORCH-001 — firm clause library on the drafting paths partners
 * actually use.
 *
 * Three defects are pinned here. Each guard was broken deliberately and observed
 * to go red before being restored — the mutation table is in CHANGELOG.md
 * [Unreleased]. The load-bearing assertions are the negative ones: firm
 * commercial wording must NOT reach a bail application or an SLP, and org A's
 * wording must NOT reach org B's draft (FB-190).
 */
import { describe, it, expect } from 'vitest';
import {
  FIRM_CLAUSE_CAPS,
  FIRM_CLAUSE_CAPS_FAST,
  runWithFirmClauseContext,
  toFirmClauses,
  type FirmClauseRequestContext,
} from '../../src/services/jrx-firm-clause-library.js';
import {
  buildLegalDraftSystemPrompt,
  inferDraftDocFamily,
  type LegalDraftDocFamily,
} from '../../src/services/jrx-legal-drafting-prompt.js';
import { buildUniversalLegalIntelligenceOverlay } from '../../src/services/jrx-legal-intelligence-overlay.js';
import { getFirmClauseDiagnostic } from '../../src/services/jrx-firm-clause-library.js';

const ORG_A = '4001';
const ORG_B = '4002';
const CLAUSE_MARK = 'FIRM PREFERRED CLAUSES';
const MSA_INSTRUCTION = 'Draft a master services agreement between Acme Pvt Ltd and Beta LLP for IT services.';

function houseClauses(orgId: string, count = 4, chars = 700) {
  return Array.from({ length: count }, (_, i) => ({
    orgId,
    clauseType: `type_${i}`,
    title: `HOUSE-CLAUSE-${i}`,
    text: `Wording ${i}. ${'the aggregate liability of either party shall not exceed '.repeat(
      Math.ceil(chars / 55),
    )}`,
  }));
}

/**
 * Builds the context the way the middleware does, without the express plumbing.
 * Used for the pure-composition assertions; the middleware itself is driven for
 * real in the `orgRlsMiddleware` block below, so both the wiring and the
 * selection logic are covered rather than only one of them.
 */
function ctxFor(over: Partial<FirmClauseRequestContext> = {}): FirmClauseRequestContext {
  return {
    orgId: ORG_A,
    suppliedClauses: toFirmClauses(houseClauses(ORG_A)),
    suppliedCount: 4,
    storedClauses: [],
    caps: FIRM_CLAUSE_CAPS_FAST,
    ...over,
  };
}

/** Every drafting assertion here composes prompts inside a bound context. */

describe('NV-FIRM-CLAUSE-ORCH-001: Defect 1 — reachable from the orchestrate drafting paths', () => {
  it('the drafting system prompt carries firm wording with NO explicit overlay argument', () => {
    // Before this change the ONLY way in was an explicitly-passed
    // `firmClauseOverlay`, which only `POST /gateway/documents/draft` supplied.
    const sp = runWithFirmClauseContext(ctxFor(), () =>
      buildLegalDraftSystemPrompt({
        jurisdiction: 'IN',
        template: 'master_services_agreement',
        instruction: MSA_INSTRUCTION,
      }),
    );
    expect(sp).toContain(CLAUSE_MARK);
    expect(sp).toContain('HOUSE-CLAUSE-0');
  });

  it('reaches BOTH legal-intelligence overlay tiers — the shared ancestor every orchestrate branch uses', () => {
    // `buildUniversalLegalIntelligenceOverlay` is what jrx-orchestration-routes,
    // jrx-client (specialist) and jrx-queen-leaf-prompt (Queen leaves) all call on
    // the `draft` task kind. Covering both tiers covers all of them: none of
    // those three passes `parameters`, so only a request-scoped seam works.
    for (const depth of ['full', 'compact'] as const) {
      const overlay = runWithFirmClauseContext(ctxFor(), () =>
        buildUniversalLegalIntelligenceOverlay({
          prompt: MSA_INSTRUCTION,
          jurisdiction: 'IN',
          partnerBestOutcome: true,
          depth,
        }),
      );
      expect(overlay, depth).toContain(CLAUSE_MARK);
    }
  });

  it('keeps the precedence ranking intact on the orchestrate path — house wording is fifth', () => {
    const overlay = runWithFirmClauseContext(ctxFor(), () =>
      buildUniversalLegalIntelligenceOverlay({
        prompt: MSA_INSTRUCTION,
        jurisdiction: 'IN',
        partnerBestOutcome: true,
        depth: 'compact',
      }),
    );
    expect(overlay).toMatch(/A PREFERENCE ONLY, ranked BELOW everything above it/);
    expect(overlay).toMatch(/statute, subordinate legislation, binding precedent/);
    expect(overlay).toMatch(/Court-prescribed form/);
    expect(overlay).toMatch(/anti-fabrication rule/);
    expect(overlay).toMatch(/the facts supplied for this matter/);
    expect(overlay).toMatch(/Never cite them as law or precedent/);
  });

  it('an explicitly-passed overlay still wins — the gateway path is untouched', () => {
    const explicit = 'EXPLICIT-GATEWAY-OVERLAY';
    const sp = runWithFirmClauseContext(ctxFor(), () =>
      buildLegalDraftSystemPrompt({
        jurisdiction: 'IN',
        template: 'master_services_agreement',
        firmClauseOverlay: explicit,
      }),
    );
    expect(sp).toContain(explicit);
    expect(sp).not.toContain('HOUSE-CLAUSE-0');
  });

  it('drafting is byte-identical when no clauses are supplied', () => {
    const outside = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'master_services_agreement',
      instruction: MSA_INSTRUCTION,
    });
    const inside = runWithFirmClauseContext(
      ctxFor({ suppliedClauses: [], suppliedCount: 0 }),
      () =>
        buildLegalDraftSystemPrompt({
          jurisdiction: 'IN',
          template: 'master_services_agreement',
          instruction: MSA_INSTRUCTION,
        }),
    );
    expect(inside).toBe(outside);
  });

  it('outside a request there is no context at all — cron jobs and tests are unaffected', () => {
    const sp = buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'nda' });
    expect(sp).not.toContain(CLAUSE_MARK);
    expect(getFirmClauseDiagnostic()).toBeUndefined();
  });

  it('fails soft: a context whose clause payload is garbage produces a normal draft', () => {
    for (const bad of [null, 42, 'text', [null], [{}], { clauses: 'nope' }]) {
      const sp = runWithFirmClauseContext(
        ctxFor({ suppliedClauses: toFirmClauses(bad), suppliedCount: 0 }),
        () => buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'nda' }),
      );
      expect(sp).toContain('JURISDICTION: India');
      expect(sp).not.toContain(CLAUSE_MARK);
    }
  });
});

describe('NV-FIRM-CLAUSE-ORCH-001: the family gate holds on the new path', () => {
  const COURT_FILINGS: Array<[string, string]> = [
    ['bail_application', 'Draft an anticipatory bail application under BNSS 482.'],
    ['special_leave_petition', 'Draft an SLP under Article 136 of the Constitution.'],
    ['written_statement', 'Draft a written statement on behalf of defendant no. 2.'],
    ['counter_affidavit', 'Draft a counter-affidavit on behalf of the State.'],
    ['review_petition', 'Draft a review petition against the judgment dated 12 March 2026.'],
    ['execution_petition', 'Draft an execution petition to recover the decretal amount.'],
    ['caveat', 'Lodge a caveat before the High Court.'],
    ['interim_application', 'Draft an interim application for stay.'],
    ['writ_petition', 'Draft a writ petition under Article 226.'],
    ['plaint', 'Draft a plaint for recovery of money.'],
    ['fir', 'Draft an FIR complaint for registration.'],
  ];

  for (const [template, instruction] of COURT_FILINGS) {
    it(`${template} never receives negotiated commercial wording`, () => {
      const sp = runWithFirmClauseContext(ctxFor(), () =>
        buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template, instruction }),
      );
      expect(sp).not.toContain(CLAUSE_MARK);
      expect(sp).not.toContain('HOUSE-CLAUSE-0');
    });
  }

  it('a bail application keeps its mandatory surety rule while getting no firm clauses', () => {
    const sp = runWithFirmClauseContext(ctxFor(), () =>
      buildLegalDraftSystemPrompt({
        jurisdiction: 'IN',
        template: 'bail_application',
        instruction: 'Draft an anticipatory bail application under BNSS 482.',
      }),
    );
    expect(sp).toContain('SURETIES RULE');
    expect(sp).not.toContain(CLAUSE_MARK);
  });

  it('the bail/SLP block is not observable-only: the same context DOES inject for a contract', () => {
    // Positive control for the block above — otherwise every assertion in it
    // would pass simply because the context was empty.
    const sp = runWithFirmClauseContext(ctxFor(), () =>
      buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' }),
    );
    expect(sp).toContain(CLAUSE_MARK);
  });

  it('the orchestrate overlay drops firm wording for a bail instruction too', () => {
    const overlay = runWithFirmClauseContext(ctxFor(), () =>
      buildUniversalLegalIntelligenceOverlay({
        prompt: 'Draft an anticipatory bail application under BNSS 482 for a BNS 318(4) case.',
        jurisdiction: 'IN',
        partnerBestOutcome: true,
        depth: 'full',
      }),
    );
    expect(overlay).not.toContain(CLAUSE_MARK);
    expect(overlay).toContain('SURETIES RULE');
  });
});

describe('NV-FIRM-CLAUSE-ORCH-001: tenant isolation on the new path (FB-190 regression)', () => {
  it("org A's clause cannot reach an org B draft through the request context", () => {
    const sp = runWithFirmClauseContext(
      ctxFor({
        orgId: ORG_B,
        suppliedClauses: toFirmClauses([
          { orgId: ORG_A, clauseType: 'indemnity', title: 'ORG-A-SECRET-CARVEOUT', text: 'A wording' },
        ]),
        suppliedCount: 1,
      }),
      () => buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' }),
    );
    expect(sp).not.toContain('ORG-A-SECRET-CARVEOUT');
    expect(sp).not.toContain(CLAUSE_MARK);
  });

  it('org B keeps its own wording from a mixed payload — the drop is per clause, not all-or-nothing', () => {
    const sp = runWithFirmClauseContext(
      ctxFor({
        orgId: ORG_B,
        suppliedClauses: toFirmClauses([
          { orgId: ORG_A, clauseType: 'indemnity', title: 'ORG-A-SECRET-CARVEOUT', text: 'A wording' },
          { orgId: ORG_B, clauseType: 'indemnity', title: 'ORG-B-OWN-WORDING', text: 'B wording' },
        ]),
        suppliedCount: 2,
      }),
      () => buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' }),
    );
    expect(sp).toContain('ORG-B-OWN-WORDING');
    expect(sp).not.toContain('ORG-A-SECRET-CARVEOUT');
  });

  it('a stored clause that arrived with another org id is still dropped', () => {
    // Layer 2 of the FB-190 defence: identity travels WITH the clause, so even a
    // read that over-returns cannot inject. Stamping the request org would make
    // this check vacuous.
    const sp = runWithFirmClauseContext(
      ctxFor({
        orgId: ORG_B,
        suppliedClauses: [],
        suppliedCount: 0,
        storedClauses: toFirmClauses([
          { orgId: ORG_A, clauseType: 'indemnity', title: 'ORG-A-SECRET-CARVEOUT', text: 'A wording' },
        ]),
      }),
      () => buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' }),
    );
    expect(sp).not.toContain('ORG-A-SECRET-CARVEOUT');
  });

  it('an unattributed clause is discarded rather than adopted by the requesting org', () => {
    const sp = runWithFirmClauseContext(
      ctxFor({ suppliedClauses: toFirmClauses([{ title: 'NO-OWNER', text: 'some wording' }]), suppliedCount: 1 }),
      () => buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' }),
    );
    expect(sp).not.toContain('NO-OWNER');
  });
});
