import { z } from "zod";
import { anthropic, streamText } from "@workspace/integrations-anthropic-ai";
import type { Authority, ChatDocument, ChatMessage } from "@workspace/db";
import { retrieveAuthorities } from "./caselaw";
import {
  detectNewOldCompareIntents,
  detectOldNewCompareIntents,
} from "./retrievalRouter";
import {
  compareIpcToBns,
  compareNewToOld,
  compareOldToNew,
  hybridSearchStatutes,
  type StatuteOut,
} from "./statutes";
import { logger } from "./logger";
import { localeSystemHint } from "./localeHint";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";
// Intelligence mode routes to the strongest available model when configured.
const INTELLIGENCE_MODEL =
  process.env.ANTHROPIC_INTELLIGENCE_MODEL ?? MODEL;

export type ChatActionMode =
  | "chat"
  | "summary"
  | "extract"
  | "case_details"
  | "draft"
  | "intelligence"
  | "predictions";

export type OutputFormat = "brief" | "detailed";

const MAX_DOC_CHARS = 16000;
const MAX_TOTAL_DOC_CHARS = 48000;
const MAX_HISTORY_MESSAGES = 12;

// ---------------------------------------------------------------------------
// Deterministic extraction (retrieval-first: regex + local parsing before LLM)
// ---------------------------------------------------------------------------

export interface DeterministicFacts {
  caseTitles: string[];
  sections: string[];
  statutes: string[];
  citations: string[];
  courts: string[];
  dates: string[];
  cnrNumbers: string[];
}

function uniq(items: string[], cap = 40): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.replace(/\s+/g, " ").trim();
    const key = v.toLowerCase();
    if (v.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}

export function extractDeterministicFacts(text: string): DeterministicFacts {
  const caseTitles =
    text.match(
      /[A-Z][A-Za-z.'&()\- ]{2,60}\s+v(?:s?\.?|ersus)\s+[A-Z][A-Za-z.'&()\- ]{2,60}/g,
    ) ?? [];

  const sections =
    text.match(
      /(?:Section|Sec\.?|§)\s*\d+[A-Z]?(?:\(\d+[a-z]?\))*(?:\s+(?:of|read with)\s+(?:the\s+)?[A-Z][A-Za-z, ]+(?:Act|Code|Sanhita|Constitution)(?:,?\s*\d{4})?)?/g,
    ) ?? [];

  const statutes = [
    ...(text.match(/[A-Z][A-Za-z ()]+(?:Act|Code|Sanhita|Rules),?\s*\d{4}/g) ??
      []),
    ...(text.match(/\d+\s+U\.?S\.?C\.?\s*§+\s*[\dA-Za-z()\-.]+/g) ?? []),
    ...(text.match(
      /(?:Indian Penal Code|Bharatiya Nyaya Sanhita|Code of Criminal Procedure|Code of Civil Procedure|Constitution of India|CPLR|N\.Y\.[A-Za-z. ]+Law)/g,
    ) ?? []),
  ];

  const citations = [
    ...(text.match(/\(\d{4}\)\s*\d+\s*SCC\s*\d+/g) ?? []),
    ...(text.match(/AIR\s*\d{4}\s*(?:SC|[A-Z][a-z]+)\s*\d+/g) ?? []),
    ...(text.match(/\d{4}\s*SCC\s*OnLine\s*[A-Za-z]+\s*\d+/g) ?? []),
    ...(text.match(
      /\d+\s+(?:U\.S\.|S\.\s?Ct\.|F\.(?:2d|3d|4th)|F\.\s?Supp\.(?:\s?\dd)?|N\.Y\.(?:2d|3d)?|A\.D\.(?:2d|3d)?|N\.E\.(?:2d|3d)?)\s+\d+/g,
    ) ?? []),
  ];

  const courts =
    text.match(
      /(?:Supreme Court of [A-Z][A-Za-z ]+|High Court of [A-Z][A-Za-z ]+|[A-Z][A-Za-z ]+High Court|U\.S\. (?:District|Bankruptcy) Court[A-Za-z ,.]*|(?:Southern|Eastern|Northern|Western) District of [A-Z][A-Za-z ]+|Court of Appeals[A-Za-z ,.]*|New York (?:Supreme Court|Court of Appeals)|District Court[A-Za-z ,]*|Sessions Court[A-Za-z ,]*|Tribunal[A-Za-z ,]*)/g,
    ) ?? [];

  const dates = [
    ...(text.match(
      /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December),?\s+\d{4}\b/g,
    ) ?? []),
    ...(text.match(
      /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/g,
    ) ?? []),
    ...(text.match(/\b\d{1,2}[./-]\d{1,2}[./-]\d{4}\b/g) ?? []),
  ];

  const cnrNumbers = text.match(/\b[A-Z]{4}\d{12}\b/g) ?? [];

  return {
    caseTitles: uniq(caseTitles, 10),
    sections: uniq(sections),
    statutes: uniq(statutes),
    citations: uniq(citations),
    courts: uniq(courts, 10),
    dates: uniq(dates, 20),
    cnrNumbers: uniq(cnrNumbers, 10),
  };
}

