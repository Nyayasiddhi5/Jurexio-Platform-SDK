/**
 * NV-OWN-REG-FEED-001 — Own regulatory / legal feed ingest (NO Tavily).
 *
 * Pipeline per candidate URL:
 *  1) Fetch full document (HTML/text/PDF bytes)
 *  2) Persist to S3 (tenant legal-intel prefix)
 *  3) Upsert nv_regulatory_feeds + nv_km_ingested_content (RAG corpus)
 *  4) Return structured rows for Legal Intelligence digest ranking
 *
 * SSoT for regulatory list APIs — used by legal-intel feed + regulatory-intelligence.
 */
import { sql } from 'drizzle-orm';
import { db as _rawDb } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
import { createLogger } from '../utils/logger.js';

const db = lazyRequire(() => _rawDb, 'db');
const logger = createLogger('own-regulatory-feed');

export interface OwnFeedDocument {
  title: string;
  sourceUrl: string;
  jurisdiction: string;
  category?: string;
  summary?: string;
  publishedAt?: string | null;
  sourceName?: string;
}

export interface OwnFeedIngestResult {
  feedId?: string;
  storageKey?: string;
  ragStored: boolean;
  contentChars: number;
  reason?: string;
}

const MAX_BYTES = Number(process.env.JRX_OWN_FEED_MAX_BYTES || 2_000_000);

async function fetchFullDocument(url: string): Promise<{ body: Buffer; contentType: string; text: string } | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 25_000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'JurexioLegalIntelBot/1.0 (+https://jurexio.example)',
        Accept: 'text/html,application/xhtml+xml,application/pdf,text/plain,*/*',
      },
      redirect: 'follow',
    });
    clearTimeout(t);
    if (res.ok === false) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) {
      logger.warn('own_feed_doc_too_large', { url: url.slice(0, 120), bytes: ab.byteLength });
    }
    const body = Buffer.from(ab.slice(0, MAX_BYTES));
    const contentType = String(res.headers.get('content-type') || 'application/octet-stream');
    let text = '';
    if (/pdf/i.test(contentType) || url.toLowerCase().endsWith('.pdf')) {
      text = `[PDF document ${body.length} bytes] ${url}`;
    } else {
      text = body.toString('utf8')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80_000);
    }
    return { body, contentType, text };
  } catch (err: any) {
    logger.warn('own_feed_fetch_failed', { url: url.slice(0, 120), err: err?.message });
    return null;
  }
}

async function storeToS3(orgId: string, doc: OwnFeedDocument, body: Buffer, contentType: string): Promise<string | undefined> {
  try {
    const { nyvDocumentStorage } = await import('./jrx-document-storage-service.js');
    const slug = Buffer.from(doc.sourceUrl).toString('base64url').slice(0, 32);
    const ext = /pdf/i.test(contentType) ? 'pdf' : 'html';
    const key = `legal-intel/${orgId}/${doc.jurisdiction || 'IN'}/${new Date().toISOString().slice(0, 10)}/${slug}.${ext}`;
    await nyvDocumentStorage.uploadRaw(key, body, contentType.split(';')[0] || 'application/octet-stream');
    return key;
  } catch (err: any) {
    logger.warn('own_feed_s3_failed', { err: err?.message });
    return undefined;
  }
}

async function upsertRegulatoryFeed(doc: OwnFeedDocument, storageKey: string | undefined, text: string): Promise<string | undefined> {
  try {
    const meta = {
      title: doc.title,
      summary: (doc.summary || text).slice(0, 2000),
      content: text.slice(0, 12000),
      publishedAt: doc.publishedAt || null,
      storageKey: storageKey || null,
      ingestedAt: new Date().toISOString(),
      ingestSource: 'own-feed',
    };
    const r = await db.execute(sql`
      INSERT INTO nv_regulatory_feeds (
        source_name, jurisdiction, feed_type, feed_url, last_fetched_at, is_active, parser_type, metadata, created_at, updated_at
      ) VALUES (
        ${doc.sourceName || 'own-legal-intel'},
        ${doc.jurisdiction || 'IN'},
        ${doc.category || 'legal_news'},
        ${doc.sourceUrl},
        NOW(),
        true,
        ${'own_html'},
        ${JSON.stringify(meta)}::jsonb,
        NOW(),
        NOW()
      )
      ON CONFLICT DO NOTHING
      RETURNING id::text AS id
    `);
    const id = (r as any).rows?.[0]?.id;
    if (id) return String(id);
    // Fallback update by URL when unique constraint differs
    const u = await db.execute(sql`
      UPDATE nv_regulatory_feeds
      SET last_fetched_at = NOW(),
          metadata = ${JSON.stringify(meta)}::jsonb,
          updated_at = NOW(),
          is_active = true
      WHERE feed_url = ${doc.sourceUrl}
      RETURNING id::text AS id
    `);
    return (u as any).rows?.[0]?.id ? String((u as any).rows[0].id) : undefined;
  } catch (err: any) {
    // Table may lack unique on feed_url — try plain insert without ON CONFLICT
    try {
      const r2 = await db.execute(sql`
        INSERT INTO nv_regulatory_feeds (
          source_name, jurisdiction, feed_type, feed_url, last_fetched_at, is_active, parser_type, metadata
        ) VALUES (
          ${doc.sourceName || 'own-legal-intel'},
          ${doc.jurisdiction || 'IN'},
          ${doc.category || 'legal_news'},
          ${doc.sourceUrl},
          NOW(), true, ${'own_html'}, ${JSON.stringify({
            title: doc.title,
            summary: (doc.summary || text).slice(0, 2000),
            content: text.slice(0, 12000),
            storageKey: storageKey || null,
            ingestSource: 'own-feed',
          })}::jsonb
        )
        RETURNING id::text AS id
      `);
      return (r2 as any).rows?.[0]?.id ? String((r2 as any).rows[0].id) : undefined;
    } catch (err2: any) {
      logger.warn('own_feed_rds_upsert_failed', { err: err2?.message || err?.message });
      return undefined;
    }
  }
}

