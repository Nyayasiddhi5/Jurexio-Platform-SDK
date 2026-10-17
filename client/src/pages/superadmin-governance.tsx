/**
 * Jurexio Super Admin — Governance Surface (Batch D, 2026-05-10)
 *
 * Read-only operator dashboard for the 5 cross-cutting governance services
 * wired in Session-10 Batch D. Consumes /api/nv5/gov/*:
 *   - GET  /maker-checker/queue
 *   - GET  /security-monitor/status
 *   - GET  /cost-optimizer/status
 *   - GET  /concurrency/snapshot
 *   - GET  /org-ratelimit/check/:orgId/:userId
 *   - POST /org-ratelimit/cache/:orgId/invalidate  (admin cache flush)
 *
 * All endpoints are flag-gated (JRX_F_GOV_*) and admin-scope-gated. When the
 * flags are OFF (default), each panel renders a "feature flag OFF" hint
 * instead of an error. When the user lacks the admin scope, panels render
 * a "403 / scope missing" hint. No mutation surface other than the org-
 * ratelimit cache invalidate (gated by the SAME flag as the read).
 */
import React, { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  ShieldCheck, GitPullRequest, DollarSign, Activity, Gauge, RefreshCw,
  AlertTriangle, CheckCircle2, Clock, Lock,
} from 'lucide-react';

type GovEndpoint =
  | '/api/nv5/gov/maker-checker/queue'
  | '/api/nv5/gov/security-monitor/status'
  | '/api/nv5/gov/cost-optimizer/status'
  | '/api/nv5/gov/concurrency/snapshot';

interface FetchResult<T = unknown> {
  state: 'ok' | 'flag_off' | 'no_scope' | 'unauth' | 'error';
  status: number;
  data?: T;
  error?: string;
}

