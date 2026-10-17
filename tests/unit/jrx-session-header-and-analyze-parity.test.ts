/**
 * NV-SESSION-ECHO-001 (header) — honour the partner's own conversation id.
 *
 * NSP reported sending `X-Customer-Session-Id` on every AI call. A grep proved we
 * read it **nowhere**: only the body `sessionId` was consulted, so a partner that
 * had correctly scoped its own threads was still handed a NYV-minted session — and,
 * before NV-SESSION-POOLING-001, a shared one.
 *
 * NV-COURT-DOC-FIELDS-001 (parity) — there are TWO analyze endpoints:
 * `/api/jrx/gateway/documents/analyze` and `/api/jrx/sdk/docs-pipeline/documents/analyze`
 * (an explicit "NSP alias" to a different handler). Fixing only the gateway left the
 * alias field-less, which is why NSP still saw `heuristicFallback: true`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Request } from 'express';
import { resolveCustomerSessionId } from '../../src/services/jrx-customer-org-service.js';

const req = (headers: Record<string, string>) => ({ headers }) as unknown as Request;

describe('NV-SESSION-ECHO-001 — X-Customer-Session-Id is read', () => {
  it('returns the partner thread id when sent', () => {
    expect(resolveCustomerSessionId(req({ 'x-customer-session-id': 'nsp:o:3:u:315:t:88' })))
      .toBe('nsp:o:3:u:315:t:88');
  });

  it('accepts NSP namespaced ids (colons must be legal)', () => {
    // NSP namespaces for collision safety; ':' is already allowed by SAFE_EXTERNAL_REF.
    expect(resolveCustomerSessionId(req({ 'x-customer-session-id': 'nsp:o:3:u:315' })))
      .toBe('nsp:o:3:u:315');
  });

  it('returns null when absent, so the mint path still applies', () => {
    expect(resolveCustomerSessionId(req({}))).toBeNull();
    expect(resolveCustomerSessionId(req({ 'x-customer-session-id': '   ' }))).toBeNull();
  });

  it('rejects an unsafe or oversized value rather than trusting it into logs/keys', () => {
    expect(resolveCustomerSessionId(req({ 'x-customer-session-id': 'a'.repeat(200) }))).toBeNull();
    expect(resolveCustomerSessionId(req({ 'x-customer-session-id': 'drop table;--' }))).toBeNull();
    expect(resolveCustomerSessionId(req({ 'x-customer-session-id': 'has space' }))).toBeNull();
  });
});

describe('NV-SESSION-ECHO-001 — precedence body > header > mint', () => {
  const ROUTES = readFileSync(
    join(process.cwd(), 'src/routes/jrx-orchestration-routes.ts'),
    'utf8',
  );

  it('the header is consulted only when the body did not supply one', () => {
    // Body is the more specific per-call statement; the header is the ambient thread.
    expect(ROUTES).toContain("sessionId = resolveCustomerSessionId(req) || ''");
    const occurrences = ROUTES.match(/sessionId = resolveCustomerSessionId\(req\) \|\| ''/g) || [];
    // Both the sync route and the /stream route must behave identically.
    expect(occurrences.length).toBe(2);
  });

  it('the header check precedes the mint on both routes', () => {
    for (const anchor of ['let sessionId = typeof bodySessionId', 'let sessionId = typeof bodyStreamSessionId']) {
      const start = ROUTES.indexOf(anchor);
      expect(start).toBeGreaterThan(-1);
      /* Window widened for NV-COURT-DOC-FIELDS-004, which inserts the court-doc
       * extraction between the session resolution and the mint, and again for
       * NV-ANALYZE-STATUS-005, which adds the explicit failed-outcome branch there.
       * The ORDERING being asserted is unchanged — only the distance between the two
       * anchors grew. */
      const slice = ROUTES.slice(start, start + 5600);
      const headerIdx = slice.indexOf('resolveCustomerSessionId');
      const mintIdx = slice.indexOf('mintEcosystemPromptSessionId');
      expect(headerIdx).toBeGreaterThan(-1);
      expect(mintIdx).toBeGreaterThan(-1);
      expect(headerIdx).toBeLessThan(mintIdx);
    }
  });
});

describe('NV-COURT-DOC-FIELDS-001 — both analyze endpoints return fields', () => {
  const PIPE = readFileSync(
    join(process.cwd(), 'src/routes/jrx-sdk-doc-pipeline-routes.ts'),
    'utf8',
  );
  const GW = readFileSync(
    join(process.cwd(), 'src/routes/jrx-sdk-gateway-routes.ts'),
    'utf8',
  );

  it('the docs-pipeline handler (which serves the NSP /documents/analyze alias) extracts fields', () => {
    expect(PIPE).toContain('extractCourtDocumentFields');
    /* NV-COURT-DOC-FIELDS-004 — block shaped by the shared builder now; its output is
     * asserted directly in nv-court-doc-fields-all-paths.test.ts. */
    expect(PIPE).toContain('buildCourtDocFieldBlock(courtFields, nested, courtOutcome)');
  });

  it('the alias is still routed to that handler', () => {
    /* Matched loosely on purpose: the intent is that the alias still reaches
     * `handleDocumentIntelligence`, not that no middleware sits in front of it.
     * NV-CREDIT-UNIVERSAL-001 added a pre-spend credit cap between the two, which
     * an exact-literal match read as the alias having been unrouted. */
    expect(PIPE).toMatch(
      /router\.post\('\/documents\/analyze',[^)]*handleDocumentIntelligence\)/,
    );
  });

  it('the DEGRADED fail-soft branch also returns fields', () => {
    // Deterministic extraction does not depend on the LLM that just failed, so a
    // degraded analysis must still carry the case number and parties.
    expect(PIPE).toContain('buildCourtDocFieldBlock(degradedFields, null, {');
  });

  it('existing keys are preserved on both paths (additive only)', () => {
    expect(PIPE).toContain('...(result as Record<string, unknown>)');
    expect(GW).toContain('analysis: llmResponse.content');
  });

  it('both partner routers enforce India-only scope after auth', () => {
    for (const src of [PIPE, GW]) {
      const authIdx = src.indexOf('router.use(sdkGatewayAuth)');
      const scopeIdx = src.indexOf('router.use(partnerIndiaScopeMiddleware)');
      expect(scopeIdx).toBeGreaterThan(authIdx);
    }
  });
});
