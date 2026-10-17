/**
 * NV Legal Intelligence Feed — daily top-N legal news digest for NSP/NYM SDK.
 *
 * Pipeline:
 *  1) Ingest RSS via Knowledge Modules (news, SC/HC rulings, legislation)
 *  2) Pull own RSS + KM corpus + nv_regulatory_feeds (NO Tavily)
 *  3) Archive full docs to S3 + RAG via jrx-own-regulatory-feed-ingest
 *  4) LLM-orchestrate ranking into top 5–10 items
 *  5) Persist digest + ranked items for SDK retrieval
 */
import { sql } from 'drizzle-orm';
import { db as _rawDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';
import { callJurexio } from './jrx-client.js';
import { runAllModules } from './knowledge-module-service.js';
import { isSoftPolicyActive } from '../middleware/jrx-integration-soft-policy.js';

const db = lazyRequire(() => _rawDb, 'db');
const logger = createLogger('legal-intel-feed');

export type LegalIntelCategory =
  | 'statute'
  | 'act'
  | 'amendment'
  | 'sc_judgment'
  | 'hc_judgment'
  | 'legal_news'
  | 'regulatory';

export interface LegalIntelItem {
  id?: string;
  rank: number;
  category: LegalIntelCategory;
  title: string;
  summary: string;
  whyItMatters?: string;
  sourceUrl?: string | null;
  sourceName?: string | null;
  publishedAt?: string | null;
  jurisdiction?: string;
  tags?: string[];
}

export interface LegalIntelDigest {
  id: string;
  orgId: string;
  jurisdiction: string;
  digestDate: string;
  topN: number;
  title: string;
  summary: string;
  status: string;
  generatedAt: string;
  model?: string | null;
  items: LegalIntelItem[];
}

const DEFAULT_ORG = () =>
  String(process.env.JRX_LEGAL_INTEL_ORG_ID || process.env.NV_PLATFORM_ORG_ID || 'platform').trim();

const DEFAULT_TOP_N = () => {
  const n = Number(process.env.JRX_LEGAL_INTEL_TOP_N ?? 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(10, Math.max(5, Math.floor(n)));
};

let tablesReady = false;

async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  // Prefer probe-first: nv_app often cannot CREATE on public (admin provisions DDL).
  try {
    await db.execute(sql`SELECT 1 FROM public.nv_legal_intel_digests LIMIT 1`);
    tablesReady = true;
    return;
  } catch {
    /* try create below */
  }
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS public.nv_legal_intel_digests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id TEXT NOT NULL,
        jurisdiction TEXT NOT NULL DEFAULT 'IN',
        digest_date DATE NOT NULL,
        top_n INT NOT NULL DEFAULT 10,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'published',
        generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        model TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        UNIQUE (org_id, jurisdiction, digest_date)
      )
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS public.nv_legal_intel_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        digest_id UUID NOT NULL REFERENCES public.nv_legal_intel_digests(id) ON DELETE CASCADE,
        rank INT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        why_it_matters TEXT,
        source_url TEXT,
        source_name TEXT,
        published_at TIMESTAMPTZ,
        jurisdiction TEXT DEFAULT 'IN',
        tags JSONB NOT NULL DEFAULT '[]'::jsonb,
        raw_ref JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_legal_intel_digest_date
        ON public.nv_legal_intel_digests(digest_date DESC, jurisdiction)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_legal_intel_items_digest_rank
        ON public.nv_legal_intel_items(digest_id, rank)
    `);
    tablesReady = true;
  } catch (err: any) {
    try {
      await db.execute(sql`SELECT 1 FROM public.nv_legal_intel_digests LIMIT 1`);
      tablesReady = true;
      logger.warn('[LegalIntel] CREATE denied but tables readable — continuing', { err: err?.message });
      return;
    } catch {
      logger.error('[LegalIntel] ensureTables failed — provision tables with DATABASE_URL_ADMIN', {
        err: err?.message,
      });
      throw err;
    }
  }
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function categorizeHeuristic(title: string, content: string, moduleName?: string): LegalIntelCategory {
  const t = `${title} ${content}`.toLowerCase();
  if (/supreme\s+court|\bsc\b|sci\.gov|apex\s+court/.test(t) || moduleName === 'CourtRulingsModule') {
    if (/high\s+court|\bhc\b/.test(t) && !/supreme\s+court/.test(t)) return 'hc_judgment';
    if (/judgment|ruling|verdict|bench|petition|writ|appeal/.test(t)) return 'sc_judgment';
  }
  if (/high\s+court|\bhc\b/.test(t) && /judgment|ruling|verdict|bench|petition|writ/.test(t)) {
    return 'hc_judgment';
  }
  if (/amendment|amending\s+act|notification.*amend/.test(t)) return 'amendment';
  if (/\bact\b|bill\s+passed|ordinance|legislation|egazette|statute/.test(t) || moduleName === 'LegislationModule') {
    if (/\bact\b|ordinance|bill/.test(t)) return 'act';
    return 'statute';
  }
  if (/sebi|rbi|irdai|mca\b|gazette|regulation|circular/.test(t)) return 'regulatory';
  return 'legal_news';
}

interface CandidateRow {
  id: string;
  moduleName: string;
  title: string;
  content: string;
  sourceUrl: string | null;
  publishedAt: string | null;
  jurisdiction: string;
  tags: unknown;
}

async function fetchRssCandidates(jurisdiction: string): Promise<CandidateRow[]> {
  const j = encodeURIComponent(jurisdiction === 'IN' ? 'India' : jurisdiction);
  const feeds: Array<{ url: string; moduleName: string; tags: string[] }> = [
    {
      url: `https://news.google.com/rss/search?q=${j}+Supreme+Court+judgment&hl=en-IN&gl=IN&ceid=IN:en`,
      moduleName: 'CourtRulingsModule',
      tags: ['sc_judgment', 'google-news'],
    },
    {
      url: `https://news.google.com/rss/search?q=${j}+High+Court+judgment&hl=en-IN&gl=IN&ceid=IN:en`,
      moduleName: 'CourtRulingsModule',
      tags: ['hc_judgment', 'google-news'],
    },
    {
      url: `https://news.google.com/rss/search?q=${j}+(Act+OR+amendment+OR+ordinance+OR+gazette)&hl=en-IN&gl=IN&ceid=IN:en`,
      moduleName: 'LegislationModule',
      tags: ['act', 'amendment', 'google-news'],
    },
    {
      url: `https://news.google.com/rss/search?q=${j}+(SEBI+OR+RBI+OR+MCA)+notification+OR+circular&hl=en-IN&gl=IN&ceid=IN:en`,
      moduleName: 'LegalNewsModule',
      tags: ['regulatory', 'google-news'],
    },
    {
      url: 'https://www.barandbench.com/feed',
      moduleName: 'LegalNewsModule',
      tags: ['legal-news', 'bar-and-bench'],
    },
  ];

  const rows: CandidateRow[] = [];
  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Jurexio-LegalIntel/5.0)' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        logger.warn('[LegalIntel] RSS non-OK', { url: feed.url, status: res.status });
        continue;
      }
      const xml = await res.text();
      const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
      let n = 0;
      for (const match of itemMatches) {
        const block = match[1];
        const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || '').trim();
        const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '').trim();
        const description = (block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || '')
          .replace(/<[^>]+>/g, '')
          .trim();
        const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim();
        if (!title) continue;
        let publishedAt: string | null = null;
        if (pubDate) {
          const d = new Date(pubDate);
          publishedAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
        }
        rows.push({
          id: `rss:${Buffer.from(`${feed.url}|${title}`).toString('base64url').slice(0, 28)}`,
          moduleName: feed.moduleName,
          title,
          content: (description || title).slice(0, 1200),
          sourceUrl: link || null,
          publishedAt,
          jurisdiction,
          tags: feed.tags,
        });
        n += 1;
        if (n >= 15) break;
      }
      logger.info('[LegalIntel] RSS ingested', { url: feed.url.slice(0, 80), count: n });
    } catch (err: any) {
      logger.warn('[LegalIntel] RSS fetch failed', { url: feed.url.slice(0, 80), err: err?.message });
    }
  }
  return rows;
}

