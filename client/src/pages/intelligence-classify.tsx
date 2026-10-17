import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Intelligence: Document Classification — E6
 * POST /api/jrx/v1/sdk/intelligence/classify-document
 * Jurexio Enterprise Platform 5.1.0
 */

import React, { useState, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { useToast } from '@/hooks/use-toast';
import {
  FileText, Brain, ChevronRight, RefreshCw, Upload, AlertTriangle,
  Users, Calendar, DollarSign, Scale, BookOpen, Shield, CheckCircle2, Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Party { name: string; role: string }
interface KeyDate { date: string; event: string }
interface KeyAmount { amount: number; currency: string; description: string }

interface ClassificationResult {
  document_type: string;
  document_subtype: string;
  parties: Party[];
  key_dates: KeyDate[];
  key_amounts: KeyAmount[];
  court: string;
  jurisdiction: string;
  case_number: string;
  risk_flags: string[];
  legal_acts_cited: string[];
  key_clauses: string[];
  classification_confidence: number;
  summary: string;
}

interface ClassifyResponse {
  success: boolean;
  data: ClassificationResult;
  generated_at: string;
  cached: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPE_COLORS: Record<string, string> = {
  'Petition': 'bg-blue-50 text-blue-700 border-blue-500/40',
  'Bail Application': 'bg-amber-50 text-amber-700 border-amber-200',
  'Judgment': 'bg-purple-50 text-purple-700 border-purple-500/40',
  'Order': 'bg-indigo-50 text-indigo-700 border-indigo-500/40',
  'FIR': 'bg-red-50 text-red-700 border-red-200',
  'Contract': 'bg-emerald-50 text-emerald-700 border-emerald-500/40',
  'Agreement': 'bg-teal-500/20 text-teal-300 border-teal-500/40',
  'Notice': 'bg-orange-50 text-orange-700 border-orange-500/40',
  'Affidavit': 'bg-cyan-50 text-cyan-700 border-cyan-500/40',
};

const ROLE_COLORS: Record<string, string> = {
  petitioner: 'bg-blue-500/10 text-blue-700',
  respondent: 'bg-red-500/10 text-red-700',
  applicant: 'bg-indigo-500/10 text-indigo-700',
  defendant: 'bg-orange-500/10 text-orange-700',
  court: 'bg-purple-500/10 text-purple-700',
  witness: 'bg-slate-500/10 text-slate-700',
};

// ─── Confidence Ring ──────────────────────────────────────────────────────────

function ConfidenceRing({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct >= 80 ? '#1C7A4F' : pct >= 60 ? '#D97706' : '#CC2936';
  const label = pct >= 80 ? 'High confidence' : pct >= 60 ? 'Medium confidence' : 'Low confidence';
  return (
    <div className="flex items-center gap-3">
      <div className="relative w-14 h-14">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#1E293B" strokeWidth="14" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="14"
            strokeDasharray={`${pct * 2.513} 251.3`} strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-black text-[#152448]">{pct}%</span>
        </div>
      </div>
      <div>
        <div className="text-xs font-medium text-[#1A3A60]">{label}</div>
        <div className="text-[10px] text-slate-700">Classification score</div>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceClassify() {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ClassifyResponse | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setText((ev.target?.result as string) ?? '');
    reader.readAsText(file);
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(nv('v1/sdk/intelligence/classify-document'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          text,
          file_name: fileName || undefined,
          store_result: false,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Classification failed');
      return res.json() as Promise<ClassifyResponse>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: `Classified: ${data.data.document_type}`, description: `${Math.round(data.data.classification_confidence * 100)}% confidence` });
    },
    onError: (e: Error) => toast({ title: 'Classification failed', description: e.message, variant: 'destructive' }),
  });

  const data = result?.data;
  const docTypeColor = data ? (DOC_TYPE_COLORS[data.document_type] ?? 'bg-slate-500/20 text-slate-700 border-slate-500/40') : '';

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4 md:p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-700 mb-2">
          <Brain className="w-3.5 h-3.5" /> Intelligence Hub
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#C7B15B]">Document Classification (E6)</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
              <FileText className="w-6 h-6 text-[#C7B15B]" /> Document Classification
            </h1>
            <p className="text-slate-600 mt-1 text-sm">AI-powered legal document analysis — auto-classify type, extract parties, dates, amounts, and risk flags</p>
          </div>
          <Badge variant="outline" className="border-[#C7B15B]/40 text-[#C7B15B] text-xs flex-shrink-0">E6 · Doc Intelligence</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Input */}
        <div className="xl:col-span-2 space-y-4">
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#C7B15B]" /> Document Input
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* File Upload */}
              <div
                onClick={() => fileRef.current?.click()}
                className="border-2 border-dashed border-slate-200 rounded-lg p-4 text-center cursor-pointer hover:border-[#C7B15B]/50 transition-colors"
              >
                <Upload className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-600">Click to upload .txt file</p>
                <p className="text-xs text-slate-600 mt-1">or paste text below</p>
                {fileName && <p className="text-xs text-[#C7B15B] mt-2 font-medium">{fileName}</p>}
                <input ref={fileRef} type="file" accept=".txt,.md" className="hidden" onChange={handleFileUpload} />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-slate-600">Document Text *</Label>
                  <span className="text-[10px] text-slate-600">{text.length}/50000</span>
                </div>
                <Textarea rows={12}
                  placeholder="Paste the full text of the legal document here..."
                  className="bg-slate-100 border-slate-200 text-xs resize-none leading-relaxed font-mono"
                  value={text} onChange={e => setText(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-slate-600">File Name (optional)</Label>
                <Input placeholder="e.g., Sharma_Bail_Application_2025.pdf"
                  className="bg-slate-100 border-slate-200 text-sm h-9"
                  value={fileName} onChange={e => setFileName(e.target.value)} />
              </div>

              <Button onClick={() => mutation.mutate()} disabled={text.length < 10 || mutation.isPending}
                className="w-full bg-[#C7B15B] hover:bg-[#b8891a] text-slate-900 font-semibold">
                {mutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Classifying Document...</>
                  : <><FileText className="w-4 h-4 mr-2" /> Classify & Extract Data</>}
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
                <p className="text-slate-600 text-sm">Document Intelligence Agent classifying...</p>
                <p className="text-xs text-slate-600">Identifying type · Extracting parties & dates · Flagging risks</p>
              </CardContent>
            </Card>
          )}

          {!mutation.isPending && !data && (
            <NyvEmptyState icon={FileText} title="Paste Document Text to Classify"
              description="The Document Intelligence Agent will identify document type, extract all parties, dates, amounts, legal acts cited, and flag any risk indicators — in seconds."
              size="lg" />
          )}

          {data && !mutation.isPending && (
            <>
              {/* Classification Header */}
              <Card className="bg-white border-slate-200">
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div>
                      <Badge variant="outline" className={cn('border text-sm px-3 py-1 mb-2', docTypeColor)}>
                        {data.document_type}
                      </Badge>
                      {data.document_subtype && (
                        <p className="text-xs text-slate-600">{data.document_subtype}</p>
                      )}
                    </div>
                    <ConfidenceRing score={data.classification_confidence} />
                  </div>
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    {data.court && <div><p className="text-xs text-slate-700">Court</p><p className="text-[#1A3A60] font-medium text-xs">{data.court}</p></div>}
                    {data.jurisdiction && <div><p className="text-xs text-slate-700">Jurisdiction</p><p className="text-[#1A3A60] font-medium text-xs">{data.jurisdiction}</p></div>}
                    {data.case_number && <div><p className="text-xs text-slate-700">Case No.</p><p className="text-[#1A3A60] font-medium font-mono text-xs">{data.case_number}</p></div>}
                  </div>
                </CardContent>
              </Card>

              {/* Summary */}
              <Card className="bg-white border-slate-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[#C7B15B]" /> AI Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-700 leading-relaxed">{data.summary}</p>
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Parties */}
                {data.parties.length > 0 && (
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <Users className="w-4 h-4 text-blue-400" /> Parties ({data.parties.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {data.parties.map((p, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-sm text-[#1A3A60]">{p.name}</span>
                          <span className={cn('text-[10px] px-2 py-0.5 rounded-full capitalize', ROLE_COLORS[p.role] ?? 'bg-slate-600 text-slate-700')}>
                            {p.role}
                          </span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Key Dates */}
                {data.key_dates.length > 0 && (
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-purple-400" /> Key Dates ({data.key_dates.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {data.key_dates.map((d, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs font-mono text-[#C7B15B]">{d.date}</span>
                          <span className="text-xs text-slate-700 text-right">{d.event}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Amounts */}
                {data.key_amounts.length > 0 && (
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <DollarSign className="w-4 h-4 text-emerald-400" /> Key Amounts
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {data.key_amounts.map((a, i) => (
                        <div key={i} className="flex items-center justify-between gap-2">
                          <span className="text-xs text-slate-700">{a.description}</span>
                          <span className="text-sm font-bold text-emerald-400">{a.currency} {a.amount.toLocaleString()}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}

                {/* Legal Acts */}
                {data.legal_acts_cited.length > 0 && (
                  <Card className="bg-white border-slate-200">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                        <BookOpen className="w-4 h-4 text-[#C7B15B]" /> Acts Cited
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="flex flex-wrap gap-1.5">
                        {data.legal_acts_cited.map((act, i) => (
                          <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">{act}</span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>

              {/* Risk Flags */}
              {data.risk_flags.length > 0 && (
                <Card className="bg-red-500/5 border-red-500/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-red-700 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4" /> Risk Flags ({data.risk_flags.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {data.risk_flags.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-red-700">
                        <span className="mt-0.5">⚠</span> {f}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Key Clauses */}
              {data.key_clauses.length > 0 && (
                <Card className="bg-white border-slate-200">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold text-slate-800 flex items-center gap-2">
                      <Scale className="w-4 h-4 text-[#C7B15B]" /> Key Clauses
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1.5">
                    {data.key_clauses.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-slate-700">
                        <span className="text-[#C7B15B] mt-0.5">›</span> {c}
                      </div>
                    ))}
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
