/**
 * NV-LEGAL-INTEL-FORCE-001 — Universal legal intelligence overlay for every
 * ecosystem AI path (Queen leaves, specialist, research, agents/run, chat).
 *
 * Problem: registry prompts are long governance templates; SME craft lived only
 * on gateway draft and was often stripped by prompt-compiler / length-prefer.
 * This module is the single injector that must survive merge + compile.
 */

import {
  buildLegalAdviceSystemPrompt,
  buildLegalDraftSystemPrompt,
  formatForumContext,
  inferDraftDocFamily,
} from './jrx-legal-drafting-prompt.js';
import {
  formatBnssApplicationsOverlay,
  matchBnssCourtApplications,
} from '../data/jrx-bnss-court-applications-pack.js';
import { parseAgentPromptBundle, buildActiveAgentLayer } from './jrx-agent-prompt-bundle.js';
import { selectLegalStructure, structureFillOverlay } from './jrx-legal-structure-attach.js';
import { resolveTransactionalDraftDocumentType } from './jrx-indian-draft-structure-registry.js';
import {
  buildCompactPlatformTemporalContextBlock,
  buildPlatformTemporalContextBlock,
} from '../utils/jrx-platform-temporal-context.js';
import { formatIndianDraftStructureChecklist } from './jrx-indian-draft-structure-registry.js';
import { isPartnerDraftTaskType } from '../config/jrx-draft-length-registry.js';
import { buildResearchAgentOverlay } from './jrx-agent-draft-overlay.js';

/** Marker used to detect / preserve overlay across merge + compile. */
export const LEGAL_INTEL_OVERLAY_MARKER = 'NV-LEGAL-INTEL-FORCE-001';

export const LEGAL_CHAT_STRUCTURE_MARKER = 'NV-LEGAL-CHAT-STRUCTURE-001';

/**
 * Counsel-grade chat / intelligence answer skeleton — issue through sources.
 * NV-INDIAN-STRUCTURE-001 companion to draft checklists.
 */
export function buildLegalChatStructurePrompt(compact = false): string {
  if (compact) {
    return `${LEGAL_CHAT_STRUCTURE_MARKER}: Issue → short answer → applicable law → analysis → risks → next steps. Cite only retrieved authorities; never fabricate. End with **SOURCES CONSULTED** listing case name + citation + proposition supported, or state none retrieved.`;
  }
  return `${LEGAL_CHAT_STRUCTURE_MARKER} (mandatory counsel structure — use these headings):
- **ISSUE & SHORT ANSWER** — precise legal question and direct answer first
- **FACTS ASSUMED / CONTEXT** — only supplied or stated facts; mark gaps [TO BE CONFIRMED]
- **APPLICABLE LAW & INGREDIENTS** — BNS/BNSS/BSA (post–1 Jul 2024) or civil/commercial enactment with ingredient mapping
- **ANALYSIS** — reasoned application of law to facts; chain-of-thought visible here, not as raw scratchpad
- **OPTIONS & TRADE-OFFS** — practical paths (litigation, negotiation, regulatory)
- **RISKS & CAVEATS** — limitation, forum, evidentiary gaps, adverse inference
- **NEXT STEPS / PRAYER** — concrete actions for counsel/client
- **SOURCES CONSULTED** — for EVERY cited authority: case name + reporter/SCC/CNR citation + exact proposition supported; if none retrieved, state "No corpus authority retrieved — answer rests on statutory text and general principle"
Never fabricate citations. Use [CITATION REQUIRED] when uncertain.`;
}

export type LegalIntelTaskKind =
  | 'draft'
  | 'advice'
  | 'research'
  | 'analysis'
  | 'chat'
  | 'general';

