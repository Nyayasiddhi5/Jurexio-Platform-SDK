import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronLeft, RefreshCw, ShieldCheck, Hash, ServerCrash, Network } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxErrorState } from '@/components/JrxErrorState';

import { NV_BASE } from '@/lib/jrx-api-paths';
/**
 * LineagePage (T-DLR-12 companion)
 *
 * Reader for GET /api/jrx/orchestration/lineage/:requestId — the IronLedger
 * audit chain we shipped in Lane B (T-DLR-04). Tenant-scoped on the server
 * side (privileged roles see all rows; everyone else sees only rows that
 * match their userId/orgId on the audit payload).
 */

interface AuditRow {
  id: string;
  eventType: string;
  createdAt: string;
  recordHash: string;
  previousHash: string | null;
  payload: Record<string, unknown>;
}

interface LineageSummary {
  success?: boolean;
  agentKey?: string | null;
  jurisdiction?: string | null;
  tier?: string | null;
  model?: string | null;
  latencyMs?: number | null;
  citations?: number | null;
  inputHash?: string | null;
  outputHash?: string | null;
}

interface LineageResponse {
  success: boolean;
  requestId?: string;
  chainLength?: number;
  auditChain?: AuditRow[];
  summary?: LineageSummary;
  error?: string;
}

function fmtNum(n: unknown, digits = 0): string {
  if (n === null || n === undefined || n === '') return '—';
  const v = typeof n === 'string' ? Number(n) : (n as number);
  if (typeof v !== 'number' || Number.isNaN(v)) return '—';
  return digits === 0 ? Math.round(v).toLocaleString() : v.toFixed(digits);
}

function shortHash(h: string | null | undefined): string {
  if (!h) return '—';
  return `${h.slice(0, 10)}…${h.slice(-6)}`;
}

export default function LineagePage() {
  const params = useParams<{ requestId: string }>();
  const requestId = params.requestId ?? '';

  const { data, isLoading, isError, refetch, isFetching } = useQuery<LineageResponse>({
    queryKey: [`${NV_BASE}orchestration/lineage/${encodeURIComponent(requestId)}`],
    enabled: requestId.length > 0,
    staleTime: 5_000,
  });

  return (
    <div
      className="min-h-screen p-8"
      style={{ background: '#F8FAFC' }}
    >
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/orchestration/router-decisions" className="text-xs text-[#C7B15B] hover:underline flex items-center gap-1">
              <ChevronLeft className="h-3 w-3" />
              Back to router decisions
            </Link>
            <h1 className="text-3xl font-bold text-foreground mt-2" style={{ fontFamily: 'Merriweather, serif' }}>
              IronLedger Lineage
            </h1>
            <p className="text-sm mt-1" style={{ color: '#475569' }}>
              <span className="font-mono">{requestId || 'no requestId'}</span> · hash-chain audit trail
            </p>
          </div>
          <Button size="sm" variant="ghost" onClick={() => refetch()} className="text-foreground hover:text-[#C7B15B]">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Summary */}
        {data?.summary && (
          <Card style={{ background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm tracking-wide text-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" style={{ color: '#B48907' }} />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm text-muted-foreground">
              <KV k="success" v={String(data.summary.success ?? '—')} />
              <KV k="agent" v={data.summary.agentKey ?? '—'} />
              <KV k="jurisdiction" v={data.summary.jurisdiction ?? '—'} />
              <KV k="tier" v={data.summary.tier ?? '—'} />
              <KV k="model" v={data.summary.model ?? '—'} mono />
              <KV k="latency" v={`${fmtNum(data.summary.latencyMs)} ms`} />
              <KV k="citations" v={fmtNum(data.summary.citations)} />
              <KV k="chainLength" v={fmtNum(data.chainLength)} />
            </CardContent>
          </Card>
        )}

        {/* Hash chain */}
        <Card style={{ background: '#FFFFFF', border: '1px solid #E2E8F0' }}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm tracking-wide text-foreground flex items-center justify-between">
              <span className="flex items-center gap-2">
                <Network className="h-4 w-4" style={{ color: '#B48907' }} />
                Hash chain
              </span>
              <Badge
                className="text-xs"
                style={{
                  background: 'rgba(212,160,23,0.15)',
                  color: '#B48907',
                  border: '1px solid rgba(212,160,23,0.3)',
                }}
              >
                {isError ? 'unavailable' : isFetching ? 'refreshing' : `${data?.chainLength ?? 0} entries`}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isError ? (
              <JrxErrorState
                title="No lineage found for this requestId"
                description="Either the audit-wire flag is off, or the row isn't visible to your tenant."
                variant="card"
                size="sm"
              />
            ) : isLoading ? (
              <div className="p-4 space-y-2" data-testid="loading-lineage">
                {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (data?.auditChain ?? []).length === 0 ? (
              <JrxEmptyState title="No entries" size="sm" />
            ) : (
              <div className="space-y-3">
                {data!.auditChain!.map((row, idx) => (
                  <div
                    key={row.id}
                    className="border border-border rounded-md p-4 bg-muted"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge
                          className="text-[10px] mr-2"
                          style={{
                            background: 'rgba(212,160,23,0.15)',
                            color: '#B48907',
                            border: '1px solid rgba(212,160,23,0.3)',
                          }}
                        >
                          #{idx + 1}
                        </Badge>
                        <span className="text-sm font-medium text-foreground">{row.eventType}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{new Date(row.createdAt).toISOString()}</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Hash className="h-3 w-3 text-emerald-300" />
                        <span className="text-muted-foreground">hash</span>
                        <span className="text-emerald-300">{shortHash(row.recordHash)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">prev</span>
                        <span className="text-muted-foreground">{shortHash(row.previousHash)}</span>
                      </div>
                    </div>
                    <details className="mt-3">
                      <summary className="text-xs text-muted-foreground cursor-pointer hover:text-muted-foreground">payload</summary>
                      <pre className="mt-2 text-[11px] text-muted-foreground overflow-x-auto bg-muted p-3 rounded">
{JSON.stringify(row.payload, null, 2)}
                      </pre>
                    </details>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
      <div className={`text-sm text-muted-foreground ${mono ? 'font-mono text-xs' : ''}`}>{v}</div>
    </div>
  );
}
