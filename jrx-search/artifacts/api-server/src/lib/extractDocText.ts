import { getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import { logger } from "./logger";

export class UnsupportedFileError extends Error {}

/** Thrown when the OCR fallback fails (never returned as silent empty text). */
export class OcrError extends Error {}

/**
 * Page budget for the embedded text layer.
 *
 * Extraction cost tracks PAGE COUNT, not bytes — measured on the caselaw worker
 * (2026-08-19): a 35.8 MB / 1,006-page reporter volume took 17.6 s to extract,
 * while a *larger* 60.9 MB / 156-page one took 3.7 s. At the measured ~17 ms per
 * page, 2,000 pages is ~35 s, which still fits inside the 60 s timeout the NYV
 * client allows for /athena/extract.
 */
export const MAX_TEXT_LAYER_PAGES = 2_000;
/**
 * Wall-clock budget for the text-layer pass. Hitting it returns the pages read
 * so far with an explicit note — a labelled partial judgment is more useful to
 * an advocate than a request that hangs past the caller's timeout.
 */
export const TEXT_LAYER_TIME_BUDGET_MS = 40_000;

/** Below this many characters per page a PDF is treated as image-only/scanned. */
const OCR_MIN_CHARS_PER_PAGE = 50;
/** Hard cap on how many pages we will rasterize + OCR per document. */
const MAX_OCR_PAGES = 25;
/** Reject a single rasterized page image larger than this (crafted huge-dimension pages). */
const MAX_RASTER_PAGE_BYTES = 8 * 1024 * 1024;
/** Total raster memory budget across all pages of one document. */
const MAX_RASTER_TOTAL_BYTES = 64 * 1024 * 1024;
/** Wall-clock budget for the OCR loop; remaining pages are skipped with an explicit note. */
const OCR_TIME_BUDGET_MS = 90_000;

/** Injectable OCR primitives so the fallback can be unit-tested without the
 * heavy tesseract.js / pdf-to-img runtimes (and their model downloads). */
export interface OcrDeps {
  /** Rasterize the first `maxPages` PDF pages to PNG buffers. */
  rasterize: (bytes: Buffer, maxPages: number) => Promise<Buffer[]>;
  /** Run OCR on a single rasterized page image; returns recognized text. */
  ocr: (image: Buffer) => Promise<string>;
}

function detectKind(filename: string): "pdf" | "docx" | "txt" | "image" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".text")
  )
    return "txt";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp") ||
    lower.endsWith(".gif")
  )
    return "image";
  throw new UnsupportedFileError(
    "Unsupported file type. Upload a PDF, DOCX, TXT, or image (PNG/JPEG/WebP).",
  );
}

const MIME: Record<"pdf" | "docx" | "txt" | "image", string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  image: "image/png",
};

/** Default rasterizer: pure-WASM/JS pdf-to-img (no system binaries). */
async function defaultRasterize(
  bytes: Buffer,
  maxPages: number,
): Promise<Buffer[]> {
  const { pdf } = await import("pdf-to-img");
  const doc = await pdf(new Uint8Array(bytes), { scale: 2 });
  const images: Buffer[] = [];
  let totalBytes = 0;
  for await (const page of doc) {
    if (page.length > MAX_RASTER_PAGE_BYTES) {
      throw new Error(
        `A PDF page rasterized to ${page.length} bytes, exceeding the ${MAX_RASTER_PAGE_BYTES}-byte per-page OCR limit (page dimensions too large).`,
      );
    }
    totalBytes += page.length;
    if (totalBytes > MAX_RASTER_TOTAL_BYTES) {
      throw new Error(
        `Rasterized PDF pages exceed the total ${MAX_RASTER_TOTAL_BYTES}-byte OCR memory budget.`,
      );
    }
    images.push(page);
    if (images.length >= maxPages) break;
  }
  return images;
}

let ocrWorkerPromise: Promise<import("tesseract.js").Worker> | null = null;

/** Default OCR: tesseract.js (pure-JS). A single worker is reused per process. */
async function defaultOcr(image: Buffer): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = createWorker("eng");
  }
  const worker = await ocrWorkerPromise;
  const { data } = await worker.recognize(image);
  return data.text;
}

const defaultOcrDeps: OcrDeps = {
  rasterize: defaultRasterize,
  ocr: defaultOcr,
};

export interface OcrResult {
  text: string;
  pagesProcessed: number;
  truncated: boolean;
}

/** Rasterize and OCR a (likely scanned) PDF. Caps at MAX_OCR_PAGES and appends
 * an explicit note to the stored text when the document is truncated. */
export async function ocrPdf(
  bytes: Buffer,
  totalPages: number,
  deps: OcrDeps = defaultOcrDeps,
): Promise<OcrResult> {
  const started = Date.now();
  const truncated = totalPages > MAX_OCR_PAGES;
  const cap = Math.min(totalPages || MAX_OCR_PAGES, MAX_OCR_PAGES);

  let images: Buffer[];
  try {
    images = await deps.rasterize(bytes, cap);
  } catch (err) {
    throw new OcrError(
      `Failed to rasterize the PDF for OCR: ${String(
        err instanceof Error ? err.message : err,
      )}`,
    );
  }

  const parts: string[] = [];
  let pagesProcessed = 0;
  let timedOut = false;
  try {
    for (const image of images) {
      if (Date.now() - started > OCR_TIME_BUDGET_MS) {
        timedOut = true;
        break;
      }
      const pageText = await deps.ocr(image);
      pagesProcessed += 1;
      if (pageText.trim()) parts.push(pageText.trim());
    }
  } catch (err) {
    throw new OcrError(
      `OCR failed while reading the scanned PDF: ${String(
        err instanceof Error ? err.message : err,
      )}`,
    );
  }

  if (pagesProcessed === 0 && timedOut) {
    throw new OcrError(
      "OCR timed out before reading any pages of this scanned PDF.",
    );
  }

  let text = parts.join("\n\n");
  if (truncated) {
    text += `\n\n[Note: OCR truncated to the first ${MAX_OCR_PAGES} of ${totalPages} pages.]`;
  }
  if (timedOut) {
    text += `\n\n[Note: OCR time budget reached; only the first ${pagesProcessed} of ${images.length} rasterized pages were read.]`;
  }

  const durationMs = Date.now() - started;
  logger.info(
    { pagesProcessed, totalPages, truncated, timedOut, durationMs },
    "OCR completed for scanned PDF",
  );

  return { text, pagesProcessed, truncated };
}