/**
 * NV-TOKEN-BUDGET-001 — a bare topic word must not force the drafting tier.
 *
 * Measured defect: the trigger list mixed production verbs with bare topic nouns
 * (`bail`, `fir`, `prayer`), so "Is anticipatory bail available for a BNS 318(4)
 * case in Karnataka?" — a pure question — was classified `draft` and received the
 * 622-token `buildLegalDraftSystemPrompt`. A request to PRODUCE a document either
 * uses a production verb or names a document; an interrogative about the law is
 * neither. The topic-only demotion applies ONLY to an interrogative, so every
 * genuine drafting instruction keeps its full drafting scaffolding — and the
 * document-noun list additionally now covers `written statement` / `rejoinder`,
 * which previously fell through to `general` and were UNDER-scaffolded.
 */
const DRAFT_PRODUCTION_VERB = /\b(draft|redraft|prepare|write|generate|create|file|draw\s+up)\b/;
const DRAFT_DOCUMENT_NOUN =
  /\b(plead\w*|petition|plaint|affidavit|legal\s+notice|vakalat\w*|cause\s+title|written\s+statement|rejoinder)\b/;
/** Nouns that name a legal TOPIC, not a document to be produced. */
const DRAFT_TOPIC_ONLY = /\b(fir|bail|prayer)\b/;
const INTERROGATIVE =
  /\?\s*$|^\s*(is|are|was|were|can|could|should|would|does|do|did|has|have|what|when|where|which|who|whom|whether|how|why)\b/i;

export function detectLegalIntelTaskKind(blob: string): LegalIntelTaskKind {
  const q = String(blob || '').toLowerCase();
  const namesDocument = DRAFT_DOCUMENT_NOUN.test(q);
  const asksForProduction = DRAFT_PRODUCTION_VERB.test(q);
  if (namesDocument || asksForProduction) return 'draft';
  // A topic word alone is a draft request only when it is not a question.
  if (DRAFT_TOPIC_ONLY.test(q) && !INTERROGATIVE.test(blob)) return 'draft';

  if (/\b(advise|advice|opinion|memorandum|strategy|counsel)\b/.test(q)) return 'advice';
  if (
    /\b(research|precedent|citation|caselaw|statute|authority|authorities|leading\s+case|landmark|search|template|checklist|format|procedure|process|amendment|notification|gazette|ordinance)\b/.test(q)
  ) return 'research';
  if (/\b(analy[sz]e|classify|summar|extract|clause|risk)\b/.test(q)) return 'analysis';
  if (/\b(chat|hello|hi\b|thanks)\b/.test(q) && q.length < 80) return 'chat';
  return 'general';
}

/** NV-INDIAN-LEGAL-CORPUS-001 — counsel-grade India scope (1950–2026) in ~90 tokens. */
const INDIAN_LEGAL_CORPUS_SCOPE = `INDIAN LEGAL CORPUS (1950–2026):
- Judgments: NYS plane (~26M Indian rows; SC 1950–present; HC/DC metadata-rich). Cite only retrieved rows — never invent reporter cites.
- Statutes & codes: BNS/BNSS/BSA (post–1 Jul 2024), Constitution, CPC/CrPC transitional, ICA, Companies Act, NI Act, DPDP, labour/tax/commercial enactments as applicable.
- Counsel outputs: templates, checklists, formats, procedures, and forum-specific drafting per Indian practice — not US/UK boilerplate unless expressly foreign.
- CNR / case metadata lookup ≠ live eCourts status unless explicitly supplied.
- Recent news, orders, amendments: use LEGAL INTELLIGENCE FEED or LIVE WEB SEARCH excerpts when present; never invent headlines or docket entries.`;

