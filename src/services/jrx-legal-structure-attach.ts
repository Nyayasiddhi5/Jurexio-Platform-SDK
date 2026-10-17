/**
 * NV-LEGAL-STRUCTURE-ATTACH-001 — store IRAC / Prayer skeletons and attach
 * them after the LLM, instead of asking the model to regenerate boilerplate
 * on every request.
 *
 * Queen still writes case-specific facts, ingredients, and authorities from
 * RAG. The orchestrator selects the skeleton from the request (BNSS pack or
 * IRAC) and appends only missing sections. Extract / search / classify never
 * attach.
 *
 * Escape: NYV_LEGAL_STRUCTURE_ATTACH=0
 */
import {
  matchBnssCourtApplications,
  type BnssCourtApplication,
} from '../data/jrx-bnss-court-applications-pack.js';
import { resolveTransactionalDraftDocumentType } from './jrx-indian-draft-structure-registry.js';

export type LegalStructureKind = 'none' | 'irac' | 'prayer' | 'bnss-prayer';

export interface LegalStructureSelection {
  kind: LegalStructureKind;
  slug?: string;
  name?: string;
  sections?: string[];
}

export interface AttachLegalStructureOpts {
  query?: string;
  taskType?: string;
  jurisdiction?: string;
  documentType?: string;
  template?: string;
  parameters?: Record<string, unknown>;
}

const IRAC_SECTIONS: Array<{ key: string; match: RegExp; title: string; body: string }> = [
  {
    key: 'issue',
    match: /issue\s*(&|and)?\s*short\s*answer|short\s*answer/i,
    title: 'ISSUE & SHORT ANSWER',
    body: '[Orchestrator skeleton — fill from the facts above. One-sentence issue; one-sentence answer. Do not invent law.]',
  },
  {
    key: 'facts',
    match: /facts\s*assumed|facts\s*\/\s*context|context\s*understood/i,
    title: 'FACTS ASSUMED / CONTEXT',
    body: '[Orchestrator skeleton — restated from the user request only. Mark unknowns as unknown.]',
  },
  {
    key: 'law',
    match: /applicable\s*law|ingredients|statutory/i,
    title: 'APPLICABLE LAW & INGREDIENTS',
    body: '[Orchestrator skeleton — map BNS/BNSS/BSA or civil statute ingredients to the facts. Cite only retrieved authorities.]',
  },
  {
    key: 'analysis',
    match: /\banalysis\b|\breasoning\b/i,
    title: 'ANALYSIS',
    body: '[Orchestrator skeleton — apply ingredients to facts. No new citations beyond those already grounded.]',
  },
  {
    key: 'authorities',
    match: /\bauthorit/i,
    title: 'AUTHORITIES',
    body: '[Orchestrator skeleton — list only authorities already in the answer or retrieval. Do not invent citations.]',
  },
  {
    key: 'risks',
    match: /\brisks?\b|\bcaveat/i,
    title: 'RISKS & CAVEATS',
    body: '[Orchestrator skeleton — forum competence, limitation, special-statute bars, and what is unconfirmed.]',
  },
  {
    key: 'next',
    match: /next\s*steps|\bprayer\b/i,
    title: 'NEXT STEPS / PRAYER',
    body: '[Orchestrator skeleton — practical next step for the client. Prayer language is attached only on drafts.]',
  },
];

