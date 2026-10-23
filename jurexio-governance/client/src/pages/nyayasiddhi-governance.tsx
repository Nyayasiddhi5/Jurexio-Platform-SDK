import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { JrxGovernanceBadge } from '@/components/JrxGovernanceBadge';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { JrxPageShell } from '@/components/JrxPageShell';
import { apiRequest } from '@/lib/queryClient';
import { nv, p } from '@/lib/jrx-api-paths';
import { nvJurisdictionsFromStatutesSummary } from '@/lib/jrx-console-data';

const COLORS = {
  gold: '#C7B15B',
  teal: '#00B4D8',
  green: '#10B981',
  red: '#EF4444',
  purple: '#8B5CF6',
  orange: '#F59E0B',
};

const JURISDICTION_FLAGS: Record<string, string> = { IN: '🇮🇳', UK: '🇬🇧', US: '🇺🇸', EU: '🇪🇺', SG: '🇸🇬', GC: '🌐' };

const POLICY_MODULES = [
  { icon: '📜', title: 'Act & Rule Engine', desc: 'Versioned statutory text for the Indian legal system: BNS 2023, IPC, BNSS 2023, CrPC, CPC, Constitution of India, DPDPA 2023, Companies Act 2013, and all major Central Acts.', status: 'Live', color: COLORS.green },
  { icon: '🏛️', title: 'Regulatory Monitor', desc: '40+ Indian regulatory bodies monitored: RBI, SEBI, TRAI, MeitY, IRDAI, CCI, MCA, CBIC, CBDT, NCLT, and more.', status: 'Live', color: COLORS.teal },
  { icon: '🔍', title: 'Enforcement Monitoring', desc: 'Real-time tracking of regulatory enforcement actions, penalties, notices, and circulars across all monitored jurisdictions.', status: 'Live', color: COLORS.purple },
  { icon: '🛡️', title: 'DPDPA Compliance Engine', desc: 'Full Digital Personal Data Protection Act 2023 (India) compliance. Consent management, data principal rights, PII vault, breach notification workflows.', status: 'Live', color: COLORS.gold },
  { icon: '⚖️', title: 'Policy Impact Analysis', desc: 'AI-powered analysis of draft legislation and regulatory changes. Assesses impact on organisations, clients, and ongoing matters.', status: 'Beta', color: COLORS.orange },
  { icon: '📊', title: 'Governance Analytics', desc: 'Regulatory risk scoring, compliance dashboards, audit trails, and enforcement trend analysis for government and institutional clients.', status: 'Beta', color: '#EC4899' },
];

type GovernanceAgentRow = { name: string; role: string; jurisdiction: string; grpo: number | string };

type TabId = 'overview' | 'jurisdictions' | 'agents' | 'compliance';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Policy Modules', icon: '🏛️' },
  { id: 'jurisdictions', label: 'Jurisdictions', icon: '🌏' },
  { id: 'agents', label: 'Governance Agents', icon: '🤖' },
  { id: 'compliance', label: 'Compliance', icon: '📋' },
];

