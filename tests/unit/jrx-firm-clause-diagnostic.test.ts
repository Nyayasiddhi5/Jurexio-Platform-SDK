/**
 * NV-FIRM-CLAUSE-ORCH-001 — Defect 2 (silent `X-Org-Id`) and Defect 3
 * (allow-listed but unreachable families), plus the per-role token budget and
 * the middleware wiring.
 *
 * Companion to `nv-firm-clause-orchestrate.test.ts`. Every guard here was broken
 * deliberately and observed red; see the mutation table in CHANGELOG.md.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  FIRM_CLAUSE_CAPS,
  FIRM_CLAUSE_CAPS_FAST,
  FIRM_CLAUSE_ELIGIBLE_FAMILIES,
  firmClauseCapsForTaskType,
  firmClauseRequestContext,
  getFirmClauseDiagnostic,
  looksLikeFirmClauseCandidate,
  resolveFirmClauseOverlaySync,
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
import { orgRlsMiddleware } from '../../src/middleware/jrx-org-rls-middleware.js';
import { estimatePromptTokens, getPromptBudget } from '../../src/config/jrx-prompt-budget.js';

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

const msaPrompt = () =>
  buildLegalDraftSystemPrompt({
    jurisdiction: 'IN',
    template: 'master_services_agreement',
    instruction: MSA_INSTRUCTION,
  });

/** Drive the REAL chain: orgRlsMiddleware → firmClauseRequestContext. */
async function runRequest(
  headers: Record<string, string>,
  body: unknown,
  work: () => void,
): Promise<{ ctx?: FirmClauseRequestContext }> {
  const req = { headers, params: {}, body } as unknown as Parameters<typeof orgRlsMiddleware>[0];
  const res = { status: () => res, json: () => res, locals: {} } as unknown as Parameters<
    typeof orgRlsMiddleware
  >[1];
  let ctx: FirmClauseRequestContext | undefined;
  await new Promise<void>((resolve) => {
    orgRlsMiddleware(req, res, () => {
      firmClauseRequestContext(req, res, () => {
        ctx = (req as unknown as { nvFirmClauseContext?: FirmClauseRequestContext }).nvFirmClauseContext;
        work();
        resolve();
      });
    });
  });
  return { ctx };
}

