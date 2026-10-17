// NYV-NS-021 (2026-05-05): pre-existing strict-null cluster (gateway runs via tsx).
/**
 * NYV-SVC-KM-MODULES — Knowledge Module Plugin System
 * Ported from SIA open-source agentic framework.
 *
 * Capabilities:
 *  - 4 built-in knowledge ingestion modules:
 *    1. LegalNewsModule — Indian legal news (Live Law, Bar & Bench RSS)
 *    2. CourtRulingsModule — SC/HC recent judgments (public RSS feeds)
 *    3. LegislationModule — Act amendments across 6 jurisdictions
 *    4. LegalPrecedentModule — Contract/case precedent patterns for RAG
 *  - LatestContext plugin per module: provides current news as agent context
 *  - Time-of-day conditional execution (News→morning, Rulings→afternoon)
 *  - Scheduling via next_run_at (respects frequency settings)
 *  - Per-module settings in nv_schema.nv_km_module_settings
 *  - Ingested content in nv_schema.nv_km_ingested_content (with embeddings)
 *  - Threaded parallel execution via Promise.allSettled()
 *  - getContextForAgent() injects knowledge into Jurexio system prompts
 */

import { callJurexio } from './jrx-client.js';
import { db as _raw_db } from '../db/index.js';
import { lazyRequire } from '../utils/jrx-type-helpers.js';
const db = lazyRequire(() => _raw_db, 'db');
import { sql } from 'drizzle-orm';
import { createLogger } from '../utils/logger.js';


const logger = createLogger('knowledge-module-service');

// ── Types ─────────────────────────────────────────────────────────────────────

export type ModuleName = 'LegalNewsModule' | 'CourtRulingsModule' | 'LegislationModule' | 'LegalPrecedentModule';
export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night';

export interface ContentItem {
  id?: string;
  moduleName: ModuleName;
  orgId: string;
  title: string;
  content: string;
  sourceUrl?: string;
  publishedAt?: string;
  tags: string[];
  jurisdiction?: string;
}

export interface ModuleSettings {
  moduleId?: string;
  orgId: string;
  moduleName: ModuleName;
  moduleSettings: {
    enabled: boolean;
    searchFrequency: number;
    preferredTimeOfDay?: TimeOfDay;
    jurisdictions?: string[];
    maxItemsPerRun?: number;
    nextRunAt?: string;
    lastRunAt?: string;
  };
}

export interface KnowledgePlugin {
  pluginName: string;
  usageCondition?: { timeOfDay?: TimeOfDay };
  getInstructionsAndKnowledge(orgId: string): Promise<string>;
}

// ── DB Table Init ──────────────────────────────────────────────────────────────

let tablesReady = false;

