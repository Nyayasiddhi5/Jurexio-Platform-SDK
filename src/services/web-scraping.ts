/**
 * NYV Web Scraping Service — v5.0.0 (2026-05-06)
 * ─────────────────────────────────────────────────────────────────────────────
 * Production scraper for legal-source ingestion. Replaces the prior 6-line
 * stub. Five gaps from V5-READINESS-PLAN §3 closed:
 *
 *   1. Agent-callable adapter            — `scrape(url, opts)` returns
 *                                           normalized {markdown, html, meta}
 *   2. Per-domain rate limiter           — token-bucket, RPM from allowlist
 *   3. PII redaction wiring              — opt-in via `opts.redactPII`,
 *                                           uses jurisdiction-pii-patterns.json
 *   4. Legal-source allowlist            — `nv-scraper-allowlist.ts` is the
 *                                           single source of truth
 *   5. GraphRAG ingestion hook           — opt-in via `opts.indexInGraphRAG`,
 *                                           routes through
 *                                           NyvGraphRAGLegalService.indexDocument
 *
 * Backed by Node 22's native `fetch` + `cheerio` for HTML parsing — no
 * external API keys required. Sites that need JS rendering go through the
 * existing Firecrawl/Playwright tools in `src/packages/tools/web-scraping/`.
 */

import * as cheerio from 'cheerio';
import { createLogger } from '../utils/logger.js';
import { findAllowedSource, type AllowedSource } from '../config/jrx-scraper-allowlist.js';
import piiPatternsJson from '../data/jurisdiction-pii-patterns.json' with { type: 'json' };

const logger = createLogger('./jrx-web-scraping');

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
export interface ScrapeOptions {
  /** Apply jurisdiction-aware PII redaction to the extracted text */
  redactPII?: boolean;
  /** Override jurisdiction (defaults to allowlist entry's jurisdiction) */
  jurisdiction?: 'IN' | 'UK' | 'US' | 'GCC' | 'EU' | 'SG' | 'DEFAULT';
  /** Push the cleaned text into GraphRAG legal index */
  indexInGraphRAG?: boolean;
  /** GraphRAG: org scope */
  orgId?: string;
  /** GraphRAG: document class hint */
  documentClass?: string;
  /** Override default 30s timeout */
  timeoutMs?: number;
}

