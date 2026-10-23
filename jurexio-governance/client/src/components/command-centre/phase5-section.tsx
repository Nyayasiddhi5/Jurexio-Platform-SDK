import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  Workflow, ShoppingBag, DollarSign, Network, Cpu, LineChart, Brain,
  Search, Database, Shield, Zap, Plus, Play, CheckCircle, AlertTriangle,
  XCircle, TrendingUp, BarChart3, Star, Download
} from 'lucide-react';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
const COLORS = {
  royalBlue: '#152448', deepNavy: '#152448', midBlue: '#2B384C',
  gold: '#C7B15B', lightGold: '#E4B027', emerald: '#1C7A4F', darkBlue: '#0E1830',
};

function authFetch(url: string, token: string, opts: RequestInit = {}) {
  return fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) } });
}

const TABS = [
  { id: 'workflows', label: 'Workflows', icon: Workflow },
  { id: 'marketplace', label: 'Marketplace', icon: ShoppingBag },
  { id: 'billing', label: 'Billing', icon: DollarSign },
  { id: 'graph', label: 'Knowledge Graph', icon: Network },
  { id: 'analytics', label: 'Predictive AI', icon: LineChart },
  { id: 'learning', label: 'Agent Learning', icon: Brain },
  { id: 'redteam', label: 'Red Team', icon: Shield },
];

export function Phase5Section({ token }: { token: string }) {
  const [activeTab, setActiveTab] = useState('workflows');

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <Zap className="w-5 h-5" style={{ color: COLORS.royalBlue }} />
        <div>
          <h2 className="text-lg font-bold" style={{ color: COLORS.royalBlue }}>Phase 5 — Next-Gen AI</h2>
          <p className="text-xs text-gray-500">Autonomous Workflows · Agent Marketplace · Knowledge Graph · Predictive AI · Red Team</p>
        </div>
        <Badge className="ml-auto text-xs" style={{ background: COLORS.royalBlue, color: '#fff' }}>v5.0 LIVE</Badge>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap border-b pb-2" style={{ borderColor: COLORS.royalBlue + '20' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t text-xs font-medium transition-colors ${activeTab === tab.id ? 'text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            style={activeTab === tab.id ? { background: COLORS.royalBlue } : {}}
          >
            <tab.icon className="w-3.5 h-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {activeTab === 'workflows' && <WorkflowsTab token={token} />}
        {activeTab === 'marketplace' && <MarketplaceTab token={token} />}
        {activeTab === 'billing' && <BillingTab token={token} />}
        {activeTab === 'graph' && <KnowledgeGraphTab token={token} />}
        {activeTab === 'analytics' && <PredictiveAITab token={token} />}
        {activeTab === 'learning' && <AgentLearningTab token={token} />}
        {activeTab === 'redteam' && <RedTeamTab token={token} />}
      </div>
    </div>
  );
}

