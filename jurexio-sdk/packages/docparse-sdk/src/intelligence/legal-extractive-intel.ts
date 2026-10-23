/**
 * Legal intelligence from extractive analysis — default path (no LLM prose).
 */
import type { DocumentAnalysis, ExtractionResult } from "../types.js";

export interface ExtractiveLegalIntelligence {
  obligations: Array<{ text: string; pageNo: number; kind?: string }>;
  reliefs: Array<{ text: string; pageNo: number }>;
  deadlines: Array<{ text: string; pageNo: number; kind: string }>;
  risks: Array<{ text: string; pageNo: number; severity: "high" | "medium" | "low" }>;
  parties: Array<{ name: string; role: string; pageNo: number }>;
  citations: Array<{ raw: string; pageNo: number }>;
  summarySentences: Array<{ text: string; pageNo: number; score: number }>;
}

function riskSeverity(text: string): "high" | "medium" | "low" {
  const t = text.toLowerCase();
  if (/penalty|prosecut|contempt|arrest|warrant|forfeit|damages/i.test(t)) return "high";
  if (/shall|must|within \d+ days|interest|pay/i.test(t)) return "medium";
  return "low";
}

export function buildExtractiveLegalIntelligence(
  result: ExtractionResult,
): ExtractiveLegalIntelligence {
  const analyses: DocumentAnalysis[] = result.analysis ?? [];
  const obligations: ExtractiveLegalIntelligence["obligations"] = [];
  const reliefs: ExtractiveLegalIntelligence["reliefs"] = [];
  const deadlines: ExtractiveLegalIntelligence["deadlines"] = [];
  const risks: ExtractiveLegalIntelligence["risks"] = [];
  const parties: ExtractiveLegalIntelligence["parties"] = [];
  const citations: ExtractiveLegalIntelligence["citations"] = [];
  const summarySentences: ExtractiveLegalIntelligence["summarySentences"] = [];

  for (const a of analyses) {
    for (const o of a.obligations ?? []) {
      obligations.push({ text: o.text, pageNo: o.pageNo, kind: o.kind });
      if (o.dueDate || o.relativeDue) {
        deadlines.push({
          text: o.text.slice(0, 200),
          pageNo: o.pageNo,
          kind: o.relativeDue ? "relative" : "absolute",
        });
      }
      risks.push({ text: o.text.slice(0, 200), pageNo: o.pageNo, severity: riskSeverity(o.text) });
    }
    for (const r of a.reliefsSought ?? []) {
      reliefs.push({ text: r.text, pageNo: r.pageNo });
    }
    for (const c of a.citations ?? []) {
      citations.push({ raw: c.raw, pageNo: c.pageNo });
    }
    for (const s of a.summarySentences ?? []) {
      summarySentences.push({ text: s.text, pageNo: s.pageNo, score: s.score });
    }
  }

  for (const r of result.resolutions) {
    const name = r.chosen?.valueNormalized ?? r.chosen?.valueRaw;
    if (!name) continue;
    if (/party|petitioner|respondent|complainant|accused/i.test(r.fieldPath)) {
      parties.push({
        name: String(name).slice(0, 200),
        role: r.fieldPath.split(".").pop() ?? "party",
        pageNo: r.chosen?.pageNo ?? 1,
      });
    }
  }

  return {
    obligations,
    reliefs,
    deadlines,
    risks,
    parties,
    citations,
    summarySentences: summarySentences.slice(0, 12),
  };
}