describe('NV-FIRM-CLAUSE-ORCH-001: Defect 2 — supplied-but-not-applied is observable', () => {
  it('reports org_unresolved when the tenant fell back to the placeholder org', () => {
    // Probed on the real chain: with no `X-Org-Id` and no auth org,
    // `orgRlsMiddleware` binds the literal `default` in production. Every clause
    // is then dropped and the draft returns 200 with generic wording — the exact
    // silence this diagnostic exists to break.
    const diagnostic = runWithFirmClauseContext(ctxFor({ orgId: 'default', suppliedCount: 3 }), () => {
      msaPrompt();
      return getFirmClauseDiagnostic();
    });
    expect(diagnostic?.reason).toBe('org_unresolved');
    expect(diagnostic?.applied).toBe(0);
    expect(diagnostic?.supplied).toBe(3);
    expect(diagnostic?.message).toContain('0 of 3 supplied clauses applied');
    expect(diagnostic?.message).toMatch(/X-Org-Id/);
  });

  it('reports org_unresolved when no org was bound at all', () => {
    const diagnostic = runWithFirmClauseContext(ctxFor({ orgId: '', suppliedCount: 2 }), () => {
      msaPrompt();
      return getFirmClauseDiagnostic();
    });
    expect(diagnostic?.reason).toBe('org_unresolved');
    expect(diagnostic?.message).toContain('0 of 2 supplied clauses applied');
  });

  it('reports cross_tenant when the org resolved but owns none of the clauses', () => {
    const diagnostic = runWithFirmClauseContext(
      ctxFor({ orgId: ORG_B, suppliedClauses: toFirmClauses(houseClauses(ORG_A, 3)), suppliedCount: 3 }),
      () => {
        msaPrompt();
        return getFirmClauseDiagnostic();
      },
    );
    expect(diagnostic?.reason).toBe('cross_tenant');
    expect(diagnostic?.message).toContain('0 of 3 supplied clauses applied');
  });

  it('reports no_match when the clauses target a different instrument', () => {
    const diagnostic = runWithFirmClauseContext(
      ctxFor({
        suppliedClauses: toFirmClauses([
          {
            orgId: ORG_A,
            clauseType: 'notice_period',
            title: 'EMPLOYMENT-ONLY',
            text: 'Ninety days written notice.',
            documentTypes: ['employment_agreement'],
          },
        ]),
        suppliedCount: 1,
      }),
      () => {
        buildLegalDraftSystemPrompt({
          jurisdiction: 'IN',
          template: 'master_services_agreement',
          documentType: 'msa',
        });
        return getFirmClauseDiagnostic();
      },
    );
    expect(diagnostic?.reason).toBe('no_match');
  });

  it('NEVER echoes clause content or another org identifier in the diagnostic', () => {
    const diagnostic = runWithFirmClauseContext(
      ctxFor({
        orgId: ORG_B,
        suppliedClauses: toFirmClauses([
          { orgId: ORG_A, clauseType: 'indemnity', title: 'ORG-A-SECRET-CARVEOUT', text: 'CONFIDENTIAL-WORDING' },
        ]),
        suppliedCount: 1,
      }),
      () => {
        msaPrompt();
        return getFirmClauseDiagnostic();
      },
    );
    const serialised = JSON.stringify(diagnostic);
    expect(serialised).not.toContain(ORG_A);
    expect(serialised).not.toContain('CONFIDENTIAL-WORDING');
    expect(serialised).not.toContain('ORG-A-SECRET-CARVEOUT');
  });

  it('the request still produces a full draft — the signal is non-fatal', () => {
    const sp = runWithFirmClauseContext(ctxFor({ orgId: 'default', suppliedCount: 3 }), msaPrompt);
    expect(sp).toContain('JURISDICTION: India');
    expect(sp).toContain('STRUCTURE');
    expect(sp).toContain('OUTPUT:');
  });

  it('emits NO diagnostic when the clauses were applied, and none when nothing was supplied', () => {
    const applied = runWithFirmClauseContext(ctxFor(), () => {
      msaPrompt();
      return getFirmClauseDiagnostic();
    });
    expect(applied).toBeUndefined();

    const none = runWithFirmClauseContext(ctxFor({ suppliedClauses: [], suppliedCount: 0 }), () => {
      msaPrompt();
      return getFirmClauseDiagnostic();
    });
    expect(none).toBeUndefined();
  });

  it('an ineligible family is NOT reported as a failure — the gate working is not an error', () => {
    const diagnostic = runWithFirmClauseContext(ctxFor(), () => {
      buildLegalDraftSystemPrompt({
        jurisdiction: 'IN',
        template: 'bail_application',
        instruction: 'Draft an anticipatory bail application under BNSS 482.',
      });
      return getFirmClauseDiagnostic();
    });
    expect(diagnostic).toBeUndefined();
  });

  it('the resolver enforces the family gate on its OWN, not only via the composer', () => {
    /* Mutation finding: removing the gate from `resolveFirmClauseOverlaySync`
     * alone stays GREEN — and that is correct, because `selectFirmClauses` gates
     * again and `buildLegalDraftSystemPrompt` gates a third time. It is a
     * REDUNDANT layer, not an untested one: the two layers below it each go red
     * on their own (see the mutation table in CHANGELOG.md). This test pins the
     * resolver's own contract so the redundancy stays deliberate. */
    for (const family of ['bail', 'slp', 'written_statement', 'petition', 'custom'] as const) {
      const out = runWithFirmClauseContext(ctxFor(), () =>
        resolveFirmClauseOverlaySync({ family, jurisdiction: 'IN' }),
      );
      expect(out, family).toBe('');
    }
    // Positive control: the same context DOES render for an eligible family.
    const rendered = runWithFirmClauseContext(ctxFor(), () =>
      resolveFirmClauseOverlaySync({ family: 'contract', jurisdiction: 'IN' }),
    );
    expect(rendered).toContain(CLAUSE_MARK);
  });

  it('outside a bound request the resolver returns nothing for any family', () => {
    for (const family of ['contract', 'notice', 'letter', 'bail'] as const) {
      expect(resolveFirmClauseOverlaySync({ family, jurisdiction: 'IN' }), family).toBe('');
    }
  });

  it('the resolver returns an eligible-family overlay ONLY inside a bound context', () => {
    for (const family of ['bail', 'slp', 'contract', 'notice', 'letter'] as const) {
      const inContext = runWithFirmClauseContext(ctxFor(), () =>
        resolveFirmClauseOverlaySync({ family, jurisdiction: 'IN' }),
      );
      if (FIRM_CLAUSE_ELIGIBLE_FAMILIES.has(family)) {
        expect(inContext, family).toContain(CLAUSE_MARK);
      } else {
        expect(inContext, family).toBe('');
      }
    }
  });

  it('fails soft when the context itself is corrupt — the resolver never throws', () => {
    /* Found by mutation: replacing the resolver's catch with `throw err` stayed
     * GREEN, so the fail-soft promise on this path was unproven. A firm-voice
     * preference must never be able to stop a draft. */
    const corrupt = ctxFor();
    Object.defineProperty(corrupt, 'suppliedClauses', {
      // A property that throws on read is the shape of a context another layer
      // mutated, or a proxy whose backing store went away mid-request.
      get() {
        throw new Error('corrupt firm clause context');
      },
    });
    expect(() =>
      runWithFirmClauseContext(corrupt, () => resolveFirmClauseOverlaySync({ family: 'contract' })),
    ).not.toThrow();
    expect(runWithFirmClauseContext(corrupt, () => resolveFirmClauseOverlaySync({ family: 'contract' }))).toBe('');
    // And the drafting prompt is still produced in full.
    const sp = runWithFirmClauseContext(corrupt, msaPrompt);
    expect(sp).toContain('JURISDICTION: India');
    expect(sp).toContain('OUTPUT:');
  });
});

