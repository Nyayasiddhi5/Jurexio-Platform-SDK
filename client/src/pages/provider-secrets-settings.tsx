/**
 * Super-admin: manage LLM / provider API keys from the dashboard (hot-apply).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { KeyRound, RefreshCw, Shield, Trash2 } from 'lucide-react';
import { apiRequest } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';

type CatalogEntry = {
  providerId: string;
  label: string;
  envNames: string[];
  description: string;
};

type SecretStatus = {
  providerId: string;
  envName: string;
  configured: boolean;
  last4: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  reason: string | null;
};

export default function ProviderSecretsSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<{ providerId: string; envName: string } | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');

  const catalogQ = useQuery({
    queryKey: ['/api/jrx/admin/provider-secrets/catalog'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/jrx/admin/provider-secrets/catalog');
      const json = await res.json();
      return (json?.data?.providers || []) as CatalogEntry[];
    },
  });

  const statusQ = useQuery({
    queryKey: ['/api/jrx/admin/provider-secrets'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/jrx/admin/provider-secrets');
      const json = await res.json();
      return (json?.data?.secrets || []) as SecretStatus[];
    },
  });

  const byKey = useMemo(() => {
    const m = new Map<string, SecretStatus>();
    for (const s of statusQ.data || []) m.set(`${s.providerId}:${s.envName}`, s);
    return m;
  }, [statusQ.data]);

  const upsert = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('Select a key');
      const res = await apiRequest(
        'PUT',
        `/api/jrx/admin/provider-secrets/${selected.providerId}/${selected.envName}`,
        { value, reason: reason || undefined },
      );
      return res.json();
    },
    onSuccess: (json) => {
      toast({
        title: 'Key applied (hot)',
        description: json?.data?.message || 'Secret stored and applied without restart.',
      });
      setValue('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['/api/jrx/admin/provider-secrets'] });
    },
    onError: (e: any) => {
      toast({ title: 'Update failed', description: e?.message || String(e), variant: 'destructive' });
    },
  });

  const clear = useMutation({
    mutationFn: async (row: SecretStatus) => {
      const res = await apiRequest(
        'DELETE',
        `/api/jrx/admin/provider-secrets/${row.providerId}/${row.envName}`,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Overlay cleared', description: 'Dashboard overlay removed for this key.' });
      qc.invalidateQueries({ queryKey: ['/api/jrx/admin/provider-secrets'] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6" data-testid="provider-secrets-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl tracking-tight text-[#152448]">LLM & Provider Secrets</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Set or rotate outbound LLM / integration API keys from the dashboard. Changes hot-apply to the
            running gateway (no .env edit or restart for new calls). Values are never shown after save.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            statusQ.refetch();
            catalogQ.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <Shield className="mr-2 inline h-4 w-4" />
        Super-admin only. Prefer Secrets Manager for JWT/DB/Redis. Use this page for Gemini, OpenAI,
        OpenRouter, NYS machine key, and similar LLM credentials.
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {(catalogQ.data || []).map((p) => (
          <div key={p.providerId} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-[#C7B15B]" />
              <h2 className="font-medium text-[#152448]">{p.label}</h2>
            </div>
            <p className="mb-3 text-xs text-slate-500">{p.description}</p>
            <div className="space-y-2">
              {p.envNames.map((envName) => {
                const st = byKey.get(`${p.providerId}:${envName}`);
                const active = selected?.providerId === p.providerId && selected?.envName === envName;
                return (
                  <div
                    key={envName}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                      active ? 'border-[#152448] bg-slate-50' : 'border-slate-100'
                    }`}
                  >
                    <button
                      type="button"
                      className="text-left"
                      onClick={() => setSelected({ providerId: p.providerId, envName })}
                    >
                      <div className="font-mono text-xs">{envName}</div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <Badge variant={st?.configured ? 'default' : 'secondary'}>
                          {st?.configured ? `set ···${st.last4 || '****'}` : 'missing'}
                        </Badge>
                        {st?.reason && <span className="text-[10px] text-slate-400">{st.reason}</span>}
                      </div>
                    </button>
                    {st?.configured && st.reason !== 'from_environment' && (
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => clear.mutate(st)}
                        title="Clear dashboard overlay"
                      >
                        <Trash2 className="h-4 w-4 text-slate-400" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <div className="rounded-xl border border-[#152448]/20 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-medium text-[#152448]">
            Update {selected.providerId} / <span className="font-mono">{selected.envName}</span>
          </h3>
          <div className="space-y-3">
            <div>
              <Label htmlFor="secret-value">New secret value</Label>
              <Input
                id="secret-value"
                type="password"
                autoComplete="off"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste API key…"
                className="mt-1 font-mono"
              />
            </div>
            <div>
              <Label htmlFor="secret-reason">Reason (optional audit note)</Label>
              <Textarea
                id="secret-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1"
                rows={2}
              />
            </div>
            <Button
              onClick={() => upsert.mutate()}
              disabled={!value.trim() || upsert.isPending}
              className="bg-[#152448] hover:bg-[#1c2f5c]"
            >
              {upsert.isPending ? 'Applying…' : 'Save & hot-apply'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
