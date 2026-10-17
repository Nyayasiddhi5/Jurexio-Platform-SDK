/**
 * Partner LLM Router admin — catalog, providers, router health.
 * Wired to /api/jrx/v1/sdk/llm/* (JWT bypass for analyst+).
 */
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NyvErrorState } from '@/components/NyvErrorState';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
import { Cpu, RefreshCw, Activity, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchJson(path: string) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function LlmRouterAdminPanel() {
  const catalogQ = useQuery({
    queryKey: [nv('v1/sdk/llm/catalog')],
    queryFn: () => fetchJson(nv('v1/sdk/llm/catalog')),
    refetchInterval: 60000,
  });

  const providersQ = useQuery({
    queryKey: [nv('v1/sdk/llm/providers')],
    queryFn: () => fetchJson(nv('v1/sdk/llm/providers')),
    refetchInterval: 30000,
  });

  const healthQ = useQuery({
    queryKey: [nv('v1/sdk/llm/router/health')],
    queryFn: () => fetchJson(nv('v1/sdk/llm/router/health')),
    refetchInterval: 30000,
  });

  const models = catalogQ.data?.data?.models ?? [];
  const providers = providersQ.data?.data?.providers ?? providersQ.data?.data ?? [];
  const health = healthQ.data?.data ?? healthQ.data ?? {};

  const statusIcon = (ok: boolean) =>
    ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />;

  return (
    <div className="p-4 space-y-4 nv-light-scope" data-testid="llm-router-admin">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Cpu className="h-5 w-5 text-[#C7B15B]" /> LLM Router Admin
          </h2>
          <p className="text-sm text-muted-foreground">
            Partner introspection — catalog, provider matrix, router health. Console JWT auth (no SDK keys in UI).
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { catalogQ.refetch(); providersQ.refetch(); healthQ.refetch(); }}
        >
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Catalog models</p>
            <p className="text-2xl font-bold text-foreground">{catalogQ.data?.data?.returned ?? models.length ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Providers</p>
            <p className="text-2xl font-bold text-foreground">{Array.isArray(providers) ? providers.length : '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Router status</p>
            <p className="text-lg font-bold text-foreground flex items-center gap-1">
              <Activity className="h-4 w-4" />
              {health.overallStatus ?? health.status ?? '—'}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Decisions (24h)</p>
            <p className="text-2xl font-bold text-foreground">{health.decisions24h ?? health.recentDecisions ?? '—'}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="catalog">
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="providers">Providers</TabsTrigger>
          <TabsTrigger value="health">Router Health</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="mt-4">
          {catalogQ.isLoading && <Skeleton className="h-48 w-full" />}
          {catalogQ.isError && <NyvErrorState title="Catalog unavailable" onRetry={() => catalogQ.refetch()} variant="card" />}
          {!catalogQ.isLoading && !catalogQ.isError && (
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-foreground">
                  Model catalog ({models.length} shown)
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto pt-0">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2">Model</th>
                      <th className="text-left py-2">Provider</th>
                      <th className="text-right py-2">Context</th>
                      <th className="text-right py-2">$/1M in</th>
                      <th className="text-center py-2">Free</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(models as Array<Record<string, unknown>>).slice(0, 50).map((m) => (
                      <tr key={String(m.id)} className="border-b border-border/50">
                        <td className="py-1.5 font-mono text-foreground">{String(m.id)}</td>
                        <td className="py-1.5 text-muted-foreground">{String(m.provider ?? '—')}</td>
                        <td className="text-right py-1.5">{Number(m.contextWindow ?? 0).toLocaleString()}</td>
                        <td className="text-right py-1.5">{Number(m.costInPer1M ?? 0).toFixed(2)}</td>
                        <td className="text-center py-1.5">{m.isFree ? '✓' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          {providersQ.isLoading && <Skeleton className="h-32 w-full" />}
          {providersQ.isError && <NyvErrorState title="Providers unavailable" onRetry={() => providersQ.refetch()} variant="card" />}
          {!providersQ.isLoading && !providersQ.isError && Array.isArray(providers) && (
            <div className="grid gap-2 md:grid-cols-2">
              {(providers as Array<Record<string, unknown>>).map((p) => {
                const available = p.isAvailable !== false && p.status !== 'unhealthy';
                return (
                  <Card key={String(p.provider ?? p.name)}>
                    <CardContent className="p-3 flex items-center justify-between">
                      <div>
                        <p className="font-medium text-foreground">{String(p.provider ?? p.name)}</p>
                        <p className="text-xs text-muted-foreground">{String(p.status ?? (available ? 'healthy' : 'degraded'))}</p>
                      </div>
                      {statusIcon(available)}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          {healthQ.isLoading && <Skeleton className="h-24 w-full" />}
          {healthQ.isError && <NyvErrorState title="Router health unavailable" onRetry={() => healthQ.refetch()} variant="card" />}
          {!healthQ.isLoading && !healthQ.isError && (
            <Card>
              <CardContent className="p-4 space-y-2">
                {Object.entries(health as Record<string, unknown>).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-sm border-b border-border/50 py-1">
                    <span className="text-muted-foreground capitalize">{k.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-foreground">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                  </div>
                ))}
                {Object.keys(health).length === 0 && (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> No health payload — endpoint may require SDK key scope.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