// ---------------------------------------------------------------------------
// Structured output schemas
// ---------------------------------------------------------------------------

const ExtractResultSchema = z.object({
  parties: z.array(
    z.object({
      name: z.string(),
      role: z.string(),
    }),
  ),
  counsel: z.array(z.string()).default([]),
  judges: z.array(z.string()).default([]),
  witnesses: z.array(z.string()).default([]),
  organizations: z.array(z.string()).default([]),
  keyDates: z.array(z.object({ date: z.string(), event: z.string() })).default([]),
  notes: z.string().default(""),
});
export type ExtractResult = z.infer<typeof ExtractResultSchema>;

const CaseDetailsSchema = z.object({
  caseTitle: z.string(),
  caseId: z.string().default(""),
  practiceArea: z.string().default(""),
  jurisdiction: z.string().default(""),
  court: z.string().default(""),
  witnesses: z.array(z.string()).default([]),
  highlights: z.array(z.string()).default([]),
  summary: z.string(),
  importantPoints: z.array(z.string()).default([]),
  references: z.array(z.string()).default([]),
  sections: z.array(z.string()).default([]),
  statutes: z.array(z.string()).default([]),
});
export type CaseDetailsResult = z.infer<typeof CaseDetailsSchema>;

const IntelligenceSchema = z.object({
  pointsToNote: z.array(z.string()),
  references: z.array(z.string()).default([]),
  study: z.string(),
  arguments: z.array(
    z.object({ side: z.string(), argument: z.string() }),
  ).default([]),
  approach: z.string(),
});
export type IntelligenceResult = z.infer<typeof IntelligenceSchema>;

const PredictionsSchema = z.object({
  outcomeLikelihoodPct: z.number().min(0).max(100),
  outcomeLabel: z.string(),
  confidence: z.string().default("moderate"),
  riskFactors: z.array(z.string()),
  suggestions: z.array(z.string()),
});
export type PredictionsResult = z.infer<typeof PredictionsSchema>;

export const PREDICTIONS_DISCLAIMER =
  "This prediction is analytical assistance generated by an AI model from the materials provided. It is not legal advice, and actual outcomes depend on facts, evidence, forum, and counsel.";

// ---------------------------------------------------------------------------
// Prompt assembly
// ---------------------------------------------------------------------------

function buildDocContext(documents: ChatDocument[]): string {
  if (documents.length === 0) return "";
  let budget = MAX_TOTAL_DOC_CHARS;
  const parts: string[] = [];
  for (const doc of documents) {
    if (budget <= 0) break;
    const slice = doc.textContent.slice(0, Math.min(MAX_DOC_CHARS, budget));
    budget -= slice.length;
    parts.push(
      `--- DOCUMENT: ${doc.filename} (${doc.textContent.length > slice.length ? "truncated" : "full text"}) ---\n${slice}`,
    );
  }
  return `\n\nUPLOADED DOCUMENTS:\n${parts.join("\n\n")}`;
}

function buildHistoryContext(history: ChatMessage[]): string {
  const recent = history.slice(-MAX_HISTORY_MESSAGES);
  if (recent.length === 0) return "";
  const lines = recent.map((m) => {
    const label = m.role === "user" ? "ATTORNEY" : "AGENT";
    const body =
      m.content.length > 2000 ? `${m.content.slice(0, 2000)}…` : m.content;
    return `${label}${m.action !== "chat" ? ` [${m.action}]` : ""}: ${body}`;
  });
  return `\n\nCONVERSATION SO FAR:\n${lines.join("\n\n")}`;
}

