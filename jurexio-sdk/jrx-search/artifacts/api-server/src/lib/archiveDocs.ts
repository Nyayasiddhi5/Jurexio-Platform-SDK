import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { db, archiveExtractsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  extractDocumentText,
  normalizeExtractedText,
  OcrError,
  UnsupportedFileError,
} from "./extractDocText";

/**
 * Owned judgment PDF buckets that may be presigned or fetched for extraction,
 * mapped to their actual AWS region. Only keys inside these buckets are ever
 * fetched — this is the allowlist that prevents touching arbitrary buckets.
 */
export const DOCUMENT_BUCKET_REGIONS: Record<string, string> = {
  /**
   * Owned India Supreme Court full-PDF estate (us-east-1).
   * Bucket name is intentional legacy (`your-supreme-court-data-bucket`) —
   * it is a real AWS bucket with live PDFs under data/tar/year=YYYY/…, NOT
   * an unset placeholder. Do not "fix" by deleting this allowlist entry.
   * Public metadata source remains s3://indian-supreme-court-judgments/;
   * owned PDFs live here for presign/extract.
   */
  "your-supreme-court-data-bucket": "us-east-1",
  "ns-highcourt-data-bucket": "us-east-1",
  "ns-indian-highcourt-judgements-2": "ap-south-1",
  "usa-caselaw": "ap-south-1",
};

/**
 * The High Court PDF estate is split across two owned buckets with identical
 * key layouts (data/pdf/year=…/court=…/bench=…/file.pdf). A metadata row can
 * only name one candidate bucket, so lookups fall back to the sibling.
 */
export const HC_SIBLING_BUCKET: Record<string, string> = {
  "ns-highcourt-data-bucket": "ns-indian-highcourt-judgements-2",
  "ns-indian-highcourt-judgements-2": "ns-highcourt-data-bucket",
};

/**
 * Hard cap on the PDF size we will download and extract on demand.
 *
 * 96 MB, raised from 20 MB (`NYS-ARCHIVE-LARGE-PDF-001`). The 20 MB cap was
 * excluding the most-cited judgments in Indian constitutional law: Supreme Court
 * objects are per-*report* extracts spanning a reporter page range (the key
 * encodes it — `1978_2_621_776` = pp. 621–776), and a landmark judgment occupies
 * hundreds of pages of high-resolution scan, so the landmark authorities are the
 * largest objects in the estate. Kesavananda Bharati (35.8 MB, 1,006 pp) and
 * Maneka Gandhi (60.9 MB, 156 pp) both returned 413 while routine judgments
 * extracted fine. Note the object already contains ONLY its page range — 156 pages
 * for 621–776 — so "extract just the pages we need" saves nothing here.
 *
 * 96 MB is chosen from the measured corpus, not guessed. Across all 176,997 SC
 * PDFs (2026-08-19): p50 0.2 MB, p99 3.42 MB, p99.9 9.29 MB, **max 68.79 MB**.
 * 20 MB excluded 43 objects; 80 MB and above excludes zero. 96 MB therefore
 * covers the entire estate with ~40% headroom for future ingest while still
 * refusing anything anomalous.
 *
 * Safe because extraction cost tracks PAGE COUNT, not bytes — the 60.9 MB / 156-page
 * file extracts in 3.7 s while the *smaller* 35.8 MB / 1,006-page one takes 17.6 s —
 * and pages are now bounded: `extractPdfTextLayer` reads them sequentially with
 * cleanup under a page + wall-clock budget. Measured on the caselaw worker (7.8 GB
 * RAM, ~6.8 GB free, 2.1 GB V8 heap limit): peak 451 MB RSS / 10.0 s end to end for
 * Maneka Gandhi, 433 MB / 21.1 s for Kesavananda.
 */
export const MAX_ARCHIVE_PDF_BYTES = 96 * 1024 * 1024;
/**
 * Hard cap on stored/returned extracted text.
 *
 * 4,000,000 chars, raised from 500,000 (`NYS-ARCHIVE-LARGE-PDF-001`). Raising the
 * byte cap alone would have been cosmetic: Kesavananda Bharati yields 3,200,322
 * chars of text layer, so at 500k an advocate asking what it held would have
 * received the first 16% of it — a truncated landmark judgment reads as a
 * complete one and is worse than an honest 413. 4M covers the largest text yield
 * measured in the estate with headroom. `text_content` is an unbounded Postgres
 * `text` column, so the storage cost is a TOAST-compressed row, paid once.
 */
