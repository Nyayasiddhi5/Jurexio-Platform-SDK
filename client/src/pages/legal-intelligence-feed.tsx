/**
 * Live Legal Intelligence Feed — own RSS → S3/RDS/RAG (no Tavily by default).
 * Top items fuse into Auto-RAG as `legal_intel_feed` for IN counsel research.
 * SDK: getLegalFeed / getRegulatoryFeed · orchestrate adds live web search when needed.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Newspaper, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { JrxPageShell } from '@/components/JrxPageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { BRAND, BRAND_FONTS } from '@/lib/brand';
import { p } from '@/lib/jrx-api-paths';
import { apiRequest } from '@/lib/queryClient';

function asList(payload: any, ...keys: string[]): any[] {
  if (Array.isArray(payload)) return payload;
  for (const k of keys) {
    if (Array.isArray(payload?.[k])) return payload[k];
  }
  return [];
}

export default function LegalIntelligenceFeedPage() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [jurisdiction] = useState('IN');

  const feed = useQuery({
    queryKey: [p('LEGAL_INTEL_FEED'), jurisdiction],
    queryFn: () => apiRequest(`${p('LEGAL_INTEL_FEED')}?jurisdiction=${jurisdiction}`),
    refetchInterval: 120_000,
  });

  const history = useQuery({
    queryKey: [p('LEGAL_INTEL_FEED_HISTORY'), jurisdiction],
    queryFn: () => apiRequest(`${p('LEGAL_INTEL_FEED_HISTORY')}?jurisdiction=${jurisdiction}&limit=10`),
  });

  const reg = useQuery({
    queryKey: [p('INTELLIGENCE_REGULATORY_FEED'), jurisdiction],
    queryFn: () => apiRequest(`${p('INTELLIGENCE_REGULATORY_FEED')}?jurisdiction=${jurisdiction}&limit=20`),
  });

  const generate = useMutation({
    mutationFn: () => apiRequest('POST', p('LEGAL_INTEL_FEED_GENERATE'), { jurisdiction, topN: 10 }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [p('LEGAL_INTEL_FEED')] });
      void qc.invalidateQueries({ queryKey: [p('LEGAL_INTEL_FEED_HISTORY')] });
      void qc.invalidateQueries({ queryKey: [p('INTELLIGENCE_REGULATORY_FEED')] });
    },
  });

  const items = asList(feed.data, 'items', 'updates', 'digest');
  const histItems = asList(history.data, 'items', 'history');
  const regItems = asList(reg.data, 'updates', 'items');

  const emptyHonest = !feed.isLoading && items.length === 0;

  return (
    <JrxPageShell
      title="Live Legal Feed"
      description="Daily legal intelligence digest (own RSS → S3/RDS/RAG). Top items feed Auto-RAG counsel research; breaking news also via live web search on orchestrate."
      className="./jrx-light-scope"
      testId="legal-intelligence-feed"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => generate.mutate()}
            disabled={generate.isPending}
            style={{ background: BRAND.primary }}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${generate.isPending ? 'animate-spin' : ''}`} />
            Generate digest
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/instant-search')}>
            Instant Search
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/regulatory')}>
            Regulatory ops
          </Button>
        </div>
      }
    >
      <div
        className="mb-4 rounded-lg border px-4 py-3 text-sm flex flex-wrap gap-3 items-start"
        style={{ borderColor: BRAND.border, background: BRAND.accentSoft, color: BRAND.textPrimary }}
      >
        <Newspaper className="h-4 w-4 mt-0.5 shrink-0" style={{ color: BRAND.accent }} />
        <div>
          <div style={{ fontFamily: BRAND_FONTS.heading }} className="font-semibold">Counsel grounding pipeline</div>
          <p className="text-xs mt-1" style={{ color: BRAND.textSecondary }}>
            Own RSS ingest (LiveLaw, Bar &amp; Bench, …) → LLM-ranked digest →{' '}
            <code>GET /api/jrx/v1/sdk/legal-intelligence/feed</code>. Top 3 items fuse into Auto-RAG as{' '}
            <code>legal_intel_feed</code> for IN research. Live web search (Gemini/Tavily cascade) supplements
            recent HC rows and current-year facts on <code>/api/jrx/orchestrate</code>. SDK:{' '}
            <code>getLegalFeed</code> / <code>getRegulatoryFeed</code>.
          </p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-6">
        <Card className="border shadow-none" style={{ borderColor: BRAND.border }}>
          <CardContent className="pt-5">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>Digest items</div>
            <div className="text-2xl font-bold mt-1" style={{ color: BRAND.primary, fontFamily: BRAND_FONTS.heading }}>
              {feed.isLoading ? '…' : items.length}
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-none" style={{ borderColor: BRAND.border }}>
          <CardContent className="pt-5">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>History rows</div>
            <div className="text-2xl font-bold mt-1" style={{ color: BRAND.primary, fontFamily: BRAND_FONTS.heading }}>
              {history.isLoading ? '…' : histItems.length}
            </div>
          </CardContent>
        </Card>
        <Card className="border shadow-none" style={{ borderColor: BRAND.border }}>
          <CardContent className="pt-5">
            <div className="text-[11px] uppercase tracking-wider" style={{ color: BRAND.textSecondary }}>Regulatory updates</div>
            <div className="text-2xl font-bold mt-1" style={{ color: BRAND.primary, fontFamily: BRAND_FONTS.heading }}>
              {reg.isLoading ? '…' : regItems.length}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border shadow-none mb-6" style={{ borderColor: BRAND.border }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2" style={{ fontFamily: BRAND_FONTS.heading, color: BRAND.primary }}>
            Today&apos;s digest
            <Badge variant="outline" className="ml-auto">{jurisdiction}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {feed.isLoading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          {emptyHonest && (
            <div
              className="flex items-start gap-3 rounded-md border border-dashed p-6"
              style={{ borderColor: BRAND.border, color: BRAND.textSecondary }}
            >
              <AlertCircle className="h-5 w-5 shrink-0" style={{ color: BRAND.warning }} />
              <div>
                <p className="font-medium" style={{ color: BRAND.primary }}>No digest yet (honest empty)</p>
                <p className="text-sm mt-1">
                  Daily job runs after UTC hour configured by <code>JRX_LEGAL_INTEL_CRON_HOUR_UTC</code>.
                  Use <strong>Generate digest</strong> to archive candidates now.
                </p>
              </div>
            </div>
          )}
          {items.map((it, i) => (
            <div key={i} className="rounded-md border px-3 py-3" style={{ borderColor: BRAND.border }}>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" style={{ color: BRAND.success }} />
                <div className="min-w-0">
                  <div className="font-medium text-sm" style={{ color: BRAND.primary }}>
                    {it.title || it.headline || it.source_name || `Update ${i + 1}`}
                  </div>
                  <p className="text-xs mt-1 line-clamp-3" style={{ color: BRAND.textSecondary }}>
                    {it.summary || it.description || it.snippet || it.url || '—'}
                  </p>
                  {(it.url || it.feed_url) && (
                    <a
                      href={it.url || it.feed_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs mt-1 inline-block underline-offset-2 hover:underline"
                      style={{ color: BRAND.info }}
                    >
                      Source
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
          {generate.isError && (
            <p className="text-sm" style={{ color: BRAND.error }}>Generate failed — check auth / gateway logs.</p>
          )}
        </CardContent>
      </Card>

      <Card className="border shadow-none" style={{ borderColor: BRAND.border }}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base" style={{ fontFamily: BRAND_FONTS.heading, color: BRAND.primary }}>
            Regulatory feed (own RDS)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {reg.isLoading && <Skeleton className="h-20 w-full" />}
          {!reg.isLoading && regItems.length === 0 && (
            <p className="text-sm" style={{ color: BRAND.textSecondary }}>
              No regulatory rows yet — ingest fills <code>nv_regulatory_feeds</code> on generate/archive.
            </p>
          )}
          {regItems.slice(0, 12).map((it, i) => (
            <div key={i} className="text-sm border-b py-2 last:border-0" style={{ borderColor: BRAND.border }}>
              <span style={{ color: BRAND.primary }}>{it.source_name || it.source || it.title || 'Feed'}</span>
              <span className="text-xs ml-2" style={{ color: BRAND.textSecondary }}>
                {it.feed_type || it.category || ''} {it.last_fetched_at ? `· ${String(it.last_fetched_at).slice(0, 10)}` : ''}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </JrxPageShell>
  );
}
