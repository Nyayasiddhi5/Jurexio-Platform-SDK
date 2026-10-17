/**
 * NV-FIRM-CLAUSE-DRAFT-001 — firm clause library → drafting prompt.
 *
 * The load-bearing test in this file is the cross-tenant one. The partner fixed
 * FB-190 ("clause library readable cross-tenant and injectable into other
 * firms' AI prompts") in this exact data, so a clause belonging to org A
 * appearing in org B's draft is a worse outcome than the feature not existing.
 * Each guard below was verified to be able to fail by breaking it deliberately
 * — see the mutation table in CHANGELOG.md [Unreleased].
 */
import { describe, it, expect, vi } from 'vitest';
import {
  FIRM_CLAUSE_CAPS,
  FIRM_CLAUSE_PRECEDENCE,
  firmClausesApplyTo,
  formatFirmClauseOverlay,
  loadOrgFirmClauses,
  resolveFirmClauseOverlay,
  selectFirmClauses,
  toFirmClauses,
  type FirmClause,
} from '../../src/services/jrx-firm-clause-library.js';
import { buildLegalDraftSystemPrompt } from '../../src/services/jrx-legal-drafting-prompt.js';
import { estimatePromptTokens, getPromptBudget } from '../../src/config/jrx-prompt-budget.js';

const ORG_A = '4001';
const ORG_B = '4002';

function clause(over: Partial<FirmClause> = {}): FirmClause {
  return {
    orgId: ORG_A,
    clauseType: 'indemnity',
    title: 'Mutual indemnity with fee-multiple cap',
    text: 'Each party shall indemnify the other against third-party claims arising from its breach, subject to an aggregate cap of two times the fees paid in the preceding twelve months.',
    documentTypes: [],
    practiceAreas: [],
    priority: 10,
    ...over,
  };
}

/**
 * A fake tenant transaction that behaves like the RLS-enabled table: rows are
 * only visible when the SQL carries the bound org. Modelled on the FB-190
 * failure mode rather than on Postgres — an unscoped read returns EVERY org's
 * row, which is what "readable cross-tenant" meant.
 */
function makeFakeTenantTx(rowsByOrg: Record<string, unknown>) {
  const execute = vi.fn(async (query: unknown) => {
    const text = JSON.stringify(query);
    const scoped = Object.keys(rowsByOrg).filter((org) => text.includes(org));
    const visible = scoped.length > 0 ? scoped : Object.keys(rowsByOrg);
    return {
      rows: visible.map((org) => ({ org_id: org, clause_library: rowsByOrg[org] })),
    };
  });
  return { tx: { execute }, execute };
}

describe('firm clause library — family gating', () => {
  it('applies to transactional instruments only', () => {
    for (const family of ['contract', 'notice', 'letter'] as const) {
      expect(firmClausesApplyTo(family), family).toBe(true);
    }
  });

  it('never applies to court filings — a negotiated commercial clause in a bail application or SLP is a defect', () => {
    for (const family of [
      'bail',
      'slp',
      'petition',
      'plaint',
      'affidavit',
      'review_petition',
      'written_statement',
      'counter_affidavit',
      'rejoinder',
      'execution_petition',
      'caveat',
      'interim_application',
      'fir',
      'application',
      'memo',
      'opinion',
      'custom',
    ] as const) {
      expect(firmClausesApplyTo(family), family).toBe(false);
    }
  });

  it('drops a supplied overlay for an ineligible family even when a caller passes one', () => {
    const overlay = formatFirmClauseOverlay([clause()]);
    expect(overlay).not.toBe('');

    const bail = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'bail_application',
      instruction: 'Draft an anticipatory bail application under BNSS 482.',
      firmClauseOverlay: overlay,
    });
    expect(bail).not.toContain('FIRM PREFERRED CLAUSES');
    expect(bail).toContain('SURETIES RULE');

    const slp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'special_leave_petition',
      instruction: 'Draft an SLP under Article 136.',
      firmClauseOverlay: overlay,
    });
    expect(slp).not.toContain('FIRM PREFERRED CLAUSES');
    expect(slp).toContain('PAPER-BOOK RULE');
  });

  it('injects for a contract draft and states the precedence', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'master_services_agreement',
      documentType: 'msa',
      instruction: 'Draft an MSA between the parties.',
      firmClauseOverlay: formatFirmClauseOverlay([clause()]),
    });
    expect(sp).toContain('FIRM PREFERRED CLAUSES');
    expect(sp).toContain('fee-multiple cap');
    expect(sp).toMatch(/A PREFERENCE ONLY, ranked BELOW everything above it/);
    expect(sp).toMatch(/statute, subordinate legislation, binding precedent/);
    expect(sp).toMatch(/never invent citations/);
    expect(sp).toMatch(/Never cite them as law or precedent/);
    expect(sp).toMatch(/never carry negotiated commercial positions into a Court filing/);
  });

  it('places the firm block after the mandatory rules — order reinforces the stated precedence', () => {
    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'nda',
      instruction: 'Draft a mutual NDA.',
      firmClauseOverlay: formatFirmClauseOverlay([clause()]),
    });
    expect(sp.indexOf('FIRM CLAUSE LIBRARY')).toBeGreaterThan(sp.indexOf('JURISDICTION: India'));
    expect(sp.indexOf('FIRM CLAUSE LIBRARY')).toBeGreaterThan(sp.indexOf('STRUCTURE'));
    expect(sp.indexOf('FIRM CLAUSE LIBRARY')).toBeGreaterThan(sp.indexOf('QUALITY BAR'));
    expect(sp.indexOf('FIRM CLAUSE LIBRARY')).toBeLessThan(sp.indexOf('OUTPUT:'));
  });
});

