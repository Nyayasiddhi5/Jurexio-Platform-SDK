/**
 * Governance: redaction, restricted-matter gating, and the hash-chained audit log.
 *
 * This module is not a compliance ornament bolted onto the parser. It sits on the
 * only path by which extracted values reach persistence, and it is the reason the
 * pipeline can be operated at all under DPDP, GDPR and the Bar Council rules:
 *
 *  - Aadhaar numbers appear constantly in Indian filings and must not be stored
 *    in full. Masking happens BEFORE persistence, at the candidate level, and the
 *    unmasked value is never the normalised form (see resolve/sweep.ts) so a
 *    downstream bug cannot leak it by writing the "clean" value.
 *
 *  - Certain offences carry a statutory bar on disclosing the victim's identity
 *    (IPC s.228A, BNS s.72, POCSO s.23, JJ Act s.74). A matter touching those
 *    sections is RESTRICTED: names and identifiers are withheld from proposals
 *    shown to unauthorised roles, and the matter is excluded from analytics.
 *
 *  - Every decision is written to a hash-chained append-only log, so the sequence
 *    of what was proposed, what a human accepted and what was rejected can be
 *    reconstructed exactly. A tamper anywhere in the chain invalidates every
 *    subsequent entry, which is what makes the log evidence rather than notes.
 */

import { createHash } from "node:crypto";
import type { Candidate, GovernanceReport, Page, Person, StatuteSection } from "../types.js";
import { isProtectedOffence } from "../grammar/sections.js";

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

export interface RedactionConfig {
  maskAadhaar: boolean;
  maskAccountNumbers: boolean;
  maskPhones: boolean;
}

export interface RedactionRecord {
  kind: string;
  documentId: string;
  pageNo: number;
  count: number;
}

/** Mask keeping the last N characters, which is what a human needs to verify. */
export function maskTail(value: string, keep = 4, groupWith = ""): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= keep) return "X".repeat(digits.length);
  const masked = "X".repeat(digits.length - keep) + digits.slice(-keep);
  if (groupWith === " " && masked.length === 12) {
    return `${masked.slice(0, 4)} ${masked.slice(4, 8)} ${masked.slice(8)}`;
  }
  return masked;
}

/**
 * Redact sensitive candidates in place.
 *
 * Operates on the candidate list rather than on page text, deliberately. Page
 * text is EVIDENCE and must remain byte-exact for the provenance highlight to
 * land on the right pixels — an advocate clicking "view in source" needs to see
 * what the document actually says. What must not be persisted is the extracted
 * FIELD. So the evidence plane keeps the original and the proposal plane carries
 * only the mask.
 */
export function redactCandidates(
  candidates: Candidate[],
  config: RedactionConfig,
): { candidates: Candidate[]; redactions: RedactionRecord[] } {
  const counts = new Map<string, RedactionRecord>();

  const bump = (kind: string, documentId: string, pageNo: number) => {
    const k = `${kind}|${documentId}|${pageNo}`;
    const r = counts.get(k);
    if (r) r.count++;
    else counts.set(k, { kind, documentId, pageNo, count: 1 });
  };

  const out = candidates.map((c) => {
    const isAadhaar = c.fieldPath === "ids.aadhaar" || /aadhaar/i.test(c.extractorId);
    const isAccount = c.fieldPath.startsWith("bank.accountNo") || /ACCOUNT_NO/.test(c.extractorId);
    const isPhone = c.fieldPath.startsWith("contacts.phone") || /PHONE/.test(c.extractorId);

    if (isAadhaar && config.maskAadhaar) {
      bump("AADHAAR", c.documentId, c.pageNo);
      return {
        ...c,
        // valueRaw is overwritten too. An Aadhaar number has no legitimate reason
        // to persist in the proposal plane in any field, including the raw one.
        valueRaw: maskTail(c.valueRaw, 4, " "),
        valueNormalized: { masked: maskTail(c.valueRaw, 4, " "), last4: c.valueRaw.replace(/\D/g, "").slice(-4) },
        redacted: true,
        notes: [...(c.notes ?? []), "masked before persistence: Aadhaar (DPDP data minimisation)"],
      };
    }

    if (isAccount && config.maskAccountNumbers) {
      bump("ACCOUNT_NO", c.documentId, c.pageNo);
      return {
        ...c,
        valueRaw: maskTail(c.valueRaw, 4),
        valueNormalized: { masked: maskTail(c.valueRaw, 4), last4: c.valueRaw.replace(/\D/g, "").slice(-4) },
        redacted: true,
        notes: [...(c.notes ?? []), "masked before persistence: bank account number"],
      };
    }

    if (isPhone && config.maskPhones) {
      bump("PHONE", c.documentId, c.pageNo);
      return {
        ...c,
        valueRaw: maskTail(c.valueRaw, 4),
        valueNormalized: maskTail(c.valueRaw, 4),
        redacted: true,
        notes: [...(c.notes ?? []), "masked before persistence: telephone number"],
      };
    }

    return c;
  });

  return { candidates: out, redactions: [...counts.values()] };
}

