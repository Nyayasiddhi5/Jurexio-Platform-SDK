/**
 * client/src/pages/my-approvals.tsx — Task #337 (2026-05-13)
 *
 * Real Console UI for the HITL "My Approvals" queue, replacing the prior
 * PhaseCScaffold 501-stub wrapper. Lists `nv_hitl_queue` rows assigned to
 * the calling reviewer (or matching role-fallback rows for operators) and lets
 * them record approve | reject | modify | escalate decisions which write
 * to `nv_hitl_decisions`.
 *
 * Backend: GET/POST /api/jrx/my-approvals (mounted in src/index.ts at
 * line ~597; see src/routes/jrx-my-approvals-routes.ts).
 */

import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckSquare, AlertTriangle, RefreshCcw, Inbox, Filter, Loader2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/hooks/use-toast';
import apiRequest from '@/lib/queryClient';
import { p } from '@/lib/jrx-api-paths';

interface ApprovalRow {
  id: number;
  request_id: string;
  org_id: number | null;
  platform: string | null;
  jurisdiction: string | null;
  agent_key: string | null;
  category: string | null;
  severity: 'critical' | 'high' | 'medium' | 'low' | string | null;
  payload_summary: string | null;
  status: 'pending' | 'decided' | 'escalated' | string;
  assigned_to: string | number | null;
  sla_minutes: number | null;
  created_at: string;
  decided_at: string | null;
  decision: string | null;
  decided_by: string | null;
  decision_reason: string | null;
}

type Decision = 'approve' | 'reject' | 'modify' | 'escalate';

const SEVERITY_TONE: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high:     'bg-orange-100 text-orange-700 border-orange-200',
  medium:   'bg-amber-100 text-amber-700 border-amber-200',
  low:      'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_TONE: Record<string, string> = {
  pending:   'bg-amber-100 text-amber-800 border-amber-200',
  decided:   'bg-emerald-100 text-emerald-800 border-emerald-200',
  escalated: 'bg-red-100 text-red-800 border-red-200',
};

