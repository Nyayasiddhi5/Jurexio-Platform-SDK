/**
 * NV-ECOURTSINDIA-PARTNER-001 — eCourtsIndia.com partner REST client.
 * Docs: https://ecourtsindia.com/api/docs · Base: https://webapi.ecourtsindia.com
 * Auth: Authorization: Bearer eci_live_* (JRX_ECOURTSINDIA_API_KEY or eci_live in JRX_ECOURTS_API_KEY).
 */
import { createLogger } from '../utils/logger.js';

const logger = createLogger('./jrx-ecourtsindia-partner');

export const ECOURTSINDIA_PARTNER_BASE =
  (process.env.JRX_ECOURTSINDIA_BASE_URL ?? 'https://webapi.ecourtsindia.com').replace(/\/$/, '');

export interface EcourtsIndiaPartnerConfig {
  apiKey: string;
  baseUrl: string;
}

export interface EcourtsIndiaCaseEnvelope {
  data?: {
    courtCaseData?: Record<string, unknown>;
    files?: { files?: Array<Record<string, unknown>> };
  };
  meta?: { request_id?: string };
}

export function ecourtsIndiaApiKeyLen(): number {
  return resolveEcourtsIndiaApiKey().length;
}

export function resolveEcourtsIndiaApiKey(): string {
  const dedicated = (process.env.JRX_ECOURTSINDIA_API_KEY ?? '').trim();
  if (dedicated) return dedicated;
  const legacy = (process.env.JRX_ECOURTS_API_KEY ?? '').trim();
  if (legacy.startsWith('eci_live_')) return legacy;
  return '';
}

export function getEcourtsIndiaConfig(): EcourtsIndiaPartnerConfig | null {
  const apiKey = resolveEcourtsIndiaApiKey();
  if (!apiKey) return null;
  return { apiKey, baseUrl: ECOURTSINDIA_PARTNER_BASE };
}

function bearerHeaders(config: EcourtsIndiaPartnerConfig): Record<string, string> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
    'User-Agent': 'Jurexio/5.0.0',
  };
}

export type EcourtsIndiaPartnerHttpResult = {
  ok: boolean;
  status: number;
  json?: unknown;
  text?: string;
};

async function partnerGet(path: string): Promise<EcourtsIndiaPartnerHttpResult> {
  const config = getEcourtsIndiaConfig();
  if (!config) return { ok: false, status: 0, text: 'not_configured' };

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, { method: 'GET', headers: bearerHeaders(config) });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      logger.warn('[eCourtsIndia] partner GET failed', { status: res.status, pathLen: path.length });
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 200) };
  } catch (err) {
    logger.warn('[eCourtsIndia] network error', {
      pathLen: path.length,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, text: 'network_error' };
  }
}

async function partnerPost(
  path: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<EcourtsIndiaPartnerHttpResult> {
  const config = getEcourtsIndiaConfig();
  if (!config) return { ok: false, status: 0, text: 'not_configured' };

  const url = `${config.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...bearerHeaders(config),
        'Content-Type': 'application/json',
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    if (!res.ok) {
      logger.warn('[eCourtsIndia] partner POST failed', { status: res.status, pathLen: path.length });
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 200) };
  } catch (err) {
    logger.warn('[eCourtsIndia] network error', {
      pathLen: path.length,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, text: 'network_error' };
  }
}

/** Raw GET for probes and future cascade helpers (path must start with `/api/partner/`). */
export async function ecourtsIndiaPartnerGet(path: string): Promise<EcourtsIndiaPartnerHttpResult> {
  return partnerGet(path);
}

/** Free catalog — smoke / capabilities probe. */
export async function getSearchCapabilities(): Promise<{ ok: boolean; status: number }> {
  const r = await partnerGet('/api/partner/search/capabilities');
  return { ok: r.ok, status: r.status || 503 };
}

/** Full case record for CNR (16 chars, uppercase). */
export async function getPartnerCaseByCnr(
  cnr: string,
): Promise<{ ok: true; envelope: EcourtsIndiaCaseEnvelope } | { ok: false; status: number; reason: string }> {
  const normalized = cnr.trim().toUpperCase();
  if (normalized.length !== 16) {
    return { ok: false, status: 400, reason: 'CNR must be 16 characters' };
  }
  const r = await partnerGet(`/api/partner/case/${encodeURIComponent(normalized)}`);
  if (!r.ok) {
    return {
      ok: false,
      status: r.status || 502,
      reason: r.status === 404 ? 'CNR not indexed' : `upstream_${r.status || 0}`,
    };
  }
  return { ok: true, envelope: (r.json ?? {}) as EcourtsIndiaCaseEnvelope };
}

/** Live enum catalog (free). */
export async function getPartnerEnums(): Promise<EcourtsIndiaPartnerHttpResult> {
  return partnerGet('/api/partner/enums');
}

/** Court-structure walk — states (free). */
export async function getCourtStructureStates(): Promise<EcourtsIndiaPartnerHttpResult> {
  return partnerGet('/api/partner/causelist/court-structure/states');
}

/** India Code corpus status (free). */
export async function getActsCorpusStatus(): Promise<EcourtsIndiaPartnerHttpResult> {
  return partnerGet('/api/partner/acts/status');
}

/** LegalCheck model catalog (free read). */
export async function getLegalCheckModels(): Promise<EcourtsIndiaPartnerHttpResult> {
  return partnerGet('/api/partner/legal-check/models');
}

/** Partner search — full response envelope. */
export async function partnerSearch(query: string, pageSize = 5): Promise<EcourtsIndiaPartnerHttpResult> {
  const q = encodeURIComponent(query.trim());
  const size = Math.min(Math.max(pageSize, 1), 50);
  return partnerGet(`/api/partner/search?q=${q}&page_size=${size}`);
}

/** Acts section batch (paid when sections returned — use sparingly in prod). */
export async function postActsSectionsBatch(
  sections: Array<{ key: string; number: string; unit?: string }>,
): Promise<EcourtsIndiaPartnerHttpResult> {
  return partnerPost('/api/partner/acts/sections/batch', { sections: sections.slice(0, 50) });
}

/** Partner search — returns first CNR hit (discovery helper). */
export async function partnerSearchFirstCnr(query: string): Promise<string | null> {
  const q = encodeURIComponent(query.trim());
  if (!q) return null;
  const r = await partnerGet(`/api/partner/search?q=${q}&page_size=1`);
  if (!r.ok || !r.json || typeof r.json !== 'object') return null;
  const data = (r.json as { data?: { results?: Array<{ cnr?: string }> } }).data;
  const first = data?.results?.[0]?.cnr;
  return typeof first === 'string' && first.length === 16 ? first.toUpperCase() : null;
}

export async function getEcourtsIndiaHealth(): Promise<{
  configured: boolean;
  status: 'live' | 'not_configured' | 'degraded';
  keyLen: number;
}> {
  const keyLen = ecourtsIndiaApiKeyLen();
  if (keyLen === 0) return { configured: false, status: 'not_configured', keyLen: 0 };
  const cap = await getSearchCapabilities();
  return {
    configured: true,
    status: cap.ok ? 'live' : 'degraded',
    keyLen,
  };
}
