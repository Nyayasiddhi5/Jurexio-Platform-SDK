import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { LoadingSpinner } from '@/components/ui/loading-spinner';
import { AlertCircle, CheckCircle2, Construction, FileCode2 } from 'lucide-react';
import type { ElementType } from 'react';

export interface PhaseCScaffoldProps {
  title: string;
  description: string;
  endpoint: string;
  icon: ElementType;
  scope?: string;
  minRole?: string;
  capabilities: string[];
  pageDataTestId: string;
}

interface StubResponse {
  ok?: boolean;
  feature_flag?: string;
  status?: string;
  message?: string;
  deferredReason?: string | null;
  data?: unknown;
}

export function PhaseCScaffold({
  title,
  description,
  endpoint,
  icon: Icon,
  scope,
  minRole,
  capabilities,
  pageDataTestId,
}: PhaseCScaffoldProps) {
  const { data, isLoading, error } = useQuery<StubResponse>({
    queryKey: [endpoint],
    queryFn: async () => {
      const res = await fetch(endpoint, { credentials: 'include' });
      const json = await res.json().catch(() => ({}));
      return { ...json, _httpStatus: res.status } as StubResponse;
    },
    retry: false,
  });

  const isStub = (data as StubResponse & { _httpStatus?: number })?._httpStatus === 501;
  const isLive = !isLoading && !error && !isStub && (data as StubResponse & { _httpStatus?: number })?._httpStatus === 200;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto" data-testid={pageDataTestId}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
            <Icon className="w-6 h-6 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground mt-1">{description}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {isLive && <Badge variant="default" className="bg-emerald-600"><CheckCircle2 className="w-3 h-3 mr-1" />Live</Badge>}
          {isStub && <Badge variant="outline" className="border-amber-500 text-amber-700 dark:text-amber-400"><Construction className="w-3 h-3 mr-1" />Phase C scaffold</Badge>}
          {error && <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />API unreachable</Badge>}
          {scope && <Badge variant="outline" className="font-mono text-xs">scope: {scope}</Badge>}
          {minRole && <Badge variant="outline" className="font-mono text-xs">minRole: {minRole}</Badge>}
        </div>
      </div>

      {isLoading && (
        <Card><CardContent className="p-12 flex items-center justify-center"><LoadingSpinner /></CardContent></Card>
      )}

      {isStub && (
        <Alert className="border-amber-500/50 bg-amber-50/50 dark:bg-amber-950/20">
          <Construction className="h-4 w-4 text-amber-600" />
          <AlertTitle>Feature pending — backend stub returns 501</AlertTitle>
          <AlertDescription className="space-y-2 mt-2">
            <p>This page is a Phase C scaffold introduced 2026-05-06. The backend
            route <code className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 font-mono text-xs">{endpoint}</code> is mounted
            and returns <code className="font-mono">501 Not Implemented</code> with
            <code className="ml-1 font-mono">feature_flag: &quot;{(data as StubResponse)?.feature_flag ?? 'pending'}&quot;</code>.</p>
            <p>The page renders correctly so navigation tests pass. To activate, replace the
            handler in <code className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 font-mono text-xs">src/routes/jrx-phase-c-stubs-routes.ts</code> with
            the real implementation.</p>
            {(data as StubResponse)?.deferredReason && (
              <p className="text-amber-900 dark:text-amber-200 font-medium">
                Deferred: {(data as StubResponse).deferredReason}
              </p>
            )}
          </AlertDescription>
        </Alert>
      )}

      {error && !isStub && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Backend unreachable</AlertTitle>
          <AlertDescription>Could not reach <code className="font-mono">{endpoint}</code>. Check the gateway is running.</AlertDescription>
        </Alert>
      )}

      {isLive && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live data from <code className="font-mono text-xs">{endpoint}</code></CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-xs bg-slate-50 dark:bg-slate-900 p-3 rounded overflow-auto max-h-96">
              {JSON.stringify((data as StubResponse)?.data ?? data, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileCode2 className="w-4 h-4" />Planned capabilities
          </CardTitle>
          <CardDescription>What this surface will expose once the backend lands</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {capabilities.map((cap, i) => (
              <li key={i} className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                <span>{cap}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
