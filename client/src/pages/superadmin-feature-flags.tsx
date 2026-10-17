/**
 * Super Admin — Feature Flags
 * Wired to GET/PATCH /api/jrx/admin/feature-flags (JWT super_admin).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvErrorState } from '@/components/NyvErrorState';
import { NyvPageShell } from '@/components/NyvPageShell';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, p } from '@/lib/jrx-api-paths';
import { ToggleLeft, RefreshCw } from 'lucide-react';

type FeatureFlag = {
  key: string;
  name?: string;
  description?: string;
  enabled: boolean;
  value?: unknown;
};

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function SuperAdminFeatureFlags() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const flagsQ = useQuery({
    queryKey: [p('ADMIN_FEATURE_FLAGS')],
    queryFn: async () => {
      const res = await fetch(p('ADMIN_FEATURE_FLAGS'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const rows = json.flags ?? json.data ?? json;
      return Array.isArray(rows) ? rows : Object.entries(rows as Record<string, unknown>).map(([key, val]) => ({
        key,
        enabled: typeof val === 'boolean' ? val : !!(val as { enabled?: boolean })?.enabled,
        value: val,
      }));
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      setPending(key);
      const res = await fetch(`${NV_BASE}admin/feature-flags/${encodeURIComponent(key)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ enabled, value: enabled }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [p('ADMIN_FEATURE_FLAGS')] });
      toast({ title: 'Feature flag updated' });
    },
    onError: (err: Error) => toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
    onSettled: () => setPending(null),
  });

  const flags = (flagsQ.data ?? []) as FeatureFlag[];

  return (
    <NyvPageShell
      title="Feature Flags"
      description="Super Admin — toggle JRX_F_* flags governing platform surfaces. Read/write via /api/jrx/admin/feature-flags."
      className="./jrx-light-scope"
      testId="superadmin-feature-flags"
      actions={
        <Button variant="outline" size="sm" onClick={() => flagsQ.refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      }
    >
      {flagsQ.isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
        </div>
      )}
      {flagsQ.isError && (
        <NyvErrorState title="Could not load feature flags" onRetry={() => flagsQ.refetch()} variant="card" />
      )}
      {!flagsQ.isLoading && !flagsQ.isError && (
        <div className="space-y-2">
          {flags.length === 0 && (
            <p className="text-sm text-muted-foreground">No flags returned — check super_admin JWT.</p>
          )}
          {flags.map((f) => (
            <Card key={f.key}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <ToggleLeft className="h-5 w-5 text-[#C7B15B] mt-0.5" />
                  <div>
                    <p className="font-medium text-foreground font-mono text-sm">{f.key}</p>
                    {f.description && <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>}
                    <Badge variant="outline" className="mt-1 text-[10px]">{f.enabled ? 'ON' : 'OFF'}</Badge>
                  </div>
                </div>
                <Switch
                  checked={f.enabled}
                  disabled={pending === f.key}
                  onCheckedChange={(v) => toggleMutation.mutate({ key: f.key, enabled: v })}
                  aria-label={`Toggle ${f.key}`}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </NyvPageShell>
  );
}