const UNIVERSAL_LEGAL_CORE = `${LEGAL_INTEL_OVERLAY_MARKER}
You are operating inside Jurexio — the Jurexio legal agentic AI platform.
ALWAYS use full legal intelligence: jurisdiction-correct law, precise counsel English, structured reasoning, and grounded authorities when available.

QUALITY BAR (Claude-legal / High Court counsel — MANDATORY for every AI answer):
- Match the depth, precision, and structure expected of a senior Indian advocate's written advice or pleading — not a chatbot summary and not a one-paragraph FAQ unless the user asked only for a one-line answer.
- Produce COMPREHENSIVE counsel-length analysis: issue-spot, map statutory ingredients to facts, apply retrieved authorities, flag risks, and state practical next steps. Brevity is not a virtue when it omits ingredients, forum, or caveats.
- Prefer correct BNS / BNSS / BSA (post–1 Jul 2024) or applicable civil/commercial statutes (Contract Act 1872, CPC, Companies Act 2013, NI Act, DPDP Act 2023); map ingredients of offences/claims to facts.
- Cite only retrieved or user-supplied authorities; never invent case names, reporter citations, or section numbers. If an authority is not in context, say so and use [SQUARE BRACKETS] or omit.
- Use formal Indian legal English for filings; measured counsel English for advice/research.
- CHAIN OF THOUGHT (reason, then write): (1) legal question and forum, (2) applicable enactment and ingredients, (3) facts mapped to each ingredient, (4) retrieved authorities only, (5) residual risk and next steps. The ANALYSIS heading is the reasoned output — do not dump an internal scratchpad or invent citations to fill gaps.
- This quality bar is a hard platform guardrail — do not dilute for speed unless JRX_LEGAL_COMPREHENSIVE=0 or the user asked only for a one-line answer.

MANDATORY BEHAVIOUR:
- Write as a practising Indian advocate / legal researcher — human, precise, context-oriented — never as a generic chatbot.
- Prefer Indian formal legal English for filings and advice (Most Respectfully Showeth / Prayer / Verification / This Hon'ble Court) when drafting instruments.
- Criminal post–1 Jul 2024: BNS / BNSS / BSA (not IPC/CrPC/IEA unless transitional).
- Never invent case citations, section numbers, party names, or FIR numbers — use [SQUARE BRACKETS] or omit.
- Do not invent surety schedules in bail applications — sureties only after bail is granted.
- Use named forum (High Court / District / Sessions / Magistrate) when provided — not bare "India".
- Prefer RAG / Knowledge Plane / memory context when present; cite retrieved authorities. Grounding order: NYS caselaw/statutes (1950–2026) → tenant RAG → legal intelligence feed / live web search (when supplied) → matter memory → model knowledge (disclose when used).
- Structure answers with ALL of these headings (omit a heading only if truly inapplicable, and say why):
  **ISSUE & SHORT ANSWER** · **FACTS ASSUMED / CONTEXT** · **APPLICABLE LAW & INGREDIENTS** · **ANALYSIS** · **AUTHORITIES** · **RISKS & CAVEATS** · **NEXT STEPS / PRAYER**
- For contract/instrument analysis also cover: missing protections, obligations/deadlines, and negotiation priorities (India: ICA 1872, stamp, DPDP — never invent US GDPR/CCPA as governing unless the instrument is foreign).
- Never say "As an AI", "Certainly!", "Here's a draft" as a preamble.`;

/**
 * NV-TOKEN-BUDGET-001 — compact tier of the universal core (~200 tok vs ~799).
 *
 * Every correctness-critical rule from the full core is retained verbatim in
 * substance: the post–1 Jul 2024 BNS/BNSS/BSA mapping, the never-invent-an-
 * authority rule, the bail surety rule, named-forum precision, the grounding
 * order, and the no-chatbot-preamble rule. What is dropped is the QUALITY BAR
 * block and the seven mandatory headings — those are *length and formatting*
 * mandates ("COMPREHENSIVE counsel-length analysis", "Brevity is not a virtue"),
 * which on a one-line statute question both cost ~310 tokens and push the model
 * to answer a question the user did not ask. The contract-review checklist is
 * likewise omitted because it is only ever relevant to instrument review, which
 * is classified as research/analysis and therefore gets the full tier.
 */
