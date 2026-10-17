import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  StopQueryExecutionCommand,
} from "@aws-sdk/client-athena";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import {
  parseAllowedS3Path,
  resolveArchiveObject,
  extractArchiveText,
  s3ClientForRegion,
  ArchiveDocNotFoundError,
  ArchiveDocTooLargeError,
  ArchiveDocBusyError,
  ArchiveDocFetchError,
  OcrError,
  UnsupportedFileError,
} from "../lib/archiveDocs";
import { parseJudgmentStructure } from "../lib/judgmentStructure";

const router: IRouter = Router();

const PRESIGN_TTL_SECONDS = 300;

const AthenaDocumentQuery = z.object({
  s3Path: z
    .string()
    .min(6)
    .max(1024)
    .regex(/^s3:\/\//, "s3Path must start with s3://"),
});

export { parseAllowedS3Path };

/**
 * Presign an allowlisted s3://bucket/key judgment PDF for GET. Shared by the
 * Athena archive endpoint and the caselaw pdf-url endpoint.
 */
export async function presignAllowedS3Path(
  s3Path: string,
): Promise<{ url: string; expiresIn: number } | { error: string }> {
  const parsed = parseAllowedS3Path(s3Path);
  if ("error" in parsed) return parsed;
  const url = await getSignedUrl(
    s3ClientForRegion(parsed.region),
    new GetObjectCommand({ Bucket: parsed.bucket, Key: parsed.key }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  return { url, expiresIn: PRESIGN_TTL_SECONDS };
}

router.get("/athena/document", async (req, res) => {
  const parsedQuery = AthenaDocumentQuery.safeParse(req.query);
  if (!parsedQuery.success) {
    res.status(400).json({
      error: parsedQuery.error.issues[0]?.message ?? "Invalid s3Path parameter.",
    });
    return;
  }
  const parsed = parseAllowedS3Path(parsedQuery.data.s3Path);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    // Resolve to the bucket that actually holds the object (the HC PDF estate
    // is split across two identically-keyed buckets) so the presigned URL
    // never 404s for a document that exists in the sibling bucket.
    const resolved = await resolveArchiveObject(parsed);
    const url = await getSignedUrl(
      s3ClientForRegion(resolved.region),
      new GetObjectCommand({ Bucket: resolved.bucket, Key: resolved.key }),
      { expiresIn: PRESIGN_TTL_SECONDS },
    );
    req.log.info(
      { bucket: resolved.bucket, key: resolved.key, fallbackUsed: resolved.fallbackUsed },
      "presigned document url issued",
    );
    res.json({
      url,
      bucket: resolved.bucket,
      key: resolved.key,
      expiresIn: PRESIGN_TTL_SECONDS,
    });
  } catch (err) {
    if (err instanceof ArchiveDocNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    req.log.warn(
      { bucket: parsed.bucket, key: parsed.key, err: String(err) },
      "failed to presign document url",
    );
    res.status(502).json({ error: "Failed to generate a document link. Try again shortly." });
  }
});

const AthenaExtractBody = z.object({
  s3Path: z
    .string()
    .min(6)
    .max(1024)
    .regex(/^s3:\/\//, "s3Path must start with s3://"),
  title: z.string().max(500).optional(),
  /**
   * Return `paras[]` and the extractable structured fields alongside the text
   * (NYS-JUDGMENT-STRUCTURE-001).
   *
   * Opt-in, and parsed per request over the cached text rather than stored in
   * `archive_extracts`. Parsing 2.88 M chars costs ~40 ms measured against a
   * ~2.7 s cold extract, so pre-computing wins almost nothing, while writing a
   * parsed payload into the cache would change a stored shape that already has
   * live rows and pin every future parser improvement behind a cache migration.
   */
  structure: z.coerce.boolean().optional(),
});

/**
 * On-demand PDF → text extraction for an archived judgment (cached, size- and
 * page-capped, OCR fallback for scanned files). Auth-gated in production via
 * the standard /api session guard.
 *
 * Supreme Court PDFs are whole reporter-volume extracts, so a landmark judgment
 * can be tens of MB and a thousand pages. Those take seconds, not milliseconds,
 * and are admitted through a concurrency gate — a saturated gate returns 503
 * with Retry-After rather than letting the request hang past the caller timeout.
 */
router.post("/athena/extract", async (req, res) => {
  const body = AthenaExtractBody.parse(req.body);
  const parsed = parseAllowedS3Path(body.s3Path);
  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }
  try {
    const result = await extractArchiveText({
      s3Path: body.s3Path,
      title: body.title ?? null,
      log: req.log,
    });
    res.json({
      s3Path: result.s3Path,
      requestedPath: result.requestedPath,
      title: result.title,
      byteSize: result.byteSize,
      textLength: result.text.length,
      text: result.text,
      ocrUsed: result.ocrUsed,
      cached: result.cached,
      truncated: result.truncated,
      ...(body.structure
        ? (() => {
            const structure = parseJudgmentStructure(result.text);
            return {
              structure,
              parasMeta: {
                numbering: structure.numbering,
                paragraphCount: structure.paras.length,
                parasUnavailableReason:
                  structure.numbering === 'preserved' ? null : structure.numberingNote,
              },
            };
          })()
        : {}),
    });
  } catch (err) {
    if (err instanceof ArchiveDocNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof ArchiveDocTooLargeError) {
      res.status(413).json({ error: err.message });
      return;
    }
    if (err instanceof ArchiveDocBusyError) {
      req.log.warn({ s3Path: body.s3Path }, "archive extraction gate saturated");
      res.status(503).set("Retry-After", "30").json({ error: err.message });
      return;
    }
    if (err instanceof UnsupportedFileError) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err instanceof OcrError) {
      req.log.warn({ s3Path: body.s3Path, err: String(err) }, "archive OCR failed");
      res.status(422).json({ error: err.message });
      return;
    }
    if (err instanceof ArchiveDocFetchError) {
      req.log.warn({ s3Path: body.s3Path, err: String(err) }, "archive fetch failed");
      res.status(502).json({ error: err.message });
      return;
    }
    req.log.warn({ s3Path: body.s3Path, err: String(err) }, "archive extraction failed");
    res.status(500).json({ error: "Failed to extract text from this document." });
  }
});

/**
 * Athena-backed document search over the owned S3 judgment buckets.
 * Requires external tables to be defined (see docs/Athena-Document-Search.md)
 * and the following env vars on the worker:
 *   ATHENA_DATABASE          — Glue/Athena database name (e.g. nyv_docs)
 *   ATHENA_TABLE             — table over the SC judgment metadata (e.g. judgments_meta)
 *   ATHENA_TABLE_HC          — optional table over the High Court judgment metadata
 *   ATHENA_OUTPUT_S3         — s3://bucket/prefix for query results
 *   ATHENA_WORKGROUP         — optional workgroup (default "primary")
 *   ATHENA_REGION            — optional (defaults to BEDROCK_REGION or ap-south-1)
 *   ATHENA_MAX_SCAN_BYTES    — optional per-query scan cap (default 5 GB)
 */
function athenaConfig() {
  const database = process.env.ATHENA_DATABASE;
  const table = process.env.ATHENA_TABLE;
  const output = process.env.ATHENA_OUTPUT_S3;
  if (!database || !table || !output) return null;
  return {
    database,
    table,
    hcTable: process.env.ATHENA_TABLE_HC || null,
    output,
    workgroup: process.env.ATHENA_WORKGROUP ?? "primary",
    region:
      process.env.ATHENA_REGION ?? process.env.BEDROCK_REGION ?? "ap-south-1",
    maxScanBytes: Number(process.env.ATHENA_MAX_SCAN_BYTES) || 5 * 1024 ** 3,
  };
}

router.get("/athena/status", (_req, res) => {
  const cfg = athenaConfig();
  res.json({
    configured: cfg !== null,
    database: cfg?.database ?? null,
    table: cfg?.table ?? null,
    hcTable: cfg?.hcTable ?? null,
    workgroup: cfg?.workgroup ?? null,
    maxScanBytes: cfg?.maxScanBytes ?? null,
  });
});

const AthenaSearchBody = z.object({
  q: z.string().min(2).max(200),
  year: z.number().int().min(1900).max(2100).optional(),
  court: z.string().max(100).optional(),
  /**
   * Archive scope:
   *  - "sc" — Supreme Court only (default — avoids multi-GB HC scans)
   *  - "hc" — High Courts only
   *  - "all" — SC ∪ HC (expensive; prefer with year filter)
   */
  archive: z.enum(["sc", "hc", "all"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

const POLL_INTERVAL_MS = 750;
const MAX_WAIT_MS = 45_000;

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Build the per-table SELECT. Both tables expose the same output columns:
 * title, court, year, citation, decision_date, s3_path, archive.
 * Year filter prunes partition-friendly column scans when year= is present.
 */
function buildSelect(
  database: string,
  table: string,
  archive: "sc" | "hc",
  body: { q: string; year?: number; court?: string },
  limit: number,
): string {
  const conditions = [
    `(lower(title) LIKE lower(${sqlLiteral(`%${body.q}%`)}) OR lower(coalesce(description, '')) LIKE lower(${sqlLiteral(`%${body.q}%`)}))`,
  ];
  if (body.year !== undefined) conditions.push(`year = ${body.year}`);
  if (body.court)
    conditions.push(`lower(court) LIKE lower(${sqlLiteral(`%${body.court}%`)})`);
  return `SELECT title, court, year, citation, decision_date, s3_path, '${archive}' AS archive FROM "${database}"."${table}" WHERE ${conditions.join(" AND ")} LIMIT ${limit}`;
}

/** Cancel a running Athena query so a rejected request stops accruing scan cost. */
async function stopQuery(
  client: AthenaClient,
  queryExecutionId: string,
  log: { warn: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void },
  reason: string,
): Promise<void> {
  try {
    await client.send(new StopQueryExecutionCommand({ QueryExecutionId: queryExecutionId }));
    log.info({ queryExecutionId, reason }, "athena query stopped");
  } catch (err) {
    log.warn({ queryExecutionId, reason, err: String(err) }, "failed to stop athena query");
  }
}

router.post("/athena/search", async (req, res) => {
  const cfg = athenaConfig();
  if (!cfg) {
    res.status(503).json({
      error:
        "Athena document search is not configured on this server. Set ATHENA_DATABASE, ATHENA_TABLE, and ATHENA_OUTPUT_S3 (see docs/Athena-Document-Search.md).",
    });
    return;
  }
  const body = AthenaSearchBody.parse(req.body);
  const limit = body.limit ?? 20;
  // SC-first default: omit archive → SC only (avoids ~1.4GB HC metadata scans).
  const archiveScope = body.archive ?? "sc";

  const selects: string[] = [];
  if (archiveScope === "sc" || archiveScope === "all") {
    selects.push(buildSelect(cfg.database, cfg.table, "sc", body, limit));
  }
  if (archiveScope === "hc" || archiveScope === "all") {
    if (!cfg.hcTable) {
      if (archiveScope === "hc") {
        res.status(503).json({
          error:
            "The High Court archive table is not configured on this server (ATHENA_TABLE_HC).",
        });
        return;
      }
    } else {
      selects.push(buildSelect(cfg.database, cfg.hcTable, "hc", body, limit));
    }
  }
  if (selects.length === 0) {
    res.status(503).json({
      error:
        "No archive tables available for this search scope.",
    });
    return;
  }
  const query =
    selects.length === 1
      ? selects[0]!
      : `SELECT * FROM ((${selects[0]}) UNION ALL (${selects[1]})) LIMIT ${limit}`;

  const client = new AthenaClient({ region: cfg.region });
  const start = await client.send(
    new StartQueryExecutionCommand({
      QueryString: query,
      QueryExecutionContext: { Database: cfg.database },
      ResultConfiguration: { OutputLocation: cfg.output },
      WorkGroup: cfg.workgroup,
    }),
  );
  const queryExecutionId = start.QueryExecutionId;
  if (!queryExecutionId) {
    res.status(502).json({ error: "Athena did not return a query execution id." });
    return;
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  let bytesScanned = 0;
  for (;;) {
    const exec = await client.send(
      new GetQueryExecutionCommand({ QueryExecutionId: queryExecutionId }),
    );
    const state = exec.QueryExecution?.Status?.State;
    bytesScanned = exec.QueryExecution?.Statistics?.DataScannedInBytes ?? 0;
    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELLED") {
      res.status(502).json({
        error: `Athena query ${state?.toLowerCase()}: ${exec.QueryExecution?.Status?.StateChangeReason ?? "unknown reason"}`,
      });
      return;
    }
    if (bytesScanned > cfg.maxScanBytes) {
      await stopQuery(client, queryExecutionId, req.log, "scan budget exceeded");
      res.status(413).json({
        error: `Query exceeded the scan budget (${Math.round(cfg.maxScanBytes / 1024 ** 3)} GB). Narrow the search with a year or court filter.`,
      });
      return;
    }
    if (Date.now() > deadline) {
      await stopQuery(client, queryExecutionId, req.log, "timeout");
      res.status(504).json({ error: "Athena query timed out after 45s." });
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const results = await client.send(
    new GetQueryResultsCommand({
      QueryExecutionId: queryExecutionId,
      MaxResults: limit + 1,
    }),
  );
  const rows = results.ResultSet?.Rows ?? [];
  const [header, ...dataRows] = rows;
  const columns = (header?.Data ?? []).map((d) => d.VarCharValue ?? "");
  const items = dataRows.map((r) => {
    const obj: Record<string, string | null> = {};
    (r.Data ?? []).forEach((d, i) => {
      obj[columns[i] ?? `col${i}`] = d.VarCharValue ?? null;
    });
    return obj;
  });

  req.log.info(
    { queryExecutionId, bytesScanned, resultCount: items.length },
    "athena search completed",
  );
  res.json({
    query: body.q,
    results: items,
    bytesScanned,
    estimatedCostUsd: Number(((bytesScanned / 1024 ** 4) * 5).toFixed(6)),
  });
});

export default router;
