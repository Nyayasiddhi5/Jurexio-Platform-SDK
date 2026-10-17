/**
 * Retrieval-first answer planner.
 *
 * Given a query, decide deterministically which local retrieval tools can
 * satisfy it — citation lookup, statute lookup, IPC→BNS comparison, or
 * caselaw search — and only flag the LLM as required when generation
 * (drafting/reasoning) is genuinely needed. Every decision is returned so
 * callers can log it.
 */
import { extractCitations, type ExtractedCitation } from "./citations";
import {
  hybridSearchStatutes,
  getStatuteBySection,
  compareIpcToBns,
  compareOldToNew,
  compareNewToOld,
  type StatuteOut,
  type IpcBnsComparison,
  type OldNewComparison,
  type NewOldComparison,
} from "./statutes";
import { searchIndianCaselaw, searchUsCaselaw, type CaselawDocOut, UpstreamError } from "./caselaw";
import { rdsBackendEnabled, searchRdsJudgmentsHybrid } from "./rdsCaselaw";
import { logger } from "./logger";

export type LinkedCitation = ExtractedCitation & { matches: CaselawDocOut[] };

export type RetrievalStep =
  | { tool: "citation-lookup"; citations: LinkedCitation[]; matches: CaselawDocOut[] }
  | { tool: "statute-lookup"; statutes: StatuteOut[] }
  | { tool: "ipc-bns-compare"; comparison: IpcBnsComparison }
  | { tool: "old-new-compare"; oldNew: OldNewComparison }
  | { tool: "new-old-compare"; newOld: NewOldComparison }
  | { tool: "case-search"; jurisdiction: string; results: CaselawDocOut[] }
  | {
      tool: "archive-fulltext-hint";
      jurisdiction: string;
      guidance: string;
      samplePdfLinks: string[];
    };

export type RetrievalPlan = {
  query: string;
  intent:
    | "citation"
    | "statute"
    | "ipc-bns-compare"
    | "old-new-compare"
    | "new-old-compare"
    | "case-search"
    | "generate";
  steps: RetrievalStep[];
  llmRequired: boolean;
  reason: string;
};

/** Statute-flavoured queries: code mentions, "statute"/"section", or named Acts. */
const STATUTE_FLAVOUR =
  /\b(IPC|BNS|BNSS|BSA|CrPC|IEA|COI|U\.?S\.?C\.?|statute|statutory|section|article|schedule|provision)\b|\b[A-Z][A-Za-z ()]+(?:Act|Code|Sanhita|Adhiniyam)(?:,?\s*\d{4})?\b/i;

const GENERATIVE_HINTS =
  /\b(draft|write|prepare|redline|revise|summari[sz]e|memo(randum)?|opinion|analy[sz]e|review|advise|explain why|argue)\b/i;

const SECTION_REF =
  /\bsection\s+(\d+[A-Z]?(?:\(\d+\))?)\s*(?:of\s+(?:the\s+)?)?(IPC|BNS|BNSS|BSA|Indian Penal Code|Bharatiya Nyaya Sanhita)\b|\b(IPC|BNS|BNSS|BSA)\s+(?:section\s+)?(\d+[A-Z]?(?:\(\d+\))?)\b/i;

const OLD_SECTION_REF =
  /\bsection\s+(\d+[A-Z]?(?:\(\d+\))?)\s*(?:of\s+(?:the\s+)?)?(Cr\.?\s?P\.?\s?C\.?|Code of Criminal Procedure|I\.?E\.?A\.?|(?:Indian\s+)?Evidence Act)\b|\b(Cr\.?\s?P\.?\s?C\.?|Code of Criminal Procedure|I\.?E\.?A\.?|(?:Indian\s+)?Evidence Act)\s+(?:section\s+)?(\d+[A-Z]?(?:\(\d+\))?)\b/i;

function normalizeOldCode(raw: string): "CrPC" | "IEA" {
  const u = raw.toUpperCase();
  if (u.includes("EVIDENCE") || u.replace(/[^A-Z]/g, "") === "IEA") return "IEA";
  return "CrPC";
}

function normalizeCode(raw: string): string {
  const u = raw.toUpperCase();
  if (u.includes("PENAL")) return "IPC";
  if (u.includes("NYAYA")) return "BNS";
  return u;
}