function buildFactsContext(facts: DeterministicFacts): string {
  const sections: string[] = [];
  if (facts.caseTitles.length) sections.push(`Case titles: ${facts.caseTitles.join("; ")}`);
  if (facts.courts.length) sections.push(`Courts: ${facts.courts.join("; ")}`);
  if (facts.sections.length) sections.push(`Sections: ${facts.sections.join("; ")}`);
  if (facts.statutes.length) sections.push(`Statutes: ${facts.statutes.join("; ")}`);
  if (facts.citations.length) sections.push(`Citations found in documents: ${facts.citations.join("; ")}`);
  if (facts.dates.length) sections.push(`Dates: ${facts.dates.join("; ")}`);
  if (facts.cnrNumbers.length) sections.push(`CNR numbers: ${facts.cnrNumbers.join("; ")}`);
  if (sections.length === 0) return "";
  return `\n\nFACTS EXTRACTED DETERMINISTICALLY FROM THE DOCUMENTS (verified by parsing — treat as ground truth, do not contradict):\n${sections.map((s) => `- ${s}`).join("\n")}`;
}

function buildAuthorityContext(authorities: Authority[]): string {
  if (authorities.length === 0) return "";
  return `\n\nREAL AUTHORITIES RETRIEVED FROM LIVE LEGAL DATABASES (verified real cases — you may cite these; do not fabricate any other pinpoint citations):\n${authorities
    .map(
      (a) =>
        `- ${a.title}${a.citation ? ` (${a.citation})` : ""}${a.court ? ` — ${a.court}` : ""}${a.date ? `, ${a.date}` : ""}`,
    )
    .join("\n")}`;
}

const BASE_SYSTEM = `You are NYS Agentic AI, an expert legal agent working with a licensed attorney inside a legal chat workspace. You analyze uploaded case documents and the attorney's questions.

Standards:
- Be precise, well-reasoned, and practical.
- Never invent specific case citations or statute section numbers you are not confident are real; rely on the verified facts and retrieved authorities provided, and otherwise refer to authorities by name/principle.
- This is a drafting/analysis aid for a licensed attorney, not legal advice to an end client.`;

function formatDirective(format: OutputFormat): string {
  return format === "brief"
    ? "Output format: BRIEF — be concise. Use tight bullet points and short paragraphs; keep the whole answer compact."
    : "Output format: DETAILED — be thorough and complete, with headings and structure where useful.";
}

function extractResponseText(message: {
  content: Array<{ type: string }>;
}): string {
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      parts.push((block as unknown as { text: string }).text);
    }
  }
  return parts.join("\n").trim();
}

async function callModel(opts: {
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}): Promise<string> {
  if (opts.onDelta) {
    const parts: string[] = [];
    try {
      for await (const delta of streamText({
        model: opts.model ?? MODEL,
        max_tokens: opts.maxTokens ?? 8192,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        signal: opts.signal,
      })) {
        parts.push(delta);
        opts.onDelta(delta);
      }
    } catch (err) {
      if (opts.signal?.aborted) return parts.join("").trim();
      throw err;
    }
    if (opts.signal?.aborted) return parts.join("").trim();
    const text = parts.join("").trim();
    if (!text) throw new Error("The agent returned an empty response.");
    return text;
  }
  opts.signal?.throwIfAborted();
  const message = await anthropic.messages.create(
    {
      model: opts.model ?? MODEL,
      max_tokens: opts.maxTokens ?? 8192,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    },
    { signal: opts.signal },
  );
  const text = extractResponseText(message);
  if (!text) throw new Error("The agent returned an empty response.");
  return text;
}

function parseJson<T>(raw: string, schema: { parse: (obj: unknown) => T }): T {
  const cleaned = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("The agent did not return valid structured JSON.");
    }
    obj = JSON.parse(cleaned.slice(start, end + 1));
  }
  return schema.parse(obj);
}

// ---------------------------------------------------------------------------
// Action runner
// ---------------------------------------------------------------------------

