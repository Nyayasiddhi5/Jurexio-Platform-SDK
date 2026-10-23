/**
 * US State Privacy & Federal Compliance Console — task-345.
 *
 * Dedicated US-jurisdiction surface that brings VCDPA, CPA, CCPA, HIPAA,
 * SOC2, and FedRAMP Moderate up to the same demo parity DPDPA already
 * enjoys at /console/dpdpa-compliance. Backed by GET /api/jrx/policies
 * filtered to jurisdiction=US (which returns rows seeded by
 * src/services/compliance/jrx-policy-engine.ts during gateway bootstrap).
 *
 * Light-themed per the 2026-05-12 product decision (replit.md → "Console
 * theme: light-only"). No `dark:` Tailwind variants.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldCheck,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Building2,
  Flag,
  Lock,
  ExternalLink,
  Newspaper,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';
import { formatDistanceToNow } from 'date-fns';

interface PolicyRow {
  id: number;
  policy_code: string;
  name: string;
  category: string | null;
  jurisdiction: string | null;
  severity: string;
  status: string;
  owner_team: string | null;
  description: string | null;
  framework_refs: string[] | null;
  effective_at: string | null;
  review_at: string | null;
  open_violations?: number;
  violations_today?: number;
  assignment_count?: number;
}

interface PoliciesResp {
  success: boolean;
  policies: PolicyRow[];
}

async function jget<T>(u: string): Promise<T> {
  const r = await fetch(u, { credentials: 'include' });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

interface FrameworkBucket {
  id: string;
  label: string;
  scope: string;
  regulator: string;
  matcher: (code: string) => boolean;
  icon: React.ReactNode;
  tone: 'state' | 'federal' | 'sector';
  /**
   * Regulator IDs (from REGULATORS.US) whose monitor / Tavily items should
   * surface in this card's headline strip. The first entry doubles as the
   * value passed to /console/regulatory?regulator=... for the "View all" link.
   */
  headlineRegulators: string[];
  /** Case-insensitive keywords matched against title / summary / topic. */
  headlineKeywords: string[];
}

