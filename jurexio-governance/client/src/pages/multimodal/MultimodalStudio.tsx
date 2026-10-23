/**
 * Multimodal Studio — operator health + SDK capability map (2026-05-28).
 * Backend: GET /api/nv5/multimodal/health (always-on liveness + feature flags)
 */
import { useQuery } from '@tanstack/react-query';
import { Clapperboard, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { p } from '@/lib/jrx-api-paths';

type MultimodalHealth = {
  ok: boolean;
  namespace: string;
  version: string;
  uptimeSec: number;
  flags: Record<string, boolean>;
};

export default function MultimodalStudio() {
  const q = useQuery({
    queryKey: ['multimodal-health'],
    queryFn: async () => {
      const r = await fetch(p('MULTIMODAL_HEALTH'), { credentials: 'include' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<MultimodalHealth>;
    },
    refetchInterval: 30_000,
  });

  const flags = Object.entries(q.data?.flags ?? {});

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-multimodal-studio">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Clapperboard className="w-6 h-6" /> Multimodal Studio
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Vision, video, audio, and 3D routes — feature flags from /api/nv5/multimodal/health.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => q.refetch()} disabled={q.isFetching}>
          <RefreshCw className={`w-4 h-4 mr-1 ${q.isFetching ? 'animate-spin' : ''}`} /> Refresh
        </Button>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Namespace</CardTitle></CardHeader>
          <CardContent>{q.isLoading ? <Skeleton className="h-6 w-24" /> : <code>{q.data?.namespace}</code>}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Version</CardTitle></CardHeader>
          <CardContent>{q.isLoading ? <Skeleton className="h-6 w-16" /> : q.data?.version}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Uptime</CardTitle></CardHeader>
          <CardContent>{q.isLoading ? <Skeleton className="h-6 w-20" /> : `${q.data?.uptimeSec ?? 0}s`}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Sub-mount feature flags</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {q.isLoading && <Skeleton className="h-8 w-full" />}
          {flags.map(([name, on]) => (
            <Badge key={name} variant={on ? 'default' : 'secondary'} data-testid={`flag-${name}`}>
              {name}: {on ? 'ON' : 'OFF'}
            </Badge>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm">SDK invocation paths</CardTitle></CardHeader>
        <CardContent className="text-sm text-slate-600 space-y-1 font-mono text-xs">
          <div>POST /api/jrx/sdk/multimodal/multimodal/vision/analyze</div>
          <div>POST /api/jrx/sdk/multimodal/multimodal/rag/query</div>
          <div>GET /api/jrx/sdk/multimodal/multimodal/capabilities (SDK key)</div>
        </CardContent>
      </Card>
    </div>
  );
}
