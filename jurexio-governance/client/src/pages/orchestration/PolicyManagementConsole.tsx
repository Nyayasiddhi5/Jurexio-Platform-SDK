/**
 * Policy Management Console — task-298 (Demo G1B).
 *
 * Live list of active policies (≥ 12 covering US + IN demo surfaces) with
 * jurisdiction / category / status filters and a per-policy drilldown that
 * exposes versions, assignments, and recent violations.
 *
 * Backed by:
 *   - GET /api/jrx/policies                (list)
 *   - GET /api/jrx/policies/:id            (drilldown)
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, FileText, AlertTriangle, RefreshCw, ChevronRight, Globe2, X } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { p, nv } from '@/lib/jrx-api-paths';
import { nvFetchJson } from '@/lib/jrx-fetch-json';

interface Policy {
  id: number;
  policy_code: string;
  name: string;
  category: string;
  jurisdiction: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'draft' | 'superseded';
  owner_team: string;
  description: string;
  rules: string[];
  current_version: string;
  effective_at: string;
  review_at?: string;
  framework_refs: string[];
  last_enforced_at?: string;
  assignment_count: number;
  open_violations: number;
  violations_today: number;
}

interface ListResp { success: boolean; policies: Policy[] }
interface DrilldownResp {
  success: boolean;
  policy: Policy;
  versions: Array<{ id: number; version: string; published_by: string; published_at: string; changelog: string; body_md?: string }>;
  assignments: Array<{ id: number; scope_type: string; scope_value: string; ack_count: number }>;
  violations: Array<{ id: number; severity: string; status: string; description: string; detected_at: string; org_id: number }>;
  cam_events?: Array<{ id: number; action_id: string; framework: string; control_id: string; severity: string; status: string; title: string; description?: string; created_at: string; metadata?: Record<string, any> }>;
  cam_framework?: string | null;
}

const jget = nvFetchJson;

const SEVERITY_BADGE: Record<string, string> = {
  critical: 'bg-rose-100 text-rose-700 border-rose-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-amber-100 text-amber-800 border-amber-200',
  low:      'bg-slate-100 text-slate-700 border-slate-200',
};

const JURISDICTION_FLAG: Record<string, string> = {
  US: '🇺🇸', IN: '🇮🇳', EU: '🇪🇺', UK: '🇬🇧', ALL: '🌐',
};

export default function PolicyManagementConsole() {
  const [jurisdiction, setJurisdiction] = useState<'ALL' | 'US' | 'IN' | 'EU' | 'UK'>('ALL');
  const [category, setCategory] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  // task-298 review-fix: date-range filter wired to the backend's
  // ?windowDays / ?effectiveSince / ?effectiveUntil parameters.
  const [windowDays, setWindowDays] = useState<number>(1);
  const [effectiveSince, setEffectiveSince] = useState<string>('');
  const [effectiveUntil, setEffectiveUntil] = useState<string>('');
  const [drilldownId, setDrilldownId] = useState<number | null>(null);

  const listUrl = useMemo(() => {
    const qs = new URLSearchParams();
    if (jurisdiction !== 'ALL') qs.set('jurisdiction', jurisdiction);
    if (category) qs.set('category', category);
    if (statusFilter) qs.set('status', statusFilter);
    if (windowDays !== 1) qs.set('windowDays', String(windowDays));
    if (effectiveSince) qs.set('effectiveSince', new Date(effectiveSince).toISOString());
    if (effectiveUntil) qs.set('effectiveUntil', new Date(effectiveUntil).toISOString());
    return `${p('POLICIES_LIST')}${qs.toString() ? '?' + qs.toString() : ''}`;
  }, [jurisdiction, category, statusFilter, windowDays, effectiveSince, effectiveUntil]);

  const list = useQuery<ListResp>({
    queryKey: ['policies-list', jurisdiction, category, statusFilter, windowDays, effectiveSince, effectiveUntil],
    queryFn: () => jget<ListResp>(listUrl),
    refetchOnWindowFocus: false,
  });

  const drill = useQuery<DrilldownResp>({
    queryKey: ['policy-drill', drilldownId],
    queryFn: () => jget<DrilldownResp>(nv(`policies/${drilldownId}`)),
    enabled: drilldownId != null,
    refetchOnWindowFocus: false,
  });

  const policies = list.data?.policies ?? [];
  const categories = Array.from(new Set(policies.map(x => x.category).filter(Boolean))).sort();

  return (
    <div className="min-h-screen p-6 bg-[#F9FAFB]" data-testid="page-policy-management">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-900" style={{ fontFamily: 'Merriweather, serif' }}>
            Policy Management
          </h1>
          <Badge variant="outline" className="ml-2">Demo G1B</Badge>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          Live policy catalog covering US (CCPA, HIPAA, FRCP 26, SOC 2, ABA MR 1.6) and IN
          (DPDPA §4–§12, IT Act §43A, Bar Council Rule 36) demo surfaces.
        </p>

        {/* Filter bar */}
        <Card className="mb-5">
          <CardContent className="p-4 flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-xs text-slate-700 mb-1">Jurisdiction</label>
              <div className="flex gap-1.5" data-testid="filter-jurisdiction">
                {(['ALL', 'US', 'IN', 'EU', 'UK'] as const).map(j => (
                  <button
                    key={j}
                    onClick={() => setJurisdiction(j)}
                    data-testid={`btn-jur-${j.toLowerCase()}`}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                      jurisdiction === j
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {JURISDICTION_FLAG[j]} {j}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-700 mb-1">Category</label>
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                data-testid="filter-category"
                className="px-3 py-1.5 rounded-md text-sm border border-slate-200 bg-white"
              >
                <option value="">All categories</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-700 mb-1">Status</label>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                data-testid="filter-status"
                className="px-3 py-1.5 rounded-md text-sm border border-slate-200 bg-white"
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="superseded">Superseded</option>
                <option value="">All</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-700 mb-1">Counter window</label>
              <div className="flex gap-1.5" data-testid="filter-window-days">
                {[1, 7, 30, 90].map(d => (
                  <button
                    key={d}
                    onClick={() => setWindowDays(d)}
                    data-testid={`btn-window-${d}`}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                      windowDays === d ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200'
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-slate-700 mb-1">Effective since</label>
              <input
                type="date"
                value={effectiveSince}
                onChange={e => setEffectiveSince(e.target.value)}
                data-testid="filter-effective-since"
                className="px-3 py-1.5 rounded-md text-sm border border-slate-200 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-700 mb-1">Effective until</label>
              <input
                type="date"
                value={effectiveUntil}
                onChange={e => setEffectiveUntil(e.target.value)}
                data-testid="filter-effective-until"
                className="px-3 py-1.5 rounded-md text-sm border border-slate-200 bg-white"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => list.refetch()}
              disabled={list.isFetching}
              data-testid="btn-refresh-policies"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${list.isFetching ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
            <div className="ml-auto text-sm text-slate-600" data-testid="policy-count">
              <span className="font-semibold text-slate-900">{policies.length}</span> policies
            </div>
          </CardContent>
        </Card>

        {/* Policy table */}
        {list.isLoading && <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
        {list.isError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 text-rose-800 px-4 py-3 text-sm">
            Failed to load policies. <Button variant="link" size="sm" onClick={() => list.refetch()}>Retry</Button>
          </div>
        )}
        {list.isSuccess && policies.length === 0 && (
          <div className="rounded-md border border-slate-200 bg-white px-4 py-8 text-center text-slate-700">
            No policies match the current filters.
          </div>
        )}

        {policies.length > 0 && (
          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm" data-testid="table-policies">
                <thead className="bg-slate-50 text-xs text-slate-700 uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-2.5">Code</th>
                    <th className="text-left px-4 py-2.5">Policy</th>
                    <th className="text-left px-4 py-2.5">Category</th>
                    <th className="text-left px-4 py-2.5">Jur.</th>
                    <th className="text-left px-4 py-2.5">Severity</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Last enforced</th>
                    <th className="text-right px-4 py-2.5">Open</th>
                    <th className="text-right px-4 py-2.5">24h</th>
                    <th className="text-right px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {policies.map(pol => (
                    <tr
                      key={pol.id}
                      className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer"
                      onClick={() => setDrilldownId(pol.id)}
                      data-testid={`row-policy-${pol.policy_code}`}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-slate-600">{pol.policy_code}</td>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-slate-900">{pol.name}</div>
                        <div className="text-xs text-slate-700 line-clamp-1">{pol.description}</div>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">{pol.category}</td>
                      <td className="px-4 py-2.5">
                        <span className="text-xs">{JURISDICTION_FLAG[pol.jurisdiction] ?? '🌐'} {pol.jurisdiction}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs border ${SEVERITY_BADGE[pol.severity] ?? SEVERITY_BADGE.low}`}>
                          {pol.severity}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span
                          data-testid={`status-${pol.policy_code}`}
                          className={`inline-block px-2 py-0.5 rounded-full text-xs border ${
                            pol.status === 'active'     ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            pol.status === 'draft'      ? 'bg-amber-50 text-amber-800 border-amber-200'      :
                            pol.status === 'superseded' ? 'bg-slate-100 text-slate-600 border-slate-200'     :
                                                          'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {pol.status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-slate-700" data-testid={`last-enforced-${pol.policy_code}`}>
                        {pol.last_enforced_at
                          ? new Date(pol.last_enforced_at).toLocaleString()
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {pol.open_violations > 0
                          ? <span className="font-semibold text-rose-600">{pol.open_violations}</span>
                          : <span className="text-slate-600">0</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{pol.violations_today}</td>
                      <td className="px-4 py-2.5 text-right"><ChevronRight className="w-4 h-4 inline text-slate-600" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}

        {/* Drilldown drawer */}
        {drilldownId != null && (
          <div className="fixed inset-0 bg-black/40 z-50 flex justify-end" onClick={() => setDrilldownId(null)}>
            <div
              className="w-full max-w-2xl bg-white h-full overflow-y-auto p-6"
              onClick={e => e.stopPropagation()}
              data-testid="policy-drilldown"
            >
              <div className="flex items-start justify-between mb-4">
                <div>
                  <div className="text-xs font-mono text-slate-700">{drill.data?.policy.policy_code}</div>
                  <h2 className="text-xl font-bold text-slate-900">{drill.data?.policy.name ?? 'Loading…'}</h2>
                </div>
                <button onClick={() => setDrilldownId(null)} className="text-slate-600 hover:text-slate-600" data-testid="btn-close-drilldown">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {drill.isLoading && <Skeleton className="h-40" />}
              {drill.data && (
                <>
                  <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                    <Stat label="Jurisdiction" value={`${JURISDICTION_FLAG[drill.data.policy.jurisdiction] ?? ''} ${drill.data.policy.jurisdiction}`} />
                    <Stat label="Severity" value={drill.data.policy.severity} />
                    <Stat label="Status" value={drill.data.policy.status} />
                    <Stat label="Version" value={drill.data.policy.current_version} />
                    <Stat label="Owner" value={drill.data.policy.owner_team} />
                    <Stat label="Open violations" value={String(drill.data.policy.open_violations)} />
                  </div>
                  <Section title="Description">
                    <p className="text-sm text-slate-700 leading-relaxed">{drill.data.policy.description}</p>
                  </Section>
                  <Section title="Rules">
                    <ul className="space-y-1.5">
                      {(drill.data.policy.rules ?? []).map((r, i) => (
                        <li key={i} className="text-sm text-slate-700 flex gap-2">
                          <span className="text-emerald-600 mt-0.5">✓</span><span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </Section>
                  <Section title="Framework references">
                    <div className="flex flex-wrap gap-1.5">
                      {(drill.data.policy.framework_refs ?? []).map(f => (
                        <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
                      ))}
                    </div>
                  </Section>
                  {/* task-298 review-fix: render policy body text from latest version. */}
                  <Section title="Policy text">
                    {(() => {
                      const latest = (drill.data.versions ?? [])[0];
                      const body = latest?.body_md;
                      return body
                        ? <pre data-testid="policy-body-md" className="whitespace-pre-wrap text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-md p-3 font-sans leading-relaxed">{body}</pre>
                        : <div className="text-sm text-slate-700">No published policy text yet.</div>;
                    })()}
                  </Section>
                  <Section title={`Recent violations (${drill.data.violations?.length ?? 0})`}>
                    {(!drill.data.violations || drill.data.violations.length === 0)
                      ? <div className="text-sm text-slate-700">No recent violations recorded.</div>
                      : (
                        <div className="space-y-2">
                          {drill.data.violations.slice(0, 8).map(v => (
                            <div key={v.id} className="border border-slate-200 rounded-md p-2.5 text-sm">
                              <div className="flex items-center gap-2 mb-1">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[v.severity] ?? ''}`}>
                                  {v.severity}
                                </span>
                                <span className="text-xs text-slate-700">{v.status}</span>
                                <span className="ml-auto text-xs text-slate-600 font-mono">org-{v.org_id}</span>
                              </div>
                              <div className="text-slate-700">{v.description}</div>
                              <div className="text-xs text-slate-600 mt-1">{new Date(v.detected_at).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>
                      )}
                  </Section>
                  {/* task-298 review-fix: render CAM-event triggers. */}
                  <Section title={`Recent triggers — CAM events (${drill.data.cam_events?.length ?? 0})${drill.data.cam_framework ? ` · framework: ${drill.data.cam_framework}` : ''}`}>
                    {(!drill.data.cam_events || drill.data.cam_events.length === 0)
                      ? <div className="text-sm text-slate-700" data-testid="cam-empty">No CAM events captured for this policy's framework.</div>
                      : (
                        <div className="space-y-2" data-testid="cam-events">
                          {drill.data.cam_events.slice(0, 10).map(c => (
                            <div key={c.id} className="border border-slate-200 rounded-md p-2.5 text-sm" data-testid={`cam-${c.action_id}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-xs font-medium px-1.5 py-0.5 rounded border ${SEVERITY_BADGE[c.severity] ?? ''}`}>{c.severity}</span>
                                <span className="text-xs text-slate-700">{c.status}</span>
                                <span className="text-xs font-mono text-slate-600">{c.framework}</span>
                                <span className="ml-auto text-xs text-slate-600 font-mono">{c.control_id}</span>
                              </div>
                              <div className="text-slate-800 font-medium">{c.title}</div>
                              {c.description && <div className="text-xs text-slate-600 mt-0.5">{c.description}</div>}
                              {c.metadata?.userId && (
                                <div className="text-xs text-slate-700 mt-1 font-mono">
                                  principal={String(c.metadata.userId)} · purpose={String(c.metadata.purpose ?? '—')}
                                </div>
                              )}
                              <div className="text-xs text-slate-600 mt-1">{new Date(c.created_at).toLocaleString()}</div>
                            </div>
                          ))}
                        </div>
                      )}
                  </Section>
                  <Section title="Versions">
                    {(drill.data.versions ?? []).map(v => (
                      <div key={v.id} className="text-sm py-1.5 flex items-center gap-3">
                        <FileText className="w-3.5 h-3.5 text-slate-600" />
                        <span className="font-mono text-xs">v{v.version}</span>
                        <span className="text-slate-700">{v.changelog}</span>
                        <span className="ml-auto text-xs text-slate-600">{new Date(v.published_at).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </Section>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded-md p-2.5">
      <div className="text-xs text-slate-700">{label}</div>
      <div className="font-medium text-slate-900">{value}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h3 className="text-xs uppercase tracking-wide text-slate-700 font-semibold mb-2">{title}</h3>
      {children}
    </div>
  );
}