const ELIGIBLE_SLUGS: Array<[string, LegalDraftDocFamily]> = [
  ['master_services_agreement', 'contract'],
  ['services_agreement', 'contract'],
  ['legal_notice', 'notice'],
  ['engagement_letter', 'letter'],
  ['share_purchase_agreement', 'contract'],
  ['employment_agreement', 'contract'],
  ['settlement_agreement', 'contract'],
  ['franchise_agreement', 'contract'],
  ['loan_agreement', 'contract'],
  ['lease_deed', 'contract'],
  ['demand_notice', 'notice'],
  ['covering_letter', 'letter'],
  ['nda', 'contract'],
  ['msa', 'contract'],
];

/* First-match-wins with 20 families sharing the chain, so widening the
 * transactional patterns is only safe if every specific instrument still wins.
 * Asserted, never inferred from the ordering of the source. */
const MUST_NOT_SHADOW: Array<[string, LegalDraftDocFamily]> = [
  ['bail_application', 'bail'],
  ['anticipatory_bail', 'bail'],
  ['default_bail', 'bail'],
  ['special_leave_petition', 'slp'],
  ['review_petition', 'review_petition'],
  ['execution_petition', 'execution_petition'],
  ['written_statement', 'written_statement'],
  ['counter_affidavit', 'counter_affidavit'],
  ['rejoinder', 'rejoinder'],
  ['caveat', 'caveat'],
  ['interim_application', 'interim_application'],
  ['fir', 'fir'],
  ['affidavit', 'affidavit'],
  ['writ_petition', 'petition'],
  ['plaint', 'plaint'],
  ['discharge_application', 'application'],
];