describe('firm clause library — tenant isolation (FB-190 regression)', () => {
  it('a clause owned by org A never reaches a draft for org B', () => {
    const orgAClause = clause({ orgId: ORG_A, title: 'ORG-A-SECRET-CARVEOUT' });
    const { selected, crossTenantDropped } = selectFirmClauses({
      clauses: [orgAClause],
      orgId: ORG_B,
      family: 'contract',
      jurisdiction: 'IN',
    });
    expect(selected).toEqual([]);
    expect(crossTenantDropped).toBe(1);

    const sp = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'services_agreement',
      firmClauseOverlay: formatFirmClauseOverlay(selected),
    });
    expect(sp).not.toContain('ORG-A-SECRET-CARVEOUT');
    expect(sp).not.toContain('FIRM PREFERRED CLAUSES');
  });

  it('keeps org B its own clause while dropping org A from the same mixed set', () => {
    const { selected, crossTenantDropped } = selectFirmClauses({
      clauses: [
        clause({ orgId: ORG_A, title: 'ORG-A-SECRET-CARVEOUT' }),
        clause({ orgId: ORG_B, title: 'ORG-B-OWN-WORDING' }),
      ],
      orgId: ORG_B,
      family: 'contract',
      jurisdiction: 'IN',
    });
    expect(selected.map((c) => c.title)).toEqual(['ORG-B-OWN-WORDING']);
    expect(crossTenantDropped).toBe(1);
  });

  it('an unattributed clause is discarded, not adopted by the requesting org', () => {
    // Defaulting a missing owner to the caller is how a shared/global row
    // becomes "the firm's wording" — and how another firm's row would too.
    expect(toFirmClauses([{ title: 'no owner', text: 'some wording' }])).toEqual([]);
  });

  it('drops rows the DB over-returned — the read filter is not the only guard', async () => {
    // Simulates the FB-190 shape directly: the query comes back with BOTH orgs'
    // rows (permissive policy / forgotten WHERE). Nothing may cross.
    const overReturning = {
      execute: vi.fn(async () => ({
        rows: [
          { org_id: ORG_A, clause_library: [{ orgId: ORG_A, title: 'ORG-A-SECRET-CARVEOUT', text: 'A wording', clauseType: 'indemnity' }] },
          { org_id: ORG_B, clause_library: [{ orgId: ORG_B, title: 'ORG-B-OWN-WORDING', text: 'B wording', clauseType: 'indemnity' }] },
        ],
      })),
    };
    const overlay = await resolveFirmClauseOverlay({
      orgId: ORG_B,
      family: 'contract',
      jurisdiction: 'IN',
      withTenant: async (fn) => fn(overReturning),
    });
    expect(overlay).toContain('ORG-B-OWN-WORDING');
    expect(overlay).not.toContain('ORG-A-SECRET-CARVEOUT');
  });

  it('the tenant-scoped read carries the bound org in the SQL and stamps identity from the row', async () => {
    const { tx, execute } = makeFakeTenantTx({
      [ORG_A]: [{ orgId: ORG_A, title: 'A', text: 'A wording', clauseType: 'indemnity' }],
      [ORG_B]: [{ orgId: ORG_B, title: 'B', text: 'B wording', clauseType: 'indemnity' }],
    });
    const loaded = await loadOrgFirmClauses(ORG_B, tx);
    expect(JSON.stringify(execute.mock.calls[0]?.[0])).toContain(ORG_B);
    expect(loaded.map((c) => c.orgId)).toEqual([ORG_B]);
  });

  it('resolveFirmClauseOverlay reads through the tenant handle it is given, not the global pool', async () => {
    const { tx, execute } = makeFakeTenantTx({
      [ORG_A]: [{ orgId: ORG_A, title: 'A', text: 'A wording', clauseType: 'indemnity' }],
    });
    const withTenant = vi.fn(async <T,>(fn: (t: typeof tx) => Promise<T>) => fn(tx));
    const overlay = await resolveFirmClauseOverlay({
      orgId: ORG_A,
      family: 'contract',
      jurisdiction: 'IN',
      withTenant: withTenant as never,
    });
    expect(withTenant).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(overlay).toContain('A wording');
  });
});

