import { anthropic, streamText } from "@workspace/integrations-anthropic-ai";
import type {
  Authority,
  Criterion,
  Evaluation,
  EvaluationResult,
} from "@workspace/db";
import { localeSystemHint } from "./localeHint";

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6";

const WORK_TYPE_GUIDANCE: Record<string, string> = {
  draft:
    "Produce a complete, professionally formatted legal work product (e.g. an agreement, memorandum, letter, notice, or policy). Use clear headings, defined terms, and numbered sections where appropriate. Write as a practicing New York attorney would.",
  analyze:
    "Produce a thorough written analysis or due-diligence report. Identify the key issues, risks, obligations, and recommendations. Organize with headings and, where useful, tables or issue-by-issue breakdowns.",
  review:
    "Produce a detailed review with markup-style commentary. Flag problematic provisions, missing protections, and deviations from market standard, and propose specific revisions with your reasoning.",
  research:
    "Produce a well-structured research memorandum. State the question presented, the short answer, the governing authorities, the analysis, and a conclusion. Cite the types of authority a NY attorney would rely on.",
};

export interface GroundingStatute {
  code: string;
  section: string;
  heading: string;
  text: string;
  changeNotes?: string | null;
}

export interface ReferenceDocument {
  title: string;
  /** Provenance — the s3://bucket/key of the source PDF in the archive. */
  sourceRef: string;
  /** Extracted (possibly excerpted) text of the document. */
  text: string;
}

export interface PerformArgs {
  title: string;
  categoryName: string;
  workType: string;
  instruction: string;
  context?: string | null;
  documents?: string[];
  authorities?: Authority[];
  statutes?: GroundingStatute[];
  /** Full-text reference documents retrieved from the judgment archive. */
  referenceDocuments?: ReferenceDocument[];
  /** When provided, tokens are streamed to this callback as they arrive. */
  onDelta?: (text: string) => void;
  /** When aborted, the upstream LLM stream is stopped; partial text is returned. */
  signal?: AbortSignal;
  /** Optional BCP-47 locale hint — passed through to prompts (no translation engine). */
  locale?: string;
}

function extractText(message: {
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

export async function performLegalWork(args: PerformArgs): Promise<string> {
  const guidance =
    WORK_TYPE_GUIDANCE[args.workType] ?? WORK_TYPE_GUIDANCE.analyze;

  const system = `You are NYS Agentic AI, an expert legal agent operating at the standard of a senior associate at a top New York law firm. You perform substantive legal work in the ${args.categoryName} practice area under New York and applicable U.S. federal law.

Standards:
- Be precise, well-reasoned, and practical. Match the rigor a supervising partner would expect.
- Where facts are not supplied, make reasonable, clearly-labeled assumptions rather than refusing.
- Never invent specific case citations or statute section numbers you are not confident are real; refer to authorities by name and describe the governing principle instead of fabricating pinpoint citations.
- Output well-structured Markdown (headings, lists, tables, defined terms). Do not include any preamble like "Here is" — begin directly with the work product.
- This is a drafting/analysis aid for a licensed attorney, not legal advice to an end client.${localeSystemHint(args.locale)}`;

  const docNote =
    args.documents && args.documents.length > 0
      ? `\n\nReferenced data-room documents (contents not attached — reason about them by type and describe what you would verify in each):\n${args.documents
          .map((d) => `- ${d}`)
          .join("\n")}`
      : "";

  const contextNote = args.context
    ? `\n\nBackground / facts provided by the attorney:\n${args.context}`
    : "";

  const authorityNote =
    args.authorities && args.authorities.length > 0
      ? `\n\nReal authorities retrieved from live legal databases for this matter (these are verified real cases — you may rely on and cite them where relevant; still do not fabricate any other pinpoint citations):\n${args.authorities
          .map(
            (a) =>
              `- ${a.title}${a.citation ? ` (${a.citation})` : ""}${a.court ? ` — ${a.court}` : ""}${a.date ? `, ${a.date}` : ""}`,
          )
          .join("\n")}`
      : "";

  const statuteNote =
    args.statutes && args.statutes.length > 0
      ? `\n\nStatutory provisions retrieved from the verified local statutes corpus (real text — you may quote and cite these sections exactly):\n${args.statutes
          .map(
            (s) =>
              `- ${s.code} Section ${s.section} — ${s.heading}: ${s.text.slice(0, 600)}${s.changeNotes ? ` [Change note: ${s.changeNotes}]` : ""}`,
          )
          .join("\n")}`
      : "";

  const referenceNote =
    args.referenceDocuments && args.referenceDocuments.length > 0
      ? `\n\nFull-text source judgments retrieved from the verified judgment archive (these are real court documents — you may rely on, quote, and cite them by name; do not fabricate anything beyond what they contain):\n${args.referenceDocuments
          .map(
            (d) =>
              `--- SOURCE DOCUMENT: ${d.title} ---\n${d.text}\n--- END SOURCE DOCUMENT ---`,
          )
          .join("\n\n")}`
      : "";

  const user = `Practice area: ${args.categoryName}
Work type: ${args.workType}
Matter: ${args.title}

Instruction:
${args.instruction}${contextNote}${docNote}${authorityNote}${statuteNote}${referenceNote}

${guidance}`;

  // NV-LLM-001 cutover: when NYV_MODEL_CALL_URL is set, prefer Nyayavigya router.
  const { callNyvModel, nyvModelCallConfigured } = await import("./nyvModelAdapter");
  if (nyvModelCallConfigured() && !args.onDelta) {
    const nyv = await callNyvModel({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 8192,
      taskType: "legal-work-draft",
    });
    if (nyv?.content?.trim()) return nyv.content.trim();
  }

  let text: string;
  if (args.onDelta) {
    const parts: string[] = [];
    try {
      for await (const delta of streamText({
        model: MODEL,
        max_tokens: 8192,
        system,
        messages: [{ role: "user", content: user }],
        signal: args.signal,
      })) {
        parts.push(delta);
        args.onDelta(delta);
      }
    } catch (err) {
      if (args.signal?.aborted) return parts.join("").trim();
      throw err;
    }
    if (args.signal?.aborted) return parts.join("").trim();
    text = parts.join("").trim();
  } else {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    });
    text = extractText(message);
  }
  if (!text) {
    throw new Error("The agent returned an empty work product.");
  }
  return text;
}

