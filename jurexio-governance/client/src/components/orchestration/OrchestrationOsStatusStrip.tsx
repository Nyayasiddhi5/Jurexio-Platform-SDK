/**
 * OS readiness strip for Orchestration Hub — surfaces Queen SSE, India lock,
 * QualityEnvelope, AdaptiveRouter, neural rerank honesty without inventing live metrics.
 */
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ShieldCheck, Radio, MapPin, Route, Sparkles } from 'lucide-react';

type HealthSlice = {
  status?: string;
  totalAgents?: number;
  environment?: string;
  services?: {
    agents?: { totalAgents?: number; byJurisdiction?: Record<string, number> };
  };
};

async function fetchHealth(): Promise<HealthSlice> {
  const res = await fetch('/api/jrx/health', { credentials: 'include' });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json();
}

const FEATURES = [
  {
    id: 'queen-sse',
    label: 'Queen synthesis SSE',
    detail: 'Provisional tokens + post-safety gated final (synthesis_final)',
    icon: Radio,
  },
  {
    id: 'adaptive',
    label: 'AdaptiveRouter',
    detail: 'Queen | specialist | doc-pipeline with osDepth',
    icon: Route,
  },
  {
    id: 'qe',
    label: 'QualityEnvelope',
    detail: 'Fail-closed grounding / safety notes on orch responses',
    icon: ShieldCheck,
  },
  {
    id: 'india',
    label: 'India-first lock',
    detail: 'NV_PRIMARY_JURISDICTION=IN · partner India scope middleware',
    icon: MapPin,
  },
  {
    id: 'rerank',
    label: 'Neural rerank honesty',
    detail: 'Neural only when Cohere / Voyage / CROSS_ENCODER configured',
    icon: Sparkles,
  },
] as const;

export function OrchestrationOsStatusStrip() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['orch-os-health'],
    queryFn: fetchHealth,
    staleTime: 30_000,
  });

  const agents = data?.totalAgents ?? data?.services?.agents?.totalAgents ?? '—';
  const jur = data?.services?.agents?.byJurisdiction?.IN;
  const healthOk = !isError && String(data?.status || '').toLowerCase() !== 'unhealthy';
  const posture = isLoading ? '…' : healthOk ? 'Live' : 'Degraded';

  return (
    <Card className="mb-4 border-dashed" data-testid="orch-os-status-strip">
      <CardHeader className="py-3 pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          Legal AI OS — runtime posture
          <Badge variant="secondary">{isLoading ? '…' : isError ? 'health unavailable' : `${agents} agents`}</Badge>
          {jur != null ? <Badge variant="outline">IN overlay {jur}</Badge> : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5 pb-4">
        {FEATURES.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.id} className="rounded-md border p-2.5 text-sm" data-testid={`os-feature-${f.id}`}>
              <div className="flex items-center gap-1.5 font-medium">
                <Icon className="h-3.5 w-3.5 opacity-70" />
                {f.label}
                <Badge className="ml-auto text-[10px]" variant={healthOk ? 'default' : 'secondary'}>{posture}</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground leading-snug">{f.detail}</p>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export default OrchestrationOsStatusStrip;
