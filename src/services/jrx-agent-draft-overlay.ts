/**
 * NV-AGENT-DRAFT-OVERLAY-001 — per-agent counsel-grade prompt overlays (P0/P2).
 *
 * Injected via `buildLegalDraftSystemPrompt` and research overlays without
 * bulk-editing the 164-agent registry JSON.
 */

import type { DraftDocumentType } from '../config/jrx-draft-length-registry.js';

/** SC registry paper-book shape — shared with nv-legal-drafting-prompt slp family. */
export const SLP_PAPERBOOK_RULE = `SPECIAL LEAVE PETITION — SUPREME COURT PAPER-BOOK RULE (mandatory):
- Article 136 confers a discretionary jurisdiction. Plead why the case is fit for special leave — a substantial question of law of general importance, or gross failure of justice — not merely that the judgment below is wrong.
- The paper-book order is fixed and must all be produced: (1) Synopsis, (2) List of Dates and Events, (3) the petition proper, (4) Questions of Law, (5) Grounds, (6) Prayer including interim prayer, (7) the Certificate, (8) Affidavit in support, (9) Annexures / Appendix.
- SYNOPSIS: a continuous narrative of what the case is about and why leave should be granted. LIST OF DATES: strictly chronological, date → event, one line each, cross-referenced to annexure page numbers as [PAGE NO.].
- QUESTIONS OF LAW must be framed as questions ("Whether …"), each capable of a yes/no answer, and each must arise from the impugned judgment.
- CERTIFICATE (Supreme Court Rules 2013, Order XXI): certify that the petitioner has not filed any other petition against the impugned judgment; that the SLP is confined to the pleadings and documents that were before the Court below; and that no fresh facts, documents or grounds are being urged. If any of these is not true on the facts supplied, say so in [SQUARE BRACKETS] rather than certifying falsely.
- State the date of the impugned judgment and the limitation position (ninety days from the judgment, or sixty days from refusal of a certificate under Article 134A); if out of time, include an application for condonation of delay.
- Name the Court below exactly and carry its case number; the cause title is "IN THE SUPREME COURT OF INDIA — CIVIL/CRIMINAL APPELLATE JURISDICTION".
- Do NOT invent the SLP diary number, AOR name, enrolment number or annexure page numbers.`;

const A004_PRE_FILING = `PRE-FILING CHECKS (A-004 — mandatory before final prayer):
- Limitation: state applicable Article / period; condonation prayer if facts suggest delay.
- Jurisdiction: forum competence (territorial, pecuniary, subject-matter); alternative remedy bar if writ/quash.
- Court-fee / valuation: flag if court-fee particulars or valuation are missing — use [[PLACEHOLDER: …]].
- Maintainability: standing, cause of action, res judicata / constructive res judicata where relevant.

RATIO DECIDENDI (mandatory when citing authorities):
- Distinguish ratio decidendi from obiter; apply only the holding that matches the pleaded facts.
- Never stretch a precedent (e.g. Bhajan Lal categories) beyond its stated proposition.`;

const A005_NOTICE_TIMELINES = `STATUTORY NOTICE TIMELINES (A-005 — mandatory):
- NI Act s.138: statutory notice within 30 days of dishonour; suit within 30 days of notice expiry unless time extended.
- Consumer Protection Act 2019: pre-litigation notice / mediation timelines per 2019 Act rules when applicable; cite CPA 2019 (not repealed 1986 Act alone).
- Contract breach: reasonable cure period (typically 15–30 days) before termination/consequences — state expressly.
- Always state the consequence of non-compliance and the deadline in days from service.`;

const A006_AFFIDAVIT_VERIFICATION = `AFFIDAVIT VERIFICATION SPLIT (A-006 — mandatory):
- Separate averments based on personal knowledge vs information believed to be true on record.
- Mark paragraphs "true to my personal knowledge" vs "based on records/information believed true".
- Verification clause must mirror the split; oath/affirmation block at end.`;

const A001_INDIA_EXECUTION = `INDIA EXECUTION BLOCK (A-001 — agreements):
- Stamp duty: [[PLACEHOLDER: State stamp duty / registration requirement]].
- Arbitration seat: India (city) under Arbitration and Conciliation Act 1996 unless foreign seat specified.
- Governing law: laws of India; DPDP Act 2023 compliance for personal data processing clauses.
- Execution: two witnesses + authorised signatories; date/place lines; schedule for annexures.`;

const A047_STATUTE_FIRST = `STATUTE-FIRST RESEARCH (A-047):
- Lead with governing enactment text and section mapping (BNS/BNSS/BSA post–1 Jul 2024).
- Caselaw supports statutory interpretation — do not lead with case names when a clear statute applies.
- Map IPC/CrPC/CPC transitional references only when the matter is pre-commencement or expressly transitional.`;