export interface RunActionArgs {
  action: ChatActionMode;
  prompt: string;
  format: OutputFormat;
  history: ChatMessage[];
  documents: ChatDocument[];
  jurisdiction?: string;
  /** Optional drafting template body to ground the "draft" action. */
  templateBody?: string;
  /** When provided, free-text actions (chat/summary/draft) stream tokens here. */
  onDelta?: (text: string) => void;
  /**
   * When provided, every action emits progress at real stage boundaries
   * ("retrieving" | "analyzing" | "formatting"). Structured modes rely on
   * this for continuous feedback since they don't stream token deltas.
   */
  onStage?: (stage: ActionStage) => void;
  /** When aborted, the upstream LLM stream is stopped; partial text is returned. */
  signal?: AbortSignal;
  /** Optional BCP-47 locale hint — passed through to prompts (no translation engine). */
  locale?: string;
}

/** Real processing phases emitted to the client during a chat action. */
export type ActionStage = "retrieving" | "analyzing" | "formatting";

export interface ActionOutcome {
  content: string;
  structured: Record<string, unknown> | null;
}

/** Jurisdictions with live retrieval backends; anything else is reserved (coming soon). */
const LIVE_JURISDICTIONS = new Set(["IN", "US"]);

async function retrieveForContext(
  facts: DeterministicFacts,
  prompt: string,
  jurisdiction: string,
): Promise<Authority[]> {
  if (jurisdiction === "ALL") {
    const query =
      facts.caseTitles[0] ??
      facts.statutes[0] ??
      (prompt.length > 4 ? prompt.slice(0, 120) : "");
    if (!query) return [];
    try {
      const [inAuth, usAuth] = await Promise.all([
        retrieveAuthorities({ query, limit: 3, jurisdiction: "IN" }),
        retrieveAuthorities({ query, limit: 3, jurisdiction: "US" }),
      ]);
      return [...inAuth, ...usAuth].slice(0, 5);
    } catch (err) {
      logger.warn({ err: String(err) }, "chat ALL-mode authority retrieval failed; continuing");
      return [];
    }
  }
  if (!LIVE_JURISDICTIONS.has(jurisdiction)) {
    logger.info(
      { jurisdiction },
      "chat authority retrieval skipped: reserved jurisdiction",
    );
    return [];
  }
  const query =
    facts.caseTitles[0] ??
    facts.statutes[0] ??
    (prompt.length > 4 ? prompt.slice(0, 120) : "");
  if (!query) return [];
  try {
    return await retrieveAuthorities({ query, limit: 5, jurisdiction });
  } catch (err) {
    logger.warn({ err: String(err) }, "chat authority retrieval failed; continuing");
    return [];
  }
}

/** Statute-shaped chat prompts that warrant hybrid statute grounding. */
const STATUTE_SHAPED =
  /\b(IPC|BNS|BNSS|BSA|CrPC|IEA|COI|statute|statutory|section|article|provision|offen[cs]e|punishment|penalty)\b|\b[A-Z][A-Za-z ()]+(?:Act|Code|Sanhita|Adhiniyam)(?:,?\s*\d{4})?\b/i;

/**
 * Hybrid statute grounding for chat: FTS + vector KNN with RRF over the
 * statutes corpus for statute-shaped prompts (IN only — the statutes corpus
 * is India-first). Never throws; failure just means no statute context.
 */
export async function retrieveStatutesForChat(
  prompt: string,
  jurisdiction: string,
): Promise<StatuteOut[]> {
  if (jurisdiction !== "IN" || !prompt.trim() || !STATUTE_SHAPED.test(prompt)) {
    return [];
  }
  try {
    const res = await hybridSearchStatutes({
      q: prompt.slice(0, 300),
      jurisdiction: "IN",
      limit: 4,
    });
    logger.info(
      { method: res.method, count: res.results.length },
      "chat statute grounding (hybrid FTS + vector, RRF)",
    );
    return res.results;
  } catch (err) {
    logger.warn(
      { err: String(err) },
      "chat statute grounding failed; continuing without statutes",
    );
    return [];
  }
}