/**
 * Mask sensitive numbers in the PAGE TEXT plane.
 *
 * This was added after a test caught a genuine leak. The original design masked
 * candidates only, on the reasoning that page text is "evidence" and must stay
 * byte-exact so the provenance highlight lands on the right pixels. That
 * reasoning was half right and the conclusion was wrong.
 *
 * What is actually true: the PIXELS are the evidence, and they live in the
 * document store under their own access controls. The page TEXT is a derived
 * index — it is what gets serialised into an ExtractionResult, cached, logged,
 * shipped to a search index and read by analytics. Leaving a full Aadhaar number
 * in it means every one of those surfaces holds it, which is precisely what data
 * minimisation forbids. Serialising the whole result and grepping for the number
 * found it immediately.
 *
 * The masking is length-preserving in digit count, so line and word boxes stay
 * valid and "view in source" still highlights the right region — the advocate
 * sees the real number on the page image, where it belongs, and never in a log.
 */
export function redactPageText(
  pages: Page[],
  config: RedactionConfig,
): { pages: Page[]; redactions: RedactionRecord[] } {
  const records: RedactionRecord[] = [];
  const out = redactPagesInternal(pages, config, records);
  return { pages: out, redactions: collapse(records) };
}

/**
 * Scrub EVERY surface derived from page text.
 *
 * Added after a test found a leak in a place the first two passes did not reach:
 * the classifier's evidence snippets. Those are cut from page text during
 * classification, which runs BEFORE redaction, so an Aadhaar sitting next to a
 * matched cue was copied verbatim into `classification.evidence[].snippet` and
 * survived into the serialised result — even though the candidates and the page
 * lines had both been masked.
 *
 * The lesson generalises: masking has to be applied at every point text CROSSES
 * OUT of the evidence plane, and there turned out to be three such points, not
 * one. Enumerating them here, in one function, is what stops a fourth being
 * added silently — anything that derives text from a page goes through this.
 */
export function redactDerivedText(
  doc: {
    pages: Page[];
    classification: { evidence: Array<{ cue: string; weight: number; pageNo: number; snippet: string }> };
  },
  config: RedactionConfig,
): RedactionRecord[] {
  const records: RedactionRecord[] = [];

  // 1. page lines, words and blocks
  doc.pages = redactPagesInternal(doc.pages, config, records);

  // 2. classification evidence snippets
  doc.classification = {
    ...doc.classification,
    evidence: doc.classification.evidence.map((e) => ({
      ...e,
      snippet: maskString(e.snippet, config, e.pageNo, records),
    })),
  };

  return collapse(records);
}

function collapse(records: RedactionRecord[]): RedactionRecord[] {
  const m = new Map<string, RedactionRecord>();
  for (const r of records) {
    const k = `${r.kind}|${r.pageNo}`;
    const e = m.get(k);
    if (e) e.count++; else m.set(k, { ...r });
  }
  return [...m.values()];
}

