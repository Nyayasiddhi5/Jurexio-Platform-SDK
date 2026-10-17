import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Wrench, Search, Plug, CheckCircle2, AlertTriangle, XCircle, Play } from 'lucide-react';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
import { Link } from 'wouter';

type Tool = {
  id: string;
  name: string;
  description: string;
  category: string;
  jurisdictions: string[];
  transport: 'stdio' | 'sse' | 'http';
  endpoint: string;
  executable?: boolean;
  requires_key: string | null;
  status: 'healthy' | 'degraded' | 'down' | 'catalog';
  status_reason: string | null;
  last_used_at: string | null;
  tags: string[];
};

type Category = { name: string; count: number };

type ProbeResult = {
  ok: boolean;
  status: 'healthy' | 'degraded' | 'down' | 'catalog';
  reason: string | null;
  latency_ms: number;
  probed_at: string;
  mode: 'live' | 'mock';
};

const TRANSPORTS = ['All', 'stdio', 'sse', 'http'] as const;
const JURISDICTIONS = ['All', 'IN', 'US', 'UK', 'EU', 'GC', 'SG'] as const;

export default function ToolsMcp() {
  const { toast } = useToast();
  const [tools, setTools] = useState<Tool[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('All');
  const [jurisdiction, setJurisdiction] = useState('All');
  const [transport, setTransport] = useState('All');
  const [probes, setProbes] = useState<Record<string, ProbeResult & { running?: boolean }>>({});
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [executableTotal, setExecutableTotal] = useState(0);
  const [executeTool, setExecuteTool] = useState<Tool | null>(null);
  const [executeInput, setExecuteInput] = useState('{\n  "query": "limitation period for breach of contract",\n  "jurisdiction": "IN"\n}');
  const [executeResult, setExecuteResult] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);

  useEffect(() => {
    const t = getAuthToken();
    fetch(nv('nyaya-tools/catalog?limit=600'), { headers: t ? { Authorization: `Bearer ${t}` } : {} })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(j => {
        setTools((j.tools ?? []) as Tool[]);
        setCategories((j.categories ?? []) as Category[]);
        setCatalogTotal(Number(j.catalogTotal ?? j.total ?? 0));
        setExecutableTotal(Number(j.executableTotal ?? 0));
      })
      .catch(e => setError(e?.message ?? 'failed'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => tools.filter(t => {
    if (category !== 'All' && t.category !== category) return false;
    if (jurisdiction !== 'All' && !t.jurisdictions.includes(jurisdiction)) return false;
    if (transport !== 'All' && t.transport !== transport) return false;
    if (q) {
      const ql = q.toLowerCase();
      if (!(t.name.toLowerCase().includes(ql) || t.description.toLowerCase().includes(ql) || t.id.includes(ql))) return false;
    }
    return true;
  }), [tools, category, jurisdiction, transport, q]);

  const statusCounts = useMemo(() => tools.reduce(
    (m, t) => { m[t.status] = (m[t.status] ?? 0) + 1; return m; },
    {} as Record<string, number>,
  ), [tools]);

  async function runExecute(tool: Tool) {
    setExecuting(true);
    setExecuteResult(null);
    const tok = getAuthToken();
    let parsed: unknown = {};
    try {
      parsed = JSON.parse(executeInput || '{}');
    } catch {
      toast({ title: 'Invalid JSON input', variant: 'destructive' });
      setExecuting(false);
      return;
    }
    try {
      const r = await fetch(nv(`v1/mcp/tools/${tool.id}/execute`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ input: parsed }),
      });
      const j = await r.json();
      setExecuteResult(JSON.stringify({ httpStatus: r.status, ...j }, null, 2));
      toast({
        title: r.status === 501 ? 'Catalog-only tool' : r.ok ? 'Execution complete' : 'Execution failed',
        description: r.status === 501
          ? `${tool.name} has no live handler yet (HTTP 501).`
          : `${tool.name} — ${r.status}`,
        variant: r.ok && r.status !== 501 ? 'default' : 'destructive',
      });
    } catch (e: any) {
      setExecuteResult(String(e?.message ?? 'execute failed'));
      toast({ title: 'Execution error', description: e?.message, variant: 'destructive' });
    } finally {
      setExecuting(false);
    }
  }

  async function testConnection(tool: Tool) {
    setProbes(p => ({ ...p, [tool.id]: { ...(p[tool.id] ?? { ok: false, status: 'healthy', reason: null, latency_ms: 0, probed_at: '', mode: 'live' }), running: true } }));
    const tok = getAuthToken();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    try {
      const r = await fetch(nv(`nyaya-tools/test/${tool.id}`), {
        method: 'POST',
        headers: tok ? { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
        signal: ctrl.signal,
      });
      const j = await r.json();
      const probe: ProbeResult = j.probe ?? { ok: r.ok, status: 'down', reason: 'no probe payload', latency_ms: 0, probed_at: new Date().toISOString(), mode: 'live' };
      setProbes(p => ({ ...p, [tool.id]: { ...probe, running: false } }));
      toast({
        title: probe.ok ? `Connection OK (${probe.latency_ms}ms)` : 'Connection failed',
        description: `${tool.name} — ${probe.status}${probe.reason ? `: ${probe.reason}` : ''}`,
        variant: probe.ok ? 'default' : 'destructive',
      });
    } catch (e: any) {
      const reason = e?.name === 'AbortError' ? 'timeout after 3s' : (e?.message ?? 'unknown error');
      setProbes(p => ({ ...p, [tool.id]: { ok: false, status: 'down', reason, latency_ms: 3000, probed_at: new Date().toISOString(), mode: 'live', running: false } }));
      toast({ title: 'Connection failed', description: reason, variant: 'destructive' });
    } finally {
      clearTimeout(timer);
    }
  }

  return (
    <div className="p-6 space-y-6 bg-[#F9FAFB] min-h-screen" data-testid="page-tools-mcp">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Wrench className="w-6 h-6" /> Tools & MCP
        </h1>
        <p className="text-sm text-slate-600 mt-1">
          {catalogTotal || tools.length} MCP tools · {executableTotal} executable —
          <Link href="/mcp-connectors" className="text-emerald-700 underline ml-1">Connectors</Link>
          {' · '}
          browse, probe connectivity, and invoke via the canonical executor.
          Catalog-only tools return HTTP 501 (honest not-implemented). {/* nv-allow-placeholder: UI copy explaining the 501 signal. */}
        </p>
        <p className="text-xs text-amber-800 mt-2 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 max-w-3xl">
          Partner curated sell surface is ~109 live tools. OAuth stubs (DocuSign / iManage / Drive / Slack / …)
          are <strong>not in the partner SKU</strong> — see Connectors page for <code>oauth_required</code> labels.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <StatusCard label="Executable" value={executableTotal} tone="emerald" Icon={Play} />
        <StatusCard label="Catalog-only" value={Math.max(0, (catalogTotal || tools.length) - executableTotal)} tone="slate" Icon={Wrench} />
        <StatusCard label="Healthy" value={statusCounts.healthy ?? 0} tone="emerald" Icon={CheckCircle2} />
        <StatusCard label="Degraded" value={statusCounts.degraded ?? 0} tone="amber" Icon={AlertTriangle} />
        <StatusCard label="Down" value={statusCounts.down ?? 0} tone="red" Icon={XCircle} />
        <StatusCard label="Total tools" value={tools.length} tone="slate" Icon={Wrench} />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-base">Catalog — {filtered.length} of {tools.length}</CardTitle>
            <div className="relative w-72">
              <Search className="absolute left-2 top-2.5 w-4 h-4 text-slate-600" />
              <Input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search by name, id, or description…"
                className="pl-8"
                data-testid="input-tool-search"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <FilterSelect label="Category" value={category} onChange={setCategory} options={['All', ...categories.map(c => c.name)]} testId="filter-tool-category" />
            <FilterSelect label="Jurisdiction" value={jurisdiction} onChange={setJurisdiction} options={[...JURISDICTIONS]} testId="filter-tool-jurisdiction" />
            <FilterSelect label="Transport" value={transport} onChange={setTransport} options={[...TRANSPORTS]} testId="filter-tool-transport" />
          </div>
        </CardHeader>
        <CardContent>
          {loading && <p className="text-sm text-slate-700">Loading MCP catalog…</p>}
          {error && <p className="text-sm text-red-600">Failed to load: {error}</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className="text-sm text-slate-700" data-testid="empty-tools">No tools match the current filters.</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-700 border-b border-slate-200">
                  <th className="py-2 pr-4">Tool</th>
                  <th className="py-2 pr-4">Transport</th>
                  <th className="py-2 pr-4">Endpoint</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Last used</th>
                  <th className="py-2 pr-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 200).map(t => {
                  const probe = probes[t.id];
                  const eff = probe ?? { status: t.status, reason: t.status_reason, latency_ms: 0, ok: t.status !== 'down', mode: 'live' as const };
                  return (
                    <tr key={t.id} className="border-b border-slate-100 align-top" data-testid={`tool-${t.id}`}>
                      <td className="py-3 pr-4 max-w-md">
                        <div className="font-medium text-slate-900">{t.name}</div>
                        <div className="text-xs text-slate-700 mt-0.5">{t.description}</div>
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          <Badge variant="outline" className="text-[10px]">{t.category}</Badge>
                          {t.jurisdictions.slice(0, 6).map(j => (
                            <Badge key={j} variant="secondary" className="text-[10px]">{j}</Badge>
                          ))}
                          {t.requires_key && (
                            <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">key: {t.requires_key}</Badge>
                          )}
                        </div>
                      </td>
                      <td className="py-3 pr-4"><Badge variant="outline">{t.transport}</Badge></td>
                      <td className="py-3 pr-4"><code className="text-xs text-slate-600 font-mono break-all">{t.endpoint}</code></td>
                      <td className="py-3 pr-4">
                        <StatusBadge status={eff.status} />
                        {eff.reason && <div className="text-xs text-slate-700 mt-1 max-w-xs">{eff.reason}</div>}
                        {probe && !probe.running && <div className="text-xs text-slate-600 mt-1">{probe.latency_ms}ms · {probe.mode}</div>}
                      </td>
                      <td className="py-3 pr-4 text-xs text-slate-700">{relativeTime(t.last_used_at)}</td>
                      <td className="py-3 pr-4 text-right space-x-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={probe?.running}
                          onClick={() => testConnection(t)}
                          data-testid={`test-${t.id}`}
                        >
                          <Plug className="w-3 h-3 mr-1" />
                          {probe?.running ? 'Probing…' : 'Probe'}
                        </Button>
                        <Button
                          size="sm"
                          variant={t.executable ? 'default' : 'secondary'}
                          onClick={() => { setExecuteTool(t); setExecuteResult(null); }}
                          data-testid={`execute-${t.id}`}
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Execute
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length > 200 && (
              <p className="text-xs text-slate-700 mt-3">Showing first 200 of {filtered.length}. Narrow filters to see more.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {executeTool && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Execute — {executeTool.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-slate-600">
              POST {nv(`v1/mcp/tools/${executeTool.id}/execute`)} ·
              {executeTool.executable ? ' live handler' : ' catalog-only (expect HTTP 501)'}
            </p>
            <textarea
              className="w-full min-h-[120px] font-mono text-xs border rounded-md p-2"
              value={executeInput}
              onChange={e => setExecuteInput(e.target.value)}
              data-testid="mcp-execute-input"
            />
            <div className="flex gap-2">
              <Button disabled={executing} onClick={() => runExecute(executeTool)} data-testid="mcp-execute-run">
                {executing ? 'Running…' : 'Run execute'}
              </Button>
              <Button variant="outline" onClick={() => setExecuteTool(null)}>Close</Button>
            </div>
            {executeResult && (
              <pre className="text-xs bg-slate-900 text-slate-100 p-3 rounded-md overflow-auto max-h-64">{executeResult}</pre>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: 'healthy' | 'degraded' | 'down' | 'catalog' }) {
  if (status === 'healthy') return <Badge className="bg-emerald-600 hover:bg-emerald-600">healthy</Badge>;
  if (status === 'degraded') return <Badge className="bg-amber-500 hover:bg-amber-500">degraded</Badge>;
  if (status === 'catalog') return <Badge variant="secondary">catalog-only</Badge>;
  return <Badge variant="destructive">down</Badge>;
}

function StatusCard({ label, value, tone, Icon }: {
  label: string; value: number; tone: 'emerald' | 'amber' | 'red' | 'slate';
  Icon: React.ComponentType<{ className?: string }>;
}) {
  const toneMap: Record<string, string> = {
    emerald: 'text-emerald-600 bg-emerald-50',
    amber: 'text-amber-600 bg-amber-50',
    red: 'text-red-600 bg-red-50',
    slate: 'text-slate-600 bg-slate-100',
  };
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`p-2 rounded ${toneMap[tone]}`}><Icon className="w-5 h-5" /></div>
        <div>
          <p className="text-2xl font-bold text-slate-900">{value}</p>
          <p className="text-xs text-slate-700">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterSelect({ label, value, onChange, options, testId }: {
  label: string; value: string; onChange: (v: string) => void; options: string[]; testId: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-700">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 w-44" data-testid={testId}><SelectValue /></SelectTrigger>
        <SelectContent className="max-h-72">
          {options.map(o => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '—';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
