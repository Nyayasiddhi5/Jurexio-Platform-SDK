/**
 * NV-LEGAL-FORMAT-001 — India-first legal response polish (Harvey/DraftWise feel).
 * Applied after LLM + safety; never invents citations.
 */
import { LEGAL_DRAFT_ADVOCATE_DISCLAIMER } from './jrx-legal-drafting-prompt.js';
import { attachStoredLegalStructure } from './jrx-legal-structure-attach.js';

export interface LegalFormatOpts {
  jurisdiction?: string;
  taskType?: string;
  /** Original user query — used to pick BNSS Prayer vs IRAC skeleton. */
  query?: string;
  includeDisclaimer?: boolean;
  /** NV-LEGAL-COMPREHENSIVE-001 — append missing counsel headings (default ON). */
  comprehensive?: boolean;
}

const INDIA_DISCLAIMER =
  'Disclaimer: This is AI-assisted legal information for India (BNS/BNSS/BSA where applicable), not a substitute for advice from a qualified advocate. Verify citations against primary sources before filing or relying.';

const COUNSEL_HEADINGS: Array<{ key: string; match: RegExp; title: string }> = [
  { key: 'issue', match: /issue\s*(&|and)?\s*short\s*answer|short\s*answer/i, title: 'ISSUE & SHORT ANSWER' },
  { key: 'facts', match: /facts\s*assumed|facts\s*\/\s*context|context\s*understood/i, title: 'FACTS ASSUMED / CONTEXT' },
  { key: 'law', match: /applicable\s*law|ingredients|statutory/i, title: 'APPLICABLE LAW & INGREDIENTS' },
  { key: 'analysis', match: /\banalysis\b|\breasoning\b/i, title: 'ANALYSIS' },
  { key: 'authorities', match: /\bauthorit/i, title: 'AUTHORITIES' },
  { key: 'risks', match: /\brisks?\b|\bcaveat/i, title: 'RISKS & CAVEATS' },
  { key: 'next', match: /next\s*steps|\bprayer\b/i, title: 'NEXT STEPS / PRAYER' },
];

