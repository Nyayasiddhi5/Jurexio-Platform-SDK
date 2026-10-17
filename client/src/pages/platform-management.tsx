import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Link } from 'wouter';

import { JRX_REGISTRY_RUNTIME } from '@/lib/jrx-registry-stats';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
import { NyvErrorState } from '@/components/NyvErrorState';
import { NyvEmptyState } from '@/components/NyvEmptyState';
// ──────────────────────────────────────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────────────────────────────────────

interface PlatformConfig {
  id: string;
  liveId: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  status: 'active' | 'maintenance' | 'disabled';
  tier: string;
  version: string;
  rateLimit: { requestsPerMin: number; requestsPerHour: number; requestsPerDay: number; tokensPerDay: number };
  cost: { monthlyCapUSD: number; perCallLimitUSD: number; tokenBudgetPerCall: number; alertThresholdPct: number };
  features: Record<string, boolean>;
  llmRouting: { primary: string; fallback: string; budgetMode: string; maxConcurrent: number };
  apiKeys: { active: number; maxKeys: number };
  jurisdictions: string[];
  agents: number;
  usage30d?: { request_count: number; total_tokens: number; total_cost_usd: number };
}

const PLATFORM_META: Record<string, { icon: string; color: string }> = {
  nyayamitra: { icon: '🏛️', color: '#10b981' },
  'nyayasiddhi-professional': { icon: '⚖️', color: '#3b82f6' },
  professional: { icon: '⚖️', color: '#3b82f6' },
  'nyayasiddhi-institution': { icon: '🏢', color: '#8b5cf6' },
  institutional: { icon: '🏢', color: '#8b5cf6' },
  'nyayasiddhi-academy': { icon: '🎓', color: '#f97316' },
  academy: { icon: '🎓', color: '#f97316' },
  'nyayasiddhi-ministry': { icon: '⚙️', color: '#ef4444' },
  governance: { icon: '⚙️', color: '#ef4444' },
  custom: { icon: '🔧', color: '#6b7280' },
};

function mapApiPlatform(p: Record<string, unknown>): PlatformConfig {
  const platformType = String(p.platform_type ?? p.id ?? 'custom');
  const meta = PLATFORM_META[platformType] ?? PLATFORM_META.custom;
  const llm = (p.llm_config ?? {}) as Record<string, unknown>;
  const limits = (p.rate_limits_config ?? {}) as Record<string, unknown>;
  const modules = (p.modules_enabled ?? {}) as Record<string, boolean>;
  const agentsAllowed = Array.isArray(p.agents_allowed) ? p.agents_allowed as string[] : [];
  const usage = p.usage_30d as PlatformConfig['usage30d'] | undefined;

  return {
    id: platformType,
    liveId: String(p.id ?? ''),
    name: String(p.display_name ?? p.name ?? platformType),
    icon: meta.icon,
    color: meta.color,
    description: String(p.description ?? `${platformType} — configured in platform registry`),
    status: p.is_active === false ? 'disabled' : 'active',
    tier: String(p.tier ?? 'pro'),
    version: '5.0.0',
    rateLimit: {
      requestsPerMin: Number(limits.requests_per_min ?? 0),
      requestsPerHour: Number(limits.requests_per_hour ?? 0),
      requestsPerDay: Number(limits.requests_per_day ?? 0),
      tokensPerDay: Number(limits.tokens_per_day ?? 0),
    },
    cost: {
      monthlyCapUSD: Number((p.settings as Record<string, unknown>)?.monthly_cap_usd ?? 0),
      perCallLimitUSD: Number((p.settings as Record<string, unknown>)?.per_call_limit_usd ?? 0),
      tokenBudgetPerCall: Number(llm.token_budget_per_call ?? 4096),
      alertThresholdPct: Number((p.settings as Record<string, unknown>)?.alert_threshold_pct ?? 80),
    },
    features: modules,
    llmRouting: {
      primary: String(llm.primary ?? '—'),
      fallback: String(llm.fallback ?? '—'),
      budgetMode: String(llm.budget_mode ?? 'balanced'),
      maxConcurrent: Number(limits.max_concurrent ?? llm.max_concurrent ?? 0),
    },
    apiKeys: {
      active: Number(p.active_key_count ?? 0),
      maxKeys: Number((p.settings as Record<string, unknown>)?.max_keys ?? 25),
    },
    jurisdictions: Array.isArray(p.jurisdictions) && (p.jurisdictions as string[]).length
      ? p.jurisdictions as string[]
      : [String(p.jurisdiction ?? 'IN')],
    agents: agentsAllowed.length,
    usage30d: usage,
  };
}