const FRAMEWORKS: FrameworkBucket[] = [
  {
    id: 'ccpa',
    label: 'CCPA / CPRA',
    scope: 'California',
    regulator: 'California Privacy Protection Agency + CA OAG',
    matcher: (c) => c.startsWith('POL-US-CCPA') || c.startsWith('POL-US-CPRA'),
    icon: <Flag className="w-4 h-4" />,
    tone: 'state',
    headlineRegulators: ['FTC'],
    headlineKeywords: ['ccpa', 'cpra', 'california privacy', 'california consumer privacy'],
  },
  {
    id: 'vcdpa',
    label: 'VCDPA',
    scope: 'Virginia',
    regulator: 'Virginia Office of the Attorney General',
    matcher: (c) => c.startsWith('POL-US-VCDPA'),
    icon: <Flag className="w-4 h-4" />,
    tone: 'state',
    headlineRegulators: ['VA-OAG'],
    headlineKeywords: ['vcdpa', 'virginia consumer data', 'virginia attorney general'],
  },
  {
    id: 'cpa',
    label: 'CPA',
    scope: 'Colorado',
    regulator: 'Colorado Attorney General',
    matcher: (c) => c.startsWith('POL-US-CPA'),
    icon: <Flag className="w-4 h-4" />,
    tone: 'state',
    headlineRegulators: ['CO-AG'],
    headlineKeywords: ['colorado privacy', 'cpa privacy act', 'colorado attorney general'],
  },
  {
    id: 'nyshield',
    label: 'NY SHIELD Act',
    scope: 'New York',
    regulator: 'New York Office of the Attorney General',
    matcher: (c) => c.startsWith('POL-US-NYSHIELD'),
    icon: <Flag className="w-4 h-4" />,
    tone: 'state',
    headlineRegulators: [],
    headlineKeywords: ['shield act', 'new york attorney general', 'ny shield'],
  },
  {
    id: 'bipa',
    label: 'IL BIPA',
    scope: 'Illinois',
    regulator: 'Illinois Attorney General',
    matcher: (c) => c.startsWith('POL-US-BIPA'),
    icon: <Flag className="w-4 h-4" />,
    tone: 'state',
    headlineRegulators: [],
    headlineKeywords: ['bipa', 'biometric information privacy', 'illinois biometric'],
  },
  {
    id: 'ma201',
    label: 'MA 201 CMR 17',
    scope: 'Massachusetts',
    regulator: 'MA OCABR + MA Attorney General',
    matcher: (c) => c.startsWith('POL-US-MA201CMR17'),
    icon: <Flag className="w-4 h-4" />,
    tone: 'state',
    headlineRegulators: [],
    headlineKeywords: ['201 cmr 17', 'massachusetts data security', 'ma ocabr'],
  },
  {
    id: 'hipaa',
    label: 'HIPAA',
    scope: 'US — Health',
    regulator: 'HHS Office for Civil Rights',
    matcher: (c) => c.startsWith('POL-US-HIPAA'),
    icon: <ShieldCheck className="w-4 h-4" />,
    tone: 'sector',
    headlineRegulators: [],
    headlineKeywords: ['hipaa', 'hhs', 'office for civil rights', 'protected health information'],
  },
  {
    id: 'soc2',
    label: 'SOC 2',
    scope: 'US — Trust Services',
    regulator: 'AICPA / Auditor',
    matcher: (c) => c.startsWith('POL-US-SOC2'),
    icon: <ShieldCheck className="w-4 h-4" />,
    tone: 'sector',
    headlineRegulators: ['SEC'],
    headlineKeywords: ['soc 2', 'soc2', 'aicpa', 'trust services'],
  },
  {
    id: 'fedramp',
    label: 'FedRAMP Moderate',
    scope: 'US — Federal Cloud',
    regulator: 'FedRAMP PMO (GSA)',
    matcher: (c) => c.startsWith('POL-US-FEDRAMP'),
    icon: <Lock className="w-4 h-4" />,
    tone: 'federal',
    headlineRegulators: ['FedRAMP-PMO'],
    headlineKeywords: ['fedramp', 'fed ramp', 'gsa cloud', 'federal authorization'],
  },
  {
    id: 'frcp',
    label: 'FRCP',
    scope: 'US — Federal Litigation',
    regulator: 'US Federal Courts',
    matcher: (c) => c.startsWith('POL-US-FRCP'),
    icon: <Building2 className="w-4 h-4" />,
    tone: 'federal',
    headlineRegulators: [],
    headlineKeywords: ['frcp', 'federal rules of civil procedure'],
  },
  {
    id: 'aba',
    label: 'ABA Model Rules',
    scope: 'US — Legal Ethics',
    regulator: 'American Bar Association + State Bars',
    matcher: (c) => c.startsWith('POL-US-ABA'),
    icon: <Building2 className="w-4 h-4" />,
    tone: 'sector',
    headlineRegulators: [],
    headlineKeywords: ['aba model rule', 'american bar association'],
  },
];

const TONE_STYLE: Record<FrameworkBucket['tone'], string> = {
  state:   'bg-indigo-50 border-indigo-200 text-indigo-800',
  federal: 'bg-violet-50 border-violet-200 text-violet-800',
  sector:  'bg-emerald-50 border-emerald-200 text-emerald-800',
};

const SEVERITY_STYLE: Record<string, string> = {
  critical: 'text-rose-700 bg-rose-50 border-rose-200',
  high:     'text-amber-700 bg-amber-50 border-amber-200',
  medium:   'text-slate-700 bg-slate-100 border-slate-200',
  low:      'text-slate-600 bg-slate-50 border-slate-200',
};

const STATUS_STYLE: Record<string, string> = {
  active:     'text-emerald-700 bg-emerald-50 border-emerald-200',
  draft:      'text-amber-700 bg-amber-50 border-amber-200',
  superseded: 'text-slate-600 bg-slate-100 border-slate-200',
};

function statusForBucket(rows: PolicyRow[]): {
  label: 'live' | 'partial' | 'gap';
  copy: string;
} {
  if (rows.length === 0) return { label: 'gap', copy: 'No seeded policy yet' };
  const active = rows.filter((r) => r.status === 'active').length;
  if (active === 0) return { label: 'partial', copy: 'Drafted, not yet activated' };
  return { label: 'live', copy: `${active} active control${active === 1 ? '' : 's'}` };
}

