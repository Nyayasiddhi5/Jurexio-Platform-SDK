/**
 * NV-CITATOR-ATTRIBUTION-001 / NV-CITATOR-NUMERIC-TOKEN-001 — there must be exactly ONE
 * definition of authority identity.
 *
 * History: `src/routes/jrx-knowledge-plane-routes.ts` owned a private copy of
 * `normaliseAuthorityText` / `authorityTokens` / `resolveAuthority` / both token sets, because
 * the route was owned by another workstream when `src/services/jrx-authority-identity.ts` was
 * extracted. This test was a byte-equality drift guard over those two copies, and it earned its
 * keep: it failed the moment the numeric-token fix touched the route alone.
 *
 * The duplicate is now retired — the route imports from the canonical module — so the guard
 * changes shape rather than disappearing. Byte-equality between two copies is replaced by the
 * stronger property it was approximating: the route declares no identity logic of its own, so
 * there is nothing that CAN drift. Reinstating a private copy fails this file.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  authorityTokens,
  normaliseAuthorityText,
  citationYears,
  citationTokens,
  AUTHORITY_STOP,
  AUTHORITY_PLACE_ONLY,
} from '../../src/services/jrx-authority-identity.js';

const ROUTE = readFileSync(join(process.cwd(), 'src/routes/jrx-knowledge-plane-routes.ts'), 'utf8');
const ATTRIBUTION = readFileSync(
  join(process.cwd(), 'src/services/jrx-citator-attribution.ts'),
  'utf8',
);

describe('authority identity — one definition, no duplicate to drift', () => {
  it('the route imports identity from the canonical module', () => {
    expect(ROUTE).toContain("from '../services/jrx-authority-identity.js'");
    expect(ROUTE).toContain('resolveAuthority');
    expect(ROUTE).toContain('authorityTokens');
  });

  it('the attribution step imports the same module, not a second matcher', () => {
    expect(ATTRIBUTION).toContain("from './jrx-authority-identity.js'");
  });

  /*
   * The precise failure mode this file exists to prevent: one copy gets the fix and the other
   * does not, and the endpoint then disagrees with the attribution step about who the authority
   * is. A `const AUTHORITY_STOP = new Set([` back in the route is that failure starting.
   */
  it('the route declares no private copy of any identity primitive', () => {
    for (const decl of [
      'const AUTHORITY_STOP = new Set(',
      'const AUTHORITY_PLACE_ONLY = new Set(',
      'function normaliseAuthorityText',
      'function authorityTokens',
      'function resolveAuthority',
      'const CITATION_RE_LOOSE',
    ]) {
      expect(ROUTE, `route must not re-declare ${decl}`).not.toContain(decl);
    }
  });

  it('the canonical module is the only place the token sets are literal', () => {
    /* Cheap sanity that the sets survived the move intact rather than being emptied. */
    expect(AUTHORITY_STOP.has('state')).toBe(true);
    expect(AUTHORITY_STOP.size).toBe(16);
    expect(AUTHORITY_PLACE_ONLY.has('kerala')).toBe(true);
    expect(AUTHORITY_PLACE_ONLY.size).toBeGreaterThan(50);
  });
});

describe('authority identity — behaviour', () => {
  it('strips the three ways counsel and the corpus write "versus"', () => {
    const forms = ['A v. B', 'A vs B', 'A versus B'];
    const normalised = forms.map((f) => normaliseAuthorityText(f));
    expect(new Set(normalised).size).toBe(1);
  });

  it('drops party-name noise that matches almost every Indian judgment', () => {
    const { significant } = authorityTokens('State of Kerala and Ors versus Union of India');
    expect(significant).not.toContain('state');
    expect(significant).not.toContain('union');
  });

  it('a query whose only significant token is a place has no distinctive token', () => {
    expect(authorityTokens('State of Kerala').distinctive).toHaveLength(0);
  });

  it('keeps a distinctive party name', () => {
    expect(authorityTokens('Vodafone International Holdings B.V. v. Union of India').distinctive)
      .toContain('vodafone');
  });

  it('keeps the >= 4 character floor, which rejects initials and page numbers', () => {
    expect(authorityTokens('A B C Ltd v. X').significant).toHaveLength(0);
    /* "383" is the page number of [1980] 3 S.C.R. 383 and must never be a token. */
    expect(authorityTokens('[1980] 3 S.C.R. 383').significant).not.toContain('383');
  });
});

/*
 * NV-CITATOR-NUMERIC-TOKEN-001. A pure number is not a party name. Live measurement: the
 * gateway's identity lookup sent the bare token `1980` for `[1980] 3 S.C.R. 383` and the corpus
 * answered with the Shalimar Works (1980) family — a Telangana / Calcutta High Court line whose
 * COMPANY NAME contains 1980 — which then passed the all-tokens-in-title check.
 */
describe('numeric tokens are never authority identity', () => {
  it('drops a bare four-digit year from significant and distinctive', () => {
    const t = authorityTokens('[1980] 3 S.C.R. 383');
    expect(t.significant).toEqual([]);
    expect(t.distinctive).toEqual([]);
  });

  it('drops the year but keeps the party names when both are present', () => {
    const t = authorityTokens('Kesavananda Bharati (1973)');
    expect(t.distinctive).toEqual(['kesavananda', 'bharati']);
    expect(t.significant).not.toContain('1973');
  });

  it('does not drop alphanumerics that merely contain digits', () => {
    expect(authorityTokens('Section 138 NI Act 1881 Bhatia2020').distinctive)
      .toContain('bhatia2020');
  });
});

describe('citationYears — a year is compared against the year column, not a title', () => {
  it('reads years from bracketed and parenthesised citation forms', () => {
    expect(citationYears('[1980] 3 S.C.R. 383')).toEqual([1980]);
    expect(citationYears('(2012) 6 SCC 613')).toEqual([2012]);
  });

  it('ignores four-digit numbers that cannot be years', () => {
    /* An Indian case number contributes 4124, which is not a year and must not become a
     * filter that rejects the entire corpus. */
    expect(citationYears('WP(C)/4124/2018')).toEqual([2018]);
    expect(citationYears('Section 420 IPC')).toEqual([]);
  });

  it('is empty for a query with no year at all', () => {
    expect(citationYears('Kesavananda Bharati v. State of Kerala')).toEqual([]);
  });
});

describe('citationTokens — reporter abbreviations compare across spellings', () => {
  it('glues single-letter runs so S.C.R. and SCR are the same citation', () => {
    expect(citationTokens('[1980] 3 S.C.R. 383')).toEqual(['1980', '3', 'scr', '383']);
    expect(citationTokens('[1980] 3 SCR 383')).toEqual(['1980', '3', 'scr', '383']);
  });

  it('leaves multi-letter reporter names alone', () => {
    expect(citationTokens('(2012) 6 SCC 613')).toEqual(['2012', '6', 'scc', '613']);
    expect(citationTokens('AIR 1973 SC 1461')).toEqual(['air', '1973', 'sc', '1461']);
  });
});