async function fetchPlatforms(): Promise<PlatformConfig[]> {
  const token = getAuthToken();
  const res = await fetch(nv('platforms'), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Platform registry unavailable (${res.status})`);
  const data = await res.json();
  const rows = (data.platforms ?? []) as Record<string, unknown>[];
  if (!rows.length) return [];
  return rows.map(mapApiPlatform);
}

const LLM_LIST = [
  // OpenAI — GPT-4.1 Series (Apr 2025, 1M context)
  'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano',
  // OpenAI — Reasoning
  'o4-mini', 'o3', 'o3-mini', 'o3-pro',
  // Anthropic — Claude 4.6 (Feb 2026, 1M context)
  'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5',
  // Google — Gemini 3.1 (Feb 2026)
  'gemini-3.1-pro-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  // Sarvam — Indic Languages
  'sarvam-2b', 'sarvam-m',
  // DeepSeek
  'deepseek-v3', 'deepseek-r1', 'deepseek-prover-v2',
  // Meta Llama 4
  'llama-4-maverick', 'llama-4-scout',
  // Mistral
  'mistral-large-2512', 'devstral-medium', 'codestral-2508',
  // AgentZero
  'agentzero',
];

const STATUS_COLORS = { active: '#10b981', maintenance: '#f59e0b', disabled: '#ef4444' };
const TABS = ['Overview', 'Cost & Limits', 'Features', 'LLM Routing', 'API Keys'] as const;
type TabType = typeof TABS[number];

// ──────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ──────────────────────────────────────────────────────────────────────────────

export default function PlatformManagement() {
  useAuth();
  const { data: platforms = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform-management', 'platforms'],
    queryFn: fetchPlatforms,
    staleTime: 30_000,
  });
  const [selected, setSelected] = useState<PlatformConfig | null>(null);
  const [tab, setTab] = useState<TabType>('Overview');
  const [saved, setSaved] = useState(false);
  const [usage30d, setUsage30d] = useState<{ request_count?: number; total_tokens?: number; total_cost_usd?: number } | null>(null);

  useEffect(() => {
    if (platforms.length && !selected) setSelected(platforms[0]);
  }, [platforms, selected]);

  useEffect(() => {
    if (!selected?.liveId) { setUsage30d(selected?.usage30d ?? null); return; }
    const token = getAuthToken();
    fetch(`${NV_BASE}platforms/${selected.liveId}/usage`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(r => r.ok ? r.json() : null)
      .then(data => setUsage30d(data?.usage_30d ?? data?.summary ?? selected.usage30d ?? null))
      .catch(() => setUsage30d(selected.usage30d ?? null));
  }, [selected]);

  function updatePlatform(updates: Partial<PlatformConfig>) {
    if (!selected) return;
    const updated = { ...selected, ...updates };
    setSelected(updated);
  }

  function updateNested<K extends keyof PlatformConfig>(key: K, subKey: string, value: any) {
    if (!selected) return;
    const current = selected[key] as any;
    updatePlatform({ [key]: { ...current, [subKey]: value } });
  }

  function toggleFeature(feat: string) {
    if (!selected) return;
    updatePlatform({ features: { ...selected.features, [feat]: !selected.features[feat] } });
  }

  async function save() {
    if (!selected?.liveId) return;
    try {
      const token = getAuthToken();
      await fetch(`${NV_BASE}platforms/${selected.liveId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          display_name: selected.name,
          tier: selected.tier,
          is_active: selected.status === 'active',
          jurisdictions: selected.jurisdictions,
          modules_enabled: selected.features,
          llm_config: { primary: selected.llmRouting.primary, fallback: selected.llmRouting.fallback, budget_mode: selected.llmRouting.budgetMode },
          rate_limits_config: {
            requests_per_min: selected.rateLimit.requestsPerMin,
            requests_per_hour: selected.rateLimit.requestsPerHour,
            requests_per_day: selected.rateLimit.requestsPerDay,
            tokens_per_day: selected.rateLimit.tokensPerDay,
            max_concurrent: selected.llmRouting.maxConcurrent,
          },
        }),
      });
      await refetch();
    } catch (_) { /* toast in future via nv-messages */ }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground p-12 text-center">
        Loading platform registry…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-background p-6">
        <NyvErrorState title="Platform registry unavailable" error={error instanceof Error ? error.message : 'Failed to load platforms'} onRetry={() => refetch()} />
      </div>
    );
  }

  if (!platforms.length || !selected) {
    return (
      <div className="min-h-screen bg-background p-6">
        <NyvEmptyState title="No platforms configured" description="Provision platforms via SDK onboarding or the super-admin registry." />
        <Link href="/superadmin/platforms"><a className="text-amber-600 hover:underline">Open Platform Registry →</a></Link>
      </div>
    );
  }

  const sty = {
    page: { minHeight: '100vh', background: '#f8fafc', color: '#0f172a', fontFamily: 'ui-sans-serif, system-ui, sans-serif' },
    topBar: { background: '#ffffff', borderBottom: '1px solid #e2e8f0', padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16 },
    body: { display: 'flex', minHeight: 'calc(100vh - 56px)' },
    sidebar: { width: 240, background: '#ffffff', borderRight: '1px solid #e2e8f0', padding: 12 },
    main: { flex: 1, padding: 24, overflowY: 'auto' as const, background: '#f8fafc' },
    platCard: (active: boolean, color: string) => ({
      padding: '12px 14px', borderRadius: 8, cursor: 'pointer', marginBottom: 6,
      background: active ? color + '18' : '#f1f5f9',
      border: `1px solid ${active ? color : '#e2e8f0'}`,
      transition: 'all 0.15s',
    }),
    label: { display: 'block', fontSize: 11, color: '#64748b', marginBottom: 5, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
    input: (w?: string) => ({ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a', padding: '8px 12px', fontSize: 13, outline: 'none', width: w || '100%', boxSizing: 'border-box' as const }),
    select: { background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: 6, color: '#0f172a', padding: '8px 12px', fontSize: 13, outline: 'none', width: '100%' },
    card: { background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 16 },
    grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
    grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 },
    kpi: (color: string) => ({ background: color + '11', border: `1px solid ${color}33`, borderRadius: 10, padding: '16px 20px', flex: 1 }),
    tab: (active: boolean) => ({ padding: '10px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'none', border: 'none', borderBottom: `2px solid ${active ? '#f59e0b' : 'transparent'}`, color: active ? '#d97706' : '#64748b', whiteSpace: 'nowrap' as const }),
    btn: (c: string, t = '#fff') => ({ background: c, border: 'none', borderRadius: 7, color: t, padding: '9px 20px', cursor: 'pointer', fontWeight: 700, fontSize: 13 }),
    statusDot: (s: string) => ({ width: 8, height: 8, borderRadius: '50%', background: (STATUS_COLORS as any)[s] || '#94a3b8', display: 'inline-block', marginRight: 6 }),
    toggle: (on: boolean) => ({
      width: 44, height: 24, borderRadius: 12, background: on ? '#10b981' : '#cbd5e1',
      position: 'relative' as const, cursor: 'pointer', transition: 'background 0.2s', flexShrink: 0,
    }),
    toggleKnob: (on: boolean) => ({
      position: 'absolute' as const, top: 3, left: on ? 22 : 3, width: 18, height: 18,
      borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
    }),
  };

  const totalMonthlySpend = usage30d?.total_cost_usd != null
    ? usage30d.total_cost_usd
    : platforms.reduce((s, p) => s + p.cost.monthlyCapUSD, 0);
  const totalAgents = platforms.reduce((s, p) => s + p.agents, 0);
  const usageLabel = usage30d ? '30d live spend (SDK metrics)' : 'Usage pending — select a platform';

  return (
    <div style={sty.page}>
      {/* TOP BAR */}
      <div style={sty.topBar}>
        <span style={{ fontSize: 20 }}>⚙️</span>
        <span style={{ color: '#d97706', fontWeight: 800, fontSize: 16 }}>Platform Management</span>
        <span style={{ color: '#64748b', fontSize: 12, flex: 1 }}>Cost · Rate Limits · Features · LLM Routing · API Keys</span>
        {saved && <span style={{ color: '#10b981', fontSize: 13 }}>✅ Changes saved</span>}
        <button onClick={save} style={sty.btn('#f59e0b', '#000')}>💾 Save Changes</button>
      </div>

      <div style={sty.body}>
        {/* SIDEBAR */}
        <div style={sty.sidebar}>
          <div style={{ fontSize: 10, color: '#64748b', fontWeight: 700, letterSpacing: 1, marginBottom: 8 }}>PLATFORMS</div>
          {platforms.map(p => (
            <div key={p.liveId || p.id} style={sty.platCard(selected.liveId === p.liveId, p.color)} onClick={() => setSelected(p)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>{p.icon}</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: selected.liveId === p.liveId ? p.color : '#0f172a' }}>{p.name}</div>
                  <div style={{ fontSize: 10, color: '#64748b', display: 'flex', alignItems: 'center' }}>
                    <span style={sty.statusDot(p.status)} />{p.status}
                  </div>
                </div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 16, padding: 12, background: '#f1f5f9', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>{usageLabel}</div>
            <div style={{ fontSize: 18, color: '#d97706', fontWeight: 700 }}>${Number(totalMonthlySpend).toLocaleString()}</div>
            {usage30d && (
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 6 }}>
                {Number(usage30d.request_count ?? 0).toLocaleString()} requests · {Number(usage30d.total_tokens ?? 0).toLocaleString()} tokens
              </div>
            )}
            {!usage30d && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>Live usage loads per platform from registry API</div>}
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{totalAgents} agents allowed across {platforms.length} platforms</div>
          </div>
        </div>

        {/* MAIN */}
        <div style={sty.main}>
          {/* PLATFORM HEADER */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <span style={{ fontSize: 28 }}>{selected.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 20, fontWeight: 800, color: selected.color }}>{selected.name}</span>
                <span style={{ fontSize: 11, background: selected.color + '22', color: selected.color, border: `1px solid ${selected.color}`, borderRadius: 4, padding: '2px 8px' }}>{selected.tier}</span>
                <span style={{ fontSize: 11, background: (STATUS_COLORS as any)[selected.status] + '22', color: (STATUS_COLORS as any)[selected.status], border: `1px solid ${(STATUS_COLORS as any)[selected.status]}`, borderRadius: 4, padding: '2px 8px' }}>
                  {selected.status.toUpperCase()}
                </span>
              </div>
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 3 }}>{selected.description}</div>
            </div>
            <select style={{ ...sty.select, width: 140 }} value={selected.status} onChange={(e: any) => updatePlatform({ status: e.target.value })}>
              <option value="active">Active</option>
              <option value="maintenance">Maintenance</option>
              <option value="disabled">Disabled</option>
            </select>
          </div>

          {/* KPI ROW */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Agents', value: selected.agents, color: '#3b82f6', suffix: '' },
              { label: 'Monthly Cap', value: `$${selected.cost.monthlyCapUSD.toLocaleString()}`, color: '#f59e0b', suffix: '' },
              { label: 'Req / Min', value: selected.rateLimit.requestsPerMin, color: '#10b981', suffix: '' },
              { label: 'Tokens / Day', value: (selected.rateLimit.tokensPerDay / 1000000).toFixed(1) + 'M', color: '#8b5cf6', suffix: '' },
              { label: 'Active API Keys', value: selected.apiKeys.active, color: '#ec4899', suffix: `/ ${selected.apiKeys.maxKeys}` },
            ].map(k => (
              <div key={k.label} style={sty.kpi(k.color)}>
                <div style={{ fontSize: 10, color: '#64748b', marginBottom: 4 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: k.color }}>{k.value}{k.suffix}</div>
              </div>
            ))}
          </div>

          {/* TABS */}
          <div style={{ display: 'flex', borderBottom: '1px solid #e2e8f0', marginBottom: 20, overflowX: 'auto' }}>
            {TABS.map(t => <button key={t} onClick={() => setTab(t)} style={sty.tab(tab === t)}>{t}</button>)}
          </div>

          {/* ── OVERVIEW ── */}
          {tab === 'Overview' && (
            <div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 14 }}>Platform Details</div>
                <div style={sty.grid2}>
                  <div>
                    <label style={sty.label}>Platform Name</label>
                    <input style={sty.input()} value={selected.name} disabled />
                  </div>
                  <div>
                    <label style={sty.label}>Version</label>
                    <input style={sty.input()} value={selected.version} onInput={(e: any) => updatePlatform({ version: e.target.value })} />
                  </div>
                </div>
                <div style={{ marginTop: 14 }}>
                  <label style={sty.label}>Description</label>
                  <textarea style={{ ...sty.input(), height: 70, resize: 'vertical' }} value={selected.description} onInput={(e: any) => updatePlatform({ description: e.target.value })} />
                </div>
                <div style={{ marginTop: 14 }}>
                  <label style={sty.label}>Jurisdictions ({selected.jurisdictions.length})</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['IN', 'UK', 'GCC', 'EU', 'US', 'SG'].map(j => {
                      const on = selected.jurisdictions.includes(j);
                      return (
                        <div key={j} onClick={() => updatePlatform({ jurisdictions: on ? selected.jurisdictions.filter(x => x !== j) : [...selected.jurisdictions, j] })}
                          style={{ padding: '6px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 700, background: on ? selected.color + '22' : '#f1f5f9', color: on ? selected.color : '#64748b', border: `1px solid ${on ? selected.color : '#e2e8f0'}` }}>
                          {j}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 12 }}>Agent Allocation ({selected.agents} agents)</div>
                <div style={{ background: '#e2e8f0', borderRadius: 8, height: 12, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', background: `linear-gradient(90deg, ${selected.color}, ${selected.color}88)`, width: `${(selected.agents / JRX_REGISTRY_RUNTIME.totalAgents) * 100}%`, transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>{selected.agents} of {JRX_REGISTRY_RUNTIME.totalAgents} ROMA L5 v2 agents allocated · {((selected.agents / JRX_REGISTRY_RUNTIME.totalAgents) * 100).toFixed(1)}% of registry</div>
              </div>
            </div>
          )}

          {/* ── COST & LIMITS ── */}
          {tab === 'Cost & Limits' && (
            <div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 16 }}>Cost Configuration</div>
                <div style={sty.grid2}>
                  <div>
                    <label style={sty.label}>Monthly Cap (USD)</label>
                    <input type="number" style={sty.input()} value={selected.cost.monthlyCapUSD} onInput={(e: any) => updateNested('cost', 'monthlyCapUSD', parseFloat(e.target.value))} />
                  </div>
                  <div>
                    <label style={sty.label}>Per-Call Limit (USD)</label>
                    <input type="number" step="0.01" style={sty.input()} value={selected.cost.perCallLimitUSD} onInput={(e: any) => updateNested('cost', 'perCallLimitUSD', parseFloat(e.target.value))} />
                  </div>
                  <div>
                    <label style={sty.label}>Token Budget per Call</label>
                    <select style={sty.select} value={selected.cost.tokenBudgetPerCall} onChange={(e: any) => updateNested('cost', 'tokenBudgetPerCall', parseInt(e.target.value))}>
                      {[512, 1024, 2048, 4096, 8192, 16384, 32768, 65536].map(t => <option key={t} value={t}>{t.toLocaleString()} tokens</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={sty.label}>Alert Threshold ({selected.cost.alertThresholdPct}%)</label>
                    <input type="range" min={10} max={100} value={selected.cost.alertThresholdPct} onInput={(e: any) => updateNested('cost', 'alertThresholdPct', parseInt(e.target.value))} style={{ width: '100%' }} />
                    <div style={{ fontSize: 11, color: '#64748b' }}>Alert when monthly spend exceeds {selected.cost.alertThresholdPct}% of cap (${(selected.cost.monthlyCapUSD * selected.cost.alertThresholdPct / 100).toFixed(0)})</div>
                  </div>
                </div>
                <div style={{ marginTop: 16, padding: 14, background: '#f1f5f9', borderRadius: 8, fontSize: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ color: '#64748b', marginBottom: 6 }}>30-day live usage (SDK metrics):</div>
                  <div style={{ color: '#d97706', fontWeight: 700 }}>
                    ${Number(usage30d?.total_cost_usd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    {selected.cost.monthlyCapUSD > 0 ? ` / $${selected.cost.monthlyCapUSD.toLocaleString()} cap` : ''}
                  </div>
                </div>
              </div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 16 }}>Rate Limits</div>
                <div style={sty.grid2}>
                  {[
                    ['requestsPerMin', 'Requests / Minute', 1, 1000],
                    ['requestsPerHour', 'Requests / Hour', 1, 50000],
                    ['requestsPerDay', 'Requests / Day', 1, 1000000],
                  ].map(([key, label, min, max]) => (
                    <div key={key as string}>
                      <label style={sty.label}>{label as string}</label>
                      <input type="number" min={min} max={max} style={sty.input()} value={(selected.rateLimit as any)[key as string]}
                        onInput={(e: any) => updateNested('rateLimit', key as string, parseInt(e.target.value))} />
                    </div>
                  ))}
                  <div>
                    <label style={sty.label}>Tokens / Day</label>
                    <select style={sty.select} value={selected.rateLimit.tokensPerDay} onChange={(e: any) => updateNested('rateLimit', 'tokensPerDay', parseInt(e.target.value))}>
                      {[1000000, 2000000, 5000000, 10000000, 20000000, 50000000, 100000000].map(t => <option key={t} value={t}>{(t / 1000000).toFixed(0)}M tokens</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── FEATURES ── */}
          {tab === 'Features' && (
            <div style={sty.card}>
              <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 16 }}>Feature Toggles for {selected.name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {Object.entries(selected.features).map(([feat, on]) => (
                  <div key={feat} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', background: on ? selected.color + '11' : '#f8fafc', border: `1px solid ${on ? selected.color + '44' : '#e2e8f0'}`, borderRadius: 8, cursor: 'pointer' }}
                    onClick={() => toggleFeature(feat)}>
                    <div style={sty.toggle(on)} onClick={() => toggleFeature(feat)}>
                      <div style={sty.toggleKnob(on)} />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: on ? selected.color : '#64748b' }}>{feat}</div>
                      <div style={{ fontSize: 10, color: '#94a3b8' }}>{on ? 'Enabled' : 'Disabled'}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16, color: '#64748b', fontSize: 11 }}>
                {Object.values(selected.features).filter(Boolean).length} of {Object.keys(selected.features).length} features enabled
              </div>
            </div>
          )}

          {/* ── LLM ROUTING ── */}
          {tab === 'LLM Routing' && (
            <div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 16 }}>LLM Routing Configuration</div>
                <div style={sty.grid2}>
                  <div>
                    <label style={sty.label}>Primary LLM</label>
                    <select style={sty.select} value={selected.llmRouting.primary} onChange={(e: any) => updateNested('llmRouting', 'primary', e.target.value)}>
                      {LLM_LIST.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={sty.label}>Fallback LLM</label>
                    <select style={sty.select} value={selected.llmRouting.fallback} onChange={(e: any) => updateNested('llmRouting', 'fallback', e.target.value)}>
                      {LLM_LIST.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={sty.label}>Budget Mode</label>
                    <select style={sty.select} value={selected.llmRouting.budgetMode} onChange={(e: any) => updateNested('llmRouting', 'budgetMode', e.target.value)}>
                      {['minimal', 'balanced', 'premium', 'unlimited'].map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label style={sty.label}>Max Concurrent Requests</label>
                    <input type="number" min={1} max={500} style={sty.input()} value={selected.llmRouting.maxConcurrent} onInput={(e: any) => updateNested('llmRouting', 'maxConcurrent', parseInt(e.target.value))} />
                  </div>
                </div>
              </div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 14 }}>Routing Flow</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                  {[
                    { label: 'Request', icon: '📥', color: '#3b82f6' },
                    { label: 'LRM Router', icon: '🔀', color: '#8b5cf6' },
                    { label: selected.llmRouting.primary, icon: '⭐', color: selected.color },
                    { label: selected.llmRouting.fallback, icon: '↩', color: '#f59e0b' },
                    { label: 'AgentZero', icon: '🛡️', color: '#6b7280' },
                  ].map((node, i, arr) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center' }}>
                      <div style={{ padding: '10px 14px', background: node.color + '22', border: `1px solid ${node.color}44`, borderRadius: 8, textAlign: 'center' as const, minWidth: 90 }}>
                        <div style={{ fontSize: 18 }}>{node.icon}</div>
                        <div style={{ fontSize: 10, color: node.color, marginTop: 4, fontWeight: 600 }}>{node.label}</div>
                      </div>
                      {i < arr.length - 1 && <div style={{ fontSize: 16, color: '#cbd5e1', margin: '0 4px' }}>→</div>}
                    </div>
                  ))}
                </div>
                <div style={{ color: '#64748b', fontSize: 11, marginTop: 10 }}>Level 1: {selected.llmRouting.primary} → Level 2: {selected.llmRouting.fallback} → Level 3: AgentZero (always-on fallback, zero cost)</div>
              </div>
              <div style={sty.card}>
                <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 14 }}>NS SLM / LLM / LRM Architecture</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  {[
                    { title: 'NS SLM', desc: 'Jurisdiction-specific small language models (IN, UK, GCC, EU, US, SG). Future: custom fine-tuned on Jurexio legal corpus.', status: 'Planned', color: '#8b5cf6' },
                    { title: 'NS LLM', desc: 'Jurexio Foundation LLM — future proprietary large language model trained on all 6 jurisdiction legal corpora.', status: 'Planned', color: '#3b82f6' },
                    { title: 'NS LRM', desc: 'Jurexio Legal Reasoning Model — dedicated reasoning model for complex legal analysis, replacing chain-of-thought workarounds.', status: 'Planned', color: '#f59e0b' },
                  ].map(m => (
                    <div key={m.title} style={{ background: m.color + '11', border: `1px solid ${m.color}33`, borderRadius: 8, padding: 14 }}>
                      <div style={{ color: m.color, fontWeight: 700, fontSize: 14, marginBottom: 6 }}>{m.title}</div>
                      <div style={{ color: '#64748b', fontSize: 11, lineHeight: 1.6, marginBottom: 8 }}>{m.desc}</div>
                      <span style={{ fontSize: 10, background: '#f1f5f9', color: '#64748b', borderRadius: 3, padding: '2px 8px', border: '1px solid #e2e8f0' }}>{m.status} · Architecture Ready</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12, padding: 10, background: '#f1f5f9', borderRadius: 6, fontSize: 11, color: '#64748b', border: '1px solid #e2e8f0' }}>
                  Current intelligence stack: OpenAI · Anthropic · Google · Sarvam · DeepSeek · Mistral · Meta via OpenRouter. NS SLM/LLM/LRM will be plug-and-play replacements in the LRM router layer.
                </div>
              </div>
            </div>
          )}

          {/* ── API KEYS ── */}
          {tab === 'API Keys' && (
            <div style={sty.card}>
              <div style={{ color: '#d97706', fontWeight: 700, marginBottom: 4 }}>API Key Management — {selected.name}</div>
              <div style={{ color: '#64748b', fontSize: 12, marginBottom: 16 }}>
                {selected.apiKeys.active} active key{selected.apiKeys.active === 1 ? '' : 's'} (live count from registry)
              </div>
              <Link href="/console/sdk-hub?tab=keys">
                <a style={{ ...sty.btn('#2563eb'), display: 'inline-block', marginTop: 8, fontSize: 12, textDecoration: 'none' }}>
                  Open SDK Key Management →
                </a>
              </Link>
              <div style={{ marginTop: 16, padding: 12, background: '#f1f5f9', borderRadius: 8, fontSize: 11, color: '#64748b', border: '1px solid #e2e8f0' }}>
                Keys are managed in the SDK Hub. Rate limits: {selected.rateLimit.requestsPerMin || '—'} req/min.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
