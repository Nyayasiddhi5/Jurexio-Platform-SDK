/**
 * CNR corpus resolve API — POST /cnr/resolve, GET /cnr/:cnr, documents, enrich.
 * claimEcourts is false for corpus tiers; true when Tier-4 live opt-in succeeds.
 */
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  listCnrDocuments,
  resolveCnr,
  resolveDiary,
  upsertCnrCaseDetailsEnrichment,
  CnrUpstreamBusyError,
  type CnrResolveResult,
} from "../lib/cnrResolve";
import {
  resolveCnrViaNyvGateway,
  nyvCnrSsotEnabled,
  type NyvCnrProxyOptions,
} from "../lib/nv-cnr-gateway-proxy";
import { normalizeCnr, validateCnr } from "../lib/cnrNormalize";
import { getEcourtsLiveStatus } from "../lib/nv-ecourts-portal-fetch";
import { presignAllowedS3Path } from "./athena";

const router: IRouter = Router();

const ResolveBodySchema = z.object({
  cnr: z.string().optional(),
  cnrNumber: z.string().optional(),
  diaryNumber: z.string().optional(),
  diary: z.string().optional(),
  options: z
    .object({
      includeDocuments: z.boolean().optional(),
      includeExtractPreview: z.boolean().optional(),
      profile: z.enum(["default", "caseCreate"]).optional(),
      fuzzyLimit: z.number().int().min(1).max(10).optional(),
      jurisdiction: z.string().optional(),
      courtType: z.enum(["sc", "hc", "dc"]).optional(),
      /** Tier-4 live eCourts fallback after corpus miss (opt-in). */
      live: z.boolean().optional(),
    })
    .optional(),
});

type ResolveBody = z.infer<typeof ResolveBodySchema>;

function toProxyOptions(
  options: ResolveBody["options"],
  extra?: Partial<NyvCnrProxyOptions>,
): NyvCnrProxyOptions | undefined {
  if (!options && !extra) return extra;
  return {
    profile: options?.profile,
    includeDocuments: options?.includeDocuments,
    includeExtractPreview: options?.includeExtractPreview,
    fuzzyLimit: options?.fuzzyLimit,
    jurisdiction: options?.jurisdiction,
    courtType: options?.courtType,
    live: options?.live,
    includeParseGuide: extra?.includeParseGuide,
    includeTimeline: extra?.includeTimeline,
    ...extra,
  };
}

async function resolveCnrWithSsot(input: {
  cnr?: string;
  cnrNumber?: string;
  diaryNumber?: string;
  options?: NyvCnrProxyOptions;
  log?: { warn?: (obj: unknown, msg: string) => void };
}): Promise<CnrResolveResult> {
  if (nyvCnrSsotEnabled()) {
    try {
      const data = await resolveCnrViaNyvGateway({
        cnr: input.cnr ?? input.cnrNumber,
        diaryNumber: input.diaryNumber,
        options: input.options,
      });
      return data as unknown as CnrResolveResult;
    } catch (err) {
      if (err instanceof CnrUpstreamBusyError) throw err;
      input.log?.warn?.({ err: String(err) }, "NYV CNR SSOT fallback to local resolve");
    }
  }
  if (input.diaryNumber) {
    return resolveDiary({
      diaryNumber: input.diaryNumber,
      courtType: input.options?.courtType,
      includeDocuments: input.options?.includeDocuments,
      includeExtractPreview: input.options?.includeExtractPreview,
      profile: input.options?.profile,
      fuzzyLimit: input.options?.fuzzyLimit,
      live: input.options?.live,
    });
  }
  return resolveCnr({
    cnr: input.cnr,
    cnrNumber: input.cnrNumber,
    includeDocuments: input.options?.includeDocuments,
    includeExtractPreview: input.options?.includeExtractPreview,
    profile: input.options?.profile,
    fuzzyLimit: input.options?.fuzzyLimit,
    live: input.options?.live,
  });
}

router.get("/cnr/ecourts-status", (_req, res) => {
  res.json({ success: true, data: getEcourtsLiveStatus() });
});

