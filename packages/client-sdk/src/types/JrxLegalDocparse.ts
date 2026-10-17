/**
 * NSP / JRX legal docparse contracts (Platform SDK surface on gateway analyze/ingest).
 * Bind `docparseMeta.legalParseGuide` and `docparseMeta.docparseResultV1` — same four autofill states as CNR.
 */

export type LegalParseGuideAutofillHint =
  | 'prefill'
  | 'offer_candidate'
  | 'chooser_required'
  | 'not_found'
  | 'withheld';

export interface LegalParseGuideEntry {
  fieldPath: string;
  label: string;
  cardinality: 'single' | 'multi';
  autofillHint: LegalParseGuideAutofillHint;
  piiClass?: string;
  confidence?: number;
  status: string;
}

export interface LegalParseGuideV1 {
  schema: 'legal.parseGuide/v1';
  domainPackId: string;
  entries: LegalParseGuideEntry[];
}

export interface DocparseIntelligenceV1 {
  schema: 'docparse.intelligence/v1';
  domainPackId: string;
  qualityBand: 'high' | 'medium' | 'low';
  completenessRatio: number;
  pii: {
    catalogEntries: number;
    fieldsTagged: number;
    sensitiveFieldPaths: number;
    withheldHints: number;
    maskInLogsDefault: boolean;
  };
  legalParseGuide: LegalParseGuideV1;
}

export interface DocparseMetaPartner {
  engine?: 'docparse' | 'docparse-sdk';
  legalParseGuide?: LegalParseGuideV1;
  docparseResultV1?: Record<string, unknown>;
  docparseIntelligence?: DocparseIntelligenceV1;
  completenessRatio?: number;
  conflictFields?: string[];
  lowConfidenceFields?: string[];
  absentFields?: string[];
}

/** NSP: map autofillHint → UI action (prefill / offer / chooser / empty / withheld). */
export function nspAutofillAction(hint: LegalParseGuideAutofillHint): 'bind' | 'suggest' | 'chooser' | 'empty' | 'withheld' {
  switch (hint) {
    case 'prefill':
      return 'bind';
    case 'offer_candidate':
      return 'suggest';
    case 'chooser_required':
      return 'chooser';
    case 'withheld':
      return 'withheld';
    case 'not_found':
    default:
      return 'empty';
  }
}
