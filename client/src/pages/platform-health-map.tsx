/**
 * Platform Health Map — task #304 (Demo G3B)
 *
 * Per-dependency drilldown sourced from /api/jrx/admin/health/full/deps.
 * Each card opens a Sheet with last-success timestamp, p50/p95 latency,
 * 7-day error rate, and last 5 errors. The deps endpoint is a pure
 * read-side aggregator over existing tracer ring buffers and the
 * nv_router_decisions / nv_audit_logs tables.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleSlash,
  RefreshCw,
  Database,
  Cloud,
  Cpu,
  HardDrive,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { NyvErrorState } from '@/components/NyvErrorState';

type Dep = {
  id: string;
  label: string;
  category: 'datastore' | 'llm' | 'storage';
  status: 'healthy' | 'degraded' | 'unhealthy' | 'not_configured' | 'unknown';
  lastSuccessAt: string | null;
  latencyMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  errorRate7d: number | null;
  callCount7d: number | null;
  recentErrors: Array<{ at: string; message: string; context?: string }>;
  details?: Record<string, unknown>;
};

type DepsResponse = {
  deps: Dep[];
  generatedAt: string;
  elapsedMs: number;
};

const DEPS_PATH = '/api/jrx/admin/health/full/deps';
const DEPS_PUBLIC_PATH = '/api/jrx/health/full/deps';

const STATUS_BADGE: Record<Dep['status'], { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  healthy:        { label: 'Healthy',        cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
  degraded:       { label: 'Degraded',       cls: 'bg-amber-100 text-amber-800',     Icon: AlertTriangle },
  unhealthy:      { label: 'Unhealthy',      cls: 'bg-red-100 text-red-800',         Icon: XCircle },
  not_configured: { label: 'Not configured', cls: 'bg-slate-100 text-slate-700',     Icon: CircleSlash },
  unknown:        { label: 'Unknown',        cls: 'bg-slate-100 text-slate-700',     Icon: CircleSlash },
};

const CATEGORY_ICON: Record<Dep['category'], typeof Database> = {
  datastore: Database,
  llm: Cpu,
  storage: HardDrive,
};

function StatusBadge({ status }: { status: Dep['status'] }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.unknown;
  return (
    <Badge className={`text-xs ${cfg.cls}`} data-testid={`status-${status}`}>
      <cfg.Icon className="h-3 w-3 mr-1" />
      {cfg.label}
    </Badge>
  );
}

function fmtLatency(ms: number | null): string {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function fmtRate(r: number | null): string {
  if (r === null || r === undefined) return '—';
  return `${(r * 100).toFixed(2)}%`;
}

function DepCard({ dep, onOpen }: { dep: Dep; onOpen: () => void }) {
  const Icon = CATEGORY_ICON[dep.category] ?? Cloud;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-left w-full"
      data-testid={`dep-card-${dep.id}`}
    >
      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Icon className="h-5 w-5 text-slate-500" />
              <CardTitle className="text-base">{dep.label}</CardTitle>
            </div>
            <StatusBadge status={dep.status} />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-slate-600">p95</div>
              <div className="font-medium text-slate-900">{fmtLatency(dep.p95Ms)}</div>
            </div>
            <div>
              <div className="text-slate-600">err 7d</div>
              <div className="font-medium text-slate-900">{fmtRate(dep.errorRate7d)}</div>
            </div>
            <div className="col-span-2 text-slate-600">
              {dep.lastSuccessAt
                ? `Last OK ${formatDistanceToNow(new Date(dep.lastSuccessAt), { addSuffix: true })}`
                : 'No recent success recorded'}
            </div>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function DepDrawer({ dep, onClose }: { dep: Dep | null; onClose: () => void }) {
  return (
    <Sheet open={!!dep} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-lg overflow-y-auto" data-testid="dep-drawer">
        {dep && (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-2">
                {dep.label}
                <StatusBadge status={dep.status} />
              </SheetTitle>
              <SheetDescription>
                {dep.category === 'llm'
                  ? 'LLM provider — calls, latency, and failures from the router decisions table.'
                  : dep.category === 'datastore'
                    ? 'Datastore dependency — live health probe + tracer span latencies.'
                    : 'Storage dependency — configuration + recent error events.'}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-5">
              <section>
                <h3 className="text-sm font-semibold mb-2">Latency &amp; success</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded border p-2">
                    <div className="text-xs text-slate-700">Last success</div>
                    <div className="font-medium" data-testid="dep-last-success">
                      {dep.lastSuccessAt
                        ? formatDistanceToNow(new Date(dep.lastSuccessAt), { addSuffix: true })
                        : '—'}
                    </div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-slate-700">Live probe</div>
                    <div className="font-medium">{fmtLatency(dep.latencyMs)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-slate-700">p50</div>
                    <div className="font-medium" data-testid="dep-p50">{fmtLatency(dep.p50Ms)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-slate-700">p95</div>
                    <div className="font-medium" data-testid="dep-p95">{fmtLatency(dep.p95Ms)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-slate-700">Error rate (7d)</div>
                    <div className="font-medium" data-testid="dep-error-rate">{fmtRate(dep.errorRate7d)}</div>
                  </div>
                  <div className="rounded border p-2">
                    <div className="text-xs text-slate-700">Calls (7d)</div>
                    <div className="font-medium">{dep.callCount7d ?? '—'}</div>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-sm font-semibold mb-2">Last 5 errors (7d)</h3>
                {dep.recentErrors.length === 0 ? (
                  <p className="text-xs text-slate-700" data-testid="dep-no-errors">
                    No recent errors recorded.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {dep.recentErrors.map((e, i) => (
                      <li
                        key={i}
                        className="rounded border p-2 text-xs"
                        data-testid={`dep-error-${i}`}
                      >
                        <div className="font-medium text-red-700 break-all">{e.message}</div>
                        {e.context && (
                          <div className="text-slate-600 mt-1 break-all">{e.context}</div>
                        )}
                        <div className="text-slate-600 mt-1">
                          {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {dep.details && (
                <section>
                  <h3 className="text-sm font-semibold mb-2">Details</h3>
                  <ScrollArea className="max-h-48 rounded border bg-slate-50">
                    <pre className="text-xs p-2">{JSON.stringify(dep.details, null, 2)}</pre>
                  </ScrollArea>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default function PlatformHealthMap() {
  const [openDep, setOpenDep] = useState<Dep | null>(null);

  // Try the admin path first (full payload requires admin token); the
  // server also exposes the same handler unauthenticated at the public
  // path so operators without admin can still see the map.
  const { data, isLoading, isError, isFetching, refetch } = useQuery<DepsResponse>({
    queryKey: [DEPS_PATH],
    queryFn: async () => {
      const adminRes = await fetch(DEPS_PATH, { credentials: 'include' });
      if (adminRes.ok) return adminRes.json();
      const publicRes = await fetch(DEPS_PUBLIC_PATH, { credentials: 'include' });
      if (!publicRes.ok) throw new Error(`HTTP ${publicRes.status}`);
      return publicRes.json();
    },
    refetchInterval: 30_000,
  });

  const deps = data?.deps ?? [];
  const isUnconfigured = (d: Dep) => d.status === 'not_configured';
  const configuredDeps = deps.filter((d) => !isUnconfigured(d));
  const unconfiguredDeps = deps.filter(isUnconfigured);
  const grouped = {
    datastore: configuredDeps.filter((d) => d.category === 'datastore'),
    llm: configuredDeps.filter((d) => d.category === 'llm'),
    storage: configuredDeps.filter((d) => d.category === 'storage'),
  };
  const configuredCount = configuredDeps.length;
  const totalDeps = deps.length;

  function envHint(d: Dep): string[] {
    const det = (d.details ?? {}) as Record<string, unknown>;
    const missing = Array.isArray((det as any).missingEnv) ? ((det as any).missingEnv as unknown[]).map(String) : [];
    if (missing.length > 0) return missing;
    if (d.id === 'object_storage') return ['DEFAULT_OBJECT_STORAGE_BUCKET_ID', 'PRIVATE_OBJECT_DIR'];
    return [];
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-platform-health-map">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-emerald-50">
            <Activity className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Platform Health Map</h1>
            <p className="text-sm text-slate-700 mt-1">
              Per-dependency live status with latency percentiles, 7-day error rate, and the
              last 5 errors per platform.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {isError && (
        <NyvErrorState
          title="Could not load dependency drilldown"
          description={`Unable to retrieve ${DEPS_PATH}. Sign in as an admin or use ${DEPS_PUBLIC_PATH}.`}
          onRetry={() => refetch()}
        />
      )}

      {isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {!isLoading && !isError && (
        <>
          {totalDeps === 0 && (
            <Card data-testid="deps-empty">
              <CardContent className="py-10 text-center">
                <CircleSlash className="w-8 h-8 mx-auto text-slate-400 mb-2" />
                <p className="text-sm text-slate-700 font-medium">
                  No dependencies reported by the gateway.
                </p>
                <p className="text-xs text-slate-600 mt-1">
                  The /api/jrx/admin/health/full/deps endpoint returned an empty list.
                  Try refreshing or check that the gateway is up.
                </p>
              </CardContent>
            </Card>
          )}

          {totalDeps > 0 && configuredCount === 0 && (
            <Card className="border-amber-200 bg-amber-50" data-testid="deps-all-unconfigured">
              <CardContent className="py-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      No dependencies configured yet
                    </p>
                    <p className="text-xs text-amber-800 mt-1">
                      All {totalDeps} probed providers reported{' '}
                      <code className="px-1 py-0.5 bg-amber-100 rounded">not_configured</code>.
                      Set the env vars listed below in the Replit Secrets panel and refresh.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {(['datastore', 'llm', 'storage'] as const).map((cat) =>
            grouped[cat].length === 0 ? null : (
              <section key={cat}>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 mb-2">
                  {cat === 'datastore' ? 'Datastores' : cat === 'llm' ? 'LLM providers' : 'Storage'}
                </h2>
                <div
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                  data-testid={`deps-group-${cat}`}
                >
                  {grouped[cat].map((d) => (
                    <DepCard key={d.id} dep={d} onOpen={() => setOpenDep(d)} />
                  ))}
                </div>
              </section>
            ),
          )}

          {unconfiguredDeps.length > 0 && (
            <section data-testid="deps-unconfigured-section">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700 mb-2">
                Unconfigured providers ({unconfiguredDeps.length})
              </h2>
              <p className="text-xs text-slate-600 mb-3">
                These providers are recognised by the gateway but have no API keys / env vars set.
                They are excluded from the health rollup until configured.
              </p>
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
                data-testid="deps-group-unconfigured"
              >
                {unconfiguredDeps.map((d) => {
                  const Icon = CATEGORY_ICON[d.category] ?? Cloud;
                  const envs = envHint(d);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setOpenDep(d)}
                      className="text-left w-full"
                      data-testid={`dep-card-unconfigured-${d.id}`}
                    >
                      <Card className="bg-slate-50 border-dashed hover:shadow-sm transition-shadow h-full">
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Icon className="h-5 w-5 text-slate-400" />
                              <CardTitle className="text-base text-slate-700">{d.label}</CardTitle>
                            </div>
                            <StatusBadge status={d.status} />
                          </div>
                        </CardHeader>
                        <CardContent className="pt-0">
                          <div className="text-xs text-slate-600 mb-2 capitalize">{d.category}</div>
                          {envs.length > 0 ? (
                            <div className="space-y-1">
                              <div className="text-xs text-slate-700 font-medium">Set to enable:</div>
                              <div className="flex flex-wrap gap-1">
                                {envs.map((e) => (
                                  <code
                                    key={e}
                                    className="text-[11px] px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-700 font-mono"
                                  >
                                    {e}
                                  </code>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-600">No env-var hint available.</div>
                          )}
                        </CardContent>
                      </Card>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {data && (
            <p className="text-xs text-slate-600">
              Generated {formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })} ·{' '}
              {data.elapsedMs}ms · {totalDeps} dependencies ({configuredCount} configured,{' '}
              {unconfiguredDeps.length} unconfigured)
            </p>
          )}
        </>
      )}

      <DepDrawer dep={openDep} onClose={() => setOpenDep(null)} />
    </div>
  );
}
