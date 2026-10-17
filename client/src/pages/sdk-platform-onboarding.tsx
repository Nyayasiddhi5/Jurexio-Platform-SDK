import { getAuthToken } from '@/lib/jrx-auth-token';
import { NV_BASE, nv } from '@/lib/jrx-api-paths';
/**
 * Jurexio Enterprise Platform SDK Platform Onboarding Wizard
 * 5-step guide for new Jurexio platform integration.
 * Step 1: Identity → Step 2: Modules → Step 3: Agents → Step 4: LLM+Rates → Step 5: Key Generation
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import {
  ChevronRight, ChevronLeft, CheckCircle2, Globe, Layers,
  Bot, Cpu, Key, Code2, Sparkles, Copy, AlertTriangle,
  Zap, Shield, Building2, Users,
} from 'lucide-react';

function cn(...classes: (string | undefined | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Step Types ────────────────────────────────────────────────────────────────

interface IdentityData {
  name: string;
  platform_type: string;
  tier: string;
  environment: string;
  contact_email: string;
  jurisdictions: string[];
}

interface ModulesData {
  clawdbot: boolean; openbot: boolean; automateai: boolean;
  twindesk: boolean; skillshop: boolean; nyayarag: boolean;
  doc_intelligence: boolean; voice_ai: boolean; hitl: boolean;
  sdk_intelligence: boolean;
}

interface LlmData {
  primary: string; fallback: string; budget_mode: string;
  monthly_cap_usd: string; alert_threshold_pct: string;
  requests_per_min: string; requests_per_hour: string;
  tokens_per_day: string;
}

// ─── Wizard Config ────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, title: 'Platform Identity', icon: Building2 },
  { id: 2, title: 'Module Selection', icon: Layers },
  { id: 3, title: 'Agent Access', icon: Bot },
  { id: 4, title: 'LLM & Rate Limits', icon: Cpu },
  { id: 5, title: 'Key Generation', icon: Key },
];

const MODULE_LIST = [
  { key: 'nyayarag', label: 'NyayaRAG™', desc: 'Legal research & retrieval-augmented generation. Recommended for all platforms.', tier: 'solo', default: true },
  { key: 'doc_intelligence', label: 'DocIntelligence™', desc: 'Document classification, extraction, and OCR pipeline.', tier: 'solo', default: true },
  { key: 'sdk_intelligence', label: 'SDK Intelligence™', desc: 'E1–E10 AI intelligence endpoints for dashboard insights and portfolio risk.', tier: 'solo', default: true },
  { key: 'clawdbot', label: 'ClaWdBot™', desc: 'Legal chatbot builder — no-code, HITL-enabled, WhatsApp-ready.', tier: 'pro', default: false },
  { key: 'openbot', label: 'OpenBot™', desc: 'Multi-channel studio — Slack, Teams, Telegram, Email.', tier: 'pro', default: false },
  { key: 'automateai', label: 'AutomateAI™', desc: 'Visual workflow automation with 8 AI decision gate types.', tier: 'pro', default: false },
  { key: 'hitl', label: 'HITL™', desc: 'Human-in-the-Loop escalation — mandatory for certain ROMA L5 patterns.', tier: 'pro', default: false },
  { key: 'twindesk', label: 'TwinDesk™', desc: 'Digital twin personas — up to 5 per org, Monte Carlo simulation.', tier: 'enterprise', default: false },
  { key: 'skillshop', label: 'SkillShop™', desc: 'Legal AI skills marketplace — buy, build, publish custom skills.', tier: 'enterprise', default: false },
  { key: 'voice_ai', label: 'VoiceAI™', desc: 'TTS/STT voice module — Sarvam (47 Indian languages) + ElevenLabs.', tier: 'pro', default: false },
];

const JURISDICTIONS = ['IN', 'UK', 'US', 'EU', 'GCC', 'SG'];

// ─── Step 1 — Identity ────────────────────────────────────────────────────────

function StepIdentity({ data, onChange }: { data: IdentityData; onChange: (d: IdentityData) => void }) {
  const toggleJurisdiction = (j: string) => {
    const next = data.jurisdictions.includes(j)
      ? data.jurisdictions.filter(x => x !== j)
      : [...data.jurisdictions, j];
    onChange({ ...data, jurisdictions: next });
  };

  return (
    <div className="space-y-4" aria-label="Step 1: Platform Identity">
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="wizard-name">Platform Name *</Label>
          <Input id="wizard-name" value={data.name} onChange={e => onChange({ ...data, name: e.target.value })} placeholder="e.g. Jurexio Professional" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Platform name" />
        </div>
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="wizard-contact">Technical Contact Email</Label>
          <Input id="wizard-contact" type="email" value={data.contact_email} onChange={e => onChange({ ...data, contact_email: e.target.value })} placeholder="dev@yourplatform.com" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Contact email" />
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="wizard-type">Platform Type</Label>
          <Select value={data.platform_type} onValueChange={v => onChange({ ...data, platform_type: v })}>
            <SelectTrigger id="wizard-type" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select platform type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              <SelectItem value="nyayamitra">Nyayamitra™</SelectItem>
              <SelectItem value="nyayasiddhi-professional">Jurexio Professional™</SelectItem>
              <SelectItem value="nyayasiddhi-institution">Jurexio Institution™</SelectItem>
              <SelectItem value="nyayasiddhi-ministry">Jurexio Ministry™</SelectItem>
              <SelectItem value="nyayasiddhi-academy">Jurexio Academy™</SelectItem>
              <SelectItem value="custom">Custom Platform</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="wizard-tier">Tier</Label>
          <Select value={data.tier} onValueChange={v => onChange({ ...data, tier: v })}>
            <SelectTrigger id="wizard-tier" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select tier">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              <SelectItem value="solo">Solo</SelectItem>
              <SelectItem value="plus">Plus</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
              <SelectItem value="government">Government</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="wizard-env">Environment</Label>
          <Select value={data.environment} onValueChange={v => onChange({ ...data, environment: v })}>
            <SelectTrigger id="wizard-env" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select environment">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              <SelectItem value="sandbox">Sandbox (development)</SelectItem>
              <SelectItem value="production">Production (live)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label className="text-slate-700 text-xs mb-2 block">Active Jurisdictions</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Jurisdiction selection">
          {JURISDICTIONS.map(j => (
            <button
              key={j}
              type="button"
              onClick={() => toggleJurisdiction(j)}
              className={cn('px-3 py-1.5 rounded-lg text-sm font-medium border transition-all', data.jurisdictions.includes(j) ? 'bg-[#152448] border-[#152448] text-white' : 'bg-slate-100 border-slate-200 text-slate-600 hover:border-slate-500')}
              aria-pressed={data.jurisdictions.includes(j)}
              aria-label={`Toggle jurisdiction ${j}`}
            >
              {j}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 2 — Modules ─────────────────────────────────────────────────────────

function StepModules({ data, onChange, tier }: { data: ModulesData; onChange: (d: ModulesData) => void; tier: string }) {
  const tierLevel: Record<string, number> = { solo: 1, plus: 2, pro: 3, enterprise: 4, government: 4 };
  const moduleTierLevel: Record<string, number> = { solo: 1, pro: 3, enterprise: 4 };

  return (
    <div className="space-y-2" aria-label="Step 2: Module Selection">
      {MODULE_LIST.map(m => {
        const enabled = data[m.key as keyof ModulesData] ?? false;
        const accessible = (tierLevel[tier] ?? 1) >= (moduleTierLevel[m.tier] ?? 1);
        return (
          <div key={m.key} className={cn('flex items-start gap-3 p-3 rounded-lg border transition-all', enabled ? 'border-[#152448]/60 bg-[#152448]/10' : 'border-slate-200/40 bg-slate-100/30', !accessible && 'opacity-40')}>
            <Switch
              checked={enabled}
              onCheckedChange={v => accessible && onChange({ ...data, [m.key]: v })}
              disabled={!accessible}
              aria-label={`Toggle ${m.label}: currently ${enabled ? 'enabled' : 'disabled'}`}
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-white">{m.label}</p>
                <Badge className={cn('text-[9px]', m.tier === 'solo' ? 'bg-slate-500/20 text-slate-700' : m.tier === 'pro' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300')} aria-label={`Requires ${m.tier} tier`}>{m.tier}+</Badge>
                {m.default && <Badge className="text-[9px] bg-emerald-500/20 text-emerald-300">Recommended</Badge>}
                {!accessible && <Badge className="text-[9px] bg-red-500/20 text-red-300">Upgrade needed</Badge>}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">{m.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 3 — Agents ─────────────────────────────────────────────────────────

function StepAgents({ agentsAllowed, onChange }: { agentsAllowed: string[]; onChange: (a: string[]) => void }) {
  return (
    <div className="space-y-4" aria-label="Step 3: Agent Access">
      <div className="p-4 rounded-lg bg-slate-100/50 border border-slate-200/40 text-xs text-slate-600">
        <div className="flex items-start gap-2">
          <Bot className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium text-slate-700 mb-1">Agent Access Control</p>
            <p>By default, the full active ROMA L5 runtime registry is available. You can restrict to a specific subset using agent IDs. Leave as <code className="bg-white px-1 rounded">*</code> for unrestricted access (recommended for most platforms).</p>
          </div>
        </div>
      </div>
      <div className="space-y-3">
        {[
          { label: 'All Agents (Recommended)', value: ['*'], desc: 'Full ROMA L5 runtime registry capability' },
          { label: 'Research & Document Only', value: ['legal-researcher-v5', 'doc-classifier-l5', 'nyayarag-retriever'], desc: '3 core agents — ideal for citizen platforms' },
          { label: 'Full Professional Set', value: ['legal-researcher-v5', 'doc-classifier-l5', 'nyayarag-retriever', 'contract-drafter-pro', 'compliance-checker-l5', 'risk-assessor-v5'], desc: '6 agents — law firm focused' },
        ].map(opt => (
          <button
            key={opt.label}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn('w-full text-left p-3 rounded-lg border transition-all', JSON.stringify(agentsAllowed) === JSON.stringify(opt.value) ? 'border-[#152448] bg-[#152448]/10 text-[#152448]' : 'border-slate-200/50 bg-slate-100/30 text-slate-700 hover:border-slate-300')}
            aria-pressed={JSON.stringify(agentsAllowed) === JSON.stringify(opt.value)}
            aria-label={opt.label}
          >
            <p className="font-medium text-sm">{opt.label}</p>
            <p className="text-xs text-slate-700 mt-0.5">{opt.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Step 4 — LLM + Rate Limits ──────────────────────────────────────────────

function StepLlm({ data, onChange }: { data: LlmData; onChange: (d: LlmData) => void }) {
  return (
    <div className="space-y-4" aria-label="Step 4: LLM Configuration and Rate Limits">
      <div className="grid md:grid-cols-3 gap-3">
        <div className="md:col-span-1">
          <Label className="text-slate-700 text-xs" htmlFor="llm-primary">Primary Model</Label>
          <Select value={data.primary} onValueChange={v => onChange({ ...data, primary: v })}>
            <SelectTrigger id="llm-primary" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select primary LLM model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash (minimal)</SelectItem>
              <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5 (balanced)</SelectItem>
              <SelectItem value="gpt-4.1">GPT-4.1 (balanced)</SelectItem>
              <SelectItem value="claude-opus-4-5">Claude Opus 4.5 (premium)</SelectItem>
              <SelectItem value="o3">OpenAI o3 (premium)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <Label className="text-slate-700 text-xs" htmlFor="llm-fallback">Fallback Model</Label>
          <Select value={data.fallback} onValueChange={v => onChange({ ...data, fallback: v })}>
            <SelectTrigger id="llm-fallback" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select fallback LLM model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              <SelectItem value="gpt-4.1-nano">GPT-4.1 Nano</SelectItem>
              <SelectItem value="gpt-4.1">GPT-4.1</SelectItem>
              <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
              <SelectItem value="claude-sonnet-4-5">Claude Sonnet 4.5</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="md:col-span-1">
          <Label className="text-slate-700 text-xs" htmlFor="llm-budget-mode">Budget Mode</Label>
          <Select value={data.budget_mode} onValueChange={v => onChange({ ...data, budget_mode: v })}>
            <SelectTrigger id="llm-budget-mode" className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Select budget mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-slate-100 border-slate-200">
              <SelectItem value="minimal">Minimal (Flash/Nano only)</SelectItem>
              <SelectItem value="balanced">Balanced (Sonnet/GPT-4 class)</SelectItem>
              <SelectItem value="premium">Premium (Opus/o3)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="llm-monthly-cap">Monthly LLM Budget Cap (USD)</Label>
          <Input id="llm-monthly-cap" type="number" value={data.monthly_cap_usd} onChange={e => onChange({ ...data, monthly_cap_usd: e.target.value })} className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Monthly LLM budget cap in USD" />
        </div>
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="llm-alert-pct">Alert Threshold (%)</Label>
          <Input id="llm-alert-pct" type="number" min="1" max="100" value={data.alert_threshold_pct} onChange={e => onChange({ ...data, alert_threshold_pct: e.target.value })} className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Alert threshold percentage" />
        </div>
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="rate-rpm">Requests / Minute</Label>
          <Input id="rate-rpm" type="number" value={data.requests_per_min} onChange={e => onChange({ ...data, requests_per_min: e.target.value })} className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Requests per minute" />
        </div>
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="rate-rph">Requests / Hour</Label>
          <Input id="rate-rph" type="number" value={data.requests_per_hour} onChange={e => onChange({ ...data, requests_per_hour: e.target.value })} className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Requests per hour" />
        </div>
        <div>
          <Label className="text-slate-700 text-xs" htmlFor="rate-tpd">Tokens / Day</Label>
          <Input id="rate-tpd" type="number" value={data.tokens_per_day} onChange={e => onChange({ ...data, tokens_per_day: e.target.value })} className="bg-slate-100 border-slate-200 text-[#152448] mt-1" aria-label="Tokens per day" />
        </div>
      </div>
    </div>
  );
}

// ─── Step 5 — Key Generation ──────────────────────────────────────────────────

function StepKeys({ appId, platformName }: { appId: string | null; platformName: string }) {
  const { toast } = useToast();
  const [generatedKeys, setGeneratedKeys] = useState<Record<string, string>>({});
  const [copiedKeys, setCopiedKeys] = useState<Record<string, boolean>>({});

  const genMutation = useMutation({
    mutationFn: async (keyType: string) => {
      if (!appId) throw new Error('Platform not yet registered');
      const token = getAuthToken();
      const resp = await fetch(`${NV_BASE}sdk/keys/${appId}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ key_type: keyType, name: `${platformName} ${keyType}` }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? 'Failed'); }
      return resp.json();
    },
    onSuccess: (data, keyType) => {
      setGeneratedKeys(prev => ({ ...prev, [keyType]: data.raw_key }));
      toast({ title: 'Key generated — copy it now!' });
    },
    onError: (err: Error) => toast({ title: 'Key generation failed', description: err.message, variant: 'destructive' }),
  });

  const copyKey = async (keyType: string) => {
    const key = generatedKeys[keyType];
    if (!key) return;
    await navigator.clipboard.writeText(key);
    setCopiedKeys(prev => ({ ...prev, [keyType]: true }));
    setTimeout(() => setCopiedKeys(prev => ({ ...prev, [keyType]: false })), 2000);
    toast({ title: 'Copied!', description: 'Store this key securely — it will not be shown again.' });
  };

  const keyTypes = [
    { type: 'sdk_api_key', label: 'SDK API Key', desc: 'Primary authentication for all backend API calls', envVar: 'JRX_SDK_API_KEY', color: 'border-blue-500/40 bg-blue-500/5' },
    { type: 'webhook_secret', label: 'Webhook Secret', desc: 'HMAC signing for incoming webhooks', envVar: 'JRX_WEBHOOK_SECRET', color: 'border-amber-500/40 bg-amber-500/5' },
    { type: 'publishable_key', label: 'Publishable Key', desc: 'Safe for frontend use (limited scopes)', envVar: 'NEXT_PUBLIC_JRX_PK', color: 'border-emerald-500/40 bg-emerald-500/5' },
    { type: 'signing_key', label: 'Signing Key', desc: 'Request signing — NEVER expose client-side', envVar: 'JRX_SIGNING_KEY', color: 'border-purple-500/40 bg-purple-500/5' },
  ];

  return (
    <div className="space-y-3" aria-label="Step 5: Key Generation">
      {!appId && (
        <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-center gap-2" role="alert">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
          Platform must be registered in the previous steps before generating keys.
        </div>
      )}
      {keyTypes.map(({ type, label, desc, envVar, color }) => {
        const key = generatedKeys[type];
        const isCopied = copiedKeys[type];
        return (
          <div key={type} className={cn('p-3 rounded-lg border text-xs', color)}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <p className="font-medium text-slate-800">{label}</p>
                <p className="text-slate-600">{desc}</p>
                <code className="text-[10px] text-slate-700 mt-0.5">env: {envVar}</code>
              </div>
              {!key ? (
                <Button
                  size="sm"
                  className="bg-[#152448] hover:bg-[#0a3580] text-white text-xs h-7"
                  onClick={() => genMutation.mutate(type)}
                  disabled={!appId || genMutation.isPending}
                  aria-label={`Generate ${label}`}
                >
                  <Key className="w-3 h-3 mr-1" aria-hidden="true" /> Generate
                </Button>
              ) : (
                <div className="flex items-center gap-1">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  <Button size="sm" variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-200 text-xs h-7" onClick={() => copyKey(type)} aria-label={`Copy ${label}`}>
                    {isCopied ? <CheckCircle2 className="w-3 h-3 text-emerald-400" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                  </Button>
                </div>
              )}
            </div>
            {key && (
              <div className="p-2 rounded bg-black/40 border border-slate-200/40 font-mono text-amber-300 break-all" aria-label={`${label} value`}>{key}</div>
            )}
          </div>
        );
      })}
      {Object.keys(generatedKeys).length === 4 && (
        <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2" role="status">
          <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="font-medium mb-1">All 4 keys generated successfully!</p>
            <p>Copy all keys into your environment secrets before closing this window. Initialize your SDK:</p>
            <pre className="bg-black/40 p-2 rounded mt-1.5 text-[10px] text-slate-700 overflow-x-auto">{`const nyv = new JurexioSDK({
  apiKey: process.env.JRX_SDK_API_KEY,
  platformId: '${platformName.toLowerCase().replace(/\s+/g, '-')}',
  jurisdiction: 'IN',
});\nawait nyv.initialize();`}</pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Wizard ──────────────────────────────────────────────────────────────

export default function SdkPlatformOnboarding() {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [registeredAppId, setRegisteredAppId] = useState<string | null>(null);

  const [identity, setIdentity] = useState<IdentityData>({ name: '', platform_type: 'nyayasiddhi-professional', tier: 'pro', environment: 'sandbox', contact_email: '', jurisdictions: ['IN'] });
  const [modules, setModules] = useState<ModulesData>({ clawdbot: false, openbot: false, automateai: false, twindesk: false, skillshop: false, nyayarag: true, doc_intelligence: true, voice_ai: false, hitl: false, sdk_intelligence: true });
  const [agentsAllowed, setAgentsAllowed] = useState<string[]>(['*']);
  const [llm, setLlm] = useState<LlmData>({ primary: 'claude-sonnet-4-5', fallback: 'gpt-4.1', budget_mode: 'balanced', monthly_cap_usd: '1000', alert_threshold_pct: '80', requests_per_min: '60', requests_per_hour: '2000', tokens_per_day: '5000000' });

  const registerMutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const resp = await fetch(nv('platforms'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          ...identity,
          modules_enabled: modules,
          agents_allowed: agentsAllowed,
          llm_config: { primary: llm.primary, fallback: llm.fallback, budget_mode: llm.budget_mode, monthly_cap_usd: parseFloat(llm.monthly_cap_usd), alert_threshold_pct: parseFloat(llm.alert_threshold_pct) },
          rate_limits_config: { requests_per_min: parseInt(llm.requests_per_min, 10), requests_per_hour: parseInt(llm.requests_per_hour, 10), requests_per_day: 20000, tokens_per_day: parseInt(llm.tokens_per_day, 10), max_concurrent: 20 },
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.error ?? 'Registration failed'); }
      return resp.json();
    },
    onSuccess: (data) => {
      setRegisteredAppId(data.id);
      setStep(5);
      toast({ title: 'Platform registered!', description: 'Now generate your SDK keys.' });
    },
    onError: (err: Error) => toast({ title: 'Registration failed', description: err.message, variant: 'destructive' }),
  });

  const canProceed = step === 1 ? !!identity.name : true;

  const handleNext = () => {
    if (step === 4) {
      registerMutation.mutate();
    } else if (step < 5) {
      setStep(s => s + 1);
    }
  };

  const completedSteps = registeredAppId ? 5 : step - 1;
  const progressPct = (completedSteps / 5) * 100;

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-6" aria-label="SDK Platform Onboarding Wizard">
      {/* Header */}
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <div className="p-2 rounded-lg bg-gradient-to-br from-[#152448] to-blue-900">
            <Zap className="w-5 h-5 text-[#C7B15B]" aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold text-[#152448]">Platform Onboarding Wizard</h1>
          <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/30 text-xs">SDK Integration</Badge>
        </div>
        <p className="text-sm text-slate-600 mb-6">5 steps to connect your Jurexio platform to the Jurexio AI backbone</p>

        {/* Step Indicators */}
        <div className="flex items-center gap-1 mb-6" role="tablist" aria-label="Onboarding steps">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = completedSteps >= s.id;
            const active = step === s.id;
            return (
              <React.Fragment key={s.id}>
                <div className="flex items-center" role="tab" aria-selected={active} aria-label={`Step ${s.id}: ${s.title}${done ? ' (completed)' : active ? ' (current)' : ''}`}>
                  <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold', done ? 'bg-emerald-600 text-white' : active ? 'bg-[#152448] border-2 border-[#C7B15B] text-white' : 'bg-slate-100 text-slate-700')}>
                    {done ? <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> : <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
                  </div>
                  <div className={cn('hidden sm:block ml-1.5 text-xs', active ? 'text-white font-medium' : done ? 'text-emerald-400' : 'text-slate-700')}>
                    {s.title}
                  </div>
                </div>
                {i < STEPS.length - 1 && <div className={cn('flex-1 h-px mx-1', done ? 'bg-emerald-600' : 'bg-slate-200')} />}
              </React.Fragment>
            );
          })}
        </div>

        <Progress value={progressPct} className="h-1 mb-6" aria-label={`Onboarding progress: ${Math.round(progressPct)}%`} />

        {/* Step Content */}
        <Card className="bg-white border-slate-200/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-white text-base flex items-center gap-2">
              {React.createElement(STEPS[step - 1].icon, { className: 'w-4 h-4 text-[#C7B15B]', 'aria-hidden': 'true' })}
              Step {step}: {STEPS[step - 1].title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {step === 1 && <StepIdentity data={identity} onChange={setIdentity} />}
            {step === 2 && <StepModules data={modules} onChange={setModules} tier={identity.tier} />}
            {step === 3 && <StepAgents agentsAllowed={agentsAllowed} onChange={setAgentsAllowed} />}
            {step === 4 && <StepLlm data={llm} onChange={setLlm} />}
            {step === 5 && <StepKeys appId={registeredAppId} platformName={identity.name} />}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="flex items-center justify-between mt-4">
          <Button
            variant="outline"
            className="border-slate-200 text-slate-700 hover:bg-slate-100"
            onClick={() => setStep(s => Math.max(1, s - 1))}
            disabled={step === 1}
            aria-label="Go to previous step"
          >
            <ChevronLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Previous
          </Button>
          {step < 5 && (
            <Button
              onClick={handleNext}
              disabled={!canProceed || registerMutation.isPending}
              className="bg-[#152448] hover:bg-[#0a3580] text-white"
              aria-label={step === 4 ? 'Register platform and proceed to key generation' : 'Go to next step'}
            >
              {step === 4 ? (registerMutation.isPending ? 'Registering...' : 'Register & Generate Keys') : 'Next'}
              <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