const REVERSE_CUE =
  /\b(crpc|cr\.\s?p\.\s?c\.?|code of criminal procedure|iea|i\.e\.a\.?|evidence act|ipc|i\.p\.c\.?|penal code|old|earlier|previous(?:ly)?|original(?:ly)?|formerly|replace[ds]?|was which|which\s+(?:old\s+)?section\s+was)\b/i;

/** Max distinct section references a single chat message can yield. */
const MAX_COMPARE_INTENTS = 5;

/**
 * Deterministically detect a reverse (new-code → old-code) comparison intent:
 * BNS/BNSS/BSA section references plus a cue about the old code / replacement.
 * Returns every distinct new-code section referenced (deduped, capped at
 * MAX_COMPARE_INTENTS), else an empty array. No LLM, no I/O.
 */
export function detectNewOldCompareIntents(
  query: string,
): Array<{ code: "BNS" | "BNSS" | "BSA"; section: string }> {
  if (!REVERSE_CUE.test(query)) return [];
  const out: Array<{ code: "BNS" | "BNSS" | "BSA"; section: string }> = [];
  const seen = new Set<string>();
  for (const m of query.matchAll(new RegExp(SECTION_REF.source, "gi"))) {
    const code = normalizeCode(m[2] ?? m[3] ?? "");
    if (code !== "BNS" && code !== "BNSS" && code !== "BSA") continue;
    const section = (m[1] ?? m[4] ?? "").toUpperCase();
    const key = `${code}:${section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, section });
    if (out.length >= MAX_COMPARE_INTENTS) break;
  }
  return out;
}

/** First reverse (new→old) comparison intent in the query, or null. */
export function detectNewOldCompareIntent(
  query: string,
): { code: "BNS" | "BNSS" | "BSA"; section: string } | null {
  return detectNewOldCompareIntents(query)[0] ?? null;
}

const FORWARD_CUE =
  /\b(bns|bnss|bsa|bharatiya nyaya|bharatiya nagarik suraksha|bharatiya sakshya|new|equivalent|corresponding|replace[ds]?|now|under|became|becomes|what is)\b/i;

/**
 * Deterministically detect a forward (old-code → new-code) comparison intent:
 * IPC/CrPC/IEA section references plus a cue about the new code / replacement
 * (e.g. "What replaced IPC 302 and IPC 420?", "CrPC 438 under BNSS?").
 * Returns every distinct old-code section referenced (deduped, capped at
 * MAX_COMPARE_INTENTS), else an empty array. No LLM, no I/O.
 */
export function detectOldNewCompareIntents(
  query: string,
): Array<{ code: "IPC" | "CrPC" | "IEA"; section: string }> {
  if (!FORWARD_CUE.test(query)) return [];
  // When reverse (new→old) intents are also present, don't yield entirely —
  // skip only the character spans of section references the reverse detector
  // already claimed (BNS/BNSS/BSA refs), so mixed questions like
  // "BNSS 482 was which CrPC section, and what replaced IPC 302?" still
  // surface the forward IPC 302 intent.
  const reverseSpans: Array<[number, number]> = [];
  if (REVERSE_CUE.test(query)) {
    for (const m of query.matchAll(new RegExp(SECTION_REF.source, "gi"))) {
      const code = normalizeCode(m[2] ?? m[3] ?? "");
      if (code !== "BNS" && code !== "BNSS" && code !== "BSA") continue;
      reverseSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    }
  }
  const claimed = (start: number, end: number) =>
    reverseSpans.some(([s, e]) => start < e && end > s);
  const out: Array<{ code: "IPC" | "CrPC" | "IEA"; section: string }> = [];
  const seen = new Set<string>();
  const push = (code: "IPC" | "CrPC" | "IEA", section: string) => {
    const key = `${code}:${section}`;
    if (seen.has(key) || out.length >= MAX_COMPARE_INTENTS) return;
    seen.add(key);
    out.push({ code, section });
  };
  for (const m of query.matchAll(new RegExp(OLD_SECTION_REF.source, "gi"))) {
    if (claimed(m.index ?? 0, (m.index ?? 0) + m[0].length)) continue;
    push(normalizeOldCode(m[2] ?? m[3] ?? ""), (m[1] ?? m[4] ?? "").toUpperCase());
  }
  for (const m of query.matchAll(new RegExp(SECTION_REF.source, "gi"))) {
    if (claimed(m.index ?? 0, (m.index ?? 0) + m[0].length)) continue;
    const code = normalizeCode(m[2] ?? m[3] ?? "");
    if (code !== "IPC") continue;
    push("IPC", (m[1] ?? m[4] ?? "").toUpperCase());
  }
  return out;
}

/** First forward (old→new) comparison intent in the query, or null. */
export function detectOldNewCompareIntent(
  query: string,
): { code: "IPC" | "CrPC" | "IEA"; section: string } | null {
  return detectOldNewCompareIntents(query)[0] ?? null;
}

async function searchCases(
  q: string,
  jurisdiction: "IN" | "US",
  limit: number,
): Promise<CaselawDocOut[]> {
  if (jurisdiction === "IN") {
    const res = rdsBackendEnabled()
      ? await searchRdsJudgmentsHybrid({ q, limit, mode: "hybrid" })
      : await searchIndianCaselaw({ q, limit });
    return res.results;
  }
  try {
    return (await searchUsCaselaw({ q, limit })).results;
  } catch (err) {
    if (err instanceof UpstreamError) {
      logger.warn({ err: String(err) }, "retrieval router: US source unavailable");
      return [];
    }
    throw err;
  }
}

export async function planAndRetrieve(opts: {
  query: string;
  jurisdiction?: "IN" | "US";
  limit?: number;
}): Promise<RetrievalPlan> {
  const query = opts.query.trim();
  const jurisdiction = opts.jurisdiction ?? "IN";
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20);
  const steps: RetrievalStep[] = [];
  const generative = GENERATIVE_HINTS.test(query);

  // 1) Citations present? Deterministic lookup, no LLM.
  const citations = extractCitations(query);
  if (citations.length > 0) {
    const linked: LinkedCitation[] = [];
    const matches: CaselawDocOut[] = [];
    for (const c of citations.slice(0, 5)) {
      const found = await searchCases(c.normalized, c.jurisdiction, 3);
      linked.push({ ...c, matches: found });
      matches.push(...found);
    }
    steps.push({ tool: "citation-lookup", citations: linked, matches });
    if (!generative) {
      return {
        query,
        intent: "citation",
        steps,
        llmRequired: false,
        reason: "Query contains recognizable citations; resolved against corpus without an LLM.",
      };
    }
  }

  // 2a) Old-code → new-code comparison intent (CrPC→BNSS, IEA→BSA).
  const oldSecMatch = query.match(OLD_SECTION_REF);
  if (oldSecMatch) {
    const oldCode = normalizeOldCode(oldSecMatch[2] ?? oldSecMatch[3] ?? "");
    const oldSection = (oldSecMatch[1] ?? oldSecMatch[4] ?? "").toUpperCase();
    const mentionsNewCode =
      /\b(bnss|bharatiya nagarik suraksha|bsa|bharatiya sakshya)\b/i.test(query);
    if (
      mentionsNewCode ||
      /\b(new|equivalent|corresponding|replaced|now|under)\b/i.test(query)
    ) {
      const oldNew = await compareOldToNew(oldCode, oldSection);
      steps.push({ tool: "old-new-compare", oldNew });
      logger.info(
        { query, oldCode, oldSection, found: oldNew.found, tool: "old-new-compare" },
        "retrieval router: old-code comparison intent",
      );
      if (oldNew.found && !generative) {
        return {
          query,
          intent: "old-new-compare",
          steps,
          llmRequired: false,
          reason: `${oldCode} ${oldSection} mapped to ${oldNew.newCode} via the seeded official mapping; no LLM needed.`,
        };
      }
    }
  }

  // 2) IPC→BNS comparison intent.
  const wantsCompare = /\b(bns|bharatiya nyaya)\b/i.test(query) && /\bipc|penal code\b/i.test(query);
  const secMatch = query.match(SECTION_REF);
  if (secMatch) {
    const code = normalizeCode(secMatch[2] ?? secMatch[3] ?? "");
    const section = (secMatch[1] ?? secMatch[4] ?? "").toUpperCase();
    // 2b) New-code → old-code comparison intent (BNSS→CrPC, BSA→IEA, BNS→IPC).
    if (
      (code === "BNSS" || code === "BSA" || code === "BNS") &&
      REVERSE_CUE.test(query)
    ) {
      const newOld = await compareNewToOld(code, section);
      steps.push({ tool: "new-old-compare", newOld });
      logger.info(
        { query, newCode: code, newSection: section, found: newOld.found, tool: "new-old-compare" },
        "retrieval router: new-code reverse comparison intent",
      );
      if (newOld.found && !generative) {
        return {
          query,
          intent: "new-old-compare",
          steps,
          llmRequired: false,
          reason: `${code} ${section} mapped back to ${newOld.oldCode} ${newOld.oldSections.join(", ")} via the seeded official mapping; no LLM needed.`,
        };
      }
    }
    if (code === "IPC" && (wantsCompare || /\b(new|equivalent|corresponding|replaced|now)\b/i.test(query))) {
      const comparison = await compareIpcToBns(section);
      steps.push({ tool: "ipc-bns-compare", comparison });
      if (comparison.found && !generative) {
        return {
          query,
          intent: "ipc-bns-compare",
          steps,
          llmRequired: false,
          reason: `IPC ${section} mapped to BNS via the seeded official mapping; no LLM needed.`,
        };
      }
    }
    const statute = await getStatuteBySection(code, section);
    if (statute) {
      steps.push({ tool: "statute-lookup", statutes: [statute] });
      if (!generative) {
        return {
          query,
          intent: "statute",
          steps,
          llmRequired: false,
          reason: `Resolved ${code} ${section} from the local statutes corpus without an LLM.`,
        };
      }
    }
  }

  // 3) Statute-flavoured queries (mention a code/act but no exact section):
  //    hybrid FTS + vector KNN with Reciprocal Rank Fusion over the corpus.
  if (!steps.some((s) => s.tool === "statute-lookup") && STATUTE_FLAVOUR.test(query)) {
    const res = await hybridSearchStatutes({ q: query, limit });
    if (res.results.length > 0) {
      steps.push({ tool: "statute-lookup", statutes: res.results });
      logger.info(
        { query, method: res.method, count: res.results.length, tool: "statute-hybrid" },
        "retrieval router: hybrid statute retrieval",
      );
      if (!generative) {
        return {
          query,
          intent: "statute",
          steps,
          llmRequired: false,
          reason: `Hybrid statute retrieval (${res.method === "hybrid" ? "FTS + vector, RRF-fused" : "FTS-only; vector leg unavailable"}) satisfied the query from the local corpus without an LLM.`,
        };
      }
    }
  }

  // 4) Caselaw search — always useful as grounding.
  const cases = await searchCases(query, jurisdiction, limit);
  if (cases.length > 0) {
    steps.push({ tool: "case-search", jurisdiction, results: cases });
  }

  // 4b) India full-text path: point generative/precedent flows at Athena archive.
  // Full judgment body is not in RDS metadata — use /athena/search + /athena/extract.
  if (
    jurisdiction === "IN" &&
    (generative ||
      /\b(judgment|judgement|ratio|held|precedent|order|full\s*text|pdf)\b/i.test(
        query,
      ))
  ) {
    steps.push({
      tool: "archive-fulltext-hint",
      jurisdiction: "IN",
      guidance:
        "RDS caselaw is metadata/headnotes. For full judgment text use Athena archive search + extract (owned S3 PDFs). Do not invent passages.",
      samplePdfLinks: cases
        .slice(0, 3)
        .map((c) => c.pdfLink)
        .filter((x): x is string => Boolean(x)),
    });
  }

  if (!generative && (cases.length > 0 || steps.length > 0)) {
    return {
      query,
      intent: "case-search",
      steps,
      llmRequired: false,
      reason: "Corpus search returned relevant authorities; no generation requested.",
    };
  }

  return {
    query,
    intent: "generate",
    steps,
    llmRequired: true,
    reason:
      steps.length > 0
        ? "Generation requested; retrieved local authorities/statutes will ground the LLM."
        : "No local source satisfied the query; escalating to the LLM.",
  };
}
