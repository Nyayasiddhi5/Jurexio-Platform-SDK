/**
 * Tier-4 live eCourts fetch — NIC API when NYV_ECOURTS_API_KEY is set.
 * No portal scrape sidecar (NV-NO-DUPLICATE-001).
 */
import { logger } from "./logger";

const ECOURTS_BASE =
  process.env.NYV_ECOURTS_BASE_URL ??
  "https://services.ecourts.gov.in/ecourtindiaapi/api";

export const NYS_CNR_LIVE_FEATURE = "nys-cnr-live-tier4" as const;

const LIVE_BUDGET_MS = Number(process.env.NYS_CNR_LIVE_BUDGET_MS ?? "90000");

export type LiveEcourtsHit = {
  cnr: string;
  caseType: string | null;
  caseNo: string | null;
  filingDate: string | null;
  decisionDate: string | null;
  caseStatus: string | null;
  petitioner: string | null;
  respondent: string | null;
  petAdvocate: string | null;
  resAdvocate: string | null;
  courtName: string | null;
  nextHearingDate: string | null;
  actSection: string | null;
  hearings: Array<{
    date: string | null;
    purpose: string | null;
    judge: string | null;
    status: string | null;
  }>;
};

export type LiveEcourtsResult =
  | { ok: true; hit: LiveEcourtsHit }
  | { ok: false; code: "NOT_CONFIGURED" | "UPSTREAM_ERROR" | "NOT_FOUND" | "TIMEOUT"; message: string; retryable?: boolean };

export function isEcourtsLiveConfigured(): boolean {
  return Boolean(process.env.NYV_ECOURTS_API_KEY?.trim());
}

export function getEcourtsLiveStatus(): {
  feature: typeof NYS_CNR_LIVE_FEATURE;
  configured: boolean;
  budgetMs: number;
} {
  return {
    feature: NYS_CNR_LIVE_FEATURE,
    configured: isEcourtsLiveConfigured(),
    budgetMs: LIVE_BUDGET_MS,
  };
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "User-Agent": "Nyayasearch-NYS/1.0",
  };
}

function parseLiveHit(data: Record<string, unknown>, cnr: string): LiveEcourtsHit {
  const hearingHistory = Array.isArray(data.hearing_history)
    ? (data.hearing_history as Record<string, unknown>[])
    : [];
  return {
    cnr: String(data.cnr_number ?? cnr),
    caseType: str(data.case_type),
    caseNo: str(data.registration_number ?? data.filing_number),
    filingDate: str(data.filing_date ?? data.registration_date),
    decisionDate: str(data.disposal_date),
    caseStatus: str(data.case_status),
    petitioner: str(data.petitioner_name),
    respondent: str(data.respondent_name),
    petAdvocate: str(data.petitioner_advocate),
    resAdvocate: str(data.respondent_advocate),
    courtName: str(data.court_name),
    nextHearingDate: str(data.next_hearing_date),
    actSection: str(data.act_section),
    hearings: hearingHistory.map((h) => ({
      date: str(h.hearing_date),
      purpose: str(h.purpose),
      judge: str(h.judge_name ?? h.judge),
      status: str(h.business_on_date ?? h.next_date),
    })),
  };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Fetch live case status from NIC eCourts API (opt-in Tier-4). */
export async function fetchLiveEcourtsByCnr(
  cnrRaw: string,
  budgetMs = LIVE_BUDGET_MS,
): Promise<LiveEcourtsResult> {
  const apiKey = process.env.NYV_ECOURTS_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "NOT_CONFIGURED",
      message:
        "Live eCourts is not configured on this worker (NYV_ECOURTS_API_KEY absent). Corpus lookup remains available.",
    };
  }

  const cnr = cnrRaw.replace(/[\s-]/g, "").toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(5000, budgetMs));

  try {
    const res = await fetch(`${ECOURTS_BASE}/case_status_search`, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({ cnr_number: cnr }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn({ status: res.status, cnrLen: cnr.length }, "ecourts live upstream error");
      return {
        ok: false,
        code: "UPSTREAM_ERROR",
        message: `eCourts API returned HTTP ${res.status}${text ? " — retry later" : ""}`,
        retryable: res.status >= 500 || res.status === 429,
      };
    }

    const data = (await res.json()) as Record<string, unknown>;
    if (data.error || data.status === "error") {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: str(data.message) ?? "Case not found on live eCourts",
      };
    }

    const hit = parseLiveHit(data, cnr);
    if (!hit.petitioner && !hit.respondent && !hit.caseStatus) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "No case data returned from live eCourts for this CNR",
      };
    }

    return { ok: true, hit };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        code: "TIMEOUT",
        message: "Live eCourts lookup timed out — try again",
        retryable: true,
      };
    }
    logger.warn({ err: String(err) }, "ecourts live network error");
    return {
      ok: false,
      code: "UPSTREAM_ERROR",
      message: "Live eCourts network error — retry later",
      retryable: true,
    };
  } finally {
    clearTimeout(timer);
  }
}
