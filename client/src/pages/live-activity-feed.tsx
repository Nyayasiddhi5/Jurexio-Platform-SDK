import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Live Activity Feed — Gap #4 frontend (Session-15 v3, 2026-05-11)
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time per-org SDK activity feed. Replaces the 20-line PhaseCScaffold
 * stub. Backend: /api/jrx/activity/{stream,recent}.
 *
 * Strategy:
 *   - Hydrate via /api/jrx/activity/recent (auth: Bearer JWT in header)
 *   - Stream via EventSource on /api/jrx/activity/stream?token=<JWT>
 *     (browsers can't set Authorization on EventSource, so we pass the JWT
 *     as a query param — server validates with the same JWT secret).
 *   - Auto-reconnect on close. Polling fallback at 5 s if SSE never opens.
 *   - Honors the canonical session token from AuthContext.
 */

import { useEffect, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Zap, Pause, Play, RefreshCw, AlertCircle } from 'lucide-react';

interface ActivityEvent {
  orgId: string;
  requestId: string;
  ts: number;
  method: string;
  route: string;
  status: number;
  ms: number;
  sdkKeyPrefix?: string | null;
  platformCode?: string | null;
  scope?: string | null;
  userAgent?: string | null;
  jurisdiction?: string | null;
  agent?: string | null;
  eventType?: string | null;
}

const MAX_EVENTS = 200;
const POLL_FALLBACK_MS = 5000;

