import { getAuthToken } from '@/lib/jrx-auth-token';
import { nv } from '@/lib/jrx-api-paths';
/**
 * Intelligence: Legal Translation — E9
 * POST /api/jrx/v1/sdk/intelligence/translate-legal
 * Supports 47 Indian and international languages
 * Jurexio Enterprise Platform 5.1.0
 */

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NyvEmptyState } from '@/components/NyvEmptyState';
import { useToast } from '@/hooks/use-toast';
import {
  Globe2, Brain, ChevronRight, RefreshCw, Copy, CheckCheck,
  ArrowRightLeft, FileText, AlertTriangle, Sparkles, Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TranslationResult {
  translated_text: string;
  source_language: string;
  target_language: string;
  preserved_terms: string[];
  untranslated_terms: string[];
  quality_score: number;
  translation_notes: string[];
  detected_document_type: string;
}

interface TranslateResponse {
  success: boolean;
  data: TranslationResult;
  generated_at: string;
  cached: boolean;
}

// ─── Language Catalog (47 languages) ─────────────────────────────────────────

const LANGUAGES = [
  { value: 'en', label: 'English', script: 'Latin' },
  { value: 'hi', label: 'Hindi (हिंदी)', script: 'Devanagari' },
  { value: 'ta', label: 'Tamil (தமிழ்)', script: 'Tamil' },
  { value: 'te', label: 'Telugu (తెలుగు)', script: 'Telugu' },
  { value: 'kn', label: 'Kannada (ಕನ್ನಡ)', script: 'Kannada' },
  { value: 'ml', label: 'Malayalam (മലയാളം)', script: 'Malayalam' },
  { value: 'mr', label: 'Marathi (मराठी)', script: 'Devanagari' },
  { value: 'gu', label: 'Gujarati (ગુજરાતી)', script: 'Gujarati' },
  { value: 'pa', label: 'Punjabi (ਪੰਜਾਬੀ)', script: 'Gurmukhi' },
  { value: 'bn', label: 'Bengali (বাংলা)', script: 'Bengali' },
  { value: 'or', label: 'Odia (ଓଡ଼ିଆ)', script: 'Odia' },
  { value: 'as', label: 'Assamese (অসমীয়া)', script: 'Bengali' },
  { value: 'ur', label: 'Urdu (اردو)', script: 'Nasta\'liq' },
  { value: 'sa', label: 'Sanskrit (संस्कृत)', script: 'Devanagari' },
  { value: 'kok', label: 'Konkani (कोंकणी)', script: 'Devanagari' },
  { value: 'mai', label: 'Maithili (मैथिली)', script: 'Devanagari' },
  { value: 'ne', label: 'Nepali (नेपाली)', script: 'Devanagari' },
  { value: 'si', label: 'Sinhala (සිංහල)', script: 'Sinhala' },
  { value: 'ar', label: 'Arabic (العربية)', script: 'Arabic' },
  { value: 'fr', label: 'French (Français)', script: 'Latin' },
  { value: 'de', label: 'German (Deutsch)', script: 'Latin' },
  { value: 'es', label: 'Spanish (Español)', script: 'Latin' },
  { value: 'pt', label: 'Portuguese (Português)', script: 'Latin' },
  { value: 'zh', label: 'Chinese (中文)', script: 'Han' },
  { value: 'ja', label: 'Japanese (日本語)', script: 'Kanji' },
  { value: 'ko', label: 'Korean (한국어)', script: 'Hangul' },
  { value: 'ru', label: 'Russian (Русский)', script: 'Cyrillic' },
];

const DOC_TYPES = [
  'Petition', 'Bail Application', 'FIR', 'Judgment', 'Order',
  'Affidavit', 'Contract', 'Notice', 'Written Arguments', 'Charge Sheet',
];

const FORMALITY_OPTS = [
  { value: 'formal', label: 'Formal (Court language)' },
  { value: 'neutral', label: 'Neutral (Standard)' },
  { value: 'plain', label: 'Plain (Citizen-friendly)' },
];

// ─── Quality Indicator ────────────────────────────────────────────────────────

function QualityBadge({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const cfg = pct >= 85 ? { color: 'border-emerald-500/40 text-emerald-700', label: `High Quality · ${pct}%` }
    : pct >= 65 ? { color: 'border-amber-200 text-amber-700', label: `Good Quality · ${pct}%` }
    : { color: 'border-red-200 text-red-700', label: `Review Needed · ${pct}%` };
  return <Badge variant="outline" className={cn('border text-xs', cfg.color)}>{cfg.label}</Badge>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function IntelligenceTranslate() {
  const { toast } = useToast();
  const [sourceText, setSourceText] = useState('');
  const [sourceLang, setSourceLang] = useState('en');
  const [targetLang, setTargetLang] = useState('hi');
  const [docType, setDocType] = useState('');
  const [formality, setFormality] = useState('formal');
  const [preserveTerms, setPreserveTerms] = useState(true);
  const [result, setResult] = useState<TranslateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const token = getAuthToken();
      const res = await fetch(nv('v1/sdk/intelligence/translate-legal'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          text: sourceText,
          source_language: sourceLang,
          target_language: targetLang,
          preserve_legal_terms: preserveTerms,
          document_type: docType || undefined,
          formality,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Translation failed');
      return res.json() as Promise<TranslateResponse>;
    },
    onSuccess: (data) => {
      setResult(data);
      toast({ title: 'Translation complete', description: `Quality score: ${Math.round(data.data.quality_score * 100)}%` });
    },
    onError: (e: Error) => toast({ title: 'Translation failed', description: e.message, variant: 'destructive' }),
  });

  const swapLanguages = () => { setSourceLang(targetLang); setTargetLang(sourceLang); };

  const copyTranslation = () => {
    if (!result?.data.translated_text) return;
    navigator.clipboard.writeText(result.data.translated_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const data = result?.data;
  const sourceLangName = LANGUAGES.find(l => l.value === sourceLang)?.label ?? sourceLang;
  const targetLangName = LANGUAGES.find(l => l.value === targetLang)?.label ?? targetLang;

  return (
    <div className="min-h-screen bg-[#F5F8FE] text-[#1E3A5E] p-4 md:p-6">
      <div className="mb-6">
        <div className="flex items-center gap-2 text-xs text-slate-700 mb-2">
          <Brain className="w-3.5 h-3.5" /> Intelligence Hub
          <ChevronRight className="w-3 h-3" />
          <span className="text-[#C7B15B]">Legal Translation (E9)</span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-[#152448] flex items-center gap-2">
              <Globe2 className="w-6 h-6 text-[#C7B15B]" /> Legal Translation
            </h1>
            <p className="text-slate-600 mt-1 text-sm">AI-powered legal document translation preserving legal terminology across 47 languages with formality control</p>
          </div>
          <Badge variant="outline" className="border-[#C7B15B]/40 text-[#C7B15B] text-xs flex-shrink-0">E9 · 47 Languages</Badge>
        </div>
      </div>

      {/* Controls */}
      <Card className="bg-white border-slate-200 mb-4">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-slate-600">From</Label>
              <Select value={sourceLang} onValueChange={setSourceLang}>
                <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-100 border-slate-200 max-h-64">
                  {LANGUAGES.map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <button onClick={swapLanguages} className="mt-5 p-2 rounded-lg bg-slate-100 border border-slate-200 text-slate-700 hover:text-[#152448] hover:border-[#C7B15B]/50 transition-colors">
              <ArrowRightLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-slate-600">To</Label>
              <Select value={targetLang} onValueChange={setTargetLang}>
                <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-100 border-slate-200 max-h-64">
                  {LANGUAGES.filter(l => l.value !== sourceLang).map(l => <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-slate-600">Formality</Label>
              <Select value={formality} onValueChange={setFormality}>
                <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {FORMALITY_OPTS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <Label className="text-xs text-slate-600">Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="bg-white border-slate-200 text-sm h-9">
                  <SelectValue placeholder="Auto-detect" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200">
                  {DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={preserveTerms} onChange={e => setPreserveTerms(e.target.checked)}
              className="rounded border-slate-300 bg-slate-100" />
            <span className="text-xs text-slate-600">Preserve untranslated legal terms (Latin maxims, citations, section numbers)</span>
          </label>
        </CardContent>
      </Card>

      {/* Translation Area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        {/* Source */}
        <Card className="bg-white border-slate-200">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{sourceLangName}</CardTitle>
              <span className="text-[10px] text-slate-600">{sourceText.length}/20000</span>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={12}
              placeholder="Paste legal text to translate..."
              className="bg-slate-100/50 border-slate-200 text-sm resize-none leading-relaxed"
              value={sourceText}
              onChange={e => setSourceText(e.target.value)}
            />
          </CardContent>
        </Card>

        {/* Translation Output */}
        <Card className={cn('border', data ? 'bg-white border-slate-200' : 'bg-white/50 border-slate-200/50')}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{targetLangName}</CardTitle>
              {data && (
                <button onClick={copyTranslation} className="p-1.5 rounded text-slate-700 hover:text-[#152448] hover:bg-slate-100 transition-colors">
                  {copied ? <CheckCheck className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {mutation.isPending ? (
              <div className="flex flex-col items-center justify-center h-48 gap-3">
                <div className="w-10 h-10 rounded-full border-3 border-[#C7B15B]/30 border-t-[#C7B15B] animate-spin" />
                <p className="text-xs text-slate-700">Translating with legal accuracy...</p>
              </div>
            ) : data ? (
              <div className="text-sm text-slate-800 leading-relaxed bg-slate-100/50 rounded-lg p-3 min-h-48 whitespace-pre-wrap font-serif">
                {data.translated_text}
              </div>
            ) : (
              <div className="flex items-center justify-center h-48 text-slate-600 text-xs">
                Translation will appear here
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Translate Button */}
      <Button
        onClick={() => mutation.mutate()}
        disabled={sourceText.length < 5 || mutation.isPending}
        className="w-full bg-[#C7B15B] hover:bg-[#b8891a] text-slate-900 font-semibold mb-6"
      >
        {mutation.isPending ? <><RefreshCw className="w-4 h-4 mr-2 animate-spin" /> Translating...</>
          : <><Globe2 className="w-4 h-4 mr-2" /> Translate Legal Document</>}
      </Button>

      {/* Metadata */}
      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="bg-white border-slate-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                <Sparkles className="w-3.5 h-3.5 text-[#C7B15B]" /> Translation Quality
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <QualityBadge score={data.quality_score} />
              {data.detected_document_type && (
                <p className="text-xs text-slate-600">Detected: <span className="text-slate-700 font-medium">{data.detected_document_type}</span></p>
              )}
              {result?.cached && <p className="text-xs text-slate-600">Served from cache</p>}
            </CardContent>
          </Card>

          {data.preserved_terms.length > 0 && (
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-blue-400" /> Preserved Terms ({data.preserved_terms.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1.5">
                  {data.preserved_terms.slice(0, 15).map((t, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700 font-mono">{t}</span>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {data.translation_notes?.length > 0 && (
            <Card className="bg-white border-slate-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-xs font-semibold text-slate-600 flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" /> Translator Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {data.translation_notes.map((n, i) => (
                  <p key={i} className="text-xs text-slate-600">{n}</p>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
