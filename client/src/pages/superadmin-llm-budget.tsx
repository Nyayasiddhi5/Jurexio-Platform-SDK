/**
 * Jurexio Super Admin — LLM Budget / Spend Rollup
 * Live 30-day LLM spend + token + call rollup across all orgs, sourced from
 * GET /api/jrx/superadmin/llm-budget (nv_schema.ai_activity via the
 * public.nv_ai_activity compat view). No hardcoded spend figures.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DollarSign, BarChart3, AlertTriangle, Cpu, Activity, Building2, Hash,
} from 'lucide-react';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface PerOrg {
  org_id: string;
  input_tokens: number;
  output_tokens: number;
  credits_charged: number;
  calls: number;
}
interface BudgetPayload {
  success: boolean;
  window_days: number;
  rollup: { orgs: number; total_spend_credits: number; total_tokens: number; total_calls: number };
  per_org: PerOrg[];
  generatedAt: string;
}

const MODE_COLORS: Record<string, string> = {
  minimal: 'bg-emerald-500/20 text-emerald-700',
  balanced: 'bg-blue-500/20 text-blue-700',
  premium: 'bg-purple-500/20 text-purple-700',
};

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}
function fmtInt(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString() : '0';
}

function OrgSpendBar({ org, maxSpend }: { org: PerOrg; maxSpend: number }) {
  const pct = maxSpend > 0 ? Math.min(100, (org.credits_charged / maxSpend) * 100) : 0;
  const tokens = (org.input_tokens || 0) + (org.output_tokens || 0);
  return (
    <div className="p-3 rounded-lg bg-slate-100/50 border border-slate-200/40" aria-label={`${org.org_id}: ${fmtUsd(org.credits_charged)}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-slate-800 truncate max-w-[60%]" title={org.org_id}>{org.org_id}</p>
        <span className="text-xs font-bold text-slate-700">{fmtUsd(org.credits_charged)}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden mb-1.5">
        <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${pct}%` }} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-slate-600">
        <span>{fmtInt(tokens)} tokens</span>
        <span>{fmtInt(org.calls)} calls</span>
      </div>
    </div>
  );
}

export default function SuperAdminLlmBudget() {
  const token = getAuthToken();
  const { data, isLoading, isError } = useQuery<BudgetPayload>({
    queryKey: ['superadmin-llm-budget'],
    queryFn: async () => {
      const r = await fetch(nv('superadmin/llm-budget'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(`superadmin/llm-budget ${r.status}`);
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const rollup = data?.rollup ?? { orgs: 0, total_spend_credits: 0, total_tokens: 0, total_calls: 0 };
  const perOrg = (data?.per_org ?? []).filter((o) => o.calls > 0 || o.credits_charged > 0);
  const maxSpend = perOrg.reduce((m, o) => Math.max(m, o.credits_charged || 0), 0);
  const windowDays = data?.window_days ?? 30;

  const kpis = [
    { label: `Spend (${windowDays}d)`, value: fmtUsd(rollup.total_spend_credits), icon: DollarSign, color: 'text-emerald-500', sub: 'Across all orgs' },
    { label: `Tokens (${windowDays}d)`, value: fmtInt(rollup.total_tokens), icon: Hash, color: 'text-blue-500', sub: 'Prompt + completion' },
    { label: `Calls (${windowDays}d)`, value: fmtInt(rollup.total_calls), icon: Activity, color: 'text-purple-500', sub: 'AI activity events' },
    { label: 'Active Orgs', value: fmtInt(rollup.orgs), icon: Building2, color: 'text-amber-500', sub: 'With recent usage' },
  ];

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="LLM Budget Control">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-emerald-900">
              <DollarSign className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">LLM Spend &amp; Budget</h1>
            <Badge className="bg-red-500/20 text-red-700 border-red-200 text-xs">Super Admin</Badge>
          </div>
          <p className="text-sm text-slate-600">
            Live {windowDays}-day LLM spend, token, and call rollup across all organizations
            {data?.generatedAt ? ` · updated ${new Date(data.generatedAt).toLocaleTimeString()}` : ''}
          </p>
        </div>
      </div>

      {isError && (
        <Card className="bg-white border-red-200 mb-6">
          <CardContent className="p-4 flex items-center gap-2 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Failed to load budget rollup. Check super-admin access.
          </CardContent>
        </Card>
      )}

      {/* Live rollup KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {kpis.map(({ label, value, icon: Icon, color, sub }) => (
          <Card key={label} className="bg-white border-slate-200/50" aria-label={`${label}: ${value}`}>
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs text-slate-600 mb-1">{label}</p>
                  <p className="text-xl font-bold text-[#152448]">{isLoading ? '…' : value}</p>
                  {sub && <p className="text-[10px] text-slate-700 mt-0.5">{sub}</p>}
                </div>
                <Icon className={cn('w-5 h-5 mt-0.5', color)} aria-hidden="true" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-org spend (live) */}
      <Card className="bg-white border-slate-200/50 mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-emerald-500" aria-hidden="true" /> Per-Organization Spend ({windowDays}d)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-xs text-slate-500 py-4 text-center">Loading…</p>
          ) : perOrg.length === 0 ? (
            <p className="text-xs text-slate-500 py-4 text-center">No LLM activity recorded in the last {windowDays} days.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {perOrg.slice(0, 40).map((org) => (
                <OrgSpendBar key={org.org_id} org={org} maxSpend={maxSpend} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Budget Mode Reference (policy reference — model-tier guidance) */}
      <Card className="bg-white border-slate-200/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-purple-500" aria-hidden="true" /> Budget Mode Reference
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-3 gap-3 text-xs">
            {[
              { mode: 'minimal', label: 'Minimal', description: 'Flash/Nano models only. Max $0.05/call. Ideal for citizen access platforms.', color: 'border-emerald-200 bg-emerald-500/5' },
              { mode: 'balanced', label: 'Balanced', description: 'Sonnet/GPT-4 class models. Max $0.50/call. Default for professional platforms.', color: 'border-blue-200 bg-blue-500/5' },
              { mode: 'premium', label: 'Premium', description: 'Opus/GPT-4o class models. Max $2.00/call. For enterprise and government tiers.', color: 'border-purple-200 bg-purple-500/5' },
            ].map(({ mode, label, description, color }) => (
              <div key={mode} className={cn('p-3 rounded-lg border', color)}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold', MODE_COLORS[mode])}>{mode}</span>
                  <span className="font-semibold text-slate-800">{label}</span>
                </div>
                <p className="text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
