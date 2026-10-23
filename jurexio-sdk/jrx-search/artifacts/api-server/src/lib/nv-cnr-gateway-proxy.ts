/**
 * NV-NYS-CNR-SSOT-001 — NyayaSearch CNR resolve via NYV SDK (56-key envelope).
 * When NYV_API_BASE_URL + server SDK key are set, worker CNR routes proxy to
 * POST /api/nv/v1/sdk/cnr/resolve instead of the legacy ~16-field local builder.
 */
import { logger } from "./logger";
import { nyvGatewayConfigured, nyvGatewayFetch } from "./nyvGatewayClient";
import { CnrUpstreamBusyError } from "./cnrResolve";

export type NyvCnrProxyOptions = {
  profile?: "default" | "caseCreate";
  includeDocuments?: boolean;
  includeExtractPreview?: boolean;
  includeTimeline?: boolean;
  includeParseGuide?: boolean;
  fuzzyLimit?: number;
  jurisdiction?: string;
  courtType?: "sc" | "hc" | "dc";
  live?: boolean;
};

type NyvResolveBody = {
  identifier?: string;
  cnr?: string;
  cnrNumber?: string;
  diaryNumber?: string;
  diary?: string;
  options?: NyvCnrProxyOptions;
};

function timeoutForProfile(profile?: string, live?: boolean): number {
  if (live) return Number(process.env.NYV_CNR_LIVE_TIMEOUT_MS ?? "120000");
  if (profile === "caseCreate") {
    return Number(process.env.NYV_CNR_DEEP_TIMEOUT_MS ?? "90000");
  }
  return Number(process.env.NYV_CNR_FAST_TIMEOUT_MS ?? "20000");
}

function mapGatewayError(
  status: number,
  body: Record<string, unknown>,
): Error {
  const err = (body.error ?? {}) as Record<string, unknown>;
  const code = String(err.code ?? "");
  const message = String(err.message ?? "CNR resolve failed");
  if (
    status === 503 ||
    code === "CNR_UPSTREAM_BUSY" ||
    err.retryable === true
  ) {
    return new CnrUpstreamBusyError(message, code || "CNR_UPSTREAM_BUSY", true);
  }
  return new Error(message);
}

/** Returns NYV `data` envelope (56-field shape) or throws. */
export async function resolveCnrViaNyvGateway(input: {
  cnr?: string;
  cnrNumber?: string;
  diaryNumber?: string;
  options?: NyvCnrProxyOptions;
}): Promise<Record<string, unknown>> {
  const cfg = nyvGatewayConfigured();
  if (!cfg) {
    throw new Error("NYV gateway not configured");
  }

  const profile = input.options?.profile ?? "caseCreate";
  const body: NyvResolveBody = {
    options: {
      profile,
      includeDocuments: input.options?.includeDocuments ?? true,
      includeExtractPreview: input.options?.includeExtractPreview ?? false,
      includeTimeline: input.options?.includeTimeline ?? true,
      includeParseGuide: input.options?.includeParseGuide ?? false,
      fuzzyLimit: input.options?.fuzzyLimit,
      jurisdiction: input.options?.jurisdiction,
      courtType: input.options?.courtType,
      live: input.options?.live,
    },
  };

  const cnr = (input.cnr ?? input.cnrNumber ?? "").trim();
  const diary = (input.diaryNumber ?? "").trim();
  if (diary) {
    body.diaryNumber = diary;
  } else if (cnr) {
    body.identifier = cnr;
    body.cnr = cnr;
  } else {
    throw new Error("cnr or diaryNumber required");
  }

  const { res, body: raw } = await nyvGatewayFetch("/api/nv/v1/sdk/cnr/resolve", {
    method: "POST",
    base: cfg.base,
    key: cfg.key,
    timeoutMs: timeoutForProfile(profile, input.options?.live),
    body: JSON.stringify(body),
  });

  const envelope = raw as Record<string, unknown>;
  if (!res.ok) {
    logger.warn(
      { status: res.status, code: (envelope.error as Record<string, unknown>)?.code },
      "nyv cnr proxy non-ok",
    );
    throw mapGatewayError(res.status, envelope);
  }

  if (envelope.success !== true || !envelope.data) {
    throw new Error("Empty NYV CNR resolve response");
  }

  const data = envelope.data as Record<string, unknown>;
  data.source = data.source ?? envelope.source ?? "nyv-gateway-ssot";
  return data;
}

export function nyvCnrSsotEnabled(): boolean {
  const forceOff = (process.env.NYV_CNR_SSOT ?? "1").trim() === "0";
  return !forceOff && nyvGatewayConfigured() !== null;
}