describe('NV-FIRM-CLAUSE-ORCH-001: Defect 3 — realistic slugs infer an eligible family', () => {
  for (const [slug, family] of ELIGIBLE_SLUGS) {
    it(`a bare "${slug}" slug infers ${family}, which IS eligible`, () => {
      // Measured before this change: `master_services_agreement`,
      // `services_agreement`, `legal_notice` and `engagement_letter` all inferred
      // `custom` — ineligible — so firm wording silently no-op'd unless the caller
      // ALSO sent `documentType` and a real `instruction`.
      expect(inferDraftDocFamily(slug)).toBe(family);
      expect(FIRM_CLAUSE_ELIGIBLE_FAMILIES.has(family)).toBe(true);
    });
  }

  it('a bare transactional slug now actually gets the clauses injected end to end', () => {
    const sp = runWithFirmClauseContext(ctxFor(), () =>
      buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'services_agreement' }),
    );
    expect(sp).toContain(CLAUSE_MARK);
  });

  for (const [slug, family] of MUST_NOT_SHADOW) {
    it(`"${slug}" still infers ${family} — the widened patterns do not shadow it`, () => {
      const got = inferDraftDocFamily(slug);
      expect(got).toBe(family);
      expect(FIRM_CLAUSE_ELIGIBLE_FAMILIES.has(got)).toBe(false);
    });
  }

  it('prose phrasings that already worked still route the same way', () => {
    const REGRESSION: Array<[string, LegalDraftDocFamily]> = [
      ['draft a written statement on behalf of defendant no. 3', 'written_statement'],
      ['counter-affidavit opposing the writ petition for quashing of FIR No. 221/2025', 'counter_affidavit'],
      ['execution petition; limitation under Article 136 of the Limitation Act', 'execution_petition'],
      ['petition under Article 136 of the Constitution', 'slp'],
      ['send legal notice under NI Act section 138', 'notice'],
      ['draft an NDA between the two companies', 'contract'],
      ['covering letter to the Registrar', 'letter'],
      ['prepare a legal opinion on stamp duty', 'memo'],
      ['application for interim bail on medical grounds', 'bail'],
      ['writ petition under Article 226 for quashing of the transfer order', 'petition'],
      ['draft a plaint for recovery of ₹12,00,000 with interest', 'plaint'],
      ['adjournment application for tomorrow', 'application'],
    ];
    for (const [phrasing, family] of REGRESSION) {
      expect(inferDraftDocFamily('custom', undefined, phrasing), phrasing).toBe(family);
    }
  });

  it('the transactional patterns are ordered AFTER every court family', () => {
    /* Found by mutation: a widened transactional pattern hoisted above the court
     * families stayed GREEN, because the slug corpus above happens not to contain
     * a court instrument that also names an agreement. Real filings do — a suit
     * on an agreement, a bail matter arising from a dishonoured cheque under a
     * loan agreement — so the collision is asserted directly rather than left to
     * the ordering of the source. */
    const COLLIDING: Array<[string, LegalDraftDocFamily]> = [
      ['draft a written statement to the plaint on the services agreement', 'written_statement'],
      ['counter-affidavit in the writ petition concerning the concession agreement', 'counter_affidavit'],
      ['execution petition to execute the decree passed on the loan agreement', 'execution_petition'],
      ['bail application for the accused in the cheque dishonour arising from the loan agreement', 'bail'],
      ['special leave petition against the judgment construing the shareholders agreement', 'slp'],
      ['review petition against the decree on the sale deed', 'review_petition'],
      ['plaint for specific performance of the agreement to sell', 'plaint'],
      ['writ petition challenging termination of the concession agreement', 'petition'],
      ['affidavit verifying the annexed lease deed', 'affidavit'],
      ['interim application for injunction restraining termination of the msa', 'interim_application'],
      ['rejoinder to the written statement filed on the distribution agreement', 'rejoinder'],
      ['caveat anticipating an appeal on the arbitration agreement', 'caveat'],
      ['legal notice terminating the master services agreement', 'notice'],
    ];
    for (const [phrasing, family] of COLLIDING) {
      const got = inferDraftDocFamily('custom', undefined, phrasing);
      expect(got, phrasing).toBe(family);
    }
  });

  it('a court filing that mentions an agreement gets NO firm clauses', () => {
    // The consequence of the ordering above, stated as the outcome that matters.
    for (const instruction of [
      'draft a written statement to the plaint on the services agreement',
      'bail application for the accused in the cheque dishonour arising from the loan agreement',
      'special leave petition against the judgment construing the shareholders agreement',
    ]) {
      const sp = runWithFirmClauseContext(ctxFor(), () =>
        buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'custom', instruction }),
      );
      expect(sp, instruction).not.toContain(CLAUSE_MARK);
    }
  });

  it('EVERY eligible family is reachable from inferDraftDocFamily — no dead allow-list branch', () => {
    /* The guard that would have caught `agreement`: it was allow-listed for
     * clause injection while the classifier could never return it, so the branch
     * could not execute. `agreement` has since been folded into `contract` — it
     * emitted a byte-identical skeleton, making it a synonym, not a family. */
    const corpus = [
      ...ELIGIBLE_SLUGS.map(([slug]) => slug),
      ...MUST_NOT_SHADOW.map(([slug]) => slug),
      'draft an NDA',
      'legal notice',
      'engagement letter',
      'lease deed',
      'term_sheet',
      'custom',
    ];
    const produced = new Set<LegalDraftDocFamily>(corpus.map((s) => inferDraftDocFamily(s)));
    for (const family of FIRM_CLAUSE_ELIGIBLE_FAMILIES) {
      expect(produced.has(family), `${family} is allow-listed but unreachable`).toBe(true);
    }
  });

  it('a bail_application slug now reaches the bail family and its mandatory surety rule', () => {
    // Found while widening: `bail_application` inferred `custom`, because `\b`
    // does not fire between `l` and `_` — so the slug form of the one family with
    // a mandatory SME rule was receiving the generic instrument skeleton.
    expect(inferDraftDocFamily('bail_application')).toBe('bail');
    expect(buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'bail_application' })).toMatch(
      /SURETIES RULE/,
    );
  });
});

