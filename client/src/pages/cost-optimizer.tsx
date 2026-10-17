/**
 * Cost Optimization Suite — wired to the canonical aggregator
 * `/api/jrx/cost/overview` (Task #194 / 2026-05-12).
 *
 * Backend: src/routes/jrx-operations-aggregators.ts → GET /api/jrx/cost/overview
 * Auth:    super_admin; 30s refetch.
 *
 * Path imported via `p('COST_OVERVIEW')` from nv-api-paths.ts (NV-CONTRACT-001
 * / no-hardcoded-api-paths). The page renders the byProvider / byModel /
 * byTenant rollups returned directly (no { success, data } envelope).
 */
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { NyvErrorState } from "@/components/NyvErrorState";
import { p } from "@/lib/jrx-api-paths";

type Totals = { tokens: number; usd: number; requests: number };
type ProviderRow = { provider: string; usd: number; tokens: number; requests: number };
type ModelRow = { model: string; provider: string; usd: number; tokens: number; requests: number };
type TenantRow = { tenantId: string; tenantName: string; usd: number; tokens: number; requests: number };
type KeyRow = { keyPrefix: string; usd: number; tokens: number; requests: number };
type ExpensiveRow = { id: string; usd: number; tokens: number; route: string | null; model: string | null; provider: string | null; latencyMs: number; ts: string };
type Suggestion = {
  id: string; route: string; currentModel: string; currentProvider: string;
  requests: number; currentSpendUsd: number; recommendedModel: string;
  estimatedSpendUsd: number; estimatedSavingUsd: number; savingPct: number; rationale: string;
};

type CostOverview = {
  totalToday: Totals;
  totalMtd: Totals;
  byProvider: ProviderRow[];
  byModel: ModelRow[];
  byTenant: TenantRow[];
  byKey: KeyRow[];
  topExpensive: ExpensiveRow[];
  generatedAt: string;
};

const COST_OVERVIEW = p('COST_OVERVIEW');
const COST_SUGGESTIONS = p('COST_SUGGESTIONS');
const COST_TREND = p('COST_TREND');

const JUR_OPTIONS = ['ALL', 'IN', 'US', 'UK', 'EU', 'GC', 'SG'] as const;
type Jurisdiction = (typeof JUR_OPTIONS)[number];

function readPersistedJurisdiction(): Jurisdiction {
  if (typeof window === 'undefined') return 'ALL';
  const v = window.localStorage.getItem('nv:cost:jurisdiction');
  return (JUR_OPTIONS as readonly string[]).includes(v ?? '') ? (v as Jurisdiction) : 'ALL';
}

