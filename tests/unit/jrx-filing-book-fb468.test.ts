/**
 * NV-NSP-FB468-P0-001 — NSP FB-468 reconciled flow: nvTemplateKey crosswalk,
 * 3 new doc types, filingContext parse, draftProfile assembly.
 */
import { describe, it, expect } from 'vitest';
import {
  DRAFT_LENGTH_REGISTRY,
  resolveDraftDocumentType,
  resolveDraftDocumentTypeWithMeta,
  type DraftDocumentType,
} from '../../src/config/jrx-draft-length-registry.js';
import { INDIAN_DRAFT_STRUCTURE_CHECKLIST } from '../../src/services/jrx-indian-draft-structure-registry.js';
import { DOCUMENT_TYPE_AGENT_PIN } from '../../src/services/jrx-document-type-agent-pin.js';
import {
  FILING_BOOK_MANIFEST_VERSION,
  NV_TEMPLATE_KEY_CROSSWALK,
  crosswalkNvTemplateKey,
  type NvTemplateKey,
} from '../../src/config/jrx-filing-book-crosswalk.js';
import { resolveFilingChecklist } from '../../src/config/jrx-filing-checklist-registry.js';
import { parseFilingContextHint } from '../../src/services/jrx-filing-context-hint.js';
import { assembleDraftProfile } from '../../src/orchestration/jrx-draft-profile-assembler.js';
import { analyzeDraftStructureMarkers } from '../../src/services/jrx-draft-completion.js';

const P0_MANIFEST_KEYS: NvTemplateKey[] = [
  'ni_138_statutory_notice',
  'breach_notice',
  'termination_notice',
  'consumer_pre_litigation_notice',
  'verification_affidavit_plaint',
  'civil_injunction_vacate',
  'civil_receiver_appointment',
  'civil_restore_suit',
  'civil_setaside_exparte_decree',
  'civil_amend_pleading',
  'civil_revision_petition',
  'civil_section_47_application',
  'civil_cross_objection',
  'civil_review_petition',
  'civil_caveat',
  'indigent_suit_petition',
];

/** Wave B (NV-FILING-BOOK-WAVEB-001) — additional book-grounded keys. */
const WAVE_B_MANIFEST_KEYS: NvTemplateKey[] = [
  'civil_temporary_injunction',
  'civil_attachment_before_judgment',
  'civil_implead_lrs',
  'civil_condonation_of_delay',
  'eviction_notice',
  'money_recovery_notice',
  'section_80_cpc_notice',
];

/** Wave C (NV-FILING-BOOK-WAVEC-001) — full 96pp book-manifest ingest. */
/** Wave D (NV-BOOK-SME-WAVE-D-001) — CMA / stay / plaint presentation. */
const WAVE_D_MANIFEST_KEYS: NvTemplateKey[] = [
  'civil_miscellaneous_appeal',
  'appeal_stay_petition',
  'plaint_presentation_pack',
];

const WAVE_C_MANIFEST_KEYS: NvTemplateKey[] = [
  'promissory_note_demand_notice',
  'defective_pronote_demand_notice',
  'mortgage_debt_notice',
  'partition_demand_notice',
  'railway_compensation_notice',
  'rent_increase_notice',
  'money_recovery_suit',
  'declaration_injunction_suit',
  'partition_suit',
  'summary_suit',
  'summary_suit_leave_to_defend',
  'written_statement_defence',
  'counter_claim',
  'first_appeal_memo',
  'second_appeal_memo',
  'execution_arrest_detention',
  'execution_attachment_sale',
];

const ALL_MANIFEST_KEYS: NvTemplateKey[] = [
  ...P0_MANIFEST_KEYS,
  ...WAVE_B_MANIFEST_KEYS,
  ...WAVE_C_MANIFEST_KEYS,
  ...WAVE_D_MANIFEST_KEYS,
];

const NEW_DOC_TYPES: DraftDocumentType[] = ['revision_petition', 'cross_objection', 'caveat'];

