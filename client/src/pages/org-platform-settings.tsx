/**
 * Org Admin: Per-Platform Settings
 * Configure module toggles, LLM config, jurisdictions, and feature flags
 * for each Jurexio platform registered to this organisation.
 * Jurexio Enterprise Platform 1.0.0 — NEVER bump version.
 */

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { PageLoading } from '@/components/ui/page-loading';
import {
  Globe, Settings, Save, RefreshCw, Zap, Brain, Bot,
  Shield, CheckCircle, AlertTriangle, ChevronDown, ChevronRight,
  MessageSquare, Workflow, Cpu, BookOpen, BarChart3,
  Mic, FileText, Users, Building2, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

import { NV_BASE, nv } from '@/lib/jrx-api-paths';
// ─── Types ───────────────────────────────────────────────────────────────────

interface ModulesEnabled {
  clawdbot:         boolean;
  openbot:          boolean;
  automateai:       boolean;
  twindesk:         boolean;
  skillshop:        boolean;
  nyayarag:         boolean;
  doc_intelligence: boolean;
  voice_ai:         boolean;
  hitl:             boolean;
  sdk_intelligence: boolean;
}

interface LlmRouting {
  primary:           string;
  fallback:          string;
  budget_mode:       string;
  monthly_cap_usd:   number;
}

interface RateLimits {
  requests_per_min: number;
  tokens_per_day:   number;
}

interface PlatformConfig {
  id: string;
  name: string;
  platform_type: string;
  tier: string;
  status: string;
  description?: string;
  jurisdictions: string[];
  modules_enabled: ModulesEnabled;
  llm_routing: LlmRouting;
  rate_limits: RateLimits;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MODULE_DISPLAY: Array<{ key: keyof ModulesEnabled; label: string; icon: typeof MessageSquare; description: string }> = [
  { key: 'clawdbot',         label: 'ClaWdBot™',           icon: MessageSquare, description: 'AI chatbot builder for client-facing automations' },
  { key: 'openbot',          label: 'OpenBot™',            icon: Globe,         description: 'Multi-channel communication automation' },
  { key: 'automateai',       label: 'AutomateAI™',         icon: Workflow,      description: 'DAG-based legal workflow automation engine' },
  { key: 'twindesk',         label: 'TwinDesk™',           icon: Cpu,           description: 'Digital twin personas — 5 per org' },
  { key: 'skillshop',        label: 'SkillShop™',          icon: BookOpen,      description: 'AI skills marketplace — 500+ pre-built skills' },
  { key: 'nyayarag',         label: 'NyayaRAG™',           icon: FileText,      description: 'Legal knowledge retrieval-augmented generation' },
  { key: 'doc_intelligence', label: 'DocIntelligence™',    icon: FileText,      description: 'AI document classification and analysis' },
  { key: 'voice_ai',         label: 'VoiceAI™',            icon: Mic,           description: 'TTS/STT via Sarvam.AI + ElevenLabs (47 languages)' },
  { key: 'hitl',             label: 'HITL™',               icon: Users,         description: 'Human-in-the-Loop escalation and oversight' },
  { key: 'sdk_intelligence', label: 'SDK Intelligence™',   icon: Brain,         description: 'E1–E10 analytics endpoints for your org' },
];

const LLM_MODELS = [
  'claude-opus-4', 'claude-sonnet-4', 'gpt-4.1', 'gpt-4o',
  'gemini-2.0-flash', 'gemini-1.5-pro', 'llama-3.1-70b', 'llama-3.1-405b',
];

const BUDGET_MODES = [
  { value: 'aggressive',  label: 'Aggressive — Always best model' },
  { value: 'balanced',    label: 'Balanced — Quality + cost balance' },
  { value: 'conservative',label: 'Conservative — Cost-first routing' },
  { value: 'budget',      label: 'Budget — Cheapest available model' },
];

const ALL_JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'GCC', 'SG'];

const STATUS_COLORS: Record<string, string> = {
  active:      'bg-emerald-500/20 text-emerald-300 border-emerald-500/30',
  maintenance: 'bg-amber-500/20 text-amber-300 border-amber-500/30',
  disabled:    'bg-red-500/20 text-red-300 border-red-500/30',
};

const DEFAULT_MODULES: ModulesEnabled = {
  clawdbot: true,
  openbot: false,
  automateai: true,
  twindesk: false,
  skillshop: true,
  nyayarag: true,
  doc_intelligence: true,
  voice_ai: false,
  hitl: true,
  sdk_intelligence: true,
};

function mapRegistryPlatform(row: Record<string, unknown>): PlatformConfig {
  const llm = (row.llm_config ?? {}) as Record<string, unknown>;
  const limits = (row.rate_limits_config ?? {}) as Record<string, unknown>;
  const modules = { ...DEFAULT_MODULES, ...((row.modules_enabled ?? {}) as Partial<ModulesEnabled>) };
  const liveId = String(row.id ?? '');
  return {
    id: liveId,
    name: String(row.display_name ?? row.name ?? liveId),
    platform_type: String(row.platform_type ?? 'custom'),
    tier: String(row.tier ?? 'pro'),
    status: row.is_active === false ? 'disabled' : 'active',
    description: row.description ? String(row.description) : undefined,
    jurisdictions: Array.isArray(row.jurisdictions) && (row.jurisdictions as string[]).length
      ? row.jurisdictions as string[]
      : [String(row.jurisdiction ?? 'IN')],
    modules_enabled: modules,
    llm_routing: {
      primary: String(llm.primary ?? 'claude-sonnet-4'),
      fallback: String(llm.fallback ?? 'gpt-4o'),
      budget_mode: String(llm.budget_mode ?? 'balanced'),
      monthly_cap_usd: Number(llm.monthly_cap_usd ?? 500),
    },
    rate_limits: {
      requests_per_min: Number(limits.requests_per_min ?? 120),
      tokens_per_day: Number(limits.tokens_per_day ?? 2_000_000),
    },
  };
}

async function fetchOrgPlatforms(): Promise<PlatformConfig[]> {
  const raw = await apiRequest('GET', nv('platforms'));
  const payload = raw as { platforms?: Record<string, unknown>[]; data?: PlatformConfig[] };
  const rows = payload.platforms ?? payload.data ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map(r => mapRegistryPlatform(r as Record<string, unknown>));
}

async function savePlatformConfig(cfg: PlatformConfig): Promise<void> {
  const id = cfg.id;
  const headers = { 'Content-Type': 'application/json' };
  await apiRequest('PATCH', `${NV_BASE}platforms/${id}/modules`, cfg.modules_enabled);
  await apiRequest('PATCH', `${NV_BASE}platforms/${id}/llm-config`, {
    primary: cfg.llm_routing.primary,
    fallback: cfg.llm_routing.fallback,
    budget_mode: cfg.llm_routing.budget_mode,
    monthly_cap_usd: cfg.llm_routing.monthly_cap_usd,
    alert_threshold_pct: 80,
  });
  await apiRequest('PATCH', `${NV_BASE}platforms/${id}/rate-limits`, cfg.rate_limits);
}

// ─── PlatformCard ─────────────────────────────────────────────────────────────

interface PlatformCardProps {
  platform: PlatformConfig;
  onSave: (updated: PlatformConfig) => void;
  saving: boolean;
}

function PlatformCard({ platform, onSave, saving }: PlatformCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [cfg, setCfg] = useState<PlatformConfig>(platform);

  useEffect(() => { setCfg(platform); }, [platform]);

  const setModule = (key: keyof ModulesEnabled, val: boolean) =>
    setCfg(c => ({ ...c, modules_enabled: { ...c.modules_enabled, [key]: val } }));

  const setLlm = (key: keyof LlmRouting, val: string | number) =>
    setCfg(c => ({ ...c, llm_routing: { ...c.llm_routing, [key]: val } }));

  const setRate = (key: keyof RateLimits, val: number) =>
    setCfg(c => ({ ...c, rate_limits: { ...c.rate_limits, [key]: val } }));

  const toggleJurisdiction = (j: string) =>
    setCfg(c => ({
      ...c,
      jurisdictions: c.jurisdictions.includes(j)
        ? c.jurisdictions.filter(x => x !== j)
        : [...c.jurisdictions, j],
    }));

  const activeModules = Object.values(cfg.modules_enabled).filter(Boolean).length;

  return (
    <Card className="bg-white border-slate-200">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-100/30 transition-colors"
        onClick={() => setExpanded(e => !e)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && setExpanded(e => !e)}
      >
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#152448]/60 to-[#1a4a9a]/40 flex items-center justify-center flex-shrink-0">
          <Globe className="w-4 h-4 text-[#C7B15B]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-[#152448]">{cfg.name}</h3>
            <Badge className={cn('text-[9px] border', STATUS_COLORS[cfg.status] ?? STATUS_COLORS['active'])}>{cfg.status}</Badge>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-700">
            <span>{cfg.tier} tier</span>
            <span>{activeModules}/10 modules active</span>
            <span>{cfg.jurisdictions.join(', ')}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {expanded && (
            <Button
              size="sm"
              onClick={e => { e.stopPropagation(); onSave(cfg); }}
              disabled={saving}
              className="bg-[#152448] hover:bg-[#0d3580] text-white text-xs h-7"
            >
              {saving ? <><RefreshCw className="w-3 h-3 mr-1 animate-spin" />Saving</> : <><Save className="w-3 h-3 mr-1" />Save</>}
            </Button>
          )}
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-700" /> : <ChevronRight className="w-4 h-4 text-slate-700" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-200/60">
          <Tabs defaultValue="modules" className="p-4">
            <TabsList className="bg-slate-950 border border-slate-200 mb-4">
              <TabsTrigger value="modules" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs">Modules</TabsTrigger>
              <TabsTrigger value="llm" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs">LLM Config</TabsTrigger>
              <TabsTrigger value="jurisdictions" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs">Jurisdictions</TabsTrigger>
              <TabsTrigger value="limits" className="data-[state=active]:bg-[#152448] data-[state=active]:text-white text-xs">Rate Limits</TabsTrigger>
            </TabsList>

            {/* Modules Tab */}
            <TabsContent value="modules">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {MODULE_DISPLAY.map(({ key, label, icon: Icon, description }) => (
                  <div key={key} className={cn(
                    'flex items-start gap-3 p-3 rounded-lg border transition-colors',
                    cfg.modules_enabled[key] ? 'bg-[#152448]/10 border-[#152448]/30' : 'bg-slate-950/50 border-slate-200',
                  )}>
                    <div className={cn('w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 mt-0.5', cfg.modules_enabled[key] ? 'bg-[#152448]/40' : 'bg-slate-100')}>
                      <Icon className={cn('w-3.5 h-3.5', cfg.modules_enabled[key] ? 'text-[#C7B15B]' : 'text-slate-700')} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-[#152448]">{label}</div>
                      <div className="text-[10px] text-slate-700 mt-0.5 leading-relaxed">{description}</div>
                    </div>
                    <Switch
                      checked={cfg.modules_enabled[key]}
                      onCheckedChange={v => setModule(key, v)}
                      aria-label={`Toggle ${label}`}
                      className="flex-shrink-0 mt-0.5"
                    />
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* LLM Tab */}
            <TabsContent value="llm" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-600 mb-1.5 block">Primary LLM</Label>
                  <Select value={cfg.llm_routing.primary} onValueChange={v => setLlm('primary', v)}>
                    <SelectTrigger className="bg-slate-100 border-slate-200 text-[#152448] text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {LLM_MODELS.map(m => <SelectItem key={m} value={m} className="text-xs text-slate-700">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1.5 block">Fallback LLM</Label>
                  <Select value={cfg.llm_routing.fallback} onValueChange={v => setLlm('fallback', v)}>
                    <SelectTrigger className="bg-slate-100 border-slate-200 text-[#152448] text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {LLM_MODELS.map(m => <SelectItem key={m} value={m} className="text-xs text-slate-700">{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1.5 block">Budget Mode</Label>
                  <Select value={cfg.llm_routing.budget_mode} onValueChange={v => setLlm('budget_mode', v)}>
                    <SelectTrigger className="bg-slate-100 border-slate-200 text-[#152448] text-xs h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {BUDGET_MODES.map(m => <SelectItem key={m.value} value={m.value} className="text-xs text-slate-700">{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1.5 block">Monthly Cap (USD)</Label>
                  <Input
                    type="number"
                    value={cfg.llm_routing.monthly_cap_usd}
                    onChange={e => setLlm('monthly_cap_usd', Number(e.target.value))}
                    min={0}
                    className="bg-slate-100 border-slate-200 text-[#152448] text-xs h-8"
                  />
                </div>
              </div>
              <Alert className="bg-amber-500/10 border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <AlertDescription className="text-xs text-amber-300 ml-2">
                  Changes to LLM routing take effect within 60 seconds. Current active sessions use the previously configured model.
                </AlertDescription>
              </Alert>
            </TabsContent>

            {/* Jurisdictions Tab */}
            <TabsContent value="jurisdictions">
              <div className="space-y-3">
                <p className="text-xs text-slate-700">Select which jurisdictions this platform's AI features should be optimised for. Affects statute loading, LRM routing, and compliance checks.</p>
                <div className="flex flex-wrap gap-2">
                  {ALL_JURISDICTIONS.map(j => {
                    const active = cfg.jurisdictions.includes(j);
                    return (
                      <button
                        key={j}
                        onClick={() => toggleJurisdiction(j)}
                        aria-pressed={active}
                        className={cn(
                          'px-4 py-2 rounded-lg border text-sm font-semibold transition-all',
                          active
                            ? 'bg-[#152448] border-[#152448]/60 text-white shadow-md'
                            : 'bg-slate-950 border-slate-200 text-slate-600 hover:text-white hover:border-slate-300',
                        )}
                      >
                        {j}
                        {active && <CheckCircle className="inline-block w-3 h-3 ml-1.5 text-[#C7B15B]" />}
                      </button>
                    );
                  })}
                </div>
                {cfg.jurisdictions.length === 0 && (
                  <Alert className="bg-red-500/10 border-red-500/20">
                    <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    <AlertDescription className="text-xs text-red-300 ml-2">
                      At least one jurisdiction must be selected for the platform to function.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </TabsContent>

            {/* Rate Limits Tab */}
            <TabsContent value="limits" className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-slate-600 mb-1.5 block">Requests per Minute</Label>
                  <Input
                    type="number"
                    value={cfg.rate_limits.requests_per_min}
                    onChange={e => setRate('requests_per_min', Number(e.target.value))}
                    min={1} max={10000}
                    className="bg-slate-100 border-slate-200 text-[#152448] text-xs h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1.5 block">Tokens per Day</Label>
                  <Input
                    type="number"
                    value={cfg.rate_limits.tokens_per_day}
                    onChange={e => setRate('tokens_per_day', Number(e.target.value))}
                    min={1000}
                    className="bg-slate-100 border-slate-200 text-[#152448] text-xs h-8"
                  />
                </div>
              </div>
              <Alert className="bg-blue-500/10 border-blue-500/20">
                <Shield className="w-3.5 h-3.5 text-blue-400" />
                <AlertDescription className="text-xs text-blue-300 ml-2">
                  Rate limits apply per platform per API key. Exceeding limits returns HTTP 429 with a Retry-After header. Contact support to increase enterprise limits.
                </AlertDescription>
              </Alert>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Card>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OrgPlatformSettings() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: platforms = [], isLoading, error, refetch } = useQuery<PlatformConfig[]>({
    queryKey: [nv('platforms'), 'org-settings'],
    queryFn: fetchOrgPlatforms,
    staleTime: 60000,
  });

  const saveMutation = useMutation({
    mutationFn: (cfg: PlatformConfig) => savePlatformConfig(cfg),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [nv('platforms')] });
      toast({ title: 'Platform configuration saved' });
    },
    onError: () => toast({ title: 'Failed to save configuration', variant: 'destructive' }),
  });

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E]">
      {/* Page Header */}
      <div className="border-b border-slate-200/60 px-6 py-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#152448] to-[#1a4a9a] flex items-center justify-center">
                <Settings className="w-4 h-4 text-[#C7B15B]" />
              </div>
              <h1 className="text-xl font-bold text-[#152448]">Platform Settings</h1>
              <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">Org Admin</Badge>
            </div>
            <p className="text-sm text-slate-700">
              Configure modules, LLM routing, jurisdictions, and rate limits for each Jurexio platform in your organisation
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}
            className="border-slate-200 text-slate-700 hover:text-white">
            <RefreshCw className={cn('w-3.5 h-3.5 mr-1.5', isLoading && 'animate-spin')} />Refresh
          </Button>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Legend */}
        <div className="flex items-center gap-4 text-xs text-slate-700 flex-wrap">
          <span className="font-medium text-slate-600">Platform Status:</span>
          {Object.entries(STATUS_COLORS).map(([s, cls]) => (
            <span key={s} className={cn('px-2 py-0.5 rounded-full border text-[10px] font-medium', cls)}>{s}</span>
          ))}
        </div>

        {isLoading ? (
          <PageLoading rows={5} label="Loading platform configurations" />
        ) : error ? (
          <NyvEmptyState
            icon={AlertTriangle}
            title="Platform data unavailable"
            description={`Could not load platform configurations. Ensure the ${NV_BASE}platforms endpoint is accessible and your session is authenticated.`}
            cta={{ label: 'Retry', onClick: () => refetch() }}
            variant="card"
          />
        ) : platforms.length === 0 ? (
          <NyvEmptyState
            icon={Globe}
            title="No platforms configured yet"
            description="Your organisation hasn't registered any Jurexio platforms yet. Use the SDK Onboarding Wizard to register your first platform and generate API keys."
            cta={{ label: 'Go to SDK Onboarding', onClick: () => window.location.href = '/console/sdk/onboarding' }}
            variant="card"
          />
        ) : (
          <div className="space-y-3">
            {platforms.map(p => (
              <PlatformCard
                key={p.id}
                platform={p}
                onSave={cfg => saveMutation.mutate(cfg)}
                saving={saveMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