async function govFetch<T = unknown>(path: GovEndpoint): Promise<FetchResult<T>> {
  try {
    const res = await fetch(path, {
      credentials: 'include',
      headers: { 'Accept': 'application/json' },
    });
    if (res.status === 404) return { state: 'flag_off', status: 404 };
    if (res.status === 401) return { state: 'unauth', status: 401 };
    if (res.status === 403) return { state: 'no_scope', status: 403 };
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { state: 'error', status: res.status, error: text.slice(0, 240) };
    }
    return { state: 'ok', status: res.status, data: (await res.json()) as T };
  } catch (e: unknown) {
    return { state: 'error', status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

function StateChip({ state, status }: { state: FetchResult['state']; status: number }) {
  if (state === 'ok')        return <Badge className="bg-emerald-600">live · {status}</Badge>;
  if (state === 'flag_off')  return <Badge variant="secondary"><Lock className="w-3 h-3 mr-1" /> flag OFF · 404</Badge>;
  if (state === 'unauth')    return <Badge variant="destructive">unauth · 401</Badge>;
  if (state === 'no_scope')  return <Badge variant="destructive">no admin scope · 403</Badge>;
  return <Badge variant="destructive">error · {status || 'NET'}</Badge>;
}

function HelpHint({ state }: { state: FetchResult['state'] }) {
  if (state === 'flag_off') {
    return (
      <p className="text-xs text-slate-700 mt-2">
        This panel is gated by an <code className="px-1 bg-slate-100 rounded">JRX_F_GOV_*</code> feature flag.
        Set the corresponding flag to <code>1</code> in the gateway environment and restart to enable.
        Default is OFF — Batch D ships dark.
      </p>
    );
  }
  if (state === 'no_scope') {
    return (
      <p className="text-xs text-slate-700 mt-2">
        Your SDK key is authenticated but lacks the <code className="px-1 bg-slate-100 rounded">admin</code> scope.
        Provision an admin-scoped key (or a wildcard <code>*</code> key) via the SDK key management surface.
      </p>
    );
  }
  if (state === 'unauth') {
    return (
      <p className="text-xs text-slate-700 mt-2">
        No SDK key on the request. The console must inject a server-side admin key
        for these read-only governance endpoints (the user JWT alone is rejected with
        <code className="px-1 bg-slate-100 rounded">BEARER_NOT_SDK_KEY</code>).
      </p>
    );
  }
  return null;
}

// ─── Panels ─────────────────────────────────────────────────────────────────

function MakerCheckerPanel() {
  const q = useQuery({
    queryKey: ['gov.maker-checker.queue'],
    queryFn: () => govFetch<{ count: number; reviews: Array<{ requestId: string; priority: string; reason: string; iterations: number; deadline: number; createdAt: number }> }>('/api/nv5/gov/maker-checker/queue'),
    refetchInterval: 30_000,
  });
  const r = q.data;
  const reviews = r?.state === 'ok' ? r.data?.reviews ?? [] : [];

  return (
    <Card data-testid="gov-card-maker-checker">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><GitPullRequest className="w-5 h-5" /> Maker-Checker HITL Queue</CardTitle>
          {r && <StateChip state={r.state} status={r.status} />}
        </div>
        <CardDescription>
          GET <code>/api/nv5/gov/maker-checker/queue</code> · flag <code>JRX_F_GOV_MAKER_CHECKER</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {r?.state === 'ok' ? (
          <>
            <div className="text-3xl font-bold mb-2" data-testid="text-mc-count">{r.data?.count ?? 0}</div>
            <p className="text-sm text-slate-700 mb-3">pending human reviews</p>
            <ul className="space-y-1 text-sm">
              {reviews.slice(0, 5).map(rv => (
                <li key={rv.requestId} className="flex items-center justify-between border-b py-1">
                  <span className="font-mono text-xs">{rv.requestId}</span>
                  <Badge variant={rv.priority === 'urgent' ? 'destructive' : 'secondary'}>{rv.priority}</Badge>
                </li>
              ))}
              {reviews.length === 0 && <li className="text-slate-600">queue empty</li>}
            </ul>
          </>
        ) : <HelpHint state={r?.state ?? 'error'} />}
      </CardContent>
    </Card>
  );
}

function SecurityMonitorPanel() {
  const q = useQuery({
    queryKey: ['gov.security-monitor.status'],
    queryFn: () => govFetch<{ middlewareLoaded: boolean; mountedGlobally: boolean; thresholds: { maxExecDepth: number; attackWindowMs: number; attackThreshold: number } }>('/api/nv5/gov/security-monitor/status'),
    refetchInterval: 60_000,
  });
  const r = q.data;
  return (
    <Card data-testid="gov-card-security-monitor">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="w-5 h-5" /> Security Monitor</CardTitle>
          {r && <StateChip state={r.state} status={r.status} />}
        </div>
        <CardDescription>
          GET <code>/api/nv5/gov/security-monitor/status</code> · flag <code>JRX_F_GOV_SECURITY_MON</code> (OR-aliased with <code>JRX_F_SECURITY_MONITOR</code>)
        </CardDescription>
      </CardHeader>
      <CardContent>
        {r?.state === 'ok' && r.data ? (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              {r.data.mountedGlobally
                ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                : <AlertTriangle className="w-4 h-4 text-amber-500" />}
              <span>Middleware mounted on <code>/api/jrx/*</code>: <strong>{r.data.mountedGlobally ? 'YES' : 'NO'}</strong></span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3">
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">max exec depth</p><p className="text-lg font-semibold">{r.data.thresholds.maxExecDepth}</p></div>
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">attack window</p><p className="text-lg font-semibold">{Math.round(r.data.thresholds.attackWindowMs / 60000)}m</p></div>
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">attack threshold</p><p className="text-lg font-semibold">{r.data.thresholds.attackThreshold}</p></div>
            </div>
          </div>
        ) : <HelpHint state={r?.state ?? 'error'} />}
      </CardContent>
    </Card>
  );
}

function CostOptimizerPanel() {
  const q = useQuery({
    queryKey: ['gov.cost-optimizer.status'],
    queryFn: () => govFetch<Record<string, unknown>>('/api/nv5/gov/cost-optimizer/status'),
    refetchInterval: 30_000,
  });
  const r = q.data;
  return (
    <Card data-testid="gov-card-cost-optimizer">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><DollarSign className="w-5 h-5" /> Cost Optimizer</CardTitle>
          {r && <StateChip state={r.state} status={r.status} />}
        </div>
        <CardDescription>
          GET <code>/api/nv5/gov/cost-optimizer/status</code> · flag <code>JRX_F_GOV_COST_OPT</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        {r?.state === 'ok' ? (
          <pre className="text-xs bg-slate-50 p-2 rounded max-h-48 overflow-auto" data-testid="pre-cost-opt-json">
            {JSON.stringify(r.data, null, 2)}
          </pre>
        ) : <HelpHint state={r?.state ?? 'error'} />}
      </CardContent>
    </Card>
  );
}

function ConcurrencyPanel() {
  const q = useQuery({
    queryKey: ['gov.concurrency.snapshot'],
    queryFn: () => govFetch<{ summary: { activeTenants: number; activeProviders: number; totalInFlight: number; totalQueued: number }; tenants: Array<{ tenantId: string; inFlight: number; queued: number; limit: number }> }>('/api/nv5/gov/concurrency/snapshot'),
    refetchInterval: 5_000,
  });
  const r = q.data;
  return (
    <Card data-testid="gov-card-concurrency">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Gauge className="w-5 h-5" /> Concurrency Governor</CardTitle>
          {r && <StateChip state={r.state} status={r.status} />}
        </div>
        <CardDescription>
          GET <code>/api/nv5/gov/concurrency/snapshot</code> · flag <code>JRX_F_GOV_CONCURRENCY</code> · refreshes every 5 s
        </CardDescription>
      </CardHeader>
      <CardContent>
        {r?.state === 'ok' && r.data?.summary ? (
          <>
            <div className="grid grid-cols-4 gap-2 mb-3">
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">tenants</p><p className="text-2xl font-bold">{r.data.summary.activeTenants}</p></div>
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">providers</p><p className="text-2xl font-bold">{r.data.summary.activeProviders}</p></div>
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">in-flight</p><p className="text-2xl font-bold">{r.data.summary.totalInFlight}</p></div>
              <div className="p-2 rounded bg-slate-50"><p className="text-xs text-slate-700">queued</p><p className="text-2xl font-bold">{r.data.summary.totalQueued}</p></div>
            </div>
            {(r.data.tenants ?? []).length > 0 && (
              <ul className="space-y-1 text-xs font-mono">
                {r.data.tenants.slice(0, 8).map(t => (
                  <li key={t.tenantId} className="flex justify-between border-b py-1">
                    <span>{t.tenantId}</span>
                    <span>{t.inFlight}/{t.limit} in-flight · {t.queued} queued</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : <HelpHint state={r?.state ?? 'error'} />}
      </CardContent>
    </Card>
  );
}

function OrgRateLimitPanel() {
  const { toast } = useToast();
  const [orgId, setOrgId] = useState('default');
  const [userId, setUserId] = useState('admin');
  const [result, setResult] = useState<FetchResult<unknown> | null>(null);

  const checkMut = useMutation({
    mutationFn: () => govFetch(`/api/nv5/gov/org-ratelimit/check/${encodeURIComponent(orgId)}/${encodeURIComponent(userId)}` as GovEndpoint),
    onSuccess: r => setResult(r),
  });
  const invalidateMut = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/nv5/gov/org-ratelimit/cache/${encodeURIComponent(orgId)}/invalidate`, {
        method: 'POST', credentials: 'include', headers: { 'Accept': 'application/json' },
      });
      return res;
    },
    onSuccess: res => toast({ title: res.ok ? 'Cache invalidated' : `Failed (${res.status})` }),
  });

  return (
    <Card data-testid="gov-card-org-ratelimit">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2"><Activity className="w-5 h-5" /> Org Rate Limiter</CardTitle>
          {result && <StateChip state={result.state} status={result.status} />}
        </div>
        <CardDescription>
          GET <code>/api/nv5/gov/org-ratelimit/check/:orgId/:userId</code> · POST <code>/cache/:orgId/invalidate</code> · flag <code>JRX_F_GOV_ORG_RATELIMIT</code>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-2 items-end mb-3">
          <div className="flex-1"><label className="text-xs text-slate-700">orgId</label><Input value={orgId} onChange={e => setOrgId(e.target.value)} data-testid="input-orl-orgid" /></div>
          <div className="flex-1"><label className="text-xs text-slate-700">userId</label><Input value={userId} onChange={e => setUserId(e.target.value)} data-testid="input-orl-userid" /></div>
          <Button onClick={() => checkMut.mutate()} disabled={checkMut.isPending} data-testid="btn-orl-check">
            <RefreshCw className={`w-4 h-4 ${checkMut.isPending ? 'animate-spin' : ''}`} />
            <span className="ml-1">Check</span>
          </Button>
          <Button variant="outline" onClick={() => invalidateMut.mutate()} disabled={invalidateMut.isPending} data-testid="btn-orl-invalidate">
            Invalidate cache
          </Button>
        </div>
        {result?.state === 'ok' ? (
          <pre className="text-xs bg-slate-50 p-2 rounded max-h-32 overflow-auto" data-testid="pre-orl-result">
            {JSON.stringify(result.data, null, 2)}
          </pre>
        ) : result ? <HelpHint state={result.state} /> : (
          <p className="text-xs text-slate-600 flex items-center gap-1"><Clock className="w-3 h-3" /> click Check to probe the live rate-limit decision</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SuperAdminGovernance() {
  return (
    <div className="container mx-auto p-6 space-y-6" data-testid="page-superadmin-governance">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2" data-testid="text-page-title">
          <ShieldCheck className="w-7 h-7" /> Governance Surface
        </h1>
        <p className="text-slate-700 mt-1">
          Read-only operator view of the 5 cross-cutting governance services wired in
          Session-10 Batch D (maker-checker HITL · security monitor · cost optimizer ·
          concurrency governor · per-org rate limiter). All panels are flag-gated and
          admin-scope-gated; default state is OFF — flip <code>JRX_F_GOV_*</code> in
          the gateway environment to activate.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MakerCheckerPanel />
        <SecurityMonitorPanel />
        <CostOptimizerPanel />
        <ConcurrencyPanel />
      </div>

      <OrgRateLimitPanel />

      <Card>
        <CardHeader><CardTitle className="text-base">Operational notes</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-2">
          <p><strong>Auth:</strong> all endpoints require an SDK key with the <code>admin</code> scope (or wildcard <code>*</code>). JWT-shaped Bearer tokens are explicitly rejected with <code>401 BEARER_NOT_SDK_KEY</code>.</p>
          <p><strong>Failure mode:</strong> when the corresponding <code>JRX_F_GOV_*</code> flag is OFF, the route returns <code>404</code> and the panel renders a hint instead of an error toast — this is by design (Batch D ships dark).</p>
          <p><strong>Data freshness:</strong> concurrency snapshot polls every 5 s; cost-opt + maker-checker every 30 s; security-monitor every 60 s. Org rate-limit is on-demand only.</p>
          <p><strong>Out of scope:</strong> the maker-checker mutation surface (<code>submitHumanDecision</code>) remains in the existing HITL flow at <code>/decision-cards</code>. This page is read-only except for the documented org-ratelimit cache invalidate.</p>
        </CardContent>
      </Card>
    </div>
  );
}