export interface EvaluateArgs {
  runId: number;
  output: string;
  criteria: Criterion[];
}

export async function evaluateWork(args: EvaluateArgs): Promise<Evaluation> {
  const rubric = args.criteria
    .map(
      (c, i) =>
        `${i + 1}. [${c.id}] ${c.title}\nCriterion: ${c.matchCriteria}`,
    )
    .join("\n\n");

  const system = `You are a strict but fair legal grading judge. You evaluate a legal work product against a professional rubric. For each criterion, decide whether the work product satisfies it (PASS) or not (FAIL), and give a one to two sentence rationale. Be rigorous: a criterion only passes if the work product genuinely addresses what it requires.

Respond with ONLY valid JSON, no markdown fences, in exactly this shape:
{"results":[{"criterionId":"C-001","passed":true,"rationale":"..."}]}`;

  const user = `WORK PRODUCT:
${args.output}

RUBRIC (evaluate each criterion by its id):
${rubric}

Return the JSON object now.`;

  let raw: string;
  const { callNyvModel, nyvModelCallConfigured } = await import("./nyvModelAdapter");
  if (nyvModelCallConfigured()) {
    const nyv = await callNyvModel({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 8192,
      taskType: "legal-work-evaluate",
    });
    raw = nyv?.content?.trim() ?? "";
  } else {
    raw = "";
  }
  if (!raw) {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: user }],
    });
    raw = extractText(message);
  }

  const jsonStr = raw
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();

  let parsed: { results?: Array<{ criterionId: string; passed: boolean; rationale: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    const start = jsonStr.indexOf("{");
    const end = jsonStr.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("Could not parse evaluation response.");
    }
    parsed = JSON.parse(jsonStr.slice(start, end + 1));
  }

  const byId = new Map(
    (parsed.results ?? []).map((r) => [r.criterionId, r]),
  );

  const results: EvaluationResult[] = args.criteria.map((c) => {
    const r = byId.get(c.id);
    return {
      criterionId: c.id,
      title: c.title,
      passed: r?.passed ?? false,
      rationale: r?.rationale ?? "Not addressed in the work product.",
    };
  });

  const passCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const score = totalCount > 0 ? Math.round((passCount / totalCount) * 100) : 0;

  return { runId: args.runId, score, passCount, totalCount, results };
}
