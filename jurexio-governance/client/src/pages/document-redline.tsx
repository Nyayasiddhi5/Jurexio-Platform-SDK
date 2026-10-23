import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  GitCompareArrows, Combine, Highlighter, Loader2, AlertTriangle,
  CheckCircle, ShieldAlert, FileText,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { apiRequest } from '@/lib/queryClient';
import { nv } from '@/lib/jrx-api-paths';

const C = {
  navy: '#152448',
  gold: '#C7B15B',
  emerald: '#1C7A4F',
  red: '#B91C1C',
  amber: '#B45309',
  bg: '#F8FAFC',
  border: '#E2E8F0',
};

type RedlineSegment = { type: 'unchanged' | 'added' | 'removed'; text: string };
type RedlineResult = {
  stats?: { added: number; removed: number; unchanged: number };
  segments?: RedlineSegment[];
  unified?: string;
  semanticSummary?: string;
  materialChanges?: string[];
};
type MergeResult = {
  merged?: string;
  conflicts?: Array<{ clause?: string; detail?: string } | string>;
  dedupedCount?: number;
  sources?: number;
};
type HighlightSpan = { start: number; end: number; category?: string; severity?: string; label?: string };
type HighlightResult = {
  documentType?: string;
  confidenceScore?: number;
  highlights?: HighlightSpan[];
  risks?: Array<{ title?: string; severity?: string; description?: string }>;
  privacyAlerts?: Array<{ type?: string; detail?: string } | string>;
  missingTerms?: string[];
};

function unwrap<T>(raw: any): T {
  return (raw?.data ?? raw) as T;
}

function severityColor(sev?: string): string {
  const s = (sev || '').toLowerCase();
  if (s.includes('high') || s.includes('critical')) return C.red;
  if (s.includes('med')) return C.amber;
  return C.emerald;
}