router.post("/cnr/resolve", async (req, res) => {
  const parsed = ResolveBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "CNR_INVALID", message: parsed.error.issues[0]?.message ?? "Invalid body" },
    });
    return;
  }
  const rawCnr = parsed.data.cnr ?? parsed.data.cnrNumber ?? "";
  const rawDiary = parsed.data.diaryNumber ?? parsed.data.diary ?? "";
  if (!String(rawCnr).trim() && !String(rawDiary).trim()) {
    res.status(400).json({
      success: false,
      error: {
        code: "CNR_INVALID",
        message: "cnr, cnrNumber, diaryNumber, or diary is required",
      },
    });
    return;
  }
  try {
    const diary = String(rawDiary).trim()
      ? (parsed.data.diaryNumber ?? parsed.data.diary)
      : undefined;
    const data = await resolveCnrWithSsot({
      cnr: parsed.data.cnr,
      cnrNumber: parsed.data.cnrNumber,
      diaryNumber: diary,
      options: toProxyOptions(parsed.data.options),
      log: req.log,
    });
    if (data.status === "invalid") {
      res.status(400).json({
        success: false,
        error: { code: "CNR_INVALID", message: data.ui.subtitle },
        data,
      });
      return;
    }
    res.json({ success: true, data });
  } catch (err) {
    if (err instanceof CnrUpstreamBusyError) {
      res.status(503).json({
        success: false,
        error: {
          code: err.code,
          message: err.message,
          retryable: err.retryable,
        },
      });
      return;
    }
    req.log?.warn?.({ err: String(err) }, "cnr resolve failed");
    res.status(500).json({
      success: false,
      error: { code: "CNR_RESOLVE_FAILED", message: "CNR resolve failed" },
    });
  }
});

router.get("/cnr/:cnr", async (req, res) => {
  const cnr = normalizeCnr(req.params.cnr);
  const { validation } = validateCnr(cnr);
  if (validation === "invalid") {
    res.status(400).json({
      success: false,
      error: { code: "CNR_INVALID", message: "Invalid CNR" },
    });
    return;
  }
  try {
    const data = await resolveCnrWithSsot({
      cnr,
      options: toProxyOptions(undefined, {
        profile: "caseCreate",
        includeDocuments: true,
        includeParseGuide: true,
        includeTimeline: true,
      }),
      log: req.log,
    });
    res.json({ success: true, data });
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "cnr get failed");
    res.status(500).json({
      success: false,
      error: { code: "CNR_RESOLVE_FAILED", message: "CNR lookup failed" },
    });
  }
});

router.get("/cnr/:cnr/documents", async (req, res) => {
  const cnr = normalizeCnr(req.params.cnr);
  const { validation } = validateCnr(cnr);
  if (validation === "invalid") {
    res.status(400).json({
      success: false,
      error: { code: "CNR_INVALID", message: "Invalid CNR" },
    });
    return;
  }
  try {
    const { documents } = await listCnrDocuments(cnr);
    const withUrls = await Promise.all(
      documents.map(async (d) => {
        if (!d.s3Path) return { ...d, url: null };
        const signed = await presignAllowedS3Path(d.s3Path);
        if ("error" in signed) return { ...d, url: null };
        return { ...d, url: signed.url, expiresIn: signed.expiresIn };
      }),
    );
    res.json({
      success: true,
      data: {
        cnr,
        claimEcourts: false,
        documents: withUrls,
      },
    });
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "cnr documents failed");
    res.status(500).json({
      success: false,
      error: { code: "CNR_DOCS_FAILED", message: "Failed to list documents" },
    });
  }
});

const EnrichBody = z.object({
  cnr: z.string().min(10),
  petitioner: z.string().optional(),
  respondent: z.string().optional(),
  caseType: z.string().optional(),
  caseNo: z.string().optional(),
  courtCode: z.string().optional(),
  filingDate: z.string().optional(),
  decisionDate: z.string().optional(),
  caseStatus: z.string().optional(),
});

/** Lawyer / NSP write-through enrichment (non-PII judgment metadata). */
router.post("/cnr/enrich", async (req, res) => {
  const parsed = EnrichBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      success: false,
      error: { code: "CNR_INVALID", message: "Invalid enrichment body" },
    });
    return;
  }
  try {
    await upsertCnrCaseDetailsEnrichment({
      ...parsed.data,
      source: "lawyer_enrichment",
    });
    res.json({
      success: true,
      data: {
        cnr: normalizeCnr(parsed.data.cnr),
        claimEcourts: false,
        enriched: true,
      },
    });
  } catch (err) {
    req.log?.warn?.({ err: String(err) }, "cnr enrich failed");
    res.status(500).json({
      success: false,
      error: { code: "CNR_ENRICH_FAILED", message: "Enrichment failed" },
    });
  }
});

export default router;