/** Prompt context block for retrieved statutory provisions. */
function buildStatuteContext(statutes: StatuteOut[]): string {
  if (statutes.length === 0) return "";
  return `\n\nVERIFIED STATUTORY PROVISIONS retrieved from the local statutes corpus (real text — quote and cite these by act, section, and heading where relevant; do not fabricate other section numbers):\n${statutes
    .map(
      (s) =>
        `- ${s.actName ?? s.code} — Section ${s.section} (${s.heading}): ${s.text.slice(0, 500)}`,
    )
    .join("\n")}`;
}

/** Render one or more comparator links as a markdown footer block. */
function renderCompareFooter(links: string[]): string | null {
  if (links.length === 0) return null;
  if (links.length === 1) return `\n\n---\n\n**Compare side-by-side:** ${links[0]}`;
  return `\n\n---\n\n**Compare side-by-side:**\n${links.map((l) => `- ${l}`).join("\n")}`;
}

/**
 * When the attorney's message is a reverse (new-code → old-code) comparison
 * question (e.g. "BNSS 482 and BSA 63 were which old sections?"), verify each
 * mapping deterministically and return a markdown footer linking every
 * verified section to the comparator's reverse view. Unverified or failing
 * lookups are silently skipped. Never throws — failure just means no link.
 */
export async function buildReverseCompareLink(prompt: string): Promise<string | null> {
  return renderCompareFooter(await buildReverseCompareLinks(prompt));
}

/** Verified reverse (new→old) compare links for the prompt. Never throws. */
async function buildReverseCompareLinks(prompt: string): Promise<string[]> {
  const intents = detectNewOldCompareIntents(prompt);
  if (intents.length === 0) return [];
  const links: string[] = [];
  for (const intent of intents) {
    try {
      const newOld = await compareNewToOld(intent.code, intent.section);
      if (!newOld.found) continue;
      const oldLabel =
        newOld.oldSections.length > 0
          ? `${newOld.oldCode} § ${newOld.oldSections.join(", § ")}`
          : newOld.oldCode;
      links.push(
        `[${intent.code} § ${intent.section} ↔ ${oldLabel}](/statutes/compare?from=${encodeURIComponent(intent.code)}&section=${encodeURIComponent(intent.section)})`,
      );
    } catch (err) {
      logger.warn(
        { err: String(err), code: intent.code, section: intent.section },
        "chat reverse-compare link lookup failed; continuing without link",
      );
    }
  }
  return links;
}

/**
 * When the attorney's message is a forward (old-code → new-code) comparison
 * question (e.g. "What replaced IPC 302 and IPC 420?", "CrPC 438 under
 * BNSS?"), verify each mapping deterministically and return a markdown footer
 * linking every verified section to the comparator's forward view. Unverified
 * or failing lookups are silently skipped. Never throws.
 */
async function buildForwardCompareLinks(prompt: string): Promise<string[]> {
  const intents = detectOldNewCompareIntents(prompt);
  if (intents.length === 0) return [];
  const links: string[] = [];
  for (const intent of intents) {
    try {
      if (intent.code === "IPC") {
        const cmp = await compareIpcToBns(intent.section);
        if (!cmp.found) continue;
        const bnsSections = cmp.bnsMatches.map((m) => m.section);
        const newLabel =
          bnsSections.length > 0 ? `BNS § ${bnsSections.join(", § ")}` : "BNS";
        links.push(
          `[IPC § ${intent.section} ↔ ${newLabel}](/statutes/compare?section=${encodeURIComponent(intent.section)})`,
        );
        continue;
      }
      const oldNew = await compareOldToNew(intent.code, intent.section);
      if (!oldNew.found) continue;
      const newSections = oldNew.matches.map((m) => m.section);
      const newLabel =
        newSections.length > 0
          ? `${oldNew.newCode} § ${newSections.join(", § ")}`
          : oldNew.newCode;
      links.push(
        `[${intent.code} § ${intent.section} ↔ ${newLabel}](/statutes/compare?from=${encodeURIComponent(intent.code)}&section=${encodeURIComponent(intent.section)})`,
      );
    } catch (err) {
      logger.warn(
        { err: String(err), code: intent.code, section: intent.section },
        "chat forward-compare link lookup failed; continuing without link",
      );
    }
  }
  return links;
}

/** Shared cap on comparator links in a single chat footer. */
const MAX_COMPARE_LINKS = 5;

