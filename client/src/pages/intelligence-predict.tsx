import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Intelligence: Outcome Prediction — E3
 * POST /api/jrx/v1/sdk/intelligence/predict-outcome
 * Jurexio Enterprise Platform 5.1.0
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { useToast } from '@/hooks/use-toast';
import {
  Brain, Scale, Target, TrendingUp, AlertTriangle, CheckCircle2,
  BookOpen, ChevronRight, Sparkles, Shield, Clock, RefreshCw,
  BarChart3, ArrowUpRight, Info, Gavel,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface OutcomeFactor {
  factor: string;
  impact: 'positive' | 'negative' | 'neutral';
  weight: number;
  detail: string;
}

interface RecommendedAction {
  action: string;
  rationale: string;
  urgency: 'immediate' | 'within_week' | 'before_hearing';
}

interface SimilarPrecedent {
  case_name: string;
  court: string;
  year: number;
  citation: string;
  outcome: string;
  relevance_score: number;
  summary: string;
}

interface OutcomePrediction {
  win_probability: number;
  confidence_band: [number, number];
  outcome_factors: OutcomeFactor[];
  risk_factors: string[];
  recommended_actions: RecommendedAction[];
  similar_precedents: SimilarPrecedent[];
  strategic_notes: string;
  disclaimer: string;
}

interface PredictResult {
  success: boolean;
  data: OutcomePrediction;
  generated_at: string;
  cached: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CASE_TYPES = [
  'Civil Suit', 'Criminal Matter', 'Arbitration', 'Writ Petition', 'PIL',
  'Family Matter', 'Commercial Dispute', 'Labour Dispute', 'Constitutional Matter',
  'Tax Dispute', 'IP/Trademark', 'Insolvency (IBC)', 'Consumer Dispute', 'Land & Revenue',
];

const JURISDICTIONS = [
  { value: 'IN-SC', label: 'Supreme Court of India' },
  { value: 'IN-HC-DEL', label: 'Delhi High Court' },
  { value: 'IN-HC-BOM', label: 'Bombay High Court' },
  { value: 'IN-HC-MAD', label: 'Madras High Court' },
  { value: 'IN-HC-CAL', label: 'Calcutta High Court' },
  { value: 'IN-HC-KAR', label: 'Karnataka High Court' },
  { value: 'IN-HC-RAJ', label: 'Rajasthan High Court' },
  { value: 'IN-HC-GUJ', label: 'Gujarat High Court' },
  { value: 'IN-DIS', label: 'District Court (India)' },
];

const URGENCY_CONFIG = {
  immediate: { color: 'bg-red-50 text-red-700 border-red-200', label: 'Immediate' },
  within_week: { color: 'bg-amber-50 text-amber-700 border-amber-200', label: 'This Week' },
  before_hearing: { color: 'bg-blue-50 text-blue-700 border-blue-500/40', label: 'Before Hearing' },
};

// ─── Win Probability Gauge ────────────────────────────────────────────────────

function WinGauge({ probability, band }: { probability: number; band: [number, number] }) {
  const pct = Math.round(probability * 100);
  const lowPct = Math.round(band[0] * 100);
  const highPct = Math.round(band[1] * 100);
  const color = pct >= 65 ? 'text-emerald-400' : pct >= 45 ? 'text-amber-400' : 'text-red-400';
  const ringColor = pct >= 65 ? '#1C7A4F' : pct >= 45 ? '#D97706' : '#CC2936';
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-36 h-36">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#1E293B" strokeWidth="10" />
          <circle
            cx="50" cy="50" r="42" fill="none"
            stroke={ringColor} strokeWidth="10"
            strokeDasharray={`${pct * 2.639} 263.9`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-3xl font-black', color)}>{pct}%</span>
          <span className="text-[10px] text-slate-700 uppercase tracking-wide">Win Prob.</span>
        </div>
      </div>
      <div className="text-center">
        <div className="text-xs text-slate-700">Confidence band</div>
        <div className="text-sm font-semibold text-slate-700">{lowPct}% – {highPct}%</div>
      </div>
    </div>
  );
}

// ─── Factor Bar ───────────────────────────────────────────────────────────────

function FactorBar({ factor }: { factor: OutcomeFactor }) {
  const colors = {
    positive: { bar: 'bg-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-200' },
    negative: { bar: 'bg-red-500', text: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    neutral:  { bar: 'bg-slate-400', text: 'text-slate-600', bg: 'bg-slate-200/30 border-slate-300/20' },
  };
  const c = colors[factor.impact];
  return (
    <div className={cn('rounded-lg border p-3', c.bg)}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <span className="text-sm font-medium text-[#1A3A60]">{factor.factor}</span>
        <span className={cn('text-xs font-bold', c.text)}>{Math.round(factor.weight * 100)}%</span>
      </div>
      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-2">
        <div className={cn('h-1.5 rounded-full transition-all duration-700', c.bar)}
          style={{ width: `${factor.weight * 100}%` }} />
      </div>
      <p className="text-xs text-slate-600">{factor.detail}</p>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligencePredict() {
  const { toast } = useToast();
  const [form, setForm] = useState({
    case_type: '',
    jurisdiction: '',
    facts_summary: '',
    opposing_arguments: '',
    judge_name: '',
    case_history: '',
    relief_sought: '',
  });
  const [result, setResult] = useState<PredictResult | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(nv('v1/sdk/intelligence/predict-outcome'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          case_type: form.case_type,
          jurisdiction: form.jurisdiction,
          facts_summary: form.facts_summary,
          opposing_arguments: form.opposing_arguments || undefined,
          judge_name: form.judge_name || undefined,
          case_history: form.case_history || undefined,
          relief_sought: form.relief_sought || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Prediction failed');
      return res.json() as Promise<PredictResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: 'Outcome prediction generated', description: data.cached ? 'Served from cache' : 'Fresh AI analysis' });
    },
    onError: (e: Error) => toast({ title: 'Prediction failed', description: e.message, variant: 'destructive' }),
  });

  const canSubmit = form.case_type && form.jurisdiction && form.facts_summary.length >= 50;
  const pred = result?.data;

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-700 mb-2">
          <Brain className="w-3.5 h-3.5" /> Intelligence Hub
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#C7B15B]">Outcome Prediction (E3)</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
              <Target className="w-6 h-6 text-[#C7B15B]" /> Outcome Prediction
            </h1>
            <p className="text-slate-600 mt-1 text-sm">AI-powered litigation outcome probability with case precedents and strategic recommendations</p>
          </div>
          <Badge variant="outline" className="border-[#C7B15B]/40 text-[#C7B15B] text-xs flex-shrink-0">E3 · ROMA L5</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Input Form */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Gavel className="w-4 h-4 text-[#C7B15B]" /> Case Details
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">Case Type *</Label>
                  <Select value={form.case_type} onValueChange={v => setForm(f => ({ ...f, case_type: v }))}>
                    <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {CASE_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-slate-600">Jurisdiction *</Label>
                  <Select value={form.jurisdiction} onValueChange={v => setForm(f => ({ ...f, jurisdiction: v }))}>
                    <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                      <SelectValue placeholder="Select court" />
                    </SelectTrigger>
                    <SelectContent className="bg-white border-slate-200">
                      {JURISDICTIONS.map(j => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Facts Summary * <span className="text-slate-600 ml-1">(min 50 chars)</span></Label>
                <Textarea
                  rows={5}
                  placeholder="Describe the key facts of the case — parties, timeline, dispute, and key evidence..."
                  className="bg-slate-100 border-slate-200 text-sm resize-none"
                  value={form.facts_summary}
                  onChange={e => setForm(f => ({ ...f, facts_summary: e.target.value }))}
                />
                <div className="text-right text-[10px] text-slate-600">{form.facts_summary.length}/8000</div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Relief Sought</Label>
                <Input
                  placeholder="e.g., Permanent injunction + damages of ₹50L"
                  className="bg-slate-100 border-slate-200 text-sm h-9"
                  value={form.relief_sought}
                  onChange={e => setForm(f => ({ ...f, relief_sought: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Judge / Bench (optional)</Label>
                <Input
                  placeholder="e.g., Hon'ble Justice D.Y. Chandrachud"
                  className="bg-slate-100 border-slate-200 text-sm h-9"
                  value={form.judge_name}
                  onChange={e => setForm(f => ({ ...f, judge_name: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Opposing Arguments (optional)</Label>
                <Textarea
                  rows={3}
                  placeholder="Key arguments from the other side, if known..."
                  className="bg-slate-100 border-slate-200 text-sm resize-none"
                  value={form.opposing_arguments}
                  onChange={e => setForm(f => ({ ...f, opposing_arguments: e.target.value }))}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Case History (optional)</Label>
                <Textarea
                  rows={2}
                  placeholder="Prior orders, appeals, or lower court proceedings..."
                  className="bg-slate-100 border-slate-200 text-sm resize-none"
                  value={form.case_history}
                  onChange={e => setForm(f => ({ ...f, case_history: e.target.value }))}
                />
              </div>

              <Button
                onClick={() => mutation.mutate()}
                disabled={!canSubmit || mutation.isPending}
                className="w-full bg-[#C7B15B] hover:bg-[#b8891a] text-slate-900 font-semibold"
              >
                {mutation.isPending ? (
                  <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analysing with AI...</>
                ) : (
                  <><Target className="w-4 h-4 mr-2" /> Predict Litigation Outcome</>
                )}
              </Button>

              {!canSubmit && (
                <p className="text-xs text-slate-600 text-center">Fill case type, jurisdiction, and at least 50 chars of facts</p>
              )}
            </CardContent>
          </Card>

          {/* Disclaimer */}
          <div className="flex gap-2 p-3 bg-white/50 rounded-lg border border-slate-200">
            <Info className="w-4 h-4 text-slate-700 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-slate-700">AI prediction based on historical case patterns. Not legal advice. Always consult a qualified advocate before making litigation decisions.</p>
          </div>
        </div>

        {/* Results */}
        <div className="xl:col-span-3 space-y-4">
          {mutation.isPending && (
            <Card className="bg-white border-slate-200">
              <CardContent className="py-12 flex flex-col items-center gap-4">
                <div className="w-16 h-16 rounded-full border-4 border-[#C7B15B]/30 border-t-[#C7B15B] animate-spin" />
                <p className="text-slate-600 text-sm">ROMA L5 Litigation Specialist analysing case data...</p>
                <p className="text-xs text-slate-600">Reviewing precedents · Scoring outcome factors · Generating strategy</p>
              </CardContent>
            </Card>
          )}

          {!mutation.isPending && !pred && (
            <NyvEmptyState
              icon={Target}
              title="Enter Case Details to Predict Outcome"
              description="The ROMA L5 Litigation Specialist agent will analyse your case facts, review similar precedents, and provide a structured win probability with strategic recommendations."
              size="lg"
            />
          )}

          {pred && !mutation.isPending && (
            <>
              {/* Probability Summary */}
              <Card className="bg-white border-slate-200">
                <CardContent className="pt-6">
                  <div className="flex flex-col md:flex-row items-center gap-8">
                    <WinGauge probability={pred.win_probability} band={pred.confidence_band} />
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Analysis type</span>
                        <Badge variant="outline" className="border-[#C7B15B]/40 text-[#C7B15B] text-xs">ROMA L5 Litigation Specialist</Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Outcome factors analysed</span>
                        <span className="text-sm font-semibold text-[#1A3A60]">{pred.outcome_factors.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Similar precedents</span>
                        <span className="text-sm font-semibold text-[#1A3A60]">{pred.similar_precedents.length}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-slate-600">Risk factors</span>
                        <span className="text-sm font-semibold text-red-400">{pred.risk_factors.length}</span>
                      </div>
                      {result?.cached && (
                        <div className="text-xs text-slate-600 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Cached analysis · <button onClick={() => mutation.mutate()} className="text-[#C7B15B] hover:underline">Refresh</button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Outcome Factors */}
              {pred.outcome_factors.length > 0 && (
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-[#C7B15B]" /> Outcome Factors
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pred.outcome_factors.map((f, i) => <FactorBar key={i} factor={f} />)}
                  </CardContent>
                </Card>
              )}

              {/* Recommended Actions */}
              {pred.recommended_actions.length > 0 && (
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Recommended Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pred.recommended_actions.map((a, i) => {
                      const uc = URGENCY_CONFIG[a.urgency];
                      return (
                        <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-100/50 border border-slate-200/50">
                          <span className="text-xs font-bold text-slate-700 mt-0.5 w-5 text-center">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <p className="text-sm font-medium text-[#1A3A60]">{a.action}</p>
                              <Badge variant="outline" className={cn('text-[10px] border flex-shrink-0', uc.color)}>{uc.label}</Badge>
                            </div>
                            <p className="text-xs text-slate-600 mt-0.5">{a.rationale}</p>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}

              {/* Similar Precedents */}
              {pred.similar_precedents.length > 0 && (
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-blue-400" /> Similar Precedents
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {pred.similar_precedents.map((p, i) => (
                      <div key={i} className="p-3 rounded-lg bg-slate-100/50 border border-slate-200/50">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div>
                            <p className="text-sm font-medium text-[#1A3A60]">{p.case_name}</p>
                            <p className="text-xs text-slate-700">{p.court} · {p.year} · {p.citation}</p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <div className="text-xs font-bold text-[#C7B15B]">{Math.round(p.relevance_score * 100)}%</div>
                            <div className="text-[10px] text-slate-600">relevance</div>
                          </div>
                        </div>
                        <p className="text-xs text-slate-600">{p.summary}</p>
                        <Badge variant="outline" className={cn('mt-2 text-[10px] border',
                          p.outcome.toLowerCase().includes('allow') || p.outcome.toLowerCase().includes('favour')
                            ? 'border-emerald-500/40 text-emerald-400' : 'border-red-200 text-red-400'
                        )}>{p.outcome}</Badge>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Risk Factors + Strategic Notes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {pred.risk_factors.length > 0 && (
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-red-400" /> Risk Factors
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1.5">
                      {pred.risk_factors.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                          <span className="text-red-400 mt-0.5">•</span> {r}
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {pred.strategic_notes && (
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[#C7B15B]" /> Strategic Notes
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-slate-700 leading-relaxed">{pred.strategic_notes}</p>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Disclaimer */}
              <div className="flex gap-2 p-3 bg-amber-500/5 rounded-lg border border-amber-500/20">
                <Shield className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-amber-400/80">{pred.disclaimer}</p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