async function collectWebCandidates(jurisdiction: string): Promise<CandidateRow[]> {
  // Own RSS first — never Tavily (NV-OWN-REG-FEED-001).
  const rows = await fetchRssCandidates(jurisdiction);
  if (rows.length >= 5) return rows;

  const queries = [
    `${jurisdiction} Supreme Court judgment latest`,
    `${jurisdiction} High Court judgment latest`,
    `${jurisdiction} new Act amendment ordinance gazette`,
    `${jurisdiction} SEBI RBI MCA legal notification`,
    `${jurisdiction} LiveLaw Bar and Bench top legal news`,
  ];

  try {
    const { realWebSearchService } = await import('./enterprise-platform/real-web-search-service.js');
    for (const q of queries.slice(0, 4)) {
      const res = await realWebSearchService.search(q, { limit: 5, searchDepth: 'basic' });
      for (const h of res.results || []) {
        rows.push({
          id: `web:${Buffer.from(String(h.url || h.title)).toString('base64url').slice(0, 24)}`,
          moduleName: 'LegalNewsModule',
          title: h.title,
          content: String(h.snippet || h.title).slice(0, 1200),
          sourceUrl: h.url || null,
          publishedAt: h.publishedAt || null,
          jurisdiction,
          tags: ['own-web-search', 'legal-intel'],
        });
      }
    }
  } catch (err: any) {
    logger.warn('[LegalIntel] own web search fallback failed', { err: err?.message });
  }

  return rows;
}