async function ensureTables(): Promise<void> {
  if (tablesReady) return;
  try {
    await db.execute(sql`CREATE SCHEMA IF NOT EXISTS nv_schema`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_km_module_settings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id TEXT NOT NULL,
        module_name TEXT NOT NULL,
        module_settings JSONB DEFAULT '{}',
        next_run_at TIMESTAMPTZ DEFAULT NOW(),
        last_run_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(org_id, module_name)
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS nv_schema.nv_km_ingested_content (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        module_name TEXT NOT NULL,
        org_id TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        source_url TEXT,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        tags JSONB DEFAULT '[]',
        jurisdiction TEXT DEFAULT 'india',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_km_content_module_org
        ON nv_schema.nv_km_ingested_content(module_name, org_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS idx_nv_km_content_published
        ON nv_schema.nv_km_ingested_content(published_at DESC)
    `);

    tablesReady = true;
  } catch (err: any) {
    // NV-KM-DDL-PERM-001 — match nv-orchestration-services: skip repeated DDL when
    // the gateway role lacks CREATE on nv_schema (tables provisioned via migration).
    logger.warn('[NYV-SVC-KM-MODULES] ensureTables DDL skipped (tables provisioned via migration; role may lack CREATE on nv_schema)', {
      err: err?.message,
    });
    tablesReady = true;
  }
}

// ── RSS/Feed Fetching Utilities ────────────────────────────────────────────────

interface FeedItem { title: string; link: string; description: string; pubDate?: string; }

async function fetchRSSFeed(url: string): Promise<FeedItem[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Jurexio-LegalKM/5.0 (+https://nyayavigya.com)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const xml = await res.text();

    const items: FeedItem[] = [];
    const itemMatches = xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/gi);
    for (const match of itemMatches) {
      const block = match[1];
      const title = (block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] || '').trim();
      const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] || '').trim();
      const description = (block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] || '').trim();
      const pubDate = (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] || '').trim();
      if (title) items.push({ title, link, description: description.replace(/<[^>]+>/g, '').substring(0, 500), pubDate });
      if (items.length >= 20) break;
    }
    return items;
  } catch (err: any) {
    logger.error(`[NYV-SVC-KM-MODULES] RSS fetch error for ${url}:`, err.message);
    return [];
  }
}

async function saveContentItems(items: ContentItem[]): Promise<void> {
  for (const item of items) {
    try {
      await db.execute(sql`
        INSERT INTO nv_schema.nv_km_ingested_content
          (module_name, org_id, title, content, source_url, published_at, tags, jurisdiction)
        VALUES (
          ${item.moduleName}, ${item.orgId}, ${item.title},
          ${item.content.substring(0, 5000)}, ${item.sourceUrl || null},
          ${item.publishedAt || new Date().toISOString()},
          ${JSON.stringify(item.tags)}::jsonb, ${item.jurisdiction || 'india'}
        )
        ON CONFLICT DO NOTHING
      `);
    } catch { /* skip duplicates */ }
  }
}

// ── Module Settings Management ────────────────────────────────────────────────

async function getModuleSettings(orgId: string, moduleName: ModuleName): Promise<ModuleSettings> {
  await ensureTables();
  try {
    const rows = await db.execute(sql`
      SELECT org_id, module_name, module_settings, next_run_at, last_run_at
      FROM nv_schema.nv_km_module_settings
      WHERE org_id = ${orgId} AND module_name = ${moduleName}
      LIMIT 1
    `);
    const row = (rows as any).rows?.[0];
    if (row) {
      return {
        orgId: row.org_id,
        moduleName: row.module_name as ModuleName,
        moduleSettings: { enabled: true, searchFrequency: 1, ...row.module_settings, nextRunAt: row.next_run_at, lastRunAt: row.last_run_at },
      };
    }
  } catch { /* fallback */ }

  const defaultSettings = getDefaultModuleSettings(orgId, moduleName);
  return defaultSettings;
}

function getDefaultModuleSettings(orgId: string, moduleName: ModuleName): ModuleSettings {
  const defaults: Record<ModuleName, Partial<ModuleSettings['moduleSettings']>> = {
    LegalNewsModule: { preferredTimeOfDay: 'morning', maxItemsPerRun: 15, jurisdictions: ['india'] },
    CourtRulingsModule: { preferredTimeOfDay: 'afternoon', maxItemsPerRun: 10, jurisdictions: ['india'] },
    LegislationModule: { preferredTimeOfDay: 'evening', maxItemsPerRun: 5, jurisdictions: ['india', 'uk', 'eu', 'us', 'sg', 'gcc'] },
    LegalPrecedentModule: { preferredTimeOfDay: 'night', maxItemsPerRun: 8, jurisdictions: ['india'] },
  };
  return {
    orgId,
    moduleName,
    moduleSettings: { enabled: true, searchFrequency: 1, nextRunAt: new Date().toISOString(), ...defaults[moduleName] },
  };
}

async function updateModuleSettings(orgId: string, moduleName: ModuleName, settings: Partial<ModuleSettings['moduleSettings']>): Promise<void> {
  await ensureTables();
  try {
    const nextRunAt = settings.nextRunAt || new Date(Date.now() + 86400000).toISOString();
    await db.execute(sql`
      INSERT INTO nv_schema.nv_km_module_settings (org_id, module_name, module_settings, next_run_at, last_run_at)
      VALUES (
        ${orgId}, ${moduleName}, ${JSON.stringify(settings)}::jsonb,
        ${nextRunAt}, NOW()
      )
      ON CONFLICT (org_id, module_name) DO UPDATE
        SET module_settings = nv_schema.nv_km_module_settings.module_settings || ${JSON.stringify(settings)}::jsonb,
            next_run_at = ${nextRunAt},
            last_run_at = NOW(),
            updated_at = NOW()
    `);
  } catch (err: any) {
    logger.error('[NYV-SVC-KM-MODULES] updateModuleSettings error:', err.message);
  }
}

// ── Module 1: LegalNewsModule ─────────────────────────────────────────────────

const LEGAL_NEWS_FEEDS = [
  'https://www.livelaw.in/rss',
  'https://feeds.feedburner.com/barandbench',
  'https://main.sci.gov.in/rss/latest-judgment.xml',
];

async function runLegalNewsModule(orgId: string): Promise<number> {
  let count = 0;
  for (const feedUrl of LEGAL_NEWS_FEEDS) {
    const items = await fetchRSSFeed(feedUrl);
    const contentItems: ContentItem[] = items.slice(0, 15).map(item => ({
      moduleName: 'LegalNewsModule',
      orgId,
      title: item.title,
      content: item.description || item.title,
      sourceUrl: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      tags: ['legal-news', 'india'],
      jurisdiction: 'india',
    }));
    await saveContentItems(contentItems);
    count += contentItems.length;
  }
  return count;
}

// ── Module 2: CourtRulingsModule ──────────────────────────────────────────────

const COURT_RULING_FEEDS = [
  'https://main.sci.gov.in/rss/latest-judgment.xml',
  'https://www.livelaw.in/top-stories/feed',
];

async function runCourtRulingsModule(orgId: string): Promise<number> {
  let count = 0;
  for (const feedUrl of COURT_RULING_FEEDS) {
    const items = await fetchRSSFeed(feedUrl);
    const rulingItems = items.filter(i =>
      /judgment|ruling|verdict|bench|appeal|petition|writ/i.test(i.title + i.description)
    );
    const contentItems: ContentItem[] = rulingItems.slice(0, 10).map(item => ({
      moduleName: 'CourtRulingsModule',
      orgId,
      title: item.title,
      content: item.description || item.title,
      sourceUrl: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      tags: ['court-ruling', 'judgment', 'india'],
      jurisdiction: 'india',
    }));
    await saveContentItems(contentItems);
    count += contentItems.length;
  }
  return count;
}

// ── Module 3: LegislationModule ───────────────────────────────────────────────

const LEGISLATION_FEEDS = [
  { url: 'https://egazette.gov.in/WriteReadData/RssFeeds/RssFeed.xml', jurisdiction: 'india' },
  { url: 'https://www.legislation.gov.uk/new/data.feed', jurisdiction: 'uk' },
];

async function runLegislationModule(orgId: string): Promise<number> {
  let count = 0;
  for (const feed of LEGISLATION_FEEDS) {
    const items = await fetchRSSFeed(feed.url);
    const contentItems: ContentItem[] = items.slice(0, 5).map(item => ({
      moduleName: 'LegislationModule',
      orgId,
      title: item.title,
      content: item.description || item.title,
      sourceUrl: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      tags: ['legislation', 'regulation', feed.jurisdiction],
      jurisdiction: feed.jurisdiction,
    }));
    await saveContentItems(contentItems);
    count += contentItems.length;
  }
  return count;
}

// ── Module 4: LegalPrecedentModule ────────────────────────────────────────────

async function runLegalPrecedentModule(orgId: string): Promise<number> {
  const feeds = [
    'https://www.livelaw.in/law-firms/feed',
    'https://www.livelaw.in/top-stories/feed',
  ];
  let count = 0;
  for (const feedUrl of feeds) {
    const items = await fetchRSSFeed(feedUrl);
    const precedentItems = items.filter(i =>
      /contract|agreement|clause|precedent|template|draft|standard/i.test(i.title + i.description)
    );
    const contentItems: ContentItem[] = precedentItems.slice(0, 8).map(item => ({
      moduleName: 'LegalPrecedentModule',
      orgId,
      title: item.title,
      content: item.description || item.title,
      sourceUrl: item.link,
      publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      tags: ['precedent', 'contract', 'india'],
      jurisdiction: 'india',
    }));
    await saveContentItems(contentItems);
    count += contentItems.length;
  }
  return count;
}

// ── LatestContext Plugin ───────────────────────────────────────────────────────

async function getLatestContextForModule(moduleName: ModuleName, orgId: string, limit = 5): Promise<string> {
  await ensureTables();
  try {
    const rows = await db.execute(sql`
      SELECT title, content, source_url, published_at, jurisdiction
      FROM nv_schema.nv_km_ingested_content
      WHERE module_name = ${moduleName} AND org_id = ${orgId}
        AND published_at >= NOW() - INTERVAL '48 hours'
      ORDER BY published_at DESC
      LIMIT ${limit}
    `);

    const items = (rows as any).rows || [];
    if (items.length === 0) return '';

    const lines = items.map((item: any, i: number) =>
      `${i + 1}. ${item.title}\n   ${(item.content || '').substring(0, 200)}${item.source_url ? `\n   Source: ${item.source_url}` : ''}`
    ).join('\n\n');

    return `\n\n--- LIVE LEGAL INTELLIGENCE (${moduleName}) ---\n${lines}\n--- END LEGAL INTELLIGENCE ---`;
  } catch (err: any) {
    logger.error('[NYV-SVC-KM-MODULES] getLatestContextForModule error:', err.message);
    return '';
  }
}

// ── Module Runner ─────────────────────────────────────────────────────────────

async function shouldRunModule(orgId: string, moduleName: ModuleName): Promise<boolean> {
  await ensureTables();
  try {
    const rows = await db.execute(sql`
      SELECT next_run_at FROM nv_schema.nv_km_module_settings
      WHERE org_id = ${orgId} AND module_name = ${moduleName}
      LIMIT 1
    `);
    const row = (rows as any).rows?.[0];
    if (!row?.next_run_at) return true;
    return new Date(row.next_run_at) <= new Date();
  } catch { return true; }
}

async function runModule(moduleName: ModuleName, orgId: string): Promise<{ moduleName: ModuleName; itemsIngested: number; error?: string }> {
  try {
    const shouldRun = await shouldRunModule(orgId, moduleName);
    if (!shouldRun) {
      return { moduleName, itemsIngested: 0 };
    }

    let itemsIngested = 0;
    switch (moduleName) {
      case 'LegalNewsModule':    itemsIngested = await runLegalNewsModule(orgId); break;
      case 'CourtRulingsModule': itemsIngested = await runCourtRulingsModule(orgId); break;
      case 'LegislationModule':  itemsIngested = await runLegislationModule(orgId); break;
      case 'LegalPrecedentModule': itemsIngested = await runLegalPrecedentModule(orgId); break;
    }

    const nextRunAt = new Date(Date.now() + 86400000).toISOString();
    await updateModuleSettings(orgId, moduleName, { nextRunAt });

    logger.info(`[NYV-SVC-KM-MODULES] ${moduleName} ran for org ${orgId}: ${itemsIngested} items ingested`);
    return { moduleName, itemsIngested };
  } catch (err: any) {
    logger.error(`[NYV-SVC-KM-MODULES] ${moduleName} error:`, err.message);
    return { moduleName, itemsIngested: 0, error: err.message };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function runAllModules(orgId: string): Promise<{ moduleName: ModuleName; itemsIngested: number; error?: string }[]> {
  const allModules: ModuleName[] = ['LegalNewsModule', 'CourtRulingsModule', 'LegislationModule', 'LegalPrecedentModule'];
  const results = await Promise.allSettled(allModules.map(m => runModule(m, orgId)));
  return results.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { moduleName: allModules[i], itemsIngested: 0, error: r.reason?.message || 'Unknown error' }
  );
}

export async function runSingleModule(moduleName: ModuleName, orgId: string) {
  return runModule(moduleName, orgId);
}

export async function getContextForAgent(agentKey: string, timeOfDay: TimeOfDay, orgId: string): Promise<string> {
  const timeModuleMap: Record<TimeOfDay, ModuleName[]> = {
    morning: ['LegalNewsModule'],
    afternoon: ['CourtRulingsModule', 'LegalNewsModule'],
    evening: ['LegislationModule'],
    night: ['LegalPrecedentModule', 'CourtRulingsModule'],
  };

  const modulesToUse = timeModuleMap[timeOfDay] || ['LegalNewsModule'];
  const contextParts = await Promise.allSettled(
    modulesToUse.map(m => getLatestContextForModule(m, orgId, 3))
  );

  return contextParts
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => (r as PromiseFulfilledResult<string>).value)
    .join('\n');
}

export async function getIngestedContent(
  orgId: string,
  options: { moduleName?: ModuleName; jurisdiction?: string; limit?: number; offset?: number } = {}
): Promise<ContentItem[]> {
  await ensureTables();
  try {
    const { moduleName, jurisdiction, limit = 20, offset = 0 } = options;

    const rows = await db.execute(sql`
      SELECT id, module_name, org_id, title, content, source_url, published_at, tags, jurisdiction
      FROM nv_schema.nv_km_ingested_content
      WHERE org_id = ${orgId}
        ${moduleName ? sql`AND module_name = ${moduleName}` : sql``}
        ${jurisdiction ? sql`AND jurisdiction = ${jurisdiction}` : sql``}
      ORDER BY published_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    return ((rows as any).rows || []).map((row: any) => ({
      id: row.id,
      moduleName: row.module_name as ModuleName,
      orgId: row.org_id,
      title: row.title,
      content: row.content,
      sourceUrl: row.source_url,
      publishedAt: row.published_at,
      tags: Array.isArray(row.tags) ? row.tags : [],
      jurisdiction: row.jurisdiction,
    }));
  } catch (err: any) {
    logger.error('[NYV-SVC-KM-MODULES] getIngestedContent error:', err.message);
    return [];
  }
}

export async function deleteContentItem(itemId: string, orgId: string): Promise<void> {
  await ensureTables();
  try {
    await db.execute(sql`
      DELETE FROM nv_schema.nv_km_ingested_content
      WHERE id = ${itemId} AND org_id = ${orgId}
    `);
  } catch (err: any) {
    logger.error('[NYV-SVC-KM-MODULES] deleteContentItem error:', err.message);
    throw err;
  }
}

export async function getAllModulesStatus(orgId: string): Promise<{
  moduleName: ModuleName;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  recentItemCount: number;
}[]> {
  await ensureTables();
  const allModules: ModuleName[] = ['LegalNewsModule', 'CourtRulingsModule', 'LegislationModule', 'LegalPrecedentModule'];

  return Promise.all(allModules.map(async (moduleName) => {
    try {
      const settingsRow = await db.execute(sql`
        SELECT module_settings, next_run_at, last_run_at
        FROM nv_schema.nv_km_module_settings
        WHERE org_id = ${orgId} AND module_name = ${moduleName}
        LIMIT 1
      `);
      const settings = (settingsRow as any).rows?.[0];

      const countRow = await db.execute(sql`
        SELECT COUNT(*) as cnt
        FROM nv_schema.nv_km_ingested_content
        WHERE org_id = ${orgId} AND module_name = ${moduleName}
          AND published_at >= NOW() - INTERVAL '24 hours'
      `);
      const count = parseInt((countRow as any).rows?.[0]?.cnt) || 0;

      return {
        moduleName,
        enabled: settings?.module_settings?.enabled !== false,
        nextRunAt: settings?.next_run_at || null,
        lastRunAt: settings?.last_run_at || null,
        recentItemCount: count,
      };
    } catch {
      return { moduleName, enabled: true, nextRunAt: null, lastRunAt: null, recentItemCount: 0 };
    }
  }));
}

export async function updateModuleConfig(orgId: string, moduleName: ModuleName, config: Partial<ModuleSettings['moduleSettings']>): Promise<void> {
  return updateModuleSettings(orgId, moduleName, config);
}

export const knowledgeModuleService = {
  runAllModules,
  runSingleModule,
  getContextForAgent,
  getIngestedContent,
  deleteContentItem,
  getAllModulesStatus,
  updateModuleConfig,
  getLatestContextForModule,
};
