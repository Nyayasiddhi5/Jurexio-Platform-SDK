/**
 * Jurisdiction authority-adapter registry.
 * NV-SVC-AUTHORITY-ADAPTER-001
 *
 * Single lookup point that maps a request jurisdiction to its citation
 * authority adapter. The safety ring and hallucination checker call
 * `verifyCitations(text, jurisdiction)` here; everything jurisdiction-specific
 * lives behind the adapter contract.
 */

import { createLogger } from '../../utils/logger.js';
import {
  type JurisdictionCode,
  type JurisdictionAuthorityAdapter,
  type AuthorityVerifyReport,
} from './jrx-authority-adapter.js';
import { inAuthorityAdapter } from './jrx-in-authority-adapter.js';
import { ukAuthorityAdapter } from './jrx-uk-authority-adapter.js';
import { usAuthorityAdapter } from './jrx-us-authority-adapter.js';
import { euAuthorityAdapter } from './jrx-eu-authority-adapter.js';
import { gcAuthorityAdapter } from './jrx-gc-authority-adapter.js';
import { sgAuthorityAdapter } from './jrx-sg-authority-adapter.js';

const logger = createLogger('./jrx-authority-registry');

const ADAPTERS: Record<JurisdictionCode, JurisdictionAuthorityAdapter> = {
  IN: inAuthorityAdapter,
  UK: ukAuthorityAdapter,
  US: usAuthorityAdapter,
  EU: euAuthorityAdapter,
  GC: gcAuthorityAdapter,
  SG: sgAuthorityAdapter,
};

/** Accepts loose inputs (case, aliases) and normalizes to a JurisdictionCode. */
export function normalizeJurisdiction(input: string | undefined | null): JurisdictionCode {
  const v = (input || 'IN').trim().toUpperCase();
  switch (v) {
    case 'GCC':
    case 'UAE':
    case 'GULF':
      return 'GC';
    case 'GB':
    case 'UK':
    case 'EW':
      return 'UK';
    case 'USA':
      return 'US';
    case 'EUROPE':
    case 'EEA':
      return 'EU';
    case 'SGP':
    case 'SIN':
      return 'SG';
    case 'IND':
      return 'IN';
    default:
      return (v in ADAPTERS ? v : 'IN') as JurisdictionCode;
  }
}

export function getAuthorityAdapter(jurisdiction: string | undefined | null): JurisdictionAuthorityAdapter {
  return ADAPTERS[normalizeJurisdiction(jurisdiction)];
}

export function listAuthorityJurisdictions(): JurisdictionCode[] {
  return Object.keys(ADAPTERS) as JurisdictionCode[];
}

/**
 * Verify every citation in `text` against the correct jurisdiction's
 * authority. This is the canonical entry point for the safety ring.
 */
export async function verifyCitations(
  text: string,
  jurisdiction: string | undefined | null,
): Promise<AuthorityVerifyReport> {
  const adapter = getAuthorityAdapter(jurisdiction);
  const report = await adapter.verifyText(text);
  logger.debug('verify_citations', {
    jurisdiction: report.jurisdiction,
    adapter: report.adapter,
    found: report.citationsFound,
    verified: report.citationsVerified,
    unverified: report.citationsUnverified,
    invalid: report.citationsInvalid,
    liveApiConsulted: report.liveApiConsulted,
  });
  return report;
}

/** Diagnostic snapshot for admin/eval surfaces (no secrets). */
export function getAuthorityRegistrySnapshot(): Array<{
  jurisdiction: JurisdictionCode;
  adapter: string;
  authoritySources: string[];
  liveApiEnabled: boolean;
}> {
  return listAuthorityJurisdictions().map(code => {
    const a = ADAPTERS[code];
    return {
      jurisdiction: code,
      adapter: a.name,
      authoritySources: a.authoritySources,
      liveApiEnabled: a.liveApiEnabled(),
    };
  });
}