async function collectCandidates(orgId: string, jurisdiction: string, lookbackHours = 72): Promise<CandidateRow[]> {
  const juris = jurisdiction.toLowerCase() === 'in' ? 'india' : jurisdiction.toLowerCase();
  const rows: CandidateRow[] = [];

  // Always pull live Google News / Bar & Bench RSS first (works without Tavily).
  try {
    const rss = await fetchRssCandidates(jurisdiction);
    rows.push(...rss);
  } catch (err: any) {
    logger.warn('[LegalIntel] RSS primary collect failed', { err: err?.message });
  }

  try {
    const km = await db.execute(sql`
      SELECT id::text AS id, module_name, title, content, source_url, published_at::text, jurisdiction, tags
      FROM nv_schema.nv_km_ingested_content
      WHERE published_at >= NOW() - (${lookbackHours}::text || ' hours')::interval
        AND (
          org_id = ${orgId}
          OR org_id IN ('platform', '1', 'default')
          OR ${orgId} = 'platform'
        )
        AND (
          lower(coalesce(jurisdiction, 'india')) LIKE ${'%' + juris + '%'}
          OR lower(coalesce(jurisdiction, '')) IN ('india', 'in', 'global', '')
        )
      ORDER BY published_at DESC
      LIMIT 80
    `);
    for (const r of (km as any).rows || []) {
      rows.push({
        id: String(r.id),
        moduleName: String(r.module_name || ''),
        title: String(r.title || ''),
        content: String(r.content || '').slice(0, 1200),
        sourceUrl: r.source_url ? String(r.source_url) : null,
        publishedAt: r.published_at ? String(r.published_at) : null,
        jurisdiction: String(r.jurisdiction || jurisdiction),
        tags: r.tags,
      });
    }
  } catch (err: any) {
    logger.warn('[LegalIntel] KM candidate query failed', { err: err?.message });
  }

  try {
    const reg = await db.execute(sql`
      SELECT id::text AS id, source_name, jurisdiction, feed_type, feed_url, metadata
      FROM nv_regulatory_feeds
      WHERE coalesce(is_active, true) = true
      ORDER BY COALESCE(last_fetched_at, created_at) DESC NULLS LAST
      LIMIT 30
    `);
    for (const r of (reg as any).rows || []) {
      const meta = typeof r.metadata === 'object' && r.metadata ? r.metadata : {};
      const title = String((meta as any).title || (meta as any).headline || r.source_name || 'Regulatory update');
      const summary = String((meta as any).summary || (meta as any).content || title);
      rows.push({
        id: `reg:${r.id}`,
        moduleName: 'OwnRegulatoryFeed',
        title,
        content: summary.slice(0, 1200),
        sourceUrl: r.feed_url ? String(r.feed_url) : null,
        publishedAt: (meta as any).publishedAt ? String((meta as any).publishedAt) : null,
        jurisdiction: String(r.jurisdiction || jurisdiction),
        tags: ['regulatory', 'own-feed', String(r.feed_type || '')],
      });
    }
  } catch (err: any) {
    logger.warn('[LegalIntel] regulatory feed query skipped', { err: err?.message });
  }

  if (rows.length < 5) {
    const web = await collectWebCandidates(jurisdiction);
    rows.push(...web);
  }

  const seen = new Set<string>();
  const deduped: CandidateRow[] = [];
  for (const row of rows) {
    const key = `${row.title.trim().toLowerCase()}|${(row.sourceUrl || '').toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

function extractJsonArray(text: string): any[] | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = (fenced?.[1] || text).trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
  } catch {
    /* fall through */
  }
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function rankWithLlm(
  candidates: CandidateRow[],
  opts: { topN: number; jurisdiction: string; softPolicy?: boolean },
): Promise<{ items: LegalIntelItem[]; model?: string; summary: string }> {
  const catalog = candidates.slice(0, 40).map((c, i) => ({
    idx: i + 1,
    id: c.id,
    module: c.moduleName,
    title: c.title,
    snippet: c.content.slice(0, 400),
    url: c.sourceUrl,
    publishedAt: c.publishedAt,
    suggestedCategory: categorizeHeuristic(c.title, c.content, c.moduleName),
  }));

  const systemPrompt = `You are Jurexio Legal Intelligence Editor for jurisdiction ${opts.jurisdiction}.
Select the most important legal updates for practicing lawyers and legal platforms.
Prioritize: new statutes/acts, amendments, Supreme Court judgments, High Court judgments, major regulatory notifications, then general legal news.
Return ONLY valid JSON (no markdown) as:
{"summary":"1-2 sentence digest overview","items":[{"idx":1,"rank":1,"category":"sc_judgment|hc_judgment|act|statute|amendment|regulatory|legal_news","title":"...","summary":"2-3 sentences","whyItMatters":"1 sentence","sourceName":"..."}]}
Exactly ${opts.topN} items, ranks 1..${opts.topN}. Use idx from the catalog. Prefer real recent items; do not invent URLs.`;

  const userPrompt = `Today's legal intelligence catalog (last ~72h):\n${JSON.stringify(catalog, null, 2)}\n\nProduce the top ${opts.topN} feed items as JSON.`;

  const resp = await callJurexio('legal-research', systemPrompt, userPrompt, {
    maxTokens: 4096,
    source: 'nyayasiddhi',
    tier: 'enterprise',
    jurisdiction: opts.jurisdiction,
    taskType: 'legal-intelligence-feed',
    domainContext: `Daily legal intelligence digest for ${opts.jurisdiction}`,
    enableOrchestration: true,
    enableHallucinationCheck: false,
    enableCitationVerification: false,
    softPolicy: opts.softPolicy ?? isSoftPolicyActive(),
  });

  const parsed = extractJsonArray(resp.content);
  const byIdx = new Map(catalog.map((c) => [c.idx, c]));
  const items: LegalIntelItem[] = [];

  if (parsed && parsed.length > 0) {
    for (const raw of parsed.slice(0, opts.topN)) {
      const idx = Number(raw.idx || raw.index || 0);
      const base = byIdx.get(idx);
      const title = String(raw.title || base?.title || '').trim();
      if (!title) continue;
      const category = normalizeCategory(raw.category) || base?.suggestedCategory || 'legal_news';
      items.push({
        rank: items.length + 1,
        category,
        title,
        summary: String(raw.summary || base?.snippet || title).slice(0, 2000),
        whyItMatters: raw.whyItMatters ? String(raw.whyItMatters).slice(0, 500) : undefined,
        sourceUrl: base?.url || null,
        sourceName: raw.sourceName ? String(raw.sourceName) : guessSourceName(base?.url),
        publishedAt: base?.publishedAt || null,
        jurisdiction: opts.jurisdiction,
        tags: [category, 'daily-feed'],
      });
    }
  }

  // Heuristic fallback if LLM JSON failed
  if (items.length === 0) {
    const sorted = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
    for (const c of sorted.slice(0, opts.topN)) {
      const category = categorizeHeuristic(c.title, c.content, c.moduleName);
      items.push({
        rank: items.length + 1,
        category,
        title: c.title,
        summary: c.content.slice(0, 600),
        whyItMatters: 'Significant recent legal development for practitioners.',
        sourceUrl: c.sourceUrl,
        sourceName: guessSourceName(c.sourceUrl),
        publishedAt: c.publishedAt,
        jurisdiction: opts.jurisdiction,
        tags: [category, 'daily-feed', 'heuristic'],
      });
    }
  }

  let summary = '';
  try {
    const obj = JSON.parse(resp.content.replace(/^```(?:json)?|```$/gim, '').trim());
    if (obj && typeof obj.summary === 'string') summary = obj.summary;
  } catch {
    /* ignore */
  }
  if (!summary) {
    summary = `Top ${items.length} legal intelligence updates for ${opts.jurisdiction} (${todayUtcDate()}).`;
  }

  return { items, model: resp.model, summary };
}

function normalizeCategory(raw: unknown): LegalIntelCategory | null {
  const s = String(raw || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const map: Record<string, LegalIntelCategory> = {
    statute: 'statute',
    act: 'act',
    amendment: 'amendment',
    sc_judgment: 'sc_judgment',
    supreme_court: 'sc_judgment',
    supreme_court_judgment: 'sc_judgment',
    hc_judgment: 'hc_judgment',
    high_court: 'hc_judgment',
    high_court_judgment: 'hc_judgment',
    legal_news: 'legal_news',
    news: 'legal_news',
    regulatory: 'regulatory',
    regulation: 'regulatory',
  };
  return map[s] || null;
}

function guessSourceName(url?: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.includes('livelaw')) return 'LiveLaw';
    if (host.includes('barandbench')) return 'Bar & Bench';
    if (host.includes('sci.gov')) return 'Supreme Court of India';
    if (host.includes('egazette')) return 'eGazette India';
    if (host.includes('legislation.gov.uk')) return 'UK Legislation';
    return host;
  } catch {
    return null;
  }
}

