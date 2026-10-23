/**
 * NV-ECOURTS-PORTAL-FETCH-001 — Tier-4b public eCourts portal fetch (spike).
 *
 * Strategy: session cookie pool (Option A) + captcha solver hook stub (Option B).
 * Honesty: claimEcourts stays false until live data verified on wire.
 *
 * Env:
 *   JRX_F_ECOURTS_PORTAL_FETCH=0 (default off)
 *   JRX_ECOURTS_PORTAL_TIMEOUT_MS (default 45000)
 *   JRX_ECOURTS_PORTAL_BASE_URL (default services.ecourts v6 CNR search)
 *   JRX_ECOURTS_SESSION_COOKIE — ops-provided session (never logged)
 *   JRX_ECOURTS_CAPTCHA_SOLVER=stub|none (default stub — returns null)
 */
import { createLogger } from '../utils/logger.js';
import type { CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import { normalizeCnrInput } from './jrx-case-api-adapter.js';

const logger = createLogger('./jrx-ecourts-portal-fetch');

export const ECOURTS_PORTAL_SOURCE = 'ecourts_portal';
export const ECOURTS_PORTAL_ATTEMPTED = 'ecourts_portal_attempted';

const DEFAULT_PORTAL_BASE =
  'https://services.ecourts.gov.in/ecourtindia_v6/?p=cnr_status/searchByCNR';

function envFlagOn(name: string): boolean {
  const v = (process.env[name] ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isEcourtsPortalFetchEnabled(): boolean {
  return envFlagOn('JRX_F_ECOURTS_PORTAL_FETCH');
}

export function getEcourtsPortalTimeoutMs(): number {
  const n = Number(process.env.JRX_ECOURTS_PORTAL_TIMEOUT_MS ?? '45000');
  if (!Number.isFinite(n) || n <= 0) return 45_000;
  return Math.min(120_000, Math.max(5_000, Math.floor(n)));
}

export function getEcourtsPortalBaseUrl(): string {
  return (process.env.JRX_ECOURTS_PORTAL_BASE_URL ?? DEFAULT_PORTAL_BASE).trim();
}

function sessionCookieLen(): number {
  return (process.env.JRX_ECOURTS_SESSION_COOKIE ?? '').trim().length;
}

/** Captcha solver hook — stub provider only; no keys in repo. */
export interface EcourtsCaptchaSolverInput {
  pageHtml: string;
  captchaImageUrl?: string | null;
}

export interface EcourtsCaptchaSolver {
  readonly provider: string;
  solve(input: EcourtsCaptchaSolverInput): Promise<string | null>;
}

class StubCaptchaSolver implements EcourtsCaptchaSolver {
  readonly provider = 'stub';

  async solve(_input: EcourtsCaptchaSolverInput): Promise<string | null> {
    return null;
  }
}

let captchaSolver: EcourtsCaptchaSolver | null = null;

export function getEcourtsCaptchaSolver(): EcourtsCaptchaSolver {
  if (captchaSolver) return captchaSolver;
  const mode = (process.env.JRX_ECOURTS_CAPTCHA_SOLVER ?? 'stub').trim().toLowerCase();
  if (mode === 'none') {
    captchaSolver = { provider: 'none', solve: async () => null };
  } else {
    captchaSolver = new StubCaptchaSolver();
  }
  return captchaSolver;
}

/** Test hook — inject a custom solver without env mutation. */
export function setEcourtsCaptchaSolverForTests(solver: EcourtsCaptchaSolver | null): void {
  captchaSolver = solver;
}

function fv(value: unknown, source: string, confidence: number) {
  return { value, source, confidence };
}

function detectCaptcha(html: string): boolean {
  const lower = html.toLowerCase();
  return (
    lower.includes('captcha') ||
    lower.includes('security code') ||
    lower.includes('enter the code') ||
    lower.includes('validatecaptcha')
  );
}

/** Minimal HTML field extraction — fragile; honest low confidence. */
function extractPortalFields(html: string, cnr: string): {
  petitioner: string | null;
  respondent: string | null;
  caseStatus: string | null;
  courtName: string | null;
  caseType: string | null;
  filingDate: string | null;
} {
  const pick = (patterns: RegExp[]): string | null => {
    for (const re of patterns) {
      const m = html.match(re);
      if (m?.[1]) {
        const s = m[1].replace(/<[^>]+>/g, '').trim();
        if (s.length > 0 && s.length < 500) return s;
      }
    }
    return null;
  };

  return {
    petitioner: pick([
      /Petitioner[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i,
      /Petitioner[^:]*:\s*<[^>]*>([^<]+)/i,
      /"petitioner[^"]*"[^>]*>([^<]+)/i,
    ]),
    respondent: pick([
      /Respondent[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i,
      /Respondent[^:]*:\s*<[^>]*>([^<]+)/i,
      /"respondent[^"]*"[^>]*>([^<]+)/i,
    ]),
    caseStatus: pick([
      /Case\s*Status[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i,
      /Status[^:]*:\s*<[^>]*>([^<]+)/i,
    ]),
    courtName: pick([/Court\s*Name[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i]),
    caseType: pick([/Case\s*Type[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i]),
    filingDate: pick([/Filing\s*Date[^<]*<\/[^>]+>\s*<[^>]+>\s*([^<]+)/i]),
  };
}

function mapPortalHitToResolve(
  cnr: string,
  fields: ReturnType<typeof extractPortalFields>,
  latencyMs: number,
): CnrResolveData {
  const source = ECOURTS_PORTAL_SOURCE;
  return {
    cnr,
    status: 'found',
    matchType: 'live_ecourts_portal',
    source,
    sourcesTried: [ECOURTS_PORTAL_ATTEMPTED, source],
    confidence: 0.55,
    claimEcourts: false,
    validation: 'ok',
    ui: {
      badge: 'Suggested · Portal fetch (unverified)',
      subtitle: 'Public eCourts portal session — not verified docket claim',
    },
    fields: {
      courtName: fv(fields.courtName, source, fields.courtName ? 0.55 : 0),
      caseType: fv(fields.caseType, source, fields.caseType ? 0.5 : 0),
      filingDate: fv(fields.filingDate, source, fields.filingDate ? 0.5 : 0),
      caseStatus: fv(fields.caseStatus, source, fields.caseStatus ? 0.55 : 0),
      petitioner: fv(fields.petitioner, source, fields.petitioner ? 0.55 : 0),
      respondent: fv(fields.respondent, source, fields.respondent ? 0.55 : 0),
      hearings: { value: [], source, confidence: 0 },
    },
    documents: [],
    candidates: [],
    meta: {
      source,
      latencyMs,
      tier: 'ecourts_portal',
      extra: {
        portalFetch: true,
        note: 'Tier-4b portal spike — claimEcourts remains false per partner contract',
      },
    },
  };
}

export type EcourtsPortalAttempt =
  | { kind: 'found'; data: CnrResolveData }
  | { kind: 'attempted'; tag: typeof ECOURTS_PORTAL_ATTEMPTED; reason: string }
  | { kind: 'skipped' };

/**
 * Synchronous portal fetch — may take 30–120s; call only from async worker.
 * Requires JRX_ECOURTS_SESSION_COOKIE for captcha-gated portal.
 */
export async function attemptEcourtsPortalFetch(input: {
  cnr?: string;
  diaryNumber?: string;
}): Promise<EcourtsPortalAttempt> {
  if (!isEcourtsPortalFetchEnabled()) {
    return { kind: 'skipped' };
  }

  const cnr = input.cnr ? normalizeCnrInput(input.cnr) : '';
  if (!cnr) {
    return { kind: 'skipped' };
  }

  const cookieLen = sessionCookieLen();
  if (cookieLen === 0) {
    logger.info('[CNR] portal fetch enabled but JRX_ECOURTS_SESSION_COOKIE absent', {
      cnrLen: cnr.length,
    });
    return {
      kind: 'attempted',
      tag: ECOURTS_PORTAL_ATTEMPTED,
      reason:
        'JRX_ECOURTS_SESSION_COOKIE not configured — portal captcha requires ops session pool',
    };
  }

  const t0 = Date.now();
  const timeoutMs = getEcourtsPortalTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const portalUrl = getEcourtsPortalBaseUrl();
    const body = new URLSearchParams({ cnr_no: cnr, ajax_req: 'true' });
    const res = await fetch(portalUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: process.env.JRX_ECOURTS_SESSION_COOKIE!.trim(),
        'User-Agent': 'Jurexio-Tier4b/1.0',
        Accept: 'text/html,application/json',
      },
      body: body.toString(),
      signal: controller.signal,
    });

    const text = await res.text();
    const latencyMs = Date.now() - t0;

    if (res.ok === false) {
      logger.warn('[CNR] portal upstream HTTP error', { status: res.status, cnrLen: cnr.length });
      return {
        kind: 'attempted',
        tag: ECOURTS_PORTAL_ATTEMPTED,
        reason: `Portal HTTP ${res.status} — session may be expired`,
      };
    }

    if (detectCaptcha(text)) {
      const solver = getEcourtsCaptchaSolver();
      const solved = await solver.solve({ pageHtml: text });
      if (!solved) {
        return {
          kind: 'attempted',
          tag: ECOURTS_PORTAL_ATTEMPTED,
          reason: `Captcha required — solver ${solver.provider} returned no token`,
        };
      }
      return {
        kind: 'attempted',
        tag: ECOURTS_PORTAL_ATTEMPTED,
        reason: 'Captcha solver stub cannot submit form — wire Playwright worker next',
      };
    }

    const fields = extractPortalFields(text, cnr);
    if (!fields.petitioner && !fields.respondent && !fields.caseStatus) {
      return {
        kind: 'attempted',
        tag: ECOURTS_PORTAL_ATTEMPTED,
        reason: 'Portal HTML returned no parseable case fields — CNR may be absent or DOM changed',
      };
    }

    return { kind: 'found', data: mapPortalHitToResolve(cnr, fields, latencyMs) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      return {
        kind: 'attempted',
        tag: ECOURTS_PORTAL_ATTEMPTED,
        reason: `Portal fetch timed out after ${timeoutMs}ms`,
      };
    }
    logger.warn('[CNR] portal fetch network error', { cnrLen: cnr.length, errorLen: msg.length });
    return {
      kind: 'attempted',
      tag: ECOURTS_PORTAL_ATTEMPTED,
      reason: `Portal network error — ${msg.slice(0, 80)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}
