/**
 * Regulatory Monitor — wired to the canonical aggregator
 * `/api/jrx/regulatory` (Task #194 / 2026-05-12).
 *
 * Backend: src/routes/jrx-operations-aggregators.ts → GET /api/jrx/regulatory
 * Auth:    super_admin; 60s refetch.
 *
 * Path imported via `p('REGULATORY')` from nv-api-paths.ts. Returns a single
 * fused stream of regulatory updates (monitor + audit-log + statute changes)
 * with source / effectiveDate / severity, replacing the previous bespoke
 * /api/jrx/regulatory/{events,alerts,health,subscribe} surface.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';
import { useLocation } from 'wouter';
import { Globe, AlertTriangle, CheckCircle, Clock, RefreshCw, FileText, ListChecks } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { p } from '@/lib/jrx-api-paths';
import { BRAND, BRAND_FONTS } from '@/lib/brand';

const JURISDICTIONS = ['IN', 'UK', 'GC', 'EU', 'US', 'SG'];
const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-800',
  high: 'bg-orange-100 text-orange-800',
  warning: 'bg-amber-100 text-amber-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-blue-100 text-blue-800',
  info: 'bg-gray-100 text-gray-800',
};

type Update = {
  id: string;
  source: string | null;
  sourceKind: 'monitor' | 'audit' | 'statute';
  jurisdiction: string | null;
  title: string;
  summary: string | null;
  effectiveDate: string | null;
  publishedAt: string | null;
  severity: string;
  type: string;
  sourceUrl: string | null;
  relevanceScore?: number;
};

type RegulatoryResponse = {
  jurisdiction: string;
  updates: Update[];
  counts: {
    fromMonitor: number;
    fromTavily?: number;
    fromAudit: number;
    fromStatutes: number;
  };
  tavily?: {
    configured: boolean;
    enabled: boolean;
    sweepsActive: boolean;
    lastRunAt: Record<string, string | null>;
    lastFetchCount: Record<string, number>;
  };
  generatedAt: string;
};

const REG_PATH = p('REGULATORY');

function buildUrl(jurisdiction: string): string {
  const params = new URLSearchParams();
  if (jurisdiction !== 'all') params.set('jurisdiction', jurisdiction);
  params.set('limit', '100');
  return `${REG_PATH}?${params.toString()}`;
}

export default function RegulatoryMonitor() {
  const [, navigate] = useLocation();
  // Default IN — own RSS/RDS feed is primary; Tavily only when JRX_ENABLE_TAVILY_REG_SWEEP=1.
  const [jurisdiction, setJurisdiction] = useState('IN');
  const [severity, setSeverity] = useState('all');
  // task-350: honour `?regulator=<id>` deep-links from /console/us-state-privacy
  // so the framework "View all" links land pre-filtered to the relevant
  // regulator (VA-OAG, CO-AG, FedRAMP-PMO, FTC, SEC, ...).
  const initialRegulator = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get('regulator') ?? '';
  }, []);
  const [regulatorFilter, setRegulatorFilter] = useState(initialRegulator);
  useEffect(() => {
    if (initialRegulator) setJurisdiction('US');
  }, [initialRegulator]);

  const { data, isLoading, isError, isFetching, refetch } = useQuery<RegulatoryResponse>({
    queryKey: [REG_PATH, jurisdiction],
    queryFn: () =>
      fetch(buildUrl(jurisdiction), { credentials: 'include' }).then((r) => r.json()),
    refetchInterval: 60000,
  });

  const allUpdates = data?.updates ?? [];
  const sevFiltered =
    severity === 'all'
      ? allUpdates
      : allUpdates.filter((u) => (u.severity || 'info').toLowerCase() === severity);
  const regulatorNeedle = regulatorFilter.trim().toLowerCase();
  const updates = regulatorNeedle
    ? sevFiltered.filter((u) => {
        const src = (u.source ?? '').toLowerCase();
        if (src === regulatorNeedle) return true;
        const hay = `${u.title ?? ''} ${u.summary ?? ''} ${u.type ?? ''}`.toLowerCase();
        return hay.includes(regulatorNeedle);
      })
    : sevFiltered;
  const counts = data?.counts ?? { fromMonitor: 0, fromAudit: 0, fromStatutes: 0 };
  const criticalCount = allUpdates.filter(
    (u) => u.severity === 'critical' || u.severity === 'high',
  ).length;

  return (
    <div className="p-6 space-y-6" data-testid="page-regulatory-monitor">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1
            className="text-2xl font-bold flex items-center gap-2"
            style={{ fontFamily: BRAND_FONTS.heading, color: BRAND.primary }}
          >
            <Globe className="h-6 w-6" style={{ color: BRAND.accent }} />
            Regulatory Monitor
          </h1>
          <p className="text-sm mt-1" style={{ color: BRAND.textSecondary }}>
            Ops aggregator — monitor events, audit log, and statute changes across {JURISDICTIONS.length} jurisdictions.
            Partner digest lives on Live Legal Feed (own RSS → S3/RDS/RAG).
          </p>
          <div
            className="mt-3 rounded-md border p-3 text-xs max-w-3xl"
            style={{ borderColor: BRAND.border, background: BRAND.primarySoft, color: BRAND.textSecondary }}
          >
            <strong style={{ color: BRAND.primary }}>Source of truth.</strong> Own regulatory ingest is default.
            Tavily sweeps run only when <code className="px-1 rounded bg-white/80">JRX_ENABLE_TAVILY_REG_SWEEP=1</code>
            {' '}(optional third-party news). Also fuses audit-log hits and statute effective-date changes.
            {data?.tavily ? (
              <>
                <br />
                <strong style={{ color: BRAND.primary }}>Tavily (optional).</strong>{' '}
                {data.tavily.enabled || data.tavily.sweepsActive ? (
                  <>
                    <span style={{ color: BRAND.success }}>sweeps active</span> · last {jurisdiction}:{' '}
                    {data.tavily.lastRunAt[jurisdiction]
                      ? formatDistanceToNow(new Date(data.tavily.lastRunAt[jurisdiction]!), {
                          addSuffix: true,
                        })
                      : 'pending'}
                  </>
                ) : (
                  <span style={{ color: BRAND.warning }}>
                    off by default — own feed + monitor/audit/statutes power this page
                  </span>
                )}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/legal-intelligence-feed')}>
            Live Legal Feed
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total updates', value: allUpdates.length, icon: ListChecks, color: 'text-blue-600' },
          { label: 'Critical / High', value: criticalCount, icon: AlertTriangle, color: 'text-red-600' },
          { label: 'From monitor', value: counts.fromMonitor, icon: Globe, color: 'text-emerald-600' },
          { label: 'Statute changes', value: counts.fromStatutes, icon: FileText, color: 'text-amber-600' },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <stat.icon className={`h-8 w-8 ${stat.color}`} />
                <div>
                  <div className="text-2xl font-bold">{stat.value}</div>
                  <div className="text-xs text-muted-foreground">{stat.label}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={jurisdiction} onValueChange={setJurisdiction} aria-label="Filter jurisdiction">
          <SelectTrigger className="w-40"><SelectValue placeholder="All regions" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All regions</SelectItem>
            {JURISDICTIONS.map((j) => <SelectItem key={j} value={j}>{j}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity} aria-label="Filter severity">
          <SelectTrigger className="w-40"><SelectValue placeholder="All severity" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            {['critical', 'high', 'warning', 'medium', 'low', 'info'].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {regulatorFilter && (
          <Badge
            variant="outline"
            className="text-xs"
            data-testid="badge-regulator-filter"
          >
            regulator: {regulatorFilter}
            <button
              type="button"
              onClick={() => setRegulatorFilter('')}
              className="ml-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear regulator filter"
            >
              ×
            </button>
          </Badge>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {data?.generatedAt && `Generated ${new Date(data.generatedAt).toLocaleString()}`}
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[28rem]" aria-label="Regulatory updates">
            {isError ? (
              <NyvErrorState
                title="Could not load regulatory updates"
                description={`Unable to retrieve ${REG_PATH}. You may not have super_admin access.`}
                onRetry={() => refetch()}
              />
            ) : isLoading ? (
              <div className="p-4 space-y-3" data-testid="loading-regulatory">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : updates.length === 0 ? (
              <NyvEmptyState
                icon={CheckCircle}
                title="No updates match the current filters"
                description="Try changing the jurisdiction or severity filter."
              />
            ) : (
              <div className="divide-y">
                {updates.map((u) => (
                  <div key={u.id} className="p-4 hover:bg-muted/50" data-testid={`update-${u.sourceKind}`}>
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <Badge className={`text-xs ${SEVERITY_COLORS[u.severity] || SEVERITY_COLORS.info}`}>
                        {(u.severity || 'info').toUpperCase()}
                      </Badge>
                      <Badge variant="outline" className="text-xs capitalize" role="status">
                        {u.sourceKind}
                      </Badge>
                      {u.jurisdiction && (
                        <Badge variant="outline" className="text-xs" role="status">{u.jurisdiction}</Badge>
                      )}
                      {u.source && <span className="text-xs text-muted-foreground">{u.source}</span>}
                      {typeof u.relevanceScore === 'number' && (
                        <Badge variant="outline" className="text-xs" role="status" data-testid="badge-relevance">
                          relevance {u.relevanceScore}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {u.publishedAt
                          ? formatDistanceToNow(new Date(u.publishedAt), { addSuffix: true })
                          : '—'}
                      </span>
                    </div>
                    <p className="text-sm font-medium">{u.title}</p>
                    {u.summary && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{u.summary}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1">
                      {u.effectiveDate && (
                        <span className="text-xs text-muted-foreground">
                          Effective: {new Date(u.effectiveDate).toLocaleDateString()}
                        </span>
                      )}
                      {u.sourceUrl && (
                        <a
                          href={u.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline"
                        >
                          View source →
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