export default function JurexioGovernance() {
  const [activeTab, setActiveTab] = useState<TabId>('overview');

  const { data: surface } = useQuery({
    queryKey: [p('GOVERNANCE_SURFACE')],
    queryFn: () => apiRequest(p('GOVERNANCE_SURFACE')),
    staleTime: 60_000,
  });

  const { data: statutesSummary } = useQuery({
    queryKey: [nv('statutes/_summary')],
    queryFn: () => apiRequest(nv('statutes/_summary')),
    staleTime: 120_000,
  });

  const { data: complianceIso } = useQuery({
    queryKey: [nv('compliance/iso')],
    queryFn: () => apiRequest(nv('compliance/iso')),
    staleTime: 120_000,
  });

  const { data: registryRaw } = useQuery({
    queryKey: [nv('registry/agents'), 'governance'],
    queryFn: () => apiRequest(`${nv('registry/agents')}?limit=500`),
    staleTime: 120_000,
  });

  const { data: ministryPlatform } = useQuery({
    queryKey: [nv('platforms'), 'ministry'],
    queryFn: () => apiRequest(`${nv('platforms')}?platform_type=nyayasiddhi-ministry`),
    staleTime: 60_000,
  });

  const jurisdictions = useMemo(() => nvJurisdictionsFromStatutesSummary(statutesSummary), [statutesSummary]);
  const governanceAgents = useMemo((): GovernanceAgentRow[] => {
    const rows = (registryRaw as { agents?: Record<string, unknown>[] })?.agents
      ?? (Array.isArray(registryRaw) ? registryRaw : []);
    const filtered = rows.filter((a) => {
      const cat = String(a.category ?? a.practice_area ?? '').toLowerCase();
      const name = String(a.name ?? a.display_name ?? '').toLowerCase();
      return cat.includes('govern') || cat.includes('compliance') || cat.includes('regulat')
        || name.includes('govern') || name.includes('dpdpa') || name.includes('enforcement');
    });
    return filtered.slice(0, 24).map((a) => ({
      name: String(a.name ?? a.display_name ?? a.agent_id ?? 'Agent'),
      role: String(a.description ?? a.subcategory ?? 'Governance specialist'),
      jurisdiction: String(a.jurisdiction ?? (Array.isArray(a.jurisdictions) ? (a.jurisdictions as string[]).join('/') : 'IN')),
      grpo: Number(a.grpo_score ?? a.grpoScore ?? 0) || '—',
    }));
  }, [registryRaw]);

  const complianceFrameworks = useMemo(() => {
    const fws = Array.isArray((complianceIso as { frameworks?: unknown[] })?.frameworks)
      ? (complianceIso as { frameworks: Record<string, unknown>[] }).frameworks
      : [];
    return fws.map((f) => {
      const counts = (f.counts ?? {}) as Record<string, number>;
      const fail = Number(counts.FAIL ?? 0);
      const partial = Number(counts.PARTIAL ?? 0);
      const status = fail > 0 ? 'Gap' : partial > 0 ? 'Partial' : 'Active';
      return {
        label: String(f.longName ?? f.name ?? f.framework ?? 'Framework'),
        status,
        color: status === 'Active' ? COLORS.green : COLORS.orange,
      };
    });
  }, [complianceIso]);

  const ministryRow = Array.isArray((ministryPlatform as { platforms?: unknown[] })?.platforms)
    ? (ministryPlatform as { platforms: Record<string, unknown>[] }).platforms[0]
    : null;
  const platformStatus = ministryRow
    ? (ministryRow.is_active === false ? 'Disabled' : String(ministryRow.tier ?? 'Live'))
    : 'Registry pending';

  const openIncidents = Number(surface?.incidents?.open ?? 0);
  const hitlPending = Number(surface?.hitl?.pending ?? 0);
  const passRate = Number(surface?.guardrails?.passRate ?? 1);
  const riskScore = Math.min(100, Math.round((1 - passRate) * 100 + openIncidents * 5 + hitlPending * 2));
  const riskBadge = riskScore < 35 ? 'GREEN' : riskScore < 65 ? 'YELLOW' : 'RED';

  const overviewMetrics = [
    { label: 'Jurisdictions', value: jurisdictions.length ? String(jurisdictions.length) : '—', icon: '🌏', color: COLORS.purple },
    { label: 'HITL Pending', value: surface ? String(hitlPending) : '—', icon: '👁️', color: COLORS.teal },
    { label: 'Governance Agents', value: governanceAgents.length ? String(governanceAgents.length) : '—', icon: '🤖', color: COLORS.gold },
    { label: 'Compliance Frameworks', value: complianceFrameworks.length ? String(complianceFrameworks.length) : '—', icon: '📋', color: COLORS.green },
  ];

  const headerChips = [
    { label: jurisdictions.length ? `${jurisdictions.length} Jurisdictions` : 'Jurisdictions —', color: COLORS.teal },
    { label: governanceAgents.length ? `${governanceAgents.length} Governance Agents` : 'Agents —', color: COLORS.purple },
    { label: openIncidents ? `${openIncidents} Open Incidents` : 'Incidents clear', color: openIncidents ? COLORS.orange : COLORS.green },
    { label: complianceFrameworks.length ? `${complianceFrameworks.length} Frameworks` : 'Frameworks —', color: '#3B82F6' },
    { label: 'ISO 42001 · ISO 27001', color: COLORS.orange },
  ];

  return (
    <JrxPageShell
      testId="page-nyayasiddhi-governance"
      title="Jurexio Ministry™"
      description="Sovereign Regulatory & Government Legal Infrastructure Platform"
      actions={
        <div className="flex items-center gap-3">
          <JrxGovernanceBadge compact governance={{
            risk_score: riskScore,
            risk_badge: riskBadge as 'GREEN' | 'YELLOW' | 'RED',
            risk_blocked: riskScore >= 80,
            pattern_key: 'MINISTRY',
            warnings: ['Government AI Platform — All regulatory outputs require ministerial review'],
            timestamp: new Date().toISOString(),
          }} />
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-1.5 text-center">
            <div className="text-[11px] font-bold text-emerald-700">PLATFORM STATUS</div>
            <div className="text-sm font-bold text-foreground">{platformStatus}</div>
          </div>
        </div>
      }
    >
      <div className="mx-auto max-w-[1100px] space-y-5">
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Jurexio Ministry is the sovereign government and regulatory AI platform, purpose-built for ministries, regulatory bodies, courts, and law enforcement agencies.
            It powers Act/Rule versioning, real-time regulatory monitoring across 40+ regulators, DPDPA compliance automation, enforcement analysis, and policy impact assessment across 6 jurisdictions.
          </p>

          <div className="max-w-3xl rounded-lg border border-gold bg-amber-50 px-3.5 py-2.5">
            <span className="text-xs font-bold text-gold">Informational overview</span>
            <span className="text-xs text-muted-foreground">
              {' '}— capability summary, not a live operational feed. For live data see{' '}
              <a href="/console/dpdpa-compliance" className="text-royal-blue underline">Compliance</a>,{' '}
              <a href="/console/eu-ai-compliance" className="text-royal-blue underline">ISO/EU-AI dashboards</a>, and{' '}
              <a href="/console/agent-registry" className="text-royal-blue underline">Agent Registry</a>.
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {headerChips.map(b => (
              <div key={b.label} className="rounded-xl border border-border bg-card px-3 py-1 text-[11px] font-semibold" style={{ color: b.color }}>
                {b.label}
              </div>
            ))}
          </div>

        <div className="flex gap-2">
          {TABS.map(tab => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all ${
                  isActive
                    ? 'border border-gold bg-amber-50 text-gold'
                    : 'border border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                <span>{tab.icon}</span> {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'overview' && (
          <div>
            <div className="grid grid-cols-3 gap-3.5">
              {POLICY_MODULES.map(m => (
                <div key={m.title} className="rounded-xl border border-border bg-card p-4">
                  <div className="mb-2.5 flex items-center gap-2.5">
                    <span className="text-[22px]">{m.icon}</span>
                    <div>
                      <div className="text-sm font-bold text-foreground">{m.title}</div>
                      <div className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold ${
                        m.status === 'Live' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'
                      }`}>
                        <div className="h-1 w-1 rounded-full" style={{ background: m.color }} />
                        {m.status.toUpperCase()}
                      </div>
                    </div>
                  </div>
                  <p className="m-0 text-[11px] leading-relaxed text-muted-foreground">{m.desc}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid grid-cols-4 gap-3">
              {overviewMetrics.map(m => (
                <div key={m.label} className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="mb-1 text-2xl">{m.icon}</div>
                  <div className="text-[26px] font-bold" style={{ color: m.color }}>{m.value}</div>
                  <div className="text-[11px] text-muted-foreground">{m.label}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'jurisdictions' && (
          <div className="grid grid-cols-2 gap-3.5">
            {jurisdictions.length ? jurisdictions.map(j => (
              <div key={j.code} className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[28px]">{JURISDICTION_FLAGS[j.code] ?? '🌐'}</span>
                    <div>
                      <div className="text-[15px] font-bold text-foreground">{j.name ?? j.code}</div>
                      <div className="text-[11px] text-muted-foreground">{j.code} jurisdiction</div>
                    </div>
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                    Active
                  </div>
                </div>
                <div className="flex gap-4">
                  <div>
                    <div className="text-[22px] font-bold text-gold">{j.statutes ?? '—'}</div>
                    <div className="text-[10px] text-muted-foreground">Statutes indexed</div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="col-span-2">
                <JrxEmptyState title="No jurisdiction data" description="Statute summary unavailable — check /api/jrx/statutes/_summary." />
              </div>
            )}
          </div>
        )}

        {activeTab === 'agents' && (
          <div>
            <div className="mb-4 text-xs text-muted-foreground">
              {governanceAgents.length
                ? `${governanceAgents.length} governance-related agents from the live registry`
                : 'No governance-tagged agents in registry yet'}
            </div>
            {governanceAgents.length ? (
            <div className="grid grid-cols-1 gap-2.5">
              {governanceAgents.map(a => (
                <div key={a.name} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3.5">
                  <div className="text-2xl">🤖</div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-foreground">{a.name}</div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{a.role}</div>
                    <div className="mt-1 text-[10px] text-royal-blue">Jurisdiction: {a.jurisdiction}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-lg font-bold text-gold">{a.grpo}</div>
                    <div className="text-[9px] text-muted-foreground">GRPO score</div>
                  </div>
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
                    ROMA L5
                  </div>
                </div>
              ))}
            </div>
            ) : (
              <JrxEmptyState title="No governance agents loaded" description="Registry returned no governance/compliance-tagged agents." />
            )}
          </div>
        )}

        {activeTab === 'compliance' && (
          <div>
            <div className="grid grid-cols-3 gap-3">
              {complianceFrameworks.length ? complianceFrameworks.map(f => (
                <div key={f.label} className="rounded-lg border border-border bg-card p-4 text-center">
                  <div className="mb-1.5 text-base font-bold" style={{ color: f.color }}>{f.label}</div>
                  <div className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${
                    f.status === 'Active' ? 'border border-emerald-200 bg-emerald-50 text-emerald-700' : 'border border-amber-200 bg-amber-50 text-amber-700'
                  }`}>
                    {f.status}
                  </div>
                </div>
              )) : (
                <div className="col-span-3">
                  <JrxEmptyState title="No compliance evidence" description="Run compliance ISO refresh to populate frameworks." />
                </div>
              )}
            </div>
            <div className="mt-5 rounded-lg border border-gold bg-amber-50/50 p-4">
              <div className="mb-2 text-sm font-semibold text-gold">📌 Pending: Government-Specific Integrations</div>
              {[
                'Government API integrations (MeitY, NIC) — DigitalIndia ecosystem',
                'WORM audit chain for regulatory filings',
                'Act/Rule versioning engine with diff tracking',
                'NIC authentication (eSign, DigiLocker)',
                'RTI portal integration (Central / State)',
                'Court complex e-filing (CIS/ICMIS)',
              ].map((p, i) => (
                <div key={i} className="mb-1 flex gap-2 text-[11px] text-muted-foreground">
                  <span className="text-amber-600">◦</span> {p}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="mt-4 text-center text-[10px] text-muted-foreground/50">
          Jurexio Enterprise Platform 1.0.0 · Jurexio Ministry™ · Sovereign Regulatory Infrastructure
        </div>
      </div>
    </JrxPageShell>
  );
}
