/**
 * Extract minimal text windows for partial LLM recovery — never send full documents.
 */
import type { ExtractionResult } from "../types.js";

const DEFAULT_WINDOW = 480;

export function extractSnippetsForFieldPaths(
  result: ExtractionResult,
  fieldPaths: string[],
  maxCharsPerField = DEFAULT_WINDOW,
  pageFilter?: Set<number>,
): Record<string, string> {
  const fullText = result.documents
    .flatMap((d) => d.pages)
    .filter((p) => !pageFilter || pageFilter.has(p.pageNo))
    .flatMap((p) => p.lines.map((l) => l.text))
    .join("\n");
  if (!fullText.trim()) return {};

  const cues: Record<string, RegExp[]> = {
    cnr: [/\bCNR\b/i, /\b\d{16}\b/],
    court: [/IN THE (HIGH|SUPREME|DISTRICT|SESSIONS)/i, /\bCOURT\b/i],
    case_type: [/Petition|Appeal|Suit|Application/i],
    filing_number: [/No\.\s*\d+\s+of\s+(19|20)\d{2}/i],
    fir_number: [/\bFIR\b/i, /\bF\.?I\.?R\.?\b/i],
    police_station: [/Police Station/i, /\bP\.?S\.?\b/i],
    statutes_invoked: [/Section\s+\d+/i, /\bIPC\b|\bBNS\b|\bCr\.?P\.?C/i],
    petitioner: [/Petitioner/i, /\.\.\.\s*Petitioner/i],
    respondent: [/Respondent/i, /\.\.\.\s*Respondent/i],
    advocate: [/Advocate/i, /\bAdv\./i],
    document_type: [/Writ Petition|Criminal|Civil|Affidavit/i],
    cin: [/\bCIN\b/i, /Corporate Identity Number/i],
    gstin: [/\bGSTIN\b/i],
    name: [/Name of (?:company|firm)/i, /M\/s\.?/i],
    number: [/Registration\s*(?:No|Number)/i, /Certificate\s*No/i],
    address: [/Registered\s*(?:office\s*)?Address/i, /\bR\/o\b/i],
  };

  const snippets: Record<string, string> = {};
  for (const path of fieldPaths) {
    const key = path.split(".").pop() ?? path;
    const patterns = cues[key] ?? [new RegExp(key.replace(/_/g, "[\\s_]+"), "i")];
    let best = "";
    for (const re of patterns) {
      const m = re.exec(fullText);
      if (!m || m.index === undefined) continue;
      const start = Math.max(0, m.index - Math.floor(maxCharsPerField / 2));
      const slice = fullText.slice(start, start + maxCharsPerField);
      if (slice.length > best.length) best = slice.trim();
    }
    if (!best && fieldPaths.length <= 3) {
      best = fullText.slice(0, maxCharsPerField);
    }
    if (best) snippets[path] = best;
  }
  return snippets;
}