export function isLegalStructureAttachEnabled(): boolean {
  const v = String(process.env.NYV_LEGAL_STRUCTURE_ATTACH ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function isFastTask(taskType?: string): boolean {
  const tt = taskType || '';
  // NV-FAST-CHAT-SLA-001 — simple Q&A; IRAC skeleton + polish is draft-grade overhead.
  if (/^legal[_-]?chat[_-]fast$/i.test(tt)) return true;
  return /^(extract|summar(?:y|ize|ise)|classif(?:y|ication)|ocr|embed|parse|serp|web-search|search)$/i.test(tt);
}

function isDraftTask(taskType?: string, query?: string): boolean {
  if (/draft|document-draft|pleading|petition|plaint|affidavit|notice|paper-book/i.test(taskType || '')) {
    return true;
  }
  return /\b(draft|plead|petition|plaint|affidavit|legal\s+notice|cause\s*title|paper[- ]book)\b/i.test(query || '');
}

function isCounselTask(taskType?: string): boolean {
  return /research|analysis|opinion|advisory|precedent|advise|advice|memo|chat|counsel|legal[_-]?chat|general/i.test(
    taskType || '',
  );
}

/** Pick stored skeleton from request — no LLM. */
export function selectLegalStructure(opts: AttachLegalStructureOpts = {}): LegalStructureSelection {
  if (!isLegalStructureAttachEnabled()) return { kind: 'none' };
  const jur = String(opts.jurisdiction || 'IN').toUpperCase();
  if (jur !== 'IN' && jur !== 'INDIA' && !jur.startsWith('IN')) return { kind: 'none' };
  if (isFastTask(opts.taskType)) return { kind: 'none' };

  const query = String(opts.query || '');
  if (
    resolveTransactionalDraftDocumentType({
      documentType: opts.documentType,
      template: opts.template ?? opts.taskType,
      instruction: query,
      parameters: opts.parameters,
    })
  ) {
    return { kind: 'none' };
  }
  if (isDraftTask(opts.taskType, query)) {
    const hit = matchBnssCourtApplications(query || String(opts.taskType || ''), 1)[0];
    if (hit) {
      return {
        kind: 'bnss-prayer',
        slug: hit.templateSlug,
        name: hit.name,
        sections: [...hit.sections],
      };
    }
    return { kind: 'prayer' };
  }
  if (/^chat$/i.test(opts.taskType || '') && !/\b(act|section|bail|suit|fir|contract|notice|petition|bnss|bns)\b/i.test(query)) {
    return { kind: 'none' };
  }
  if (isCounselTask(opts.taskType) || !opts.taskType) {
    return { kind: 'irac' };
  }
  return { kind: 'none' };
}

export function buildStoredPrayer(app?: BnssCourtApplication): string {
  const provision = app
    ? `BNSS §${app.sections.join(', §')} (${app.name}; formerly ${app.formerCrpc})`
    : 'the applicable provision';
  const relief = app?.useCase || '[SPECIFIC RELIEF MAPPED TO THE FACTS ABOVE]';
  return [
    '**PRAYER**',
    '',
    'It is therefore most respectfully prayed that this Hon\'ble Court may be pleased to:',
    `(a) allow this application under ${provision} and grant: ${relief};`,
    '(b) pass such interim directions as may be necessary pending disposal;',
    '(c) pass any other order(s) as this Hon\'ble Court may deem fit and proper in the facts and circumstances of the case.',
    '',
    'Place: [PLACE]',
    'Date: [DATE]',
    '',
    '[ADVOCATE NAME]',
    'Enrolment No. [NUMBER]',
    'Counsel for the Applicant',
    '',
    '## VERIFICATION',
    '',
    'I, [NAME], the Applicant above-named, do hereby verify that the contents are true to my personal knowledge / information received and believed to be true. No part is false and nothing material has been concealed.',
    '',
    'Verified at [PLACE] on this ____ day of ________, 20____.',
    '',
    '**Deponent**',
  ].join('\n');
}

export function buildStoredIrac(missingKeys: string[]): string {
  const blocks = IRAC_SECTIONS.filter((s) => missingKeys.includes(s.key)).map(
    (s) => `**${s.title}**\n${s.body}`,
  );
  if (!blocks.length) return '';
  return `---\n*Counsel structure (NV-LEGAL-STRUCTURE-ATTACH-001 — stored skeleton, not a new LLM pass)*\n\n${blocks.join('\n\n')}`;
}

/** Prompt fragment: tell the model to fill slots, not rewrite the skeleton. */
export function structureFillOverlay(selection: LegalStructureSelection): string {
  if (selection.kind === 'none') return '';
  if (selection.kind === 'irac') {
    return [
      'STRUCTURE ATTACH (do not regenerate): The orchestrator will attach IRAC headings (Issue, Facts, Law, Analysis, Authorities, Risks, Next steps) after your answer if any are missing.',
      'Write only case-specific content. Do not spend tokens restating empty IRAC headings or a generic Prayer.',
    ].join(' ');
  }
  const slug = selection.slug ? ` Matched template: ${selection.slug}.` : '';
  return [
    `STRUCTURE ATTACH (do not regenerate): Prayer, Verification, and cause-title boilerplate are stored and will be attached after your answer if missing.${slug}`,
    'Write numbered facts mapped to statutory ingredients. Do not invent surety schedules. Do not rewrite a full paper-book skeleton.',
  ].join(' ');
}

/**
 * Append stored IRAC / Prayer only when the model omitted them.
 * Never invents citations.
 */
export function attachStoredLegalStructure(
  content: string,
  opts: AttachLegalStructureOpts = {},
): { content: string; attached: boolean; kind: LegalStructureKind; slug?: string } {
  const selection = selectLegalStructure(opts);
  if (selection.kind === 'none' || !content) {
    return { content, attached: false, kind: selection.kind };
  }

  if (selection.kind === 'irac') {
    const missing = IRAC_SECTIONS.filter((h) => !h.match.test(content)).map((h) => h.key);
    if (!missing.length) return { content, attached: false, kind: 'irac' };
    const extra = buildStoredIrac(missing);
    return {
      content: extra ? `${content.trimEnd()}\n\n${extra}` : content,
      attached: !!extra,
      kind: 'irac',
    };
  }

  let out = content;
  let attached = false;
  if (!/MOST RESPECTFULLY SHOWETH/i.test(out)) {
    out += '\n\n**MOST RESPECTFULLY SHOWETH:**\n[Numbered paragraphs mapping the facts already stated above to statutory ingredients. Skeleton attached — not a second LLM draft.]';
    attached = true;
  }
  if (!/\bPRAYER\b/i.test(out)) {
    const app = selection.slug
      ? matchBnssCourtApplications(opts.query || selection.name || '', 1)[0]
      : undefined;
    out += `\n\n${buildStoredPrayer(app)}`;
    attached = true;
  }
  return { content: out, attached, kind: selection.kind, slug: selection.slug };
}