function maskString(
  s: string,
  config: RedactionConfig,
  pageNo: number,
  records: RedactionRecord[],
): string {
  const AADHAAR_TEXT = /(?<!\d)([2-9]\d{3})([ -]?)(\d{4})\2(\d{4})(?!\d)/g;
  const ACCOUNT_TEXT = /\b((?:A\/c|Account|Acct\.?)\s*(?:No\.?|Number)?\s*[:\-]?\s*)(\d{9,18})\b/gi;
  let out = s;
  if (config.maskAadhaar) {
    out = out.replace(AADHAAR_TEXT, (_m, _a, sep: string, _b, d: string) => {
      records.push({ kind: "AADHAAR_TEXT", documentId: "", pageNo, count: 1 });
      return sep ? `XXXX${sep}XXXX${sep}${d}` : `XXXXXXXX${d}`;
    });
  }
  if (config.maskAccountNumbers) {
    out = out.replace(ACCOUNT_TEXT, (_m, label: string, digits: string) => {
      records.push({ kind: "ACCOUNT_NO_TEXT", documentId: "", pageNo, count: 1 });
      return label + "X".repeat(Math.max(0, digits.length - 4)) + digits.slice(-4);
    });
  }
  return out;
}

function redactPagesInternal(
  pages: Page[],
  config: RedactionConfig,
  records: RedactionRecord[],
): Page[] {

  const maskIn = (s: string, pageNo: number): string =>
    maskString(s, config, pageNo, records);

  return pages.map((page) => ({
    ...page,
    lines: page.lines.map((line) => ({
      ...line,
      text: maskIn(line.text, page.pageNo),
      words: line.words.map((w) => ({ ...w, text: maskIn(w.text, page.pageNo) })),
    })),
    blocks: page.blocks.map((b) => ({
      ...b,
      text: maskIn(b.text, page.pageNo),
      lines: b.lines.map((line) => ({
        ...line,
        text: maskIn(line.text, page.pageNo),
        words: line.words.map((w) => ({ ...w, text: maskIn(w.text, page.pageNo) })),
      })),
    })),
  }));
}

/** Mask identity numbers on extracted Person records. */
export function redactPersons(persons: Person[], config: RedactionConfig): Person[] {
  return persons.map((p) => ({
    ...p,
    ids: p.ids.map((id) => {
      if (id.kind === "AADHAAR" && config.maskAadhaar) {
        return { kind: id.kind, value: maskTail(id.value, 4, " "), masked: true };
      }
      return id;
    }),
    phones: config.maskPhones ? p.phones.map((v) => maskTail(v, 4)) : p.phones,
  }));
}

// ---------------------------------------------------------------------------
// Restricted matters
// ---------------------------------------------------------------------------

export interface RestrictionVerdict {
  restricted: boolean;
  reasons: string[];
  /** Fields that must not be shown to unauthorised roles. */
  withheldFieldPaths: string[];
}

/**
 * Decide whether a matter is restricted.
 *
 * Section-driven, plus textual triggers for the cases where the section is not
 * stated but the document type gives it away — a POCSO special court's order, a
 * JJ Board proceeding, a rape-case MLC. Over-triggering here is the safe
 * direction: a wrongly restricted matter is an inconvenience, a wrongly
 * unrestricted one is a statutory offence.
 */
