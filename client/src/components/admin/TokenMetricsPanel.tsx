/**
 * Token metrics & cost ledger — Operations Hub tab.
 * Wired to /api/jrx/cost/overview, /api/jrx/cost/trend (super_admin JWT).
 * Links to HTML dashboard at /api/jrx/token-metrics (no secrets in UI).
 */
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { NyvErrorState } from '@/components/NyvErrorState';
import { p } from '@/lib/jrx-api-paths';
import { DollarSign, RefreshCw, TrendingUp, ExternalLink, Coins } from 'lucide-react';

type CostOverview = {
  totalToday?: { usd?: number; tokens?: number; requests?: number };
  totalMtd?: { usd?: number; tokens?: number; requests?: number };
  byProvider?: Array<{ provider: string; usd: number; tokens: number; requests: number }>;
  byModel?: Array<{ model: string; provider: string; usd: number; tokens: number; requests: number }>;
  generatedAt?: string;
};

type CostTrend = {
  days?: Array<{ day: string; usd: number; tokens: number; requests: number }>;
  generatedAt?: string;
};

export default function TokenMetricsPanel() {
  const overviewQ = useQuery<CostOverview>({
    queryKey: [p('COST_OVERVIEW')],
    queryFn: () => fetch(p('COST_OVERVIEW'), { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    refetchInterval: 60000,
  });

  const trendQ = useQuery<CostTrend>({
    queryKey: [p('COST_TREND')],
    queryFn: () => fetch(p('COST_TREND'), { credentials: 'include' }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    }),
    refetchInterval: 60000,
  });

  const d = overviewQ.data;
  const fmtUsd = (n?: number) => `$${Number(n ?? 0).toFixed(4)}`;
  const fmtNum = (n?: number) => (n ?? 0).toLocaleString();

  return (
    <div className="p-4 space-y-4" data-testid="token-metrics-panel">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Coins className="h-5 w-5 text-[#C7B15B]" /> Token Metrics &amp; Cost
          </h2>
          <p className="text-sm text-muted-foreground">
            Aggregated from sdk_usage_metering — super_admin view. No API keys displayed.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { overviewQ.refetch(); trendQ.refetch(); }}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="/api/jrx/token-metrics" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1" /> HTML dashboard
            </a>
          </Button>
        </div>
      </div>

      {overviewQ.isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      )}

      {overviewQ.isError && (
        <NyvErrorState
          title="Cost overview unavailable"
          description="Requires super_admin role."
          onRetry={() => overviewQ.refetch()}
          variant="card"
        />
      )}

      {!overviewQ.isLoading && !overviewQ.isError && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Today (USD)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-foreground">{fmtUsd(d?.totalToday?.usd)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">Today tokens</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-foreground">{fmtNum(d?.totalToday?.tokens)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">MTD (USD)</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-foreground">{fmtUsd(d?.totalMtd?.usd)}</p></CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-xs text-muted-foreground">MTD tokens</CardTitle></CardHeader>
              <CardContent><p className="text-2xl font-bold text-foreground">{fmtNum(d?.totalMtd?.tokens)}</p></CardContent>
            </Card>
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-foreground flex items-center gap-2">
                  <DollarSign className="h-4 w-4" /> By provider (MTD)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2">Provider</th>
                      <th className="text-right py-2">USD</th>
                      <th className="text-right py-2">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(d?.byProvider ?? []).slice(0, 10).map((row) => (
                      <tr key={row.provider} className="border-b border-border/50">
                        <td className="py-1.5 text-foreground">{row.provider}</td>
                        <td className="text-right py-1.5 font-mono">{fmtUsd(row.usd)}</td>
                        <td className="text-right py-1.5 font-mono">{fmtNum(row.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-foreground flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Daily trend (7d)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 overflow-x-auto">
                {trendQ.isLoading && <Skeleton className="h-32" />}
                {trendQ.isError && <p className="text-xs text-muted-foreground">Trend data unavailable</p>}
                {!trendQ.isLoading && !trendQ.isError && (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="text-left py-2">Day</th>
                        <th className="text-right py-2">USD</th>
                        <th className="text-right py-2">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(trendQ.data?.days ?? []).map((row) => (
                        <tr key={row.day} className="border-b border-border/50">
                          <td className="py-1.5 text-foreground">{String(row.day).slice(0, 10)}</td>
                          <td className="text-right py-1.5 font-mono">{fmtUsd(row.usd)}</td>
                          <td className="text-right py-1.5 font-mono">{fmtNum(row.tokens)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          {d?.generatedAt && (
            <Badge variant="outline" className="text-xs">
              Generated {new Date(d.generatedAt).toLocaleString()}
            </Badge>
          )}
        </>
      )}
    </div>
  );
}