export function isLegalComprehensiveMode(): boolean {
  const v = String(process.env.JRX_LEGAL_COMPREHENSIVE ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function isHeadingCompleteEnabled(): boolean {
  const v = String(process.env.JRX_LEGAL_HEADING_COMPLETE ?? '1').trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'off');
}

function isDraftTask(taskType?: string): boolean {
  return /draft|document-draft|pleading|petition|contract|affidavit|notice|template/i.test(taskType || '');
}

function isResearchTask(taskType?: string): boolean {
  // NV-FAST-CHAT-SLA-001 — chat-fast is lean FAQ, not full counsel IRAC attach.
  if (/^legal[_-]?chat[_-]fast$/i.test(taskType || '')) return false;
  return /research|analysis|opinion|advisory|precedent|advise|advice|memo|chat|counsel|legal[_-]?chat/i.test(taskType || '');
}

function isFastChatTask(taskType?: string): boolean {
  return /^legal[_-]?chat[_-]fast$/i.test(taskType || '');
}

/**
 * Response-engineering `fix-bullet-spacing` used to match the first `*` of a
 * line-start `**bold**` heading and inject a space (`* *ISSUE & SHORT ANSWER**`).
 * Repair that collision; safe to run on already-correct markdown.
 */
export function repairSplitBoldMarkers(content: string): string {
  if (!content) return content;
  return content.replace(/^\* \*(?!\*)/gm, '**');
}

/**
 * If the model skipped a mandatory counsel heading, attach the stored IRAC /
 * Prayer skeleton (NV-LEGAL-STRUCTURE-ATTACH-001). Never invents law.
 */
export function ensureIndiaCounselHeadings(content: string, opts: LegalFormatOpts = {}): string {
  if (!content) return content;
  if (opts.comprehensive === false || isFastChatTask(opts.taskType)) return content;
  if (!isLegalComprehensiveMode() || !isHeadingCompleteEnabled()) return content;
  const attached = attachStoredLegalStructure(content, {
    query: opts.query,
    taskType: opts.taskType,
    jurisdiction: opts.jurisdiction,
  });
  if (attached.attached) return attached.content;
  if (isDraftTask(opts.taskType) && !isResearchTask(opts.taskType)) return content;
  if (!isResearchTask(opts.taskType) && !isDraftTask(opts.taskType)) return content;
  const missing = COUNSEL_HEADINGS.filter((h) => !h.match.test(content));
  if (!missing.length) return content;
  const notes = missing
    .map((h) => `**${h.title}**\n[This heading was not separately produced. Review the analysis above; do not treat omission as absence of law. No additional authorities are invented here.]`)
    .join('\n\n');
  return `${content}\n\n---\n*Counsel completeness (NV-LEGAL-COMPREHENSIVE-001)*\n\n${notes}`;
}

export function applyLegalResponseFormatting(content: string, opts: LegalFormatOpts = {}): string {
  let out = repairSplitBoldMarkers((content || '').trim());
  if (!out) return out;

  // Normalize excessive blank lines
  out = out.replace(/\n{3,}/g, '\n\n');

  // Ensure markdown headings have a blank line before them when mid-doc
  out = out.replace(/([^\n])\n(#{1,3}\s)/g, '$1\n\n$2');

  // Soft-normalize common Indian pleading openers for readability
  out = out.replace(/\bMOST RESPECTFULLY SHOWETH\b:?/gi, '**MOST RESPECTFULLY SHOWETH:**');
  out = out.replace(/\bPRAYER\b:?\s*$/gim, '**PRAYER:**');
  out = out.replace(/\bVERIFICATION\b:?\s*$/gim, '**VERIFICATION:**');

  const jur = (opts.jurisdiction || 'IN').toUpperCase();
  const draft = isDraftTask(opts.taskType);
  const research = isResearchTask(opts.taskType);

  if (jur === 'IN' || jur === 'INDIA') {
    if ((research || draft) && !/BNS|BNSS|BSA|IPC|CrPC|Companies Act|NI Act|CPC/i.test(out)) {
      out += '\n\n> Note: Prefer current Indian criminal codes (BNS 2023 / BNSS 2023 / BSA 2023) for post–1 Jul 2024 matters; Companies Act 2013 / Contract Act 1872 / CPC for civil-commercial instruments.';
    }
  }

  if (opts.includeDisclaimer !== false) {
    if (draft && !/Disclaimer:/i.test(out)) {
      out += `\n\n---\n*${LEGAL_DRAFT_ADVOCATE_DISCLAIMER}*`;
    } else if (research && !/Disclaimer:/i.test(out)) {
      out += `\n\n---\n*${INDIA_DISCLAIMER}*`;
    }
  }

  return ensureIndiaCounselHeadings(out, opts);
}

/** Soft abstain when retrieval cannot ground a research/opinion answer. */
export function buildUngroundedAbstainMessage(opts: {
  query: string;
  confidence: number;
  jurisdiction?: string;
}): string {
  const jur = opts.jurisdiction || 'IN';
  return [
    '## Insufficient grounding for a reliable legal answer',
    '',
    `Retrieval confidence was **${(opts.confidence * 100).toFixed(0)}%** with no usable authority chunks for this query under jurisdiction **${jur}**.`,
    '',
    '### What to do next',
    '1. Narrow the question (statute section, court, party names, or year).',
    '2. Attach the source document or known citation.',
    '3. Retry — caselaw semantic coverage is still backfilling; FTS/hybrid may still help.',
    '',
    `### Your query`,
    `> ${opts.query.slice(0, 500)}`,
    '',
    `*${INDIA_DISCLAIMER}*`,
  ].join('\n');
}