const MAX_EXTRACT_TEXT_CHARS = 4_000_000;

/**
 * Above this size an extraction is "heavy": it costs hundreds of MB of RSS and
 * seconds of CPU, so it goes through the concurrency gate. Set just above the
 * corpus p99.9 (9.29 MB) so the ordinary 99.99% of judgments never queue.
 */
const HEAVY_PDF_BYTES = 10 * 1024 * 1024;
/**
 * Concurrent heavy extractions allowed. The worker has 2 vCPU and pdf.js text
 * extraction is CPU-bound (measured ~17 ms/page), so a third concurrent volume
 * would push every one of them past the 60 s caller timeout while tripling peak
 * RSS. This gate — not the byte cap — is what prevents a 413 from becoming an OOM.
 */
const MAX_CONCURRENT_HEAVY_EXTRACTS = 2;
/**
 * How long a heavy extraction will wait for a gate slot. 20 s + a ~21 s worst-case
 * extraction stays inside the 60 s the NYV client allows, so a queued request
 * still succeeds rather than timing out somewhere upstream with no explanation.
 */
const HEAVY_QUEUE_WAIT_MS = 20_000;

/**
 * Marker for the explicit notes appended by every budget in the extraction path
 * (page budget, time budget, OCR page cap, char cap). Detecting it lets a cached
 * row report `truncated` without storing a second column, so callers can tell a
 * partial judgment from a complete one on both cold and warm reads.
 */
const TRUNCATION_NOTE = /\[Note: (?:text extracted from the first|OCR truncated|OCR time budget|extracted text truncated)/;

const ALLOWED_KEY = /^(?:[A-Za-z0-9!_.*'()=-]+\/)*[A-Za-z0-9!_.*'()=-]+\.pdf$/;

export type AllowedS3Path =
  | { bucket: string; key: string; region: string }
  | { error: string };

/**
 * Parse and validate an s3://bucket/key path against the bucket allowlist.
 *
 * Hardened against presign-abuse tricks:
 *  - exactly one `s3://` scheme, no scheme confusion;
 *  - percent-encoding is rejected outright (no `%2e%2e`, `%2f`, etc.);
 *  - no `..` traversal, control chars/NUL, backslashes, leading/duplicate
 *    slashes, whitespace, wildcards, or query/fragment characters;
 *  - bucket must be an *exact* key in the allowlist (lookalikes such as
 *    `owned-bucket.evil.com` fail);
 *  - key must be non-empty and match the expected PDF-key pattern.
 */
export function parseAllowedS3Path(s3Path: string): AllowedS3Path {
  if (typeof s3Path !== "string" || s3Path.length === 0) {
    return { error: "Invalid s3Path." };
  }
  if (/%[0-9a-fA-F]{2}/.test(s3Path) || s3Path.includes("%")) {
    return { error: "Invalid s3Path — encoded characters are not allowed." };
  }
  if (/[\u0000-\u001f\u007f\s\\]/.test(s3Path)) {
    return { error: "Invalid s3Path — illegal characters." };
  }
  if (!s3Path.startsWith("s3://") || s3Path.slice(5).includes("://")) {
    return { error: "Invalid s3Path — expected a single s3://bucket/key." };
  }
  const match = /^s3:\/\/([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])\/(.+)$/.exec(s3Path);
  if (!match) return { error: "Invalid s3Path — expected s3://bucket/key." };
  const bucket = match[1]!;
  const key = match[2]!;
  const region = Object.prototype.hasOwnProperty.call(
    DOCUMENT_BUCKET_REGIONS,
    bucket,
  )
    ? DOCUMENT_BUCKET_REGIONS[bucket]
    : undefined;
  if (!region) {
    return { error: `Bucket "${bucket}" is not an allowed document bucket.` };
  }
  if (
    key.length === 0 ||
    key.length > 1024 ||
    key.includes("..") ||
    key.startsWith("/") ||
    key.includes("//") ||
    key.includes("*") ||
    key.includes("\0")
  ) {
    return { error: "Invalid s3Path key." };
  }
  if (!ALLOWED_KEY.test(key)) {
    return { error: "Invalid s3Path key — expected a .pdf object key." };
  }
  return { bucket, key, region };
}

const s3Clients = new Map<string, S3Client>();
export function s3ClientForRegion(region: string): S3Client {
  let client = s3Clients.get(region);
  if (!client) {
    client = new S3Client({ region });
    s3Clients.set(region, client);
  }
  return client;
}

export class ArchiveDocNotFoundError extends Error {}
export class ArchiveDocTooLargeError extends Error {}
export class ArchiveDocFetchError extends Error {}
/** Thrown when the heavy-extraction gate is saturated — retryable, not a failure. */
export class ArchiveDocBusyError extends Error {}

let heavyInFlight = 0;
const heavyWaiters: Array<() => void> = [];

/**
 * Admission gate for heavy extractions. Returns a release function.
 *
 * Deliberately a plain counter rather than a job queue: the `archive_extracts`
 * cache means the heavy cost is paid once per judgment ever, so the steady-state
 * arrival rate is near zero and the only thing that needs handling is a burst
 * (or a scripted fan-out) arriving before the cache is warm.
 */
async function acquireHeavySlot(): Promise<() => void> {
  if (heavyInFlight < MAX_CONCURRENT_HEAVY_EXTRACTS) {
    heavyInFlight += 1;
    return releaseHeavySlot;
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = heavyWaiters.indexOf(waiter);
      if (index >= 0) heavyWaiters.splice(index, 1);
      reject(
        new ArchiveDocBusyError(
          "Another large judgment is still being extracted. This one is queued behind it — retry in about 30 seconds; the result is cached once extracted.",
        ),
      );
    }, HEAVY_QUEUE_WAIT_MS);
    const waiter = () => {
      clearTimeout(timer);
      resolve();
    };
    heavyWaiters.push(waiter);
  });
  heavyInFlight += 1;
  return releaseHeavySlot;
}