const COMPACT_LEGAL_CORE = `${LEGAL_INTEL_OVERLAY_MARKER}
You are Jurexio (Jurexio legal AI) answering as a practising Indian advocate — precise counsel English, never chatbot filler, never "As an AI" / "Certainly!".
NON-NEGOTIABLE:
- Criminal matters post–1 Jul 2024: cite BNS / BNSS / BSA, not IPC / CrPC / IEA (unless expressly transitional). Civil/commercial: the applicable Indian enactment (ICA 1872, CPC, Companies Act 2013, NI Act, DPDP Act 2023).
- Never invent case names, reporter citations, section numbers, party names, or FIR numbers. Cite only authorities present in the retrieved context or supplied by the user; if none is available, say so plainly.
- Never list sureties in a bail application — sureties arise only after bail is granted.
- Name the forum (specific High Court / District / Sessions / Magistrate) when it is known; never write bare "India".
- Grounding order: NYS caselaw/statutes (1950–2026) → tenant RAG → legal feed / live web search (when supplied) → matter memory → model knowledge. State when an answer rests on model knowledge alone.
ANSWER SHAPE (direct question): short answer → governing provision and its ingredients → the one risk or caveat that matters. Expand only as far as the question requires.`;

const COMPACT_INDIAN_CORPUS_SCOPE = `CORPUS: Indian judgments ~1950–2026 via NYS plane; cite only retrieved rows. CNR ≠ live eCourts. Use legal feed / web search excerpts when supplied — never invent news or cites.`;

/** How much fixed scaffolding the task justifies (see `jrx-prompt-budget.ts`). */
export type LegalIntelOverlayDepth = 'compact' | 'full' | 'micro';

/**
 * Build overlay text for the detected task.
 *
 * `depth: 'compact'` (NV-TOKEN-BUDGET-001) emits the compact core plus only the
 * *query-targeted* Indian blocks. It never emits the untargeted formatting
 * scaffolding, and never emits a second copy of a block the core already covers.
 */