function scoreCandidate(c: CandidateRow): number {
  const t = `${c.title} ${c.content}`.toLowerCase();
  let score = 0;
  if (/supreme\s+court/.test(t)) score += 50;
  if (/high\s+court/.test(t)) score += 35;
  if (/amendment|ordinance|\bact\b/.test(t)) score += 40;
  if (/judgment|ruling|verdict/.test(t)) score += 25;
  if (c.moduleName === 'CourtRulingsModule') score += 15;
  if (c.moduleName === 'LegislationModule') score += 12;
  return score;
}

async function persistDigest(input: {
  orgId: string;
  jurisdiction: string;
  digestDate: string;
  topN: number;
  title: string;
  summary: string;
  model?: string;
  items: LegalIntelItem[];
  metadata?: Record<string, unknown>;
}): Promise<LegalIntelDigest> {
  await ensureTables();

  const upsert = await db.execute(sql`
    INSERT INTO public.nv_legal_intel_digests
      (org_id, jurisdiction, digest_date, top_n, title, summary, status, generated_at, model, metadata)
    VALUES (
      ${input.orgId},
      ${input.jurisdiction},
      ${input.digestDate}::date,
      ${input.topN},
      ${input.title},
      ${input.summary},
      'published',
      NOW(),
      ${input.model || null},
      ${JSON.stringify(input.metadata || {})}::jsonb
    )
    ON CONFLICT (org_id, jurisdiction, digest_date)
    DO UPDATE SET
      top_n = EXCLUDED.top_n,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      status = 'published',
      generated_at = NOW(),
      model = EXCLUDED.model,
      metadata = EXCLUDED.metadata
    RETURNING id::text AS id, generated_at::text AS generated_at
  `);

  const digestId = String((upsert as any).rows?.[0]?.id);
  const generatedAt = String((upsert as any).rows?.[0]?.generated_at || new Date().toISOString());

  await db.execute(sql`DELETE FROM public.nv_legal_intel_items WHERE digest_id = ${digestId}::uuid`);

  for (const item of input.items) {
    const pub = item.publishedAt || null;
    await db.execute(sql`
      INSERT INTO public.nv_legal_intel_items
        (digest_id, rank, category, title, summary, why_it_matters, source_url, source_name,
         published_at, jurisdiction, tags, raw_ref)
      VALUES (
        ${digestId}::uuid,
        ${item.rank},
        ${item.category},
        ${item.title},
        ${item.summary},
        ${item.whyItMatters || null},
        ${item.sourceUrl || null},
        ${item.sourceName || null},
        CASE WHEN ${pub}::text IS NULL OR ${pub}::text = '' THEN NULL ELSE (${pub})::timestamptz END,
        ${item.jurisdiction || input.jurisdiction},
        ${JSON.stringify(item.tags || [])}::jsonb,
        '{}'::jsonb
      )
    `);
  }

  return {
    id: digestId,
    orgId: input.orgId,
    jurisdiction: input.jurisdiction,
    digestDate: input.digestDate,
    topN: input.topN,
    title: input.title,
    summary: input.summary,
    status: 'published',
    generatedAt,
    model: input.model || null,
    items: input.items,
  };
}