export function assessRestriction(
  sections: StatuteSection[],
  pages: Page[],
): RestrictionVerdict {
  const bySection = isProtectedOffence(sections);
  const reasons = [...bySection.reasons];

  const TEXT_TRIGGERS: Array<{ re: RegExp; why: string }> = [
    { re: /\bPOCSO\b|Protection\s+of\s+Children\s+from\s+Sexual\s+Offences/i, why: "POCSO Act referenced — s.23 bars disclosure of the child's identity" },
    { re: /\bJuvenile\s+Justice\s+Board\b|\bJJB\b|child\s+in\s+conflict\s+with\s+law/i, why: "Juvenile Justice proceeding — JJ Act s.74 bars disclosure of the child's identity" },
    { re: /\bspecial\s+court\s+(?:for\s+)?(?:POCSO|children)/i, why: "POCSO Special Court proceeding" },
    { re: /\bprosecutrix\b|\bvictim\s+of\s+(?:rape|sexual\s+assault)/i, why: "sexual-offence victim referenced — IPC s.228A / BNS s.72 bar disclosure of identity" },
    { re: /\bidentity\s+of\s+the\s+(?:victim|child|prosecutrix)\s+(?:shall\s+not|is\s+not)\s+(?:be\s+)?disclos/i, why: "document itself directs non-disclosure" },
    { re: /\bin\s*-?\s*camera\s+proceedings?\b/i, why: "in-camera proceedings directed" },
  ];

  for (const page of pages.slice(0, 4)) {
    const text = page.lines.map((l) => l.text).join(" ");
    for (const t of TEXT_TRIGGERS) {
      if (t.re.test(text) && !reasons.includes(t.why)) reasons.push(t.why);
    }
  }

  const restricted = reasons.length > 0;
  return {
    restricted,
    reasons,
    withheldFieldPaths: restricted
      ? [
          "parties[*].name", "parties[*].address", "parties[*].relation",
          "parties[*].ids", "complainant.name", "complainant.address",
          "witnesses[*].name", "witnesses[*].address", "contacts.phone",
          "contacts.email", "ids.aadhaar", "parties[*].dob",
        ]
      : [],
  };
}

// ---------------------------------------------------------------------------
// Hash-chained audit log
// ---------------------------------------------------------------------------

export interface AuditEvent {
  seq: number;
  at: string;
  actor: string;
  action: string;
  detail: string;
  hash: string;
  prevHash: string;
}

/**
 * Append-only, hash-chained audit log.
 *
 * Each entry's hash covers the entry's own content AND the previous hash, so the
 * chain is only verifiable end to end. Editing entry 5 changes its hash, which
 * breaks entry 6's `prevHash`, and so on — a single altered entry invalidates
 * every entry after it, and that is detectable by anyone holding the chain.
 *
 * The clock is injected rather than read from Date.now(). Two reasons: tests must
 * be deterministic, and in production the timestamp should come from the same
 * trusted source as the rest of the platform's audit plane rather than from
 * whatever the worker's container thinks the time is.
 */
export class AuditChain {
  private events: AuditEvent[] = [];
  private lastHash: string;

  constructor(
    private readonly clock: () => string,
    genesis = "GENESIS",
  ) {
    this.lastHash = createHash("sha256").update(genesis).digest("hex");
  }

  append(actor: string, action: string, detail: string): AuditEvent {
    const seq = this.events.length + 1;
    const at = this.clock();
    const payload = JSON.stringify({ seq, at, actor, action, detail, prevHash: this.lastHash });
    const hash = createHash("sha256").update(payload).digest("hex");
    const ev: AuditEvent = { seq, at, actor, action, detail, hash, prevHash: this.lastHash };
    this.events.push(ev);
    this.lastHash = hash;
    return ev;
  }

  all(): AuditEvent[] {
    // A copy — the caller must not be able to mutate the chain.
    return this.events.map((e) => ({ ...e }));
  }

  get head(): string { return this.lastHash; }

  /**
   * Verify the chain. Returns the sequence number of the first broken entry, or
   * null when intact.
   */
  static verify(events: AuditEvent[], genesis = "GENESIS"): number | null {
    let prev = createHash("sha256").update(genesis).digest("hex");
    for (const e of events) {
      if (e.prevHash !== prev) return e.seq;
      const payload = JSON.stringify({
        seq: e.seq, at: e.at, actor: e.actor, action: e.action, detail: e.detail, prevHash: e.prevHash,
      });
      const hash = createHash("sha256").update(payload).digest("hex");
      if (hash !== e.hash) return e.seq;
      prev = hash;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

export function buildGovernanceReport(input: {
  restriction: RestrictionVerdict;
  redactions: RedactionRecord[];
  candidates: Candidate[];
  humanReviewRequired: Array<{ documentId: string; pageNo: number; reason: string }>;
  audit: AuditChain;
}): GovernanceReport {
  return {
    restricted: input.restriction.restricted,
    restrictedReasons: input.restriction.reasons,
    redactions: input.redactions,
    aiInvolved: input.candidates.some((c) => c.aiInvolved),
    humanReviewRequired: input.humanReviewRequired,
    auditEvents: input.audit.all(),
  };
}
