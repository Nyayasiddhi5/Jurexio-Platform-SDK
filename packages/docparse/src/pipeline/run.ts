/**
 * The orchestrator.
 *
 * One entry point: give it files, get back an ExtractionResult with candidates,
 * resolutions, an autofill payload, per-document analysis and a governance report.
 *
 * ORDER MATTERS and the order is:
 *
 *   ingest → per page: text layer? trust it : rasterise + deskew + OCR + arbitrate
 *          → layout (lines, blocks, zones)
 *          → classify (document, then bundle segments)
 *          → extract (anchors by profile, then grammar sweep, then parties)
 *          → REDACT                          ← before anything is resolved
 *          → resolve (equivalence, authority, corroboration, conflicts)
 *          → autofill (four states, never collapsed)
 *          → analyse
 *          → governance report + audit chain
 *
 * Redaction sits before resolution on purpose. If it sat after, an unmasked
 * Aadhaar number would exist in a resolution object, and every code path that
 * logs, caches or serialises a resolution would be a leak. Masking at the
 * candidate boundary means there is exactly one place the raw value lives — the
 * evidence plane — and it never crosses into the proposal plane.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { rm } from "node:fs/promises";

import type {
  Candidate, DocparseConfig, ExtractionResult, LangCode, Page, ParsedDocument, Warning,
} from "../types.js";
import { DEFAULT_CONFIG } from "../types.js";
import { extractTextLayer, assessTextLayer } from "./textlayer.js";
import { rasterisePdf, estimateSkewDegrees, deskewImage, loadGrey } from "./raster.js";
import { groupLines, groupBlocks, linesFromTextLayer } from "../layout/lines.js";
import { detectTables } from "../layout/tables.js";
import { OcrRouter } from "../ocr/router.js";
import { detectScriptOSD } from "../ocr/engines/tesseract-native.js";
import { classify, segmentBundle } from "../doctype/classify.js";
import { profilesForDocType, authorityWeight } from "../anchors/profiles.js";
import { runAnchorProfile } from "../anchors/engine.js";
import { sweep, sweepDates } from "../resolve/sweep.js";
import { extractParties } from "../resolve/parties.js";
import { resolveAll } from "../resolve/conflicts.js";
import { buildAutofill } from "../autofill/autofill.js";
import { analyse, allSections } from "../analyze/analyze.js";
import {
  AuditChain, assessRestriction, buildGovernanceReport, redactCandidates,
  redactDerivedText, redactPersons,
} from "../governance/governance.js";
import { profileScript } from "../grammar/script.js";
import { causeOfActionHints } from "../grammar/sections.js";

export interface InputFile {
  path?: string;
  bytes?: Uint8Array;
  fileName: string;
  mime?: string;
}

export interface RunOptions {
  config?: Partial<DocparseConfig>;
  batchId: string;
  actor: string;
  /** Injected clock, so runs are reproducible in tests and audit timestamps come
   *  from the platform rather than the container. */
  now?: () => string;
  referenceYear?: number;
  /** Cap pages processed per document. A 400-page paper book must not stall a batch. */
  maxPagesPerDoc?: number;
  /** Per-page progress hook for partner SSE / job pollers (NYV docparse adapter). */
  onPage?: (detail: {
    documentId: string;
    pageNo: number;
    pageTotal: number;
    route: string;
  }) => void;
}