describe('firm clause library — relevance, not dumping', () => {
  it('keeps a clause targeted at the instrument being drafted', () => {
    const { selected } = selectFirmClauses({
      clauses: [clause({ documentTypes: ['msa'], title: 'MSA-TARGETED' })],
      orgId: ORG_A,
      family: 'contract',
      documentType: 'msa',
      jurisdiction: 'IN',
    });
    expect(selected.map((c) => c.title)).toEqual(['MSA-TARGETED']);
  });

  it('excludes a clause the firm targeted at a different instrument', () => {
    const { selected } = selectFirmClauses({
      clauses: [clause({ documentTypes: ['employment_agreement'], title: 'EMPLOYMENT-ONLY' })],
      orgId: ORG_A,
      family: 'contract',
      documentType: 'msa',
      template: 'master_services_agreement',
      jurisdiction: 'IN',
    });
    expect(selected).toEqual([]);
  });

  it('keeps a firm-wide default that names no instrument', () => {
    const { selected } = selectFirmClauses({
      clauses: [clause({ documentTypes: [], practiceAreas: [], title: 'FIRM-WIDE' })],
      orgId: ORG_A,
      family: 'contract',
      documentType: 'msa',
      jurisdiction: 'IN',
    });
    expect(selected.map((c) => c.title)).toEqual(['FIRM-WIDE']);
  });

  it('excludes a clause written for another jurisdiction', () => {
    const { selected } = selectFirmClauses({
      clauses: [clause({ jurisdiction: 'SG', title: 'SG-ONLY' })],
      orgId: ORG_A,
      family: 'contract',
      jurisdiction: 'IN',
    });
    expect(selected).toEqual([]);
  });

  it('ranks an instrument-targeted clause above a firm-wide default', () => {
    const { selected } = selectFirmClauses({
      clauses: [
        clause({ title: 'FIRM-WIDE', priority: 100 }),
        clause({ title: 'MSA-TARGETED', documentTypes: ['msa'], priority: 0 }),
      ],
      orgId: ORG_A,
      family: 'contract',
      documentType: 'msa',
      jurisdiction: 'IN',
    });
    expect(selected[0]?.title).toBe('MSA-TARGETED');
  });
});

describe('firm clause library — caps', () => {
  const many = Array.from({ length: 12 }, (_, i) =>
    clause({ title: `CLAUSE-${String(i).padStart(2, '0')}`, text: 'x'.repeat(900), priority: 100 - i }),
  );

  it('never injects more than the clause cap, and the cap is actually reachable', () => {
    const { selected } = selectFirmClauses({ clauses: many, orgId: ORG_A, family: 'contract', jurisdiction: 'IN' });
    expect(selected.length).toBeLessThanOrEqual(FIRM_CLAUSE_CAPS.maxClauses);
    // Reachability matters: the first cut counted the truncation marker outside
    // the per-clause cap, so 4 x 604 > 2,400 and only three clauses ever
    // injected. A cap that cannot be reached is a cap that is not the real cap.
    expect(selected.length).toBe(FIRM_CLAUSE_CAPS.maxClauses);
  });

  it('truncates each clause to the per-clause char cap, marker included', () => {
    const { selected } = selectFirmClauses({ clauses: many, orgId: ORG_A, family: 'contract', jurisdiction: 'IN' });
    for (const c of selected) {
      expect(c.text.length, c.title).toBeLessThanOrEqual(FIRM_CLAUSE_CAPS.maxCharsPerClause);
    }
  });

  it('never exceeds the total char cap', () => {
    const { selected } = selectFirmClauses({ clauses: many, orgId: ORG_A, family: 'contract', jurisdiction: 'IN' });
    const total = selected.reduce((n, c) => n + c.text.length, 0);
    expect(total).toBeLessThanOrEqual(FIRM_CLAUSE_CAPS.maxTotalChars);
  });

  it('the worst-case injected block costs under 950 prompt tokens (measured: 880)', () => {
    const { selected } = selectFirmClauses({ clauses: many, orgId: ORG_A, family: 'contract', jurisdiction: 'IN' });
    const overlay = formatFirmClauseOverlay(selected);
    expect(estimatePromptTokens(overlay)).toBeLessThanOrEqual(950);
  });

  it('worst-case injection stays a small share of the drafting budget — no budget was raised for it', () => {
    const { selected } = selectFirmClauses({ clauses: many, orgId: ORG_A, family: 'contract', jurisdiction: 'IN' });
    const overlay = formatFirmClauseOverlay(selected);
    const base = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'master_services_agreement',
      documentType: 'msa',
      instruction: 'Draft an MSA.',
    });
    const withFirm = buildLegalDraftSystemPrompt({
      jurisdiction: 'IN',
      template: 'master_services_agreement',
      documentType: 'msa',
      instruction: 'Draft an MSA.',
      firmClauseOverlay: overlay,
    });
    const delta = estimatePromptTokens(withFirm) - estimatePromptTokens(base);
    const draftingCeiling = getPromptBudget('drafting').maxPromptTokens;
    expect(delta).toBeGreaterThan(0);
    expect(delta / draftingCeiling).toBeLessThan(0.05);
    expect(estimatePromptTokens(withFirm)).toBeLessThan(draftingCeiling);
  });

  it('the precedence text is a fixed cost, not proportional to clause count', () => {
    const one = formatFirmClauseOverlay(selectFirmClauses({ clauses: many.slice(0, 1), orgId: ORG_A, family: 'contract' }).selected);
    const four = formatFirmClauseOverlay(selectFirmClauses({ clauses: many, orgId: ORG_A, family: 'contract' }).selected);
    const occurrences = (four.match(/PRECEDENCE \(highest first/g) ?? []).length;
    expect(occurrences).toBe(1);
    expect(one).toContain(FIRM_CLAUSE_PRECEDENCE);
  });
});

