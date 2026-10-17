/**
 * NV-TEMPLATE-DOCTYPE-MAP-001 — map template catalog slugs to partner DraftDocumentType keys.
 *
 * Consumed by GET /api/jrx/templates to expose `documentTypeKey` when mappable.
 * Pattern order is first-match-wins (specific before generic).
 */

import {
  resolveDraftDocumentType,
  type DraftDocumentType,
} from './jrx-draft-length-registry.js';

export interface TemplateDoctypeRule {
  /** Substring matched against slug, name, category, tags (lowercase). */
  pattern: RegExp;
  documentType: DraftDocumentType;
}

/** Slug / title patterns for IN catalog templates (204+ seeds). */
export const TEMPLATE_DOCTYPE_RULES: readonly TemplateDoctypeRule[] = [
  { pattern: /\bwritten[\s_-]+statements?\b|\bws[\s_-]|counter[\s_-]?claim\b/, documentType: 'written_statement' },
  { pattern: /\bspecial[\s_-]+leave[\s_-]+petition\b|\bslp\b|\barticle\s*136\b/, documentType: 'writ_petition' },
  { pattern: /\bwrit[\s_-]+petition\b|\barticle\s*226\b|\bhabeas\b/, documentType: 'writ_petition' },
  { pattern: /\bbail[\s_-]|anticipatory[\s_-]+bail\b|\babail\b/, documentType: 'bail_application' },
  { pattern: /\blegal[\s_-]+notice\b|\bdemand[\s_-]+notice\b|\bsection[\s_-]*138\b|\bni[\s_-]+act\b/, documentType: 'legal_notice' },
  { pattern: /\breply[\s_-]+(?:to[\s_-]+)?(?:the[\s_-]+)?legal[\s_-]+notice\b/, documentType: 'reply_legal_notice' },
  { pattern: /\bcounter[\s_-]*affidavit\b/, documentType: 'counter_affidavit' },
  { pattern: /\brejoinder\b|\breplication\b/, documentType: 'rejoinder' },
  { pattern: /\bexecution[\s_-]+(?:petition|application)\b|\bdarkhast\b/, documentType: 'petition_application' },
  { pattern: /\bcross[\s_-]?objection(s)?\b|\border\s*xli\s*rule\s*22\b/, documentType: 'cross_objection' },
  { pattern: /\bcaveat\b|\bcaveator\b|\bsection\s*148[\s_-]?a\b/, documentType: 'caveat' },
  { pattern: /\brevision[\s_-]+petition\b|\bcivil[\s_-]+revision\b|\bsection\s*115\b/, documentType: 'revision_petition' },
  { pattern: /\breview[\s_-]+petition\b|\barticle\s*137\b/, documentType: 'petition_application' },
  { pattern: /\bcivil[\s_-]+suit[\s_-]+plaint\b|\bplaint\b/, documentType: 'civil_suit_plaint' },
  { pattern: /\bdivorce[\s_-]+petition\b|\bmatrimonial\b/, documentType: 'divorce_petition' },
  { pattern: /\bfinal[\s_-]+arguments\b/, documentType: 'final_arguments' },
  { pattern: /\bwritten[\s_-]+arguments\b|\bwritten[\s_-]+submissions\b/, documentType: 'written_arguments' },
  { pattern: /\blegal[\s_-]+opinion\b|\bresearch[\s_-]+memo\b/, documentType: 'legal_opinion' },
  { pattern: /\bcase[\s_-]+summary\b|\bcase[\s_-]+brief\b/, documentType: 'case_summary' },
  { pattern: /\bcomplex[\s_-]+agreement\b|\bshare[\s_-]+purchase\b|\bspa\b|\bmsa\b/, documentType: 'complex_agreement' },
  { pattern: /\bagreement\b|\bcontract\b|\bnda\b|\bservice[\s_-]+agreement\b/, documentType: 'simple_agreement' },
  { pattern: /\baffidavit\b/, documentType: 'affidavit_case' },
  { pattern: /\binterlocutory\b|\binterim[\s_-]+application\b|\bi\.a\.\b/, documentType: 'interlocutory_application' },
  { pattern: /\bcriminal[\s_-]+petition\b|\bquash\b|\b482\b/, documentType: 'criminal_petition' },
  { pattern: /\bpetition\b|\bapplication\b/, documentType: 'petition_application' },
];

export function resolveTemplateDocumentTypeKey(input: {
  slug?: string;
  name?: string;
  title?: string;
  category?: string;
  document_type?: string;
  tags?: string[];
}): DraftDocumentType | undefined {
  const blob = [
    input.slug,
    input.name,
    input.title,
    input.category,
    input.document_type,
    ...(Array.isArray(input.tags) ? input.tags : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (!blob.trim()) return undefined;

  for (const rule of TEMPLATE_DOCTYPE_RULES) {
    if (rule.pattern.test(blob)) return rule.documentType;
  }

  const fromRegistry = resolveDraftDocumentType({
    template: input.slug,
    documentType: input.document_type,
    prompt: input.name,
  });
  return fromRegistry !== 'general_legal_document' ? fromRegistry : undefined;
}
