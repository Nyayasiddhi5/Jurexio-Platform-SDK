import { Router, type IRouter } from "express";
import { z } from "zod";
import { extractCitations } from "../lib/citations";
import { searchIndianCaselaw, searchUsCaselaw, UpstreamError, type CaselawDocOut } from "../lib/caselaw";
import { rdsBackendEnabled, searchRdsJudgments } from "../lib/rdsCaselaw";
import { planAndRetrieve } from "../lib/retrievalRouter";

const router: IRouter = Router();

const extractSchema = z.object({
  text: z.string().min(3),
  link: z.boolean().optional().default(true),
});

router.post("/citations/extract", async (req, res, next) => {
  try {
    const body = extractSchema.parse(req.body);
    const citations = extractCitations(body.text);

    const out = [];
    for (const c of citations) {
      let matches: CaselawDocOut[] = [];
      if (body.link) {
        if (c.jurisdiction === "IN") {
          const r = rdsBackendEnabled()
            ? await searchRdsJudgments({ q: c.normalized, limit: 3 })
            : await searchIndianCaselaw({ q: c.normalized, limit: 3 });
          matches = r.results;
        } else {
          try {
            matches = (await searchUsCaselaw({ q: c.normalized, limit: 3 })).results;
          } catch (err) {
            if (!(err instanceof UpstreamError)) throw err;
          }
        }
      }
      out.push({ ...c, matches });
    }

    req.log.info(
      { count: citations.length },
      "citation extraction (deterministic, no LLM)",
    );
    res.json({ total: out.length, citations: out });
  } catch (err) {
    next(err);
  }
});

const retrieveSchema = z.object({
  query: z.string().min(2),
  jurisdiction: z.enum(["IN", "US"]).optional(),
  limit: z.coerce.number().int().optional(),
});

router.post("/retrieve", async (req, res, next) => {
  try {
    const body = retrieveSchema.parse(req.body);
    const plan = await planAndRetrieve(body);
    req.log.info(
      {
        intent: plan.intent,
        llmRequired: plan.llmRequired,
        tools: plan.steps.map((s) => s.tool),
        reason: plan.reason,
      },
      "retrieval router decision",
    );
    res.json(plan);
  } catch (err) {
    next(err);
  }
});

export default router;