export function buildUniversalLegalIntelligenceOverlay(opts: {
  prompt?: string;
  jurisdiction?: string;
  taskKind?: LegalIntelTaskKind;
  parameters?: Record<string, unknown>;
  partnerBestOutcome?: boolean;
  depth?: LegalIntelOverlayDepth;
  /** NV-INDIAN-STRUCTURE-001 — partner documentType for draft checklist injection. */
  documentType?: unknown;
  taskType?: unknown;
  /** Pinned agent (A-047 statute-first vs A-048 caselaw-first). */
  agentId?: string;
}): string {
  const blob = String(opts.prompt || '');
  const kind = opts.taskKind || detectLegalIntelTaskKind(blob);
  const jur = String(opts.jurisdiction || 'IN').toUpperCase();
  const isIN = jur === 'IN' || jur === 'INDIA' || jur.startsWith('IN');
  const compact = opts.depth === 'compact';
  let draftChecklistFromParams = '';
  const parts: string[] = [compact ? COMPACT_LEGAL_CORE : UNIVERSAL_LEGAL_CORE];
  parts.push(
    compact
      ? buildCompactPlatformTemporalContextBlock()
      : buildPlatformTemporalContextBlock(),
  );

  if (isIN) {
    parts.push(compact ? COMPACT_INDIAN_CORPUS_SCOPE : INDIAN_LEGAL_CORPUS_SCOPE);
    const forum = formatForumContext(opts.parameters);
    if (forum) parts.push(forum);
    // Query-matched, so it is targeted rather than boilerplate: it supplies the
    // correct BNSS section for the specific application the user asked about,
    // which is exactly the kind of grounding we must not trade for tokens.
    const bnss = formatBnssApplicationsOverlay(matchBnssCourtApplications(blob, compact ? 2 : 3));
    if (bnss) parts.push(bnss);

    /*
     * NV-PLATFORM-CAPABILITY-PROMPT-001 (2026-08-18) — tell the model what it is standing on.
     *
     * Audited today: the platform overlay mentioned retrieval 10 times and citations 6, but
     * `tools`, `skills` and `MCP` **zero** times, and no layer emitted a capability manifest.
     * A model that is not told a verified statute mapping and a retrieved-authority plane
     * exist answers from parametric memory instead — which is exactly the shape of the
     * "BNS 138 = Abduction" class of error NSP reported (BNS 138 is not the NI Act s.138).
     *
     * Two reasons this is worth its tokens, both tied to stated priorities:
     *   • QUALITY — it converts "recall the section" into "use the mapping you were given",
     *     and names the one thing a legal model must never do (invent a citation).
     *   • COST — an undirected model pads and then needs a corrective turn. Naming the
     *     grounding reduces both.
     *
     * Deliberately capability CLASSES, not a live tool list: this string is part of the
     * cached prompt prefix, and interpolating per-request tool names would defeat Gemini's
     * implicit prefix cache (NV-GEMINI-CACHE-001) and Anthropic's explicit one for every
     * call. A live manifest belongs in the tool-bridge, not in a cached prefix.
     *
     * Kept to ~90 tokens and INCLUDED in the compact tier, because a cheap hop that
     * hallucinates a citation is worse than a cheap hop that costs 90 more tokens. The
     * micro_faq/classify tiers get it too for the same reason.
     */
    parts.push(
      compact
        /* NV-CITE-GROUND-001 — the compact tier is budget-capped at 600 tokens
         * (`jrx-prompt-budget.ts` `micro_faq`). The full temporal block (~137 tok)
         * plus grounding discipline exceeded that ceiling; compact temporal
         * (~45 tok) keeps year/YTD/no-invent rules without blowing the budget.
         * Measured ~525 tok total with pinned ref date 2026-08-20. */
        ? 'GROUNDING DISCIPLINE: You are one stage of a legal platform supplying verified statute mappings (IPC↔BNS, CrPC↔BNSS, IEA↔BSA), retrieved statute/judgment excerpts and case metadata. A supplied authority beats recalled text. Never invent a case name, citation, section number or URL. Cite every authority from the context\'s AUTHORITIES SUPPLIED list that your answer rests on — inline, by name, reproducing its reference exactly. If there is no such list, say so in one line rather than writing confident uncited prose.'
        : [
            'PLATFORM CAPABILITIES & GROUNDING DISCIPLINE',
            'You are the reasoning stage of an agentic legal platform, not a standalone model. Upstream stages may already have supplied:',
            '• Verified statute mappings — IPC↔BNS, CrPC↔BNSS, IEA↔BSA — from official concordance tables, including 1-to-many splits and change notes.',
            '• Retrieved statute and judgment excerpts from the Indian corpus, with citations.',
            '• Case metadata (cause title, filing number, parties, next hearing) extracted deterministically from filed documents.',
            '• Prior turns of this matter from durable memory.',
            'Rules, in order of precedence:',
            '1. A supplied authority always beats recalled text. If the context gives you the section, quote it — do not restate it from memory.',
            '2. Never invent a case name, citation, section number, paragraph or URL. A fabricated citation is the single worst failure this platform can produce.',
            '3. If an authority you need is absent from the context, say so plainly ("not verified against the corpus") rather than filling the gap.',
            /* NV-CITE-GROUND-001 (2026-08-19) — rules 2 and 3 forbade inventing an
             * authority but nothing REQUIRED using the ones we retrieved. Measured
             * consequence: a research answer of 6,925 chars with 0 case citations
             * while the governing authorities (Sushila Aggarwal, Gurbaksh Singh
             * Sibbia) were sitting in the retrieved context. Rule 3a is the
             * positive obligation, and it is deliberately worded to be *bounded by*
             * rule 2 — "cite what was supplied", never "produce a citation". The
             * two must not be readable as a licence to fill a gap. */
            '3a. USE what you were supplied. If the context contains an "AUTHORITIES SUPPLIED" list, then: every proposition that rests on one of those authorities must name it and carry its reference inline (e.g. "Sushila Aggarwal v. State (NCT of Delhi), (2020) 5 SCC 1"); the AUTHORITIES heading must list them; and a reference synthesised from metadata (court, year, CNR, case number) is a valid reference — reproduce it exactly as given rather than converting it into a reporter citation. This obligation is bounded by rule 2: cite what is in the list, never manufacture a citation to satisfy it.',
            '3b. If NO authority was supplied, state that in one line ("No corpus authority was retrieved for this question; the following rests on the statutory text and general principle") and then answer on the statute. Confident, well-structured prose with no authority and no such caveat is a defect, not a safe answer.',
            '4. Statute numbering changed in 2023. Never assume a section number carries its old meaning across codes — check the supplied mapping. A number that exists in both codes is the most dangerous case.',
            '5. Do not promise an outcome, advise on forum-shopping, or substitute for a licensed advocate. Flag matters that need one.',
          ].join('\n'),
    );

    const partnerDocType = opts.documentType
      ?? opts.parameters?.documentType
      ?? opts.parameters?.draftType;
    draftChecklistFromParams = partnerDocType || isPartnerDraftTaskType(String(opts.taskType || ''))
      ? formatIndianDraftStructureChecklist({
          documentType: partnerDocType,
          taskType: opts.taskType,
          prompt: blob,
          parameters: opts.parameters,
        })
      : '';

    if (!compact) {
      const transactionalDraft = resolveTransactionalDraftDocumentType({
        documentType: partnerDocType,
        taskType: opts.taskType,
        prompt: blob,
        instruction: blob,
        parameters: opts.parameters,
      });
      if (!transactionalDraft) {
        const fill = structureFillOverlay(
          selectLegalStructure({
            query: blob,
            taskType: kind === 'draft' ? 'document-drafting' : kind,
            jurisdiction: jur,
            documentType: partnerDocType ? String(partnerDocType) : undefined,
            template: typeof opts.parameters?.template === 'string' ? opts.parameters.template : undefined,
            parameters: opts.parameters,
          }),
        );
        if (fill) parts.push(fill);
      }
    }

    if (kind === 'draft') {
      parts.push(
        buildLegalDraftSystemPrompt({
          jurisdiction: 'IN',
          instruction: blob,
          parameters: opts.parameters,
          partnerBestOutcome: opts.partnerBestOutcome !== false,
          documentType: partnerDocType ? String(partnerDocType) : undefined,
          template: typeof opts.parameters?.template === 'string' ? opts.parameters.template : undefined,
          agentId: opts.agentId,
          // Already emitted above from the same blob/parameters.
          includeBnssAndForum: false,
        }),
      );
    } else if (kind === 'advice' || kind === 'general' || kind === 'chat') {
      parts.push(buildLegalChatStructurePrompt(compact));
      if (!compact) {
        // Skipped in the compact tier: COMPACT_LEGAL_CORE already states the
        // answer shape and the "never a filed pleading" limit.
        parts.push(buildLegalAdviceSystemPrompt('IN', blob, false));
      }
    } else if (kind === 'research') {
      const researchOverlay = buildResearchAgentOverlay(
        opts.agentId,
        String(opts.taskType || ''),
      );
      if (researchOverlay) parts.push(researchOverlay);
      parts.push(
        compact
          ? `LEGAL RESEARCH MODE: Counsel brief — issues, governing enactment, leading principles from retrieved authorities, risks, next steps. Use templates/checklists when the user asks for formats or procedures.`
          : `LEGAL RESEARCH MODE: Produce a counsel-grade research brief covering all practice areas — constitutional, criminal, civil, commercial, labour, tax, regulatory, and governance.
- Map issues to applicable BNS/BNSS/BSA (post–1 Jul 2024) or civil/commercial statutes; trace amendments and transitional provisions when relevant.
- Leading authorities: cite retrieved judgments/statutes only; for each case name include a locatable reporter citation adjacent to the name — e.g. (2019) 9 SCC 24 or AIR 2018 SC 514 — not bare party names alone; for HC/DC use CNR/court/year metadata when reporter cites are absent.
- Templates & procedures: when asked, supply counsel-level formats, checklists, and step-by-step process (filing, limitation, court fees, verification) for the named forum.
- Latest developments: synthesize legal intelligence feed and live web search excerpts when supplied; distinguish corpus-backed law from recent news.`,
      );
      parts.push(buildLegalChatStructurePrompt(compact));
    } else if (kind === 'analysis') {
      // Compact tier keeps the mode line but drops the instrument-review
      // checklist: it only applies to agreement review, which classifies as
      // research/drafting and therefore receives the full tier.
      parts.push(
        compact
          ? `LEGAL ANALYSIS MODE: Structured analysis — issues, holdings/risks, statute mapping, actionable recommendations in advocate language.`
          : `LEGAL ANALYSIS MODE: Structured analysis with issues, holdings/risks, statute/contract mapping, and actionable recommendations in advocate language.
CONTRACT / INSTRUMENT COMPLETENESS (India — when the query is a review of an agreement):
- Score each material clause High / Medium / Low (exposure, not US "safety score" theatre).
- Missing protections an Indian counsel would expect: consideration + stamp, ICA 1872 ss.10/23/28 (unlawful consideration / restraint), termination + notice, limitation of liability, indemnity, GST/withholding, dispute resolution (Arbitration and Conciliation Act 1996 or named court), governing law India, DPDP Act 2023 if personal data, force majeure, assignment.
- Employment instruments: Industrial Disputes Act / Shops Act / state labour, PF-ESI-gratuity where attracted, reasonable non-compete, IP assignment, termination notice — never US at-will / GDPR / CCPA as governing law unless the instrument is expressly foreign.
- Obligations and deadlines with consequence if missed; negotiation priorities with suggested alternative language under ICA 1872.
- Do not apply US employment / GDPR / CCPA / ADA templates as if they were Indian law.`,
      );
    }
  } else {
    parts.push(
      `JURISDICTION: ${jur}. Use that jurisdiction's citation conventions. Professional counsel voice — not chatbot.`,
    );
  }

  if (draftChecklistFromParams && kind !== 'draft') {
    parts.push(draftChecklistFromParams);
  }

  return parts.filter(Boolean).join('\n\n');
}

