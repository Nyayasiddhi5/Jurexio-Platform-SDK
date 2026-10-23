/**
 * DPDPA Compliance Console — task-298 (Demo G1B).
 *
 * Org-wide DPDPA 2023 surface: live consent registry over the last 7 days,
 * 9-principle posture, and Data-Principal-rights / DPO contact metadata.
 * Backed by GET /api/jrx/compliance/dpdpa.
 *
 * Replaces the prior per-user lookup view (which is still reachable via the
 * underlying /api/jrx/consent/:userId endpoint when needed for support).
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, RefreshCw, CheckCircle2, AlertCircle, Users, Mail, Trash2, Download, Globe2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxErrorState } from '@/components/JrxErrorState';
import { p } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

interface DpdpaResp {
  success: boolean;
  framework: string;
  jurisdiction: string;
  window_days: number;
  generatedAt: string;
  consents: {
    total_granted: number;
    total_withdrawn: number;
    total_rows: number;
    by_purpose: Array<{ purpose: string; status: string; count: number }>;
  };
  registry: Array<{
    id: string; principalId: string; purpose: string; status: string; jurisdiction: string;
    orgId: string; grantedAt: string; withdrawnAt?: string; expiresAt?: string; legalBasis: string;
  }>;
  principles: Array<{ code: string; name: string; controlPolicy: string; status: 'compliant' | 'partial' | 'gap' }>;
  data_subject_rights: { access_endpoint: string; delete_endpoint: string; withdraw_endpoint: string; sla_days: number };
  breach_log: { entries: number; last_breach: string | null; notification_sla_hours: number };
  dpo: { appointed: boolean; contact: string };
}

const jget = nvFetchJson;

const STATUS_COLOR: Record<string, string> = {
  granted:   'text-emerald-700 bg-emerald-50 border-emerald-200',
  withdrawn: 'text-rose-700 bg-rose-50 border-rose-200',
  expired:   'text-slate-600 bg-slate-100 border-slate-200',
};
const PRINCIPLE_BADGE: Record<string, { color: string; icon: React.ReactNode }> = {
  compliant: { color: 'bg-emerald-50 border-emerald-200 text-emerald-800', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
  partial:   { color: 'bg-amber-50 border-amber-200 text-amber-800',       icon: <AlertCircle className="w-3.5 h-3.5" /> },
  gap:       { color: 'bg-rose-50 border-rose-200 text-rose-800',          icon: <AlertCircle className="w-3.5 h-3.5" /> },
};

export default function DpdpaCompliance() {
  const [jurisdiction, setJurisdiction] = useState<'ALL' | 'US' | 'IN'>('IN');
  const [days, setDays] = useState(7);

  const url = `${p('COMPLIANCE_DPDPA')}?jurisdiction=${jurisdiction}&days=${days}&limit=200`;
  const q = useQuery<DpdpaResp>({
    queryKey: ['dpdpa-compliance', jurisdiction, days],
    queryFn: () => jget<DpdpaResp>(url),
    refetchOnWindowFocus: false,
  });

  const purposeBuckets = useMemo(() => {
    const m = new Map<string, { granted: number; withdrawn: number }>();
    (q.data?.consents.by_purpose ?? []).forEach(r => {
      const b = m.get(r.purpose) ?? { granted: 0, withdrawn: 0 };
      if (r.status === 'granted')   b.granted   += r.count;
      if (r.status === 'withdrawn') b.withdrawn += r.count;
      m.set(r.purpose, b);
    });
    return Array.from(m.entries()).map(([purpose, v]) => ({ purpose, ...v }));
  }, [q.data]);

  return (
    <div className="min-h-screen p-6 bg-[#F9FAFB]" data-testid="page-dpdpa-compliance">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
            DPDPA Compliance
          </h1>
          <Badge variant="outline" className="ml-2">Demo G1B</Badge>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          India Digital Personal Data Protection Act 2023 — live consent registry, 9-principle
          posture, and Data Principal rights for the US (org 1000-1099) and IN (org 1100-1199)
          demo tenants.
        </p>

        {/* Filter strip */}
        <div className="flex flex-wrap items-end gap-3 mb-5">
          <div>
            <div className="text-xs text-slate-700 mb-1">Jurisdiction</div>
            <div className="flex gap-1.5" data-testid="filter-jurisdiction">
              {(['ALL', 'US', 'IN'] as const).map(j => (
                <button
                  key={j}
                  onClick={() => setJurisdiction(j)}
                  data-testid={`btn-jur-${j.toLowerCase()}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    jurisdiction === j ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  {j === 'ALL' ? <><Globe2 className="w-3 h-3 inline mr-1" />Both</> : j}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-700 mb-1">Window</div>
            <div className="flex gap-1.5">
              {[7, 30, 90].map(d => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  data-testid={`btn-days-${d}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    days === d ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-700'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching} data-testid="btn-refresh-dpdpa">
            <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${q.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>

        {q.isError && (
          <div className="mb-5">
            <JrxErrorState
              title="DPDPA registry unavailable"
              description="Could not load /api/jrx/compliance/dpdpa — sign in again or retry."
              onRetry={() => q.refetch()}
            />
          </div>
        )}

        {/* Headline KPIs */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Tile label="Registry rows" value={q.data?.consents.total_rows} icon={<Users className="w-4 h-4" />} loading={q.isLoading} testid="kpi-rows" />
          <Tile label="Granted" value={q.data?.consents.total_granted} color="text-emerald-700" icon={<CheckCircle2 className="w-4 h-4" />} loading={q.isLoading} testid="kpi-granted" />
          <Tile label="Withdrawn" value={q.data?.consents.total_withdrawn} color="text-rose-700" icon={<Trash2 className="w-4 h-4" />} loading={q.isLoading} testid="kpi-withdrawn" />
          <Tile label="Breach log (last 7d)" value={q.data?.breach_log.entries ?? 0} color="text-slate-700" icon={<AlertCircle className="w-4 h-4" />} loading={q.isLoading} testid="kpi-breach" />
        </div>

        <div className="grid lg:grid-cols-3 gap-5 mb-5">
          {/* 9 principles */}
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2"><CardTitle className="text-sm">DPDPA — 9 principles posture</CardTitle></CardHeader>
            <CardContent>
              {q.isLoading && <Skeleton className="h-32" />}
              {q.data && (
                <div className="grid sm:grid-cols-2 gap-2" data-testid="principles-grid">
                  {q.data.principles.map(pr => {
                    const b = PRINCIPLE_BADGE[pr.status] ?? PRINCIPLE_BADGE.gap;
                    return (
                      <div key={pr.code} className={`border rounded-md p-2.5 flex items-start gap-2 ${b.color}`} data-testid={`principle-${pr.code}`}>
                        <div className="mt-0.5">{b.icon}</div>
                        <div className="min-w-0">
                          <div className="text-xs font-mono">{pr.code} · {pr.controlPolicy}</div>
                          <div className="text-sm font-medium">{pr.name}</div>
                          <div className="text-xs uppercase tracking-wide opacity-70">{pr.status}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* DSR + DPO */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Data Principal rights</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {q.isLoading && <Skeleton className="h-32" />}
              {q.data && (
                <>
                  <Row icon={<Download className="w-3.5 h-3.5" />} label="Access (export)" value={q.data.data_subject_rights.access_endpoint} />
                  <Row icon={<RefreshCw className="w-3.5 h-3.5" />} label="Withdraw" value={q.data.data_subject_rights.withdraw_endpoint} />
                  <Row icon={<Trash2 className="w-3.5 h-3.5" />} label="Erasure" value={q.data.data_subject_rights.delete_endpoint} />
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-700 mb-0.5">Response SLA</div>
                    <div className="font-medium">{q.data.data_subject_rights.sla_days} days</div>
                  </div>
                  <div className="pt-2 border-t border-slate-100">
                    <div className="text-xs text-slate-700 mb-0.5 flex items-center gap-1"><Mail className="w-3 h-3" /> DPO</div>
                    <div className="font-medium" data-testid="dpo-contact">{q.data.dpo.contact}</div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Per-purpose summary */}
        <Card className="mb-5">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Consent traffic by purpose</CardTitle></CardHeader>
          <CardContent>
            {q.isLoading && <Skeleton className="h-24" />}
            {q.data && purposeBuckets.length === 0 && (
              <div className="text-sm text-slate-700 py-2">No consent traffic captured for the selected window.</div>
            )}
            {purposeBuckets.length > 0 && (
              <table className="w-full text-sm" data-testid="table-by-purpose">
                <thead className="text-xs text-slate-700 uppercase">
                  <tr><th className="text-left py-1.5">Purpose</th><th className="text-right">Granted</th><th className="text-right">Withdrawn</th><th className="text-right">Active</th></tr>
                </thead>
                <tbody>
                  {purposeBuckets.map(b => (
                    <tr key={b.purpose} className="border-t border-slate-100">
                      <td className="py-1.5 font-mono text-xs">{b.purpose}</td>
                      <td className="text-right text-emerald-700 font-medium">{b.granted}</td>
                      <td className="text-right text-rose-700">{b.withdrawn}</td>
                      <td className="text-right font-semibold">{Math.max(0, b.granted - b.withdrawn)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Live consent registry */}
        <Card>
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-sm">Live consent registry</CardTitle>
            {q.data && <span className="text-xs text-slate-700">Showing {q.data.registry.length} of {q.data.consents.total_rows} rows</span>}
          </CardHeader>
          <CardContent className="p-0">
            {q.isLoading && <div className="p-4"><Skeleton className="h-32" /></div>}
            {q.data && q.data.registry.length === 0 && (
              <div className="text-sm text-slate-700 p-4">No consent records in this window.</div>
            )}
            {q.data && q.data.registry.length > 0 && (
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full text-sm" data-testid="table-consent-registry">
                  <thead className="bg-slate-50 text-xs text-slate-700 uppercase sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2">Principal</th>
                      <th className="text-left px-4 py-2">Org</th>
                      <th className="text-left px-4 py-2">Jur.</th>
                      <th className="text-left px-4 py-2">Purpose</th>
                      <th className="text-left px-4 py-2">Status</th>
                      <th className="text-left px-4 py-2">Granted</th>
                      <th className="text-left px-4 py-2">Expires</th>
                      <th className="text-left px-4 py-2">Legal basis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.registry.map(r => (
                      <tr key={r.id} className="border-t border-slate-100" data-testid={`row-consent-${r.id}`}>
                        <td className="px-4 py-2 font-mono text-xs text-slate-700">{r.principalId}</td>
                        <td className="px-4 py-2 text-xs text-slate-700">org-{r.orgId}</td>
                        <td className="px-4 py-2 text-xs">{r.jurisdiction}</td>
                        <td className="px-4 py-2 text-xs">{r.purpose}</td>
                        <td className="px-4 py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs border ${STATUS_COLOR[r.status] ?? ''}`}>{r.status}</span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-700">{new Date(r.grantedAt).toLocaleString()}</td>
                        <td className="px-4 py-2 text-xs text-slate-700" data-testid={`expires-${r.id}`}>
                          {r.expiresAt
                            ? new Date(r.expiresAt).toLocaleString()
                            : <span className="text-slate-600">never</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-700">{r.legalBasis}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({ label, value, color = 'text-slate-900', icon, loading, testid }: {
  label: string; value?: number; color?: string; icon: React.ReactNode; loading: boolean; testid: string;
}) {
  return (
    <Card>
      <CardContent className="p-4" data-testid={testid}>
        <div className="flex items-center gap-1.5 text-xs text-slate-700 mb-1">{icon}{label}</div>
        {loading ? <Skeleton className="h-7 w-16" /> : <div className={`text-2xl font-bold ${color}`}>{(value ?? 0).toLocaleString()}</div>}
      </CardContent>
    </Card>
  );
}
function Row({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-700 mb-0.5 flex items-center gap-1">{icon}{label}</div>
      <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded">{value}</code>
    </div>
  );
}
