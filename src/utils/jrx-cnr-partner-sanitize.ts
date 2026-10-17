/**
 * NV-CNR-PARTNER-SANITIZE-001 — strip cascade diagnostics from NSP/NYM CNR envelopes.
 */
import type { Request } from 'express';
import type { CnrResolveData } from '../../packages/client-sdk/src/api/CnrApi.js';
import { isIndiaOnlyPartner } from './jrx-partner-platform.js';

const PARTNER_META_STRIP_KEYS = [
  'tier',
  'ecourtsLiveAttempt',
  'ecourtsPortalAttempt',
  'portalJobId',
  'extra',
] as const;

export function shouldSanitizeCnrEnvelopeForPartner(req: Request): boolean {
  return isIndiaOnlyPartner(req);
}

export type PartnerCnrResolveData = Omit<CnrResolveData, 'sourcesTried'>;

/** Remove internal cascade tags from resolve `data` (shallow clone; omits sourcesTried). */
export function sanitizeCnrEnvelopeForPartner(data: CnrResolveData): PartnerCnrResolveData {
  const { sourcesTried: _sourcesTried, meta, ...rest } = data;
  const nextMeta =
    meta && typeof meta === 'object'
      ? { ...meta }
      : undefined;

  if (nextMeta) {
    for (const key of PARTNER_META_STRIP_KEYS) {
      delete (nextMeta as Record<string, unknown>)[key];
    }
    if (Object.keys(nextMeta).length === 0) {
      return { ...rest, claimEcourts: data.claimEcourts ?? false };
    }
  }

  return {
    ...rest,
    claimEcourts: data.claimEcourts ?? false,
    ...(nextMeta ? { meta: nextMeta } : {}),
  };
}

/** Sanitize top-level SDK JSON (resolve, documents, search, bundle). */
export function sanitizeCnrHttpJsonForPartner(
  req: Request,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  if (!shouldSanitizeCnrEnvelopeForPartner(req)) {
    return payload;
  }

  const out: Record<string, unknown> = { ...payload };
  delete out.sourcesTried;

  const data = out.data;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const row = data as Record<string, unknown>;
    if ('status' in row || 'cnr' in row || 'fields' in row) {
      out.data = sanitizeCnrEnvelopeForPartner(row as unknown as CnrResolveData);
    } else {
      const inner = { ...row };
      delete inner.sourcesTried;
      if (inner.meta && typeof inner.meta === 'object') {
        const meta = { ...(inner.meta as Record<string, unknown>) };
        for (const key of PARTNER_META_STRIP_KEYS) {
          delete meta[key];
        }
        inner.meta = meta;
      }
      out.data = inner;
    }
  }

  const meta = out.meta;
  if (meta && typeof meta === 'object') {
    const m = { ...(meta as Record<string, unknown>) };
    for (const key of PARTNER_META_STRIP_KEYS) {
      delete m[key];
    }
    out.meta = m;
  }

  return out;
}
