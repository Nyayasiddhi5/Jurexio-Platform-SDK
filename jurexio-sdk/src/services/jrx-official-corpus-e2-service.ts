/**
 * JRX-E2-OFFICIAL-CORPUS-001 — Singapore (SOLID) + GC/Saudi BOE scaffold ingest.
 */
import { createLogger } from '../utils/logger.js';
import type { StatuteSection } from './jrx-statute-seeding-service.js';
import { upsertStatuteSections } from './jrx-statute-seeding-service.js';

const logger = createLogger('jrx-official-corpus-e2');

export type E2Jurisdiction = 'SG' | 'GC';

export interface E2IngestResult {
  jurisdiction: E2Jurisdiction;
  fetched: number;
  upserted: number;
  source: string;
  dryRun: boolean;
  licenseNote?: string;
}

const FETCH_TIMEOUT_MS = 30_000;
const SAUDI_HF_ROWS =
  'https://datasets-server.huggingface.co/rows?dataset=SaudiArabicLaws/saudi-arabic-laws-and-regulations-corpus&config=boe&split=train';

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** GC — Saudi BOE articles via Hugging Face datasets server (research; NC license). */
export async function fetchGcSaudiBoeSample(limit: number): Promise<StatuteSection[]> {
  const url = `${SAUDI_HF_ROWS}&offset=0&length=${Math.min(limit, 100)}`;
  const data = (await fetchJson(url)) as {
    rows?: Array<{
      row: {
        id?: string;
        law?: { title_ar?: string; document_type?: string };
        article?: {
          article_index?: number;
          article_title_norm?: string;
          text?: string;
        };
      };
    }>;
  };
  const sections: StatuteSection[] = [];
  for (const wrap of data.rows ?? []) {
    const row = wrap.row;
    const lawTitle = String(row.law?.title_ar ?? 'Saudi regulation').slice(0, 500);
    const actShort = `SA-BOE-${String(row.id ?? 'x').slice(0, 24).replace(/\W/g, '')}`;
    const idx = row.article?.article_index ?? sections.length + 1;
    const text = String(row.article?.text ?? '').trim();
    if (!text) continue;
    sections.push({
      actTitle: lawTitle,
      actShortTitle: actShort,
      jurisdiction: 'GC',
      sectionNumber: String(idx),
      sectionTitle: String(row.article?.article_title_norm ?? `Article ${idx}`).slice(0, 500),
      sectionText: text.slice(0, 8000),
      practiceArea: 'gcc_commercial',
      keywords: ['GC', 'Saudi Arabia', 'BOE', 'Arabic'],
      effectiveDate: '2020-01-01',
      isRepealed: false,
    });
    if (sections.length >= limit) break;
  }
  return sections;
}

/** SG — SOLID export file or authenticated API base (operator-provided). */
export async function fetchSgSolidSample(limit: number): Promise<StatuteSection[]> {
  const exportPath = process.env.SG_SOLID_EXPORT?.trim();
  if (exportPath) {
    const fs = await import('node:fs/promises');
    const raw = await fs.readFile(exportPath, 'utf8');
    const lines = raw.split('\n').filter(Boolean).slice(0, limit);
    const sections: StatuteSection[] = [];
    for (const line of lines) {
      try {
        const row = JSON.parse(line) as {
          act_title?: string;
          act_short?: string;
          section_number?: string;
          section_title?: string;
          section_text?: string;
        };
        sections.push({
          actTitle: String(row.act_title ?? 'Singapore statute'),
          actShortTitle: String(row.act_short ?? 'SG-ACT'),
          jurisdiction: 'SG',
          sectionNumber: String(row.section_number ?? '0'),
          sectionTitle: String(row.section_title ?? ''),
          sectionText: String(row.section_text ?? '').slice(0, 8000),
          practiceArea: 'general',
          keywords: ['Singapore', 'SOLID'],
          effectiveDate: '1965-08-09',
          isRepealed: false,
        });
      } catch {
        /* skip */
      }
    }
    return sections;
  }

  const apiBase = process.env.SOLID_API_BASE?.trim();
  const apiKey = process.env.SOLID_API_KEY?.trim();
  if (apiBase && apiKey) {
    const url = `${apiBase.replace(/\/$/, '')}/statutes?limit=${Math.min(limit, 50)}`;
    const data = (await fetchJson(url, {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    })) as { items?: Array<Record<string, unknown>> };
    const sections: StatuteSection[] = [];
    for (const item of data.items ?? []) {
      sections.push({
        actTitle: String(item.actTitle ?? item.title ?? 'Singapore statute'),
        actShortTitle: String(item.actShortTitle ?? item.id ?? 'SG-SOLID'),
        jurisdiction: 'SG',
        sectionNumber: String(item.sectionNumber ?? item.section ?? '1'),
        sectionTitle: String(item.sectionTitle ?? ''),
        sectionText: String(item.text ?? item.content ?? '').slice(0, 8000),
        practiceArea: 'general',
        keywords: ['Singapore', 'SOLID', 'API'],
        effectiveDate: '1965-08-09',
        isRepealed: false,
      });
      if (sections.length >= limit) break;
    }
    return sections;
  }

  logger.info(
    'E2 SG: set SG_SOLID_EXPORT (JSONL) or SOLID_API_BASE + SOLID_API_KEY — see JRX-E2-OFFICIAL-CORPUS-INGEST.md',
  );
  return [];
}

export async function runE2OfficialIngest(opts: {
  jurisdiction: E2Jurisdiction;
  limit?: number;
  dryRun?: boolean;
}): Promise<E2IngestResult> {
  const limit = opts.limit ?? 20;
  const dryRun = opts.dryRun ?? false;
  let sections: StatuteSection[] = [];
  let source = 'unknown';
  let licenseNote: string | undefined;

  switch (opts.jurisdiction) {
    case 'GC':
      source = 'SaudiArabicLaws/saudi-arabic-laws-and-regulations-corpus (HF)';
      licenseNote = 'CC BY-NC-ND 4.0 — verify commercial use before production RAG';
      sections = await fetchGcSaudiBoeSample(limit);
      break;
    case 'SG':
      source = 'SOLID / SG_SOLID_EXPORT';
      sections = await fetchSgSolidSample(limit);
      break;
    default: {
      const _exhaustive: never = opts.jurisdiction;
      return _exhaustive;
    }
  }

  if (dryRun) {
    return {
      jurisdiction: opts.jurisdiction,
      fetched: sections.length,
      upserted: 0,
      source,
      dryRun: true,
      licenseNote,
    };
  }

  const upserted = await upsertStatuteSections(sections);
  return {
    jurisdiction: opts.jurisdiction,
    fetched: sections.length,
    upserted,
    source,
    dryRun: false,
    licenseNote,
  };
}
