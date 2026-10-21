/**
 * JRX-E1-OFFICIAL-CORPUS-001 — scaffold ingest from official/open APIs (IN/US/UK/EU).
 * Phase E1: sample fetches + RDS upsert; expand to bulk jobs per source docs.
 */
import { createLogger } from '../utils/logger.js';
import type { StatuteSection } from './jrx-statute-seeding-service.js';
import { upsertStatuteSections } from './jrx-statute-seeding-service.js';

const logger = createLogger('jrx-official-corpus-e1');

export type E1Jurisdiction = 'IN' | 'US' | 'UK' | 'EU';

export interface E1IngestResult {
  jurisdiction: E1Jurisdiction;
  fetched: number;
  upserted: number;
  source: string;
  dryRun: boolean;
}

const FETCH_TIMEOUT_MS = 25_000;

async function fetchText(url: string): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/json, application/xml, text/xml, */*' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

/** UK — legislation.gov.uk XML (Equality Act 2010 sample). */
export async function fetchUkOfficialSample(limit: number): Promise<StatuteSection[]> {
  const xml = await fetchText('https://www.legislation.gov.uk/ukpga/2010/15/data.xml');
  const actTitle = 'Equality Act 2010';
  const actShort = 'UK-EQA-2010';
  const sections: StatuteSection[] = [];
  const re = /<Section[^>]*>\s*<Number>([^<]+)<\/Number>\s*<Title>([^<]*)<\/Title>[\s\S]*?<Content>([\s\S]*?)<\/Content>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && sections.length < limit) {
    const sectionNumber = m[1].trim();
    const sectionTitle = m[2].trim() || `Section ${sectionNumber}`;
    const sectionText = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 8000);
    if (!sectionText) continue;
    sections.push({
      actTitle,
      actShortTitle: actShort,
      jurisdiction: 'UK',
      sectionNumber,
      sectionTitle,
      sectionText,
      practiceArea: 'equality_law',
      keywords: ['UK', 'Equality Act', 'official corpus'],
      effectiveDate: '2010-10-01',
      isRepealed: false,
    });
  }
  return sections;
}

/** US — eCFR API (Title 1 sample sections). */
export async function fetchUsOfficialSample(limit: number): Promise<StatuteSection[]> {
  const json = await fetchText('https://www.ecfr.gov/api/versioner/v1/titles');
  const titles = (JSON.parse(json) as { titles?: Array<{ number: number; name: string }> }).titles ?? [];
  const t1 = titles.find((t) => t.number === 1);
  if (!t1) return [];
  const struct = await fetchText(
    `https://www.ecfr.gov/api/versioner/v1/structure/current/title-1.json`,
  );
  const parsed = JSON.parse(struct) as {
    children?: Array<{ identifier?: string; label?: string; label_description?: string }>;
  };
  const sections: StatuteSection[] = [];
  for (const child of parsed.children ?? []) {
    if (sections.length >= limit) break;
    const id = String(child.identifier ?? '').trim();
    if (!id) continue;
    sections.push({
      actTitle: `Code of Federal Regulations — Title 1: ${t1.name}`,
      actShortTitle: 'US-CFR-T1',
      jurisdiction: 'US',
      sectionNumber: id,
      sectionTitle: String(child.label_description ?? child.label ?? id),
      sectionText: String(child.label_description ?? child.label ?? '').slice(0, 4000),
      practiceArea: 'administrative_law',
      keywords: ['US', 'eCFR', 'federal'],
      effectiveDate: new Date().toISOString().slice(0, 10),
      isRepealed: false,
    });
  }
  return sections;
}

/** EU — EUR-Lex bulk/API placeholder; returns empty until operator enables EUR-Lex job. */
export async function fetchEuOfficialSample(_limit: number): Promise<StatuteSection[]> {
  logger.info('E1 EU: use EUR-Lex bulk/API job (see JRX-E1-OFFICIAL-CORPUS-INGEST.md)');
  return [];
}

/** IN — Open India Law export file (local path); no runtime scrape of indiacode. */
export async function fetchInOfficialSample(limit: number): Promise<StatuteSection[]> {
  const path = process.env.OPEN_INDIA_LAW_EXPORT?.trim();
  if (!path) {
    logger.info('E1 IN: set OPEN_INDIA_LAW_EXPORT to JSONL export path (Open India Law / IndiaCode pipeline)');
    return [];
  }
  const fs = await import('node:fs/promises');
  const raw = await fs.readFile(path, 'utf8');
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
        actTitle: String(row.act_title ?? 'Indian enactment'),
        actShortTitle: String(row.act_short ?? 'IN-ACT'),
        jurisdiction: 'IN',
        sectionNumber: String(row.section_number ?? '0'),
        sectionTitle: String(row.section_title ?? ''),
        sectionText: String(row.section_text ?? '').slice(0, 8000),
        practiceArea: 'general',
        keywords: ['India', 'Open India Law'],
        effectiveDate: '1950-01-26',
        isRepealed: false,
      });
    } catch {
      /* skip bad line */
    }
  }
  return sections;
}

export async function runE1OfficialIngest(opts: {
  jurisdiction: E1Jurisdiction;
  limit?: number;
  dryRun?: boolean;
}): Promise<E1IngestResult> {
  const limit = opts.limit ?? 20;
  const dryRun = opts.dryRun ?? false;
  let sections: StatuteSection[] = [];
  let source = 'unknown';

  switch (opts.jurisdiction) {
    case 'UK':
      source = 'legislation.gov.uk';
      sections = await fetchUkOfficialSample(limit);
      break;
    case 'US':
      source = 'ecfr.gov';
      sections = await fetchUsOfficialSample(limit);
      break;
    case 'EU':
      source = 'eur-lex.europa.eu';
      sections = await fetchEuOfficialSample(limit);
      break;
    case 'IN':
      source = 'open-india-law-export';
      sections = await fetchInOfficialSample(limit);
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
    };
  }

  const upserted = await upsertStatuteSections(sections);
  return {
    jurisdiction: opts.jurisdiction,
    fetched: sections.length,
    upserted,
    source,
    dryRun: false,
  };
}