export default function CostOptimizerPage() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(readPersistedJurisdiction);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('nv:cost:jurisdiction', jurisdiction);
  }, [jurisdiction]);
  const jq = jurisdiction === 'ALL' ? '' : `?jurisdiction=${jurisdiction}`;

  const summary = useQuery<CostOverview>({
    queryKey: [COST_OVERVIEW, jurisdiction],
    queryFn: () => fetch(`${COST_OVERVIEW}${jq}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  // Task #302 — rule-based optimisation suggestions, jurisdiction-scoped.
  const suggestionsQ = useQuery<{ suggestions: Suggestion[]; jurisdiction: string; generatedAt: string }>({
    queryKey: [COST_SUGGESTIONS, jurisdiction],
    queryFn: () => fetch(`${COST_SUGGESTIONS}${jq}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  // Task #302 — 7-day spend trend.
  const trendQ = useQuery<{ series: { day: string; usd: number; tokens: number; requests: number }[]; windowDays: number; jurisdiction: string }>({
    queryKey: [COST_TREND, jurisdiction],
    queryFn: () => fetch(`${COST_TREND}${jurisdiction === 'ALL' ? '?days=7' : `?days=7&jurisdiction=${jurisdiction}`}`, { credentials: "include" }).then((r) => r.json()),
    refetchInterval: 30000,
  });

  const data = summary.data;
  const today = data?.totalToday ?? { tokens: 0, usd: 0, requests: 0 };
  const mtd = data?.totalMtd ?? { tokens: 0, usd: 0, requests: 0 };
  const byProvider = data?.byProvider ?? [];
  const byModel = data?.byModel ?? [];
  const byTenant = data?.byTenant ?? [];
  const byKey = data?.byKey ?? [];
  const topExpensive = data?.topExpensive ?? [];
  const suggestions = suggestionsQ.data?.suggestions ?? [];

  const card = (label: string, value: string, subtitle: string) => (
    <div
      className="bg-slate-900 rounded-xl border border-slate-800 p-5"
      data-testid={`stat-${label.replace(/\s+/g, "-").toLowerCase()}`}
    >
      <p className="text-xs text-slate-600 mb-1">{label}</p>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="text-xs text-slate-700 mt-1">{subtitle}</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6" data-testid="page-cost-optimizer">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Cost Optimization Suite</h1>
            <p className="text-slate-600">
              Canonical cost aggregator — today + month-to-date totals with per-provider, per-model, and per-tenant rollups.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-300">
              <span>Jurisdiction:</span>
              <select
                data-testid="cost-jurisdiction-filter"
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs text-white"
                value={jurisdiction}
                onChange={(e) => setJurisdiction(e.target.value as Jurisdiction)}
              >
                {JUR_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <div className="text-xs text-slate-700">
              {summary.isFetching || trendQ.isFetching ? "Refreshing…" : "Auto-refresh 30s"}
            </div>
          </div>
        </div>

        {summary.isError && (
          <div className="mb-6">
            <NyvErrorState
              title="Could not load cost overview"
              description="Backend may be down or you may not have super_admin access."
              error={summary.error}
              onRetry={() => summary.refetch()}
              variant="card"
            />
          </div>
        )}

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 mb-8" data-testid="card-trend-7d">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">7-Day Spend Trend</h2>
            <span className="text-xs text-slate-700">Daily USD · {jurisdiction}</span>
          </div>
          {(() => {
            const series = trendQ.data?.series ?? [];
            const max = Math.max(0.0001, ...series.map(s => s.usd));
            if (series.length === 0) return <p className="text-sm text-slate-700">No spend in the last 7 days.</p>;
            return (
              <div>
                <div className="flex items-end gap-2 h-32">
                  {series.map((s, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                      <div className="text-[10px] text-slate-700 truncate w-full text-center">${s.usd.toFixed(2)}</div>
                      <div className="bg-blue-500 hover:bg-blue-400 transition-colors w-full rounded-t" style={{ height: `${(s.usd / max) * 100}%`, minHeight: '2px' }} title={`${new Date(s.day).toLocaleDateString()}: $${s.usd.toFixed(4)} (${s.requests} req)`}/>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2 mt-2">
                  {series.map((s, i) => (
                    <div key={i} className="flex-1 text-[10px] text-slate-700 text-center min-w-0 truncate">
                      {new Date(s.day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {card("USD Today", `$${today.usd.toFixed(4)}`, `${today.requests.toLocaleString()} requests`)}
          {card("USD MTD", `$${mtd.usd.toFixed(4)}`, `${mtd.requests.toLocaleString()} requests`)}
          {card("Tokens Today", today.tokens.toLocaleString(), "in + out")}
          {card("Tokens MTD", mtd.tokens.toLocaleString(), "in + out")}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6" data-testid="card-by-provider">
            <h2 className="text-lg font-semibold mb-4">Cost by Provider (MTD)</h2>
            {byProvider.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-600">
                  <tr>
                    <th className="text-left pb-2">Provider</th>
                    <th className="text-right pb-2">Requests</th>
                    <th className="text-right pb-2">Tokens</th>
                    <th className="text-right pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byProvider.map((r) => (
                    <tr key={r.provider} className="border-t border-slate-800">
                      <td className="py-2 font-mono text-xs">{r.provider}</td>
                      <td className="py-2 text-right">{r.requests.toLocaleString()}</td>
                      <td className="py-2 text-right">{r.tokens.toLocaleString()}</td>
                      <td className="py-2 text-right">${r.usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-700">No router decisions this month yet.</p>
            )}
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6" data-testid="card-by-model">
            <h2 className="text-lg font-semibold mb-4">Cost by Model (MTD)</h2>
            {byModel.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-600">
                  <tr>
                    <th className="text-left pb-2">Model</th>
                    <th className="text-left pb-2">Provider</th>
                    <th className="text-right pb-2">Requests</th>
                    <th className="text-right pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byModel.map((r) => (
                    <tr key={`${r.provider}:${r.model}`} className="border-t border-slate-800">
                      <td className="py-2 font-mono text-xs">{r.model}</td>
                      <td className="py-2 text-xs">{r.provider}</td>
                      <td className="py-2 text-right">{r.requests.toLocaleString()}</td>
                      <td className="py-2 text-right">${r.usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-700">No model-level cost data yet.</p>
            )}
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6" data-testid="card-by-tenant">
          <h2 className="text-lg font-semibold mb-4">Cost by Tenant (MTD)</h2>
          {byTenant.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-600">
                <tr>
                  <th className="text-left pb-2">Tenant</th>
                  <th className="text-right pb-2">Requests</th>
                  <th className="text-right pb-2">Tokens</th>
                  <th className="text-right pb-2">Cost</th>
                </tr>
              </thead>
              <tbody>
                {byTenant.map((r) => (
                  <tr key={r.tenantId} className="border-t border-slate-800">
                    <td className="py-2 text-xs">{r.tenantName}</td>
                    <td className="py-2 text-right">{r.requests.toLocaleString()}</td>
                    <td className="py-2 text-right">{r.tokens.toLocaleString()}</td>
                    <td className="py-2 text-right">${r.usd.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-700">No per-tenant SDK usage yet.</p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-8">
          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6" data-testid="card-by-key">
            <h2 className="text-lg font-semibold mb-4">Cost by SDK Key (MTD)</h2>
            {byKey.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-600">
                  <tr>
                    <th className="text-left pb-2">Key</th>
                    <th className="text-right pb-2">Requests</th>
                    <th className="text-right pb-2">Tokens</th>
                    <th className="text-right pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {byKey.map((r) => (
                    <tr key={r.keyPrefix} className="border-t border-slate-800">
                      <td className="py-2 font-mono text-xs">{r.keyPrefix}</td>
                      <td className="py-2 text-right">{r.requests.toLocaleString()}</td>
                      <td className="py-2 text-right">{r.tokens.toLocaleString()}</td>
                      <td className="py-2 text-right">${r.usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-700">No per-key SDK usage yet.</p>
            )}
          </div>

          <div className="bg-slate-900 rounded-xl border border-slate-800 p-6" data-testid="card-top-expensive">
            <h2 className="text-lg font-semibold mb-4">Top 10 Most Expensive Requests (7d)</h2>
            {topExpensive.length > 0 ? (
              <table className="w-full text-sm">
                <thead className="text-xs text-slate-600">
                  <tr>
                    <th className="text-left pb-2">When</th>
                    <th className="text-left pb-2">Route</th>
                    <th className="text-left pb-2">Model</th>
                    <th className="text-right pb-2">Tokens</th>
                    <th className="text-right pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {topExpensive.map((r) => (
                    <tr key={r.id} className="border-t border-slate-800">
                      <td className="py-2 text-xs">{new Date(r.ts).toLocaleString()}</td>
                      <td className="py-2 font-mono text-xs">{r.route ?? '—'}</td>
                      <td className="py-2 font-mono text-xs">{r.model ?? '—'}</td>
                      <td className="py-2 text-right">{r.tokens.toLocaleString()}</td>
                      <td className="py-2 text-right">${r.usd.toFixed(4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-700">No expensive requests in the last 7 days.</p>
            )}
          </div>
        </div>

        <div className="bg-slate-900 rounded-xl border border-slate-800 p-6 mt-8" data-testid="card-suggestions">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-lg font-semibold">Optimisation Suggestions</h2>
            <span className="text-xs text-slate-700">
              {suggestionsQ.isFetching ? 'Refreshing…' : `${suggestions.length} suggestion${suggestions.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {suggestionsQ.isError && (
            <NyvErrorState title="Could not load suggestions" error={suggestionsQ.error} onRetry={() => suggestionsQ.refetch()} variant="inline"/>
          )}
          {suggestions.length > 0 ? (
            <ul className="space-y-3">
              {suggestions.map((s) => (
                <li
                  key={s.id}
                  className="border border-slate-800 rounded p-4 bg-slate-950"
                  data-testid={`suggestion-${s.id}`}
                >
                  <div className="flex items-baseline justify-between mb-2 gap-3">
                    <div className="font-mono text-xs text-slate-300">{s.route}</div>
                    {s.savingPct > 0 && (
                      <span className="text-xs px-2 py-0.5 rounded bg-emerald-900 text-emerald-200">
                        ~{s.savingPct}% saving · ${s.estimatedSavingUsd.toFixed(4)}/mo
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-slate-200 mb-2">{s.rationale}</div>
                  {s.savingPct > 0 && (
                    <div className="text-xs text-slate-700">
                      Currently <span className="font-mono">{s.currentModel}</span> ({s.currentProvider}) → recommend <span className="font-mono text-emerald-300">{s.recommendedModel}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            !suggestionsQ.isLoading && <p className="text-sm text-slate-700">No suggestions available yet.</p>
          )}
        </div>

        {data?.generatedAt && (
          <p className="text-xs text-slate-600 mt-4">Generated {new Date(data.generatedAt).toLocaleString()}</p>
        )}
      </div>
    </div>
  );
}
