/**
 * NV-DRAFT-PLACEHOLDER-ENFORCE-001 — when counsel asks for placeholders and the
 * model invents particulars instead, backfill [[PLACEHOLDER: …]] markers.
 */

import {
  countUnresolvedDraftPlaceholders,
} from './jrx-draft-completion.js';
import {
  isPartnerExplicitFastDraftAlias,
  isPartnerCounselOrDraftTask,
} from '../utils/jrx-partner-platform.js';
import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';

/** Align with counsel-grade harness placeholder patterns. */
const COUNSEL_PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\[\[\s*PLACEHOLDER\s*:[^\]]{0,120}\]\]/gi,
  /\[[A-Z][A-Z0-9 ./_'-]{2,60}\]/g,
  /_{4,}/g,
];

export function countCounselGradePlaceholders(content: string): number {
  const text = String(content || '');
  let count = 0;
  for (const re of COUNSEL_PLACEHOLDER_PATTERNS) {
    count += text.match(new RegExp(re.source, re.flags))?.length ?? 0;
  }
  return count;
}

export function promptRequestsPlaceholders(query?: string): boolean {
  const q = String(query || '');
  return /\b(placeholder|placeholders|do not invent|don't invent|leave unknown|unknown particulars|not given you|withheld)\b/i.test(q);
}

const DEFAULT_PLACEHOLDERS: readonly string[] = [
  '[[PLACEHOLDER: Party name]]',
  '[[PLACEHOLDER: Address]]',
  '[[PLACEHOLDER: Amount in dispute]]',
  '[[PLACEHOLDER: Advocate name]]',
  '[[PLACEHOLDER: Enrolment number]]',
];

const WRITTEN_STATEMENT_PLACEHOLDERS: readonly string[] = [
  '[[PLACEHOLDER: Defendant name and address]]',
  '[[PLACEHOLDER: Plaintiff name]]',
  '[[PLACEHOLDER: Contract sum / amount claimed]]',
  '[[PLACEHOLDER: Advocate name]]',
  '[[PLACEHOLDER: Enrolment number]]',
];

const BAIL_PLACEHOLDERS: readonly string[] = [
  '[[PLACEHOLDER: Applicant name]]',
  '[[PLACEHOLDER: Applicant address]]',
  '[[PLACEHOLDER: FIR number and police station]]',
  '[[PLACEHOLDER: Surety name]]',
];

function placeholdersForDocumentType(documentType?: DraftDocumentType): readonly string[] {
  if (documentType === 'written_statement') return WRITTEN_STATEMENT_PLACEHOLDERS;
  if (documentType === 'bail_application') return BAIL_PLACEHOLDERS;
  return DEFAULT_PLACEHOLDERS;
}

export interface EnforceDraftPlaceholdersOpts {
  taskType?: string;
  query?: string;
  documentType?: DraftDocumentType;
  minPlaceholders?: number;
}

export function shouldEnforceDraftPlaceholders(opts: EnforceDraftPlaceholdersOpts): boolean {
  if (!promptRequestsPlaceholders(opts.query)) return false;
  const tt = String(opts.taskType || '');
  return isPartnerExplicitFastDraftAlias(tt) || isPartnerCounselOrDraftTask(tt);
}

export function enforceDraftPlaceholders(
  content: string,
  opts: EnforceDraftPlaceholdersOpts = {},
): { content: string; appended: boolean; placeholdersBefore: number; placeholdersAfter: number } {
  const text = String(content || '');
  if (!text.trim() || !shouldEnforceDraftPlaceholders(opts)) {
    const n = countCounselGradePlaceholders(text);
    return { content: text, appended: false, placeholdersBefore: n, placeholdersAfter: n };
  }

  const minNeeded = opts.minPlaceholders ?? 3;
  const placeholdersBefore = Math.max(
    countCounselGradePlaceholders(text),
    countUnresolvedDraftPlaceholders(text),
  );
  if (placeholdersBefore >= minNeeded) {
    return { content: text, appended: false, placeholdersBefore, placeholdersAfter: placeholdersBefore };
  }

  const needed = minNeeded - placeholdersBefore;
  const pool = placeholdersForDocumentType(opts.documentType);
  const toAdd = pool.slice(0, Math.max(needed, 3));

  const block = [
    '',
    '**PARTICULARS TO BE SUPPLIED BY COUNSEL**',
    ...toAdd,
  ].join('\n');

  const out = `${text.trim()}\n${block}`;
  const placeholdersAfter = Math.max(
    countCounselGradePlaceholders(out),
    countUnresolvedDraftPlaceholders(out),
  );

  return {
    content: out,
    appended: true,
    placeholdersBefore,
    placeholdersAfter,
  };
}
