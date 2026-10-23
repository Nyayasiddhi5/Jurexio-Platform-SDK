/**
 * Policy Enforcement Monitoring — task-298 (Demo G1B).
 *
 * Live counters for the consent-gate / policy-enforcement loop, fed by
 * /api/jrx/compliance/policy-enforcement (nv_cam_actions + nv_policy_violations).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Shield, ShieldAlert, ShieldOff, RefreshCw, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

interface EnfResp {
  success: boolean;
  generatedAt: string;
  window_days: number;
  jurisdiction: string;
  mode: 'enforcement' | 'observation';
  counters: {
    requests_evaluated: number;
    allows: number;
    soft_blocks: number;
    hard_blocks: number;
    open_violations: number;
  };
  by_framework: Array<{ framework: string; severity: string; status: string; count: number }>;
  by_severity:  Array<{ severity: string; status: string; count: number }>;
  recent_violations: Array<{
    id: number; severity: string; status: string; source: string; description: string;
    detectedAt: string; orgId: number; policyCode: string; policyName: string; jurisdiction: string;
  }>;
}

const jget = nvFetchJson;

const SEVERITY_COLOR: Record<string, string> = {
  critical: 'text-rose-700 bg-rose-100 border-rose-200',
  high:     'text-orange-700 bg-orange-100 border-orange-200',
  medium:   'text-amber-800 bg-amber-100 border-amber-200',
  low:      'text-slate-700 bg-slate-100 border-slate-200',
};

export default function EnforcementMonitoring() {
  const [jur, setJur] = useState<'ALL' | 'US' | 'IN'>('ALL');
  const [days, setDays] = useState(1);

  const url = `${p('COMPLIANCE_POLICY_ENFORCEMENT')}?jurisdiction=${jur}&days=${days}`;
  const q = useQuery<EnfResp>({
    queryKey: ['policy-enforcement', jur, days],
    queryFn: () => jget<EnfResp>(url),
    refetchInterval: 30_000,
    refetchOnWindowFocus: false,
  });

  const c = q.data?.counters;

  return (
    <div className="min-h-screen p-6 bg-[#F9FAFB]" data-testid="page-enforcement-monitoring">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <Activity className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
            Policy Enforcement Monitoring
          </h1>
          <Badge variant="outline" className="ml-2">Demo G1B</Badge>
          {q.data && (
            <Badge variant={q.data.mode === 'enforcement' ? 'destructive' : 'secondary'} className="ml-1">
              {q.data.mode}
            </Badge>
          )}
        </div>
        <p className="text-sm text-slate-600 mb-5">
          Live counters off the consent-gate / CAM event stream and the policy-violation ledger.
          Auto-refreshes every 30 seconds.
        </p>

        {/* Filter strip */}
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <div>
            <div className="text-xs text-slate-700 mb-1">Jurisdiction</div>
            <div className="flex gap-1.5" data-testid="filter-jurisdiction">
              {(['ALL', 'US', 'IN'] as const).map(j => (
                <button
                  key={j}
                  onClick={() => setJur(j)}
                  data-testid={`btn-jur-${j.toLowerCase()}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    jur === j ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  {j}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-700 mb-1">Window</div>
            <div className="flex gap-1.5">
              {[1, 7, 30].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  data-testid={`btn-days-${d}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    days === d ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  {d === 1 ? '24h' : `${d}d`}
                </button>
              ))}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="btn-refresh-enforcement">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${q.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          {q.data && (
            <div className="ml-auto text-xs text-slate-700">
              Updated {new Date(q.data.generatedAt).toLocaleTimeString()}
            </div>
          )}
        </div>

        {/* KPI tiles */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-5">
          <Tile icon={<Activity className="w-4 h-4" />} label="Requests evaluated" value={c?.requests_evaluated} color="text-slate-900" testid="kpi-evaluated" loading={q.isLoading} />
          <Tile icon={<Shield className="w-4 h-4" />} label="Allowed" value={c?.allows} color="text-emerald-700" testid="kpi-allows" loading={q.isLoading} />
          <Tile icon={<ShieldAlert className="w-4 h-4" />} label="Soft-blocked" value={c?.soft_blocks} color="text-amber-700" testid="kpi-soft" loading={q.isLoading} />
          <Tile icon={<ShieldOff className="w-4 h-4" />} label="Hard-blocked" value={c?.hard_blocks} color="text-rose-700" testid="kpi-hard" loading={q.isLoading} />
          <Tile icon={<AlertTriangle className="w-4 h-4" />} label="Open violations" value={c?.open_violations} color="text-orange-700" testid="kpi-open" loading={q.isLoading} />
        </div>

        <div className="grid lg:grid-cols-2 gap-5">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Breaches by framework</CardTitle></CardHeader>
            <CardContent>
              {q.isLoading && <Skeleton className="h-32" />}
              {q.data && q.data.by_framework.length === 0 && (
                <div className="text-sm text-slate-700 py-4">No CAM breach signals in this window.</div>
              )}
              {q.data && q.data.by_framework.length > 0 && (
                <table className="w-full text-sm" data-testid="table-by-framework">
                  <thead className="text-xs text-slate-700 uppercase">
                    <tr><th className="text-left py-1.5">Framework</th><th className="text-left">Severity</th><th className="text-left">Status</th><th className="text-right">Count</th></tr>
                  </thead>
                  <tbody>
                    {q.data.by_framework.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="py-1.5 font-mono text-xs">{r.framework}</td>
                        <td><span className={`px-1.5 py-0.5 rounded text-xs border ${SEVERITY_COLOR[r.severity] ?? ''}`}>{r.severity}</span></td>
                        <td className="text-slate-600 text-xs">{r.status}</td>
                        <td className="text-right font-medium">{r.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Recent violations</CardTitle></CardHeader>
            <CardContent>
              {q.isLoading && <Skeleton className="h-32" />}
              {q.data && q.data.recent_violations.length === 0 && (
                <div className="text-sm text-slate-700 py-4">Nothing flagged in this window — operating cleanly.</div>
              )}
              <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="list-recent-violations">
                {q.data?.recent_violations.map(v => (
                  <div key={v.id} className="border border-slate-200 rounded-md p-2.5">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded text-xs border ${SEVERITY_COLOR[v.severity] ?? ''}`}>{v.severity}</span>
                      <span className="font-mono text-xs text-slate-600">{v.policyCode}</span>
                      <Badge variant="outline" className="text-xs">{v.jurisdiction}</Badge>
                      <span className="ml-auto text-xs text-slate-600">{new Date(v.detectedAt).toLocaleTimeString()}</span>
                    </div>
                    <div className="text-sm text-slate-800">{v.policyName}</div>
                    <div className="text-xs text-slate-700 mt-0.5">{v.description}</div>
                    <div className="text-xs text-slate-600 mt-1">org-{v.orgId} · source={v.source} · {v.status}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({ icon, label, value, color, testid, loading }: {
  icon: React.ReactNode; label: string; value?: number; color: string; testid: string; loading: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4" data-testid={testid}>
        <div className="flex items-center gap-1.5 text-xs text-slate-700 mb-1">{icon}{label}</div>
        {loading
          ? <Skeleton className="h-7 w-16" />
          : <div className={`text-2xl font-bold ${color}`}>{(value ?? 0).toLocaleString()}</div>}
      </CardContent>
    </Card>
  );
}