describe('FB-468 — 3 new doc types registered in every exhaustive map', () => {
  it('exist in DRAFT_LENGTH_REGISTRY with sane token bands', () => {
    for (const dt of NEW_DOC_TYPES) {
      const spec = DRAFT_LENGTH_REGISTRY[dt];
      expect(spec, dt).toBeTruthy();
      expect(spec.defaultTokens).toBeGreaterThanOrEqual(4_096);
      expect(spec.comprehensiveTokens).toBeGreaterThanOrEqual(spec.defaultTokens);
    }
  });

  it('exist in INDIAN_DRAFT_STRUCTURE_CHECKLIST with >=5 sections', () => {
    for (const dt of NEW_DOC_TYPES) {
      const sections = INDIAN_DRAFT_STRUCTURE_CHECKLIST[dt];
      expect(sections, dt).toBeTruthy();
      expect(sections.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('exist in DOCUMENT_TYPE_AGENT_PIN', () => {
    for (const dt of NEW_DOC_TYPES) {
      expect(DOCUMENT_TYPE_AGENT_PIN[dt], dt).toBeTruthy();
    }
  });

  it('resolve from prompt inference', () => {
    expect(resolveDraftDocumentType({ prompt: 'Draft a civil revision petition under section 115 CPC' }))
      .toBe('revision_petition');
    expect(resolveDraftDocumentType({ prompt: 'File a cross-objection under Order XLI Rule 22' }))
      .toBe('cross_objection');
    expect(resolveDraftDocumentType({ prompt: 'Lodge a caveat under section 148A CPC' }))
      .toBe('caveat');
  });
});

describe('FB-468 — nvTemplateKey crosswalk', () => {
  it('every P0 manifest key crosswalks to a real DraftDocumentType', () => {
    for (const key of P0_MANIFEST_KEYS) {
      const dt = crosswalkNvTemplateKey(key);
      expect(dt, key).toBeTruthy();
      expect(DRAFT_LENGTH_REGISTRY[dt as DraftDocumentType], key).toBeTruthy();
    }
  });

  it('crosswalk map covers exactly the P0 + Wave B keys', () => {
    expect(Object.keys(NV_TEMPLATE_KEY_CROSSWALK).sort()).toEqual([...ALL_MANIFEST_KEYS].sort());
  });

  it('every Wave B key crosswalks to a real DraftDocumentType', () => {
    for (const key of WAVE_B_MANIFEST_KEYS) {
      const dt = crosswalkNvTemplateKey(key);
      expect(dt, key).toBeTruthy();
      expect(DRAFT_LENGTH_REGISTRY[dt as DraftDocumentType], key).toBeTruthy();
    }
  });

  it('every Wave C key crosswalks to a real DraftDocumentType (folds onto existing coarse types)', () => {
    for (const key of WAVE_C_MANIFEST_KEYS) {
      const dt = crosswalkNvTemplateKey(key);
      expect(dt, key).toBeTruthy();
      expect(DRAFT_LENGTH_REGISTRY[dt as DraftDocumentType], key).toBeTruthy();
    }
  });

  it('Wave C folds onto expected coarse buckets (notices/suits/appeals/execution)', () => {
    expect(crosswalkNvTemplateKey('promissory_note_demand_notice')).toBe('legal_notice');
    expect(crosswalkNvTemplateKey('declaration_injunction_suit')).toBe('civil_suit_plaint');
    expect(crosswalkNvTemplateKey('summary_suit_leave_to_defend')).toBe('interlocutory_application');
    expect(crosswalkNvTemplateKey('counter_claim')).toBe('written_statement');
    expect(crosswalkNvTemplateKey('first_appeal_memo')).toBe('petition_application');
    expect(crosswalkNvTemplateKey('execution_attachment_sale')).toBe('execution_petition');
  });

  it('the 3 GAP keys resolve to their new first-class doctype (not general)', () => {
    expect(crosswalkNvTemplateKey('civil_revision_petition')).toBe('revision_petition');
    expect(crosswalkNvTemplateKey('civil_cross_objection')).toBe('cross_objection');
    expect(crosswalkNvTemplateKey('civil_caveat')).toBe('caveat');
  });

  it('resolveDraftDocumentTypeWithMeta resolves documentType=nvTemplateKey (NSP always sends this)', () => {
    const meta = resolveDraftDocumentTypeWithMeta({ documentType: 'ni_138_statutory_notice' });
    expect(meta.documentType).toBe('legal_notice');
    expect(meta.source).toBe('nv_template_key');
    expect(meta.wasInferred).toBe(false);
  });

  it('resolves nvTemplateKey nested in parameters.filingContext via crosswalk', () => {
    // `ni_138_statutory_notice` is not an alias, so this proves the crosswalk path.
    const meta = resolveDraftDocumentTypeWithMeta({
      parameters: { filingContext: { nvTemplateKey: 'ni_138_statutory_notice' } },
    });
    expect(meta.documentType).toBe('legal_notice');
    expect(meta.source).toBe('nv_template_key');
    expect(meta.wasInferred).toBe(false);
  });

  it('explicit registry key still wins over a fine-grained key', () => {
    const meta = resolveDraftDocumentTypeWithMeta({
      documentType: 'writ_petition',
      parameters: { filingContext: { nvTemplateKey: 'civil_caveat' } },
    });
    expect(meta.documentType).toBe('writ_petition');
    expect(meta.source).toBe('explicit_registry');
  });
});

describe('FB-468 — filingContext parse (advisory)', () => {
  it('parses nested filingContext + honours advisoryOnly default', () => {
    const hint = parseFilingContextHint({
      parameters: {
        documentType: 'civil_caveat',
        filingContext: {
          nvTemplateKey: 'civil_caveat',
          filingBookRowId: 'row-42',
          filingBookVersion: 'FB-468.v1',
          legalBasisHint: 's.148A CPC',
          noticeComplianceDays: 90,
          exportProfile: 'docx-a4',
          advisoryOnly: true,
        },
      },
    });
    expect(hint).toBeTruthy();
    expect(hint!.nvTemplateKey).toBe('civil_caveat');
    expect(hint!.filingBookRowId).toBe('row-42');
    expect(hint!.noticeComplianceDays).toBe(90);
    expect(hint!.advisoryOnly).toBe(true);
  });

  it('picks up top-level filingBookRowId (NSP BFF)', () => {
    const hint = parseFilingContextHint({
      filingBookRowId: 'top-level-row',
      parameters: { filingContext: { nvTemplateKey: 'ni_138_statutory_notice' } },
    });
    expect(hint!.filingBookRowId).toBe('top-level-row');
  });

  it('treats mandatorySections/requiredAnnexures as advisory expectations, not authority', () => {
    const hint = parseFilingContextHint({
      parameters: {
        mandatorySections: ['Cause title', 'Prayer'],
        requiredAnnexures: ['A-1'],
        filingContext: { nvTemplateKey: 'indigent_suit_petition' },
      },
    });
    expect(hint!.expectedSections).toEqual(['Cause title', 'Prayer']);
    expect(hint!.expectedAnnexures).toEqual(['A-1']);
  });

  it('returns undefined when there is nothing filing-related', () => {
    expect(parseFilingContextHint({ parameters: { documentType: 'writ_petition' } })).toBeUndefined();
    expect(parseFilingContextHint({})).toBeUndefined();
  });
});

describe('FB-468 — filing checklist registry', () => {
  it('has a manifest entry for every P0 + Wave B key with non-empty rows', () => {
    for (const key of ALL_MANIFEST_KEYS) {
      const res = resolveFilingChecklist({ nvTemplateKey: key, documentType: 'general_legal_document' });
      expect(res.fromManifest, key).toBe(true);
      expect(res.rows.length, key).toBeGreaterThan(0);
    }
  });

  it('falls back to coarse doctype checklist when no nvTemplateKey', () => {
    const res = resolveFilingChecklist({ documentType: 'civil_suit_plaint' });
    expect(res.fromManifest).toBe(false);
    expect(res.rows.some((r) => /verification affidavit/i.test(r.label))).toBe(true);
  });

  it('never invents rows for an unknown coarse type', () => {
    const res = resolveFilingChecklist({ documentType: 'general_legal_document' });
    expect(res.rows).toEqual([]);
  });
});

describe('FB-468 — draftProfile + validationResults assembly', () => {
  it('assembles profile with echoed provenance + checklist for a caveat', () => {
    const content = 'IN THE HIGH COURT OF JUDICATURE AT MADRAS\nCAVEAT PETITION\n1. The caveator...\nPRAYER\nVERIFICATION';
    const markers = analyzeDraftStructureMarkers(content, 'caveat');
    const { draftProfile, validationResults } = assembleDraftProfile({
      documentType: 'caveat',
      structureMarkers: markers,
      filingContext: {
        nvTemplateKey: 'civil_caveat',
        filingBookRowId: 'row-7',
        advisoryOnly: true,
      },
    });
    expect(draftProfile.documentType).toBe('caveat');
    expect(draftProfile.templateKey).toBe('civil_caveat');
    expect(draftProfile.filingBookRowId).toBe('row-7');
    expect(draftProfile.manifestVersion).toBe(FILING_BOOK_MANIFEST_VERSION);
    expect(draftProfile.filingChecklist.length).toBeGreaterThan(0);
    expect(validationResults.some((v) => v.id === 'structure.prayer')).toBe(true);
    expect(draftProfile.advisory?.advisoryOnly).toBe(true);
  });

  it('emits notice service modes only for notice types', () => {
    const notice = assembleDraftProfile({ documentType: 'legal_notice' });
    expect(notice.draftProfile.serviceModes).toEqual(['personal', 'rpad', 'affixation']);
    const plaint = assembleDraftProfile({ documentType: 'civil_suit_plaint' });
    expect(plaint.draftProfile.serviceModes).toBeUndefined();
  });

  it('flags missing prayer/verification as fail in validationResults', () => {
    const markers = analyzeDraftStructureMarkers('Just some unstructured text about a dispute.', 'petition_application');
    const { validationResults } = assembleDraftProfile({
      documentType: 'petition_application',
      structureMarkers: markers,
    });
    const prayer = validationResults.find((v) => v.id === 'structure.prayer');
    expect(prayer?.status).toBe('fail');
  });

  it('records partner section expectations as advisory (na), never authority', () => {
    const { validationResults } = assembleDraftProfile({
      documentType: 'civil_suit_plaint',
      filingContext: {
        expectedSections: ['Cause title', 'Prayer'],
        advisoryOnly: true,
      },
    });
    const drift = validationResults.find((v) => v.id === 'filing.expectedSections');
    expect(drift?.status).toBe('na');
  });
});
