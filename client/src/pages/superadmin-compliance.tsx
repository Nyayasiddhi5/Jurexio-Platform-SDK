import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Super Admin — ISO 42001 / ISO 27001 / SOC 2 Compliance Dashboard
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  ShieldCheck, CheckCircle2, XCircle, AlertTriangle, Clock,
  FileText, Activity, BarChart3, Lock, Shield,
  RefreshCw, Download, ChevronRight, Sparkles, Star,
} from 'lucide-react';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Live compliance types + mapping (NV-COMPLIANCE-WIRE-001) ──────────────────
// Data sources from GET /api/jrx/compliance/iso (ISO 42001 / 27001 / SOC2 control
// catalogue + live evidence verdicts). No hardcoded framework scores/controls.

interface ComplianceControl {
  id: string;
  title: string;
  category: string;
  status: 'compliant' | 'partial' | 'non_compliant' | 'in_progress';
  evidence: string;
}

interface Framework {
  code: string;
  title: string;
  score: number;
  last_audit?: string;
  next_audit?: string;
  status: 'compliant' | 'partial' | 'non_compliant' | 'in_progress';
  controls: ComplianceControl[];
}

function verdictToStatus(verdict: string): ComplianceControl['status'] {
  const v = String(verdict || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (v === 'PASS') return 'compliant';
  if (v === 'PARTIAL') return 'partial';
  if (v === 'FAIL') return 'non_compliant';
  return 'in_progress';
}

function mapFrameworks(payload: any): Framework[] {
  const fws = Array.isArray(payload?.frameworks) ? payload.frameworks : [];
  return fws.map((f: any): Framework => {
    const counts = f.counts ?? {};
    const pass = Number(counts.PASS ?? 0);
    const partial = Number(counts.PARTIAL ?? 0);
    const fail = Number(counts.FAIL ?? 0);
    const assessed = pass + partial + fail;
    const score = assessed > 0 ? Math.round((pass / assessed) * 100) : 0;
    const status: Framework['status'] = fail > 0 ? 'non_compliant' : partial > 0 ? 'partial' : assessed > 0 ? 'compliant' : 'in_progress';
    const controls: ComplianceControl[] = (Array.isArray(f.controls) ? f.controls : []).map((c: any) => ({
      id: String(c.controlId ?? c.id ?? ''),
      title: String(c.title ?? ''),
      category: String(c.category ?? 'General'),
      status: verdictToStatus(c.verdict),
      evidence: String(c.reason ?? (c.hasEvidence ? 'Evidence on file' : 'No evidence captured')),
    }));
    return {
      code: String(f.framework ?? ''),
      title: String(f.longName ?? f.name ?? f.framework ?? ''),
      score,
      last_audit: f.lastAssessedAt ?? f.last_assessed_at ?? undefined,
      next_audit: f.nextAuditAt ?? undefined,
      status,
      controls,
    };
  });
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; icon: React.ElementType; label: string }> = {
    compliant:   { color: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2, label: 'Compliant' },
    partial:     { color: 'bg-amber-50 text-amber-700 border-amber-200',       icon: AlertTriangle, label: 'Partial' },
    non_compliant: { color: 'bg-red-50 text-red-700 border-red-200',           icon: XCircle, label: 'Gap' },
    in_progress: { color: 'bg-blue-50 text-blue-700 border-blue-200',          icon: Clock, label: 'In Progress' },
  };
  const { color, icon: Icon, label } = map[status] ?? map.partial;
  return (
    <Badge className={cn('text-[10px] flex items-center gap-1', color)} aria-label={`Compliance status: ${label}`}>
      <Icon className="w-2.5 h-2.5" aria-hidden="true" /> {label}
    </Badge>
  );
}

// ─── Framework Panel ──────────────────────────────────────────────────────────