export default function DocumentRedline() {
  // Redline state
  const [docA, setDocA] = useState('');
  const [docB, setDocB] = useState('');
  const [semantic, setSemantic] = useState(true);
  const [jurisdiction, setJurisdiction] = useState('IN');

  // Merge state
  const [mergeA, setMergeA] = useState('');
  const [mergeB, setMergeB] = useState('');
  const [mergeTitleA, setMergeTitleA] = useState('Document A');
  const [mergeTitleB, setMergeTitleB] = useState('Document B');
  const [dedupe, setDedupe] = useState(true);

  // Highlight state
  const [hlText, setHlText] = useState('');

  const redlineMut = useMutation({
    mutationFn: async (): Promise<RedlineResult> => {
      const raw = await apiRequest(nv('documents/redline'), 'POST', {
        documentA: docA, documentB: docB, semantic, jurisdiction,
      });
      return unwrap<RedlineResult>(raw);
    },
  });

  const mergeMut = useMutation({
    mutationFn: async (): Promise<MergeResult> => {
      const raw = await apiRequest(nv('documents/merge'), 'POST', {
        documents: [
          { title: mergeTitleA, text: mergeA },
          { title: mergeTitleB, text: mergeB },
        ],
        dedupeClauses: dedupe,
      });
      return unwrap<MergeResult>(raw);
    },
  });

  const highlightMut = useMutation({
    mutationFn: async (): Promise<HighlightResult> => {
      const raw = await apiRequest(nv('documents/highlight'), 'POST', { text: hlText });
      return unwrap<HighlightResult>(raw);
    },
  });

  const redline = redlineMut.data;
  const merge = mergeMut.data;
  const highlight = highlightMut.data;

  return (
    <div className="min-h-screen p-6 space-y-6" style={{ background: C.bg }} data-testid="page-document-redline">
      <div className="flex items-start gap-3">
        <div className="p-2.5 rounded-xl" style={{ background: 'rgba(10,42,102,0.08)' }}>
          <GitCompareArrows className="w-7 h-7" style={{ color: C.navy }} />
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.navy, fontFamily: 'Merriweather, serif' }}>
              Redline · Merge · Highlight
            </h1>
            <Badge variant="outline" style={{ borderColor: C.gold, color: C.gold }}>Document Orchestrator</Badge>
          </div>
          <p className="text-sm mt-1" style={{ color: '#475569' }}>
            Track-changes diff, structured clause merge, and risk highlighting — backed by the live
            <span className="font-mono"> /api/jrx/documents</span> orchestrator.
          </p>
        </div>
      </div>

      <Tabs defaultValue="redline">
        <TabsList>
          <TabsTrigger value="redline" data-testid="tab-redline"><GitCompareArrows className="w-4 h-4 mr-1" /> Redline</TabsTrigger>
          <TabsTrigger value="merge" data-testid="tab-merge"><Combine className="w-4 h-4 mr-1" /> Merge</TabsTrigger>
          <TabsTrigger value="highlight" data-testid="tab-highlight"><Highlighter className="w-4 h-4 mr-1" /> Highlight</TabsTrigger>
        </TabsList>

        {/* ── REDLINE ─────────────────────────────────────────────── */}
        <TabsContent value="redline" className="mt-4 space-y-4">
          <Card style={{ borderColor: C.border }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base" style={{ color: C.navy }}>Compare two versions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold" style={{ color: '#475569' }}>Version A (original)</label>
                  <Textarea rows={10} value={docA} onChange={e => setDocA(e.target.value)} placeholder="Paste the original document text…" data-testid="redline-doc-a" />
                </div>
                <div>
                  <label className="text-xs font-semibold" style={{ color: '#475569' }}>Version B (revised)</label>
                  <Textarea rows={10} value={docB} onChange={e => setDocB(e.target.value)} placeholder="Paste the revised document text…" data-testid="redline-doc-b" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm" style={{ color: '#475569' }}>
                  <input type="checkbox" checked={semantic} onChange={e => setSemantic(e.target.checked)} />
                  Semantic material-change summary
                </label>
                <label className="flex items-center gap-2 text-sm" style={{ color: '#475569' }}>
                  Jurisdiction
                  <select value={jurisdiction} onChange={e => setJurisdiction(e.target.value)} className="border rounded px-2 py-1 text-sm" style={{ borderColor: C.border }}>
                    {['IN', 'UK', 'US', 'EU', 'SG', 'GC'].map(j => <option key={j} value={j}>{j}</option>)}
                  </select>
                </label>
                <Button
                  onClick={() => redlineMut.mutate()}
                  disabled={redlineMut.isPending || !docA.trim() || !docB.trim()}
                  data-testid="redline-run"
                  style={{ background: C.navy, color: '#fff' }}
                >
                  {redlineMut.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Comparing…</> : 'Generate Redline'}
                </Button>
              </div>
              {redlineMut.isError && (
                <p className="text-sm flex items-center gap-1" style={{ color: C.red }}>
                  <AlertTriangle className="w-4 h-4" /> {(redlineMut.error as Error)?.message || 'Redline failed'}
                </p>
              )}
            </CardContent>
          </Card>

          {redline && (
            <Card style={{ borderColor: C.border }} data-testid="redline-result">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2" style={{ color: C.navy }}>
                  Track changes
                  {redline.stats && (
                    <span className="text-xs font-normal">
                      <span style={{ color: C.emerald }}>+{redline.stats.added}</span>{' '}
                      <span style={{ color: C.red }}>−{redline.stats.removed}</span>{' '}
                      <span style={{ color: '#94A3B8' }}>={redline.stats.unchanged}</span>
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <pre className="text-xs whitespace-pre-wrap leading-relaxed rounded-lg p-3 max-h-96 overflow-auto" style={{ background: '#fff', border: `1px solid ${C.border}` }}>
                  {(redline.segments ?? []).map((s, i) => (
                    <span
                      key={i}
                      style={{
                        background: s.type === 'added' ? 'rgba(28,122,79,0.12)' : s.type === 'removed' ? 'rgba(185,28,28,0.10)' : 'transparent',
                        color: s.type === 'added' ? C.emerald : s.type === 'removed' ? C.red : '#1E293B',
                        textDecoration: s.type === 'removed' ? 'line-through' : 'none',
                      }}
                    >
                      {s.text}{'\n'}
                    </span>
                  ))}
                </pre>
                {redline.semanticSummary && (
                  <div className="rounded-lg p-3" style={{ background: 'rgba(212,160,23,0.06)', border: `1px solid ${C.gold}` }}>
                    <p className="text-xs font-bold mb-1" style={{ color: C.navy }}>Material changes</p>
                    <p className="text-sm" style={{ color: '#475569' }}>{redline.semanticSummary}</p>
                    {(redline.materialChanges ?? []).length > 0 && (
                      <ul className="list-disc ml-5 mt-2 text-sm" style={{ color: '#475569' }}>
                        {redline.materialChanges!.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── MERGE ───────────────────────────────────────────────── */}
        <TabsContent value="merge" className="mt-4 space-y-4">
          <Card style={{ borderColor: C.border }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base" style={{ color: C.navy }}>Merge documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Input value={mergeTitleA} onChange={e => setMergeTitleA(e.target.value)} placeholder="Title A" data-testid="merge-title-a" />
                  <Textarea rows={9} value={mergeA} onChange={e => setMergeA(e.target.value)} placeholder="First document text…" data-testid="merge-doc-a" />
                </div>
                <div className="space-y-2">
                  <Input value={mergeTitleB} onChange={e => setMergeTitleB(e.target.value)} placeholder="Title B" data-testid="merge-title-b" />
                  <Textarea rows={9} value={mergeB} onChange={e => setMergeB(e.target.value)} placeholder="Second document text…" data-testid="merge-doc-b" />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm" style={{ color: '#475569' }}>
                  <input type="checkbox" checked={dedupe} onChange={e => setDedupe(e.target.checked)} />
                  Dedupe identical clauses
                </label>
                <Button
                  onClick={() => mergeMut.mutate()}
                  disabled={mergeMut.isPending || !mergeA.trim() || !mergeB.trim()}
                  data-testid="merge-run"
                  style={{ background: C.navy, color: '#fff' }}
                >
                  {mergeMut.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Merging…</> : 'Merge Documents'}
                </Button>
              </div>
              {mergeMut.isError && (
                <p className="text-sm flex items-center gap-1" style={{ color: C.red }}>
                  <AlertTriangle className="w-4 h-4" /> {(mergeMut.error as Error)?.message || 'Merge failed'}
                </p>
              )}
            </CardContent>
          </Card>

          {merge && (
            <Card style={{ borderColor: C.border }} data-testid="merge-result">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2" style={{ color: C.navy }}>
                  <Combine className="w-4 h-4" style={{ color: C.gold }} /> Merged output
                  {typeof merge.dedupedCount === 'number' && (
                    <Badge variant="outline" style={{ borderColor: C.emerald, color: C.emerald }}>{merge.dedupedCount} clauses deduped</Badge>
                  )}
                  {(merge.conflicts ?? []).length > 0 && (
                    <Badge style={{ background: C.amber, color: '#fff' }}>{merge.conflicts!.length} conflicts</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(merge.conflicts ?? []).length > 0 && (
                  <div className="rounded-lg p-3" style={{ background: 'rgba(180,83,9,0.06)', border: `1px solid ${C.amber}` }}>
                    <p className="text-xs font-bold mb-1" style={{ color: C.amber }}>Conflicts detected</p>
                    <ul className="list-disc ml-5 text-sm" style={{ color: '#475569' }}>
                      {merge.conflicts!.map((c, i) => (
                        <li key={i}>{typeof c === 'string' ? c : `${c.clause ?? 'Clause'} — ${c.detail ?? ''}`}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <pre className="text-xs whitespace-pre-wrap leading-relaxed rounded-lg p-3 max-h-96 overflow-auto" style={{ background: '#fff', border: `1px solid ${C.border}`, color: '#1E293B' }}>
                  {merge.merged ?? '(no merged content returned)'}
                </pre>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── HIGHLIGHT ───────────────────────────────────────────── */}
        <TabsContent value="highlight" className="mt-4 space-y-4">
          <Card style={{ borderColor: C.border }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base" style={{ color: C.navy }}>Highlight risks &amp; findings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={12} value={hlText} onChange={e => setHlText(e.target.value)} placeholder="Paste the document to analyze (min 20 chars)…" data-testid="highlight-text" />
              <Button
                onClick={() => highlightMut.mutate()}
                disabled={highlightMut.isPending || hlText.trim().length < 20}
                data-testid="highlight-run"
                style={{ background: C.navy, color: '#fff' }}
              >
                {highlightMut.isPending ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Analyzing…</> : 'Analyze &amp; Highlight'}
              </Button>
              {highlightMut.isError && (
                <p className="text-sm flex items-center gap-1" style={{ color: C.red }}>
                  <AlertTriangle className="w-4 h-4" /> {(highlightMut.error as Error)?.message || 'Highlight failed'}
                </p>
              )}
            </CardContent>
          </Card>

          {highlight && (
            <div className="grid gap-4 lg:grid-cols-2" data-testid="highlight-result">
              <Card style={{ borderColor: C.border }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2" style={{ color: C.navy }}>
                    <FileText className="w-4 h-4" style={{ color: C.gold }} />
                    {highlight.documentType || 'Document'} · {(highlight.highlights ?? []).length} highlights
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs" style={{ color: '#64748B' }}>
                    Confidence: {typeof highlight.confidenceScore === 'number' ? `${Math.round(highlight.confidenceScore * 100)}%` : '—'}
                  </p>
                  <pre className="text-xs whitespace-pre-wrap leading-relaxed rounded-lg p-3 max-h-80 overflow-auto" style={{ background: '#fff', border: `1px solid ${C.border}`, color: '#1E293B' }}>
                    {renderHighlighted(hlText, highlight.highlights ?? [])}
                  </pre>
                </CardContent>
              </Card>

              <Card style={{ borderColor: C.border }}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2" style={{ color: C.navy }}>
                    <ShieldAlert className="w-4 h-4" style={{ color: C.red }} /> Findings
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(highlight.risks ?? []).length === 0 && (highlight.privacyAlerts ?? []).length === 0 && (highlight.missingTerms ?? []).length === 0 ? (
                    <p className="text-sm flex items-center gap-1" style={{ color: C.emerald }}>
                      <CheckCircle className="w-4 h-4" /> No material risks, privacy alerts, or missing terms detected.
                    </p>
                  ) : (
                    <>
                      {(highlight.risks ?? []).map((r, i) => (
                        <div key={i} className="rounded-lg p-2" style={{ borderLeft: `3px solid ${severityColor(r.severity)}`, background: '#fff', border: `1px solid ${C.border}` }}>
                          <p className="text-sm font-semibold" style={{ color: C.navy }}>
                            {r.title || 'Risk'} <Badge variant="outline" style={{ borderColor: severityColor(r.severity), color: severityColor(r.severity) }}>{r.severity || 'info'}</Badge>
                          </p>
                          {r.description && <p className="text-xs mt-1" style={{ color: '#475569' }}>{r.description}</p>}
                        </div>
                      ))}
                      {(highlight.privacyAlerts ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-bold" style={{ color: C.amber }}>Privacy alerts</p>
                          <ul className="list-disc ml-5 text-sm" style={{ color: '#475569' }}>
                            {highlight.privacyAlerts!.map((p, i) => <li key={i}>{typeof p === 'string' ? p : `${p.type ?? 'Alert'} — ${p.detail ?? ''}`}</li>)}
                          </ul>
                        </div>
                      )}
                      {(highlight.missingTerms ?? []).length > 0 && (
                        <div>
                          <p className="text-xs font-bold" style={{ color: C.navy }}>Missing standard terms</p>
                          <ul className="list-disc ml-5 text-sm" style={{ color: '#475569' }}>
                            {highlight.missingTerms!.map((m, i) => <li key={i}>{m}</li>)}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

/** Render the source text with highlight spans applied inline (offset-ordered). */
function renderHighlighted(text: string, spans: HighlightSpan[]) {
  if (!spans.length) return text;
  const ordered = [...spans].filter(s => s.start >= 0 && s.end > s.start).sort((a, b) => a.start - b.start);
  const out: React.ReactNode[] = [];
  let cursor = 0;
  ordered.forEach((s, i) => {
    if (s.start > cursor) out.push(<span key={`t${i}`}>{text.slice(cursor, s.start)}</span>);
    const color = severityColor(s.severity);
    out.push(
      <mark key={`h${i}`} style={{ background: `${color}22`, color, padding: '0 2px', borderRadius: 2 }} title={s.label || s.category}>
        {text.slice(s.start, s.end)}
      </mark>,
    );
    cursor = Math.max(cursor, s.end);
  });
  if (cursor < text.length) out.push(<span key="tail">{text.slice(cursor)}</span>);
  return out;
}
