/**
 * Case evidence media — photos, imaging, screenshots (sparse OCR).
 */
import type { DocTypeProfile } from "../types.js";

const ci = (s: string) => new RegExp(s, "i");

export const EVIDENCE_DOC_TYPES: DocTypeProfile[] = [
  {
    code: "EVIDENCE_PHOTO",
    label: "Case photo / injury / scene image",
    family: "OTHER",
    anchorProfile: "EVIDENCE_MEDIA",
    cues: [
      { re: ci("injur(?:y|ies)|wound|bruise|laceration"), w: 10 },
      { re: ci("accident\\s+scene|crime\\s+scene"), w: 9 },
      { re: ci("photograph|photo\\s+of"), w: 6 },
    ],
    antiCues: [{ re: ci("in\\s+the\\s+(?:high\\s+)?court\\s+of"), w: 8 }],
    expectedFields: ["evidence.caption", "evidence.visibleText"],
  },
  {
    code: "MEDICAL_IMAGING",
    label: "Medical imaging (X-ray / scan plate)",
    family: "OTHER",
    anchorProfile: "EVIDENCE_MEDIA",
    cues: [
      { re: ci("x\\-?ray|radiograph|\\bCT\\b|\\bMRI\\b|ultrasound"), w: 12 },
      { re: ci("hospital|radiology|diagnostic"), w: 7 },
      { re: ci("(?:left|right)\\s+(?:arm|leg|hand|foot|knee|shoulder)"), w: 5 },
    ],
    expectedFields: ["evidence.caption", "evidence.visibleText", "mlc.number"],
  },
  {
    code: "CASE_SCREENSHOT",
    label: "Chat / app screenshot as evidence",
    family: "OTHER",
    anchorProfile: "EVIDENCE_MEDIA",
    cues: [
      { re: ci("whatsapp|telegram|signal|screenshot"), w: 11 },
      { re: ci("\\bAM\\b|\\bPM\\b.{0,20}\\d{1,2}:\\d{2}"), w: 4 },
    ],
    expectedFields: ["evidence.visibleText", "evidence.caption"],
  },
];

export const EVIDENCE_DOC_CODES = EVIDENCE_DOC_TYPES.map((d) => d.code);

/** Medical reports with structured text — still routed via evidence pack for chat attachments. */
export const EVIDENCE_MEDICAL_TEXT_CODES = ["MLC", "POST_MORTEM"] as const;

export function isEvidenceDocType(code: string): boolean {
  return EVIDENCE_DOC_CODES.includes(code) || (EVIDENCE_MEDICAL_TEXT_CODES as readonly string[]).includes(code);
}

const IMAGE_MIME = /^image\//i;

export function isEvidenceMediaMime(mime?: string): boolean {
  if (!mime) return false;
  return IMAGE_MIME.test(mime);
}

/** True when JRX vision depiction is appropriate (image-heavy or classified evidence media). */
export function evidenceDepictionRecommended(
  docTypeCodes: string[],
  opts?: { mime?: string; unparsedPageNos?: number[]; meanTextCharsPerPage?: number },
): boolean {
  if (docTypeCodes.some((c) => EVIDENCE_DOC_CODES.includes(c))) return true;
  if (isEvidenceMediaMime(opts?.mime)) return true;
  const sparse = (opts?.meanTextCharsPerPage ?? 999) < 80;
  const emptyPages = (opts?.unparsedPageNos?.length ?? 0) > 0;
  if (sparse && emptyPages && isEvidenceMediaMime(opts?.mime)) return true;
  return false;
}