export async function generateDailyLegalIntelligenceFeed(options?: {
  orgId?: string;
  jurisdiction?: string;
  topN?: number;
  digestDate?: string;
  skipIngest?: boolean;
  softPolicy?: boolean;
}): Promise<LegalIntelDigest> {
  await ensureTables();
  const orgId = options?.orgId || DEFAULT_ORG();
  const jurisdiction = (options?.jurisdiction || 'IN').toUpperCase();
  const topN = options?.topN || DEFAULT_TOP_N();
  const digestDate = options?.digestDate || todayUtcDate();

  let ingestStats: unknown = null;
  if (!options?.skipIngest) {
    try {
      ingestStats = await runAllModules(orgId);
      logger.info('[LegalIntel] KM ingest complete', { orgId, ingestStats });
    } catch (err: any) {
      logger.warn('[LegalIntel] KM ingest failed (continuing with existing rows)', { err: err?.message });
    }
  }

  const candidates = await collectCandidates(orgId, jurisdiction);

  // Archive top candidate URLs into S3 + RDS + KM RAG (own ingest — no Tavily).
  let archiveStats: unknown = null;
  try {
    const { ingestOwnFeedDocuments } = await import('./jrx-own-regulatory-feed-ingest.js');
    const docs = candidates
      .filter((c) => c.sourceUrl && c.title)
      .slice(0, 12)
      .map((c) => ({
        title: c.title,
        sourceUrl: String(c.sourceUrl),
        jurisdiction,
        category: (c.tags && c.tags[0]) || 'legal_news',
        summary: c.content,
        publishedAt: c.publishedAt,
        sourceName: c.moduleName || 'own-legal-intel',
      }));
    archiveStats = await ingestOwnFeedDocuments(orgId, docs, 12);
    logger.info('[LegalIntel] own feed archive complete', {
      attempted: docs.length,
      ok: Array.isArray(archiveStats)
        ? archiveStats.filter((x: any) => x.reason === 'ok' || x.ragStored || x.storageKey).length
        : 0,
    });
  } catch (err: any) {
    logger.warn('[LegalIntel] own feed archive failed (non-fatal)', { err: err?.message });
  }

  if (candidates.length === 0) {
    const empty: LegalIntelItem[] = [];
    return persistDigest({
      orgId,
      jurisdiction,
      digestDate,
      topN,
      title: `Legal Intelligence Digest — ${jurisdiction} — ${digestDate}`,
      summary: 'No fresh legal intelligence sources were available in the lookback window. Retry generation later.',
      items: empty,
      metadata: { ingestStats, archiveStats, candidateCount: 0, note: 'empty_candidates', reason: 'no_data' },
    });
  }

  const ranked = await rankWithLlm(candidates, {
    topN,
    jurisdiction,
    softPolicy: options?.softPolicy,
  });

  const digest = await persistDigest({
    orgId,
    jurisdiction,
    digestDate,
    topN,
    title: `Legal Intelligence Digest — ${jurisdiction} — ${digestDate}`,
    summary: ranked.summary,
    model: ranked.model,
    items: ranked.items,
    metadata: {
      ingestStats,
      candidateCount: candidates.length,
      topN,
    },
  });

  logger.info('[LegalIntel] digest published', {
    digestId: digest.id,
    date: digestDate,
    items: digest.items.length,
    jurisdiction,
  });
  return digest;
}

