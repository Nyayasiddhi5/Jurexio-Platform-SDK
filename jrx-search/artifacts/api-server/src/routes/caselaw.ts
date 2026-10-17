import { Router, type IRouter } from "express";
import { z } from "zod";
import { db, caselawDocumentsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  searchIndianCaselaw,
  searchUsCaselaw,
  getCaselawDocById,
  UpstreamError,
  CorpusBusyError,
} from "../lib/caselaw";
import {
  rdsBackendEnabled,
  searchRdsJudgments,
  searchRdsJudgmentsHybrid,
  getRdsJudgmentById,
  getRdsPdfTarget,
  rdsEmbeddingProgress,
  rdsStats,
  getCaselawEmbeddingCoverage,
  CASELAW_FILTER_SUPPORT,
  CASELAW_SEARCH_SLO,
  STATUTES_SEARCH_SLO,
} from "../lib/rdsCaselaw";
import { classifyInfraError } from "../lib/sanitizeInfraError";
import { presignAllowedS3Path } from "./athena";

const router: IRouter = Router();

/** Map RDS/S3/AWS failures to safe client envelopes (never raw PG/AWS text). */
function sendInfraOrNext(
  err: unknown,
  res: import("express").Response,
  next: import("express").NextFunction,
): void {
  const infra = classifyInfraError(err);
  if (infra) {
    res.status(infra.status).json({
      error: infra.message,
      retryable: infra.retryable,
      errorDetail: { code: infra.code, message: infra.message },
    });
    return;
  }
  next(err);
}

const LIVE_JURISDICTIONS = ["IN", "US"] as const;
const RESERVED_JURISDICTIONS = ["GCC", "UK", "EU", "SG"] as const;

const searchQuerySchema = z.object({
  jurisdiction: z.enum([...LIVE_JURISDICTIONS, ...RESERVED_JURISDICTIONS]),
  q: z.string().min(2),
  year: z.coerce.number().int().optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  judge: z.string().min(2).max(200).optional(),
  reporter: z.string().min(2).max(120).optional(),
  benchStrength: z.enum(["single", "division"]).optional(),
  court: z.string().optional(),
  courtType: z.enum(["sc", "hc"]).optional(),
  limit: z.coerce.number().int().optional(),
  /**
   * NYS-CASELAW-SEARCH-FILTERS-001 — result offset for pagination.
   *
   * Capped at 10,000 in the query layer. Deep offsets on a 26.26M-row FTS match
   * would require ranking a candidate window at least `offset + limit` deep, and
   * the I/O for that window is the entire cause of the bare-numeric latency
   * defect, so the cap is a latency guarantee rather than an arbitrary limit.
   */
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["relevance", "date"]).optional(),
  /** hybrid (default) = FTS + vector RRF; fts = keyword-only */
  mode: z.enum(["hybrid", "fts"]).optional(),
});

router.get("/caselaw/search", async (req, res, next) => {
  try {
    const query = searchQuerySchema.parse(req.query);
    if (
      (RESERVED_JURISDICTIONS as readonly string[]).includes(query.jurisdiction)
    ) {
      res.json({
        jurisdiction: query.jurisdiction,
        total: 0,
        results: [],
        comingSoon: true,
        message: `${query.jurisdiction} caselaw coverage is coming soon. IN and US are live today.`,
      });
      return;
    }
    if (query.jurisdiction === "IN") {
      if (rdsBackendEnabled()) {
        const {
          total,
          totalCapped,
          totalIsLowerBound,
          countCap,
          offset,
          limit,
          results,
          method,
          embeddingCoverage,
          message,
          degraded,
          degradedReason,
          fallbackMode,
        } = await searchRdsJudgmentsHybrid({
          q: query.q,
          courtType: query.courtType,
          year: query.year,
          yearFrom: query.yearFrom,
          yearTo: query.yearTo,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          judge: query.judge,
          reporter: query.reporter,
          benchStrength: query.benchStrength,
          court: query.court,
          limit: query.limit,
          offset: query.offset,
          sort: query.sort,
          mode: query.mode ?? "hybrid",
        });
        res.json({
          jurisdiction: "IN",
          total,
          totalCapped,
          totalIsLowerBound,
          countCap,
          offset,
          limit,
          results,
          method,
          sort: query.sort ?? "relevance",
          filterSupport: CASELAW_FILTER_SUPPORT,
          slo: CASELAW_SEARCH_SLO,
          ...(embeddingCoverage ? { embeddingCoverage } : {}),
          ...(message ? { message } : {}),
          ...(degraded ? { degraded, degradedReason, fallbackMode } : {}),
        });
        return;
      }
      const { total, results, message } = await searchIndianCaselaw({
        q: query.q,
        year: query.year,
        limit: query.limit,
      });
      res.json({
        jurisdiction: "IN",
        total,
        totalCapped: false,
        results,
        ...(message ? { message } : {}),
      });
    } else {
      const { total, results } = await searchUsCaselaw({
        q: query.q,
        court: query.court,
        limit: query.limit,
      });
      res.json({ jurisdiction: "US", total, results });
    }
  } catch (err) {
    if (err instanceof CorpusBusyError) {
      res.status(503).json({ error: err.message, retryable: true });
      return;
    }
    if (err instanceof UpstreamError) {
      res.status(502).json({ error: err.message });
      return;
    }
    sendInfraOrNext(err, res, next);
  }
});

