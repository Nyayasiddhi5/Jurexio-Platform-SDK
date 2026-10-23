import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  searchStatutes,
  listStatutes,
  listStatuteActs,
  hybridSearchStatutes,
  findSimilarStatutes,
  compareIpcToBns,
  compareOldToNew,
  compareNewToOld,
  getStatuteEmbeddingCoverage,
} from "../lib/statutes";

const router: IRouter = Router();

// Codes are open-ended now that the corpus carries the full India Code
// central-Acts library (slug codes like COMPANIES-ACT-2013) plus COI.
const codeSchema = z
  .string()
  .min(2)
  .max(80)
  .regex(/^[A-Za-z0-9-]+$/)
  .transform((s) => s.toUpperCase());

const searchSchema = z.object({
  q: z.string().min(2),
  code: codeSchema.optional(),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  limit: z.coerce.number().int().optional(),
});

router.get("/statutes/search", async (req, res, next) => {
  try {
    const query = searchSchema.parse(req.query);
    const { total, results, method, embeddingCoverage } =
      await searchStatutes(query);
    res.json({ total, results, method, embeddingCoverage });
  } catch (err) {
    next(err);
  }
});

/** Fast statute embedding coverage + SLO (ops / NYV health). */
router.get("/statutes/embedding/coverage", async (_req, res, next) => {
  try {
    const coverage = await getStatuteEmbeddingCoverage();
    const targetCoveragePct = Number(
      process.env.NYS_STATUTE_EMBED_SLO_PCT ?? "99",
    );
    const reasons: string[] = [];
    if (coverage.coveragePct < targetCoveragePct) {
      reasons.push(
        `coveragePct ${coverage.coveragePct} < target ${targetCoveragePct}`,
      );
    }
    const overallStatus =
      reasons.length === 0
        ? "ok"
        : coverage.coveragePct < targetCoveragePct * 0.9
          ? "critical"
          : "degraded";
    res.json({
      ...coverage,
      slo: {
        targetCoveragePct,
        overallStatus,
        reasons,
      },
      cachedAt: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

const hybridSchema = z.object({
  q: z.string().min(2),
  code: codeSchema.optional(),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  practiceArea: z.string().min(1).optional(),
  limit: z.coerce.number().int().optional(),
});

router.get("/statutes/retrieve", async (req, res, next) => {
  try {
    const query = hybridSchema.parse(req.query);
    const result = await hybridSearchStatutes(query);
    req.log.info(
      { q: query.q, method: result.method, total: result.total },
      "hybrid statute retrieval (FTS + vector, RRF)",
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const similarParams = z.object({ id: z.coerce.number().int().positive() });
const similarQuery = z.object({ limit: z.coerce.number().int().optional() });

router.get("/statutes/:id/similar", async (req, res, next) => {
  try {
    const { id } = similarParams.parse(req.params);
    const { limit } = similarQuery.parse(req.query);
    const result = await findSimilarStatutes(
      id,
      Math.min(Math.max(limit ?? 5, 1), 20),
    );
    if (!result) {
      res.status(404).json({ error: `Statute ${id} not found.` });
      return;
    }
    req.log.info(
      { id, method: result.method, count: result.results.length },
      "similar-provision lookup",
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const listSchema = z.object({
  code: codeSchema.optional(),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  limit: z.coerce.number().int().optional(),
});

const actsSchema = z.object({
  practiceArea: z.string().min(1).optional(),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().optional(),
});

router.get("/statutes/acts", async (req, res, next) => {
  try {
    const query = actsSchema.parse(req.query);
    res.json(await listStatuteActs(query));
  } catch (err) {
    next(err);
  }
});

router.get("/statutes", async (req, res, next) => {
  try {
    const query = listSchema.parse(req.query);
    const { total, results } = await listStatutes(query);
    res.json({ total, results });
  } catch (err) {
    next(err);
  }
});

router.get("/statutes/compare/ipc-bns", async (req, res, next) => {
  try {
    const { section } = z
      .object({ section: z.string().min(1) })
      .parse(req.query);
    const comparison = await compareIpcToBns(section);
    if (!comparison.found) {
      res.status(404).json({
        error: `IPC Section ${section} is not in the corpus. The corpus covers the full official IPC-to-BNS mapping table (NCRB Sankalan).`,
      });
      return;
    }
    res.json(comparison);
  } catch (err) {
    next(err);
  }
});

router.get("/statutes/compare/old-new", async (req, res, next) => {
  try {
    const { from, section } = z
      .object({
        from: z.string().min(2).transform((raw) => {
          const u = raw.replace(/\./g, "").toUpperCase().replace(/\s+/g, "");
          if (u === "IEA" || u.includes("EVIDENCE")) return "IEA";
          if (u === "CRPC" || u === "IRPC" || u.includes("CRIMINAL")) return "CrPC";
          if (raw === "CrPC" || raw === "IEA") return raw;
          return raw;
        }).pipe(z.enum(["CrPC", "IEA"])),
        section: z.string().min(1),
      })
      .parse(req.query);
    const comparison = await compareOldToNew(from, section);
    if (!comparison.found) {
      const label = from === "CrPC" ? "CrPC 1973" : "Indian Evidence Act 1872";
      res.status(404).json({
        error: `${label} Section ${section} has no ${comparison.newCode} mapping in the corpus. The corpus covers the full official NCRB Sankalan mapping tables.`,
      });
      return;
    }
    res.json(comparison);
  } catch (err) {
    next(err);
  }
});

router.get("/statutes/compare/new-old", async (req, res, next) => {
  try {
    const { from, section } = z
      .object({
        from: z.enum(["BNSS", "BSA", "BNS"]),
        section: z.string().min(1),
      })
      .parse(req.query);
    const comparison = await compareNewToOld(from, section);
    if (!comparison.found) {
      const label =
        from === "BNSS"
          ? "BNSS"
          : from === "BSA"
            ? "BSA"
            : "BNS";
      res.status(404).json({
        error: `${label} Section ${section} has no ${comparison.oldCode || "old-code"} mapping in the corpus. The corpus covers the full official NCRB Sankalan mapping tables.`,
      });
      return;
    }
    res.json(comparison);
  } catch (err) {
    next(err);
  }
});

export default router;