function releaseHeavySlot(): void {
  heavyInFlight = Math.max(0, heavyInFlight - 1);
  const next = heavyWaiters.shift();
  if (next) next();
}

async function headSize(
  bucket: string,
  key: string,
  region: string,
): Promise<number | null> {
  try {
    const out = await s3ClientForRegion(region).send(
      new HeadObjectCommand({ Bucket: bucket, Key: key }),
    );
    return out.ContentLength ?? 0;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey" || name === "404") {
      return null;
    }
    throw new ArchiveDocFetchError(
      `Failed to check the document in the archive: ${String(
        err instanceof Error ? err.message : err,
      )}`,
    );
  }
}

export interface ResolvedArchiveObject {
  bucket: string;
  key: string;
  region: string;
  byteSize: number;
  /** True when the sibling HC bucket resolved the object, not the requested one. */
  fallbackUsed: boolean;
}

/**
 * Resolve an allowlisted s3 path to the bucket that actually holds the object.
 * High Court paths fall back to the sibling HC bucket when the requested
 * bucket 404s (the HC estate is split across two identically-keyed buckets).
 */
export async function resolveArchiveObject(
  parsed: { bucket: string; key: string; region: string },
): Promise<ResolvedArchiveObject> {
  const size = await headSize(parsed.bucket, parsed.key, parsed.region);
  if (size !== null) {
    return { ...parsed, byteSize: size, fallbackUsed: false };
  }
  const sibling = HC_SIBLING_BUCKET[parsed.bucket];
  if (sibling) {
    const siblingRegion = DOCUMENT_BUCKET_REGIONS[sibling]!;
    const siblingSize = await headSize(sibling, parsed.key, siblingRegion);
    if (siblingSize !== null) {
      return {
        bucket: sibling,
        key: parsed.key,
        region: siblingRegion,
        byteSize: siblingSize,
        fallbackUsed: true,
      };
    }
  }
  throw new ArchiveDocNotFoundError(
    "This document was not found in the judgment archive.",
  );
}

export interface ArchiveExtractResult {
  /** Resolved s3://bucket/key that was actually fetched. */
  s3Path: string;
  requestedPath: string;
  title: string | null;
  byteSize: number;
  text: string;
  ocrUsed: boolean;
  cached: boolean;
  /** True when a page/time/char budget stopped the pass short of the whole PDF. */
  truncated: boolean;
}

