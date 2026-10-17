import type {
  CnrDocument,
  CnrResolveData,
  CnrResolveOptions,
  CnrResolveResponse,
} from "./cnrTypes";
import { DASHBOARD_RESOLVE_OPTIONS as DEFAULT_OPTIONS } from "./cnrTypes";

const SCRUB =
  /password|authentication failed|InvalidClientToken|AccessDenied|ExpiredToken|secret|credential|AKIA[0-9A-Z]{16}|28P01/i;

export class CnrApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly retryable?: boolean,
    readonly data?: CnrResolveData,
  ) {
    super(message);
    this.name = "CnrApiError";
  }
}

export function normalizeCnrInput(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

export function fieldDisplayValue(f: { value: unknown } | undefined | null): string | null {
  if (!f || f.value == null || f.value === "") return null;
  if (typeof f.value === "string") return f.value;
  if (typeof f.value === "number" || typeof f.value === "boolean") return String(f.value);
  try {
    return JSON.stringify(f.value);
  } catch {
    return String(f.value);
  }
}

function scrubMessage(msg: string): string {
  return SCRUB.test(msg)
    ? "The lookup service is unavailable. Try again shortly."
    : msg;
}

async function parseJson(res: Response): Promise<CnrResolveResponse> {
  try {
    return (await res.json()) as CnrResolveResponse;
  } catch {
    return { success: false, error: { code: "PARSE_ERROR", message: "Invalid response" } };
  }
}

async function cnrFetch(path: string, init?: RequestInit): Promise<CnrResolveResponse> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    ...init,
  });
  const body = await parseJson(res);
  if (!res.ok) {
    const msg = scrubMessage(body.error?.message ?? `Request failed (${res.status})`);
    throw new CnrApiError(msg, res.status, body.error?.code, body.error?.retryable, body.data);
  }
  if (!body.success) {
    const msg = scrubMessage(body.error?.message ?? "CNR resolve failed");
    throw new CnrApiError(msg, res.status, body.error?.code, body.error?.retryable, body.data);
  }
  return body;
}

export interface ResolveCnrInput {
  cnr?: string;
  diaryNumber?: string;
  options?: CnrResolveOptions;
}

export async function resolveCnr(input: ResolveCnrInput): Promise<CnrResolveData> {
  const options = { ...DEFAULT_OPTIONS, ...input.options };
  const body = await cnrFetch("/cnr/resolve", {
    method: "POST",
    body: JSON.stringify({
      ...(input.cnr ? { cnr: input.cnr } : {}),
      ...(input.diaryNumber ? { diaryNumber: input.diaryNumber } : {}),
      options,
    }),
  });
  if (!body.data) {
    throw new CnrApiError("Empty resolve response", 500);
  }
  return body.data;
}

export async function getCnr(cnr: string): Promise<CnrResolveData> {
  const encoded = encodeURIComponent(normalizeCnrInput(cnr));
  const body = await cnrFetch(`/cnr/${encoded}`);
  if (!body.data) {
    throw new CnrApiError("Empty CNR response", 500);
  }
  return body.data;
}

export async function listCnrDocuments(cnr: string): Promise<CnrDocument[]> {
  const encoded = encodeURIComponent(normalizeCnrInput(cnr));
  const res = await fetch(`/api/cnr/${encoded}/documents`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: { documents?: CnrDocument[] };
    error?: { message?: string };
  };
  if (!res.ok || !body.success) {
    throw new CnrApiError(
      scrubMessage(body.error?.message ?? `Documents failed (${res.status})`),
      res.status,
    );
  }
  return body.data?.documents ?? [];
}

const RETRY_DELAYS_MS = [2000, 4000, 8000];
export const CNR_LOOKUP_TIMEOUT_MS = 15_000;
export const CNR_DEEP_SEARCH_TIMEOUT_MS = 45_000;

export function isRetryableCnrError(err: unknown): boolean {
  if (!(err instanceof CnrApiError)) return false;
  return err.status === 503 || err.code === "CNR_UPSTREAM_BUSY" || err.retryable === true;
}

async function resolveCnrWithAbort(
  input: ResolveCnrInput,
  timeoutMs: number,
): Promise<CnrResolveData> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const options = { ...DEFAULT_OPTIONS, ...input.options };
    const res = await fetch("/api/cnr/resolve", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(input.cnr ? { cnr: input.cnr } : {}),
        ...(input.diaryNumber ? { diaryNumber: input.diaryNumber } : {}),
        options,
      }),
      signal: controller.signal,
    });
    const body = await parseJson(res);
    if (!res.ok) {
      const msg = scrubMessage(body.error?.message ?? `Request failed (${res.status})`);
      throw new CnrApiError(msg, res.status, body.error?.code, body.error?.retryable, body.data);
    }
    if (!body.success || !body.data) {
      throw new CnrApiError("Empty resolve response", res.status);
    }
    return body.data;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new CnrApiError(
        "Lookup timed out — the archive index may be cold. Try again or use Deep corpus search.",
        408,
        "CNR_CLIENT_TIMEOUT",
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve with exponential backoff on 503 / upstream busy (max 3 retries). */
export async function resolveCnrWithRetry(
  input: ResolveCnrInput,
  opts?: { timeoutMs?: number },
): Promise<CnrResolveData> {
  const timeoutMs = opts?.timeoutMs ?? CNR_LOOKUP_TIMEOUT_MS;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await resolveCnrWithAbort(input, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (!isRetryableCnrError(err) || attempt >= RETRY_DELAYS_MS.length) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastErr;
}

export interface EcourtsLiveStatus {
  feature: string;
  configured: boolean;
  budgetMs: number;
}

export async function fetchEcourtsLiveStatus(): Promise<EcourtsLiveStatus> {
  const res = await fetch("/api/cnr/ecourts-status", {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = (await res.json().catch(() => ({}))) as {
    success?: boolean;
    data?: EcourtsLiveStatus;
  };
  if (!res.ok || !body.success || !body.data) {
    return { feature: "nys-cnr-live-tier4", configured: false, budgetMs: 90000 };
  }
  return body.data;
}

/** Opt-in live eCourts lookup (Tier-4) — longer timeout, no automatic retry. */
export async function resolveCnrLive(input: ResolveCnrInput): Promise<CnrResolveData> {
  const options = { ...DEFAULT_OPTIONS, ...input.options, live: true };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.live ? 120_000 : 60_000);
  try {
    const res = await fetch("/api/cnr/resolve", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...(input.cnr ? { cnr: input.cnr } : {}),
        ...(input.diaryNumber ? { diaryNumber: input.diaryNumber } : {}),
        options,
      }),
      signal: controller.signal,
    });
    const body = await parseJson(res);
    if (!res.ok) {
      const msg = scrubMessage(body.error?.message ?? `Request failed (${res.status})`);
      throw new CnrApiError(msg, res.status, body.error?.code, body.error?.retryable, body.data);
    }
    if (!body.success || !body.data) {
      throw new CnrApiError("Empty live resolve response", res.status);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}