describe('firm clause library — fail-soft', () => {
  it('returns an empty overlay when the firm has no clauses', async () => {
    const overlay = await resolveFirmClauseOverlay({
      orgId: ORG_A,
      family: 'contract',
      jurisdiction: 'IN',
      withTenant: async (fn) => fn({ execute: async () => ({ rows: [] }) }),
    });
    expect(overlay).toBe('');
  });

  it('returns an empty overlay when the lookup throws — drafting must not break', async () => {
    const overlay = await resolveFirmClauseOverlay({
      orgId: ORG_A,
      family: 'contract',
      jurisdiction: 'IN',
      withTenant: async () => {
        throw new Error('relation "nv_organizations" does not exist');
      },
    });
    expect(overlay).toBe('');
  });

  it('drafting produces a full prompt when the overlay is empty', () => {
    const withOverlay = buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'nda', firmClauseOverlay: '' });
    const withoutArg = buildLegalDraftSystemPrompt({ jurisdiction: 'IN', template: 'nda' });
    expect(withOverlay).toBe(withoutArg);
    expect(withOverlay).toContain('JURISDICTION: India');
    expect(withOverlay).toContain('STRUCTURE');
  });

  it('returns an empty overlay when there is no tenant binding at all', async () => {
    expect(await resolveFirmClauseOverlay({ orgId: undefined, family: 'contract' })).toBe('');
    expect(await resolveFirmClauseOverlay({ orgId: '', family: 'contract', requestClauses: [clause()] })).toBe('');
  });

  it('tolerates malformed caller payloads without throwing', () => {
    for (const bad of [null, undefined, 42, 'text', [null], [{}], { clauses: 'nope' }]) {
      expect(() => toFirmClauses(bad)).not.toThrow();
      expect(toFirmClauses(bad)).toEqual([]);
    }
  });
});

describe('firm clause library — caller-supplied (NSP) path', () => {
  it('accepts the partner payload shape and injects the firm wording', async () => {
    const overlay = await resolveFirmClauseOverlay({
      orgId: ORG_A,
      family: 'contract',
      documentType: 'msa',
      jurisdiction: 'IN',
      requestClauses: {
        clauses: [
          {
            org_id: ORG_A,
            clause_type: 'limitation_of_liability',
            clause_name: 'House LoL — 12-month fee cap',
            clause_text: 'The aggregate liability of either party shall not exceed the fees paid in the twelve months preceding the claim.',
            document_types: ['msa', 'sla'],
            jurisdiction: 'IN',
          },
        ],
      },
    });
    expect(overlay).toContain('House LoL — 12-month fee cap');
    expect(overlay).toContain('limitation_of_liability');
    expect(overlay).toContain(FIRM_CLAUSE_PRECEDENCE);
  });

  it('rejects a partner payload that carries another org id', async () => {
    const overlay = await resolveFirmClauseOverlay({
      orgId: ORG_B,
      family: 'contract',
      documentType: 'msa',
      jurisdiction: 'IN',
      requestClauses: [{ org_id: ORG_A, clause_text: 'ORG-A-SECRET-CARVEOUT', clause_name: 'A' }],
    });
    expect(overlay).toBe('');
  });
});