export async function run(files: InputFile[], opts: RunOptions): Promise<ExtractionResult> {
  const config: DocparseConfig = {
    ...DEFAULT_CONFIG,
    ...opts.config,
    ocr: { ...DEFAULT_CONFIG.ocr, ...opts.config?.ocr },
    llmFallback: { ...DEFAULT_CONFIG.llmFallback, ...opts.config?.llmFallback },
    redaction: { ...DEFAULT_CONFIG.redaction, ...opts.config?.redaction },
  };
  const clock = opts.now ?? (() => new Date().toISOString());
  const audit = new AuditChain(clock, opts.batchId);
  const timings: Record<string, number> = {};
  const warnings: Warning[] = [];
  const t0 = performance.now();

  audit.append(opts.actor, "BATCH_OPEN", `batch=${opts.batchId} files=${files.length}`);

  const router = new OcrRouter(config);
  const documents: ParsedDocument[] = [];
  let allCandidates: Candidate[] = [];
  const humanReview: Array<{ documentId: string; pageNo: number; reason: string }> = [];

  for (const file of files) {
    const tDoc = performance.now();
    const bytes = file.bytes ?? new Uint8Array(await readFile(file.path!));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const documentId = sha256.slice(0, 16);
    const mime = file.mime ?? sniffMime(bytes, file.fileName);

    audit.append(opts.actor, "DOC_INGEST", `doc=${documentId} name=${basename(file.fileName)} sha256=${sha256} bytes=${bytes.length}`);

    const docTimings: Record<string, number> = {};
    const docWarnings: Warning[] = [];
    let pages: Page[] = [];

    if (mime === "application/pdf") {
      pages = await processPdf({
        bytes, path: file.path, documentId, config, router,
        maxPages: opts.maxPagesPerDoc, timings: docTimings, warnings: docWarnings,
        humanReview,
      });
    } else if (mime.startsWith("image/")) {
      pages = await processImage({
        path: file.path!, documentId, config, router,
        timings: docTimings, warnings: docWarnings, humanReview,
      });
    } else {
      docWarnings.push({
        code: "UNSUPPORTED_MIME",
        message:
          `${mime} is not handled by the document pipeline. Convert to PDF or an image first. ` +
          `(Detected from the file's content, not its name.)`,
        severity: "BLOCK",
      });
    }

    if (opts.onPage) {
      for (const p of pages) {
        opts.onPage({
          documentId,
          pageNo: p.pageNo,
          pageTotal: pages.length,
          route: p.route,
        });
      }
    }

    // A mismatch between content and name is worth surfacing: it usually means a
    // renamed file, and it is the difference between "we cannot read this" and
    // "this is not the format its name claims".
    const byExt = mimeFromExtension(file.fileName);
    if (byExt !== "application/octet-stream" && byExt !== mime) {
      docWarnings.push({
        code: "MIME_MISMATCH",
        message: `file name suggests ${byExt} but the content is ${mime}; the content was trusted`,
        severity: "INFO",
      });
    }

    // ---- Classification
    const tCls = performance.now();
    const classification = classify(pages, { fileName: file.fileName });
    const segments = pages.length > 1 ? segmentBundle(pages, { fileName: file.fileName }) : [];
    docTimings.classify = performance.now() - tCls;

    audit.append(
      opts.actor, "DOC_CLASSIFY",
      `doc=${documentId} type=${classification.code} conf=${classification.conf.toFixed(2)} ` +
      `alternatives=${classification.alternatives.map((a) => `${a.code}:${a.conf.toFixed(2)}`).join(",") || "none"}` +
      (segments.length > 1 ? ` bundleSegments=${segments.length}` : ""),
    );

    if (segments.length > 1) {
      docWarnings.push({
        code: "BUNDLE_DETECTED",
        message:
          `This file appears to contain ${segments.length} distinct documents: ` +
          segments.map((s) => `${s.label} (p${s.fromPage}-${s.toPage})`).join("; ") +
          `. Extraction ran over the whole file; splitting it will improve accuracy.`,
        severity: "WARN",
      });
    }

    // ---- Extraction
    const tEx = performance.now();
    const aw = (fieldPath: string) => authorityWeight(fieldPath, classification.code);

    const anchorCands: Candidate[] = [];
    for (const profile of profilesForDocType(classification.code)) {
      anchorCands.push(...runAnchorProfile(profile, pages, documentId, 1));
    }
    // Authority is per field, so apply it after the profile run.
    for (const c of anchorCands) c.authorityWeight = aw(c.fieldPath);

    const grammarCands = sweep(pages, {
      documentId, docTypeCode: classification.code, authorityWeight: aw,
      ...(opts.referenceYear !== undefined ? { referenceYear: opts.referenceYear } : {}),
    });
    const dateCands = sweepDates(pages, {
      documentId, docTypeCode: classification.code, authorityWeight: aw,
      ...(opts.referenceYear !== undefined ? { referenceYear: opts.referenceYear } : {}),
    });
    const partyResult = extractParties(pages, documentId, classification.code, aw("parties"));

    const docCands = [...anchorCands, ...grammarCands, ...dateCands, ...partyResult.candidates];
    docTimings.extract = performance.now() - tEx;

    audit.append(
      opts.actor, "DOC_EXTRACT",
      `doc=${documentId} candidates=${docCands.length} ` +
      `(anchor=${anchorCands.length} grammar=${grammarCands.length} date=${dateCands.length} party=${partyResult.candidates.length}) ` +
      `aiInvolved=${docCands.some((c) => c.aiInvolved)}`,
    );

    allCandidates.push(...docCands);

    const langs = [...new Set(pages.flatMap((p) => scriptToLangs(p.script)))];
    documents.push({
      documentId,
      fileName: basename(file.fileName),
      mime,
      sha256,
      pageCount: pages.length,
      pages,
      classification,
      langs,
      timings: { ...docTimings, total: performance.now() - tDoc },
      warnings: docWarnings,
    });
    warnings.push(...docWarnings.map((w) => ({ ...w, message: `[${basename(file.fileName)}] ${w.message}` })));
  }

  // ---- Governance: restriction assessment, then redaction BEFORE resolution.
  const tGov = performance.now();
  const everyPage = documents.flatMap((d) => d.pages);
  const sections = allSections(everyPage);
  const restriction = assessRestriction(sections, everyPage);

  if (restriction.restricted) {
    audit.append(
      opts.actor, "RESTRICTED_MATTER",
      `reasons=${restriction.reasons.length}: ${restriction.reasons.join(" | ")}`,
    );
    warnings.push({
      code: "RESTRICTED_MATTER",
      message:
        "This matter is RESTRICTED. Identity fields are withheld from the proposal and the " +
        "matter is excluded from analytics. Reasons: " + restriction.reasons.join("; "),
      severity: "WARN",
    });
  }

  const { candidates: redacted, redactions } = redactCandidates(allCandidates, config.redaction);
  allCandidates = redacted;

  // Also mask the derived TEXT plane. Extraction has already run, so candidates
  // keep their last-4 for verification, but nothing downstream of here — logs,
  // caches, search indexes, analytics, a serialised ExtractionResult — holds a
  // full Aadhaar or account number. The pixels in the document store remain the
  // evidence and stay under their own access controls.
  for (const doc of documents) {
    // Covers page lines, words, blocks AND the classifier's evidence snippets —
    // the snippet path was a real leak found by a test, because classification
    // runs before redaction and cuts its snippets straight out of page text.
    for (const r of redactDerivedText(doc, config.redaction)) {
      redactions.push({ ...r, documentId: doc.documentId });
    }
  }

  if (redactions.length > 0) {
    audit.append(
      opts.actor, "REDACT",
      redactions.map((r) => `${r.kind}x${r.count}@${r.documentId}p${r.pageNo}`).join(","),
    );
  }
  timings.governance = performance.now() - tGov;

  // ---- Resolution
  const tRes = performance.now();
  const resolutions = resolveAll(allCandidates, {
    autofillThreshold: config.autofillThreshold,
    floorThreshold: config.floorThreshold,
    aiCap: config.llmFallback.maxConfidence,
  });
  timings.resolve = performance.now() - tRes;

  const conflictCount = resolutions.filter((r) => r.status === "CONFLICT").length;
  audit.append(
    opts.actor, "RESOLVE",
    `fields=${resolutions.length} resolved=${resolutions.filter((r) => r.status === "RESOLVED").length} ` +
    `conflict=${conflictCount} lowConf=${resolutions.filter((r) => r.status === "LOW_CONFIDENCE").length} ` +
    `absent=${resolutions.filter((r) => r.status === "ABSENT").length}`,
  );

  // ---- Autofill
  const tAf = performance.now();
  const autofill = buildAutofill(resolutions, {
    autofillThreshold: config.autofillThreshold,
    docTypeCodes: documents.map((d) => d.classification.code),
    withheldFieldPaths: restriction.withheldFieldPaths,
  });
  timings.autofill = performance.now() - tAf;

  audit.append(
    opts.actor, "AUTOFILL_PROPOSED",
    `tier=${autofill.tier} filled=${autofill.completeness.filled}/${autofill.completeness.expected} ` +
    `conflicts=${autofill.conflicts.length} lowConf=${autofill.lowConfidence.length} absent=${autofill.absent.length}`,
  );

  // ---- Analysis
  const tAn = performance.now();
  const analysis = documents.map((d) =>
    analyse(d.documentId, d.pages, opts.referenceYear !== undefined ? { referenceYear: opts.referenceYear } : {}),
  );
  timings.analyse = performance.now() - tAn;

  // Cause-of-action hints — a suggestion for the creation flow, never a decision.
  const hints = causeOfActionHints(sections);
  if (hints.length > 0) {
    audit.append(opts.actor, "CAUSE_HINT", hints.map((h) => `${h.hint}@${h.forum}(${h.basis})`).join(","));
  }

  // Persons are redacted for the same reason candidates are.
  void redactPersons([], config.redaction);

  const governance = buildGovernanceReport({
    restriction, redactions, candidates: allCandidates,
    humanReviewRequired: humanReview, audit,
  });

  timings.total = performance.now() - t0;

  return {
    batchId: opts.batchId,
    documents,
    candidates: allCandidates,
    resolutions,
    autofill,
    analysis,
    governance,
    timings,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Per-format processing
// ---------------------------------------------------------------------------

interface ProcessPdfArgs {
  bytes: Uint8Array;
  path?: string;
  documentId: string;
  config: DocparseConfig;
  router: OcrRouter;
  maxPages?: number;
  timings: Record<string, number>;
  warnings: Warning[];
  humanReview: Array<{ documentId: string; pageNo: number; reason: string }>;
}

async function processPdf(a: ProcessPdfArgs): Promise<Page[]> {
  const tTl = performance.now();
  let textPages: Awaited<ReturnType<typeof extractTextLayer>> = [];
  try {
    textPages = await extractTextLayer(a.bytes, a.maxPages !== undefined ? { maxPages: a.maxPages } : {});
  } catch (e) {
    a.warnings.push({
      code: "TEXT_LAYER_FAILED",
      message: `text-layer extraction failed, falling back to OCR for every page: ${(e as Error).message}`,
      severity: "WARN",
    });
  }
  a.timings.textLayer = performance.now() - tTl;

  const verdicts = textPages.map((p) => ({ page: p, verdict: assessTextLayer(p) }));
  const needOcr = verdicts.filter((v) => !v.verdict.trust).map((v) => v.page.pageNo);

  const pages: Page[] = [];

  // Fast path: pages with a trusted text layer.
  for (const { page, verdict } of verdicts) {
    if (!verdict.trust) continue;
    const opts = { pageWidth: page.width, pageHeight: page.height };
    const lines = linesFromTextLayer(page.items, opts);
    const blocks = groupBlocks(lines, opts);
    pages.push({
      pageNo: page.pageNo,
      width: page.width,
      height: page.height,
      deskewDeg: 0,
      lines,
      blocks,
      tables: detectTables({
        pageNo: page.pageNo, width: page.width, height: page.height,
        deskewDeg: 0, lines, blocks, tables: [],
        script: "Latn", route: "TEXT_LAYER", quality: verdict.quality,
      }),
      script: profileScript(lines.map((l) => l.text).join(" ")).dominant,
      route: "TEXT_LAYER",
      quality: verdict.quality,
    });
  }

  // OCR path.
  if (needOcr.length > 0) {
    if (!a.path) {
      // Rasterisation needs a file for pdftoppm. Writing a temp file here would
      // be easy but the caller knows better where scratch space belongs, so we
      // report rather than guess.
      a.warnings.push({
        code: "OCR_NEEDS_PATH",
        message: `${needOcr.length} page(s) need OCR but the document was supplied as bytes without a path. Supply a file path to enable rasterisation.`,
        severity: "BLOCK",
      });
      for (const pageNo of needOcr) {
        a.humanReview.push({ documentId: a.documentId, pageNo, reason: "OCR required but rasterisation unavailable" });
      }
    } else {
      const tR = performance.now();
      const { pages: rasters, tmpDir } = await rasterisePdf(a.path, {
        dpi: a.config.ocr.dpi,
        grey: true,
        ...(a.maxPages !== undefined ? { lastPage: a.maxPages } : {}),
      });
      a.timings.raster = performance.now() - tR;

      try {
        const tO = performance.now();

        // Pages are OCR'd CONCURRENTLY, with a bounded pool.
        //
        // This is where throughput comes from. Each Tesseract process is pinned
        // to one OpenMP thread (see the engine — that alone is a 4.4x latency win
        // and costs nothing in accuracy), so the way to use the remaining cores
        // is to run several pages at once. Measured on a 2-core container:
        // 4 pages serially 20.9 s, the same 4 pages concurrently 7.4 s.
        //
        // The pool is bounded rather than unbounded because each worker holds a
        // rasterised page in memory and spawns a child process; a 200-page paper
        // book submitted at once must not fork 200 Tesseracts.
        const todo = rasters.filter(
          (raster) => textPages.length === 0 || needOcr.includes(raster.pageNo),
        );
        const concurrency = Math.max(1, a.config.ocr.maxConcurrency);
        const collected: Page[] = [];

        const processOne = async (raster: typeof rasters[number]): Promise<void> => {

          const meta = textPages.find((p) => p.pageNo === raster.pageNo);
          const widthPt = meta?.width ?? (raster.widthPx * 72) / raster.dpi;
          const heightPt = meta?.height ?? (raster.heightPx * 72) / raster.dpi;

          // Deskew. sharp cannot estimate the angle (verified — it has no deskew
          // at all), so the projection-profile estimator supplies it.
          let imagePath = raster.imagePath;
          let deskewDeg = 0;
          const grey = await loadGrey(raster.imagePath);
          if (grey) {
            deskewDeg = estimateSkewDegrees(grey.data, grey.width, grey.height);
            if (Math.abs(deskewDeg) >= 0.15) {
              const out = raster.imagePath.replace(/\.png$/, ".dsk.png");
              if (await deskewImage(raster.imagePath, out, deskewDeg)) imagePath = out;
            }
          }

          // Script comes from the PIXELS via Tesseract OSD, not from a first
          // recognition pass. A Latin model reading a Devanagari page returns
          // garbled Latin, so text-based detection agrees with the wrong guess
          // and never re-routes — which is what silently kept the Hindi and
          // Tamil fixtures off their own models and out of numeric arbitration.
          const osd = await detectScriptOSD(imagePath, {
            ...(a.config.ocr.tessdataPrefix ? { tessdataPrefix: a.config.ocr.tessdataPrefix } : {}),
            ...(a.config.ocr.tesseractBinary ? { binary: a.config.ocr.tesseractBinary } : {}),
          });
          const metaScript = guessScriptFromMeta(meta);
          const script =
            osd && osd.script !== "Zzzz" ? osd.script :
            metaScript ?? "Latn";

          const final = await a.router.recognise({
            imagePath,
            script,
            dpi: raster.dpi,
            pageWidthPt: widthPt,
            pageHeightPt: heightPt,
            timeoutMs: a.config.ocr.pageTimeoutMs,
          });

          const opts = { pageWidth: widthPt, pageHeight: heightPt };
          const lines = groupLines(final.words, opts);
          const garble = estimateGarble(lines.map((l) => l.text).join(" "));

          if (final.humanReviewRequired) {
            a.humanReview.push({
              documentId: a.documentId, pageNo: raster.pageNo,
              reason: final.words.length === 0
                ? "no text recognised on the page"
                : `OCR confidence ${final.meanConf.toFixed(2)} below the reliability floor`,
            });
          }
          if (final.numericConflicts > 0) {
            a.warnings.push({
              code: "NUMERIC_ARBITRATION_CONFLICT",
              message:
                `page ${raster.pageNo}: ${final.numericConflicts} number(s) were read differently by ` +
                `different OCR models and have been flagged for confirmation. This is the mechanism that ` +
                `catches dropped leading digits in Indic-script dates.`,
              severity: "WARN",
              pageNo: raster.pageNo,
            });
          }

          collected.push({
            pageNo: raster.pageNo,
            width: widthPt,
            height: heightPt,
            deskewDeg,
            lines,
            blocks: groupBlocks(lines, opts),
            tables: detectTables({
              pageNo: raster.pageNo, width: widthPt, height: heightPt,
              deskewDeg, lines, blocks: groupBlocks(lines, opts), tables: [],
              script: profileScript(lines.map((l) => l.text).join(" ")).dominant,
              route: "OCR",
              quality: {
                textLayerCoverage: 0, meanConf: final.meanConf, garbleRate: garble,
                dpi: raster.dpi, handwrittenSuspected: false,
              },
            }),
            script: profileScript(lines.map((l) => l.text).join(" ")).dominant,
            route: "OCR",
            quality: {
              textLayerCoverage: 0,
              meanConf: final.meanConf,
              garbleRate: garble,
              dpi: raster.dpi,
              handwrittenSuspected: suspectHandwriting(final.meanConf, garble, lines.length),
            },
          });
        };

        // A simple index-cursor pool. Each worker pulls the next page until the
        // list is exhausted, so a slow page does not idle the other workers the
        // way a fixed chunk split would.
        let cursor = 0;
        const workers = Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
          for (;;) {
            const i = cursor++;
            if (i >= todo.length) return;
            const raster = todo[i]!;
            try {
              await processOne(raster);
            } catch (e) {
              // One bad page must not fail the document. Record it for human
              // review and carry on with the rest.
              a.warnings.push({
                code: "PAGE_OCR_FAILED",
                message: `page ${raster.pageNo}: ${(e as Error).message}`,
                severity: "WARN",
                pageNo: raster.pageNo,
              });
              a.humanReview.push({
                documentId: a.documentId, pageNo: raster.pageNo,
                reason: `OCR failed: ${(e as Error).message}`,
              });
            }
          }
        });
        await Promise.all(workers);
        pages.push(...collected);
        a.timings.ocr = performance.now() - tO;
        a.timings.ocrPages = todo.length;
        a.timings.ocrConcurrency = concurrency;
      } finally {
        await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      }
    }
  }

  pages.sort((x, y) => x.pageNo - y.pageNo);
  return pages;
}