function fmtAge(iso: string): string {
  const d = new Date(iso).getTime();
  if (!d) return '—';
  const mins = Math.max(0, Math.floor((Date.now() - d) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MyApprovals() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'pending' | 'decided' | 'escalated' | 'all'>('pending');
  const [reasonByRow, setReasonByRow] = useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ['my-approvals', statusFilter] as const,
    [statusFilter],
  );

  const listQ = useQuery({
    queryKey,
    queryFn: async () => {
      const qs = new URLSearchParams({
        status: statusFilter,
        limit: '50',
      }).toString();
      const r: any = await apiRequest(`${p('MY_APPROVALS')}?${qs}`);
      return {
        items: (r?.items ?? []) as ApprovalRow[],
        total: (r?.total ?? 0) as number,
        reviewer: (r?.reviewer ?? null) as string | null,
        note: (r?.note ?? null) as string | null,
      };
    },
    staleTime: 15_000,
    // Back off to 2 min after an error (e.g. 429) so the poller never floods the gateway.
    refetchInterval: (query) =>
      statusFilter === 'pending' ? (query.state.error ? 120_000 : 30_000) : false,
    retry: false,
  });

  const decisionMut = useMutation({
    mutationFn: async (args: { requestId: string; decision: Decision; reason: string }) => {
      const url = p('MY_APPROVALS_DECISION').replace(':request_id', encodeURIComponent(args.requestId));
      return apiRequest(url, {
        method: 'POST',
        body: { decision: args.decision, reason: args.reason || null },
      });
    },
    onSuccess: (_data, vars) => {
      toast({
        title: 'Decision recorded',
        description: `${vars.decision.toUpperCase()} • ${vars.requestId}`,
      });
      setReasonByRow((m) => { const n = { ...m }; delete n[vars.requestId]; return n; });
      qc.invalidateQueries({ queryKey: ['my-approvals'] });
    },
    onError: (err: any, vars) => {
      toast({
        title: 'Decision failed',
        description: `${vars.requestId}: ${err?.message ?? 'unknown error'}`,
        variant: 'destructive',
      });
    },
    onSettled: () => setBusyRow(null),
  });

  const decide = (row: ApprovalRow, decision: Decision) => {
    setBusyRow(row.request_id);
    decisionMut.mutate({
      requestId: row.request_id,
      decision,
      reason: (reasonByRow[row.request_id] ?? '').trim(),
    });
  };

  const items = listQ.data?.items ?? [];
  const reviewer = listQ.data?.reviewer ?? null;

  return (
    <div className="space-y-4 p-4 md:p-6" data-testid="page-my-approvals">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900">
            <CheckSquare className="h-6 w-6 text-indigo-600" />
            My Approvals
          </h1>
          <p className="text-sm text-slate-600">
            HITL queue items {reviewer ? <>assigned to <span className="font-mono">{reviewer}</span></> : null}.
            Decisions are written to <code className="rounded bg-slate-100 px-1 py-0.5">nv_hitl_decisions</code> with
            reviewer identity and an audit timestamp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => listQ.refetch()}
            disabled={listQ.isFetching}
            data-testid="btn-refresh"
          >
            {listQ.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Filter className="h-4 w-4 text-slate-700" /> Filters
          </CardTitle>
          <CardDescription>
            Items assigned to you, plus role-fallback rows
            (<code className="rounded bg-slate-100 px-1 py-0.5">assigned_to IS NULL AND assigned_role = your_role</code>),
            scoped to your organization.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs
            value={statusFilter}
            onValueChange={(v) => {
              if (v === 'pending' || v === 'decided' || v === 'escalated' || v === 'all') {
                setStatusFilter(v);
              }
            }}
          >
            <TabsList>
              <TabsTrigger value="pending" data-testid="tab-pending">Pending</TabsTrigger>
              <TabsTrigger value="decided" data-testid="tab-decided">Decided</TabsTrigger>
              <TabsTrigger value="escalated" data-testid="tab-escalated">Escalated</TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      {listQ.isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((k) => <Skeleton key={k} className="h-32 w-full" />)}
        </div>
      ) : listQ.isError ? (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="flex items-start gap-3 p-4 text-red-900" data-testid="approvals-error">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Failed to load approvals queue</p>
              <p className="text-sm">{(listQ.error as any)?.message ?? 'unknown error'}</p>
            </div>
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-10 text-center text-slate-700" data-testid="approvals-empty">
            <Inbox className="h-8 w-8" />
            <p className="font-medium text-slate-700">No items in this view</p>
            <p className="text-sm">
              {listQ.data?.note
                ? listQ.data.note
                : statusFilter === 'pending'
                  ? 'Nothing to review right now — nice work.'
                  : 'No historical decisions match the current filter.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3" data-testid="approvals-list">
          {items.map((row) => {
            const sev = (row.severity ?? 'low').toString();
            const sevTone = SEVERITY_TONE[sev] ?? SEVERITY_TONE.low;
            const statusTone = STATUS_TONE[row.status] ?? 'bg-slate-100 text-slate-700 border-slate-200';
            const isPending = row.status === 'pending';
            const rowBusy = busyRow === row.request_id && decisionMut.isPending;

            return (
              <Card key={row.request_id} data-testid={`approval-row-${row.request_id}`}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={sevTone}>{sev.toUpperCase()}</Badge>
                    <Badge variant="outline" className={statusTone}>{row.status.toUpperCase()}</Badge>
                    {row.platform ? <Badge variant="outline">{row.platform}</Badge> : null}
                    {row.jurisdiction ? <Badge variant="outline">{row.jurisdiction}</Badge> : null}
                    <span className="text-xs text-slate-700">opened {fmtAge(row.created_at)}</span>
                  </div>
                  <CardTitle className="mt-1 text-base">
                    {row.category ?? 'review'} • <span className="font-mono text-sm">{row.agent_key ?? 'agent?'}</span>
                  </CardTitle>
                  <CardDescription className="font-mono text-xs">{row.request_id}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-slate-700">
                    {row.payload_summary ?? 'No summary provided.'}
                  </p>

                  {row.decision ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm" data-testid={`decision-history-${row.request_id}`}>
                      <p>
                        <span className="font-semibold uppercase text-slate-700">{row.decision}</span>
                        {' '}by <span className="font-mono">{row.decided_by ?? '—'}</span>
                        {row.decided_at ? <> • {fmtAge(row.decided_at)}</> : null}
                      </p>
                      {row.decision_reason ? <p className="mt-1 text-slate-600">{row.decision_reason}</p> : null}
                    </div>
                  ) : null}

                  {isPending ? (
                    <>
                      <Textarea
                        placeholder="Reviewer note / reasoning (optional, recorded with the decision)"
                        value={reasonByRow[row.request_id] ?? ''}
                        onChange={(e) =>
                          setReasonByRow((m) => ({ ...m, [row.request_id]: e.target.value }))
                        }
                        rows={2}
                        data-testid={`reason-${row.request_id}`}
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={rowBusy}
                          onClick={() => decide(row, 'approve')}
                          data-testid={`btn-approve-${row.request_id}`}
                        >
                          {rowBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={rowBusy}
                          onClick={() => decide(row, 'modify')}
                          data-testid={`btn-modify-${row.request_id}`}
                        >
                          Modify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-red-200 text-red-700 hover:bg-red-50"
                          disabled={rowBusy}
                          onClick={() => decide(row, 'reject')}
                          data-testid={`btn-reject-${row.request_id}`}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-amber-300 text-amber-800 hover:bg-amber-50"
                          disabled={rowBusy}
                          onClick={() => decide(row, 'escalate')}
                          data-testid={`btn-escalate-${row.request_id}`}
                        >
                          Escalate
                        </Button>
                      </div>
                    </>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