/**
 * On-demand text extraction for an archived judgment PDF, with a DB cache so
 * repeat requests never re-download or re-OCR the same document.
 *
 * Large reporter-volume PDFs (see `MAX_ARCHIVE_PDF_BYTES`) go through the
 * heavy-extraction gate so a burst cannot put several hundred-MB extractions in
 * flight at once on a 2-vCPU worker.
 */
export async function extractArchiveText(args: {
  s3Path: string;
  title?: string | null;
  log?: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void };
}): Promise<ArchiveExtractResult> {
  const requestedPath = args.s3Path;
  const [cachedRow] = await db
    .select()
    .from(archiveExtractsTable)
    .where(eq(archiveExtractsTable.requestedPath, requestedPath));
  if (cachedRow) {
    return {
      s3Path: cachedRow.s3Path,
      requestedPath,
      title: args.title ?? cachedRow.title,
      byteSize: cachedRow.byteSize,
      text: cachedRow.textContent,
      ocrUsed: cachedRow.ocrUsed,
      cached: true,
      truncated: TRUNCATION_NOTE.test(cachedRow.textContent),
    };
  }

  const parsed = parseAllowedS3Path(requestedPath);
  if ("error" in parsed) throw new ArchiveDocNotFoundError(parsed.error);

  const resolved = await resolveArchiveObject(parsed);
  if (resolved.byteSize > MAX_ARCHIVE_PDF_BYTES) {
    throw new ArchiveDocTooLargeError(
      `This PDF is ${(resolved.byteSize / 1024 ** 2).toFixed(1)} MB, above the ${
        MAX_ARCHIVE_PDF_BYTES / 1024 ** 2
      } MB extraction limit.`,
    );
  }

  const heavy = resolved.byteSize > HEAVY_PDF_BYTES;
  const release = heavy ? await acquireHeavySlot() : null;
  const startedAt = Date.now();
  let text: string;
  let ocrUsed: boolean;
  try {
    let bytes: Buffer | null;
    try {
      const out = await s3ClientForRegion(resolved.region).send(
        new GetObjectCommand({ Bucket: resolved.bucket, Key: resolved.key }),
      );
      bytes = Buffer.from(await out.Body!.transformToByteArray());
    } catch (err) {
      throw new ArchiveDocFetchError(
        `Failed to download the document from the archive: ${String(
          err instanceof Error ? err.message : err,
        )}`,
      );
    }

    const filename = resolved.key.split("/").pop() ?? "document.pdf";
    const extracted = await extractDocumentText(filename, bytes);
    // Drop the reference before the (potentially multi-MB) text is copied and
    // written to Postgres, so peak RSS is not PDF + text simultaneously.
    bytes = null;
    ocrUsed = extracted.ocrUsed;
    text = normalizeExtractedText(extracted.text);
  } finally {
    release?.();
  }

  if (text.length > MAX_EXTRACT_TEXT_CHARS) {
    text =
      text.slice(0, MAX_EXTRACT_TEXT_CHARS) +
      `\n\n[Note: extracted text truncated at the ${MAX_EXTRACT_TEXT_CHARS.toLocaleString("en-US")}-character limit.]`;
  }
  if (!text || text.length < 10) {
    throw new OcrError(
      "No extractable text found in this document, even after OCR.",
    );
  }
  const truncated = TRUNCATION_NOTE.test(text);

  const resolvedPath = `s3://${resolved.bucket}/${resolved.key}`;
  await db
    .insert(archiveExtractsTable)
    .values({
      s3Path: resolvedPath,
      requestedPath,
      title: args.title ?? null,
      byteSize: resolved.byteSize,
      textContent: text,
      ocrUsed,
    })
    .onConflictDoNothing({ target: archiveExtractsTable.requestedPath });

  args.log?.info(
    {
      requestedPath,
      resolvedPath,
      byteSize: resolved.byteSize,
      textLength: text.length,
      ocrUsed,
      truncated,
      heavy,
      durationMs: Date.now() - startedAt,
      fallbackUsed: resolved.fallbackUsed,
    },
    "archive document extracted",
  );

  return {
    s3Path: resolvedPath,
    requestedPath,
    title: args.title ?? null,
    byteSize: resolved.byteSize,
    text,
    ocrUsed,
    cached: false,
    truncated,
  };
}

export { OcrError, UnsupportedFileError };