const STATUS_BADGE: Record<'live' | 'partial' | 'gap', string> = {
  live:    'bg-emerald-50 border-emerald-200 text-emerald-800',
  partial: 'bg-amber-50 border-amber-200 text-amber-800',
  gap:     'bg-rose-50 border-rose-200 text-rose-800',
};

interface RegulatoryUpdate {
  id: string;
  source: string | null;
  sourceKind: 'monitor' | 'audit' | 'statute';
  jurisdiction: string | null;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  severity: string;
  type: string;
  sourceUrl: string | null;
  relevanceScore?: number;
}

interface RegulatoryResp {
  jurisdiction: string;
  updates: RegulatoryUpdate[];
  tavily?: {
    configured: boolean;
    enabled?: boolean;
    sweepsActive?: boolean;
    lastRunAt?: Record<string, string | null>;
  };
  generatedAt: string;
}

function matchesBucket(u: RegulatoryUpdate, f: FrameworkBucket): boolean {
  const src = (u.source ?? '').toLowerCase();
  if (f.headlineRegulators.some((r) => r.toLowerCase() === src)) return true;
  const hay = `${u.title ?? ''} ${u.summary ?? ''} ${u.type ?? ''}`.toLowerCase();
  return f.headlineKeywords.some((kw) => hay.includes(kw));
}