export async function getLegalIntelligenceFeed(options?: {
  orgId?: string;
  jurisdiction?: string;
  digestDate?: string;
  limit?: number;
}): Promise<LegalIntelDigest | null> {
  await ensureTables();
  const orgId = options?.orgId || DEFAULT_ORG();
  const jurisdiction = (options?.jurisdiction || 'IN').toUpperCase();
  const digestDate = options?.digestDate || todayUtcDate();
  const limit = Math.min(10, Math.max(1, Number(options?.limit || DEFAULT_TOP_N())));

  const dig = await db.execute(sql`
    SELECT id::text AS id, org_id, jurisdiction, digest_date::text AS digest_date,
           top_n, title, summary, status, generated_at::text AS generated_at, model
    FROM public.nv_legal_intel_digests
    WHERE org_id = ${orgId}
      AND upper(jurisdiction) = ${jurisdiction}
      AND digest_date = ${digestDate}::date
    LIMIT 1
  `);
  const row = (dig as any).rows?.[0];
  if (!row) return null;

  const itemsRes = await db.execute(sql`
    SELECT id::text AS id, rank, category, title, summary, why_it_matters,
           source_url, source_name, published_at::text AS published_at,
           jurisdiction, tags
    FROM public.nv_legal_intel_items
    WHERE digest_id = ${row.id}::uuid
    ORDER BY rank ASC
    LIMIT ${limit}
  `);

  const items: LegalIntelItem[] = ((itemsRes as any).rows || []).map((r: any) => ({
    id: String(r.id),
    rank: Number(r.rank),
    category: normalizeCategory(r.category) || 'legal_news',
    title: String(r.title),
    summary: String(r.summary || ''),
    whyItMatters: r.why_it_matters ? String(r.why_it_matters) : undefined,
    sourceUrl: r.source_url || null,
    sourceName: r.source_name || null,
    publishedAt: r.published_at || null,
    jurisdiction: String(r.jurisdiction || jurisdiction),
    tags: Array.isArray(r.tags) ? r.tags : [],
  }));

  return {
    id: String(row.id),
    orgId: String(row.org_id),
    jurisdiction: String(row.jurisdiction),
    digestDate: String(row.digest_date).slice(0, 10),
    topN: Number(row.top_n || items.length),
    title: String(row.title),
    summary: String(row.summary || ''),
    status: String(row.status || 'published'),
    generatedAt: String(row.generated_at),
    model: row.model || null,
    items,
  };
}

