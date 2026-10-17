import { getAuthToken } from '@/lib/jrx-auth-token';
import { apiRequest } from '@/lib/queryClient';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Enterprise Platform SDK Key Management
 * Generate, copy (once), rotate, revoke SDK keys for all 4 key types.
 * Live-wired to /api/jrx/sdk/keys/:appId/*
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Key, RefreshCw, Copy, Trash2, CheckCircle2, AlertTriangle,
  XCircle, Clock, Shield, Plus, Eye, EyeOff, Lock, Zap,
  Info, ExternalLink,
} from 'lucide-react';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface SdkKey {
  id: string;
  key_type: string;
  key_prefix: string;
  name: string;
  scopes: string[];
  rate_limit: number;
  is_active: boolean;
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
}

interface KeyStatusItem {
  key_type: string;
  status: string;
  expires_at: string | null;
  last_used_at: string | null;
  days_until_expiry: number | null;
  action_required: boolean;
}

interface GeneratedKey {
  key_id: string;
  key_type: string;
  raw_key: string;
  key_prefix: string;
  scopes: string[];
  expires_at: string;
}

const KEY_META: Record<string, { label: string; desc: string; format: string; color: string }> = {
  sdk_api_key:    { label: 'SDK API Key',       desc: 'Primary backend authentication. Use in server-side code only.',         format: 'nyv_live_sk_...',  color: 'text-blue-400' },
  webhook_secret: { label: 'Webhook Secret',    desc: 'HMAC-SHA256 signing for incoming webhooks.',                            format: 'nyv_wh_...',       color: 'text-amber-400' },
  publishable_key:{ label: 'Publishable Key',   desc: 'Frontend-safe key. Limited scopes. Safe to expose in browser.',         format: 'nyv_pk_...',       color: 'text-emerald-400' },
  signing_key:    { label: 'Signing Key',        desc: 'Request signing (HMAC-SHA256). Never expose in client-side code.',     format: 'nyv_ss_...',       color: 'text-purple-400' },
};

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-emerald-500/20 text-emerald-700 border-emerald-200',
  expiring_soon: 'bg-amber-500/20 text-amber-700 border-amber-200',
  expired: 'bg-red-500/20 text-red-700 border-red-200',
  missing: 'bg-slate-500/20 text-slate-600 border-slate-300',
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: 'Copied to clipboard', description: 'Key copied. Store it securely — it will not be shown again.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Button size="sm" variant="outline" onClick={handleCopy} className="border-slate-300 text-slate-700 hover:bg-slate-200 text-xs h-7 px-2" aria-label="Copy key to clipboard">
      {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
    </Button>
  );
}

function GenerateKeyModal({ appId, onGenerated }: { appId: string; onGenerated: (key: GeneratedKey) => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [keyType, setKeyType] = useState('sdk_api_key');
  const [name, setName] = useState('');

  const generateMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/keys/${appId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ key_type: keyType, name: name || undefined }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? 'Failed to generate key'); }
      return resp.json();
    },
    onSuccess: (data) => {
      onGenerated(data);
      setOpen(false);
    },
    onError: (err: Error) => toast({ title: 'Key generation failed', description: err.message, variant: 'destructive' }),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="bg-[#152448] hover:bg-[#0a3580] text-white text-xs" aria-label="Generate new SDK key">
          <Plus className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Generate Key
        </Button>
      </DialogTrigger>
      <DialogContent className="bg-white border-slate-200 max-w-md" aria-label="Generate new SDK key">
        <DialogHeader>
          <DialogTitle className="text-[#152448]">Generate SDK Key</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 mt-2">
          <Select value={keyType} onValueChange={setKeyType}>
            <SelectTrigger className="bg-slate-100 border-slate-200 text-[#152448]" aria-label="Select key type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              {Object.entries(KEY_META).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  <span className={cn('font-medium', v.color)}>{v.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {keyType && (
            <div className="p-3 rounded-lg bg-slate-100/50 border border-slate-200/40 text-xs text-slate-600">
              <p className="font-medium text-slate-700 mb-1">{KEY_META[keyType]?.label}</p>
              <p>{KEY_META[keyType]?.desc}</p>
              <p className="font-mono mt-1 text-slate-700">Format: {KEY_META[keyType]?.format}</p>
            </div>
          )}
          <Input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Key name (optional)"
            className="bg-slate-100 border-slate-200 text-[#152448] text-sm"
            aria-label="Key name"
          />
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 flex items-start gap-2">
            <Info className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" aria-hidden="true" />
            The raw key is shown ONCE at generation. Copy it immediately and store it securely in your secrets manager.
          </div>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="w-full bg-[#152448] hover:bg-[#0a3580] text-white"
            aria-label="Confirm key generation"
          >
            {generateMutation.isPending ? 'Generating...' : 'Generate Key'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SdkKeyManagement() {
  const { toast } = useToast();
  const [selectedApp, setSelectedApp] = useState<string>('');
  const [newKey, setNewKey] = useState<GeneratedKey | null>(null);
  const [revokeConfirmId, setRevokeConfirmId] = useState<string | null>(null);

  // Load the live Platform Registry for the key-issuance dropdown. Use the shared
  // apiRequest (Bearer + credentials + Retry-After-aware) and let it THROW on
  // error so a transient 429/401 backs off via react-query instead of silently
  // collapsing to an empty list that reads as "No platforms registered" (D-7).
  const { data: appsData, isLoading: appsLoading, isError: appsError } = useQuery({
    queryKey: ['sdk-apps-list', nv('platforms')],
    queryFn: async () => {
      const r: any = await apiRequest(nv('platforms'));
      // /api/jrx/platforms returns { platforms: [...] } (not a {success,data} envelope);
      // apiRequest passes it through, so read .platforms (with defensive fallbacks).
      const list = r?.platforms ?? r?.data?.platforms ?? (Array.isArray(r?.data) ? r.data : []);
      return { platforms: Array.isArray(list) ? list : [] };
    },
    staleTime: 60_000,
  });

  const apps = appsData?.platforms ?? [];

  useEffect(() => {
    if (apps.length > 0 && !selectedApp) {
      setSelectedApp(apps[0].id);
    }
  }, [apps, selectedApp]);

  // Load keys for selected app
  const { data: keysData, refetch: refetchKeys } = useQuery({
    queryKey: ['sdk-keys', selectedApp],
    queryFn: async () => {
      if (!selectedApp) return { keys: [] };
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/keys/${selectedApp}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!resp.ok) return { keys: [] };
      return resp.json();
    },
    enabled: !!selectedApp,
  });

  // Load key status
  const { data: statusData } = useQuery({
    queryKey: ['sdk-keys-status', selectedApp],
    queryFn: async () => {
      if (!selectedApp) return null;
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/keys/${selectedApp}/status`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!resp.ok) return null;
      return resp.json();
    },
    enabled: !!selectedApp,
  });

  const revokeMutation = useMutation({
    mutationFn: async (keyId: string) => {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/keys/${selectedApp}/revoke/${keyId}`, {
        method: 'POST',
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!resp.ok) throw new Error('Failed to revoke key');
      return resp.json();
    },
    onSuccess: () => { refetchKeys(); toast({ title: 'Key revoked' }); },
    onError: (err: Error) => toast({ title: 'Revoke failed', description: err.message, variant: 'destructive' }),
  });

  const rotateMutation = useMutation({
    mutationFn: async (keyType: string) => {
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/keys/${selectedApp}/rotate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ key_type: keyType, revoke_old: true }),
      });
      if (!resp.ok) throw new Error('Failed to rotate key');
      return resp.json();
    },
    onSuccess: (data) => { refetchKeys(); setNewKey(data); toast({ title: 'Key rotated — copy the new key now!' }); },
    onError: (err: Error) => toast({ title: 'Rotation failed', description: err.message, variant: 'destructive' }),
  });

  const keys: SdkKey[] = keysData?.keys ?? [];
  const statuses: KeyStatusItem[] = statusData?.key_status ?? [];

  const selectedAppName = apps.find((a: { id: string; display_name?: string; name?: string }) => a.id === selectedApp)?.display_name ?? 'Platform';

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="SDK Key Management">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-amber-900">
              <Key className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">SDK Key Management</h1>
          </div>
          <p className="text-sm text-slate-600">Generate, rotate, and revoke the 4 security credentials for each Jurexio platform</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedApp} onValueChange={setSelectedApp}>
            <SelectTrigger className="w-52 bg-slate-100 border-slate-200 text-slate-800 text-xs" aria-label="Select platform">
              <SelectValue placeholder="Select platform..." />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              {apps.map((a: { id: string; display_name?: string; name?: string }) => (
                <SelectItem key={a.id} value={a.id}>{a.display_name ?? a.name}</SelectItem>
              ))}
              {apps.length === 0 && appsLoading && <SelectItem value="loading" disabled>Loading platforms…</SelectItem>}
              {apps.length === 0 && !appsLoading && appsError && <SelectItem value="error" disabled>Registry unavailable — retry shortly</SelectItem>}
              {apps.length === 0 && !appsLoading && !appsError && <SelectItem value="none" disabled>No platforms registered</SelectItem>}
            </SelectContent>
          </Select>
          {selectedApp && <GenerateKeyModal appId={selectedApp} onGenerated={k => { setNewKey(k); refetchKeys(); }} />}
        </div>
      </div>

      {/* NEW KEY REVEALED */}
      {newKey && (
        <Card className="bg-amber-950/30 border-amber-500/40 mb-6" role="alert" aria-label="New key generated - copy now">
          <CardHeader className="pb-2">
            <CardTitle className="text-amber-700 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Copy Your Key Now — This Is the ONLY Time It Will Be Shown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-black/40 border border-amber-200">
              <code className="flex-1 text-amber-700 font-mono text-sm break-all" aria-label="Raw key value">{newKey.raw_key}</code>
              <CopyButton text={newKey.raw_key} />
            </div>
            <div className="flex items-center justify-between mt-3 text-xs text-slate-600">
              <span>Type: <strong className="text-white">{newKey.key_type}</strong></span>
              <span>Expires: <strong className="text-white">{new Date(newKey.expires_at).toLocaleDateString()}</strong></span>
              <span>Scopes: <strong className="text-white">{newKey.scopes.join(', ')}</strong></span>
              <Button size="sm" variant="ghost" className="text-xs text-slate-700 hover:text-slate-700" onClick={() => setNewKey(null)} aria-label="Dismiss key reveal">Dismiss</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Key Status Overview */}
      {statuses.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {statuses.map(s => (
            <Card key={s.key_type} className={cn('border', s.action_required ? 'border-amber-500/40 bg-amber-950/20' : 'border-slate-200/50 bg-white')} aria-label={`${KEY_META[s.key_type]?.label}: ${s.status}`}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-1">
                  <p className={cn('text-xs font-medium', KEY_META[s.key_type]?.color ?? 'text-white')}>{KEY_META[s.key_type]?.label ?? s.key_type}</p>
                  <Badge className={cn('text-[9px]', STATUS_COLORS[s.status] ?? STATUS_COLORS.missing)} aria-label={`Status: ${s.status}`}>{s.status.replace(/_/g, ' ')}</Badge>
                </div>
                {s.days_until_expiry !== null && (
                  <p className="text-[10px] text-slate-700 flex items-center gap-1">
                    <Clock className="w-3 h-3" aria-hidden="true" />
                    {s.days_until_expiry > 0 ? `${s.days_until_expiry}d remaining` : 'Expired'}
                  </p>
                )}
                {s.action_required && (
                  <Button
                    size="sm"
                    className="w-full mt-2 text-[10px] h-6 bg-amber-600 hover:bg-amber-500 text-white"
                    onClick={() => rotateMutation.mutate(s.key_type)}
                    disabled={rotateMutation.isPending}
                    aria-label={`Rotate ${s.key_type}`}
                  >
                    <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> Rotate Now
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Key List */}
      <Card className="bg-white border-slate-200/50">
        <CardHeader className="pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
            <Key className="w-4 h-4 text-amber-400" aria-hidden="true" /> Keys for {selectedAppName}
          </CardTitle>
          <span className="text-xs text-slate-600" aria-label={`Total keys: ${keys.length}`}>{keys.length} keys</span>
        </CardHeader>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="text-center py-10 text-slate-600 text-sm">
              <Key className="w-8 h-8 mx-auto mb-2 text-slate-600" aria-hidden="true" />
              {selectedApp ? 'No keys generated yet. Click "Generate Key" to create the first one.' : 'Select a platform to manage its keys.'}
            </div>
          ) : (
            <table className="w-full text-xs" role="grid" aria-label="SDK keys table">
              <thead>
                <tr className="border-b border-slate-200">
                  <th className="text-left py-3 px-4 text-slate-600 font-medium" scope="col">Key</th>
                  <th className="text-left py-3 px-3 text-slate-600 font-medium" scope="col">Type</th>
                  <th className="text-left py-3 px-3 text-slate-600 font-medium" scope="col">Status</th>
                  <th className="text-left py-3 px-3 text-slate-600 font-medium" scope="col">Expires</th>
                  <th className="text-left py-3 px-3 text-slate-600 font-medium" scope="col">Last Used</th>
                  <th className="text-right py-3 px-4 text-slate-600 font-medium" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(key => (
                  <tr key={key.id} className="border-b border-slate-200/50 hover:bg-slate-100/20" role="row">
                    <td className="py-3 px-4">
                      <div>
                        <p className="font-medium text-slate-800">{key.name}</p>
                        <p className="font-mono text-slate-700 text-[10px]">{key.key_prefix}••••••••</p>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span className={cn('font-medium', KEY_META[key.key_type]?.color ?? 'text-slate-700')} aria-label={`Key type: ${key.key_type}`}>
                        {KEY_META[key.key_type]?.label ?? key.key_type}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        className={cn('text-[9px]', key.is_active ? 'bg-emerald-500/20 text-emerald-700 border-emerald-200' : 'bg-slate-500/20 text-slate-600 border-slate-300')}
                        aria-label={`Status: ${key.is_active ? 'Active' : 'Revoked'}`}
                      >
                        {key.is_active ? 'Active' : 'Revoked'}
                      </Badge>
                    </td>
                    <td className="py-3 px-3 text-slate-600">{key.expires_at ? new Date(key.expires_at).toLocaleDateString() : '—'}</td>
                    <td className="py-3 px-3 text-slate-600">{key.last_used_at ? new Date(key.last_used_at).toLocaleDateString() : 'Never'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-1">
                        {key.is_active && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-[10px] h-6 border-slate-300 text-slate-700 hover:bg-slate-200"
                              onClick={() => rotateMutation.mutate(key.key_type)}
                              disabled={rotateMutation.isPending}
                              aria-label={`Rotate ${key.name}`}
                            >
                              <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" /> Rotate
                            </Button>
                            {revokeConfirmId === key.id ? (
                              <span className="flex items-center gap-1">
                                <Button
                                  size="sm"
                                  className="text-[10px] h-6 bg-red-600 hover:bg-red-700 text-white"
                                  onClick={() => { revokeMutation.mutate(key.id); setRevokeConfirmId(null); }}
                                  disabled={revokeMutation.isPending}
                                  aria-label="Confirm revoke"
                                >Confirm</Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-[10px] h-6 border-slate-300 text-slate-600"
                                  onClick={() => setRevokeConfirmId(null)}
                                  aria-label="Cancel revoke"
                                >Cancel</Button>
                              </span>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="text-[10px] h-6 border-red-200 text-red-600 hover:bg-red-50"
                                onClick={() => setRevokeConfirmId(key.id)}
                                aria-label={`Revoke ${key.name}`}
                              >
                                <Trash2 className="w-3 h-3 mr-1" aria-hidden="true" /> Revoke
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Security Note */}
      <Card className="bg-white/50 border-slate-200/30 mt-4">
        <CardContent className="p-4">
          <div className="flex items-start gap-3 text-xs text-slate-600">
            <Shield className="w-4 h-4 text-[#152448] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium text-slate-700 mb-1">Key Security Policy</p>
              <p>All raw keys are shown <strong>once only</strong> at generation time and stored as SHA-256 hashes. SDK API keys rotate every 90 days, signing keys every 180 days, publishable keys every 365 days. Webhook secrets rotate on-demand. Never commit keys to source control — use environment variables or a secrets manager.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