export interface ExtractResult {
  text: string;
  mimeType: string;
  ocrUsed: boolean;
}

export interface PdfTextLayerResult {
  text: string;
  pagesRead: number;
  totalPages: number;
  /** True when the page or time budget cut the pass short. */
  truncated: boolean;
}

interface PdfTextLayerBudget {
  maxPages?: number;
  timeBudgetMs?: number;
}

/**
 * Read a PDF's embedded text layer one page at a time.
 *
 * Deliberately NOT unpdf's `extractText()`: that fans `Promise.all` across every
 * page and never calls `page.cleanup()`, so a 1,000-page reporter volume holds
 * every page's parsed text content resident simultaneously — unbounded in the
 * page count. Reading sequentially and releasing each page keeps the working set
 * bounded (measured on the same 1,006-page volume: 408 MB → 318 MB peak RSS) and
 * makes the pass interruptible, which is what allows a page and wall-clock
 * budget to be enforced at all.
 *
 * Per-page item joining matches unpdf's semantics (`str` + newline on `hasEOL`),
 * but the global `\s+ → " "` collapse unpdf applies for `mergePages` is dropped:
 * `normalizeExtractedText` handles whitespace, and keeping the line breaks keeps
 * paragraph boundaries in a judgment readable.
 */
export async function extractPdfTextLayer(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  budget: PdfTextLayerBudget = {},
): Promise<PdfTextLayerResult> {
  const started = Date.now();
  const totalPages = pdf.numPages || 1;
  const maxPages = budget.maxPages ?? MAX_TEXT_LAYER_PAGES;
  const timeBudgetMs = budget.timeBudgetMs ?? TEXT_LAYER_TIME_BUDGET_MS;
  const pageCap = Math.min(totalPages, maxPages);

  const pages: string[] = [];
  let timedOut = false;
  for (let pageNumber = 1; pageNumber <= pageCap; pageNumber += 1) {
    if (Date.now() - started > timeBudgetMs) {
      timedOut = true;
      break;
    }
    const page = await pdf.getPage(pageNumber);
    try {
      const content = await page.getTextContent();
      const parts: string[] = [];
      for (const item of content.items) {
        if ("str" in item && typeof item.str === "string") {
          parts.push(item.hasEOL ? `${item.str}\n` : item.str);
        }
      }
      pages.push(parts.join(""));
    } finally {
      page.cleanup();
    }
  }

  const pagesRead = pages.length;
  let text = pages.join("\n");
  if (pagesRead < totalPages) {
    const reason = timedOut
      ? `the ${Math.round(timeBudgetMs / 1000)}-second extraction budget was reached`
      : `the ${maxPages}-page extraction limit was reached`;
    text += `\n\n[Note: text extracted from the first ${pagesRead} of ${totalPages} pages — ${reason}.]`;
  }
  if (pagesRead < totalPages || totalPages > 200) {
    logger.info(
      { totalPages, pagesRead, timedOut, durationMs: Date.now() - started },
      "PDF text layer extracted",
    );
  }
  return { text, pagesRead, totalPages, truncated: pagesRead < totalPages };
}

export async function extractDocumentText(
  filename: string,
  bytes: Buffer,
  deps: OcrDeps = defaultOcrDeps,
): Promise<ExtractResult> {
  const kind = detectKind(filename);

  if (kind === "txt") {
    return { text: bytes.toString("utf8"), mimeType: MIME.txt, ocrUsed: false };
  }

  if (kind === "docx") {
    const result = await mammoth.extractRawText({ buffer: bytes });
    return { text: result.value, mimeType: MIME.docx, ocrUsed: false };
  }

  if (kind === "image") {
    const ext = filename.split(".").pop()?.toLowerCase();
    const mimeType =
      ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : ext === "webp"
          ? "image/webp"
          : ext === "gif"
            ? "image/gif"
            : "image/png";
    const text = await defaultOcr(bytes);
    if (!text.trim()) {
      throw new OcrError("No text could be extracted from this image.");
    }
    return { text, mimeType, ocrUsed: true };
  }

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const numPages = pdf.numPages || 1;
  const layer = await extractPdfTextLayer(pdf);
  const { text } = layer;

  // Enough embedded text? Use it directly (fast path, no OCR). Judge coverage
  // against the pages actually READ — a budget-truncated 1,000-page volume must
  // not look "image-only" merely because the tail was skipped.
  if (text.trim().length >= OCR_MIN_CHARS_PER_PAGE * Math.max(1, layer.pagesRead)) {
    return { text, mimeType: MIME.pdf, ocrUsed: false };
  }

  // Image-only / scanned PDF: fall back to OCR.
  logger.info(
    { numPages, pagesRead: layer.pagesRead, embeddedChars: text.trim().length },
    "PDF appears image-only; falling back to OCR",
  );
  const ocr = await ocrPdf(bytes, numPages, deps);
  return { text: ocr.text, mimeType: MIME.pdf, ocrUsed: true };
}

export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