export async function listLegalIntelligenceFeeds(options?: {
  orgId?: string;
  jurisdiction?: string;
  days?: number;
}): Promise<Array<{ id: string; digestDate: string; title: string; itemCount: number; generatedAt: string }>> {
  await ensureTables();
  const orgId = options?.orgId || DEFAULT_ORG();
  const jurisdiction = (options?.jurisdiction || 'IN').toUpperCase();
  const days = Math.min(30, Math.max(1, Number(options?.days || 7)));

  const res = await db.execute(sql`
    SELECT d.id::text AS id, d.digest_date::text AS digest_date, d.title,
           d.generated_at::text AS generated_at,
           (SELECT COUNT(*)::int FROM public.nv_legal_intel_items i WHERE i.digest_id = d.id) AS item_count
    FROM public.nv_legal_intel_digests d
    WHERE d.org_id = ${orgId}
      AND upper(d.jurisdiction) = ${jurisdiction}
      AND d.digest_date >= (CURRENT_DATE - (${days}::text || ' days')::interval)::date
    ORDER BY d.digest_date DESC
  `);

  return ((res as any).rows || []).map((r: any) => ({
    id: String(r.id),
    digestDate: String(r.digest_date).slice(0, 10),
    title: String(r.title),
    itemCount: Number(r.item_count || 0),
    generatedAt: String(r.generated_at),
  }));
}

