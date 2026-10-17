/**
 * Partner platform smoke matrix — NSP · NYM · JRX · CNR · Docparse (console JWT).
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getAuthToken } from '@/lib/jrx-auth-token';
import {
  NV_PARTNER_SMOKE_PROBES,
  PLATFORM_LABELS,
  type PartnerSmokeProbe,
} from '@/lib/jrx-partner-smoke-probes';
import { Play, RefreshCw, CheckCircle2, XCircle, Loader2 } from 'lucide-react';

type ProbeResult = {
  id: string;
  label: string;
  platform: PartnerSmokeProbe['platform'];
  path: string;
  status: number | null;
  durationMs: number;
  ok: boolean;
  error?: string;
};

export default function PartnerSmokePanel() {
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [running, setRunning] = useState(false);

  async function runAll() {
    setRunning(true);
    const token = getAuthToken();
    const headers: Record<string, string> = {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(NV_PARTNER_SMOKE_PROBES.some((p) => p.method === 'POST')
        ? { 'Content-Type': 'application/json' }
        : {}),
    };
    const next: ProbeResult[] = [];

    for (const probe of NV_PARTNER_SMOKE_PROBES) {
      const t0 = performance.now();
      try {
        const res = await fetch(probe.path, {
          method: probe.method,
          headers,
          body: probe.method === 'POST' ? probe.sampleBody ?? '{}' : undefined,
        });
        next.push({
          id: probe.id,
          label: probe.label,
          platform: probe.platform,
          path: probe.path,
          status: res.status,
          durationMs: Math.round(performance.now() - t0),
          ok: res.ok,
        });
      } catch (err) {
        next.push({
          id: probe.id,
          label: probe.label,
          platform: probe.platform,
          path: probe.path,
          status: null,
          durationMs: Math.round(performance.now() - t0),
          ok: false,
          error: err instanceof Error ? err.message : 'Network error',
        });
      }
    }

    setResults(next);
    setRunning(false);
  }

  const passCount = results.filter((r) => r.ok).length;
  const display = results.length
    ? results
    : NV_PARTNER_SMOKE_PROBES.map((p) => ({
        id: p.id,
        label: p.label,
        platform: p.platform,
        path: p.path,
        status: null as number | null,
        durationMs: 0,
        ok: false as const,
      }));

  const byPlatform = new Map<string, ProbeResult[]>();
  for (const row of display) {
    const key = PLATFORM_LABELS[row.platform];
    const list = byPlatform.get(key) ?? [];
    list.push(row);
    byPlatform.set(key, list);
  }

  return (
    <Card className="border-amber-200 bg-amber-50/50" data-testid="partner-smoke-panel">
      <CardHeader className="py-3">
        <CardTitle className="text-sm text-foreground flex items-center justify-between">
          <span>Partner smoke matrix (NSP · NYM · JRX · CNR · Docparse)</span>
          <Button size="sm" onClick={runAll} disabled={running} className="bg-[#152448] text-white hover:bg-[#2B384C]">
            {running ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
            Run smoke
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <p className="text-xs text-muted-foreground">
          Live gateway probes via console JWT. 401/403 = auth tier; 503 on docparse = flag off on host. No API keys shown.
        </p>
        {results.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <Badge variant={passCount === results.length ? 'default' : 'secondary'}>
              {passCount}/{results.length} passed
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => setResults([])}>
              <RefreshCw className="h-3 w-3" /> Clear
            </Button>
          </div>
        )}
        {[...byPlatform.entries()].map(([platform, rows]) => (
          <div key={platform}>
            <div className="text-xs font-semibold text-muted-foreground mb-1">{platform}</div>
            <div className="space-y-1">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-xs py-1 border-b border-border/50">
                  <span className="text-foreground font-medium">{r.label}</span>
                  <div className="flex items-center gap-2">
                    {r.status != null && <span className="font-mono text-muted-foreground">{r.status}</span>}
                    {r.durationMs > 0 && <span className="text-muted-foreground">{r.durationMs}ms</span>}
                    {results.length > 0 && (
                      r.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
