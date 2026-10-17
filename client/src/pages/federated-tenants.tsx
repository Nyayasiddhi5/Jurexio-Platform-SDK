/**
 * Federated Tenant View — wired to /api/jrx/tenants (Session-15 v18 / 2026-05-11).
 * Closes CPO-audit enterprise gap #2.
 * Backend: src/routes/jrx-tenant-management-routes.ts (mounted /api/jrx/tenants).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { JrxEmptyState } from "@/components/JrxEmptyState";
import { JrxErrorState } from "@/components/JrxErrorState";
import { Network } from "lucide-react";

import { nv } from '@/lib/jrx-api-paths';
type Tenant = { id: string; name?: string; tier?: string; status?: string; orgId?: string; createdAt?: string };
type TenantsResp = { ok?: boolean; tenants?: Tenant[]; data?: Tenant[] };

export default function FederatedTenantsPage() {
  const q = useQuery<TenantsResp>({
    queryKey: [nv('tenants')],
    queryFn: () => fetch(nv('tenants')).then(r => r.json()),
    refetchInterval: 60000,
  });
  const tenants = q.data?.tenants ?? q.data?.data ?? [];
  const byTier = tenants.reduce<Record<string, number>>((acc, t) => { const k = t.tier || "unknown"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  const byStatus = tenants.reduce<Record<string, number>>((acc, t) => { const k = t.status || "unknown"; acc[k] = (acc[k] || 0) + 1; return acc; }, {});

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-federated-tenants">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Federated Tenant View</h1>
        <p className="text-sm text-muted-foreground mt-1">Cross-organization tenant aggregation. Wired to /api/jrx/tenants. Closes CPO-audit enterprise gap #2.</p>
      </div>

      {q.isLoading && (
        <Card><CardContent className="p-6 space-y-3" data-testid="loading-tenants">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent></Card>
      )}
      {q.isError && (
        <JrxErrorState
          title="Could not load tenants"
          error={q.error}
          onRetry={() => q.refetch()}
          variant="card"
        />
      )}

      {!q.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total tenants</CardTitle></CardHeader><CardContent><div className="text-3xl font-bold" data-testid="stat-total-tenants">{tenants.length}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">By tier</CardTitle></CardHeader><CardContent><div className="space-y-1">{Object.entries(byTier).map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span>{k}</span><Badge variant="secondary">{v}</Badge></div>)}</div></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">By status</CardTitle></CardHeader><CardContent><div className="space-y-1">{Object.entries(byStatus).map(([k, v]) => <div key={k} className="flex justify-between text-sm"><span>{k}</span><Badge variant={k === "active" ? "default" : "outline"}>{v}</Badge></div>)}</div></CardContent></Card>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Tenants ({tenants.length})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50"><tr className="text-left"><th className="p-2">ID</th><th className="p-2">Name</th><th className="p-2">Org</th><th className="p-2">Tier</th><th className="p-2">Status</th><th className="p-2">Created</th></tr></thead>
            <tbody>
              {q.isLoading ? Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`sk-${i}`}><td colSpan={6} className="p-2"><Skeleton className="h-6 w-full" /></td></tr>
                )) : tenants.length === 0 ? <tr><td colSpan={6} className="p-0"><JrxEmptyState icon={Network} title="No tenants yet" description="Federated tenants will appear here once organizations are onboarded." size="sm" /></td></tr>
                : tenants.map(t => <tr key={t.id} className="border-b hover:bg-muted/30">
                    <td className="p-2 font-mono text-xs">{t.id}</td>
                    <td className="p-2">{t.name || "—"}</td>
                    <td className="p-2 font-mono text-xs">{t.orgId || "—"}</td>
                    <td className="p-2"><Badge variant="outline">{t.tier || "—"}</Badge></td>
                    <td className="p-2"><Badge variant={t.status === "active" ? "default" : "outline"}>{t.status || "—"}</Badge></td>
                    <td className="p-2 text-xs text-muted-foreground">{t.createdAt ? new Date(t.createdAt).toLocaleString() : "—"}</td>
                  </tr>)}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
