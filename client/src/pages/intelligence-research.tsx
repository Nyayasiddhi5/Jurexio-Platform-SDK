import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Intelligence: Legal Research — E8
 * POST /api/jrx/v1/sdk/intelligence/legal-research (NyayaRAG)
 * Jurexio Enterprise Platform 5.1.0
 */

import React, { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { JrxEmptyState } from '@/components/JrxEmptyState';
import { useToast } from '@/hooks/use-toast';
import {
  Search, BookOpen, Scale, FileText, ChevronRight, Brain,
  RefreshCw, ExternalLink, Clock, AlertTriangle, Sparkles, Copy, CheckCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LegalPrecedent {
  case_name: string;
  court: string;
  year: number;
  citation: string;
  principle: string;
  relevance_score: number;
  key_observations: string[];
  url?: string;
}

interface RelevantAct {
  act_name: string;
  sections: string[];
  jurisdiction: string;
  applicability: string;
}

interface ResearchResult {
  query_interpretation: string;
  legal_summary: string;
  key_principles: string[];
  relevant_acts: RelevantAct[];
  precedents: LegalPrecedent[];
  practice_notes: string[];
  related_queries: string[];
  confidence_score: number;
  jurisdiction: string;
}

interface ResearchResponse {
  success: boolean;
  data: ResearchResult;
  generated_at: string;
  cached: boolean;
  tokens_used?: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const JURISDICTIONS = [
  { value: 'IN', label: 'India (All Courts)' },
  { value: 'IN-SC', label: 'Supreme Court of India' },
  { value: 'IN-HC', label: 'High Courts (India)' },
];

const ACT_SUGGESTIONS = [
  'Indian Penal Code', 'Code of Civil Procedure', 'Code of Criminal Procedure',
  'Indian Contract Act', 'Transfer of Property Act', 'Companies Act 2013',
  'Insolvency and Bankruptcy Code', 'Arbitration and Conciliation Act',
  'Consumer Protection Act', 'Motor Vehicles Act', 'IT Act 2000',
];

const QUERY_SUGGESTIONS = [
  'Anticipatory bail grounds under CrPC Section 438',
  'Specific performance of contract criteria India',
  'Doctrine of promissory estoppel Indian law',
  'Bail in non-bailable offence NDPS Act',
  'Trademark infringement passing off action',
  'Wrongful termination employment law India',
];

// ─── Precision Bar ────────────────────────────────────────────────────────────

function ConfidencePill({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 75 ? 'bg-emerald-50 text-emerald-700 border-emerald-500/40'
    : pct >= 50 ? 'bg-amber-50 text-amber-700 border-amber-200'
    : 'bg-red-50 text-red-700 border-red-200';
  return <Badge variant="outline" className={cn('border text-xs', color)}>Research confidence: {pct}%</Badge>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceResearch() {
  const { toast } = useToast();
  const [query, setQuery] = useState('');
  const [jurisdiction, setJurisdiction] = useState('IN');
  const [actPref, setActPref] = useState('');
  const [maxResults, setMaxResults] = useState('10');
  const [result, setResult] = useState<ResearchResponse | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const acts = actPref.split(',').map(a => a.trim()).filter(Boolean);
      const res = await fetch(nv('v1/sdk/intelligence/legal-research'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          query,
          jurisdiction,
          act_preference: acts,
          include_precedents: true,
          language: 'en',
          max_results: parseInt(maxResults),
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Research failed');
      return res.json() as Promise<ResearchResponse>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: 'Research complete', description: `Found ${data.data?.precedents?.length ?? 0} precedents` });
    },
    onError: (e: Error) => toast({ title: 'Research failed', description: e.message, variant: 'destructive' }),
  });

  const copyCitation = (citation: string, idx: number) => {
    navigator.clipboard.writeText(citation);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const data = result?.data;

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4 md:p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-700 mb-2">
          <Brain className="w-3.5 h-3.5" /> Intelligence Hub
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#C7B15B]">Legal Research (E8)</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
              <Search className="w-6 h-6 text-[#C7B15B]" /> NyayaRAG Legal Research
            </h1>
            <p className="text-slate-600 mt-1 text-sm">AI-powered legal research across case law, statutes, and principles with jurisdiction-aware precedent retrieval</p>
          </div>
          <Badge variant="outline" className="border-[#C7B15B]/40 text-[#C7B15B] text-xs flex-shrink-0">E8 · NyayaRAG</Badge>
        </div>
      </div>

      {/* Search Bar */}
      <Card className="bg-white border-slate-200 mb-6">
        <CardContent className="pt-5 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-700" />
                <Input
                  ref={inputRef}
                  placeholder="Ask a legal question or enter a research query..."
                  className="bg-slate-100 border-slate-200 pl-10 text-sm h-11 text-[#1A3A60] placeholder:text-slate-700"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && query.length >= 3 && mutation.mutate()}
                />
              </div>
            </div>
            <Button
              onClick={() => mutation.mutate()}
              disabled={query.length < 3 || mutation.isPending}
              className="bg-[#C7B15B] hover:bg-[#b8891a] text-slate-900 font-semibold h-11 px-6 flex-shrink-0"
            >
              {mutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              <span className="ml-2 hidden sm:inline">Research</span>
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Jurisdiction</Label>
              <Select value={jurisdiction} onValueChange={setJurisdiction}>
                <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {JURISDICTIONS.map(j => <SelectItem key={j.value} value={j.value}>{j.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Focus Acts (comma separated)</Label>
              <Input
                placeholder="e.g., IPC, CrPC, Contract Act"
                className="bg-slate-100 border-slate-200 text-sm h-9"
                value={actPref}
                onChange={e => setActPref(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Max Results</Label>
              <Select value={maxResults} onValueChange={setMaxResults}>
                <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {['5','10','15','20'].map(n => <SelectItem key={n} value={n}>{n} results</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Sample queries */}
          {!result && (
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-700">Try a sample query</Label>
              <div className="flex flex-wrap gap-2">
                {QUERY_SUGGESTIONS.map((q, i) => (
                  <button key={i} onClick={() => { setQuery(q); }} className="text-xs px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-700 hover:text-[#152448] hover:border-[#C7B15B]/50 transition-colors">
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading */}
      {mutation.isPending && (
        <Card className="bg-white border-slate-200">
          <CardContent className="py-12 flex flex-col items-center gap-4">
            <div className="w-14 h-14 rounded-full border-4 border-[#C7B15B]/30 border-t-[#C7B15B] animate-spin" />
            <p className="text-slate-600 text-sm">NyayaRAG searching case law, statutes and principles...</p>
            <p className="text-xs text-slate-600">Retrieving precedents · Synthesising legal principles · Formulating answer</p>
          </CardContent>
        </Card>
      )}

      {/* Empty */}
      {!mutation.isPending && !result && (
        <JrxEmptyState
          icon={BookOpen}
          title="Start Your Legal Research"
          description="Enter any legal question in plain language. NyayaRAG will search across Indian and international case law, identify relevant statutes, and synthesise the key legal principles with citations."
          size="lg"
        />
      )}

      {/* Results */}
      {data && !mutation.isPending && (
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <ConfidencePill score={data.confidence_score} />
              {result?.cached && (
                <span className="text-xs text-slate-600 flex items-center gap-1"><Clock className="w-3 h-3" /> Cached</span>
              )}
            </div>
            <button onClick={() => mutation.mutate()} className="text-xs text-slate-700 hover:text-[#152448] flex items-center gap-1">
              <RefreshCw className="w-3 h-3" /> Refresh
            </button>
          </div>

          {/* Query Interpretation */}
          {data.query_interpretation && (
            <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg">
              <p className="text-xs text-blue-400 font-medium mb-1">Research interpretation</p>
              <p className="text-sm text-slate-700">{data.query_interpretation}</p>
            </div>
          )}

          {/* Legal Summary */}
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#C7B15B]" /> AI Legal Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-700 leading-relaxed">{data.legal_summary}</p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Key Principles */}
            {(data.key_principles?.length ?? 0) > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Scale className="w-4 h-4 text-[#C7B15B]" /> Key Legal Principles
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {data.key_principles.map((p, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
                      <span className="text-[#C7B15B] font-bold mt-0.5 flex-shrink-0">{i + 1}.</span>
                      <span>{p}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Relevant Acts */}
            {data.relevant_acts?.length > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <FileText className="w-4 h-4 text-blue-400" /> Relevant Acts & Sections
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.relevant_acts.map((act, i) => (
                    <div key={i} className="p-2.5 rounded-lg bg-slate-100/50 border border-slate-200/50">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm font-medium text-[#1A3A60]">{act.act_name}</p>
                        <Badge variant="outline" className="border-slate-300 text-slate-600 text-[10px]">{act.jurisdiction}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-1 mb-1">
                        {act.sections.map((s, j) => (
                          <span key={j} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-700 font-mono">{s}</span>
                        ))}
                      </div>
                      <p className="text-xs text-slate-600">{act.applicability}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          {/* Precedents */}
          {(data.precedents?.length ?? 0) > 0 && (
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-[#C7B15B]" /> Case Precedents ({data.precedents?.length ?? 0})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {data.precedents.map((p, i) => (
                  <div key={i} className="p-3 rounded-lg bg-slate-100/50 border border-slate-200/50">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[#1A3A60] leading-tight">{p.case_name}</p>
                        <p className="text-xs text-slate-700 mt-0.5">{p.court} · {p.year}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-[#C7B15B] font-bold">{Math.round(p.relevance_score * 100)}% match</span>
                        <button
                          onClick={() => copyCitation(p.citation, i)}
                          className="p-1 rounded text-slate-700 hover:text-[#152448] hover:bg-slate-100 transition-colors"
                          title="Copy citation"
                        >
                          {copiedIdx === i ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                    <div className="font-mono text-[10px] text-slate-700 bg-white/50 rounded px-2 py-1 mb-2 inline-block">{p.citation}</div>
                    <p className="text-sm text-slate-700 mb-2">{p.principle}</p>
                    {p.key_observations.length > 0 && (
                      <div className="space-y-0.5">
                        {p.key_observations.map((o, j) => (
                          <div key={j} className="flex items-start gap-1.5 text-xs text-slate-600">
                            <span className="text-[#C7B15B] mt-0.5">›</span> {o}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Practice Notes + Related Queries */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {(data.practice_notes?.length ?? 0) > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400" /> Practice Notes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {data.practice_notes.map((n, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                      <span className="text-amber-400 mt-0.5">•</span> {n}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {data.related_queries?.length > 0 && (
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Search className="w-4 h-4 text-blue-400" /> Related Queries
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1.5">
                  {data.related_queries.map((q, i) => (
                    <button key={i} onClick={() => { setQuery(q); mutation.mutate(); }}
                      className="w-full text-left text-xs text-slate-600 hover:text-[#C7B15B] flex items-center gap-1.5 py-0.5 transition-colors">
                      <ChevronRight className="w-3 h-3 flex-shrink-0" /> {q}
                    </button>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