// Mirror of EVENT_TYPE_RULES on the server (nv-activity-stream-routes.ts —
// `deriveEventType`). Kept in sync so client-side filtering of in-memory
// stream events agrees with the server-side filter passed to /recent.
const EVENT_TYPES: Array<[string, RegExp]> = [
  ['orchestrate', /^\/api\/nv\/orchestrate(\/|$)/],
  ['llm',         /^\/api\/nv\/(ai|llm)\//],
  ['guardrail',   /^\/api\/nv\/intelligence\/(hitl|hallucination|bias|safety)\//],
  ['consent',     /^\/api\/nv\/consent\//],
  ['audit',       /^\/api\/nv\/audit\//],
  ['agent',       /^\/api\/nv\/agent(s)?\//],
  ['rag',         /^\/api\/nv\/(rag|knowledge|km)\//],
  ['hitl',        /^\/api\/nv\/hitl\//],
  ['governance',  /^\/api\/nv\/governance\//],
  ['intel',       /^\/api\/nv\/intelligence\//],
];
function deriveEventType(route: string): string {
  for (const [name, re] of EVENT_TYPES) if (re.test(route)) return name;
  return 'other';
}

interface Filters {
  method: string;
  jurisdiction: string;
  agent: string;
  severity: string;
  route: string;
  eventType: string;
}
const EMPTY_FILTERS: Filters = { method: 'all', jurisdiction: 'all', agent: '', severity: 'all', route: '', eventType: 'all' };

function severityOf(status: number): 'ok' | 'redirect' | 'clientError' | 'serverError' {
  if (status >= 500) return 'serverError';
  if (status >= 400) return 'clientError';
  if (status >= 300) return 'redirect';
  return 'ok';
}

function matchesFilter(ev: ActivityEvent, f: Filters): boolean {
  if (f.method !== 'all' && ev.method !== f.method) return false;
  if (f.jurisdiction !== 'all' && (ev.jurisdiction || '') !== f.jurisdiction) return false;
  if (f.severity !== 'all' && severityOf(ev.status) !== f.severity) return false;
  if (f.eventType !== 'all' && (ev.eventType || deriveEventType(ev.route)) !== f.eventType) return false;
  const ag = f.agent.trim().toLowerCase();
  if (ag) {
    const hay = `${ev.agent || ''} ${ev.scope || ''} ${ev.platformCode || ''}`.toLowerCase();
    if (!hay.includes(ag)) return false;
  }
  const rt = f.route.trim().toLowerCase();
  if (rt && !ev.route.toLowerCase().includes(rt)) return false;
  return true;
}

function getToken(): string {
  try {
    return getAuthToken() || sessionStorage.getItem('token') || '';
  } catch {
    return '';
  }
}

function statusBadge(status: number) {
  if (status < 300) return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/30">{status}</Badge>;
  if (status < 400) return <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/30">{status}</Badge>;
  if (status < 500) return <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">{status}</Badge>;
  return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/30">{status}</Badge>;
}

export default function LiveActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'live' | 'polling' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const esRef = useRef<EventSource | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const visible = events.filter(ev => matchesFilter(ev, filters));
  const setF = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(prev => ({ ...prev, [k]: v }));

  const pushEvent = (ev: ActivityEvent) => {
    if (pausedRef.current) return;
    setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS));
  };

  const hydrate = async () => {
    const token = getToken();
    if (!token) { setStatus('error'); setError('Not signed in. Please log in to view activity.'); return; }
    try {
      const r = await fetch(nv('activity/recent?limit=200'), { headers: { Authorization: `Bearer ${token}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setEvents(j?.data?.events ?? []);
    } catch (e) {
      setError(`Unable to retrieve recent activity: ${(e as Error).message}`);
    }
  };

  const startPolling = () => {
    if (pollRef.current) return;
    setStatus('polling');
    pollRef.current = setInterval(hydrate, POLL_FALLBACK_MS);
  };
  const stopPolling = () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };

  const startSse = () => {
    const token = getToken();
    if (!token) { setStatus('error'); setError('Not signed in.'); return; }
    try {
      const es = new EventSource(`${NV_BASE}activity/stream?token=${encodeURIComponent(token)}`);
      esRef.current = es;
      es.addEventListener('hello', () => { setStatus('live'); setError(null); stopPolling(); });
      es.addEventListener('activity', (e) => {
        try { pushEvent(JSON.parse((e as MessageEvent).data) as ActivityEvent); } catch { /* ignore */ }
      });
      es.addEventListener('heartbeat', () => { /* keep-alive */ });
      es.onerror = () => { setStatus('polling'); setError('Live stream interrupted; falling back to polling.'); es.close(); esRef.current = null; startPolling(); };
    } catch (e) {
      setError(`SSE failed: ${(e as Error).message}`);
      startPolling();
    }
  };

  useEffect(() => {
    hydrate();
    startSse();
    return () => { try { esRef.current?.close(); } catch { /* ignore */ } stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="p-6 space-y-4" data-testid="page-live-activity-feed">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Zap className="h-6 w-6 text-amber-500" />
            Live Activity Feed
          </h1>
          <p className="text-sm text-muted-foreground">Real-time stream of SDK calls for your organisation. Auto-reconnects on disconnect.</p>
          <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-slate-700 max-w-3xl">
            <strong className="text-slate-900">Purpose.</strong> Per-org tail of every <code className="bg-white px-1 rounded">/api/jrx/*</code> call —
            method, route, status, latency, SDK key prefix, originating product (NSP/NSI/NYM/NSM/NSA/JRX). Hydrated
            from a Redis ring buffer; streams via Server-Sent Events with a 5s polling fallback. Use this to
            verify customer integrations are firing and to correlate spikes with the audit-chain page.
            <strong className="text-slate-900"> If the feed is empty,</strong> no calls have hit the gateway in the last
            ring-buffer window — invoke any agent or send an SDK request and events will appear within ~1s.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={status === 'live' ? 'bg-green-500/10 text-green-600 border-green-500/30' :
            status === 'polling' ? 'bg-amber-500/10 text-amber-600 border-amber-500/30' :
            status === 'error' ? 'bg-red-500/10 text-red-600 border-red-500/30' :
            'bg-blue-500/10 text-blue-600 border-blue-500/30'}>
            {status === 'live' ? '● LIVE' : status === 'polling' ? '◌ POLLING' : status === 'error' ? '✕ ERROR' : '… CONNECTING'}
          </Badge>
          <Button size="sm" variant="outline" onClick={() => setPaused(p => !p)} data-testid="button-pause-activity">
            {paused ? <><Play className="h-4 w-4 mr-1" /> Resume</> : <><Pause className="h-4 w-4 mr-1" /> Pause</>}
          </Button>
          <Button size="sm" variant="outline" onClick={() => { setEvents([]); hydrate(); }} data-testid="button-refresh-activity">
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3 flex items-center gap-2 text-sm">
            <AlertCircle className="h-4 w-4 text-amber-600" /> {error}
          </CardContent>
        </Card>
      )}

      <Card data-testid="card-activity-filters">
        <CardContent className="p-3 flex flex-wrap items-end gap-3 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Method</span>
            <select className="border rounded px-2 py-1 bg-white" value={filters.method}
              onChange={e => setF('method', e.target.value)} data-testid="filter-method">
              {['all','GET','POST','PUT','PATCH','DELETE'].map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Jurisdiction</span>
            <select className="border rounded px-2 py-1 bg-white" value={filters.jurisdiction}
              onChange={e => setF('jurisdiction', e.target.value)} data-testid="filter-jurisdiction">
              {['all','IN','US','EU','UK','SG','GC'].map(j => <option key={j} value={j}>{j}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Event type</span>
            <select className="border rounded px-2 py-1 bg-white" value={filters.eventType}
              onChange={e => setF('eventType', e.target.value)} data-testid="filter-event-type">
              {['all','orchestrate','llm','guardrail','consent','audit','agent','rag','hitl','governance','intel','other']
                .map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Severity</span>
            <select className="border rounded px-2 py-1 bg-white" value={filters.severity}
              onChange={e => setF('severity', e.target.value)} data-testid="filter-severity">
              <option value="all">all</option>
              <option value="ok">2xx ok</option>
              <option value="redirect">3xx redirect</option>
              <option value="clientError">4xx client</option>
              <option value="serverError">5xx server</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Agent / pattern</span>
            <input className="border rounded px-2 py-1 bg-white w-44" placeholder="e.g. react, hitl, NS-LRM"
              value={filters.agent} onChange={e => setF('agent', e.target.value)} data-testid="filter-agent" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Route contains</span>
            <input className="border rounded px-2 py-1 bg-white w-56" placeholder="e.g. /orchestrate"
              value={filters.route} onChange={e => setF('route', e.target.value)} data-testid="filter-route" />
          </label>
          <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY_FILTERS)} data-testid="filter-reset">
            Reset
          </Button>
          <span className="ml-auto text-muted-foreground" data-testid="filter-count">
            Showing {visible.length} of {events.length}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent calls ({visible.length}{events.length >= MAX_EVENTS ? '+' : ''})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr className="text-left">
                  <th className="p-2 font-medium">Time</th>
                  <th className="p-2 font-medium">Method</th>
                  <th className="p-2 font-medium">Route</th>
                  <th className="p-2 font-medium">Jur.</th>
                  <th className="p-2 font-medium">Agent</th>
                  <th className="p-2 font-medium">Status</th>
                  <th className="p-2 font-medium">ms</th>
                  <th className="p-2 font-medium">Platform</th>
                  <th className="p-2 font-medium">Key</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr><td colSpan={9} className="p-8 text-center text-muted-foreground">
                    {events.length === 0
                      ? 'No activity yet — make an SDK call to see it stream here.'
                      : 'No events match the current filters.'}
                  </td></tr>
                ) : visible.map(ev => (
                  <tr key={`${ev.requestId}-${ev.ts}`} className="border-b hover:bg-muted/30" data-testid="row-activity-event">
                    <td className="p-2 font-mono text-xs">{new Date(ev.ts).toLocaleTimeString()}</td>
                    <td className="p-2 font-mono text-xs">{ev.method}</td>
                    <td className="p-2 font-mono text-xs truncate max-w-md" title={ev.route}>{ev.route}</td>
                    <td className="p-2 text-xs">{ev.jurisdiction || '—'}</td>
                    <td className="p-2 text-xs truncate max-w-[140px]" title={ev.agent || ev.scope || ''}>{ev.agent || ev.scope || '—'}</td>
                    <td className="p-2">{statusBadge(ev.status)}</td>
                    <td className="p-2 text-right">{ev.ms}</td>
                    <td className="p-2 text-xs">{ev.platformCode || '—'}</td>
                    <td className="p-2 font-mono text-xs">{ev.sdkKeyPrefix || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
