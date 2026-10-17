/**
 * Real-time Activity Feed — wired to /api/jrx/activity/recent + /stream (SSE).
 * Session-15 v18 / 2026-05-11. Closes CPO-audit enterprise gaps #3 + #4.
 * Backend: src/routes/jrx-activity-stream-routes.ts.
 *
 * Auth: app stores the JWT in localStorage (`nyv_auth_token` / `authToken`),
 * NOT in a cookie. Earlier revision used `credentials: 'include'` which sent
 * no auth and surfaced as a "not signed in" empty state on a freshly-logged
 * in session. Both the REST hydrate and the EventSource now carry the JWT
 * (header for fetch, `?token=` query string for SSE — EventSource cannot
 * set custom headers).
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
function getJwt(): string {
  return localStorage.getItem("token") || localStorage.getItem("token") || "";
}

type Event = {
  ts: number;
  requestId?: string;
  method?: string;
  route?: string;
  status?: number;
  ms?: number;
  platformCode?: string;
  sdkKeyPrefix?: string;
};

const MAX_EVENTS = 200;

export default function RealtimeActivityPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [streamErr, setStreamErr] = useState<string | null>(null);

  const recent = useQuery<{ ok?: boolean; events?: Event[]; data?: { events?: Event[] } }>({
    queryKey: [nv('activity/recent')],
    queryFn: async () => {
      const token = getJwt();
      const r = await fetch(nv('activity/recent?limit=50'), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
  });

  useEffect(() => {
    // Backend envelope is { success, data: { orgId, events: [...] } }; tolerate both shapes.
    const evs = recent.data?.data?.events ?? recent.data?.events ?? [];
    if (evs.length) setEvents(evs.slice(0, MAX_EVENTS));
  }, [recent.data]);

  useEffect(() => {
    let es: EventSource | null = null;
    try {
      const token = getJwt();
      const url = token
        ? `${NV_BASE}activity/stream?token=${encodeURIComponent(token)}`
        : nv('activity/stream');
      es = new EventSource(url);
      es.onmessage = (msg) => {
        try {
          const ev: Event = JSON.parse(msg.data);
          setEvents(prev => [ev, ...prev].slice(0, MAX_EVENTS));
        } catch { /* ignore parse errors */ }
      };
      es.onerror = () => setStreamErr("SSE stream interrupted (will retry automatically)");
    } catch (e: any) { setStreamErr(e?.message || "SSE init failed"); }
    return () => { es?.close(); };
  }, []);

  const statusBadge = (s?: number) => {
    if (!s) return <Badge variant="outline">—</Badge>;
    if (s < 300) return <Badge className="bg-emerald-600">{s}</Badge>;
    if (s < 400) return <Badge variant="secondary">{s}</Badge>;
    if (s < 500) return <Badge variant="outline" className="border-amber-500 text-amber-700">{s}</Badge>;
    return <Badge variant="destructive">{s}</Badge>;
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid="page-realtime-activity">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Real-time Activity Feed</h1>
          <p className="text-sm text-muted-foreground mt-1">Live SDK call stream via SSE. Wired to /api/jrx/activity/{`{recent,stream}`}. Closes CPO-audit enterprise gaps #3 + #4.</p>
        </div>
        <Badge className="bg-emerald-600">SSE active</Badge>
      </div>

      {streamErr && <Card className="border-amber-500/30 bg-amber-500/5"><CardContent className="p-3 text-sm">{streamErr}</CardContent></Card>}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Recent calls ({events.length}{events.length >= MAX_EVENTS ? '+' : ''})</CardTitle></CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px]">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0"><tr className="text-left"><th className="p-2">Time</th><th className="p-2">Method</th><th className="p-2">Route</th><th className="p-2">Status</th><th className="p-2">ms</th><th className="p-2">Platform</th><th className="p-2">Key</th></tr></thead>
              <tbody>
                {events.length === 0 ? <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No activity yet — make an SDK call to see it stream here.</td></tr>
                  : events.map((ev, i) => <tr key={`${ev.requestId}-${ev.ts}-${i}`} className="border-b hover:bg-muted/30">
                      <td className="p-2 font-mono text-xs">{new Date(ev.ts).toLocaleTimeString()}</td>
                      <td className="p-2 font-mono text-xs">{ev.method || "—"}</td>
                      <td className="p-2 font-mono text-xs truncate max-w-md" title={ev.route}>{ev.route || "—"}</td>
                      <td className="p-2">{statusBadge(ev.status)}</td>
                      <td className="p-2 text-right">{ev.ms ?? "—"}</td>
                      <td className="p-2 text-xs">{ev.platformCode || "—"}</td>
                      <td className="p-2 font-mono text-xs">{ev.sdkKeyPrefix || "—"}</td>
                    </tr>)}
              </tbody>
            </table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
