/**
 * @vitest-environment jsdom
 *
 * Smoke for Platform-v5 admin pages (Task #109). Covers ALL nine pages in
 * the new /platform-v5/* family in BOTH the all-flags-OFF state (asserts
 * the explicit "Feature disabled in this environment" banner with runbook
 * link is rendered) and the all-flags-ON state (asserts the dark banner
 * is suppressed AND the inventory rows render the live `live · 200` chip
 * — i.e. the canonical X-API-Key path returns real capability data).
 *
 * Each page composes the same `Nv5NamespacePage` shell from `_shared.tsx`
 * with only a config object — but the smoke locks that EVERY page wires
 * its NamespaceConfig (sub-services, try-it URL, flag keys) correctly so a
 * future config typo doesn't slip past CI.
 */
import './setup-jsdom';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor, within } from './test-utils';

import PlatformV5Orch          from '../../client/src/pages/platform-v5/orch';
import PlatformV5Multimodal    from '../../client/src/pages/platform-v5/multimodal';
import PlatformV5Voice         from '../../client/src/pages/platform-v5/voice';
import PlatformV5Workflows     from '../../client/src/pages/platform-v5/workflows';
import PlatformV5DocAi         from '../../client/src/pages/platform-v5/doc-ai';
import PlatformV5LegalPipeline from '../../client/src/pages/platform-v5/legal-pipeline';
import PlatformV5Compliance    from '../../client/src/pages/platform-v5/compliance';
import PlatformV5Internal      from '../../client/src/pages/platform-v5/internal';
import PlatformV5Gov           from '../../client/src/pages/platform-v5/gov';
import { ADMIN_SDK_KEY_SLOT }   from '../../client/src/pages/platform-v5/_shared';

