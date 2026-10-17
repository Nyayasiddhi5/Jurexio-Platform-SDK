import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Super Admin — Agent Capability Matrix
 * ROMA L5 agents × 6 jurisdictions × per-platform assignment
 */

import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { NyvErrorState } from '@/components/NyvErrorState';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Bot, Search, RefreshCw, BarChart3, Shield, Globe, CheckCircle2,
  Filter, ChevronDown, Activity, Zap, Layers, Star,
} from 'lucide-react';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'GCC', 'SG'];
const CATEGORIES = ['Legal Research', 'Document AI', 'Compliance', 'Litigation', 'Contracts', 'Criminal', 'Corporate', 'Tax', 'IP', 'Real Estate', 'Family', 'Employment', 'Constitutional', 'Banking', 'Arbitration'];
const TIER_COLORS: Record<string, string> = {
  solo: 'bg-slate-500/20 text-slate-700',
  pro: 'bg-blue-500/20 text-blue-700',
  enterprise: 'bg-purple-500/20 text-purple-700',
  government: 'bg-red-500/20 text-red-700',
};

export default function SuperAdminAgentMatrix() {
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [tierFilter, setTierFilter] = useState('all');
  const [jFilter, setJFilter] = useState('all');

  const { data: liveAgents, isLoading: agentsLoading, isError: agentsError, refetch: refetchAgents } = useQuery({
    queryKey: ['agents-list'],
    queryFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('agents'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return resp.json();
    },
  });

  const liveList: any[] = Array.isArray(liveAgents?.data)
    ? liveAgents.data
    : Array.isArray(liveAgents?.agents)
      ? liveAgents.agents
      : [];
  const normalizedLive = liveList.map((a: any) => ({
    agent_id: a.agent_id || a.id || '',
    name: a.name || a.agent_name || a.id || 'unnamed',
    category: a.category || a.practice_area || 'general',
    tier_required: a.tier_required || a.tier || 'solo',
    jurisdictions: Array.isArray(a.jurisdictions) ? a.jurisdictions : (a.jurisdiction ? [a.jurisdiction] : []),
    is_active: a.is_active !== false,
    calls_30d: Number(a.calls_30d ?? a.requests_30d ?? 0),
  }));
  const agents = normalizedLive;
  const displayed = agents;

  const filtered = useMemo(() => displayed.filter(a => {
    const matchSearch = !search || a.name.toLowerCase().includes(search.toLowerCase()) || a.agent_id.toLowerCase().includes(search.toLowerCase());
    const matchCat = catFilter === 'all' || a.category === catFilter;
    const matchTier = tierFilter === 'all' || a.tier_required === tierFilter;
    const matchJ = jFilter === 'all' || a.jurisdictions.includes(jFilter);
    return matchSearch && matchCat && matchTier && matchJ;
  }), [search, catFilter, tierFilter, jFilter, displayed]);

  const totalCalls = displayed.reduce((s: number, a: any) => s + (Number(a.calls_30d) || 0), 0);

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="Agent Capability Matrix">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-cyan-900">
              <Bot className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">Agent Capability Matrix</h1>
            <Badge className="bg-red-500/20 text-red-700 border-red-200 text-xs">Super Admin</Badge>
          </div>
          <p className="text-sm text-slate-600">{displayed.length} ROMA L5 agents · 6 jurisdictions · per-platform assignment and activation</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Agents', value: displayed.length, icon: Bot, color: 'text-blue-400' },
          { label: 'Active', value: displayed.filter((a: any) => a.is_active).length, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Calls (30d)', value: totalCalls.toLocaleString(), icon: Activity, color: 'text-purple-400' },
          { label: 'Jurisdictions', value: JURISDICTIONS.length, icon: Globe, color: 'text-amber-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white border-slate-200/50" aria-label={`${label}: ${value}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className={cn('w-7 h-7', color)} aria-hidden="true" />
              <div>
                <p className="text-xl font-bold text-[#152448]">{value}</p>
                <p className="text-xs text-slate-600">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-700" aria-hidden="true" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search agents..."
            className="pl-8 w-48 bg-slate-100 border-slate-200 text-slate-800 text-xs"
            aria-label="Search agents"
          />
        </div>
        <Select value={catFilter} onValueChange={setCatFilter}>
          <SelectTrigger className="w-36 bg-slate-100 border-slate-200 text-slate-800 text-xs" aria-label="Filter by category">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent className="bg-slate-100 border-slate-200">
            <SelectItem value="all">All Categories</SelectItem>
            {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-32 bg-slate-100 border-slate-200 text-slate-800 text-xs" aria-label="Filter by tier">
            <SelectValue placeholder="Tier" />
          </SelectTrigger>
          <SelectContent className="bg-slate-100 border-slate-200">
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="solo">Solo</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </SelectContent>
        </Select>
        <Select value={jFilter} onValueChange={setJFilter}>
          <SelectTrigger className="w-28 bg-slate-100 border-slate-200 text-slate-800 text-xs" aria-label="Filter by jurisdiction">
            <SelectValue placeholder="Jurisdiction" />
          </SelectTrigger>
          <SelectContent className="bg-slate-100 border-slate-200">
            <SelectItem value="all">All</SelectItem>
            {JURISDICTIONS.map(j => <SelectItem key={j} value={j}>{j}</SelectItem>)}
          </SelectContent>
        </Select>
        <Badge className="bg-slate-200 text-slate-700 self-center text-xs px-2 py-1" aria-label={`Showing ${filtered.length} agents`}>
          Showing {filtered.length} agents
        </Badge>
      </div>

      {/* Agent Matrix Table */}
      <Card className="bg-white border-slate-200/50">
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs" role="grid" aria-label="Agent capability matrix">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="text-left py-3 px-4 text-slate-600 font-medium w-48" scope="col">Agent</th>
                <th className="text-left py-3 px-3 text-slate-600 font-medium" scope="col">Category</th>
                <th className="text-left py-3 px-3 text-slate-600 font-medium" scope="col">Tier</th>
                {JURISDICTIONS.map(j => (
                  <th key={j} className="text-center py-3 px-2 text-slate-600 font-medium" scope="col">{j}</th>
                ))}
                <th className="text-right py-3 px-4 text-slate-600 font-medium" scope="col">Calls (30d)</th>
                <th className="text-center py-3 px-3 text-slate-600 font-medium" scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent, i) => (
                <tr key={agent.agent_id} className={cn('border-b border-slate-200/50 hover:bg-slate-100/30 transition-colors', i % 2 === 0 ? '' : 'bg-white/30')} role="row">
                  <td className="py-2.5 px-4">
                    <div>
                      <p className="font-medium text-slate-800">{agent.name}</p>
                      <p className="text-slate-700 text-[10px] font-mono">{agent.agent_id}</p>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">{agent.category}</td>
                  <td className="py-2.5 px-3">
                    <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', TIER_COLORS[agent.tier_required] ?? 'bg-slate-500/20 text-slate-700')} aria-label={`Tier required: ${agent.tier_required}`}>
                      {agent.tier_required}
                    </span>
                  </td>
                  {JURISDICTIONS.map(j => (
                    <td key={j} className="py-2.5 px-2 text-center" aria-label={`${j}: ${agent.jurisdictions.includes(j) ? 'supported' : 'not supported'}`}>
                      {agent.jurisdictions.includes(j) ? (
                        <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto">
                          <div className="w-2 h-2 rounded-full bg-emerald-400" />
                        </div>
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-slate-100 border border-slate-200/40 mx-auto" />
                      )}
                    </td>
                  ))}
                  <td className="py-2.5 px-4 text-right text-slate-700 font-medium">{agent.calls_30d.toLocaleString()}</td>
                  <td className="py-2.5 px-3 text-center">
                    <div className={cn('w-2 h-2 rounded-full mx-auto', agent.is_active ? 'bg-emerald-400' : 'bg-slate-600')} aria-label={agent.is_active ? 'Active' : 'Inactive'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {agentsLoading && (
            <div className="space-y-2 p-4" data-testid="loading-agent-matrix">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          )}
          {!agentsLoading && agentsError && (
            <NyvErrorState
              title="Unable to load agents"
              description="The agent registry could not be retrieved."
              onRetry={() => refetchAgents()}
              variant="card"
            />
          )}
          {!agentsLoading && !agentsError && filtered.length === 0 && (
            <NyvEmptyState icon={Bot} title="No agents match your filters" description="Try adjusting search or category." />
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-slate-600 mt-2 text-right" aria-label="Live registry">Live from /api/jrx/agents — {displayed.length} agents shown</p>
    </div>
  );
}