async function storeToRag(orgId: string, doc: OwnFeedDocument, text: string, storageKey?: string): Promise<boolean> {
  try {
    await db.execute(sql`
      INSERT INTO nv_schema.nv_km_ingested_content
        (org_id, module_name, title, content, source_url, published_at, jurisdiction, tags, metadata)
      VALUES (
        ${orgId},
        ${'OwnRegulatoryFeed'},
        ${doc.title.slice(0, 500)},
        ${text.slice(0, 50000)},
        ${doc.sourceUrl},
        NOW(),
        ${doc.jurisdiction || 'IN'},
        ${JSON.stringify(['own-feed', 'regulatory', doc.category || 'legal_news'])}::jsonb,
        ${JSON.stringify({ storageKey: storageKey || null, ingestSource: 'own-feed' })}::jsonb
      )
    `);
    return true;
  } catch (err: any) {
    // Schema variance — try without metadata column
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.nv_km_ingested_content
          (org_id, module_name, title, content, source_url, published_at, jurisdiction, tags)
        VALUES (
          ${orgId},
          ${'OwnRegulatoryFeed'},
          ${doc.title.slice(0, 500)},
          ${text.slice(0, 50000)},
          ${doc.sourceUrl},
          NOW(),
          ${doc.jurisdiction || 'IN'},
          ${JSON.stringify(['own-feed', 'regulatory'])}::jsonb
        )
      `);
      return true;
    } catch (err2: any) {
      logger.warn('own_feed_rag_insert_failed', { err: err2?.message || err?.message });
      return false;
    }
  }
}

/** Ingest one document URL into S3 + RDS + KM RAG corpus. */
export async function ingestOwnFeedDocument(
  orgId: string,
  doc: OwnFeedDocument,
): Promise<OwnFeedIngestResult> {
  if (!doc.sourceUrl || !doc.title) {
    return { ragStored: false, contentChars: 0, reason: 'missing_url_or_title' };
  }
  const fetched = await fetchFullDocument(doc.sourceUrl);
  if (!fetched || fetched.text.length < 40) {
    return { ragStored: false, contentChars: 0, reason: 'fetch_empty' };
  }
  const storageKey = await storeToS3(orgId, doc, fetched.body, fetched.contentType);
  const feedId = await upsertRegulatoryFeed(doc, storageKey, fetched.text);
  const ragStored = await storeToRag(orgId, doc, fetched.text, storageKey);
  return {
    feedId,
    storageKey,
    ragStored,
    contentChars: fetched.text.length,
    reason: ragStored || feedId || storageKey ? 'ok' : 'partial_failure',
  };
}

/** Batch ingest (bounded concurrency). */
export async function ingestOwnFeedDocuments(
  orgId: string,
  docs: OwnFeedDocument[],
  limit = 12,
): Promise<OwnFeedIngestResult[]> {
  const slice = docs.slice(0, limit);
  const out: OwnFeedIngestResult[] = [];
  for (const d of slice) {
    out.push(await ingestOwnFeedDocument(orgId, d));
  }
  return out;
}

/** List regulatory updates from RDS for partner APIs (no Tavily). */
export async function listOwnRegulatoryUpdates(jurisdiction = 'IN', limit = 50): Promise<{
  updates: Array<Record<string, unknown>>;
  totalCount: number;
  lastFetchedAt: string;
  source: 'own-rds';
  reason?: string;
}> {
  try {
    const r = await db.execute(sql`
      SELECT id::text AS id, source_name, jurisdiction, feed_type, feed_url, last_fetched_at::text, metadata
      FROM nv_regulatory_feeds
      WHERE coalesce(is_active, true) = true
        AND (
          upper(jurisdiction) = ${jurisdiction.toUpperCase()}
          OR jurisdiction IN ('IN', 'India', 'india', 'GLOBAL', 'global')
        )
      ORDER BY COALESCE(last_fetched_at, created_at) DESC NULLS LAST
      LIMIT ${Math.min(100, Math.max(1, limit))}
    `);
    const rows = (r as any).rows || [];
    const updates = rows.map((row: any) => {
      const meta = typeof row.metadata === 'object' && row.metadata ? row.metadata : {};
      return {
        id: row.id,
        title: meta.title || meta.headline || row.source_name || 'Regulatory update',
        source: row.source_name,
        sourceUrl: row.feed_url,
        jurisdiction: row.jurisdiction,
        feedType: row.feed_type,
        summary: meta.summary || meta.content || '',
        storageKey: meta.storageKey || null,
        publishedAt: meta.publishedAt || row.last_fetched_at || null,
        severity: meta.severity || 'informational',
      };
    });
    return {
      updates,
      totalCount: updates.length,
      lastFetchedAt: new Date().toISOString(),
      source: 'own-rds',
      reason: updates.length ? undefined : 'no_data',
    };
  } catch (err: any) {
    logger.warn('list_own_regulatory_failed', { err: err?.message });
    return {
      updates: [],
      totalCount: 0,
      lastFetchedAt: new Date().toISOString(),
      source: 'own-rds',
      reason: 'query_failed',
    };
  }
}