/** Daily timer — generates feed once per UTC day after configured hour. */
export function startLegalIntelligenceFeedScheduler(): { stop: () => void } {
  const enabled = String(process.env.JRX_LEGAL_INTEL_FEED ?? 'on').toLowerCase();
  if (enabled === 'off' || enabled === '0' || enabled === 'false') {
    logger.info('[LegalIntel] scheduler disabled via JRX_LEGAL_INTEL_FEED');
    return { stop: () => undefined };
  }

  const hourUtc = Number(process.env.JRX_LEGAL_INTEL_CRON_HOUR_UTC ?? 2);
  let lastRunDate: string | null = null;
  let running = false;

  const tick = async () => {
    if (running) return;
    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < (Number.isFinite(hourUtc) ? hourUtc : 2)) return;
    if (lastRunDate === date) return;
    running = true;
    try {
      await generateDailyLegalIntelligenceFeed({
        softPolicy: true, // platform daily job — maximize usable digest for partners
      });
      lastRunDate = date;
    } catch (err: any) {
      logger.error('[LegalIntel] daily generation failed', { err: err?.message });
    } finally {
      running = false;
    }
  };

  // Check every 15 minutes
  const interval = setInterval(() => {
    void tick();
  }, 15 * 60_000);
  // Kick once shortly after boot (non-blocking)
  setTimeout(() => {
    void tick();
  }, 45_000);

  logger.info('[LegalIntel] daily scheduler started', { hourUtc, topN: DEFAULT_TOP_N() });
  return {
    stop: () => clearInterval(interval),
  };
}

export const legalIntelligenceFeedService = {
  ensureTables,
  generateDailyLegalIntelligenceFeed,
  getLegalIntelligenceFeed,
  listLegalIntelligenceFeeds,
  startLegalIntelligenceFeedScheduler,
};