/**
 * Resolve the deterministic comparator links for the prompt, if any. Reverse
 * (new→old) and forward (old→new) links are merged into one footer — reverse
 * first — under a shared MAX_COMPARE_LINKS cap, so mixed questions get a
 * verified link for every provision. Never throws.
 */
export async function buildCompareLink(prompt: string): Promise<string | null> {
  const links = [
    ...(await buildReverseCompareLinks(prompt)),
    ...(await buildForwardCompareLinks(prompt)),
  ].slice(0, MAX_COMPARE_LINKS);
  return renderCompareFooter(links);
}

export async function runChatAction(args: RunActionArgs): Promise<ActionOutcome> {
  const combinedDocText = args.documents
    .map((d) => d.textContent.slice(0, MAX_DOC_CHARS))
    .join("\n\n");
  const facts = extractDeterministicFacts(
    `${combinedDocText}\n${args.prompt}`,
  );

  const docCtx = buildDocContext(args.documents);
  const histCtx = buildHistoryContext(args.history);
  const factsCtx = buildFactsContext(facts);
  const fmt = formatDirective(args.format);
  // Explicit jurisdiction from the client always wins (reserved values are kept
  // as-is so retrieval is skipped deterministically — never inferred to US/IN).
  // Inference only applies when the client sent no jurisdiction at all.
  const jurisdiction =
    args.jurisdiction ??
    (facts.cnrNumbers.length > 0 || /India|SCC|AIR \d{4}/.test(combinedDocText)
      ? "IN"
      : "US");

  const ask = args.prompt.trim()
    ? `\n\nATTORNEY'S REQUEST:\n${args.prompt.trim()}`
    : "";
  const localeHint = localeSystemHint(args.locale);

  const stage = (s: ActionStage) => args.onStage?.(s);

  switch (args.action) {
    case "chat": {
      stage("retrieving");
      // Deterministic comparison link (reverse new→old or forward old→new)
      // resolved in parallel with the LLM answer; appended when found.
      const linkPromise = buildCompareLink(args.prompt);
      // Hybrid statute grounding (FTS + vector, RRF) for statute-shaped asks.
      const statutes = await retrieveStatutesForChat(args.prompt, jurisdiction);
      stage("analyzing");
      const content = await callModel({
        system: `${BASE_SYSTEM}${localeHint}\n\n${fmt}\nAnswer the attorney's message conversationally but substantively, grounded in the uploaded documents and conversation so far. Output well-structured Markdown. Begin directly with the answer.`,
        user: `${ask || "\n\nATTORNEY'S REQUEST:\nPlease review the materials and tell me what stands out."}${histCtx}${docCtx}${factsCtx}${buildStatuteContext(statutes)}`,
        onDelta: args.onDelta,
        signal: args.signal,
      });
      const compareLink = await linkPromise;
      if (compareLink) {
        args.onDelta?.(compareLink);
        return { content: `${content}${compareLink}`, structured: null };
      }
      return { content, structured: null };
    }

    case "summary": {
      stage("analyzing");
      const content = await callModel({
        system: `${BASE_SYSTEM}${localeHint}\n\n${fmt}\nProduce a professional summary of the matter based on the uploaded documents, the conversation, and the request. Cover: what the matter is, the parties, current posture, key issues, and anything time-sensitive. Output Markdown with headings. Begin directly with the summary.`,
        user: `${ask}${histCtx}${docCtx}${factsCtx}`,
        onDelta: args.onDelta,
        signal: args.signal,
      });
      return { content, structured: null };
    }

    case "extract": {
      stage("analyzing");
      const raw = await callModel({
        system: `${BASE_SYSTEM}${localeHint}\n\nExtract the entities involved in this matter from the documents and conversation. The deterministic facts provided are ground truth. Only include people/entities actually present in the materials; leave arrays empty rather than guessing.\n\nRespond with ONLY valid JSON, no markdown fences, exactly this shape:\n{"parties":[{"name":"...","role":"petitioner|respondent|plaintiff|defendant|appellant|other"}],"counsel":["..."],"judges":["..."],"witnesses":["..."],"organizations":["..."],"keyDates":[{"date":"...","event":"..."}],"notes":"anything ambiguous"}`,
        user: `${ask}${histCtx}${docCtx}${factsCtx}`,
        maxTokens: 4096,
        signal: args.signal,
      });
      stage("formatting");
      const structured = parseJson(raw, ExtractResultSchema);
      const content = renderExtractMarkdown(structured);
      return { content, structured: structured as unknown as Record<string, unknown> };
    }

    case "case_details": {
      stage("retrieving");
      const authorities = await retrieveForContext(facts, args.prompt, jurisdiction);
      stage("analyzing");
      const raw = await callModel({
        system: `${BASE_SYSTEM}${localeHint}\n\nAssemble a structured case-details record from the documents and conversation. The deterministic facts (sections, statutes, citations, courts, dates) are ground truth — copy them into the relevant fields and complete the rest from the documents. For "references", only use citations found in the documents or the retrieved authorities provided. Leave fields empty ("" or []) rather than inventing.\n\nRespond with ONLY valid JSON, no markdown fences, exactly this shape:\n{"caseTitle":"...","caseId":"case no / docket / CNR if present","practiceArea":"...","jurisdiction":"...","court":"...","witnesses":["..."],"highlights":["..."],"summary":"2-4 sentence case summary","importantPoints":["..."],"references":["..."],"sections":["..."],"statutes":["..."]}`,
        user: `${ask}${histCtx}${docCtx}${factsCtx}${buildAuthorityContext(authorities)}`,
        maxTokens: 4096,
        signal: args.signal,
      });
      stage("formatting");
      const structured = parseJson(raw, CaseDetailsSchema);
      const content = renderCaseDetailsMarkdown(structured);
      return { content, structured: structured as unknown as Record<string, unknown> };
    }

    case "draft": {
      stage("retrieving");
      const [authorities, statutes] = await Promise.all([
        retrieveForContext(facts, args.prompt, jurisdiction),
        retrieveStatutesForChat(args.prompt, jurisdiction),
      ]);
      const templateCtx = args.templateBody
        ? `\n\nDRAFTING TEMPLATE (use this as the structural skeleton for the work product — follow its sections and adapt its language to the matter):\n${args.templateBody.slice(0, 12000)}`
        : "";
      stage("analyzing");
      const content = await callModel({
        system: `${BASE_SYSTEM}${localeHint}\n\n${fmt}\nProduce a complete, professionally formatted legal work product (agreement, notice, petition, memorandum, letter, or the document the attorney asked for), grounded in the uploaded documents and the request. Use clear headings, defined terms, and numbered sections where appropriate. Where facts are missing, insert clearly-labeled placeholders like [PARTY ADDRESS]. Output Markdown. Begin directly with the work product.`,
        user: `${ask || "\n\nATTORNEY'S REQUEST:\nDraft the most appropriate next work product for this matter based on the uploaded documents."}${histCtx}${docCtx}${factsCtx}${templateCtx}${buildAuthorityContext(authorities)}${buildStatuteContext(statutes)}`,
        onDelta: args.onDelta,
        signal: args.signal,
      });
      return { content, structured: null };
    }

    case "intelligence": {
      stage("retrieving");
      const authorities = await retrieveForContext(facts, args.prompt, jurisdiction);
      stage("analyzing");
      const raw = await callModel({
        model: INTELLIGENCE_MODEL,
        system: `${BASE_SYSTEM}${localeHint}\n\nProduce a deep litigation-intelligence analysis of this matter: points to note, references (only real citations from documents or the retrieved authorities), a study of the legal landscape, arguments for each side, and a recommended approach.\n\nRespond with ONLY valid JSON, no markdown fences, exactly this shape:\n{"pointsToNote":["..."],"references":["..."],"study":"multi-paragraph analysis of the legal position and landscape","arguments":[{"side":"e.g. Petitioner / Our client / Opposing party","argument":"..."}],"approach":"recommended strategy and next steps"}`,
        user: `${ask}${histCtx}${docCtx}${factsCtx}${buildAuthorityContext(authorities)}`,
        signal: args.signal,
      });
      stage("formatting");
      const structured = parseJson(raw, IntelligenceSchema);
      const content = renderIntelligenceMarkdown(structured);
      return { content, structured: structured as unknown as Record<string, unknown> };
    }

    case "predictions": {
      stage("analyzing");
      const raw = await callModel({
        system: `${BASE_SYSTEM}${localeHint}\n\nAssess the likely outcome of this matter for the attorney's client based strictly on the materials provided. Be honest about uncertainty; do not flatter. This is analytical assistance, not legal advice.\n\nRespond with ONLY valid JSON, no markdown fences, exactly this shape:\n{"outcomeLikelihoodPct":0-100,"outcomeLabel":"short label e.g. 'Favorable settlement likely'","confidence":"low|moderate|high","riskFactors":["..."],"suggestions":["concrete steps to strengthen the case"]}`,
        user: `${ask}${histCtx}${docCtx}${factsCtx}`,
        maxTokens: 4096,
        signal: args.signal,
      });
      stage("formatting");
      const structured = parseJson(raw, PredictionsSchema);
      const withDisclaimer = {
        ...structured,
        disclaimer: PREDICTIONS_DISCLAIMER,
      };
      const content = renderPredictionsMarkdown(structured);
      return { content, structured: withDisclaimer as unknown as Record<string, unknown> };
    }
  }
}

