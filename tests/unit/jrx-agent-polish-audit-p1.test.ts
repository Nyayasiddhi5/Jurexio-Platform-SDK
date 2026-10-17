import { describe, it, expect } from 'vitest';
import {
  buildDraftRoutingHint,
  isLongPleadingDocumentType,
  resolveDraftDocumentType,
} from '../../src/config/jrx-draft-length-registry.js';
import { resolveTemplateDocumentTypeKey } from '../../src/config/jrx-template-doctype-map.js';
import {
  cnrResolveToFacts,
  mergeCnrFactsIntoOrchestrateBody,
} from '../../src/services/jrx-cnr-orchestrate-merge.js';
import {
  buildRegulatoryComplianceOverlay,
  buildSlpPaperbookOverlay,
} from '../../src/services/jrx-agent-draft-overlay.js';
import { shouldRunDraftStructureChecker } from '../../src/services/jrx-draft-structure-checker.js';

describe('NV-LONG-PLEADING-ROUTING-001', () => {
  it('flags written_statement on medium tier for comprehensive recommendation', () => {
    expect(isLongPleadingDocumentType('written_statement')).toBe(true);
    const hint = buildDraftRoutingHint({
      documentType: 'written_statement',
      draftLength: 'medium',
    });
    expect(hint?.recommendedDraftLength).toBe('comprehensive');
    expect(hint?.truncationLikely).toBe(true);
  });

  it('does not hint when comprehensive already requested', () => {
    const hint = buildDraftRoutingHint({
      documentType: 'written_statement',
      draftLength: 'comprehensive',
    });
    expect(hint).toBeNull();
  });
});

describe('NV-TEMPLATE-DOCTYPE-MAP-001', () => {
  it('maps bail slug to bail_application', () => {
    expect(resolveTemplateDocumentTypeKey({ slug: 'in-criminal-draft-bail-remand' })).toBe('bail_application');
  });

  it('maps written statement slug', () => {
    expect(resolveTemplateDocumentTypeKey({ slug: 'in-litigation-written-statement' })).toBe('written_statement');
  });
});

describe('NV-CNR-ORCHESTRATE-MERGE-001 body merge', () => {
  it('cnrResolveToFacts maps resolve payload', () => {
    const facts = cnrResolveToFacts({
      cnr: 'HCTS010044442023000123',
      fields: {
        courtName: { value: 'Telangana High Court' },
        petitioner: { value: 'A' },
      },
    });
    expect(facts?.cnr).toBe('HCTS010044442023000123');
    expect(facts?.courtName).toBe('Telangana High Court');
  });

  it('mergeCnrFactsIntoOrchestrateBody seeds parameters.cnrFacts + draftLength', () => {
    const body: Record<string, unknown> = {
      options: { draftLength: 'medium' },
      cnrResolve: {
        cnr: 'HCTS010044442023000123',
        fields: { petitioner: { value: 'Ramesh' } },
      },
    };
    mergeCnrFactsIntoOrchestrateBody(body);
    const params = body.parameters as Record<string, unknown>;
    expect(params.draftLength).toBe('medium');
    expect((params.cnrFacts as Record<string, unknown>).petitioner).toBe('Ramesh');
  });
});

describe('NV-AGENT-OVERLAY-ENRICH-001', () => {
  it('injects DPDP overlay for legal_notice', () => {
    expect(buildRegulatoryComplianceOverlay('legal_notice')).toMatch(/DPDP Act 2023/);
  });

  it('injects SLP paper-book overlay for writ_petition + SLP prompt', () => {
    expect(
      buildSlpPaperbookOverlay({
        documentType: 'writ_petition',
        prompt: 'Draft SLP under Article 136',
      }),
    ).toMatch(/Synopsis/);
  });
});

describe('NV-DRAFT-STRUCTURE-CHECKER long pleading', () => {
  it('runs checker for incomplete written_statement on standard path', () => {
    const incomplete = 'IN THE COURT\n\n1. Short stub only.';
    expect(
      shouldRunDraftStructureChecker({
        taskType: 'legal-draft',
        documentType: 'written_statement',
        content: incomplete,
      }),
    ).toBe(true);
  });
});

describe('NV-DRAFT-LENGTH review/execution aliases', () => {
  it('resolves review_petition alias', () => {
    expect(resolveDraftDocumentType({ documentType: 'review_petition' })).toBe('review_petition');
  });
});
