/**
 * @jurexio/docparse — Jurexio document understanding engine.
 *
 * Indian legal document parsing, field extraction, autofill and analysis.
 * Deterministic, provenance-bearing, local. No LLM in the default path.
 *
 * Quick start:
 *
 *   import { run } from "@jurexio/docparse";
 *
 *   const result = await run(
 *     [{ path: "/data/fir.pdf", fileName: "fir.pdf" }],
 *     { batchId: "batch-1", actor: "advocate:1234" },
 *   );
 *
 *   result.autofill.fields          // pre-fill the form with these
 *   result.autofill.conflicts       // make the user choose on these
 *   result.autofill.lowConfidence   // offer these, do not pre-fill
 *   result.autofill.absent          // show "not found in your documents"
 *   result.governance.auditEvents   // hash-chained, verifiable
 */

export * from "./types.js";

// Pipeline
export { run, type InputFile, type RunOptions } from "./pipeline/run.js";
export { extractTextLayer, assessTextLayer, type TextLayerPage, type TextLayerVerdict } from "./pipeline/textlayer.js";
export { rasterisePdf, estimateSkewDegrees, deskewImage, loadGrey } from "./pipeline/raster.js";

// OCR
export { OcrRouter, type RoutedOcrResult } from "./ocr/router.js";
export { TesseractNativeEngine, detectOrientation, parseTsv } from "./ocr/engines/tesseract-native.js";
export { arbitrate, arbitrationPasses, type ArbitrationNote } from "./ocr/arbitrate.js";
export type { OcrEngine, OcrRequest, OcrResult } from "./ocr/engines/types.js";

// Layout
export { groupLines, groupBlocks, linesFromTextLayer, zoneOf } from "./layout/lines.js";
export {
  detectTables, splitIntoClusters, inferColumns, rowCells, toGrid,
  headerRow, toRecords, cellKind, countTypedColumns, mergeContinuationRows,
  redundantBoundaries, type TableOptions,
} from "./layout/tables.js";
export {
  toTableRecord, classifyTable, columnKinds, ledgerRows,
  type TableRecordOptions,
} from "./layout/table-records.js";

// Grammar
export * as patterns from "./grammar/patterns.js";
export {
  detectScript, profileScript, normaliseDigits, hygiene, prepare,
  TESS_LANGS, SCRIPT_LANGS, PADDLE_V5_MODELS,
} from "./grammar/script.js";
export { parseDate, findDates, expandYear, daysInMonth, addDays, daysBetween } from "./grammar/dates.js";
export {
  findRepairs, repairAgainst, verhoeffValid, gstinChecksum,
  IDENTIFIER_FORMATS, type RepairResult, type IdentifierFormat,
} from "./grammar/repair.js";
export { findMoney, findMoneyWords, wordsToNumber, crossCheckMoney, formatINR } from "./grammar/money.js";
export {
  findSections, parseSectionToken, splitSectionRun, canonicalStatute,
  mapSuccessor, concordanceEntry, concordanceStats, isProtectedOffence,
  causeOfActionHints, CONCORDANCE_STATUS,
  IPC_BNS, CRPC_BNSS, IEA_BSA, PROTECTED_OFFENCE_SECTIONS, CAUSE_OF_ACTION_HINTS,
} from "./grammar/sections.js";

// Document types
export { DOC_TYPES, DOC_TYPE_INDEX, profileFor } from "./doctype/registry.js";
export { classify, classifyPages, segmentBundle, type BundleSegment } from "./doctype/classify.js";

// Anchors
export { extractAnchor, runAnchorProfile, pageConfidence, type AnchorSpec, type AnchorProfile } from "./anchors/engine.js";
export { ANCHOR_PROFILES, profilesForDocType, authorityWeight, AUTHORITY } from "./anchors/profiles.js";

// Resolution
export { sweep, sweepDates } from "./resolve/sweep.js";
export {
  extractParties, parseCauseTitle, parsePartyArray, parseDeedParties,
  parseAdvocates, personFromText, cleanName, looksLikeName, opposingRole,
} from "./resolve/parties.js";
export { resolveField, resolveAll, equivalent, combineConfidence } from "./resolve/conflicts.js";

// Analysis
export {
  analyse, summarise, buildTimeline, extractObligations, extractReliefs,
  extractStructure, extractHolding, extractCitations, extractMonetary,
  splitSentences, allSections,
} from "./analyze/analyze.js";

// Autofill
export { buildAutofill, toCaseDraft, type NspCaseDraft } from "./autofill/autofill.js";

// Governance
export {
  AuditChain, assessRestriction, redactCandidates, redactPersons,
  buildGovernanceReport, redactPageText, redactDerivedText, maskTail,
  type AuditEvent, type RestrictionVerdict, type RedactionRecord,
} from "./governance/governance.js";
