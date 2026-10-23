import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Platform-v5 Console pages — shared scaffolding (Task #109).
 *
 * The nine `/api/nv5/*` admin namespaces each get a one-page operator surface
 * under `/platform-v5/*`. Every page is structurally identical:
 *
 *   1. Header chips — feature-flag status read from /api/jrx/admin/feature-flags
 *      (one chip per logical JRX_F_* flag governing the namespace).
 *   2. Service inventory — probes each sub-route's /health or /capabilities
 *      endpoint and reports HTTP status (live · 200, 404 flag-OFF, 401 unauth,
 *      403 no-scope, error).
 *   3. Try-it form — one representative happy-path action route per namespace,
 *      with a JSON body editor (POSTs) or path-param input (GETs).
 *   4. Audit chain — last N entries from /api/jrx/admin/audit-logs filtered
 *      client-side to rows whose `resourceType` (= req.route) starts with the
 *      namespace prefix.
 *   5. Operational notes — runbook hint when ALL flags for the namespace are
 *      OFF (panel renders the canonical "feature disabled in this environment"
 *      banner with a pointer to docs/canonical/00-README.md § feature flags).
 *
 * Auth model: every Console fetch is JWT-credentialed (`credentials: include`).
 * The Console-side admin endpoints (/api/jrx/admin/*) accept JWT super_admin /
 * admin / org_admin. The /api/nv5/* sub-routers themselves require an SDK key
 * with the `admin` scope — when called without one they return 401 / 403,
 * which the per-card `<StateChip>` renders explicitly. This matches the
 * existing pattern in superadmin-governance.tsx (Batch D, 2026-05-10) so the
 * Console doesn't have to inject SDK keys into the browser session.
 *
 * NV-AUTH-HEADER-001: no new auth headers introduced. Every fetch goes through
 * the canonical `Authorization: Bearer <jwt>` (set by the cookie-based session)
 * or no-key (for SDK-gated endpoints, which are documented to require an
 * operator-injected admin SDK key).
 */
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
// Canonical Console API client — same Authorization: Bearer <jwt> path used by
// every other admin page in the Console. We extend it with the canonical
// `X-API-Key` header sourced from localStorage('nyv.admin.sdkKey') so the
// Platform-v5 try-it forms can hit /api/nv5/* end-to-end with a single
// operator-injected admin SDK key. NV-AUTH-HEADER-001: this is the canonical
// SDK auth header (extracted server-side by extractSdkApiKey from
// src/middleware/jrx-sdk-auth-header.ts) — no new headers introduced.
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertTriangle, CheckCircle2, Lock, RefreshCw, FileText, Activity, ListTree, BookOpen,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SubServiceProbe {
  /** Display label for the sub-service. */
  label: string;
  /** Path segment under the namespace, e.g. "kb" → /api/nv5/orch/kb. */
  path: string;
  /** Probe endpoint (GET) under the sub-service, e.g. "/health" or "/capabilities". */
  probe: string;
  /** Optional JRX_F_* logical flag name that gates this sub-service. */
  flag?: string;
}

export interface TryItEndpoint {
  method: 'GET' | 'POST';
  /** Full URL relative to gateway, e.g. "/api/nv5/orch/roma/audit-trail". */
  url: string;
  /** Human-readable label for the button. */
  label: string;
  /** Optional default JSON body for POSTs. */
  defaultBody?: string;
  /** Short description shown above the form. */
  description?: string;
}

export interface NamespaceConfig {
  /** Slug under /platform-v5/, e.g. "orch". */
  slug: string;
  /** Display title. */
  title: string;
  /** One-paragraph what-this-is description. */
  blurb: string;
  /** Namespace prefix on the API side, e.g. "/api/nv5/orch". */
  apiPrefix: string;
  /** Logical JRX_F_* flag names governing this namespace (any-of semantic). */
  flagKeys: string[];
  /** Sub-service probes to render in the inventory panel. */
  subServices: SubServiceProbe[];
  /** One representative happy-path try-it endpoint. */
  tryIt: TryItEndpoint;
  /** Batch letter (A–J) for the on-page badge. */
  batch: string;
  /** Page icon (lucide). */
  icon: React.ElementType;
}

export interface ProbeResult {
  state: 'ok' | 'flag_off' | 'unauth' | 'no_scope' | 'error';
  status: number;
  body?: unknown;
  error?: string;
}

// ─── Fetch helpers ──────────────────────────────────────────────────────────

/**
 * localStorage slot operators paste an admin-scoped SDK key into so the
 * Console can hit /api/nv5/* end-to-end (mirrors the pattern used by
 * `client/src/pages/sdk-api-playground.tsx`). When unset, calls fall back
 * to JWT-only — which is rejected by /api/nv5/* sub-routes with 401
 * BEARER_NOT_SDK_KEY, surfaced in the UI by the StateChip.
 */
export const ADMIN_SDK_KEY_SLOT = 'nyv.admin.sdkKey';

/**
 * Build the canonical Console request headers: Authorization: Bearer <jwt>
 * from localStorage('token') (matches `apiRequest` in
 * client/src/lib/queryClient.ts) PLUS the canonical `X-API-Key` header when
 * an admin SDK key has been provisioned. This is the SAME header set that
 * server-side `extractSdkApiKey` accepts (NV-AUTH-HEADER-001).
 */
function nv5Headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set('Accept', 'application/json');
  if (typeof window !== 'undefined') {
    const jwt = getAuthToken();
    if (jwt && !h.has('Authorization')) h.set('Authorization', `Bearer ${jwt}`);
    const sdk = window.localStorage.getItem(ADMIN_SDK_KEY_SLOT);
    if (sdk && !h.has('X-API-Key')) h.set('X-API-Key', sdk);
  }
  return h;
}

async function probeUrl(url: string, init?: RequestInit): Promise<ProbeResult> {
  try {
    const res = await fetch(url, {
      credentials: 'include',
      ...init,
      headers: nv5Headers(init?.headers),
    });
    if (res.status === 404) return { state: 'flag_off', status: 404 };
    if (res.status === 401) return { state: 'unauth',   status: 401 };
    if (res.status === 403) return { state: 'no_scope', status: 403 };
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { state: 'error', status: res.status, error: txt.slice(0, 240) };
    }
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await res.json().catch(() => null) : await res.text();
    return { state: 'ok', status: res.status, body };
  } catch (e: unknown) {
    return { state: 'error', status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─── Atoms ──────────────────────────────────────────────────────────────────

export function StateChip({ state, status }: { state: ProbeResult['state']; status: number }) {
  if (state === 'ok')        return <Badge className="bg-emerald-600">live · {status}</Badge>;
  if (state === 'flag_off')  return <Badge variant="secondary"><Lock className="w-3 h-3 mr-1" /> flag OFF · 404</Badge>;
  if (state === 'unauth')    return <Badge variant="destructive">unauth · 401</Badge>;
  if (state === 'no_scope')  return <Badge variant="destructive">no admin scope · 403</Badge>;
  return <Badge variant="destructive">error · {status || 'NET'}</Badge>;
}

function HelpHint({ state }: { state: ProbeResult['state'] }) {
  if (state === 'flag_off') {
    return (
      <p className="text-xs text-slate-700 mt-2">
        Feature flag is OFF in this environment. Set the corresponding{' '}
        <code className="px-1 bg-slate-100 rounded">JRX_F_*</code> flag to{' '}
        <code>1</code> in the gateway environment and restart. See{' '}
        <code>docs/canonical/00-README.md</code> § feature flags.
      </p>
    );
  }
  if (state === 'no_scope') {
    return (
      <p className="text-xs text-slate-700 mt-2">
        Caller is authenticated but lacks the <code className="px-1 bg-slate-100 rounded">admin</code>{' '}
        scope. Provision an admin-scoped SDK key and inject it server-side.
      </p>
    );
  }
  if (state === 'unauth') {
    return (
      <p className="text-xs text-slate-700 mt-2">
        No SDK key on the request. Most <code>/api/nv5/*</code> sub-routes require
        an admin-scoped SDK key — Console JWT alone is rejected with{' '}
        <code className="px-1 bg-slate-100 rounded">BEARER_NOT_SDK_KEY</code>.
      </p>
    );
  }
  return null;
}

// ─── Feature-flag panel ─────────────────────────────────────────────────────

interface FlagSnapshot {
  flags: Record<string, { env: string; on: boolean; source?: 'overlay' | 'env' | 'default'; envOn?: boolean }>;
  count: number;
  sdkKeyPresent: boolean;
  capturedAt: string;
}

function useFeatureFlags() {
  return useQuery<{ success: boolean; data: FlagSnapshot }, Error>({
    queryKey: ['nyv.admin.feature-flags'],
    queryFn: async () => {
      const res = await fetch(nv('admin/feature-flags'), {
        credentials: 'include',
        headers: nv5Headers(),
      });
      if (!res.ok) throw new Error(`feature-flags HTTP ${res.status}`);
      return res.json();
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

/**
 * Task #114 — click-to-toggle chip for a single JRX_F_* feature flag.
 *
 * Behaviour matrix (deliberately small — one click does one thing):
 *   - non-super_admin caller → renders a static chip (no click handler).
 *   - default click          → writes an explicit overlay row with the
 *                              OPPOSITE of the currently effective value
 *                              (ON → overlay=false, OFF → overlay=true).
 *                              This is symmetric whether the current value
 *                              came from env or from a previous overlay.
 *   - shift+click            → clears the overlay row and lets the value
 *                              fall back to env / default. Only meaningful
 *                              when source === 'overlay'; on env/default
 *                              chips it is a no-op DELETE.
 *
 * On success the React-Query cache for `['nyv.admin.feature-flags']` is
 * invalidated so chips across the page tree refetch within ~1s
 * (matches Task #114 acceptance criteria).
 */
function ToggleableFlagChip({
  flagKey,
  snap,
  isSuperAdmin,
}: {
  flagKey: string;
  snap?: { env: string; on: boolean; source?: 'overlay' | 'env' | 'default'; envOn?: boolean };
  isSuperAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const on = !!snap?.on;
  const env = snap?.env ?? flagKey;
  const source = snap?.source;
  const overlayActive = source === 'overlay';

  async function patch(value: boolean | null, reason: string) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`${NV_BASE}admin/feature-flags/${encodeURIComponent(flagKey)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: nv5Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ value, reason }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}${txt ? ` · ${txt.slice(0, 160)}` : ''}`);
      }
      // Invalidate so every chip on the page refetches with the new state.
      await qc.invalidateQueries({ queryKey: ['nyv.admin.feature-flags'] });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Compute the next overlay write for a given gesture.
  //   - shiftKey  → clear overlay (value=null) so env/default is restored.
  //   - default   → write the OPPOSITE of the currently effective value.
  // Both branches map onto the PATCH contract: { value: boolean|null }.
  function nextWriteFor(shiftKey: boolean): { value: boolean | null; reason: string } {
    if (shiftKey) return { value: null, reason: 'console clear overlay' };
    return { value: !on, reason: on ? 'console disable' : 'console enable' };
  }

  function trigger(shiftKey: boolean) {
    if (!isSuperAdmin || busy) return;
    const { value, reason } = nextWriteFor(shiftKey);
    void patch(value, reason);
  }

  function handleClick(ev: React.MouseEvent<HTMLDivElement>) {
    trigger(ev.shiftKey);
  }
  function handleKeyDown(ev: React.KeyboardEvent<HTMLDivElement>) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      trigger(ev.shiftKey);
    }
  }

  const clickable = isSuperAdmin && !busy;
  const tooltip = isSuperAdmin
    ? `${env} · source=${source ?? (on ? 'env' : 'default')}` +
      (overlayActive ? ' (overlay row in DB)' : '') +
      ` · click to ${on ? 'turn OFF' : 'turn ON'}` +
      (overlayActive ? ', shift+click to clear overlay' : '')
    : env;

  return (
    <Badge
      variant={on ? 'default' : 'secondary'}
      className={[
        on ? 'bg-emerald-600' : '',
        overlayActive ? 'ring-2 ring-amber-400 ring-offset-1' : '',
        clickable ? 'cursor-pointer hover:opacity-80' : '',
        busy ? 'opacity-50' : '',
      ].filter(Boolean).join(' ')}
      title={err ?? tooltip}
      onClick={clickable ? handleClick : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? handleKeyDown : undefined}
      data-testid={`flag-chip-${flagKey}`}
      data-flag-on={on ? '1' : '0'}
      data-flag-source={source ?? ''}
    >
      {busy
        ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" />
        : on
          ? <CheckCircle2 className="w-3 h-3 mr-1" />
          : <Lock className="w-3 h-3 mr-1" />}
      {env} · {on ? 'ON' : 'OFF'}
      {overlayActive && <span className="ml-1 text-[10px] opacity-80">(overlay)</span>}
    </Badge>
  );
}

function FlagsHeader({ cfg }: { cfg: NamespaceConfig }) {
  const { data, isLoading, isError } = useFeatureFlags();
  const { user } = useAuth();
  const isSuperAdmin = (user as { role?: string } | null)?.role === 'super_admin';
  const flags = data?.data?.flags ?? {};
  const relevant = cfg.flagKeys.map(k => ({ key: k, snap: flags[k] }));
  const anyOn = relevant.some(r => r.snap?.on);

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="header-flag-chips">
      {isLoading && <Badge variant="outline">loading flags…</Badge>}
      {isError && <Badge variant="destructive">flags · unreachable</Badge>}
      {!isLoading && !isError && relevant.map(r => (
        <ToggleableFlagChip
          key={r.key}
          flagKey={r.key}
          snap={r.snap}
          isSuperAdmin={isSuperAdmin}
        />
      ))}
      {!isLoading && !isError && !anyOn && (
        <Badge variant="outline" className="border-amber-500 text-amber-700">
          <AlertTriangle className="w-3 h-3 mr-1" /> namespace dark
        </Badge>
      )}
      {!isLoading && !isError && isSuperAdmin && relevant.length > 0 && (
        <span className="text-[10px] text-slate-700 ml-1" data-testid="flag-toggle-hint">
          super_admin · click chip to toggle
        </span>
      )}
    </div>
  );
}

// ─── Admin SDK key controller ───────────────────────────────────────────────

/**
 * Lets a super-admin paste an admin-scoped SDK key into the
 * `nyv.admin.sdkKey` localStorage slot read by `nv5Headers()`. With the key
 * set, every fetch in this page family includes the canonical `X-API-Key`
 * header (NV-AUTH-HEADER-001) and the /api/nv5/* sub-routes return live data
 * end-to-end. Without it, calls fall back to JWT-only and the StateChip
 * surfaces 401 BEARER_NOT_SDK_KEY explicitly.
 *
 * This is the same operator workflow used by /sdk-hub?tab=tester and
 * /sdk-api-playground — the Console intentionally does not auto-inject a
 * server-side admin key (no shared admin secret in the browser session).
 */
function AdminSdkKeyControl() {
  const [key, setKey] = useState<string>(() =>
    typeof window !== 'undefined' ? (window.localStorage.getItem(ADMIN_SDK_KEY_SLOT) ?? '') : ''
  );
  const [draft, setDraft] = useState<string>(key);
  const masked = key ? `${key.slice(0, 6)}…${key.slice(-4)}` : '';

  function save() {
    window.localStorage.setItem(ADMIN_SDK_KEY_SLOT, draft.trim());
    setKey(draft.trim());
    // Force every Platform-v5 query to refetch with the new key.
    window.dispatchEvent(new StorageEvent('storage', { key: ADMIN_SDK_KEY_SLOT }));
  }
  function clear() {
    window.localStorage.removeItem(ADMIN_SDK_KEY_SLOT);
    setKey(''); setDraft('');
  }

  return (
    <Card data-testid="admin-sdk-key-control" className={key ? 'border-emerald-500' : 'border-slate-300'}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Lock className="w-4 h-4" />
          Admin SDK key
          {key
            ? <Badge className="bg-emerald-600">configured · {masked}</Badge>
            : <Badge variant="outline">not set — try-it will return 401</Badge>}
        </CardTitle>
        <CardDescription>
          Paste an admin-scoped SDK key. It is sent as the canonical{' '}
          <code>X-API-Key</code> header (NV-AUTH-HEADER-001) on every probe + try-it.
          Stored in <code>localStorage['{ADMIN_SDK_KEY_SLOT}']</code> only — never
          transmitted off-device except as the X-API-Key header.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          placeholder="nv_admin_… (paste here)"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          className="font-mono text-xs"
          data-testid="input-admin-sdk-key"
        />
        <Button onClick={save} disabled={!draft || draft === key} data-testid="btn-save-sdk-key">Save</Button>
        {key && <Button variant="outline" onClick={clear} data-testid="btn-clear-sdk-key">Clear</Button>}
      </CardContent>
    </Card>
  );
}

// ─── Namespace-disabled banner ──────────────────────────────────────────────

/**
 * Explicit "feature disabled in this environment" banner shown at the top of
 * the page (above all panels) when EVERY flag governing the namespace is OFF.
 * Includes the canonical runbook link so an operator can self-serve the fix
 * without leaving the page. Required by Task #109 acceptance criteria.
 */
function DisabledBanner({ cfg }: { cfg: NamespaceConfig }) {
  const { data, isLoading, isError } = useFeatureFlags();
  if (isLoading || isError || !data?.data?.flags) return null;
  const flags = data.data.flags;
  const relevant = cfg.flagKeys.map(k => flags[k]).filter(Boolean);
  if (relevant.length === 0) return null;
  const allOff = relevant.every(s => !s.on);
  if (!allOff) return null;
  return (
    <Card className="border-amber-500 bg-amber-50" data-testid="disabled-banner">
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-700 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div className="space-y-2 text-sm text-amber-900">
            <p className="font-semibold">Feature disabled in this environment</p>
            <p>
              Every <code className="px-1 bg-amber-100 rounded">JRX_F_*</code> flag governing{' '}
              <code>{cfg.apiPrefix}</code> is currently <strong>OFF</strong>. All sub-routes
              under this namespace will return <code>404</code> until at least one of the
              following flags is enabled in the gateway environment:
            </p>
            <ul className="list-disc list-inside font-mono text-xs">
              {relevant.map((s, i) => (
                <li key={i} data-testid={`disabled-flag-${s.env}`}>{s.env} = OFF</li>
              ))}
            </ul>
            <p className="flex items-center gap-1 text-xs">
              <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
              Runbook: <code className="px-1 bg-amber-100 rounded">docs/canonical/00-README.md</code>
              {' '}§ feature flags · then restart the gateway workflow.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Service-inventory panel ────────────────────────────────────────────────

function InventoryRow({ apiPrefix, svc }: { apiPrefix: string; svc: SubServiceProbe }) {
  // Normalize: collapse any double-slashes that would otherwise appear when
  // svc.path is empty (namespace-root probes like /capabilities). Reviewer
  // flagged `/api/nv5/internal//capabilities` as an environment-specific
  // routing edge — Express normalizes it but downstream proxies may not.
  const url = `${apiPrefix}/${svc.path}${svc.probe}`.replace(/([^:])\/{2,}/g, '$1/');
  const q = useQuery<ProbeResult, Error>({
    queryKey: ['nv5.probe', url],
    queryFn: () => probeUrl(url),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const r = q.data ?? { state: 'error' as const, status: 0 };
  return (
    <li className="flex items-center justify-between border-b py-2 text-sm" data-testid={`inv-row-${svc.path}`}>
      <div className="flex flex-col">
        <span className="font-medium">{svc.label}</span>
        <code className="text-xs text-slate-700">{url}</code>
      </div>
      {q.isLoading
        ? <Badge variant="outline">probing…</Badge>
        : <StateChip state={r.state} status={r.status} />}
    </li>
  );
}

function InventoryPanel({ cfg }: { cfg: NamespaceConfig }) {
  return (
    <Card data-testid="card-inventory">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ListTree className="w-5 h-5" /> Service inventory</CardTitle>
        <CardDescription>
          Live probe of each sub-service under <code>{cfg.apiPrefix}</code>.
          A <code>404</code> here typically means the per-sub-route flag is OFF.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul>
          {cfg.subServices.map(svc => (
            <InventoryRow key={svc.path} apiPrefix={cfg.apiPrefix} svc={svc} />
          ))}
          {cfg.subServices.length === 0 && (
            <li className="text-sm text-slate-600">no sub-services declared</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

// ─── Try-it panel ───────────────────────────────────────────────────────────

/**
 * Task #115: rewrite a direct `/api/nv5/<rest>` URL onto the Console-side
 * proxy `/api/jrx/admin/nv5-proxy/<rest>`. The proxy authenticates the
 * Console JWT (super_admin only), then re-dispatches with the canonical
 * X-API-Key set server-side from `JRX_CONSOLE_ADMIN_SDK_KEY`. URLs that
 * are NOT under `/api/nv5/` (e.g. operator-built custom probes) pass
 * through unchanged so the panel stays a generic try-it harness.
 */
function rewriteThroughProxy(url: string): string {
  const NV5 = '/api/nv5/';
  if (url.startsWith(NV5)) {
    return nv('admin/nv5-proxy/') + url.slice(NV5.length);
  }
  return url;
}

function TryItPanel({ tryIt }: { tryIt: TryItEndpoint }) {
  const [body, setBody] = useState(tryIt.defaultBody ?? '');
  const [result, setResult] = useState<ProbeResult | null>(null);

  const mut = useMutation({
    mutationFn: async () => {
      const init: RequestInit = { method: tryIt.method };
      if (tryIt.method === 'POST') {
        init.headers = { 'Content-Type': 'application/json' };
        init.body = body || '{}';
      }
      return probeUrl(rewriteThroughProxy(tryIt.url), init);
    },
    onSuccess: r => setResult(r),
  });

  return (
    <Card data-testid="card-try-it">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> Try-it</CardTitle>
        <CardDescription>
          {tryIt.description ?? 'Probe one happy-path endpoint for this namespace.'}
          {' '}<code className="text-xs">{tryIt.method} {tryIt.url}</code>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {tryIt.method === 'POST' && (
          <Textarea
            rows={5}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder='{"key": "value"}'
            className="font-mono text-xs"
            data-testid="tryit-body"
          />
        )}
        <div className="flex items-center gap-2">
          <Button onClick={() => mut.mutate()} disabled={mut.isPending} data-testid="btn-tryit-send">
            <RefreshCw className={`w-4 h-4 mr-1 ${mut.isPending ? 'animate-spin' : ''}`} />
            {tryIt.label}
          </Button>
          {result && <StateChip state={result.state} status={result.status} />}
        </div>
        {result && (
          result.state === 'ok'
            ? <pre className="text-xs bg-slate-50 p-2 rounded max-h-72 overflow-auto" data-testid="tryit-result">
                {typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2)}
              </pre>
            : <HelpHint state={result.state} />
        )}
      </CardContent>
    </Card>
  );
}

// ─── Audit-chain panel ──────────────────────────────────────────────────────

interface AuditLog {
  id: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  statusCode?: number;
  createdAt: string;
}

function useAuditScoped(prefix: string) {
  return useQuery<{ matched: AuditLog[]; total: number }, Error>({
    queryKey: ['nyv.admin.audit', prefix],
    queryFn: async () => {
      const res = await fetch(nv('admin/audit?limit=200'), {
        credentials: 'include',
        headers: nv5Headers(),
      });
      if (!res.ok) throw new Error(`audit HTTP ${res.status}`);
      const j = await res.json();
      const all: AuditLog[] = j?.data?.logs ?? [];
      const matched = all.filter(l => typeof l.resourceType === 'string' && l.resourceType.startsWith(prefix)).slice(0, 25);
      return { matched, total: all.length };
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

function AuditPanel({ cfg }: { cfg: NamespaceConfig }) {
  const q = useAuditScoped(cfg.apiPrefix);
  return (
    <Card data-testid="card-audit">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><FileText className="w-5 h-5" /> Audit chain (last 25)</CardTitle>
        <CardDescription>
          Filtered to entries whose <code>resourceType</code> starts with{' '}
          <code>{cfg.apiPrefix}</code>. Source: <code>/api/jrx/admin/audit</code>.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading && <p className="text-sm text-slate-600">loading audit…</p>}
        {q.isError   && <p className="text-sm text-red-600">audit query failed: {q.error.message}</p>}
        {q.data && (
          q.data.matched.length === 0
            ? <p className="text-sm text-slate-600" data-testid="audit-empty">
                no audit entries scoped to <code>{cfg.apiPrefix}</code>{' '}
                (scanned last {q.data.total} platform entries)
              </p>
            : <ul className="space-y-1 text-xs font-mono" data-testid="audit-list">
                {q.data.matched.map(l => (
                  <li key={l.id} className="flex justify-between border-b py-1">
                    <span className="truncate max-w-[60%]">{l.action} · {l.resourceType}</span>
                    <span className="text-slate-700">{l.statusCode ?? '—'} · {new Date(l.createdAt).toLocaleTimeString()}</span>
                  </li>
                ))}
              </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page composer ──────────────────────────────────────────────────────────

export function Nv5NamespacePage({ cfg }: { cfg: NamespaceConfig }) {
  const Icon = cfg.icon;
  return (
    <div className="container mx-auto p-6 space-y-6" data-testid={`page-platform-v5-${cfg.slug}`}>
      <div>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
            <Icon className="w-7 h-7" /> {cfg.title}
            <Badge variant="outline" className="ml-2 text-xs">Batch {cfg.batch}</Badge>
          </h1>
          <FlagsHeader cfg={cfg} />
        </div>
        <p className="text-slate-700 mt-1 max-w-3xl">{cfg.blurb}</p>
        <p className="text-xs text-slate-600 mt-1">
          API prefix: <code>{cfg.apiPrefix}</code>
        </p>
      </div>

      <AdminSdkKeyControl />

      <DisabledBanner cfg={cfg} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <InventoryPanel cfg={cfg} />
        <TryItPanel tryIt={cfg.tryIt} />
      </div>

      <AuditPanel cfg={cfg} />

      <Card>
        <CardHeader><CardTitle className="text-base">Operational notes</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p>
            <strong>Steady-state expectation:</strong> with this namespace's JRX_F_* flag(s) ON
            and <code>JRX_CONSOLE_ADMIN_SDK_KEY</code> set in the gateway environment, the try-it
            form should return real namespace data using only the Console JWT. <em>401 / 403 /
            404 are operator-correctable conditions, not the intended steady state.</em>
          </p>
          <p>
            <strong>Auth (try-it):</strong> the try-it action goes through the Console-side proxy
            <code>/api/jrx/admin/nv5-proxy/*</code> (Task #115) which authenticates your Console JWT
            (<strong>super_admin only</strong>) and re-dispatches to <code>{cfg.apiPrefix}</code> with the canonical
            <code>X-API-Key</code> header (NV-AUTH-HEADER-001) sourced server-side from
            <code>JRX_CONSOLE_ADMIN_SDK_KEY</code>. No SDK secret leaves the gateway. If the env
            is unset, the proxy returns <code>503 CONSOLE_ADMIN_SDK_KEY_NOT_PROVISIONED</code>.
          </p>
          <p>
            <strong>Auth (probes / direct calls):</strong> the inventory + audit panels still
            call sub-routes directly. Provision an admin-scoped SDK key in the
            "Admin SDK key" control above to see <em>live · 200</em> chips; without it, those
            panels surface the canonical <code>BEARER_NOT_SDK_KEY</code> response.
          </p>
          <p>
            <strong>Failure mode:</strong> when the per-sub-route JRX_F_* flag is OFF, the route returns
            <code> 404</code> and the chip renders <em>flag OFF</em>. Flip the flag in the gateway
            environment + restart the gateway workflow to activate.
          </p>
          <p>
            <strong>Runbook:</strong> see <code>docs/canonical/00-README.md</code> for the
            wire-budget and feature-flag operational matrix.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
