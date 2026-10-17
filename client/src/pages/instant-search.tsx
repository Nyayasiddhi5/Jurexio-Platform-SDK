/**
 * Instant Search — Console typeahead over Knowledge Plane (statutes + caselaw).
 * SDK 5.0.7 surface: nyv.instantSearch.* → /api/jrx/knowledge/* (no /instant-search route).
 * Brand: Jurexio navy/gold — BRAND tokens.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { Search, BookMarked, Gavel, ExternalLink, Loader2 } from 'lucide-react';
import { NyvPageShell } from '@/components/NyvPageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BRAND, BRAND_FONTS } from '@/lib/brand';
import { p, nv } from '@/lib/jrx-api-paths';
import { getAuthToken } from '@/lib/jrx-auth-token';
import { ExecutionTraceRail } from '@/components/execution/ExecutionTraceRail';
import { GoodLawPanel } from '@/components/execution/GoodLawPanel';
import type { LegalChatTimelineEvent } from '@/services/legal-chat-api';

type Mode = 'fts' | 'hybrid';
type CourtTier = 'all' | 'sc' | 'hc';

async function authGet(url: string, signal?: AbortSignal): Promise<any> {
  const t = getAuthToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await fetch(url, { credentials: 'include', headers, signal });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const json = await res.json();
  if (json && typeof json === 'object' && 'success' in json && 'data' in json) {
    if (!json.success) throw new Error(json.error?.message || json.message || 'Request failed');
    return json.data;
  }
  return json;
}

export default function InstantSearchPage() {
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('fts');
  const [courtTier, setCourtTier] = useState<CourtTier>('all');
  const [loading, setLoading] = useState(false);
  const [statutes, setStatutes] = useState<any[]>([]);
  const [caselaw, setCaselaw] = useState<any[]>([]);
  const [railEvents, setRailEvents] = useState<LegalChatTimelineEvent[]>([]);
  const [railOrch, setRailOrch] = useState<string | undefined>();
  /* NV-GOOD-LAW-PANEL-001 — the authority the reader has asked about. Held
   * separately from the result list so a new search cannot leave one case's
   * treatment verdict beside another case's row. */
  const [goodLawAuthority, setGoodLawAuthority] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = useCallback(async (query: string, searchMode: Mode) => {
    if (query.trim().length < 2) {
      setStatutes([]);
      setCaselaw([]);
      setError(null);
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError(null);
    try {
      const qsStat = new URLSearchParams({ q: query, jurisdiction: 'IN', limit: '8' });
      const qsCase = new URLSearchParams({ q: query, jurisdiction: 'IN', limit: '8', mode: searchMode });
      if (courtTier !== 'all') qsCase.set('courtType', courtTier);
      if (searchMode === 'fts' && courtTier === 'hc') {
        const y = new Date().getFullYear();
        qsCase.set('yearFrom', String(Math.max(2020, y - 3)));
        qsCase.set('yearTo', String(y));
      }
      const [st, cl] = await Promise.all([
        authGet(`${p('KNOWLEDGE_STATUTES_SEARCH')}?${qsStat}`, ac.signal),
        authGet(`${p('KNOWLEDGE_CASELAW_SEARCH')}?${qsCase}`, ac.signal),
      ]);
      if (ac.signal.aborted) return;
      const stList = Array.isArray(st?.results) ? st.results
        : Array.isArray(st?.items) ? st.items
        : Array.isArray(st) ? st : [];
      const clList = Array.isArray(cl?.results) ? cl.results
        : Array.isArray(cl?.hits) ? cl.hits
        : Array.isArray(cl?.items) ? cl.items
        : Array.isArray(cl) ? cl : [];
      setStatutes(stList.slice(0, 8));
      setCaselaw(clList.slice(0, 8));
      setGoodLawAuthority(null);
      const orch = `search-${Date.now()}`;
      setRailOrch(orch);
      const titles = [...stList, ...clList].slice(0, 6).map((x: any) => x?.title || x?.citation || x?.id).filter(Boolean);
      setRailEvents([
        { orchestrationId: orch, step: 'request_received', status: 'ok', ts: Date.now(), data: { prompt: query, mode: searchMode } },
        {
          orchestrationId: orch, step: 'rag_retrieval', status: 'ok', ts: Date.now(),
          data: {
            collection: 'knowledge-plane',
            chunks: stList.length + clList.length,
            sources: titles,
            tiers: ['statutes', 'caselaw'],
          },
        },
        { orchestrationId: orch, step: 'run_complete', status: 'ok', ts: Date.now(), data: { citations: titles } },
      ]);
    } catch (e: any) {
      if (e?.name === 'AbortError') return;
      setError(e?.message || 'Search failed');
      setStatutes([]);
      setCaselaw([]);
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [courtTier]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void runSearch(q, mode); }, 280);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [q, mode, courtTier, runSearch]);

  return (
    <NyvPageShell
      title="Instant Search"
      description="Typeahead over statutes and SC/HC caselaw (1950–2026) via the Knowledge Plane. Default FTS — best for recent HC rows; hybrid adds semantic RRF where embeddings exist."
      className="./jrx-light-scope"
      testId="instant-search"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/nys-knowledge-plane')}>
            Knowledge Plane
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/legal-intelligence-feed')}>
            Legal Feed
          </Button>
        </div>
      }
    >
      <div
        className="mb-4 rounded-lg border px-4 py-3 text-sm"
        style={{ borderColor: BRAND.border, background: BRAND.primarySoft, color: BRAND.textSecondary }}
      >
        Partner SDK: <code className="text-xs">nyv.instantSearch.caselaw(q, {'{'} mode: &apos;fts&apos;, courtType: &apos;hc&apos; {'}'})</code>
        {' '}· Grounding: NYS plane → RAG → legal feed / web search · CNR ≠ live eCourts.
      </div>

      <Card className="mb-6 border shadow-none" style={{ borderColor: BRAND.border }}>
        <CardContent className="pt-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: BRAND.accent }} />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="BNS 103, anticipatory bail, cheating…"
              className="pl-10 h-11"
              style={{ fontFamily: BRAND_FONTS.body }}
              data-testid="instant-search-input"
              autoFocus
            />
            {loading && (
              <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" style={{ color: BRAND.primary }} />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>Caselaw mode</span>
            {(['fts', 'hybrid'] as Mode[]).map((m) => (
              <Button
                key={m}
                size="sm"
                variant={mode === m ? 'default' : 'outline'}
                onClick={() => setMode(m)}
                style={mode === m ? { background: BRAND.primary } : undefined}
              >
                {m}
              </Button>
            ))}
            <span className="text-xs uppercase tracking-wider ml-2" style={{ color: BRAND.textSecondary }}>Court</span>
            {(['all', 'sc', 'hc'] as CourtTier[]).map((c) => (
              <Button
                key={c}
                size="sm"
                variant={courtTier === c ? 'default' : 'outline'}
                onClick={() => setCourtTier(c)}
                style={courtTier === c ? { background: BRAND.accent, color: BRAND.primary } : undefined}
              >
                {c === 'all' ? 'All' : c.toUpperCase()}
              </Button>
            ))}
            <Badge variant="outline" className="ml-auto text-[10px]">jurisdiction=IN · min 2 chars</Badge>
          </div>
          {error && (
            <p className="text-sm" style={{ color: BRAND.error }}>{error}</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border shadow-none" style={{ borderColor: BRAND.border }}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base" style={{ fontFamily: BRAND_FONTS.heading, color: BRAND.primary }}>
              <BookMarked className="h-4 w-4" style={{ color: BRAND.accent }} />
              Statutes
              <Badge variant="secondary" className="ml-auto">{statutes.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {q.trim().length < 2 && (
              <p className="text-sm" style={{ color: BRAND.textSecondary }}>Type at least 2 characters…</p>
            )}
            {statutes.map((row, i) => (
              <div key={i} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: BRAND.border, background: BRAND.surface }}>
                <div className="font-medium" style={{ color: BRAND.primary }}>
                  {row.actShortName || row.code || row.act || 'Act'} {row.sectionNumber || row.section || ''}
                </div>
                <div className="text-xs mt-0.5 line-clamp-2" style={{ color: BRAND.textSecondary }}>
                  {row.title || row.sectionTitle || row.snippet || row.text || '—'}
                </div>
              </div>
            ))}
            {q.trim().length >= 2 && !loading && statutes.length === 0 && (
              <p className="text-sm" style={{ color: BRAND.textSecondary }}>No statute hits.</p>
            )}
          </CardContent>
        </Card>

        <Card className="border shadow-none" style={{ borderColor: BRAND.border }}>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base" style={{ fontFamily: BRAND_FONTS.heading, color: BRAND.primary }}>
              <Gavel className="h-4 w-4" style={{ color: BRAND.accent }} />
              Caselaw
              <Badge variant="secondary" className="ml-auto">{caselaw.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {caselaw.map((row, i) => {
              /* Prefer the reporter citation: it is what `exact=true` can match
               * on. A title falls back to party-name token matching, which is
               * the weaker mode that once matched "Kesavananda Bharati" to a
               * case named "KESAVAN". */
              const authority = String(row.citation || row.caseName || row.title || '').trim();
              const selected = !!authority && goodLawAuthority === authority;
              return (
                <div key={i} className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: BRAND.border, background: BRAND.surface }}>
                  <div className="font-medium line-clamp-1" style={{ color: BRAND.primary }}>
                    {row.caseName || row.title || row.citation || row.id || 'Case'}
                  </div>
                  <div className="text-xs mt-0.5 line-clamp-2" style={{ color: BRAND.textSecondary }}>
                    {[row.court, row.year, row.citation].filter(Boolean).join(' · ') || row.snippet || '—'}
                  </div>
                  {authority ? (
                    <button
                      type="button"
                      onClick={() => setGoodLawAuthority(selected ? null : authority)}
                      className="mt-1.5 text-xs underline-offset-2 hover:underline"
                      style={{ color: BRAND.info }}
                      data-testid="instant-search-good-law-open"
                    >
                      {selected ? 'Hide good-law check' : 'Is this still good law?'}
                    </button>
                  ) : null}
                  {selected ? (
                    <div className="mt-1 rounded-md border" style={{ borderColor: BRAND.border }}>
                      <GoodLawPanel citation={authority} compact />
                    </div>
                  ) : null}
                </div>
              );
            })}
            {q.trim().length >= 2 && !loading && caselaw.length === 0 && (
              <p className="text-sm" style={{ color: BRAND.textSecondary }}>No caselaw hits (try FTS).</p>
            )}
          </CardContent>
        </Card>
      </div>

      {railEvents.length > 0 ? (
        <div className="mt-4">
          <ExecutionTraceRail events={railEvents} orchestrationId={railOrch} compact title="Search retrieval rail" />
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-3 text-sm">
        <a
          href="https://nyayasearch.jurexio.example/statutes"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
          style={{ color: BRAND.info }}
        >
          Open full Statutes on NyayaSearch <ExternalLink className="h-3 w-3" />
        </a>
        <span style={{ color: BRAND.border }}>|</span>
        <button
          type="button"
          className="underline-offset-2 hover:underline"
          style={{ color: BRAND.info }}
          onClick={() => navigate('/statutes-citations')}
        >
          Statutes & Citations
        </button>
        <span className="text-xs" style={{ color: BRAND.textSecondary }}>
          Probe: {nv('knowledge/statutes/search')}
        </span>
      </div>
    </NyvPageShell>
  );
}