function FrameworkPanel({ framework }: { framework: Framework }) {
  const compliant = framework.controls.filter(c => c.status === 'compliant').length;
  const total = framework.controls.length;
  const gaps = framework.controls.filter(c => c.status === 'non_compliant').length;
  const partial = framework.controls.filter(c => c.status === 'partial').length;

  return (
    <div className="space-y-4">
      {/* Score */}
      <div className="flex items-center gap-4 p-4 rounded-lg bg-slate-50/50 border border-slate-200/40">
        <div className={cn('text-5xl font-black', framework.score >= 90 ? 'text-emerald-400' : framework.score >= 75 ? 'text-amber-400' : 'text-red-400')} aria-label={`Compliance score: ${framework.score}%`}>
          {framework.score}%
        </div>
        <div>
          <div className="text-sm font-semibold text-slate-800 mb-1">{framework.title}</div>
          <StatusBadge status={framework.status} />
          <div className="flex items-center gap-3 mt-2 text-[10px] text-slate-600">
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-emerald-400" aria-hidden="true" />{compliant} compliant</span>
            <span className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-amber-400" aria-hidden="true" />{partial} partial</span>
            <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" aria-hidden="true" />{gaps} gaps</span>
          </div>
          <div className="text-[10px] text-slate-700 mt-1 flex items-center gap-2">
            <span>Last: {framework.last_audit ? new Date(framework.last_audit).toLocaleDateString() : '—'}</span>
            <span>·</span>
            <span>Next: {framework.next_audit ? new Date(framework.next_audit).toLocaleDateString() : '—'}</span>
          </div>
        </div>
        <div className="ml-auto">
          <Progress value={framework.score} className="w-24 h-2" aria-label={`Overall compliance: ${framework.score}%`} />
        </div>
      </div>

      {/* Controls Table */}
      <div className="space-y-2">
        {framework.controls.map(control => (
          <div key={control.id} className="p-3 rounded-lg bg-slate-50/30 border border-slate-200/30 text-xs">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-slate-700 text-[10px]">{control.id}</span>
              <p className="font-medium text-slate-800 flex-1">{control.title}</p>
              <StatusBadge status={control.status} />
            </div>
            <div className="flex items-start gap-1.5">
              <ChevronRight className="w-3 h-3 text-slate-600 mt-0.5 flex-shrink-0" aria-hidden="true" />
              <p className="text-slate-600">{control.evidence}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

// ─── Live Evidence Hook ───────────────────────────────────────────────────────

function useLiveEvidence() {
  const token = getAuthToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  const auditLogs = useQuery({
    queryKey: ['compliance-audit-count'],
    queryFn: async () => {
      const r = await fetch(nv('compliance/health'), { headers });
      if (!r.ok) return null;
      return r.json();
    },
    retry: 0,
    staleTime: 60000,
  });

  const apiKeys = useQuery({
    queryKey: ['compliance-api-keys'],
    queryFn: async () => {
      const r = await fetch(nv('api-keys'), { headers });
      if (!r.ok) return null;
      return r.json();
    },
    retry: 0,
    staleTime: 60000,
  });

  const agents = useQuery({
    queryKey: ['compliance-agents'],
    queryFn: async () => {
      const r = await fetch(nv('agents?limit=200'), { headers });
      if (!r.ok) return null;
      return r.json();
    },
    retry: 0,
    staleTime: 300000,
  });

  return {
    auditLogsLive: !!auditLogs.data,
    apiKeysCount: apiKeys.data?.data?.length ?? null,
    agentCount: agents.data?.data?.length ?? agents.data?.data?.agents?.length ?? null,
    lastRefreshed: new Date().toLocaleTimeString(),
  };
}

export default function SuperAdminCompliance() {
  const token = getAuthToken();
  const { data: frameworksData, isLoading: fwLoading } = useQuery({
    queryKey: ['compliance-iso-frameworks'],
    queryFn: async () => {
      const r = await fetch(nv('compliance/iso'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) throw new Error(`compliance/iso ${r.status}`);
      return r.json();
    },
    retry: 0,
    staleTime: 60000,
  });

  const FRAMEWORKS: Framework[] = React.useMemo(() => mapFrameworks(frameworksData), [frameworksData]);
  const hasData = FRAMEWORKS.length > 0;
  const avgScore = hasData ? Math.round(FRAMEWORKS.reduce((s, f) => s + f.score, 0) / FRAMEWORKS.length) : 0;
  const totalControls = FRAMEWORKS.reduce((s, f) => s + f.controls.length, 0);
  const compliantControls = FRAMEWORKS.reduce((s, f) => s + f.controls.filter(c => c.status === 'compliant').length, 0);
  const partialControls = FRAMEWORKS.reduce((s, f) => s + f.controls.filter(c => c.status === 'partial').length, 0);
  const liveEvidence = useLiveEvidence();

  async function handleExport() {
    try {
      const r = await fetch(nv('compliance/iso/export'), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) return;
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `nyayavigya-compliance-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch { /* no-op */ }
  }

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="Compliance Dashboard">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-emerald-900">
              <ShieldCheck className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-[#152448]">Compliance Posture</h1>
            <Badge className="bg-red-50 text-red-700 border-red-200 text-xs">Super Admin</Badge>
          </div>
          <p className="text-sm text-slate-600">ISO 42001 · ISO 27001 · SOC 2 Type II — real-time compliance posture across all frameworks</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={handleExport} variant="outline" className="border-[#152448]/30 text-[#152448] hover:bg-[#152448]/5 text-xs" aria-label="Export compliance report">
            <Download className="w-4 h-4 mr-1" aria-hidden="true" /> Export Report
          </Button>
        </div>
      </div>

      {/* Live Evidence Banner */}
      <div className="flex items-center gap-3 flex-wrap mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
        <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
          <Activity className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" /> Live Evidence Signals:
        </span>
        <Badge className={`text-[10px] ${liveEvidence.auditLogsLive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-200 text-slate-600 border-slate-300'}`}>
          {liveEvidence.auditLogsLive ? '● Audit Hash Chain: Active' : '○ Audit Hash Chain: Checking…'}
        </Badge>
        {liveEvidence.apiKeysCount !== null && (
          <Badge className="text-[10px] bg-blue-50 text-blue-700 border-blue-200">
            SDK Keys: {liveEvidence.apiKeysCount} active
          </Badge>
        )}
        {liveEvidence.agentCount !== null && (
          <Badge className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
            Agents: {liveEvidence.agentCount} registered
          </Badge>
        )}
        <Badge className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">
          ISO 42001 · ISO 27001 · SOC 2 Type II
        </Badge>
        <span className="text-[10px] text-slate-600 ml-auto">Refreshed: {liveEvidence.lastRefreshed}</span>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Overall Score', value: `${avgScore}%`, icon: ShieldCheck, color: avgScore >= 90 ? 'text-emerald-400' : avgScore >= 75 ? 'text-amber-400' : 'text-red-400' },
          { label: 'Compliant Controls', value: `${compliantControls}/${totalControls}`, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Partial Controls', value: partialControls, icon: AlertTriangle, color: 'text-amber-400' },
          { label: 'Frameworks Active', value: FRAMEWORKS.length, icon: FileText, color: 'text-blue-400' },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="bg-white border-slate-200" aria-label={`${label}: ${value}`}>
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

      {/* Framework Tabs (live) */}
      {fwLoading && !hasData ? (
        <div className="p-8 text-center text-sm text-slate-500 bg-white rounded-lg border border-slate-200">Loading compliance posture…</div>
      ) : !hasData ? (
        <div className="p-8 text-center text-sm text-slate-500 bg-white rounded-lg border border-slate-200">
          No compliance evidence available yet. Run an evidence sweep (POST /api/jrx/compliance/iso/refresh) to populate framework posture.
        </div>
      ) : (
        <Tabs defaultValue={FRAMEWORKS[0]?.code}>
          <TabsList className="bg-slate-100 mb-4">
            {FRAMEWORKS.map((f) => (
              <TabsTrigger key={f.code} value={f.code} className="text-xs">{f.title.split('—')[0].trim()} · {f.score}%</TabsTrigger>
            ))}
          </TabsList>
          {FRAMEWORKS.map((f) => (
            <TabsContent key={f.code} value={f.code}><FrameworkPanel framework={f} /></TabsContent>
          ))}
        </Tabs>
      )}

      {/* Open Gaps Summary */}
      <Card className="bg-white border-slate-200 mt-4">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-slate-800 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" /> Open Remediation Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {FRAMEWORKS.flatMap(f => f.controls.filter(c => c.status === 'partial' || c.status === 'non_compliant').map(c => ({ ...c, framework: f.title.split('—')[0].trim() }))).map(c => (
              <div key={c.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-slate-700 text-[10px]">{c.id}</span>
                    <span className="font-medium text-slate-800">{c.title}</span>
                    <Badge className="text-[9px] bg-slate-200 text-slate-700 border-slate-300">{c.framework}</Badge>
                  </div>
                  <p className="text-slate-600 mt-0.5">{c.evidence}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
