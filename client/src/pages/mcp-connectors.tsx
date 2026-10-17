import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plug, Link2, Unlink, Activity } from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
import { Link } from 'wouter';

type Connector = {
  id: string;
  name: string;
  category: string;
  authType: string;
  status: string;
  implementationStatus?: 'live' | 'stub' | 'platform';
  mcpToolCount: number;
  description: string;
  connectPath: string;
  envKey?: string;
};

const STATUS_TONE: Record<string, string> = {
  connected: 'bg-emerald-600',
  configured: 'bg-blue-600',
  oauth_required: 'bg-amber-500',
  api_key_missing: 'bg-slate-500',
};

export default function McpConnectors() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => {
    const t = getAuthToken();
    setLoading(true);
    fetch(nv('mcp/connectors'), { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => r.json())
      .then(j => setConnectors(j.data?.connectors ?? []))
      .catch(() => setConnectors([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const connect = async (id: string) => {
    setBusy(id);
    const t = getAuthToken();
    await fetch(nv(`mcp/connectors/${id}/connect`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) },
      body: JSON.stringify({}),
    });
    setBusy(null);
    load();
  };

  const disconnect = async (id: string) => {
    setBusy(id);
    const t = getAuthToken();
    await fetch(nv(`mcp/connectors/${id}/disconnect`), {
      method: 'POST',
      headers: t ? { Authorization: `Bearer ${t}` } : {},
    });
    setBusy(null);
    load();
  };

  const byCategory = connectors.reduce<Record<string, Connector[]>>((m, c) => {
    (m[c.category] ??= []).push(c);
    return m;
  }, {});

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
            <Plug className="w-7 h-7 text-emerald-700" /> MCP Connectors
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Legaltech integrations for storage, collaboration, CRM, finance, and intelligence.
            Tools execute via <Link href="/tools-mcp" className="text-emerald-700 underline">MCP Tools</Link> or SDK <code className="text-xs">nyv.connectors</code> / <code className="text-xs">nyv.mcp</code>.
          </p>
          <p className="text-xs text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            <strong>Partner SKU honesty:</strong> ~25 connectors are <em>OAuth stubs</em> (DocuSign, iManage/DMS, Drive, Slack, …).
            They are <strong>not sold</strong> as live integrations — status <code>oauth_required</code> until the partner supplies credentials.
            Partner curated MCP lists ~109 live gateway tools (not the full ~556 catalog).
          </p>
        </div>
        <Badge variant="outline">{connectors.length} connectors</Badge>
      </div>

      {loading && <p className="text-sm text-slate-600">Loading connectors…</p>}

      {Object.entries(byCategory).map(([cat, list]) => (
        <Card key={cat}>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg capitalize">{cat.replace(/_/g, ' ')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {list.map(c => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 border rounded-lg p-3 bg-slate-50">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-slate-900">{c.name}</div>
                  <div className="text-xs text-slate-600 mt-0.5">{c.description}</div>
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Badge className={STATUS_TONE[c.status] ?? 'bg-slate-500'}>{c.status}</Badge>
                    {c.implementationStatus && (
                      <Badge variant={c.implementationStatus === 'stub' ? 'destructive' : 'outline'}>
                        {c.implementationStatus === 'stub' ? 'OAuth stub — not in partner SKU' : c.implementationStatus}
                      </Badge>
                    )}
                    {(c.status === 'oauth_required' || c.implementationStatus === 'stub') && (
                      <Badge variant="outline" className="border-amber-500 text-amber-800">Not sold / OAuth required</Badge>
                    )}
                    <Badge variant="outline">{c.authType}</Badge>
                    <Badge variant="secondary">{c.mcpToolCount} MCP tools</Badge>
                  </div>
                </div>
                <div className="flex gap-2">
                  {c.status === 'connected' ? (
                    <Button size="sm" variant="outline" disabled={busy === c.id} onClick={() => disconnect(c.id)}>
                      <Unlink className="w-4 h-4 mr-1" /> Disconnect
                    </Button>
                  ) : (
                    <Button size="sm" disabled={busy === c.id} onClick={() => connect(c.id)}>
                      <Link2 className="w-4 h-4 mr-1" /> Connect
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" asChild>
                    <a href={nv(`mcp/connectors/${c.id}/health`)} target="_blank" rel="noreferrer">
                      <Activity className="w-4 h-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