router.get("/caselaw/documents/:id", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const doc = rdsBackendEnabled()
      ? await getRdsJudgmentById(id)
      : await getCaselawDocById(id);
    if (!doc) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

/**
 * Resolve a working PDF URL for a judgment on demand:
 *  - absolute pdf_link → returned as-is;
 *  - SC owned-bucket s3:// paths → presigned (allowlisted buckets only);
 *  - HC ecourts-relative pdf_link → public HC Open Data bucket URL,
 *    existence-checked with a HEAD so the UI never gets a dead link.
 */
router.get("/caselaw/documents/:id/pdf-url", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    if (!rdsBackendEnabled()) {
      const doc = await getCaselawDocById(id);
      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }
      const link = doc.pdfLink ?? doc.url;
      if (link && /^https?:\/\//i.test(link)) {
        res.json({ url: link, kind: "absolute", expiresIn: null });
        return;
      }
      res.status(404).json({ error: "No PDF available for this document" });
      return;
    }
    const target = await getRdsPdfTarget(id);
    if (!target) {
      res.status(404).json({ error: "No PDF available for this document" });
      return;
    }
    if (target.kind === "absolute") {
      res.json({ url: target.url, kind: "absolute", expiresIn: null });
      return;
    }
    if (target.kind === "presign") {
      const signed = await presignAllowedS3Path(target.s3Path);
      if ("error" in signed) {
        req.log.warn({ id, err: signed.error }, "pdf presign rejected");
        res.status(404).json({ error: "No PDF available for this document" });
        return;
      }
      res.json({ url: signed.url, kind: "presigned", expiresIn: signed.expiresIn });
      return;
    }
    // Public bucket URL — HEAD-check so we never hand out a dead link
    // (some source rows are flagged pdf_exists=false upstream).
    const head = await fetch(target.url, { method: "HEAD" }).catch(() => null);
    if (!head || !head.ok) {
      req.log.info({ id, status: head?.status }, "pdf missing in public bucket");
      res.status(404).json({ error: "The source PDF for this judgment is not available" });
      return;
    }
    res.json({ url: target.url, kind: "public", expiresIn: null });
  } catch (err) {
    next(err);
  }
});