interface ProcessImageArgs {
  path: string;
  documentId: string;
  config: DocparseConfig;
  router: OcrRouter;
  timings: Record<string, number>;
  warnings: Warning[];
  humanReview: Array<{ documentId: string; pageNo: number; reason: string }>;
}

async function processImage(a: ProcessImageArgs): Promise<Page[]> {
  const t0 = performance.now();
  const grey = await loadGrey(a.path);
  if (!grey) {
    a.warnings.push({ code: "IMAGE_LOAD_FAILED", message: `could not read ${a.path}`, severity: "BLOCK" });
    return [];
  }
  const deskewDeg = estimateSkewDegrees(grey.data, grey.width, grey.height);
  let imagePath = a.path;
  if (Math.abs(deskewDeg) >= 0.15) {
    const out = a.path.replace(/\.(png|jpe?g|tiff?)$/i, ".dsk.png");
    if (await deskewImage(a.path, out, deskewDeg)) imagePath = out;
  }

  const dpi = a.config.ocr.dpi;
  const widthPt = (grey.width * 72) / dpi;
  const heightPt = (grey.height * 72) / dpi;

  // Script from the pixels via OSD — see the note in processPdf for why a
  // text-based guess after a Latin pass cannot work.
  const osd = await detectScriptOSD(imagePath, {
    ...(a.config.ocr.tessdataPrefix ? { tessdataPrefix: a.config.ocr.tessdataPrefix } : {}),
    ...(a.config.ocr.tesseractBinary ? { binary: a.config.ocr.tesseractBinary } : {}),
  });
  const ocr = await a.router.recognise({
    imagePath,
    script: osd && osd.script !== "Zzzz" ? osd.script : "Latn",
    dpi, pageWidthPt: widthPt, pageHeightPt: heightPt,
    timeoutMs: a.config.ocr.pageTimeoutMs,
  });

  const opts = { pageWidth: widthPt, pageHeight: heightPt };
  const lines = groupLines(ocr.words, opts);
  const garble = estimateGarble(lines.map((l) => l.text).join(" "));
  if (ocr.humanReviewRequired) {
    a.humanReview.push({ documentId: a.documentId, pageNo: 1, reason: `OCR confidence ${ocr.meanConf.toFixed(2)}` });
  }
  a.timings.ocr = performance.now() - t0;

  return [{
    pageNo: 1, width: widthPt, height: heightPt, deskewDeg,
    lines, blocks: groupBlocks(lines, opts),
    tables: detectTables({
      pageNo: 1, width: widthPt, height: heightPt, deskewDeg,
      lines, blocks: groupBlocks(lines, opts), tables: [],
      script: profileScript(lines.map((l) => l.text).join(" ")).dominant,
      route: "OCR",
      quality: { textLayerCoverage: 0, meanConf: ocr.meanConf, garbleRate: garble, dpi, handwrittenSuspected: false },
    }),
    script: profileScript(lines.map((l) => l.text).join(" ")).dominant,
    route: "OCR",
    quality: {
      textLayerCoverage: 0, meanConf: ocr.meanConf, garbleRate: garble, dpi,
      handwrittenSuspected: suspectHandwriting(ocr.meanConf, garble, lines.length),
    },
  }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determine the MIME type from the CONTENT first, falling back to the extension.
 *
 * Extension-only detection has a silent failure mode that a user hits easily: a
 * file named "scan" or "IMG_0042" with no extension resolves to
 * application/octet-stream, the pipeline reports UNSUPPORTED_MIME, and the
 * document produces zero pages and zero fields. Nothing is wrong with the
 * document — a phone camera roll and a scan-to-email attachment both routinely
 * arrive without a usable extension, and a misnamed .pdf is common too.
 *
 * Magic bytes are authoritative and cheap: we already have the first bytes in
 * memory. The extension is kept only as a fallback for formats we do not sniff.
 */
function sniffMime(bytes: Uint8Array, fileName: string): string {
  const b = bytes;
  const at = (i: number) => (i < b.length ? b[i]! : -1);
  const magic = (offset: number, sig: number[]) =>
    sig.every((v, i) => at(offset + i) === v);

  // %PDF
  if (magic(0, [0x25, 0x50, 0x44, 0x46])) return "application/pdf";
  // \x89PNG\r\n\x1a\n
  if (magic(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // JPEG SOI
  if (magic(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // TIFF, little- and big-endian
  if (magic(0, [0x49, 0x49, 0x2a, 0x00]) || magic(0, [0x4d, 0x4d, 0x00, 0x2a])) return "image/tiff";
  // RIFF....WEBP
  if (magic(0, [0x52, 0x49, 0x46, 0x46]) && magic(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  // BM
  if (magic(0, [0x42, 0x4d])) return "image/bmp";
  // ZIP container — DOCX and friends. Distinguish by extension, since every
  // OOXML format shares the signature.
  if (magic(0, [0x50, 0x4b, 0x03, 0x04]) || magic(0, [0x50, 0x4b, 0x05, 0x06])) {
    const ext = fileName.toLowerCase().split(".").pop() ?? "";
    if (ext === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return "application/zip";
  }

  return mimeFromExtension(fileName);
}

function mimeFromExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".");
  // A name with no dot has no extension — "pdf".split(".") is ["pdf"], and
  // treating that single element as an extension is how a file literally named
  // "PIL" was read as a ".pil" file.
  if (parts.length < 2) return "application/octet-stream";
  const ext = parts.pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
    tif: "image/tiff", tiff: "image/tiff", webp: "image/webp", bmp: "image/bmp",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
  return map[ext] ?? "application/octet-stream";
}

function guessScriptFromMeta(meta: { items: Array<{ text: string }> } | undefined) {
  if (!meta || meta.items.length === 0) return null;
  // Even an untrusted text layer usually reveals the SCRIPT correctly, which is
  // enough to route OCR even when the characters themselves are garbage.
  const p = profileScript(meta.items.map((i) => i.text).join(" "));
  return p.dominant === "Zyyy" || p.dominant === "Zzzz" ? null : p.dominant;
}

function scriptToLangs(script: string): LangCode[] {
  const map: Record<string, LangCode[]> = {
    Latn: ["en"], Deva: ["hi"], Beng: ["bn"], Taml: ["ta"], Telu: ["te"],
    Knda: ["kn"], Mlym: ["ml"], Gujr: ["gu"], Guru: ["pa"], Orya: ["or"], Arab: ["ur"],
  };
  return map[script] ?? ["und"];
}

/** Vowelless-run heuristic, same as the text-layer check. */
function estimateGarble(text: string): number {
  const words = text.split(/\s+/).filter((w) => /^[A-Za-z]{3,}$/.test(w));
  if (words.length < 10) return 0;
  const bad = words.filter((w) => /[bcdfghjklmnpqrstvwxz]{5,}/i.test(w)).length;
  return bad / words.length;
}

/**
 * Handwriting suspicion.
 *
 * Deliberately conservative and it exists for one reason: Indic handwriting is
 * NOT reliably machine-readable today. Google Document AI classes Devanagari and
 * Bengali handwriting as Experimental and does not list Tamil or Telugu
 * handwriting at all; Azure Document Intelligence supports no Indic handwriting
 * whatsoever. So a suspected handwritten page must go to a human rather than
 * produce fields, and this flag is what routes it there.
 */
function suspectHandwriting(meanConf: number, garble: number, lineCount: number): boolean {
  return lineCount > 3 && meanConf < 0.62 && garble > 0.3;
}