describe('NV-FIRM-CLAUSE-ORCH-001: token budget per role', () => {
  const many = houseClauses(ORG_A, 12, 900);

  function promptTokens(caps: typeof FIRM_CLAUSE_CAPS_FAST, withClauses: boolean): number {
    return runWithFirmClauseContext(
      ctxFor({
        caps,
        suppliedClauses: withClauses ? toFirmClauses(many) : [],
        suppliedCount: withClauses ? 12 : 0,
      }),
      () => estimatePromptTokens(msaPrompt()),
    );
  }

  it('the fast tier costs materially less than the gateway tier — the reduction is real', () => {
    const fastDelta = promptTokens(FIRM_CLAUSE_CAPS_FAST, true) - promptTokens(FIRM_CLAUSE_CAPS_FAST, false);
    const fullDelta = promptTokens(FIRM_CLAUSE_CAPS, true) - promptTokens(FIRM_CLAUSE_CAPS, false);
    // Measured 2026-08-19: fast 467 tok, gateway 881 tok.
    expect(fastDelta).toBeGreaterThan(0);
    expect(fastDelta).toBeLessThan(520);
    expect(fullDelta).toBeGreaterThan(fastDelta * 1.5);
    expect(fullDelta).toBeLessThanOrEqual(950);
  });

  it('a fast drafting prompt with firm wording fits the tightest tier it can land in', () => {
    /* `nv-prompt-budget` clamps a Queen exploration leaf to the `chat` tier
     * (2,500) — the tightest ceiling a drafting overlay can legitimately reach.
     * No budget was raised for this feature; the payload was reduced instead. */
    const overlay = runWithFirmClauseContext(
      ctxFor({ caps: FIRM_CLAUSE_CAPS_FAST, suppliedClauses: toFirmClauses(many), suppliedCount: 12 }),
      () =>
        buildUniversalLegalIntelligenceOverlay({
          prompt: MSA_INSTRUCTION,
          jurisdiction: 'IN',
          partnerBestOutcome: true,
          depth: 'compact',
        }),
    );
    expect(overlay).toContain(CLAUSE_MARK);
    expect(estimatePromptTokens(overlay)).toBeLessThan(getPromptBudget('chat').maxPromptTokens);
  });

  it('the gateway tier stays a small share of the drafting ceiling', () => {
    const delta = promptTokens(FIRM_CLAUSE_CAPS, true) - promptTokens(FIRM_CLAUSE_CAPS, false);
    expect(delta / getPromptBudget('drafting').maxPromptTokens).toBeLessThan(0.05);
  });

  it('caps are chosen by task type — the *-fast SLA paths get the reduced payload', () => {
    for (const fast of ['legal-draft-fast', 'doc-draft-fast', 'legal-chat-fast']) {
      expect(firmClauseCapsForTaskType(fast), fast).toBe(FIRM_CLAUSE_CAPS_FAST);
    }
    for (const wide of ['legal-draft', 'document-drafting', 'doc-draft', undefined, '']) {
      expect(firmClauseCapsForTaskType(wide), String(wide)).toBe(FIRM_CLAUSE_CAPS);
    }
  });

  it('the fast caps really do bind the payload', () => {
    const sp = runWithFirmClauseContext(
      ctxFor({ caps: FIRM_CLAUSE_CAPS_FAST, suppliedClauses: toFirmClauses(many), suppliedCount: 12 }),
      () => buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' }),
    );
    const injected = (sp.match(/^\d+\. \[type_\d+\]/gm) ?? []).length;
    expect(injected).toBe(FIRM_CLAUSE_CAPS_FAST.maxClauses);
  });
});