// ── Workflows ────────────────────────────────────────────────────────────────
function WorkflowsTab({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [steps, setSteps] = useState(['legal-analyst']);
  const [running, setRunning] = useState<number | null>(null);
  const [runInput, setRunInput] = useState('');

  const { data: wfData } = useQuery({ queryKey: ['p5-workflows', token], queryFn: () => authFetch(nv('workflows'), token).then(r => r.json()), enabled: !!token });
  const { data: tplData } = useQuery({ queryKey: ['p5-wf-templates', token], queryFn: () => authFetch(nv('workflows/templates'), token).then(r => r.json()), enabled: !!token });

  const createMut = useMutation({
    mutationFn: () => authFetch(nv('workflows'), token, { method: 'POST', body: JSON.stringify({ name, steps: steps.map(s => ({ agentKey: s })) }) }).then(r => r.json()),
    onSuccess: (d) => { if (d.success) { toast({ title: 'Workflow created' }); qc.invalidateQueries({ queryKey: ['p5-workflows'] }); setShowForm(false); setName(''); setSteps(['legal-analyst']); } else toast({ title: 'Error', description: d.error, variant: 'destructive' }); },
  });

  const runMut = useMutation({
    mutationFn: (id: number) => authFetch(`${NV_BASE}workflows/${id}/execute`, token, { method: 'POST', body: JSON.stringify({ input: runInput }) }).then(r => r.json()),
    onSuccess: (d) => { if (d.success) { toast({ title: 'Workflow executed', description: `${d.data?.stepsCompleted || 0} steps completed` }); setRunning(null); } else toast({ title: 'Execution error', description: d.error, variant: 'destructive' }); },
  });

  const workflows = Array.isArray(wfData?.data) ? wfData.data : [];
  const templates = Array.isArray(tplData?.data) ? tplData.data : [];

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button size="sm" onClick={() => setShowForm(!showForm)} style={{ background: COLORS.royalBlue, color: '#fff' }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Define Workflow
        </Button>
      </div>

      {showForm && (
        <Card className="border" style={{ borderColor: COLORS.royalBlue + '30' }}>
          <CardContent className="pt-4 space-y-3">
            <Input placeholder="Workflow name" value={name} onChange={e => setName(e.target.value)} />
            <div className="space-y-1">
              {steps.map((s, i) => (
                <div key={i} className="flex gap-2">
                  <Input value={s} onChange={e => { const ns = [...steps]; ns[i] = e.target.value; setSteps(ns); }} placeholder={`Step ${i + 1} agent key`} className="text-sm" />
                  {steps.length > 1 && <Button size="sm" variant="ghost" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>×</Button>}
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setSteps([...steps, ''])}>+ Add Step</Button>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => createMut.mutate()} disabled={createMut.isPending || !name} style={{ background: COLORS.royalBlue, color: '#fff' }}>Create</Button>
              <Button size="sm" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">My Workflows ({workflows.length})</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            {workflows.length === 0 && <p className="text-xs text-gray-400">No workflows defined yet</p>}
            {workflows.map((wf: any) => (
              <div key={wf.id} className="flex items-center justify-between p-2 rounded border text-xs" style={{ borderColor: COLORS.royalBlue + '20' }}>
                <div>
                  <p className="font-medium">{wf.name}</p>
                  <p className="text-gray-500">{wf.step_count || 0} steps · {wf.trigger_type || 'manual'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]" style={{ color: COLORS.emerald, borderColor: COLORS.emerald + '50' }}>{wf.status || 'active'}</Badge>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={() => { setRunning(wf.id); }}>
                    <Play className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
            {running && (
              <div className="space-y-2 p-2 rounded border" style={{ borderColor: COLORS.gold + '50' }}>
                <p className="text-xs font-medium">Execute Workflow #{running}</p>
                <Input placeholder="Initial input..." value={runInput} onChange={e => setRunInput(e.target.value)} className="text-xs" />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => runMut.mutate(running)} disabled={runMut.isPending || !runInput} style={{ background: COLORS.royalBlue, color: '#fff' }}>
                    {runMut.isPending ? 'Running...' : 'Execute'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setRunning(null)}>Cancel</Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Templates ({templates.length})</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {templates.map((t: any) => (
                <div key={t.id} className="flex items-center justify-between p-2 rounded border text-xs" style={{ borderColor: COLORS.royalBlue + '15' }}>
                  <div>
                    <p className="font-medium">{t.name}</p>
                    <p className="text-gray-500 text-[10px]">{t.description}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px]">{t.steps?.length || 0} steps</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Marketplace ──────────────────────────────────────────────────────────────
function MarketplaceTab({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [showPublish, setShowPublish] = useState(false);
  const [pubForm, setPubForm] = useState({ name: '', description: '', category: 'general', priceUsd: 0 });

  const { data: agentsData, isLoading } = useQuery({
    queryKey: ['p5-marketplace', token, search, category],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (category !== 'all') params.set('category', category);
      return authFetch(`${NV_BASE}marketplace/agents?${params}`, token).then(r => r.json());
    },
    enabled: !!token,
  });
  const { data: statsData } = useQuery({ queryKey: ['p5-marketplace-stats', token], queryFn: () => authFetch(nv('marketplace/stats'), token).then(r => r.json()), enabled: !!token });

  const installMut = useMutation({
    mutationFn: (id: number) => authFetch(`${NV_BASE}marketplace/agents/${id}/install`, token, { method: 'POST', body: JSON.stringify({}) }).then(r => r.json()),
    onSuccess: (d) => { if (d.success) { toast({ title: 'Agent installed' }); qc.invalidateQueries({ queryKey: ['p5-marketplace'] }); } else toast({ title: 'Error', description: d.error, variant: 'destructive' }); },
  });

  const publishMut = useMutation({
    mutationFn: () => authFetch(nv('marketplace/agents'), token, { method: 'POST', body: JSON.stringify({ ...pubForm, agentConfig: { agentKey: pubForm.name.toLowerCase().replace(/\s/g, '-') } }) }).then(r => r.json()),
    onSuccess: (d) => { if (d.success) { toast({ title: 'Agent published' }); setShowPublish(false); qc.invalidateQueries({ queryKey: ['p5-marketplace'] }); } else toast({ title: 'Error', description: d.error, variant: 'destructive' }); },
  });

  const agents = agentsData?.data?.agents || [];
  const stats = statsData?.data || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2">
        {[
          { label: 'Listed Agents', value: stats.totalListings || 0 },
          { label: 'Categories', value: stats.categoryCount || 0 },
          { label: 'Total Installs', value: stats.totalInstalls || 0 },
          { label: 'Avg Rating', value: stats.avgRating ? `${stats.avgRating}★` : 'N/A' },
        ].map(s => (
          <Card key={s.label} className="text-center">
            <CardContent className="pt-3 pb-2">
              <p className="text-lg font-bold" style={{ color: COLORS.royalBlue }}>{s.value}</p>
              <p className="text-[10px] text-gray-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents..." className="pl-8 text-sm" />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-32 text-sm"><SelectValue /></SelectTrigger>
          <SelectContent>
            {['all', 'general', 'contract', 'litigation', 'compliance', 'research', 'advisory'].map(c => (
              <SelectItem key={c} value={c} className="text-sm capitalize">{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" onClick={() => setShowPublish(!showPublish)} style={{ background: COLORS.royalBlue, color: '#fff' }}>
          <Plus className="w-3.5 h-3.5 mr-1" /> Publish
        </Button>
      </div>

      {showPublish && (
        <Card className="border" style={{ borderColor: COLORS.royalBlue + '30' }}>
          <CardContent className="pt-4 space-y-2">
            <Input placeholder="Agent name" value={pubForm.name} onChange={e => setPubForm(f => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Description" value={pubForm.description} onChange={e => setPubForm(f => ({ ...f, description: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <Select value={pubForm.category} onValueChange={v => setPubForm(f => ({ ...f, category: v }))}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{['general', 'contract', 'litigation', 'compliance', 'research', 'advisory', 'drafting'].map(c => <SelectItem key={c} value={c} className="text-sm capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
              <Input type="number" placeholder="Price (USD)" value={pubForm.priceUsd} onChange={e => setPubForm(f => ({ ...f, priceUsd: Number(e.target.value) }))} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => publishMut.mutate()} disabled={publishMut.isPending || !pubForm.name} style={{ background: COLORS.royalBlue, color: '#fff' }}>Publish</Button>
              <Button size="sm" variant="outline" onClick={() => setShowPublish(false)}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? <p className="text-sm text-gray-400">Loading agents...</p> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {agents.length === 0 && <p className="text-sm text-gray-400 col-span-3">No agents listed yet. Be the first to publish!</p>}
          {agents.map((a: any) => (
            <Card key={a.id} className="border hover:shadow-sm transition-shadow">
              <CardContent className="pt-3 pb-3">
                <div className="flex justify-between mb-1">
                  <p className="font-medium text-sm">{a.name}</p>
                  <Badge variant="outline" className="text-[10px] capitalize">{a.category}</Badge>
                </div>
                <p className="text-xs text-gray-500 mb-2 line-clamp-2">{a.description || 'No description'}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1">
                    <Star className="w-3 h-3 text-yellow-500" />
                    <span className="text-xs">{Number(a.rating_avg || 0).toFixed(1)}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <Download className="w-3 h-3 text-gray-400" />
                    <span className="text-xs text-gray-400">{a.install_count || 0}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-medium" style={{ color: COLORS.royalBlue }}>{a.price_usd === 0 ? 'Free' : `$${a.price_usd}`}</span>
                    <Button size="sm" className="h-6 px-2 text-[10px]" onClick={() => installMut.mutate(a.id)} disabled={installMut.isPending} style={{ background: COLORS.royalBlue, color: '#fff' }}>Install</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Billing ──────────────────────────────────────────────────────────────────
function BillingTab({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [genPeriod, setGenPeriod] = useState({ start: '', end: '' });

  const { data: usageData } = useQuery({ queryKey: ['p5-usage', token], queryFn: () => authFetch(nv('billing/usage'), token).then(r => r.json()), enabled: !!token });
  const { data: invoicesData } = useQuery({ queryKey: ['p5-invoices', token], queryFn: () => authFetch(nv('billing/invoices'), token).then(r => r.json()), enabled: !!token });
  const { data: pricingData } = useQuery({ queryKey: ['p5-pricing', token], queryFn: () => authFetch(nv('billing/pricing'), token).then(r => r.json()), enabled: !!token });

  const genInvoiceMut = useMutation({
    mutationFn: () => authFetch(nv('billing/invoices/generate'), token, { method: 'POST', body: JSON.stringify({ orgId: 'default', periodStart: genPeriod.start, periodEnd: genPeriod.end }) }).then(r => r.json()),
    onSuccess: (d) => { if (d.success) { toast({ title: `Invoice generated — Total: $${d.data?.total || 0}` }); qc.invalidateQueries({ queryKey: ['p5-invoices'] }); } else toast({ title: 'Error', description: d.error, variant: 'destructive' }); },
  });

  const usage = usageData?.data || {};
  const invoices = Array.isArray(invoicesData?.data) ? invoicesData.data : [];
  const pricing = pricingData?.data?.matrix || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Cost (30d)', value: `$${Number(usage.totalCost || 0).toFixed(4)}`, icon: DollarSign },
          { label: 'Activity Types', value: (usage.breakdown || []).length, icon: BarChart3 },
          { label: 'Invoices', value: invoices.length, icon: CheckCircle },
          { label: 'Currency', value: 'USD + GST', icon: TrendingUp },
        ].map(s => (
          <Card key={s.label}>
            <CardContent className="pt-3 pb-2 flex items-center gap-2">
              <s.icon className="w-4 h-4" style={{ color: COLORS.royalBlue }} />
              <div>
                <p className="text-sm font-bold" style={{ color: COLORS.royalBlue }}>{s.value}</p>
                <p className="text-[10px] text-gray-500">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Generate Invoice</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-gray-500">Period Start</label>
                <Input type="date" value={genPeriod.start} onChange={e => setGenPeriod(p => ({ ...p, start: e.target.value }))} className="text-sm" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Period End</label>
                <Input type="date" value={genPeriod.end} onChange={e => setGenPeriod(p => ({ ...p, end: e.target.value }))} className="text-sm" />
              </div>
            </div>
            <Button size="sm" onClick={() => genInvoiceMut.mutate()} disabled={genInvoiceMut.isPending || !genPeriod.start || !genPeriod.end} style={{ background: COLORS.royalBlue, color: '#fff' }}>
              {genInvoiceMut.isPending ? 'Generating...' : 'Generate Invoice'}
            </Button>
            {invoices.slice(0, 5).map((inv: any) => (
              <div key={inv.id} className="flex items-center justify-between text-xs p-2 border rounded" style={{ borderColor: COLORS.royalBlue + '20' }}>
                <span>#{inv.id} · {new Date(inv.generated_at).toLocaleDateString()}</span>
                <span className="font-bold" style={{ color: COLORS.royalBlue }}>${Number(inv.total || 0).toFixed(2)}</span>
                <Badge variant="outline" className="text-[10px]">{inv.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Pricing Tiers</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1">
              {Object.entries(pricing).map(([feature, tiers]: any) => (
                <div key={feature} className="text-xs grid grid-cols-4 gap-1 py-1 border-b" style={{ borderColor: '#f0f0f0' }}>
                  <span className="font-medium capitalize col-span-2">{feature.replace(/_/g, ' ')}</span>
                  {['pro', 'enterprise'].map(tier => (
                    <span key={tier} className="text-gray-500">{tier}: ${tiers[tier] || '-'}</span>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── Knowledge Graph ──────────────────────────────────────────────────────────
function KnowledgeGraphTab({ token }: { token: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [queryResult, setQueryResult] = useState<any>(null);
  const [entityForm, setEntityForm] = useState({ entityType: 'statute', name: '', description: '' });
  const [searching, setSearching] = useState(false);

  const { data: statsData } = useQuery({ queryKey: ['p5-graph-stats', token], queryFn: () => authFetch(nv('graph/stats'), token).then(r => r.json()), enabled: !!token });

  const addEntityMut = useMutation({
    mutationFn: () => authFetch(nv('graph/entities'), token, { method: 'POST', body: JSON.stringify(entityForm) }).then(r => r.json()),
    onSuccess: (d) => { if (d.success) { toast({ title: 'Entity added to Knowledge Graph' }); qc.invalidateQueries({ queryKey: ['p5-graph-stats'] }); setEntityForm(f => ({ ...f, name: '', description: '' })); } else toast({ title: 'Error', description: d.error, variant: 'destructive' }); },
  });

  const handleSearch = async () => {
    if (!query) return;
    setSearching(true);
    try {
      const r = await authFetch(nv('graph/query'), token, { method: 'POST', body: JSON.stringify({ query, topK: 8 }) });
      const d = await r.json();
      setQueryResult(d.data);
    } catch { toast({ title: 'Search failed', variant: 'destructive' }); }
    setSearching(false);
  };

  const stats = statsData?.data || {};

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Entities', value: stats.entityCount || 0 },
          { label: 'Relationships', value: stats.edgeCount || 0 },
          { label: 'Entity Types', value: (stats.byType || []).length },
        ].map(s => (
          <Card key={s.label} className="text-center">
            <CardContent className="pt-3 pb-2">
              <p className="text-xl font-bold" style={{ color: COLORS.royalBlue }}>{s.value}</p>
              <p className="text-[10px] text-gray-500">{s.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Add Entity</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            <Select value={entityForm.entityType} onValueChange={v => setEntityForm(f => ({ ...f, entityType: v }))}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>{['statute', 'case', 'concept', 'party', 'jurisdiction', 'court', 'act', 'section'].map(t => <SelectItem key={t} value={t} className="text-sm capitalize">{t}</SelectItem>)}</SelectContent>
            </Select>
            <Input placeholder="Entity name" value={entityForm.name} onChange={e => setEntityForm(f => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Description" value={entityForm.description} onChange={e => setEntityForm(f => ({ ...f, description: e.target.value }))} />
            <Button size="sm" onClick={() => addEntityMut.mutate()} disabled={addEntityMut.isPending || !entityForm.name} style={{ background: COLORS.royalBlue, color: '#fff' }}>Add Entity</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Semantic Graph Search</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3 space-y-2">
            <div className="flex gap-2">
              <Input placeholder="e.g. murder punishment India" value={query} onChange={e => setQuery(e.target.value)} className="text-sm" />
              <Button size="sm" onClick={handleSearch} disabled={searching} style={{ background: COLORS.royalBlue, color: '#fff' }}>
                {searching ? '...' : <Search className="w-3.5 h-3.5" />}
              </Button>
            </div>
            {queryResult && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {(queryResult.entities || []).map((e: any) => (
                  <div key={e.id} className="flex items-center gap-2 text-xs p-1.5 rounded" style={{ background: COLORS.royalBlue + '08' }}>
                    <Badge variant="outline" className="text-[9px] capitalize">{e.entity_type}</Badge>
                    <span className="font-medium flex-1 truncate">{e.name}</span>
                    <span className="text-gray-400">{(Number(e.similarity || 0) * 100).toFixed(0)}%</span>
                  </div>
                ))}
                {(queryResult.entities || []).length === 0 && <p className="text-xs text-gray-400">No entities found</p>}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {stats.byType && stats.byType.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Entities by Type</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="flex flex-wrap gap-2">
              {stats.byType.map((t: any) => (
                <Badge key={t.entity_type} variant="outline" className="text-xs capitalize">
                  {t.entity_type}: {t.count}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Predictive AI ────────────────────────────────────────────────────────────
function PredictiveAITab({ token }: { token: string }) {
  const { toast } = useToast();
  const [outcomeForm, setOutcomeForm] = useState({ jurisdiction: 'district_court', evidenceCount: 5, citationCount: 8, precedentStrength: 6, witnessCount: 2 });
  const [costForm, setCostForm] = useState({ caseType: 'civil', court: 'district_court', complexity: 'medium', estimatedDurationMonths: 12 });
  const [outcomeResult, setOutcomeResult] = useState<any>(null);
  const [costResult, setCostResult] = useState<any>(null);
  const [loading, setLoading] = useState({ outcome: false, cost: false });

  const predict = async () => {
    setLoading(l => ({ ...l, outcome: true }));
    try {
      const r = await authFetch(nv('analytics/predict/case-outcome'), token, { method: 'POST', body: JSON.stringify(outcomeForm) });
      const d = await r.json();
      if (d.success) setOutcomeResult(d.data); else toast({ title: 'Prediction failed', description: d.error, variant: 'destructive' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    setLoading(l => ({ ...l, outcome: false }));
  };

  const estimateCost = async () => {
    setLoading(l => ({ ...l, cost: true }));
    try {
      const r = await authFetch(nv('analytics/estimate/litigation-cost'), token, { method: 'POST', body: JSON.stringify(costForm) });
      const d = await r.json();
      if (d.success) setCostResult(d.data); else toast({ title: 'Estimation failed', description: d.error, variant: 'destructive' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    setLoading(l => ({ ...l, cost: false }));
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Case Outcome Predictor</CardTitle></CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          <Select value={outcomeForm.jurisdiction} onValueChange={v => setOutcomeForm(f => ({ ...f, jurisdiction: v }))}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{['district_court', 'high_court', 'supreme_court', 'tribunal'].map(c => <SelectItem key={c} value={c} className="text-sm">{c.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
          {[
            { key: 'evidenceCount', label: 'Evidence Count', min: 1, max: 10 },
            { key: 'citationCount', label: 'Citations', min: 0, max: 20 },
            { key: 'precedentStrength', label: 'Precedent Strength (0-10)', min: 0, max: 10 },
            { key: 'witnessCount', label: 'Witnesses', min: 0, max: 10 },
          ].map(f => (
            <div key={f.key} className="flex items-center gap-2">
              <label className="text-xs w-36 shrink-0">{f.label}</label>
              <Input type="number" min={f.min} max={f.max} value={(outcomeForm as any)[f.key]} onChange={e => setOutcomeForm(prev => ({ ...prev, [f.key]: Number(e.target.value) }))} className="text-sm" />
            </div>
          ))}
          <Button size="sm" onClick={predict} disabled={loading.outcome} style={{ background: COLORS.royalBlue, color: '#fff' }}>
            {loading.outcome ? 'Predicting...' : 'Predict Outcome'}
          </Button>
          {outcomeResult && (
            <div className="p-2 rounded text-xs space-y-1" style={{ background: COLORS.royalBlue + '08' }}>
              <div className="flex justify-between items-center">
                <span>Win Probability</span>
                <span className="font-bold text-base" style={{ color: outcomeResult.probability >= 0.6 ? COLORS.emerald : '#EF4444' }}>
                  {(outcomeResult.probability * 100).toFixed(1)}%
                </span>
              </div>
              <p className="text-gray-600 italic">{outcomeResult.recommendation}</p>
              <Badge variant="outline" className="text-[10px]">{outcomeResult.riskLevel}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Litigation Cost Estimator</CardTitle></CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {[
            { key: 'caseType', label: 'Case Type', options: ['civil', 'criminal', 'family', 'constitutional'] },
            { key: 'court', label: 'Court', options: ['district_court', 'high_court', 'supreme_court', 'tribunal'] },
            { key: 'complexity', label: 'Complexity', options: ['low', 'medium', 'high'] },
          ].map(f => (
            <Select key={f.key} value={(costForm as any)[f.key]} onValueChange={v => setCostForm(prev => ({ ...prev, [f.key]: v }))}>
              <SelectTrigger className="text-sm"><SelectValue placeholder={f.label} /></SelectTrigger>
              <SelectContent>{f.options.map(o => <SelectItem key={o} value={o} className="text-sm capitalize">{o.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
            </Select>
          ))}
          <div className="flex items-center gap-2">
            <label className="text-xs w-36">Duration (months)</label>
            <Input type="number" min={1} max={120} value={costForm.estimatedDurationMonths} onChange={e => setCostForm(f => ({ ...f, estimatedDurationMonths: Number(e.target.value) }))} className="text-sm" />
          </div>
          <Button size="sm" onClick={estimateCost} disabled={loading.cost} style={{ background: COLORS.royalBlue, color: '#fff' }}>
            {loading.cost ? 'Estimating...' : 'Estimate Cost'}
          </Button>
          {costResult && (
            <div className="p-2 rounded text-xs space-y-1" style={{ background: COLORS.royalBlue + '08' }}>
              <div className="flex justify-between">
                <span>Estimated Range (INR)</span>
                <span className="font-bold" style={{ color: COLORS.royalBlue }}>
                  ₹{costResult.estimatedMin?.toLocaleString('en-IN')} – ₹{costResult.estimatedMax?.toLocaleString('en-IN')}
                </span>
              </div>
              <p>Monthly Burn: ₹{costResult.monthlyBurn?.toLocaleString('en-IN')}</p>
              {(costResult.breakdown || []).map((b: any) => (
                <div key={b.item} className="flex justify-between text-gray-500">
                  <span>{b.item}</span>
                  <span>₹{Number(b.min).toLocaleString('en-IN')} – ₹{Number(b.max).toLocaleString('en-IN')}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Agent Learning ───────────────────────────────────────────────────────────
function AgentLearningTab({ token }: { token: string }) {
  const { toast } = useToast();
  const [selectedAgent, setSelectedAgent] = useState('');
  const [analysis, setAnalysis] = useState<any>(null);
  const [suggestions, setSuggestions] = useState<any>(null);
  const [loading, setLoading] = useState({ analyze: false, suggest: false, apply: false });

  const { data: topData } = useQuery({ queryKey: ['p5-top-agents', token], queryFn: () => authFetch(nv('learning/top-agents'), token).then(r => r.json()), enabled: !!token });
  const topAgents = Array.isArray(topData?.data) ? topData.data : [];

  const analyze = async () => {
    if (!selectedAgent) return;
    setLoading(l => ({ ...l, analyze: true }));
    try {
      const r = await authFetch(`${NV_BASE}learning/analyze/${selectedAgent}`, token, { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json();
      if (d.success) setAnalysis(d.data); else toast({ title: 'Analysis failed', description: d.error, variant: 'destructive' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    setLoading(l => ({ ...l, analyze: false }));
  };

  const suggest = async () => {
    if (!selectedAgent) return;
    setLoading(l => ({ ...l, suggest: true }));
    try {
      const r = await authFetch(`${NV_BASE}learning/suggest/${selectedAgent}`, token, { method: 'POST', body: JSON.stringify({}) });
      const d = await r.json();
      if (d.success) setSuggestions(d.data); else toast({ title: 'Suggestion failed', description: d.error, variant: 'destructive' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    setLoading(l => ({ ...l, suggest: false }));
  };

  const applyLearning = async () => {
    if (!selectedAgent || !suggestions?.suggestions) return;
    setLoading(l => ({ ...l, apply: true }));
    try {
      const r = await authFetch(`${NV_BASE}learning/apply/${selectedAgent}`, token, { method: 'POST', body: JSON.stringify({ suggestions: suggestions.suggestions }) });
      const d = await r.json();
      if (d.success) { toast({ title: 'Learning applied', description: `${d.data?.appliedSuggestions || 0} suggestions applied` }); } else toast({ title: 'Error', description: d.error, variant: 'destructive' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    setLoading(l => ({ ...l, apply: false }));
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Top Performing Agents</CardTitle></CardHeader>
        <CardContent className="px-3 pb-3">
          <div className="flex flex-wrap gap-2">
            {topAgents.length === 0 && <p className="text-xs text-gray-400">No feedback data yet</p>}
            {topAgents.slice(0, 10).map((a: any) => (
              <button
                key={a.agentKey}
                onClick={() => setSelectedAgent(a.agentKey)}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs border transition-colors ${selectedAgent === a.agentKey ? 'text-white' : 'hover:bg-gray-50'}`}
                style={selectedAgent === a.agentKey ? { background: COLORS.royalBlue, borderColor: COLORS.royalBlue } : { borderColor: COLORS.royalBlue + '30' }}
              >
                <span>{a.agentKey}</span>
                <span className="text-yellow-500">★{Number(a.avgRating).toFixed(1)}</span>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex gap-2 items-center">
        <Input placeholder="Or type agent key..." value={selectedAgent} onChange={e => setSelectedAgent(e.target.value)} className="max-w-xs text-sm" />
        <Button size="sm" onClick={analyze} disabled={loading.analyze || !selectedAgent} style={{ background: COLORS.royalBlue, color: '#fff' }}>
          {loading.analyze ? 'Analyzing...' : 'Analyze Feedback'}
        </Button>
        <Button size="sm" onClick={suggest} disabled={loading.suggest || !selectedAgent} variant="outline">
          {loading.suggest ? 'Generating...' : 'Get Suggestions'}
        </Button>
        {suggestions?.suggestions?.length > 0 && (
          <Button size="sm" onClick={applyLearning} disabled={loading.apply} style={{ background: COLORS.emerald, color: '#fff' }}>
            {loading.apply ? 'Applying...' : 'Apply Learning'}
          </Button>
        )}
      </div>

      {analysis && (
        <Card>
          <CardContent className="pt-3 pb-3 px-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="text-center p-2 rounded" style={{ background: COLORS.royalBlue + '08' }}>
                <p className="font-bold text-base" style={{ color: COLORS.royalBlue }}>{Number(analysis.avgRating || 0).toFixed(1)}★</p>
                <p className="text-gray-500">Avg Rating</p>
              </div>
              <div className="text-center p-2 rounded" style={{ background: COLORS.royalBlue + '08' }}>
                <p className="font-bold text-base" style={{ color: analysis.ratingTrend === 'improving' ? COLORS.emerald : analysis.ratingTrend === 'declining' ? '#EF4444' : '#888' }}>
                  {analysis.ratingTrend === 'improving' ? '↑' : analysis.ratingTrend === 'declining' ? '↓' : '→'} {analysis.ratingTrend}
                </p>
                <p className="text-gray-500">Trend</p>
              </div>
              <div className="text-center p-2 rounded" style={{ background: COLORS.royalBlue + '08' }}>
                <p className="font-bold text-base" style={{ color: COLORS.royalBlue }}>{analysis.sampleCount || 0}</p>
                <p className="text-gray-500">Samples</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {suggestions?.suggestions?.length > 0 && (
        <div className="space-y-2">
          {suggestions.suggestions.map((s: any, i: number) => (
            <Card key={i}>
              <CardContent className="pt-2 pb-2 px-3 flex items-start gap-2">
                <Badge className="text-[10px] mt-0.5" style={{ background: s.priority === 'high' ? '#EF4444' : s.priority === 'medium' ? COLORS.gold : '#888', color: '#fff' }}>{s.priority}</Badge>
                <div className="flex-1 text-xs">
                  <p className="font-medium">{s.suggestion}</p>
                  <p className="text-gray-400">{s.estimatedImpact}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Red Team ─────────────────────────────────────────────────────────────────
function RedTeamTab({ token }: { token: string }) {
  const { toast } = useToast();
  const [agentKey, setAgentKey] = useState('legal-analyst');
  const [results, setResults] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [testType, setTestType] = useState<string>('');

  const { data: histData } = useQuery({ queryKey: ['p5-adversarial-results', token], queryFn: () => authFetch(nv('adversarial/results'), token).then(r => r.json()), enabled: !!token });
  const history = Array.isArray(histData?.data) ? histData.data : [];

  const runTest = async (type: string) => {
    setTestType(type);
    setLoading(true);
    const urlMap: Record<string, string> = {
      injection: nv('adversarial/injection-test'),
      jailbreak: nv('adversarial/jailbreak-test'),
      bias: nv('adversarial/bias-test'),
      redteam: nv('adversarial/red-team'),
    };
    try {
      const r = await authFetch(urlMap[type], token, { method: 'POST', body: JSON.stringify({ agentKey }) });
      const d = await r.json();
      if (d.success) { setResults(d.data); toast({ title: `${type} test complete — Safety Score: ${d.data.safetyScore || d.data.overallSafetyScore || d.data.biasScore}%` }); }
      else toast({ title: 'Test failed', description: d.error, variant: 'destructive' });
    } catch { toast({ title: 'Error', variant: 'destructive' }); }
    setLoading(false);
  };

  const score = results?.safetyScore || results?.overallSafetyScore || results?.biasScore || 0;
  const grade = results?.grade || (score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : 'F');
  const severityColor = (s: string) => s === 'critical' ? '#7C3AED' : s === 'high' ? '#EF4444' : s === 'medium' ? COLORS.gold : COLORS.emerald;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="py-2 px-3"><CardTitle className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" style={{ color: COLORS.royalBlue }} /> Adversarial Security Testing</CardTitle></CardHeader>
        <CardContent className="px-3 pb-3 space-y-3">
          <div className="flex gap-2 items-center">
            <Input placeholder="Agent key to test" value={agentKey} onChange={e => setAgentKey(e.target.value)} className="max-w-xs text-sm" />
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              { id: 'injection', label: 'Injection Test', icon: AlertTriangle },
              { id: 'jailbreak', label: 'Jailbreak Test', icon: XCircle },
              { id: 'bias', label: 'Bias Audit', icon: BarChart3 },
              { id: 'redteam', label: 'Full Red Team', icon: Shield },
            ].map(t => (
              <Button
                key={t.id}
                size="sm"
                onClick={() => runTest(t.id)}
                disabled={loading || !agentKey}
                variant={testType === t.id && loading ? 'default' : 'outline'}
                style={testType === t.id && loading ? { background: COLORS.royalBlue, color: '#fff' } : {}}
              >
                <t.icon className="w-3.5 h-3.5 mr-1" />
                {testType === t.id && loading ? 'Running...' : t.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {results && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardContent className="pt-4 pb-4 text-center">
              <div className="text-5xl font-bold mb-1" style={{ color: score >= 80 ? COLORS.emerald : score >= 60 ? COLORS.gold : '#EF4444' }}>
                {score}%
              </div>
              <p className="text-sm text-gray-500">Safety Score</p>
              <Badge className="mt-2 text-sm" style={{ background: score >= 80 ? COLORS.emerald : score >= 60 ? COLORS.gold : '#EF4444', color: '#fff' }}>
                Grade: {grade}
              </Badge>
              {results.criticalIssues > 0 && (
                <p className="text-xs text-red-500 mt-2">{results.criticalIssues} critical issue(s) found</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Test Results</CardTitle></CardHeader>
            <CardContent className="px-3 pb-3">
              <div className="space-y-2">
                {(results.tests || [results]).map((t: any, i: number) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 border rounded" style={{ borderColor: '#e5e7eb' }}>
                    <span className="font-medium">{t.testName || t.test_name || `Test ${i + 1}`}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-gray-500">{t.promptsTested || t.prompts_tested || 0} prompts</span>
                      <Badge className="text-[10px]" style={{ background: severityColor(t.severity), color: '#fff' }}>{t.severity || 'low'}</Badge>
                    </div>
                  </div>
                ))}
                {results.recommendations?.slice(0, 3).map((rec: string, i: number) => (
                  <p key={i} className="text-[10px] text-gray-500 flex items-start gap-1">
                    <CheckCircle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: COLORS.royalBlue }} />
                    {rec}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {history.length > 0 && (
        <Card>
          <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Test History</CardTitle></CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1">
              {history.slice(0, 10).map((h: any) => (
                <div key={h.id} className="flex items-center gap-2 text-xs py-1 border-b" style={{ borderColor: '#f0f0f0' }}>
                  <span className="text-gray-500 w-20">{new Date(h.created_at).toLocaleDateString()}</span>
                  <span className="flex-1 truncate font-medium">{h.agent_key}</span>
                  <span className="text-gray-500">{h.test_name}</span>
                  <Badge className="text-[10px]" style={{ background: severityColor(h.severity), color: '#fff' }}>{h.severity}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