// ---------------------------------------------------------------------------
// Markdown renderers for structured payloads
// ---------------------------------------------------------------------------

function list(items: string[]): string {
  return items.map((i) => `- ${i}`).join("\n") || "_None identified._";
}

function renderExtractMarkdown(r: ExtractResult): string {
  const parts = [
    `## Parties Involved`,
    r.parties.map((p) => `- **${p.name}** — ${p.role}`).join("\n") ||
      "_None identified._",
  ];
  if (r.counsel.length) parts.push(`## Counsel`, list(r.counsel));
  if (r.judges.length) parts.push(`## Judges`, list(r.judges));
  if (r.witnesses.length) parts.push(`## Witnesses`, list(r.witnesses));
  if (r.organizations.length)
    parts.push(`## Organizations`, list(r.organizations));
  if (r.keyDates.length)
    parts.push(
      `## Key Dates`,
      r.keyDates.map((d) => `- **${d.date}** — ${d.event}`).join("\n"),
    );
  if (r.notes) parts.push(`## Notes`, r.notes);
  return parts.join("\n\n");
}

function renderCaseDetailsMarkdown(r: CaseDetailsResult): string {
  const meta = [
    r.caseId && `- **Case ID:** ${r.caseId}`,
    r.practiceArea && `- **Practice area:** ${r.practiceArea}`,
    r.jurisdiction && `- **Jurisdiction:** ${r.jurisdiction}`,
    r.court && `- **Court:** ${r.court}`,
  ]
    .filter(Boolean)
    .join("\n");
  const parts = [`## ${r.caseTitle || "Case Details"}`];
  if (meta) parts.push(meta);
  parts.push(`### Summary`, r.summary);
  if (r.highlights.length) parts.push(`### Highlights`, list(r.highlights));
  if (r.importantPoints.length)
    parts.push(`### Important Points`, list(r.importantPoints));
  if (r.witnesses.length) parts.push(`### Witnesses`, list(r.witnesses));
  if (r.sections.length) parts.push(`### Sections`, list(r.sections));
  if (r.statutes.length) parts.push(`### Statutes`, list(r.statutes));
  if (r.references.length) parts.push(`### References`, list(r.references));
  return parts.join("\n\n");
}

function renderIntelligenceMarkdown(r: IntelligenceResult): string {
  const parts = [
    `## Points to Note`,
    list(r.pointsToNote),
    `## Study`,
    r.study,
  ];
  if (r.arguments.length)
    parts.push(
      `## Arguments`,
      r.arguments.map((a) => `- **${a.side}:** ${a.argument}`).join("\n"),
    );
  parts.push(`## Recommended Approach`, r.approach);
  if (r.references.length) parts.push(`## References`, list(r.references));
  return parts.join("\n\n");
}

function renderPredictionsMarkdown(r: PredictionsResult): string {
  return [
    `## Outcome Prediction`,
    `**${r.outcomeLabel}** — estimated likelihood **${Math.round(r.outcomeLikelihoodPct)}%** (confidence: ${r.confidence})`,
    `### Key Risk Factors`,
    list(r.riskFactors),
    `### Suggestions to Strengthen the Case`,
    list(r.suggestions),
    `> ${PREDICTIONS_DISCLAIMER}`,
  ].join("\n\n");
}