describe('NV-FIRM-CLAUSE-ORCH-001: the middleware wiring itself', () => {
  const prevEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = prevEnv;
  });

  it('binds the context on a drafting request and injects through the real chain', async () => {
    let sp = '';
    const { ctx } = await runRequest(
      { 'x-org-id': ORG_A },
      {
        taskType: 'legal-draft-fast',
        prompt: MSA_INSTRUCTION,
        parameters: { _firmClauseLibrary: { clauses: houseClauses(ORG_A) } },
      },
      () => {
        sp = msaPrompt();
      },
    );
    expect(ctx?.orgId).toBe(ORG_A);
    expect(ctx?.caps).toBe(FIRM_CLAUSE_CAPS_FAST);
    expect(sp).toContain(CLAUSE_MARK);
  });

  it('takes the org from the middleware-resolved tenant, never from the request body', async () => {
    let sp = '';
    const { ctx } = await runRequest(
      { 'x-org-id': ORG_B },
      {
        taskType: 'legal-draft-fast',
        prompt: MSA_INSTRUCTION,
        // A caller claiming to be org A must not be believed.
        orgId: ORG_A,
        organizationId: ORG_A,
        parameters: { _firmClauseLibrary: { clauses: houseClauses(ORG_A) } },
      },
      () => {
        sp = buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' });
      },
    );
    expect(ctx?.orgId).toBe(ORG_B);
    expect(sp).not.toContain('HOUSE-CLAUSE-0');
    expect(sp).not.toContain(CLAUSE_MARK);
  });

  it('accepts the payload top-level as well as nested, as §4a documents', async () => {
    for (const body of [
      { taskType: 'legal-draft', prompt: MSA_INSTRUCTION, _firmClauseLibrary: { clauses: houseClauses(ORG_A) } },
      { taskType: 'legal-draft', prompt: MSA_INSTRUCTION, parameters: { firmClauseLibrary: houseClauses(ORG_A) } },
    ]) {
      let sp = '';
      await runRequest({ 'x-org-id': ORG_A }, body, () => {
        sp = buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'master_services_agreement' });
      });
      expect(sp, JSON.stringify(Object.keys(body))).toContain(CLAUSE_MARK);
    }
  });

  it('is a no-op for a request that is not drafting-shaped', () => {
    expect(
      looksLikeFirmClauseCandidate({ taskType: 'legal-research', prompt: 'What is the limitation period?' }),
    ).toBe(false);
    expect(looksLikeFirmClauseCandidate(undefined)).toBe(false);
    // Positive control — otherwise the gate could simply be refusing everything.
    expect(looksLikeFirmClauseCandidate({ taskType: 'legal-draft-fast', prompt: MSA_INSTRUCTION })).toBe(true);
    expect(looksLikeFirmClauseCandidate({ prompt: 'x', _firmClauseLibrary: [] })).toBe(true);
  });

  it('surfaces org_unresolved through the real chain when X-Org-Id is omitted in production', async () => {
    process.env.NODE_ENV = 'production';
    let sp = '';
    let diagnostic: ReturnType<typeof getFirmClauseDiagnostic>;
    await runRequest(
      {},
      {
        taskType: 'legal-draft-fast',
        prompt: MSA_INSTRUCTION,
        parameters: { _firmClauseLibrary: { clauses: houseClauses(ORG_A, 3) } },
      },
      () => {
        sp = msaPrompt();
        diagnostic = getFirmClauseDiagnostic();
      },
    );
    expect(sp).toContain('JURISDICTION: India');
    expect(sp).not.toContain(CLAUSE_MARK);
    expect(diagnostic?.reason).toBe('org_unresolved');
    expect(diagnostic?.message).toContain('0 of 3 supplied clauses applied');
  });
});