router.get("/caselaw/documents/:id/similar", async (req, res, next) => {
  try {
    const id = z.coerce.number().int().parse(req.params.id);
    const limit = z.coerce.number().int().min(1).max(20).optional().parse(req.query.limit) ?? 5;
    const { findSimilarCases } = await import("../lib/similarCases");
    const result = await findSimilarCases(id, limit);
    if (!result) {
      res.status(404).json({ error: "Document not found" });
      return;
    }
    req.log.info(
      { id, method: result.method, provider: result.provider },
      "similar cases retrieval",
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const verifyBodySchema = z.object({
  citation: z.string().min(3),
  jurisdiction: z.enum(["IN", "US", "ALL"]).optional().default("ALL"),
});

/**
 * Indian corpus titles use "versus"; attorneys type "v." / "vs." — normalize
 * standalone v/vs tokens so FTS matches (e.g. "State v. Balchand").
 */
function normalizeInCitationQuery(q: string): string {
  return q.replace(/\b(?:vs?|versus)\.?(?=\s)/gi, "versus");
}

router.post("/caselaw/verify-citation", async (req, res, next) => {
  try {
    const body = verifyBodySchema.parse(req.body);
    const matches: Awaited<
      ReturnType<typeof searchIndianCaselaw>
    >["results"] = [];
    let usUnavailable = false;

    if (body.jurisdiction === "IN" || body.jurisdiction === "ALL") {
      const inRes = rdsBackendEnabled()
        ? await searchRdsJudgments({
            q: normalizeInCitationQuery(body.citation),
            limit: 5,
          })
        : await searchIndianCaselaw({
            q: normalizeInCitationQuery(body.citation),
            limit: 5,
          });
      matches.push(...inRes.results);
    }
    if (body.jurisdiction === "US" || body.jurisdiction === "ALL") {
      try {
        const usRes = await searchUsCaselaw({ q: body.citation, limit: 5 });
        matches.push(...usRes.results);
      } catch (err) {
        if (err instanceof UpstreamError) {
          usUnavailable = true;
        } else {
          throw err;
        }
      }
    }

    const status =
      matches.length > 0 ? "verified" : usUnavailable ? "uncertain" : "not_found";
    const note =
      matches.length > 0
        ? `Matched ${matches.length} real document(s) in connected legal databases.`
        : usUnavailable
          ? "No match in the local Indian corpus; the US live source was unavailable, so this citation could not be fully checked."
          : "No matching document found in connected legal databases. Treat this citation as unverified.";

    res.json({ status, note, matches });
  } catch (err) {
    sendInfraOrNext(err, res, next);
  }
});

router.get("/caselaw/embedding/coverage", async (_req, res, next) => {
  try {
    if (!rdsBackendEnabled()) {
      res.json({
        backend: "local",
        total: 0,
        embedded: 0,
        unembedded: 0,
        coveragePct: 100,
        approx: true,
        scopes: [],
        slo: {
          targetCoveragePct: 99,
          maxStalenessHours: 168,
          overallStatus: "unknown",
          reasons: ["rds_backend_off"],
        },
        cachedAt: new Date().toISOString(),
      });
      return;
    }
    const coverage = await getCaselawEmbeddingCoverage();
    res.json({ backend: "rds", ...coverage });
  } catch (err) {
    next(err);
  }
});

/**
 * NYS-SEARCH-SLO-001 — the published latency contract for both search surfaces.
 *
 * A separate endpoint, not just a field on a search response, because a partner
 * sizing timeouts should not have to issue a (potentially slow) search to
 * discover how long a search is allowed to take.
 */
router.get("/search/slo", (_req, res) => {
  res.json({
    measuredAt: "2026-08-20",
    caselaw: CASELAW_SEARCH_SLO,
    statutes: STATUTES_SEARCH_SLO,
  });
});

router.get("/caselaw/stats", async (_req, res, next) => {
  try {
    // TTL cache — rdsEmbeddingProgress + US probe are expensive; Console/NYV poll often.
    const now = Date.now();
    const cached = (router as unknown as { __statsCache?: { at: number; body: unknown } }).__statsCache;
    if (cached && now - cached.at < 60_000) {
      res.setHeader("X-NYS-Stats-Cache", "HIT");
      res.json(cached.body);
      return;
    }

    if (rdsBackendEnabled()) {
      const sources = await rdsStats();
      const totalDocuments = sources.reduce(
        (s, r) => s + r.documentCount,
        0,
      );
      // Skip live US probe on hot path — was adding multi-second latency to every stats call.
      const usLive = true; // CourtListener configured in prod; probe reserved for /caselaw/search?jurisdiction=US
      const embedding = await rdsEmbeddingProgress();
      const embeddingCoverage = await getCaselawEmbeddingCoverage();
      const body = {
        totalDocuments,
        sources,
        usLive,
        backend: "rds",
        embedding,
        embeddingCoverage,
        cachedAt: new Date().toISOString(),
      };
      (router as unknown as { __statsCache?: { at: number; body: unknown } }).__statsCache = { at: now, body };
      res.setHeader("X-NYS-Stats-Cache", "MISS");
      res.json(body);
      return;
    }
    const rows = (await db
      .select({
        source: caselawDocumentsTable.source,
        jurisdiction: caselawDocumentsTable.jurisdiction,
        documentCount: sql<number>`count(*)::int`,
        minYear: sql<number | null>`min(${caselawDocumentsTable.year})`,
        maxYear: sql<number | null>`max(${caselawDocumentsTable.year})`,
      })
      .from(caselawDocumentsTable)
      .groupBy(
        caselawDocumentsTable.source,
        caselawDocumentsTable.jurisdiction,
      )) as Array<{
      source: string;
      jurisdiction: string;
      documentCount: number;
      minYear: number | null;
      maxYear: number | null;
    }>;

    const totalDocuments = rows.reduce((s, r) => s + r.documentCount, 0);

    const body = { totalDocuments, sources: rows, usLive: false, backend: "local", cachedAt: new Date().toISOString() };
    (router as unknown as { __statsCache?: { at: number; body: unknown } }).__statsCache = { at: now, body };
    res.setHeader("X-NYS-Stats-Cache", "MISS");
    res.json(body);
  } catch (err) {
    next(err);
  }
});

export default router;
