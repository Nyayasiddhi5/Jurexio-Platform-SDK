import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Intelligence: Client Sentiment Analysis — E5
 * POST /api/jrx/v1/sdk/intelligence/sentiment-analysis
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
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { useToast } from '@/hooks/use-toast';
import {
  MessageSquare, Brain, ChevronRight, RefreshCw, Plus, Trash2,
  TrendingUp, TrendingDown, Minus, AlertTriangle, Heart, Zap,
  SmilePlus, Frown, Meh,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MessageInput {
  id: string;
  text: string;
  sender: 'client' | 'lawyer' | 'system';
  sent_at: string;
}

interface SentimentMessage {
  id?: string;
  text: string;
  sender?: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  flags: string[];
}

interface SentimentResult {
  overall_sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  overall_score: number;
  escalation_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  flags: string[];
  messages: SentimentMessage[];
  summary: string;
  recommended_actions: string[];
  client_satisfaction_score: number;
  urgency_indicators: string[];
}

interface SentimentResponse {
  success: boolean;
  data: SentimentResult;
  generated_at: string;
  cached: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const ESCALATION_CONFIG = {
  LOW: { color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-200', Icon: SmilePlus },
  MEDIUM: { color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-200', Icon: Meh },
  HIGH: { color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-200', Icon: AlertTriangle },
  CRITICAL: { color: 'text-red-400', bg: 'bg-red-500/10 border-red-200', Icon: Frown },
};

const SENTIMENT_COLORS = {
  positive: 'text-emerald-400 bg-emerald-500/10 border-emerald-200',
  negative: 'text-red-400 bg-red-500/10 border-red-200',
  neutral: 'text-slate-600 bg-slate-500/10 border-slate-300/30',
  mixed: 'text-amber-400 bg-amber-500/10 border-amber-200',
};

const FLAG_COLORS: Record<string, string> = {
  urgent_tone: 'bg-red-50 text-red-700 border-red-200',
  payment_dispute: 'bg-orange-50 text-orange-700 border-orange-500/40',
  dissatisfaction: 'bg-amber-50 text-amber-700 border-amber-200',
  complaint_risk: 'bg-red-50 text-red-700 border-red-200',
  escalation_signal: 'bg-red-50 text-red-700 border-red-200',
  positive_feedback: 'bg-emerald-50 text-emerald-700 border-emerald-500/40',
  gratitude: 'bg-emerald-50 text-emerald-700 border-emerald-500/40',
};

// ─── Sentiment Gauge ──────────────────────────────────────────────────────────

function SentimentGauge({ score, sentiment }: { score: number; sentiment: string }) {
  const pct = Math.round(score * 100);
  const color = sentiment === 'positive' ? '#1C7A4F' : sentiment === 'negative' ? '#CC2936' : '#94A3B8';
  return (
    <div className="relative w-24 h-24 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#1E293B" strokeWidth="10" />
        <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={`${pct * 2.513} 251.3`} strokeLinecap="round"
          style={{ transition: 'stroke-dasharray 0.8s ease' }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-black text-[#152448]">{pct}%</span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceSentiment() {
  const { toast } = useToast();
  const [clientId, setClientId] = useState('');
  const [messages, setMessages] = useState<MessageInput[]>([
    { id: '1', text: '', sender: 'client', sent_at: new Date().toISOString().split('T')[0] },
  ]);
  const [result, setResult] = useState<SentimentResponse | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const validMsgs = messages.filter(m => m.text.trim().length > 0);
      if (validMsgs.length === 0) throw new Error('Add at least one message to analyse');
      const res = await fetch(nv('v1/sdk/intelligence/sentiment-analysis'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          messages: validMsgs.map(m => ({ id: m.id, text: m.text, sender: m.sender, sent_at: m.sent_at })),
          client_id: clientId || undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Analysis failed');
      return res.json() as Promise<SentimentResponse>;
    },
    onSuccess: (data) => {
      setResult(data);
      const risk = data.data.escalation_risk;
      toast({ title: `Escalation risk: ${risk}`, description: data.data.overall_sentiment + ' sentiment' });
    },
    onError: (e: Error) => toast({ title: 'Analysis failed', description: e.message, variant: 'destructive' }),
  });

  const addMessage = () => setMessages(m => [...m, {
    id: `${Date.now()}`, text: '', sender: 'client', sent_at: new Date().toISOString().split('T')[0],
  }]);
  const removeMessage = (id: string) => setMessages(m => m.filter(x => x.id !== id));
  const updateMessage = (id: string, field: keyof MessageInput, value: string) =>
    setMessages(m => m.map(x => x.id === id ? { ...x, [field]: value } : x));

  const data = result?.data;
  const escalationCfg = data ? ESCALATION_CONFIG[data.escalation_risk] : null;
  const EscIcon = escalationCfg?.Icon ?? Meh;

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4 md:p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-700 mb-2">
          <Brain className="w-3.5 h-3.5" /> Intelligence Hub
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#C7B15B]">Sentiment Analysis (E5)</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
              <MessageSquare className="w-6 h-6 text-[#C7B15B]" /> Client Sentiment Analysis
            </h1>
            <p className="text-slate-600 mt-1 text-sm">Detect escalation risk, satisfaction signals, and communication tone in client messages</p>
          </div>
          <Badge variant="outline" className="border-[#C7B15B]/40 text-[#C7B15B] text-xs flex-shrink-0">E5 · ROMA L5</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Input */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold text-slate-800">Messages ({messages.filter(m => m.text).length} valid)</CardTitle>
                <Button variant="ghost" size="sm" onClick={addMessage} className="text-xs h-7 text-[#C7B15B]">
                  <Plus className="w-3 h-3 mr-1" /> Add
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">Client ID (optional)</Label>
                <Input placeholder="e.g., client-001" className="bg-slate-100 border-slate-200 text-sm h-9"
                  value={clientId} onChange={e => setClientId(e.target.value)} />
              </div>

              {messages.map((msg, i) => (
                <div key={msg.id} className="rounded-lg border border-slate-200/50 p-3 bg-slate-100/30 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Select value={msg.sender} onValueChange={v => updateMessage(msg.id, 'sender', v)}>
                        <SelectTrigger className="bg-white border-slate-200 text-xs h-7 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white border-slate-200">
                          <SelectItem value="client" className="text-xs">Client</SelectItem>
                          <SelectItem value="lawyer" className="text-xs">Lawyer</SelectItem>
                          <SelectItem value="system" className="text-xs">System</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input type="date" value={msg.sent_at} onChange={e => updateMessage(msg.id, 'sent_at', e.target.value)}
                        className="bg-slate-100 border-slate-200 text-xs h-7 w-36" />
                    </div>
                    {messages.length > 1 && (
                      <button onClick={() => removeMessage(msg.id)} className="p-1 rounded text-slate-600 hover:text-red-400 transition-colors">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  <Textarea rows={3} placeholder={`Message ${i + 1} text...`}
                    className="bg-slate-100 border-slate-200 text-xs resize-none"
                    value={msg.text} onChange={e => updateMessage(msg.id, 'text', e.target.value)} />
                </div>
              ))}

              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}
                className="w-full bg-[#C7B15B] hover:bg-[#b8891a] text-slate-900 font-semibold">
                {mutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Analysing Sentiment...</>
                  : <><MessageSquare className="w-4 h-4 mr-2" /> Analyse Client Sentiment</>}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Results */}
        <div className="xl:col-span-3 space-y-4">
          {mutation.isPending && (
            <Card className="bg-white border-slate-200">
              <CardContent className="py-12 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-full border-4 border-[#C7B15B]/30 border-t-[#C7B15B] animate-spin" />
                <p className="text-slate-600 text-sm">Analysing client communication patterns...</p>
              </CardContent>
            </Card>
          )}

          {!mutation.isPending && !data && (
            <JrxEmptyState icon={Heart} title="Add Client Messages to Analyse"
              description="Paste client communications — emails, WhatsApp messages, or chat transcripts. The AI will detect sentiment, escalation risk, and suggest the right response approach."
              size="lg" />
          )}

          {data && !mutation.isPending && (
            <>
              {/* Risk Overview */}
              <Card className={cn('border', escalationCfg?.bg)}>
                <CardContent className="pt-5">
                  <div className="flex items-center gap-6">
                    <div className="flex flex-col items-center gap-2">
                      <SentimentGauge score={data.client_satisfaction_score} sentiment={data.overall_sentiment} />
                      <span className="text-xs text-slate-700">Satisfaction</span>
                    </div>
                    <div className="flex-1 space-y-3">
                      <div className="flex items-center gap-3">
                        <EscIcon className={cn('w-6 h-6', escalationCfg?.color)} />
                        <div>
                          <div className={cn('text-lg font-black', escalationCfg?.color)}>
                            {data.escalation_risk} Escalation Risk
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge variant="outline" className={cn('border text-xs', SENTIMENT_COLORS[data.overall_sentiment])}>
                              {data.overall_sentiment} sentiment
                            </Badge>
                          </div>
                        </div>
                      </div>
                      {data.flags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {data.flags.map((f, i) => (
                            <Badge key={i} variant="outline"
                              className={cn('text-[10px] border', FLAG_COLORS[f] ?? 'border-slate-300 text-slate-600')}>
                              {f.replace(/_/g, ' ')}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Summary + Actions */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-[#C7B15B]" /> AI Assessment
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-slate-700 leading-relaxed">{data.summary}</p>
                    {data.urgency_indicators.length > 0 && (
                      <div className="mt-3 space-y-1">
                        <p className="text-xs text-red-400 font-medium">Urgency indicators:</p>
                        {data.urgency_indicators.map((u, i) => (
                          <div key={i} className="text-xs text-slate-600 flex items-start gap-1">
                            <span className="text-red-400">!</span> {u}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-400" /> Recommended Actions
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {data.recommended_actions.map((a, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                        <span className="text-[#C7B15B] font-bold mt-0.5">{i + 1}.</span> {a}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Per-message breakdown */}
              {data.messages.length > 0 && (
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800">Message-level Sentiment</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {data.messages.map((m, i) => {
                      const score = Math.round(m.sentiment_score * 100);
                      const Icon = m.sentiment === 'positive' ? SmilePlus : m.sentiment === 'negative' ? Frown : Meh;
                      return (
                        <div key={i} className={cn('p-3 rounded-lg border', SENTIMENT_COLORS[m.sentiment as keyof typeof SENTIMENT_COLORS])}>
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <div className="flex items-center gap-2">
                              <Icon className="w-4 h-4 flex-shrink-0" />
                              <span className="text-xs font-medium capitalize">{m.sender ?? 'unknown'}</span>
                            </div>
                            <span className="text-xs font-bold">{score}%</span>
                          </div>
                          <p className="text-xs text-slate-700 line-clamp-2">{m.text}</p>
                          {m.flags.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {m.flags.map((f, j) => (
                                <span key={j} className="text-[9px] px-1.5 py-0.5 rounded-full bg-black/20 border border-current/30">
                                  {f.replace(/_/g, ' ')}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