// ─── Catalog: every namespace, in lockstep with NyvSidebar entries ─────────
//
// `flagKeys` mirrors the per-page NamespaceConfig.flagKeys exactly. The stub
// fetch mints a flag-snapshot payload that includes ON/OFF entries for ALL
// these keys so the DisabledBanner's all-off detection works deterministically.
// One sample sub-route path per page is also asserted in the ON-state test so
// the inventory live-data assertion has a stable target to find.
const PAGES = [
  { slug: 'orch',           Page: PlatformV5Orch,          apiPrefix: '/api/nv5/orch',           flagKeys: ['aiOrchKb','aiOrchContext','aiOrchMultimodalRag','aiOrchPlugins','aiOrchRoma','aiOrchAgentSelect','aiOrchProtocols'], envPrefix: 'NYV_F_AI_ORCH_',         sampleSubPath: 'kb',           subPaths: ['kb','context','multimodal-rag','plugins','roma','agent-select','protocols'],                                                                                                                                  tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/orch/roma/audit-trail' },
  { slug: 'multimodal',     Page: PlatformV5Multimodal,    apiPrefix: '/api/nv5/multimodal',     flagKeys: ['multimodalAvatarUnity','multimodalAvatarChatdoll','multimodalRagAdv','multimodal3dImmersive','multimodalAvatar3d'], envPrefix: 'NYV_F_MULTIMODAL_',         sampleSubPath: 'rag-adv',     subPaths: ['avatar-unity','avatar-chatdoll','rag-adv','3d-immersive','avatar-3d'],                                                                                                                                tryItMethod: 'POST' as const, tryItUrl: '/api/nv5/multimodal/rag-adv/rag/query' },
  { slug: 'voice',          Page: PlatformV5Voice,         apiPrefix: '/api/nv5/voice',          flagKeys: ['voiceStreamRt','voiceSynth','voiceEnhanced'], envPrefix: 'NYV_F_VOICE_',         sampleSubPath: 'streaming',     subPaths: ['streaming','synthesis','enhanced'],                                                                                                                                                                                  tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/voice/streaming/metrics' },
  { slug: 'workflows',      Page: PlatformV5Workflows,     apiPrefix: '/api/nv5/workflows',      flagKeys: ['workflowAutonomous','workflowContinuous'], envPrefix: 'NYV_F_WORKFLOW_',         sampleSubPath: 'continuous',     subPaths: ['autonomous','continuous'],                                                                                                                                                                                          tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/workflows/continuous/status' },
  { slug: 'doc-ai',         Page: PlatformV5DocAi,         apiPrefix: '/api/nv5/doc-ai',         flagKeys: ['docAiConvert'], envPrefix: 'NYV_F_DOC_AI_',         sampleSubPath: 'convert',     subPaths: ['convert'],                                                                                                                                                                                                                                                          tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/doc-ai/convert/supported' },
  { slug: 'legal-pipeline', Page: PlatformV5LegalPipeline, apiPrefix: '/api/nv5/legal-pipeline', flagKeys: ['legalPipelineChunker','legalPipelineEmbedding','legalPipelineReranker','legalPipelineSummarizer','legalPipelineReadability'], envPrefix: 'NYV_F_LEGAL_PIPELINE_',         sampleSubPath: 'readability',     subPaths: ['chunker','embedding','reranker','summarizer','readability'],                                                                                                                                tryItMethod: 'POST' as const, tryItUrl: '/api/nv5/legal-pipeline/readability/score' },
  { slug: 'compliance',     Page: PlatformV5Compliance,    apiPrefix: '/api/nv5/compliance',     flagKeys: ['complianceEuAiAct','compliancePqc','complianceFederatedPrivacy'], envPrefix: 'NYV_F_COMPLIANCE_',         sampleSubPath: 'eu-ai-act',     subPaths: ['eu-ai-act','pqc','federated-privacy'],                                                                                                                                                                                              tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/compliance/eu-ai-act/report' },
  { slug: 'internal',       Page: PlatformV5Internal,      apiPrefix: '/api/nv5/internal',       flagKeys: ['internalSurface'], envPrefix: 'NYV_F_INTERNAL_',         sampleSubPath: 'model-cascade',     subPaths: ['','model-cascade','cost-aware-router','esign','ocr','pdfa','watermark','hallucination','escalation','event-sourcing','jurisdiction-overlay','audit-chain','case-update','agentzero','feature-flags','orchestration-facade'], tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/internal/slm-router/availability/IN' },
  { slug: 'gov',            Page: PlatformV5Gov,           apiPrefix: '/api/nv5/gov',            flagKeys: ['govMakerChecker','govSecurityMon','govCostOpt','govConcurrency','govOrgRatelimit'], envPrefix: 'NYV_F_GOV_',         sampleSubPath: 'maker-checker',     subPaths: ['maker-checker','security-monitor','cost-optimizer','concurrency','org-ratelimit'],                                                                                                                                tryItMethod: 'GET' as const,  tryItUrl: '/api/nv5/gov/concurrency/snapshot' },
] as const;

/**
 * Track every fetch the SUT issues so the ON-state test can assert that
 * /api/nv5/* probes carried the canonical X-API-Key header (NV-AUTH-HEADER-001
 * — proves the canonical SDK auth path is used, not raw JWT-only fetch).
 */
let recordedRequests: Array<{ url: string; headers: Record<string, string> }> = [];

function stubFetch(flagOn: boolean) {
  recordedRequests = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers: Record<string, string> = {};
    if (init?.headers) {
      const h = new Headers(init.headers);
      h.forEach((v, k) => { headers[k] = v; });
    }
    recordedRequests.push({ url, headers });

    if (url.includes('/api/jrx/admin/feature-flags')) {
      const flags: Record<string, { env: string; on: boolean }> = {};
      for (const p of PAGES) {
        for (const key of p.flagKeys) {
          flags[key] = { env: p.envPrefix + key.toUpperCase().replace(/[a-z]/g, ''), on: flagOn };
        }
      }
      return new Response(JSON.stringify({
        success: true,
        data: { flags, count: Object.keys(flags).length, sdkKeyPresent: true, capturedAt: new Date().toISOString() },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    if (url.includes('/api/jrx/admin/audit')) {
      return new Response(JSON.stringify({ success: true, data: { logs: [], total: 0 } }),
        { status: 200, headers: { 'content-type': 'application/json' } });
    }

    // Sub-route probes: 404 when flag OFF (matches gateway behaviour for
    // disabled namespaces), 200 with capability payload when ON.
    if (url.includes('/api/nv5/')) {
      const status = flagOn ? 200 : 404;
      const body = flagOn ? { success: true, data: { capabilities: ['probe-ok'] } } : { success: false };
      return new Response(JSON.stringify(body),
        { status, headers: { 'content-type': 'application/json' } });
    }

    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('Platform-v5 admin pages — render smoke', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Pre-seed the canonical SDK key + JWT so nv5Headers() injects both.
    window.localStorage.setItem(ADMIN_SDK_KEY_SLOT, 'nv_admin_test_key_DEADBEEFCAFE');
    window.localStorage.setItem('token', 'jwt.test.token');
  });

  // Each page is asserted in BOTH OFF and ON states via it.each (18 cases).
  describe.each(PAGES)('namespace: $slug', ({ slug, Page, sampleSubPath, subPaths, tryItMethod, tryItUrl }) => {
    it('renders with all flags OFF — explicit disabled banner with runbook link', async () => {
      stubFetch(false);
      renderWithProviders(<Page />);

      expect(await screen.findByTestId(`page-platform-v5-${slug}`)).toBeInTheDocument();
      expect(await screen.findByTestId('text-page-title')).toBeInTheDocument();

      // Regression-lock: EVERY sub-service row from the NamespaceConfig
      // mounts (catches a future config typo / dropped row before CI passes).
      // Note: doc-ai legitimately has two sub-services that share `path: 'convert'`
      // (one probes /health, the other /supported) → testid is duplicated, so
      // we use getAllByTestId and assert ≥1 instance per declared path.
      const inventory = await screen.findByTestId('card-inventory');
      for (const sub of subPaths) {
        expect(within(inventory).getAllByTestId(`inv-row-${sub}`).length).toBeGreaterThan(0);
      }

      // Regression-lock: the try-it card surfaces the EXACT canonical
      // METHOD + URL from cfg.tryIt (catches a future swap to the wrong
      // happy-path endpoint before SDK clients break).
      const tryIt = await screen.findByTestId('card-try-it');
      expect(within(tryIt).getByText(new RegExp(`${tryItMethod}\\s+${tryItUrl.replace(/\//g, '\\/')}`)))
        .toBeInTheDocument();

      // Required by acceptance: explicit "Feature disabled in this
      // environment" banner with runbook pointer when ALL flags are OFF.
      const banner = await screen.findByTestId('disabled-banner');
      expect(banner).toBeInTheDocument();
      expect(banner).toHaveTextContent(/Feature disabled in this environment/i);
      expect(banner).toHaveTextContent(/docs\/canonical\/00-README\.md/);
      expect(banner).toHaveTextContent(/feature flags/i);

      // All structural cards still mount even when dark.
      expect(await screen.findByTestId('admin-sdk-key-control')).toBeInTheDocument();
      expect(await screen.findByTestId('card-inventory')).toBeInTheDocument();
      expect(await screen.findByTestId('card-try-it')).toBeInTheDocument();
      expect(await screen.findByTestId('card-audit')).toBeInTheDocument();
    });

    it('renders with all flags ON — banner suppressed, inventory shows live · 200, X-API-Key sent', async () => {
      stubFetch(true);
      renderWithProviders(<Page />);

      expect(await screen.findByTestId(`page-platform-v5-${slug}`)).toBeInTheDocument();

      // Wait for the sample inventory row to land on its terminal "live · 200"
      // chip — proves capability data rendered end-to-end (not 401/403/404).
      // Use findAllByTestId because doc-ai has two sub-services sharing the
      // same `path: 'convert'` (different probes) → testid is duplicated.
      await waitFor(async () => {
        const sampleRows = await screen.findAllByTestId(`inv-row-${sampleSubPath}`);
        expect(sampleRows.length).toBeGreaterThan(0);
        expect(sampleRows[0]).toHaveTextContent(/live · 200/i);
      }, { timeout: 3000 });

      // Disabled banner MUST be suppressed when any flag is ON (here: all ON).
      expect(screen.queryByTestId('disabled-banner')).not.toBeInTheDocument();

      // Canonical NV-AUTH-HEADER-001 path: every /api/nv5/* request carried
      // X-API-Key sourced from the localStorage admin-key slot.
      const nv5Calls = recordedRequests.filter(r => r.url.includes('/api/nv5/'));
      expect(nv5Calls.length).toBeGreaterThan(0);
      for (const call of nv5Calls) {
        expect(call.headers['x-api-key']).toBe('nv_admin_test_key_DEADBEEFCAFE');
        expect(call.headers['authorization']).toBe('Bearer jwt.test.token');
      }
    });
  });

  it('legal-pipeline POST page renders the try-it Textarea + send button', async () => {
    stubFetch(false);
    renderWithProviders(<PlatformV5LegalPipeline />);
    expect(await screen.findByTestId('tryit-body')).toBeInTheDocument();
    expect(await screen.findByTestId('btn-tryit-send')).toBeInTheDocument();
  });
});

// ─── Try-it interaction (success 200 + flag-OFF 404) ───────────────────────
//
// Required by acceptance: clicking the try-it button with a stubbed fetch
// surfaces both the 200 success path (renders the JSON result panel) AND
// the flag-OFF 404 path (renders the explicit HelpHint pointing operators
// at the NYV_F_* runbook). Parameterised across one GET-tryit page (orch)
// and one POST-tryit page (legal-pipeline) so both code branches in
// TryItPanel are exercised.
describe('Platform-v5 try-it interaction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.setItem(ADMIN_SDK_KEY_SLOT, 'nv_admin_test_key_DEADBEEFCAFE');
    window.localStorage.setItem('token', 'jwt.test.token');
  });

  /**
   * Per-tryit-URL stub: feature-flags returns ON for everything, audit
   * returns empty, /api/nv5/* probes return 200 with capability payload,
   * but the EXACT try-it URL returns the configured `tryItStatus` so the
   * click-handler's success vs flag-OFF branches both fire.
   */
  function stubTryItFetch(tryItUrl: string, tryItStatus: 200 | 404) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/jrx/admin/feature-flags')) {
        const flags: Record<string, { env: string; on: boolean }> = {};
        for (const p of PAGES) for (const k of p.flagKeys) flags[k] = { env: p.envPrefix + k, on: true };
        return new Response(JSON.stringify({ success: true, data: { flags, count: 0, sdkKeyPresent: true, capturedAt: '' } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/jrx/admin/audit')) {
        return new Response(JSON.stringify({ success: true, data: { logs: [], total: 0 } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // The try-it URL takes priority over generic /api/nv5/* probes so the
      // mutation result reflects `tryItStatus` regardless of probe traffic.
      if (url.endsWith(tryItUrl)) {
        if (tryItStatus === 200) {
          return new Response(JSON.stringify({ success: true, data: { tryit: 'ok', echo: init?.body ?? null } }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response(JSON.stringify({ success: false, error: 'flag_off' }),
          { status: 404, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/nv5/')) {
        return new Response(JSON.stringify({ success: true, data: { capabilities: ['probe-ok'] } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }

  it('GET try-it (orch): click → 200 renders the JSON result panel with the tryit payload', async () => {
    stubTryItFetch('/api/nv5/orch/roma/audit-trail', 200);
    renderWithProviders(<PlatformV5Orch />);

    const btn = await screen.findByTestId('btn-tryit-send');
    await userEvent.click(btn);

    const result = await screen.findByTestId('tryit-result', {}, { timeout: 3000 });
    expect(result).toHaveTextContent(/"tryit":\s*"ok"/);
    // Help-hint must NOT appear on success.
    expect(screen.queryByText(/Feature flag is OFF in this environment/i)).not.toBeInTheDocument();
  });

  it('GET try-it (orch): click → 404 renders the flag-OFF help hint (NYV_F_* runbook)', async () => {
    stubTryItFetch('/api/nv5/orch/roma/audit-trail', 404);
    renderWithProviders(<PlatformV5Orch />);

    const tryItCard = await screen.findByTestId('card-try-it');
    await userEvent.click(within(tryItCard).getByTestId('btn-tryit-send'));

    // The HelpHint paragraph is scoped INSIDE the try-it card so we don't
    // collide with the InventoryPanel description (which also mentions the
    // NYV_F_* flag-OFF semantics) or the disabled-banner runbook pointer.
    await waitFor(
      () => expect(within(tryItCard).getByText(/Feature flag is OFF in this environment/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(within(tryItCard).getByText(/NYV_F_\*/)).toBeInTheDocument();
    expect(within(tryItCard).getByText(/docs\/canonical\/00-README\.md/)).toBeInTheDocument();
    // No success result rendered on 404.
    expect(screen.queryByTestId('tryit-result')).not.toBeInTheDocument();
  });

  it('POST try-it (legal-pipeline): click → 200 echoes posted body in result panel', async () => {
    stubTryItFetch('/api/nv5/legal-pipeline/readability/score', 200);
    renderWithProviders(<PlatformV5LegalPipeline />);

    const btn = await screen.findByTestId('btn-tryit-send');
    await userEvent.click(btn);

    const result = await screen.findByTestId('tryit-result', {}, { timeout: 3000 });
    expect(result).toHaveTextContent(/"tryit":\s*"ok"/);
    // The default body in the POST page declares a "text" property — assert
    // the request body actually flowed through to the wire (regression-lock
    // for TryItPanel.mutationFn dropping init.body on POSTs).
    expect(result).toHaveTextContent(/respondent shall/);
  });

  it('POST try-it (legal-pipeline): click → 404 renders flag-OFF help hint, no result panel', async () => {
    stubTryItFetch('/api/nv5/legal-pipeline/readability/score', 404);
    renderWithProviders(<PlatformV5LegalPipeline />);

    await userEvent.click(await screen.findByTestId('btn-tryit-send'));

    await waitFor(
      () => expect(screen.getByText(/Feature flag is OFF in this environment/i)).toBeInTheDocument(),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId('tryit-result')).not.toBeInTheDocument();
  });
});

// ─── Audit-panel resourceType prefix filtering ──────────────────────────────
//
// The AuditPanel pulls /api/jrx/admin/audit?limit=200 and client-side filters
// to entries whose `resourceType` starts with `cfg.apiPrefix`. This test
// mints a mixed payload (matching + non-matching prefixes) and asserts ONLY
// the matching entries land in the rendered list — the negative assertions
// catch a future regression that loosens the prefix match into substring or
// drops the filter entirely (which would leak cross-namespace audit rows
// into every page).
describe('Platform-v5 audit panel — resourceType prefix filtering', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.setItem(ADMIN_SDK_KEY_SLOT, 'nv_admin_test_key_DEADBEEFCAFE');
    window.localStorage.setItem('token', 'jwt.test.token');
  });

  function stubAuditFetch(logs: Array<{ id: string; action: string; resourceType: string; statusCode?: number; createdAt?: string }>) {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/jrx/admin/feature-flags')) {
        const flags: Record<string, { env: string; on: boolean }> = {};
        for (const p of PAGES) for (const k of p.flagKeys) flags[k] = { env: p.envPrefix + k, on: false };
        return new Response(JSON.stringify({ success: true, data: { flags, count: 0, sdkKeyPresent: true, capturedAt: '' } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url.includes('/api/jrx/admin/audit')) {
        const filled = logs.map(l => ({ statusCode: 200, createdAt: new Date().toISOString(), ...l }));
        return new Response(JSON.stringify({ success: true, data: { logs: filled, total: filled.length } }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // probes — irrelevant for this test
      return new Response(JSON.stringify({ success: false }), { status: 404, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
  }

  it('orch page: keeps /api/nv5/orch/* rows, drops /api/nv5/voice/* and /api/jrx/sdk/* rows', async () => {
    stubAuditFetch([
      { id: 'a1', action: 'roma.audit',         resourceType: '/api/nv5/orch/roma/audit-trail' },
      { id: 'a2', action: 'kb.search',          resourceType: '/api/nv5/orch/kb/search' },
      { id: 'a3', action: 'voice.tts',          resourceType: '/api/nv5/voice/synthesis/speak' },
      { id: 'a4', action: 'sdk.legaltech.send', resourceType: '/api/jrx/sdk/legaltech/send' },
      // Adversarial: contains "/api/nv5/orch" as a substring but does NOT
      // start with it — must be excluded by a true prefix match.
      { id: 'a5', action: 'spoof',              resourceType: '/proxy/api/nv5/orch/roma' },
    ]);
    renderWithProviders(<PlatformV5Orch />);

    const auditList = await screen.findByTestId('audit-list', {}, { timeout: 3000 });
    // 2 matching rows surfaced.
    expect(within(auditList).getByText(/roma\.audit/)).toBeInTheDocument();
    expect(within(auditList).getByText(/kb\.search/)).toBeInTheDocument();
    // 3 non-matching rows hidden.
    expect(within(auditList).queryByText(/voice\.tts/)).not.toBeInTheDocument();
    expect(within(auditList).queryByText(/sdk\.legaltech\.send/)).not.toBeInTheDocument();
    expect(within(auditList).queryByText(/spoof/)).not.toBeInTheDocument();
  });

  it('voice page: shows scoped-empty notice when audit has rows but none match the namespace prefix', async () => {
    stubAuditFetch([
      { id: 'b1', action: 'roma.audit', resourceType: '/api/nv5/orch/roma/audit-trail' },
      { id: 'b2', action: 'gov.queue',  resourceType: '/api/nv5/gov/maker-checker/queue' },
    ]);
    renderWithProviders(<PlatformV5Voice />);

    const empty = await screen.findByTestId('audit-empty', {}, { timeout: 3000 });
    expect(empty).toHaveTextContent(/no audit entries scoped to/);
    expect(empty).toHaveTextContent(/\/api\/nv5\/voice/);
    // The total count is still surfaced so the operator knows the audit
    // source returned data — the namespace just had no matching rows.
    expect(empty).toHaveTextContent(/scanned last 2 platform entries/);
    expect(screen.queryByTestId('audit-list')).not.toBeInTheDocument();
  });
});