export function looksLikeLegalIntelOverlay(text: string): boolean {
  return String(text || '').includes(LEGAL_INTEL_OVERLAY_MARKER)
    || /BAIL APPLICATION — SURETIES RULE|High Court \/ Sessions paper-book|practising Indian advocate/i.test(
      String(text || ''),
    );
}

/**
 * Compress a 23-section registry prompt WITHOUT dropping agent identity.
 *
 * Bug (NV-LEGAL-INTEL-FORCE-001 follow-up): naive `slice(0, 4500)` ended inside
 * §0 SECURITY (~chars 0–4600) and cut off §1 ROLE IDENTITY + §2 CORE MANDATE —
 * so every Queen leaf looked like the same generic advocate after overlay merge.
 *
 * Keep: §0 (short), §1 identity, §2 mandate, retrieval policy, anti-hallucination
 * Drop/compress: middle governance sections (§3–§22) when over budget.
 */
export function preserveAgentIdentityFromRegistryPrompt(registryPrompt: string, maxChars = 12000): string {
  const base = String(registryPrompt || '').trim();  if (!base) return base;
  if (/<section_1_identity>|<section_0_security/i.test(base)) {
    try {
      const bundle = parseAgentPromptBundle(base, 'registry');
      const l1 = buildActiveAgentLayer(bundle);
      if (l1.length <= maxChars) return l1;
      return `${l1.slice(0, maxChars)}\n[…agent prompt budget…]`;
    } catch {
      /* fall through to XML take() */
    }
  }
  if (base.length <= maxChars && !/<section_0_security/i.test(base)) return base;

  const take = (tag: string): string => {
    const re = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'i');
    const m = base.match(re);
    return m ? m[0].trim() : '';
  };

  const identity = take('section_1_identity');
  const mandate = take('section_2_core_mandate');
  const antiHall = take('section_8_anti_hallucination');
  const retrieval = take('section_retrieval_policy');
  const sec0 = take('section_0_security_constitution');

  if (identity || mandate) {
    const sec0Short = sec0
      ? `${sec0.slice(0, 1800)}${sec0.length > 1800 ? '\n[…§0 security truncated — full constitution applied at gateway…]' : ''}`
      : '';
    const parts = [
      sec0Short,
      identity || '',
      mandate || '',
      antiHall ? antiHall.slice(0, 1200) : '',
      retrieval || '',
      '[Registry §3–§22 compressed — identity + mandate + retrieval retained for agentic role fidelity.]',
    ].filter(Boolean);
    let out = parts.join('\n\n');
    if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n[…agent prompt budget…]`;
    return out;
  }

  if (base.length > maxChars) {
    const head = base.slice(0, Math.floor(maxChars * 0.7));
    const tail = base.slice(-Math.floor(maxChars * 0.25));
    return `${head}\n\n[…registry middle compressed — identity/mandate preferred…]\n\n${tail}`;
  }
  return base;
}

/**
 * Merge registry (or other base) prompt with legal intelligence overlay.
 * NEVER discard the overlay in favour of a longer generic registry blob.
 * NEVER discard §1 ROLE IDENTITY / §2 CORE MANDATE when compressing registry.
 */
export function mergeLegalIntelligencePrompt(
  basePrompt: string,
  overlay: string,
  baseMaxChars?: number,
): string {
  const base = String(basePrompt || '').trim();
  const over = String(overlay || '').trim();
  if (!over) return base;
  if (!base) return over;
  if (base.includes(LEGAL_INTEL_OVERLAY_MARKER) && over.includes(LEGAL_INTEL_OVERLAY_MARKER)) {
    // Base already has intel — append only if over adds draft/bail specifics not present
    if (over.length > 400 && !/SURETIES RULE|paper-book/i.test(base) && /SURETIES RULE|paper-book/i.test(over)) {
      return `${base}\n\n---\n${over}`;
    }
    return base;
  }
  if (looksLikeLegalIntelOverlay(base) && !looksLikeLegalIntelOverlay(over)) {
    return base; // keep SME base over thin over
  }
  // Prefer: agent identity + mandate (preserved) + full legal overlay
  const trimmedBase = preserveAgentIdentityFromRegistryPrompt(base, baseMaxChars);
  return `${trimmedBase}\n\n---\n${over}`;
}

/**
 * Choose effective system prompt for callJurexio / Queen: never let a longer
 * generic agent prompt wipe a shorter legal-intel overlay.
 */
export function preferLegalIntelligenceSystemPrompt(
  callerSystemPrompt: string,
  agentSystemPrompt: string | undefined | null,
): string {
  const caller = String(callerSystemPrompt || '');
  const agent = String(agentSystemPrompt || '');
  if (!agent) return caller;
  if (!caller) return agent;
  if (looksLikeLegalIntelOverlay(caller)) {
    return mergeLegalIntelligencePrompt(agent, caller);
  }
  if (looksLikeLegalIntelOverlay(agent) && !looksLikeLegalIntelOverlay(caller)) {
    return mergeLegalIntelligencePrompt(caller, agent);
  }
  // Legacy length-prefer only when neither is legal-intel marked
  if (agent.length > caller.length) {
    return mergeLegalIntelligencePrompt(agent, caller.length > 80 ? caller : '');
  }
  return mergeLegalIntelligencePrompt(caller, agent.length > 80 ? agent : '');
}
