/**
 * Case evidence attachment bind — tags + visible OCR text; no court autofill fiction.
 */
import type { ExtractionResult } from "../types.js";
import {
  evidenceDepictionRecommended,
  isEvidenceDocType,
  isEvidenceMediaMime,
} from "../doctype/evidence-registry.js";
import { buildExtractiveLegalIntelligence } from "../intelligence/legal-extractive-intel.js";

export interface NspEvidencePayload {
  docTypes: string[];
  primaryDocType?: string;
  tags: string[];
  visibleText: string;
  extractiveSummary: string[];
  unparsedPageNos: number[];
  needsDepiction: boolean;
  /** Set after NYV /nsp/evidence-depict when requested. */
  depiction?: {
    text: string;
    limitations: string;
    suggestedTags?: string[];
    piiFlags?: string[];
    cached?: boolean;
    model?: string;
  };
}

function pageText(result: ExtractionResult): { unparsed: number[]; allText: string; meanChars: number } {
  const unparsed: number[] = [];
  const chunks: string[] = [];
  let pages = 0;
  for (const doc of result.documents) {
    for (const p of doc.pages) {
      pages++;
      const text = p.lines.map((l) => l.text).join("\n").trim();
      if (!text) unparsed.push(p.pageNo);
      else chunks.push(text);
    }
  }
  const allText = chunks.join("\n\n").slice(0, 12_000);
  const meanChars = pages > 0 ? allText.length / pages : 0;
  return { unparsed: [...new Set(unparsed)].sort((a, b) => a - b), allText, meanChars };
}

export function mapExtractionToNspEvidence(
  result: ExtractionResult,
  opts?: { mime?: string },
): NspEvidencePayload | null {
  const docTypeCodes = [...new Set(result.documents.map((d) => d.classification.code))];
  const mediaMime = isEvidenceMediaMime(opts?.mime);
  if (!docTypeCodes.some(isEvidenceDocType) && !mediaMime) return null;

  const { unparsed, allText, meanChars } = pageText(result);
  const intel = buildExtractiveLegalIntelligence(result);
  const extractiveSummary = intel?.summarySentences?.slice(0, 6).map((s) => s.text) ?? [];

  const tags = [...docTypeCodes];
  if (mediaMime) tags.push("IMAGE_UPLOAD");

  return {
    docTypes: docTypeCodes,
    primaryDocType: docTypeCodes.find(isEvidenceDocType) ?? (mediaMime ? "EVIDENCE_PHOTO" : undefined),
    tags: [...new Set(tags)],
    visibleText: allText,
    extractiveSummary,
    unparsedPageNos: unparsed,
    needsDepiction: evidenceDepictionRecommended(docTypeCodes, {
      mime: opts?.mime,
      unparsedPageNos: unparsed,
      meanTextCharsPerPage: meanChars,
    }),
  };
}