const A048_CASELAW_FIRST = `CASELAW-FIRST RESEARCH (A-048):
- Lead with leading judgments and ratio decidendi; statute sections follow the holding.
- For each authority: case name + locatable citation + proposition supported.
- SOURCES CONSULTED must list every cited case with citationRef from retrieved context.
- Prefer concrete search terms (statute section + offence/issue, e.g. "420 IPC", "anticipatory bail BNSS") over bare topic words ("bail") — partner caselaw API defaults to mode=fts; use mode=hybrid only when semantic recall is required.
- If retrieval returns degraded/empty, state the gap honestly and suggest a narrower FTS query — never invent citations.`;

const STATE_COURT_HEADER_HINT = `STATE-SPECIFIC COURT HEADERS (when jurisdiction/state param present):
- Cause title must name the exact High Court seat (e.g. "IN THE HIGH COURT OF JUDICATURE AT BOMBAY" / "AT MADRAS" / "FOR THE STATE OF TELANGANA AT HYDERABAD").
- District/Sessions: "IN THE COURT OF THE SESSIONS JUDGE, [DISTRICT], [STATE]" — never substitute "India" alone.
- Use state-appropriate registry abbreviations (WP/CRLP/CS/OS) when case type is supplied.`;

const DPDP_CONSUMER_TAG = `DPDP 2023 + CONSUMER PROTECTION 2019 (notice/agreement paths):
- Personal data clauses: DPDP Act 2023 — purpose limitation, consent, retention, cross-border transfer, grievance officer in [[PLACEHOLDER: …]].
- Consumer-facing notices/claims: Consumer Protection Act 2019 + applicable rules (not repealed 1986 Act alone); mediation/efiling timelines where relevant.
- Do not conflate IT Act 2000 s.43A legacy wording with DPDP 2023 operative duties.`;

const AGENT_OVERLAY_MAP: Record<string, string> = {
  'A-001': A001_INDIA_EXECUTION,
  'A-004': A004_PRE_FILING,
  'A-005': A005_NOTICE_TIMELINES,
  'A-006': A006_AFFIDAVIT_VERIFICATION,
  'A-047': A047_STATUTE_FIRST,
  'A-048': A048_CASELAW_FIRST,
};

export function buildAgentDraftOverlay(agentId?: string): string {
  const id = String(agentId || '').trim().toUpperCase();
  if (!id) return '';
  return AGENT_OVERLAY_MAP[id] ?? '';
}

export function buildResearchAgentOverlay(agentId?: string, taskType?: string): string {
  const id = String(agentId || '').trim().toUpperCase();
  const tt = String(taskType || '').toLowerCase();
  if (id === 'A-047' || /statute[-_]?research|statute_lookup|statute-research/.test(tt)) {
    return A047_STATUTE_FIRST;
  }
  if (id === 'A-048' || /caselaw[-_]?research|legal_research/.test(tt)) {
    return A048_CASELAW_FIRST;
  }
  return buildAgentDraftOverlay(id);
}

/** Jurisdiction/state court header overlay for draft prompts. */
export function buildJurisdictionCourtHeaderOverlay(parameters?: Record<string, unknown>): string {
  if (!parameters || typeof parameters !== 'object') return '';
  const state = String(
    parameters.state ?? parameters.stateName ?? parameters.state_name ?? '',
  ).trim();
  const highCourt = String(
    parameters.highCourt ?? parameters.high_court ?? parameters.hcName ?? '',
  ).trim();
  if (!state && !highCourt) return '';
  return STATE_COURT_HEADER_HINT;
}

/** DPDP + CPA 2019 tags for notice/agreement document families. */
export function buildRegulatoryComplianceOverlay(documentType?: string): string {
  const dt = String(documentType || '').toLowerCase();
  if (
    dt.includes('notice')
    || dt.includes('agreement')
    || dt.includes('contract')
    || dt === 'legal_notice'
    || dt === 'reply_legal_notice'
    || dt === 'simple_agreement'
    || dt === 'complex_agreement'
  ) {
    return DPDP_CONSUMER_TAG;
  }
  return '';
}

/** SLP paper-book checklist when writ_petition path mentions SLP / Art 136. */
export function buildSlpPaperbookOverlay(input: {
  documentType?: string;
  parameters?: Record<string, unknown>;
  instruction?: string;
  prompt?: string;
}): string {
  const blob = [
    input.documentType,
    input.instruction,
    input.prompt,
    JSON.stringify(input.parameters ?? {}),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const isWrit = String(input.documentType || '').includes('writ');
  const mentionsSlp = /\bslp\b|\bspecial[\s_-]+leave|\barticle\s*136\b/.test(blob);
  if (!isWrit && !mentionsSlp) return '';
  if (!mentionsSlp && input.documentType !== 'writ_petition') return '';

  return SLP_PAPERBOOK_RULE;
}

export function buildDocumentTypeDraftOverlays(input: {
  agentId?: string;
  documentType?: DraftDocumentType | string;
  parameters?: Record<string, unknown>;
  instruction?: string;
  prompt?: string;
}): string {
  return [
    buildAgentDraftOverlay(input.agentId),
    buildJurisdictionCourtHeaderOverlay(input.parameters),
    buildRegulatoryComplianceOverlay(String(input.documentType || '')),
    buildSlpPaperbookOverlay(input),
  ]
    .filter(Boolean)
    .join('\n\n');
}