export default function UsStatePrivacy() {
  const [refreshKey, setRefreshKey] = useState(0);

  const url = `${p('POLICIES_LIST')}?jurisdiction=US&windowDays=7`;
  const q = useQuery<PoliciesResp>({
    queryKey: ['us-state-privacy-policies', refreshKey],
    queryFn: () => jget<PoliciesResp>(url),
    refetchOnWindowFocus: false,
  });

  // task-350: pull live regulator headlines for the same set of US frameworks
  // shown on this page. Falls through gracefully when the operator lacks
  // super_admin (the aggregator is super_admin-gated) or when Tavily isn't
  // configured — `headlines` is just empty in either case.
  const regUrl = `${p('REGULATORY')}?jurisdiction=US&limit=100`;
  const headlinesQ = useQuery<RegulatoryResp>({
    queryKey: ['us-state-privacy-headlines', refreshKey],
    queryFn: () => jget<RegulatoryResp>(regUrl),
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 60_000,
  });

  const usPolicies = useMemo(
    () => (q.data?.policies ?? []).filter((r) => (r.jurisdiction ?? '').toUpperCase() === 'US'),
    [q.data],
  );

  const allHeadlines = useMemo<RegulatoryUpdate[]>(
    () => headlinesQ.data?.updates ?? [],
    [headlinesQ.data],
  );

  const buckets = useMemo(
    () =>
      FRAMEWORKS.map((f) => {
        const headlines = allHeadlines
          .filter((u) => matchesBucket(u, f))
          .sort((a, b) => {
            const at = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
            const bt = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
            return bt - at;
          })
          .slice(0, 5);
        return {
          ...f,
          rows: usPolicies.filter((r) => f.matcher(r.policy_code ?? '')),
          headlines,
        };
      }),
    [usPolicies, allHeadlines],
  );

  const tavilyConfigured = headlinesQ.data?.tavily?.configured ?? null;
  const headlinesError = headlinesQ.isError;

  const summary = useMemo(() => {
    const totalControls = usPolicies.length;
    const liveBuckets = buckets.filter((b) => b.rows.some((r) => r.status === 'active')).length;
    const openViolations = usPolicies.reduce((sum, r) => sum + (r.open_violations ?? 0), 0);
    return { totalControls, liveBuckets, openViolations };
  }, [usPolicies, buckets]);

  return (
    <div className="min-h-screen p-6 bg-[#F9FAFB]" data-testid="page-us-state-privacy">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-3 mb-1">
          <ShieldCheck className="w-7 h-7 text-indigo-600" />
          <h1
            className="text-2xl font-bold text-slate-900"
            style={{ fontFamily: 'Merriweather, serif' }}
          >
            US State Privacy &amp; Federal Compliance
          </h1>
          <Badge variant="outline" className="ml-2">task-345</Badge>
        </div>
        <p className="text-sm text-slate-600 mb-5">
          Cross-state privacy + sector-specific + federal-cloud control surface for
          US tenants (org 1000-1099). Covers California (CCPA/CPRA), Virginia (VCDPA),
          Colorado (CPA), New York (SHIELD Act), Illinois (BIPA), Massachusetts (201 CMR 17),
          HIPAA, SOC 2, FedRAMP Moderate, FRCP, and ABA ethics —
          backed by{' '}
          <code className="px-1 py-0.5 rounded bg-slate-100 text-slate-700">
            /api/jrx/policies?jurisdiction=US
          </code>
          .
        </p>

        <div className="flex flex-wrap items-end gap-3 mb-5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            data-testid="button-refresh"
          >
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
          <div className="ml-auto flex flex-wrap gap-2 text-xs text-slate-600">
            <Badge variant="outline" className="bg-white">
              {summary.totalControls} controls
            </Badge>
            <Badge variant="outline" className="bg-white">
              {summary.liveBuckets}/{FRAMEWORKS.length} frameworks live
            </Badge>
            <Badge
              variant="outline"
              className={
                summary.openViolations > 0
                  ? 'bg-rose-50 border-rose-200 text-rose-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }
            >
              {summary.openViolations} open violations
            </Badge>
            {tavilyConfigured === true && (
              <Badge
                variant="outline"
                className="bg-emerald-50 border-emerald-200 text-emerald-800"
                data-testid="badge-tavily-configured"
              >
                <Newspaper className="w-3 h-3 mr-1" />
                Live regulator feed
              </Badge>
            )}
            {tavilyConfigured === false && (
              <Badge
                variant="outline"
                className="bg-amber-50 border-amber-200 text-amber-800"
                data-testid="badge-tavily-not-configured"
              >
                <Newspaper className="w-3 h-3 mr-1" />
                Live feed off (set TAVILY_API_KEY)
              </Badge>
            )}
            {headlinesError && (
              <Badge
                variant="outline"
                className="bg-slate-50 border-slate-200 text-slate-600"
                data-testid="badge-headlines-unavailable"
              >
                <Newspaper className="w-3 h-3 mr-1" />
                Headlines unavailable
              </Badge>
            )}
          </div>
        </div>

        {q.isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-48" />
            ))}
          </div>
        )}

        {q.isError && (
          <Card className="border-rose-200 bg-rose-50">
            <CardContent className="p-5 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-rose-700 mt-0.5" />
              <div>
                <div className="font-semibold text-rose-900">
                  Failed to load US policies
                </div>
                <div className="text-sm text-rose-800 mt-1">
                  {(q.error as Error)?.message ?? 'Unknown error'}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {q.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {buckets.map((b) => {
              const status = statusForBucket(b.rows);
              return (
                <Card
                  key={b.id}
                  className="border-slate-200 bg-white"
                  data-testid={`framework-card-${b.id}`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded border ${TONE_STYLE[b.tone]}`}
                        >
                          {b.icon}
                        </span>
                        <CardTitle className="text-base text-slate-900">
                          {b.label}
                        </CardTitle>
                      </div>
                      <Badge
                        variant="outline"
                        className={`${STATUS_BADGE[status.label]} text-[10px] uppercase tracking-wide`}
                      >
                        {status.label === 'live' ? (
                          <CheckCircle2 className="w-3 h-3 mr-1" />
                        ) : (
                          <AlertCircle className="w-3 h-3 mr-1" />
                        )}
                        {status.label}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{b.scope}</div>
                    <div className="text-xs text-slate-600 italic">{b.regulator}</div>
                  </CardHeader>
                  <CardContent className="pt-2">
                    <div className="text-xs text-slate-700 mb-2">{status.copy}</div>
                    {b.rows.length === 0 ? (
                      <div className="text-xs text-slate-500 italic py-2">
                        No seeded policy for this framework yet.
                      </div>
                    ) : (
                      <ul className="space-y-2">
                        {b.rows.map((r) => (
                          <li
                            key={r.id}
                            className="border border-slate-200 rounded p-2 bg-slate-50"
                            data-testid={`policy-row-${r.policy_code}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-xs font-mono text-slate-700 truncate">
                                  {r.policy_code}
                                </div>
                                <div className="text-sm font-medium text-slate-900 truncate">
                                  {r.name}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-1">
                                <Badge
                                  variant="outline"
                                  className={`${SEVERITY_STYLE[r.severity] ?? SEVERITY_STYLE.medium} text-[10px]`}
                                >
                                  {r.severity}
                                </Badge>
                                <Badge
                                  variant="outline"
                                  className={`${STATUS_STYLE[r.status] ?? STATUS_STYLE.active} text-[10px]`}
                                >
                                  {r.status}
                                </Badge>
                              </div>
                            </div>
                            {Array.isArray(r.framework_refs) && r.framework_refs.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {r.framework_refs.slice(0, 4).map((ref) => (
                                  <code
                                    key={ref}
                                    className="text-[10px] px-1 py-0.5 rounded bg-white border border-slate-200 text-slate-600"
                                  >
                                    {ref}
                                  </code>
                                ))}
                                {r.framework_refs.length > 4 && (
                                  <span className="text-[10px] text-slate-500">
                                    +{r.framework_refs.length - 4} more
                                  </span>
                                )}
                              </div>
                            )}
                            <div className="mt-1.5 flex items-center justify-between text-[11px] text-slate-600">
                              <span>
                                {r.open_violations ?? 0} open · {r.violations_today ?? 0} today
                              </span>
                              <a
                                className="inline-flex items-center text-indigo-700 hover:underline"
                                href={`/console/orchestration/policies?policy=${r.id}`}
                                data-testid={`link-drilldown-${r.policy_code}`}
                              >
                                Drilldown <ExternalLink className="w-3 h-3 ml-0.5" />
                              </a>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* task-350: live regulator headlines strip per framework */}
                    <div
                      className="mt-3 pt-3 border-t border-slate-100"
                      data-testid={`headlines-${b.id}`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-700 uppercase tracking-wide">
                          <Newspaper className="w-3 h-3" />
                          Recent headlines
                        </div>
                        {b.headlineRegulators[0] && (
                          <a
                            className="text-[11px] text-indigo-700 hover:underline inline-flex items-center"
                            href={`/console/regulatory-monitor?regulator=${encodeURIComponent(
                              b.headlineRegulators[0],
                            )}`}
                            data-testid={`link-headlines-all-${b.id}`}
                          >
                            View all <ExternalLink className="w-3 h-3 ml-0.5" />
                          </a>
                        )}
                      </div>
                      {headlinesQ.isLoading ? (
                        <div className="space-y-1.5">
                          <Skeleton className="h-3 w-full" />
                          <Skeleton className="h-3 w-4/5" />
                          <Skeleton className="h-3 w-3/4" />
                        </div>
                      ) : headlinesError ? (
                        <div className="text-[11px] text-slate-500 italic">
                          Headlines feed unavailable for this session.
                        </div>
                      ) : b.headlines.length === 0 ? (
                        <div className="text-[11px] text-slate-500 italic">
                          {tavilyConfigured === false
                            ? 'Live feed disabled — no recent items.'
                            : 'No recent items in the last sweep.'}
                        </div>
                      ) : (
                        <ul className="space-y-1.5">
                          {b.headlines.map((h) => {
                            const when = h.publishedAt
                              ? formatDistanceToNow(new Date(h.publishedAt), {
                                  addSuffix: true,
                                })
                              : null;
                            return (
                              <li
                                key={h.id}
                                className="text-[11px] text-slate-700"
                                data-testid={`headline-${b.id}`}
                              >
                                <div className="flex items-start gap-1.5">
                                  <span className="text-slate-400 mt-0.5">•</span>
                                  <div className="min-w-0 flex-1">
                                    {h.sourceUrl ? (
                                      <a
                                        href={h.sourceUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-slate-800 hover:text-indigo-700 hover:underline line-clamp-2"
                                      >
                                        {h.title}
                                      </a>
                                    ) : (
                                      <span className="text-slate-800 line-clamp-2">
                                        {h.title}
                                      </span>
                                    )}
                                    <div className="text-[10px] text-slate-500 mt-0.5">
                                      {h.source ?? 'regulator'}
                                      {when ? ` · ${when}` : ''}
                                    </div>
                                  </div>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        <div className="mt-6 text-xs text-slate-500">
          State-AG and FedRAMP-PMO probes feed into the regulatory monitor at{' '}
          <a className="text-indigo-700 hover:underline" href="/console/regulatory">
            /console/regulatory
          </a>
          . Per-policy enforcement events surface in the Policy Management console at{' '}
          <a className="text-indigo-700 hover:underline" href="/console/orchestration/policies">
            /console/orchestration/policies
          </a>
          .
        </div>
      </div>
    </div>
  );
}