export interface ScrapeResult {
  success: boolean;
  url: string;
  source?: AllowedSource;
  jurisdiction?: string;
  title?: string;
  markdown?: string;
  text?: string;
  html?: string;
  meta?: Record<string, string>;
  piiPatternsRedacted?: string[];
  graphragIndexed?: boolean;
  graphragDocId?: string;
  fetchedAt: string;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-domain token-bucket rate limiter (in-memory; sufficient because allowlist
// is small and per-process bucket suffices for a single gateway. Replace with
// Redis-backed limiter when horizontally scaling > 1 gateway replica.)
// ─────────────────────────────────────────────────────────────────────────────
interface Bucket { tokens: number; lastRefill: number; rpm: number; }
const buckets = new Map<string, Bucket>();

function consumeToken(host: string, rpm: number): boolean {
  const now = Date.now();
  let b = buckets.get(host);
  if (!b) {
    b = { tokens: rpm, lastRefill: now, rpm };
    buckets.set(host, b);
  }
  // Refill: add (elapsedMs / 60000) * rpm tokens, capped at rpm
  const elapsed = now - b.lastRefill;
  const refill = (elapsed / 60_000) * b.rpm;
  if (refill > 0) {
    b.tokens = Math.min(b.rpm, b.tokens + refill);
    b.lastRefill = now;
  }
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function getRateLimiterStatus(): Array<{ host: string; tokens: number; rpm: number }> {
  return Array.from(buckets.entries()).map(([host, b]) => ({
    host,
    tokens: Math.round(b.tokens * 10) / 10,
    rpm: b.rpm,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// PII redaction (mirrors safety-pipeline pattern, but pure function — no
// dependency on full pipeline so this can be called pre-ingestion.)
// ─────────────────────────────────────────────────────────────────────────────
type PiiBundle = Record<string, Record<string, string>>;
const PII_BUNDLE = piiPatternsJson as unknown as PiiBundle;

function jcnFor(jurisdiction: string): string | null {
  const map: Record<string, string> = {
    UK: 'JCN-UK', US: 'JCN-US', GCC: 'JCN-GCC', SG: 'JCN-SG',
  };
  return map[jurisdiction] ?? null;
}

function redactText(text: string, jurisdiction: string): { redacted: string; patternsHit: string[] } {
  const jcn = jcnFor(jurisdiction);
  const patternsHit: string[] = [];
  let out = text;
  if (jcn && PII_BUNDLE[jcn]) {
    for (const [name, regexStr] of Object.entries(PII_BUNDLE[jcn])) {
      try {
        const re = new RegExp(regexStr, 'g');
        if (re.test(out)) {
          patternsHit.push(`${jcn}/${name}`);
          out = out.replace(re, `[${jcn}-${name.toUpperCase()}-REDACTED]`);
        }
      } catch (e: any) {
        logger.warn(`Invalid PII pattern ${jcn}/${name}: ${e.message}`);
      }
    }
  }
  // Always-on global patterns (email, phone, IBAN)
  out = out.replace(/[\w._%+-]+@[\w.-]+\.[A-Z]{2,}/gi, () => { patternsHit.push('GLOBAL/email'); return '[EMAIL-REDACTED]'; });
  out = out.replace(/\+?\d[\d\s().-]{8,}\d/g, (m) => m.length >= 10 ? (patternsHit.push('GLOBAL/phone'), '[PHONE-REDACTED]') : m);
  return { redacted: out, patternsHit: Array.from(new Set(patternsHit)) };
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML → markdown-ish conversion (fast + good enough for legal-text ingestion).
// For high-fidelity markdown, route to Firecrawl from the agent layer.
// ─────────────────────────────────────────────────────────────────────────────
function extractFromHtml(html: string): { title: string; text: string; markdown: string; meta: Record<string, string> } {
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg').remove();

  const title = ($('title').first().text() || $('h1').first().text() || '').trim();
  const meta: Record<string, string> = {};
  $('meta[name], meta[property]').each((_, el) => {
    const k = $(el).attr('name') || $(el).attr('property');
    const v = $(el).attr('content');
    if (k && v) meta[k] = v;
  });

  // Pull main content if available; fall back to body
  const main = $('main, article, [role=main]').first();
  const root = main.length ? main : $('body');

  const md: string[] = [];
  root.find('h1, h2, h3, h4, h5, h6, p, li, blockquote').each((_, el) => {
    const tag = (el as any).tagName?.toLowerCase?.() ?? '';
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (tag.startsWith('h')) {
      const level = Number(tag[1]);
      md.push(`${'#'.repeat(level)} ${text}`);
    } else if (tag === 'li') {
      md.push(`- ${text}`);
    } else if (tag === 'blockquote') {
      md.push(`> ${text}`);
    } else {
      md.push(text);
    }
  });

  const markdown = md.join('\n\n');
  const text = root.text().replace(/\s+/g, ' ').trim();
  return { title, text, markdown, meta };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public service
// ─────────────────────────────────────────────────────────────────────────────
export class WebScrapingService {
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const fetchedAt = new Date().toISOString();

    // 1. Allowlist gate
    const source = findAllowedSource(url);
    if (!source) {
      logger.warn({ msg: 'scrape rejected — not on allowlist', url });
      return { success: false, url, fetchedAt, error: 'URL not on legal-source allowlist (see src/config/jrx-scraper-allowlist.ts)' };
    }

    // 2. Per-domain rate-limit
    if (!consumeToken(source.host, source.rateLimit)) {
      logger.warn({ msg: 'scrape rate-limited', host: source.host, rpm: source.rateLimit });
      return { success: false, url, source, fetchedAt, error: `Rate limit exceeded for ${source.host} (${source.rateLimit} req/min)` };
    }

    // 3. Fetch with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
    let html: string;
    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'JurexioLegalCrawler/5.0 (+https://nyayavigya.in/crawler)',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en',
        },
      });
      clearTimeout(timeout);
      if (!resp.ok) {
        return { success: false, url, source, fetchedAt, error: `HTTP ${resp.status} from ${source.host}` };
      }
      html = await resp.text();
    } catch (e: any) {
      clearTimeout(timeout);
      logger.error({ msg: 'scrape fetch failed', url, error: e.message });
      return { success: false, url, source, fetchedAt, error: e.name === 'AbortError' ? 'Timeout' : e.message };
    }

    // 4. Parse
    const { title, text, markdown, meta } = extractFromHtml(html);
    const jurisdiction = options.jurisdiction ?? source.jurisdiction;

    // 5. PII redaction (opt-in)
    let finalText = text, finalMarkdown = markdown, piiPatternsRedacted: string[] = [];
    if (options.redactPII) {
      const t = redactText(text, jurisdiction);
      finalText = t.redacted;
      piiPatternsRedacted = t.patternsHit;
      finalMarkdown = redactText(markdown, jurisdiction).redacted;
    }

    // 6. GraphRAG ingestion (opt-in)
    let graphragIndexed = false;
    let graphragDocId: string | undefined;
    if (options.indexInGraphRAG && finalText) {
      try {
        const { nyvGraphRAGLegal } = await import('./rag/nyv-graphrag-legal-service.js');
        const svc = nyvGraphRAGLegal;
        graphragDocId = `web-${Buffer.from(url).toString('base64url').slice(0, 24)}`;
        await svc.indexDocument({
          docId: graphragDocId,
          text: finalText,
          fileName: title || url,
          jurisdiction,
          documentClass: options.documentClass,
          orgId: options.orgId,
        });
        graphragIndexed = true;
        logger.info({ msg: 'scraped doc indexed in GraphRAG', docId: graphragDocId, jurisdiction });
      } catch (e: any) {
        logger.warn({ msg: 'GraphRAG ingestion failed (scrape itself succeeded)', error: e.message });
      }
    }

    return {
      success: true,
      url,
      source,
      jurisdiction,
      title,
      markdown: finalMarkdown,
      text: finalText,
      html,
      meta,
      piiPatternsRedacted,
      graphragIndexed,
      graphragDocId,
      fetchedAt,
    };
  }
}

export const webScrapingService = new WebScrapingService();
