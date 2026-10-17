import { createLogger } from './logger.js';
import type { JurisdictionCode } from '../services/jrx-jurisdiction-prompt-resolver.js';
import { SUPPORTED_JURISDICTIONS } from '../services/jrx-jurisdiction-prompt-resolver.js';

const logger = createLogger('jurisdiction-resolver');

const ALIASES: Record<string, JurisdictionCode> = {
  IN:                 'IN',
  INDIA:              'IN',
  IND:                'IN',
  UK:                 'UK',
  GB:                 'UK',
  GBR:                'UK',
  'UNITED KINGDOM':   'UK',
  US:                 'US',
  USA:                'US',
  'UNITED STATES':    'US',
  EU:                 'EU',
  EUROPE:             'EU',
  'EUROPEAN UNION':   'EU',
  SG:                 'SG',
  SGP:                'SG',
  SINGAPORE:          'SG',
  GC:                 'GC',
  GCC:                'GC',
  GULF:               'GC',
  UAE:                'GC',
  'SAUDI ARABIA':     'GC',
  KSA:                'GC',
  DEFAULT:            'DEFAULT',
  ALL:                'DEFAULT',
  GLOBAL:             'DEFAULT',
  '*':                'DEFAULT',
  '':                 'DEFAULT',
};

export interface JurisdictionContext {
  /** Explicit override from API caller (req.body.jurisdiction or req.query.jurisdiction). */
  explicit?: string | null;
  /** From authenticated user's profile if available. */
  userProfile?: string | null;
  /** From tenant configuration if available. */
  tenantDefault?: string | null;
}

export interface JurisdictionInferenceResult {
  jurisdiction: JurisdictionCode;
  source: 'explicit' | 'user-profile' | 'tenant-default' | 'platform-default';
  warnedAt: string | null;
}

/**
 * Normalise an arbitrary jurisdiction string to one of the 7 canonical codes.
 * Returns null if the string can't be mapped (caller decides what to do).
 */
export function normaliseJurisdiction(raw: string | null | undefined): JurisdictionCode | null {
  if (raw == null) return null;
  const key = raw.trim().toUpperCase();
  if (key in ALIASES) return ALIASES[key];
  if ((SUPPORTED_JURISDICTIONS as string[]).includes(key)) return key as JurisdictionCode;
  return null;
}

/**
 * Resolver chain (highest priority first):
 *   1. explicit request param
 *   2. authenticated user's profile
 *   3. tenant default
 *   4. platform DEFAULT (warn — DEFAULT exists but should be a deliberate choice)
 *
 * Never throws. Always returns a usable jurisdiction.
 */
export function inferJurisdiction(ctx: JurisdictionContext): JurisdictionInferenceResult {
  const tries: Array<[JurisdictionInferenceResult['source'], string | null | undefined]> = [
    ['explicit', ctx.explicit],
    ['user-profile', ctx.userProfile],
    ['tenant-default', ctx.tenantDefault],
  ];

  for (const [source, raw] of tries) {
    const normalised = normaliseJurisdiction(raw ?? null);
    if (normalised) {
      return { jurisdiction: normalised, source, warnedAt: null };
    }
    if (raw != null && raw !== '') {
      logger.warn({ msg: 'jurisdiction value not recognised, trying next source', source, raw });
    }
  }

  // Platform-default policy: Jurexio is an India-first legal AI platform, so
  // when no jurisdiction is supplied we use the IN v3 registry (Indian Penal Code,
  // CrPC, Constitution, BNS/BSA, Evidence Act, etc.) rather than the multi-juris
  // DEFAULT registry. DEFAULT is still served when an agent only exists there.
  const warnedAt = new Date().toISOString();
  logger.warn({
    msg: 'no jurisdiction supplied — falling back to IN (India-first platform default)',
    explicit: ctx.explicit ?? null,
    userProfile: ctx.userProfile ?? null,
    tenantDefault: ctx.tenantDefault ?? null,
  });
  return { jurisdiction: 'IN', source: 'platform-default', warnedAt };
}
