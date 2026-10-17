/**
 * Platform Limits admin — tier catalog + per-platform rate limits.
 * Wired to GET /api/jrx/sdk/platform/tiers, GET /api/jrx/sdk/platform/limits (JWT bypass),
 * PATCH /api/jrx/platforms/:id/rate-limits (super_admin JWT).
 */
import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';
import { useToast } from '@/hooks/use-toast';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv, p } from '@/lib/jrx-api-paths';
import { RefreshCw, Save, Layers } from 'lucide-react';

interface PlatformLimitsPanelProps {
  platformId: string;
  platformName: string;
  initialLimits?: Record<string, unknown>;
  onSaved?: () => void;
}

type TierEntry = {
  id: string;
  label: string;
  rpm?: number;
  dailyTokenBudget?: number;
  monthlyTokenBudget?: number;
};

function authHeaders(): Record<string, string> {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function PlatformLimitsPanel({
  platformId,
  platformName,
  initialLimits = {},
  onSaved,
}: PlatformLimitsPanelProps) {
  const { toast } = useToast();
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initialLimits).map(([k, v]) => [k, String(v ?? '')]),
    ),
  );

  const tiersQ = useQuery({
    queryKey: [nv('sdk/platform/tiers')],
    queryFn: async () => {
      const res = await fetch(nv('sdk/platform/tiers'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Tiers HTTP ${res.status}`);
      return res.json();
    },
  });

  const limitsQ = useQuery({
    queryKey: [nv('sdk/platform/limits'), platformId],
    queryFn: async () => {
      const res = await fetch(nv('sdk/platform/limits'), { headers: authHeaders() });
      if (!res.ok) throw new Error(`Limits HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!platformId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, number> = {};
      for (const [k, v] of Object.entries(limits)) {
        const n = Number(v);
        if (v.trim() !== '' && Number.isFinite(n)) body[k] = n;
      }
      const res = await fetch(`${NV_BASE}platforms/${platformId}/rate-limits`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Save failed HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Rate limits updated', description: platformName });
      onSaved?.();
    },
    onError: (err: Error) =>
      toast({ title: 'Update failed', description: err.message, variant: 'destructive' }),
  });

  const platformTiers: TierEntry[] =
    tiersQ.data?.data?.platform_tiers
      ? Object.entries(tiersQ.data.data.platform_tiers as Record<string, TierEntry>).map(
          ([id, t]) => ({ ...t, id }),
        )
      : [];

  const headroom = limitsQ.data?.data?.headroom;
  const usageToday = limitsQ.data?.data?.usage_today;

  return (
    <div className="space-y-4 text-sm" data-testid="platform-limits-panel">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground">
          Tier catalog from <code className="text-xs">{p('ADMIN_PLATFORMS').path.replace('/platforms', '/sdk/platform/tiers')}</code>
          {' · '}Edit via PATCH <code className="text-xs">/api/jrx/platforms/:id/rate-limits</code>
        </p>
        <Button variant="outline" size="sm" onClick={() => { tiersQ.refetch(); limitsQ.refetch(); }}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
        </Button>
      </div>

      {tiersQ.isLoading && <Skeleton className="h-24 w-full" />}
      {tiersQ.isError && (
        <NyvErrorState title="Could not load tier catalog" onRetry={() => tiersQ.refetch()} variant="card" size="sm" />
      )}
      {platformTiers.length > 0 && (
        <Card>
          <CardHeader className="py-3">
            <CardTitle className="text-sm flex items-center gap-2 text-foreground">
              <Layers className="h-4 w-4 text-[#C7B15B]" /> Platform tier matrix
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-2 pr-3">Tier</th>
                  <th className="text-right py-2 px-2">RPM</th>
                  <th className="text-right py-2 px-2">Daily tokens</th>
                  <th className="text-right py-2 pl-2">Monthly tokens</th>
                </tr>
              </thead>
              <tbody>
                {platformTiers.map((t) => (
                  <tr key={t.id} className="border-b border-border/50">
                    <td className="py-2 pr-3 font-medium text-foreground">{t.label ?? t.id}</td>
                    <td className="text-right py-2 px-2 font-mono">{t.rpm?.toLocaleString() ?? '—'}</td>
                    <td className="text-right py-2 px-2 font-mono">{t.dailyTokenBudget?.toLocaleString() ?? '—'}</td>
                    <td className="text-right py-2 pl-2 font-mono">{t.monthlyTokenBudget?.toLocaleString() ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {usageToday && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Today tokens: {(usageToday.tokensTotal ?? 0).toLocaleString()}</Badge>
          {headroom?.daily_tokens_remaining != null && (
            <Badge variant="outline">Headroom: {headroom.daily_tokens_remaining.toLocaleString()}</Badge>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm text-foreground">Rate limits — {platformName}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          {Object.keys(limits).length === 0 ? (
            <NyvEmptyState title="No limits configured" description="Add keys below or select a platform with existing limits." size="sm" />
          ) : (
            Object.entries(limits).map(([key, val]) => (
              <div key={key} className="grid grid-cols-2 gap-2 items-center">
                <Label className="text-muted-foreground capitalize">{key.replace(/_/g, ' ')}</Label>
                <Input
                  type="number"
                  value={val}
                  onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                  className="font-mono text-foreground"
                />
              </div>
            ))
          )}
          <div className="grid grid-cols-2 gap-2 items-center pt-2 border-t border-border">
            <Label className="text-muted-foreground">Add limit key</Label>
            <div className="flex gap-2">
              <Input
                placeholder="rpm_per_minute"
                id="new-limit-key"
                className="text-foreground"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const input = e.currentTarget;
                    const k = input.value.trim();
                    if (k && !limits[k]) setLimits((prev) => ({ ...prev, [k]: '' }));
                    input.value = '';
                  }
                }}
              />
            </div>
          </div>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="bg-[#152448] hover:bg-[#2B384C] text-white"
          >
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? 'Saving…' : 'Save limits'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
